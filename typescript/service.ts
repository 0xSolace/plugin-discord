import {
	ChannelType,
	type Character,
	type Content,
	type CustomMetadata,
	createUniqueUuid,
	type Entity,
	type EventPayload,
	EventType,
	type HandlerCallback,
	type IAgentRuntime,
	type Media,
	type Memory,
	MemoryType,
	type Room,
	Service,
	stringToUuid,
	type TargetInfo,
	type UUID,
	type World,
} from "@elizaos/core";

/**
 * IMPORTANT: Discord ID Handling - Why stringToUuid() instead of asUUID()
 *
 * Discord uses "snowflake" IDs - large 64-bit integers represented as strings
 * (e.g., "1253563208833433701"). These are NOT valid UUIDs.
 *
 * UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (8-4-4-4-12 hex digits with dashes)
 * Discord ID:  1253563208833433701 (plain number string)
 *
 * The two UUID-related functions behave differently:
 *
 * - `asUUID(str)` - VALIDATES that the string is already a valid UUID format.
 *   If not, it throws: "Error: Invalid UUID format: 1253563208833433701"
 *   Use only when you're certain the input is already a valid UUID.
 *
 * - `stringToUuid(str)` - CONVERTS any string into a deterministic UUID by hashing it.
 *   Always succeeds. The same input always produces the same UUID output.
 *   Use this for Discord snowflake IDs.
 *
 * When working with Discord IDs in ElizaOS:
 *
 * 1. `stringToUuid(discordId)` - For storing Discord IDs in UUID fields (e.g., `messageServerId`).
 *
 * 2. `createUniqueUuid(runtime, discordId)` - For `worldId` and `roomId`. This adds the agent's
 *    ID to the hash, ensuring each agent has its own unique namespace for the same Discord server.
 *
 * 3. `messageServerId` - The correct property name for server IDs on Room and World objects.
 *
 * 4. Discord-specific events (e.g., DiscordEventTypes.VOICE_STATE_UPDATE) are not in core's
 *    EventPayloadMap. When emitting these events, cast to `string[]` and payload to `any`
 *    to use the generic emitEvent overload.
 */
import {
	type ApplicationCommandData,
	type ApplicationCommandDataResolvable,
	AttachmentBuilder,
	AuditLogEvent,
	type Channel,
	type ChatInputApplicationCommandData,
	type Collection,
	ChannelType as DiscordChannelType,
	Client as DiscordJsClient,
	type Role as DiscordRole,
	Events,
	GatewayIntentBits,
	type Guild,
	type GuildChannel,
	type GuildMember,
	type GuildTextBasedChannel,
	type Interaction,
	type Message,
	type MessageReaction,
	type PartialMessageReaction,
	Partials,
	type PartialUser,
	PermissionsBitField,
	type TextChannel,
	type User,
} from "discord.js";
import {
	createCompatRuntime,
	type ICompatRuntime,
	type WorldCompat,
} from "./compat";
import { DISCORD_SERVICE_NAME } from "./constants";
import { getDiscordSettings } from "./environment";
import {
	buildDiscordEntityMetadata,
	buildDiscordWorldMetadata,
} from "./identity";
import { MessageManager } from "./messages";
import {
	diffMemberRoles,
	diffOverwrites,
	diffRolePermissions,
	fetchAuditEntry,
} from "./permissionEvents";
import { generateInviteUrl } from "./permissions";
import {
	type ChannelHistoryOptions,
	type ChannelHistoryResult,
	type ChannelSpiderState,
	DiscordEventTypes,
	type DiscordListenChannelPayload,
	type DiscordNotInChannelsPayload,
	type DiscordReactionPayload,
	type DiscordRegisterCommandsPayload,
	type DiscordSettings,
	type DiscordSlashCommand,
	type DiscordSlashCommandPayload,
	type IDiscordService,
} from "./types";
import {
	getAttachmentFileName,
	MAX_MESSAGE_LENGTH,
	normalizeDiscordMessageText,
	splitMessage,
} from "./utils";
import { VoiceManager } from "./voice";
import { createMessageDebouncer, type MessageDebouncer, createChannelDebouncer, type ChannelDebouncer } from "./debouncer";
import {
	registerSlashCommands as registerBuiltinSlashCommands,
	handleSlashCommand as handleBuiltinSlashCommand,
	handleAutocomplete as handleBuiltinAutocomplete,
} from "./slash-commands";

const DISCORD_SNOWFLAKE_PATTERN = /^\d{15,20}$/;

function normalizeDiscordTargetUserId(value: unknown): string | null {
	if (typeof value !== "string") {
		return null;
	}
	const trimmed = value.trim();
	return DISCORD_SNOWFLAKE_PATTERN.test(trimmed) ? trimmed : null;
}

function extractDiscordUserIdFromMetadata(
	metadata: unknown,
): string | null {
	if (!metadata || typeof metadata !== "object") {
		return null;
	}

	const record = metadata as Record<string, unknown>;
	const discord =
		record.discord && typeof record.discord === "object"
			? (record.discord as Record<string, unknown>)
			: null;

	return (
		normalizeDiscordTargetUserId(discord?.userId) ??
		normalizeDiscordTargetUserId(discord?.id) ??
		normalizeDiscordTargetUserId(record.originalId)
	);
}

/**
 * DiscordService class representing a service for interacting with Discord.
 * @extends Service
 * @implements IDiscordService
 * @property {string} serviceType - The type of service, set to DISCORD_SERVICE_NAME.
 * @property {string} capabilityDescription - A description of the service's capabilities.
 * @property {DiscordJsClient} client - The DiscordJsClient used for communication.
 * @property {Character} character - The character associated with the service.
 * @property {MessageManager} messageManager - The manager for handling messages.
 * @property {VoiceManager} voiceManager - The manager for handling voice communication.
 */

export class DiscordService extends Service implements IDiscordService {
	// Override runtime type for messageServerId cross-core compatibility (see compat.ts)
	protected declare runtime: ICompatRuntime;

	static serviceType: string = DISCORD_SERVICE_NAME;
	capabilityDescription =
		"The agent is able to send and receive messages on discord";
	client: DiscordJsClient | null;
	character: Character;
	messageManager?: MessageManager;
	voiceManager?: VoiceManager;
	private messageDebouncer?: MessageDebouncer;
	private channelDebouncer?: ChannelDebouncer;
	private _loginFailed = false;
	private discordSettings: DiscordSettings;
	private userSelections: Map<string, Record<string, unknown>> = new Map();
	private timeouts: ReturnType<typeof setTimeout>[] = [];
	public clientReadyPromise: Promise<void> | null = null;
	private slashCommands: DiscordSlashCommand[] = [];
	private commandRegistrationQueue: Promise<void> = Promise.resolve();
	/**
	 * Slash command names that should bypass allowed channel restrictions.
	 */
	private allowAllSlashCommands: Set<string> = new Set();
	/**
	 * List of allowed channel IDs (parsed from CHANNEL_IDS env var).
	 * If undefined, all channels are allowed.
	 */
	private allowedChannelIds?: string[];

	/**
	 * Set of dynamically added channel IDs through joinChannel action.
	 * These are merged with allowedChannelIds for runtime channel management.
	 */
	private dynamicChannelIds: Set<string> = new Set();

	private async resolveDiscordTargetUserId(
		targetEntityId: string,
	): Promise<string | null> {
		const directId = normalizeDiscordTargetUserId(targetEntityId);
		if (directId) {
			return directId;
		}

		const directEntity = this.runtime.getEntityById
			? await this.runtime.getEntityById(targetEntityId as UUID)
			: null;
		const directMetadataUserId = extractDiscordUserIdFromMetadata(
			directEntity?.metadata,
		);
		if (directMetadataUserId) {
			return directMetadataUserId;
		}

		if (typeof this.runtime.getRelationships !== "function") {
			return null;
		}

		const identityLinks = await this.runtime.getRelationships({
			entityIds: [targetEntityId as UUID],
			tags: ["identity_link"],
		});
		for (const relationship of identityLinks) {
			const metadata =
				relationship.metadata && typeof relationship.metadata === "object"
					? (relationship.metadata as Record<string, unknown>)
					: null;
			if (metadata?.status !== "confirmed") {
				continue;
			}
			const linkedEntityId =
				relationship.sourceEntityId === targetEntityId
					? relationship.targetEntityId
					: relationship.targetEntityId === targetEntityId
						? relationship.sourceEntityId
						: null;
			if (!linkedEntityId || linkedEntityId === targetEntityId) {
				continue;
			}
			const linkedEntity = this.runtime.getEntityById
				? await this.runtime.getEntityById(linkedEntityId as UUID)
				: null;
			const linkedMetadataUserId = extractDiscordUserIdFromMetadata(
				linkedEntity?.metadata,
			);
			if (linkedMetadataUserId) {
				return linkedMetadataUserId;
			}
		}

		return null;
	}

	/**
	 * Constructor for Discord client.
	 * Initializes the Discord client with specified intents and partials,
	 * sets up event listeners, and ensures all servers exist.
	 *
	 * @param {IAgentRuntime} runtime - The AgentRuntime instance
	 */
	constructor(runtime: IAgentRuntime) {
		super(runtime);

		// Load Discord settings with proper priority (env vars > character settings > defaults)
		this.discordSettings = getDiscordSettings(runtime);

		this.character = runtime.character;

		// Parse CHANNEL_IDS env var to restrict the bot to specific channels
		const channelIdsRaw = runtime.getSetting("CHANNEL_IDS") as
			| string
			| undefined;
		if (
			channelIdsRaw &&
			typeof channelIdsRaw === "string" &&
			channelIdsRaw.trim &&
			typeof channelIdsRaw.trim === "function" &&
			channelIdsRaw.trim()
		) {
			this.allowedChannelIds = channelIdsRaw
				.split(",")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			this.runtime.logger.debug(
				{
					src: "plugin:discord",
					agentId: this.runtime.agentId,
					allowedChannelIds: this.allowedChannelIds,
				},
				"Channel restrictions enabled",
			);
		}

		// Check if Discord API token is available and valid
		const token = runtime.getSetting("DISCORD_API_TOKEN") as string;
		const tokenTrimmed =
			token &&
			typeof token === "string" &&
			token.trim &&
			typeof token.trim === "function"
				? token.trim()
				: token;
		if (!token || tokenTrimmed === "" || token === null) {
			this.runtime.logger.warn("Discord API Token not provided");
			this.client = null;
			return;
		}

		try {
			const client = new DiscordJsClient({
				intents: [
					GatewayIntentBits.Guilds,
					GatewayIntentBits.GuildMembers,
					GatewayIntentBits.GuildPresences,
					GatewayIntentBits.DirectMessages,
					GatewayIntentBits.GuildVoiceStates,
					GatewayIntentBits.MessageContent,
					GatewayIntentBits.GuildMessages,
					GatewayIntentBits.DirectMessageTyping,
					GatewayIntentBits.GuildMessageTyping,
					GatewayIntentBits.GuildMessageReactions,
				],
				partials: [
					Partials.Channel,
					Partials.Message,
					Partials.User,
					Partials.Reaction,
				],
			});
			this.client = client;

			this.runtime = createCompatRuntime(runtime);
			this.voiceManager = new VoiceManager(this, this.runtime);
			this.messageManager = new MessageManager(this, this.runtime);

			this.clientReadyPromise = new Promise((resolve, reject) => {
				// once logged in
				client.once(Events.ClientReady, async (readyClient) => {
					try {
						await this.onReady(readyClient);
						resolve();
					} catch (error) {
						this.runtime.logger.error(
							`Error in onReady: ${error instanceof Error ? error.message : String(error)}`,
						);
						reject(error);
					}
				});
				// Handle client errors that might prevent ready event
				client.once(Events.Error, (error) => {
					this.runtime.logger.error(
						`Discord client error: ${error instanceof Error ? error.message : String(error)}`,
					);
					reject(error);
				});
				// now start login
				client.login(token).catch((error) => {
					this.runtime.logger.error(
						`Failed to login to Discord: ${error instanceof Error ? error.message : String(error)}`,
					);
					if (this.client) {
						this.client.destroy().catch(() => {});
					}
					this.client = null;
					reject(error);
				});
			});

			// Attach error handler to prevent unhandled promise rejection
			// This ensures the promise rejection is handled even if no one awaits it immediately
			this.clientReadyPromise.catch((error) => {
				// Log the error for observability and set login failed flag
				this.runtime.logger.error(
					{
						src: "plugin:discord",
						agentId: this.runtime.agentId,
						error: error instanceof Error ? error.message : String(error),
					},
					"Discord client ready promise rejected",
				);
				this._loginFailed = true;
			});

			this.setupEventListeners();
			// Send handler registered via runtime.registerSendHandlers()
		} catch (error) {
			runtime.logger.error(
				`Error initializing Discord client: ${error instanceof Error ? error.message : String(error)}`,
			);
			this.client = null;
		}
	}

	/**
	 * Returns whether the Discord service is in a healthy state.
	 * False if login failed or client is not ready.
	 */
	public isHealthy(): boolean {
		if (this._loginFailed) return false;
		if (!this.client) return false;
		return this.client.isReady();
	}

	static async start(runtime: IAgentRuntime) {
		const service = new DiscordService(runtime);
		return service;
	}

	/**
	 * The SendHandlerFunction implementation for Discord.
	 * @param {IAgentRuntime} runtime - The runtime instance.
	 * @param {TargetInfo} target - The target information for the message.
	 * @param {Content} content - The content of the message to send.
	 * @returns {Promise<void>} A promise that resolves when the message is sent or rejects on error.
	 * @throws {Error} If the client is not ready, target is invalid, or sending fails.
	 */
	async handleSendMessage(
		// why we have this.runtime on the agent itself and this isn't a static
		runtime: IAgentRuntime,
		target: TargetInfo,
		content: Content,
	): Promise<void> {
		if (!this.client || !this.client.isReady()) {
			runtime.logger.error("Client not ready");
			throw new Error("Discord client is not ready.");
		}
		// After the check above, client is guaranteed to exist and be ready
		const client = this.client;

		let targetChannel: Channel | undefined | null = null;
		let resolvedChannelId: string | null = null;

		try {
			// Determine target based on provided info
			if (target.channelId) {
				resolvedChannelId = target.channelId;
				targetChannel = await client.channels.fetch(target.channelId);
			} else if (target.roomId) {
				const room =
					typeof runtime.getRoom === "function"
						? await runtime.getRoom(target.roomId as UUID)
						: null;
				const roomChannelId =
					room?.channelId && typeof room.channelId === "string"
						? room.channelId
						: null;
				if (!roomChannelId) {
					throw new Error(
						`Could not resolve Discord channel ID for room ${target.roomId}`,
					);
				}
				resolvedChannelId = roomChannelId;
				targetChannel = await client.channels.fetch(roomChannelId);
			} else if (target.entityId) {
				const discordUserId = await this.resolveDiscordTargetUserId(
					target.entityId as string,
				);
				if (!discordUserId) {
					throw new Error(
						`Could not resolve Discord user ID for runtime entity ${target.entityId}`,
					);
				}
				const user = await client.users.fetch(discordUserId);
				if (user) {
					// user.dmChannel is a property (DMChannel | null), not a promise
					targetChannel = user.dmChannel ?? (await user.createDM());
				}
			} else {
				throw new Error(
					"Discord SendHandler requires channelId, roomId, or entityId.",
				);
			}

			if (!targetChannel) {
				// Safely serialize target for error message (target only contains strings, but be defensive)
				const targetStr = JSON.stringify(target, (_key, value) => {
					// Convert BigInt to string if somehow present
					if (typeof value === "bigint") {
						return value.toString();
					}
					return value;
				});
				throw new Error(
					`Could not find target Discord channel/DM for target: ${targetStr}`,
				);
			}

			const allowedByParentThread =
				typeof targetChannel.isThread === "function" &&
				targetChannel.isThread() &&
				"parentId" in targetChannel &&
				typeof targetChannel.parentId === "string" &&
				targetChannel.parentId.length > 0 &&
				this.isChannelAllowed(targetChannel.parentId);
			if (
				this.allowedChannelIds &&
				!this.isChannelAllowed(targetChannel.id) &&
				!allowedByParentThread
			) {
				const resolvedFromText =
					resolvedChannelId && resolvedChannelId !== targetChannel.id
						? ` (resolved from ${resolvedChannelId})`
						: "";
				runtime.logger.warn(
					`Channel ${targetChannel.id}${resolvedFromText} not in allowed list, skipping send`,
				);
				return;
			}

			// Type guard to ensure the channel is text-based
			if (targetChannel.isTextBased() && !targetChannel.isVoiceBased()) {
				// Further check if it's a channel where bots can send messages
				if (
					"send" in targetChannel &&
					typeof targetChannel.send === "function"
				) {
					// Convert Media attachments to Discord AttachmentBuilder format
					const files: AttachmentBuilder[] = [];
					if (content.attachments && content.attachments.length > 0) {
						for (const media of content.attachments) {
							if (media.url) {
								const fileName = getAttachmentFileName(media);
								files.push(
									new AttachmentBuilder(media.url, { name: fileName }),
								);
							}
						}
					}

					const sentMessages: Message[] = [];
					const roomId = createUniqueUuid(runtime, targetChannel.id);
					const channelType = await this.getChannelType(
						targetChannel as Channel,
					);

					// Send message with text and/or attachments
					const textContent = normalizeDiscordMessageText(content.text);
					if (textContent || files.length > 0) {
						if (textContent) {
							// Split message if longer than Discord limit (uses safe buffer)
							const chunks = splitMessage(textContent, MAX_MESSAGE_LENGTH);
							if (chunks.length > 1) {
								// Send all chunks except the last one without files
								for (let i = 0; i < chunks.length - 1; i++) {
									const sent = await targetChannel.send(chunks[i]);
									sentMessages.push(sent);
								}
								// Send the last chunk with files (if any)
								const sent = await targetChannel.send({
									content: chunks[chunks.length - 1],
									files: files.length > 0 ? files : undefined,
								});
								sentMessages.push(sent);
							} else {
								// Single chunk - send with files (if any)
								const sent = await targetChannel.send({
									content: chunks[0],
									files: files.length > 0 ? files : undefined,
								});
								sentMessages.push(sent);
							}
						} else {
							// Only attachments, no text
							const sent = await targetChannel.send({
								files,
							});
							sentMessages.push(sent);
						}
					} else {
						runtime.logger.warn("No text content or attachments provided");
					}

					// Ensure room/world/participant exist before saving to memory (FK constraints)
					const targetChannelGuild =
						"guild" in targetChannel ? targetChannel.guild : null;
					const serverId = targetChannelGuild?.id
						? targetChannelGuild.id
						: targetChannel.id;
					const worldId = createUniqueUuid(runtime, serverId) as UUID;
					const worldName = targetChannelGuild?.name
						? targetChannelGuild.name
						: undefined;

					const clientUser = client.user;
					await this.runtime.ensureConnection({
						entityId: runtime.agentId,
						roomId,
						roomName:
							"name" in targetChannel &&
							typeof targetChannel.name === "string"
								? targetChannel.name
								: (clientUser?.displayName || clientUser?.username || undefined),
						userName: clientUser?.username ? clientUser.username : undefined,
						name: clientUser?.displayName || clientUser?.username || undefined,
						source: "discord",
						channelId: targetChannel.id,
						messageServerId: stringToUuid(serverId),
						type: channelType,
						worldId,
						worldName,
					});

					// Save sent messages to memory
					for (const sentMsg of sentMessages) {
						try {
							// Only include attachments/actions in memory for messages that actually have attachments
							const hasAttachments = sentMsg.attachments.size > 0;

							const memory: Memory = {
								id: createUniqueUuid(runtime, sentMsg.id),
								entityId: runtime.agentId,
								agentId: runtime.agentId,
								roomId,
								content: {
									text: sentMsg.content || textContent || " ",
									url: sentMsg.url,
									channelType,
									// Only include attachments for messages that actually have attachments
									...(hasAttachments && content.attachments
										? { attachments: content.attachments }
										: {}),
									// Include action whenever it exists, regardless of attachments
									...(content.action ? { action: content.action } : {}),
								},
								metadata: {
									type: MemoryType.MESSAGE,
								},
								createdAt: sentMsg.createdTimestamp || Date.now(),
							};

							await runtime.createMemory(memory, "messages");
							runtime.logger.debug(
								{
									src: "plugin:discord",
									agentId: runtime.agentId,
									messageId: sentMsg.id,
								},
								"Saved sent message to memory",
							);
						} catch (error) {
							runtime.logger.warn(
								`Failed to save sent message ${sentMsg.id} to memory: ${error instanceof Error ? error.message : String(error)}`,
							);
						}
					}
				} else {
					throw new Error(
						`Target channel ${targetChannel.id} does not have a send method.`,
					);
				}
			} else {
				throw new Error(
					`Target channel ${targetChannel.id} is not a valid text-based channel for sending messages.`,
				);
			}
		} catch (error) {
			runtime.logger.error(
				`Error sending message to ${JSON.stringify(target)}: ${error instanceof Error ? error.message : String(error)}`,
			);
			throw error;
		}
	}

	/**
	 * Set up event listeners for the client.
	 * @private
	 */
	private setupEventListeners() {
		if (!this.client) {
			return; // Skip if client is not available
		}

		// eslint-disable-next-line @typescript-eslint/no-this-alias
		const self = this;

		const listenCidsRaw = this.runtime.getSetting(
			"DISCORD_LISTEN_CHANNEL_IDS",
		) as string | string[] | undefined;
		const listenCids = Array.isArray(listenCidsRaw)
			? listenCidsRaw
			: listenCidsRaw &&
					typeof listenCidsRaw === "string" &&
					listenCidsRaw.trim()
				? listenCidsRaw
						.trim()
						.split(",")
						.map((s) => s.trim())
						.filter((s) => s.length > 0)
				: [];

		// Setup handling for direct messages
		// Initialize message debouncer
		const debounceMsSetting = this.runtime.getSetting("DISCORD_DEBOUNCE_MS") as string | number | undefined;
		const debounceMs = typeof debounceMsSetting === "number"
			? debounceMsSetting
			: typeof debounceMsSetting === "string" && debounceMsSetting.trim()
				? Number.parseInt(debounceMsSetting, 10) || 400
				: 400;

		this.messageDebouncer = createMessageDebouncer(
			(messages) => {
				if (!this.messageManager || messages.length === 0) return;

				if (messages.length === 1) {
					// Single message: pass directly
					this.messageManager.handleMessage(messages[0]);
				} else {
					// Multiple coalesced messages: use the first as anchor,
					// combine text content, merge attachments
					const anchor = messages[0];
					// Combine texts by joining with newlines
					const combinedText = messages.map((m) => m.content).join("\n");
					// Create a proxy with combined content (Message.content is readonly)
					const combined = Object.create(anchor, {
						content: { value: combinedText, writable: true, enumerable: true },
					});
					this.messageManager.handleMessage(combined);
				}
			},
			debounceMs,
		);

		// Channel-level debouncer for group channels (coalesces ALL users)
		const channelDebounceMsSetting = this.runtime.getSetting("DISCORD_CHANNEL_DEBOUNCE_MS") as string | number | undefined;
		const channelDebounceMs = typeof channelDebounceMsSetting === "number"
			? channelDebounceMsSetting
			: typeof channelDebounceMsSetting === "string" && channelDebounceMsSetting.trim()
				? Number.parseInt(channelDebounceMsSetting, 10) || 3000
				: 3000;

		const responseCooldownMsSetting = this.runtime.getSetting("DISCORD_RESPONSE_COOLDOWN_MS") as string | number | undefined;
		const responseCooldownMs = typeof responseCooldownMsSetting === "number"
			? responseCooldownMsSetting
			: typeof responseCooldownMsSetting === "string" && responseCooldownMsSetting.trim()
				? Number.parseInt(responseCooldownMsSetting, 10) || 30000
				: 30000;

		this.channelDebouncer = createChannelDebouncer(
			(messages) => {
				if (!this.messageManager || messages.length === 0) return;

				// Pick the most relevant message to process:
				// Priority: direct @mention > reply to bot > most recent
				const clientUser = this.client?.user;
				const botId = clientUser?.id;
				const agentNameLower = this.character?.name?.toLowerCase();

				let anchor: Message | undefined;

				if (botId) {
					// Find direct @mention
					anchor = messages.find((m) =>
						m.mentions?.users?.has(botId) ||
						(agentNameLower && agentNameLower.length >= 2 && m.content?.toLowerCase().includes(agentNameLower))
					);
					// Find reply to bot
					if (!anchor) {
						anchor = messages.find((m) =>
							m.reference?.messageId && m.mentions?.repliedUser?.id === botId
						);
					}
				}

				// Fallback: most recent message
				if (!anchor) {
					anchor = messages[messages.length - 1];
				}

				// If we have multiple messages, combine all text as context
				if (messages.length === 1) {
					this.messageManager.handleMessage(anchor);
				} else {
					// Build context: all messages except anchor, prefixed with author
					const contextLines = messages
						.filter((m) => m.id !== anchor!.id)
						.map((m) => `${m.author.displayName || m.author.username}: ${m.content}`);
					const anchorText = anchor.content || "";
					const combinedText = contextLines.length > 0
						? `[Recent channel context]\n${contextLines.join("\n")}\n\n${anchorText}`
						: anchorText;

					const combined = Object.create(anchor, {
						content: { value: combinedText, writable: true, enumerable: true },
					});
					this.messageManager.handleMessage(combined);
				}

				// Mark cooldown after processing
				this.channelDebouncer?.markResponded(messages[0].channel.id);
			},
			{
				debounceMs: channelDebounceMs,
				responseCooldownMs: responseCooldownMs,
				// botUserId is resolved lazily via getter since client.user isn't available until login
				get botUserId() { return self.client?.user?.id; },
				botName: this.character?.name,
			},
		);

		this.client.on("messageCreate", async (message) => {
			// Skip if we're sending the message or in deleted state
			const clientUser = this.client?.user;
			if (
				(clientUser && message.author.id === clientUser.id) ||
				(message.author.bot && this.discordSettings.shouldIgnoreBotMessages)
			) {
				this.runtime.logger.debug(
					{
						src: "plugin:discord",
						agentId: this.runtime.agentId,
						authorId: message.author.id,
						isBot: message.author.bot,
					},
					"Ignoring message from bot or self",
				);
				return;
			}

			if (listenCids.includes(message.channel.id) && message) {
				// Use the reusable buildMemoryFromMessage method
				const newMessage = await this.buildMemoryFromMessage(message);

				if (!newMessage) {
					this.runtime.logger.warn(
						{
							src: "plugin:discord",
							agentId: this.runtime.agentId,
							messageId: message.id,
						},
						"Failed to build memory from listen channel message",
					);
					return;
				}

				// Emit event for listen channel handlers
				const listenPayload: DiscordListenChannelPayload = {
					runtime: this.runtime,
					message: newMessage,
					source: "discord",
				};
				this.runtime.emitEvent(
					DiscordEventTypes.LISTEN_CHANNEL_MESSAGE,
					listenPayload,
				);
			}

			// Skip if channel restrictions are set and this channel is not allowed
			if (
				this.allowedChannelIds &&
				!this.isChannelAllowed(message.channel.id)
			) {
				// check first whether the channel is a thread...
				const channel = this.client
					? await this.client.channels.fetch(message.channel.id)
					: null;

				const notInChannelsPayload: DiscordNotInChannelsPayload = {
					runtime: this.runtime,
					message: message,
					source: "discord",
				};
				this.runtime.emitEvent(
					DiscordEventTypes.NOT_IN_CHANNELS_MESSAGE,
					notInChannelsPayload,
				);

				if (!channel) {
					this.runtime.logger.error(
						{
							src: "plugin:discord",
							agentId: this.runtime.agentId,
							channelId: message.channel.id,
						},
						"Channel not found",
					);
					return;
				}
				if (channel.isThread()) {
					if (!channel.parentId || !this.isChannelAllowed(channel.parentId)) {
						this.runtime.logger.debug(
							{
								src: "plugin:discord",
								agentId: this.runtime.agentId,
								parentChannelId: channel.parentId,
							},
							"Thread not in allowed channel",
						);
						return;
					}
				} else {
					if (
						channel?.isTextBased &&
						typeof channel.isTextBased === "function" &&
						channel.isTextBased()
					) {
						this.runtime.logger.debug(
							{
								src: "plugin:discord",
								agentId: this.runtime.agentId,
								channelId: channel.id,
							},
							"Channel not allowed",
						);
					}
					return;
				}
			}

			try {
				// Route DMs through per-user debouncer, group channels through channel debouncer
				const channelType = message.channel.type as DiscordChannelType;
				const isDM = channelType === DiscordChannelType.DM ||
					channelType === DiscordChannelType.GroupDM;

				if (isDM) {
					// DMs: use per-user debouncer (400ms, coalesces rapid messages from same user)
					if (this.messageDebouncer) {
						this.messageDebouncer.enqueue(message);
					} else if (this.messageManager) {
						this.messageManager.handleMessage(message);
					}
				} else {
					// Group channels: use channel debouncer (3s window, coalesces all users)
					if (this.channelDebouncer) {
						this.channelDebouncer.enqueue(message);
					} else if (this.messageDebouncer) {
						this.messageDebouncer.enqueue(message);
					} else if (this.messageManager) {
						this.messageManager.handleMessage(message);
					}
				}
			} catch (error) {
				this.runtime.logger.error(
					{
						src: "plugin:discord",
						agentId: this.runtime.agentId,
						error: error instanceof Error ? error.message : String(error),
					},
					"Error handling message",
				);
			}
		});

		// Setup handling for reactions
		this.client.on("messageReactionAdd", async (reaction, user) => {
			const clientUser = this.client?.user;
			if (clientUser && user.id === clientUser.id) {
				return;
			}
			// Skip if channel restrictions are set and this reaction is not in an allowed channel
			if (
				this.allowedChannelIds &&
				reaction.message.channel &&
				!this.isChannelAllowed(reaction.message.channel.id)
			) {
				return;
			}
			try {
				await this.handleReactionAdd(reaction, user);
			} catch (error) {
				this.runtime.logger.error(
					{
						src: "plugin:discord",
						agentId: this.runtime.agentId,
						error: error instanceof Error ? error.message : String(error),
					},
					"Error handling reaction add",
				);
			}
		});

		// Handle reaction removal
		this.client.on("messageReactionRemove", async (reaction, user) => {
			const clientUser = this.client?.user;
			if (clientUser && user.id === clientUser.id) {
				return;
			}
			// Skip if channel restrictions are set and this reaction is not in an allowed channel
			if (
				this.allowedChannelIds &&
				reaction.message.channel &&
				!this.isChannelAllowed(reaction.message.channel.id)
			) {
				return;
			}
			try {
				await this.handleReactionRemove(reaction, user);
			} catch (error) {
				this.runtime.logger.error(
					{
						src: "plugin:discord",
						agentId: this.runtime.agentId,
						error: error instanceof Error ? error.message : String(error),
					},
					"Error handling reaction remove",
				);
			}
		});

		// Setup guild (server) event handlers
		this.client.on("guildCreate", async (guild) => {
			try {
				await this.handleGuildCreate(guild);
			} catch (error) {
				this.runtime.logger.error(
					{
						src: "plugin:discord",
						agentId: this.runtime.agentId,
						error: error instanceof Error ? error.message : String(error),
					},
					"Error handling guild create",
				);
			}
		});

		// Setup member (user) joining handlers
		this.client.on("guildMemberAdd", async (member) => {
			try {
				await this.handleGuildMemberAdd(member);
			} catch (error) {
				this.runtime.logger.error(
					{
						src: "plugin:discord",
						agentId: this.runtime.agentId,
						error: error instanceof Error ? error.message : String(error),
					},
					"Error handling guild member add",
				);
			}
		});

		// Interaction handlers
		//
		// Permission Check Flow for Slash Commands:
		// 1. Discord native checks (before this event fires):
		//    - User has required permissions (default_member_permissions)
		//    - Command is available in this context (guild vs DM)
		// 2. ElizaOS channel whitelist (here):
		//    - If CHANNEL_IDS is set, check if channel is allowed
		//    - Unless command has bypassChannelWhitelist flag
		// 3. Custom validator (here):
		//    - Run command's validator function if provided
		//    - Full programmatic control for complex logic
		//
		// Why this order?
		// - Discord's checks are free (handled before interaction fires)
		// - Channel whitelist is cheap (Set lookup)
		// - Custom validators can be expensive (async, database calls, etc.)
		this.client.on("interactionCreate", async (interaction) => {
			// Handle autocomplete interactions (delegated to built-in slash command handlers)
			if (interaction.isAutocomplete()) {
				try {
					await handleBuiltinAutocomplete(interaction);
				} catch (error) {
					this.runtime.logger.error(
						{
							src: "plugin:discord",
							agentId: this.runtime.agentId,
							error: error instanceof Error ? error.message : String(error),
						},
						"Error handling autocomplete",
					);
				}
				return;
			}

			const isSlashCommand = interaction.isCommand();
			const isModalSubmit = interaction.isModalSubmit();
			const isComponent = interaction.isMessageComponent();

			// Check if this slash command has bypass enabled
			const bypassChannelRestriction =
				isSlashCommand &&
				this.allowAllSlashCommands.has(interaction.commandName ?? "");

			this.runtime.logger.debug(
				{
					src: "plugin:discord",
					agentId: this.runtime.agentId,
					interactionType: interaction.type,
					commandName: isSlashCommand ? interaction.commandName : undefined,
					channelId: interaction.channelId,
					inGuild: interaction.inGuild(),
					bypassChannelRestriction,
				},
				"[DiscordService] interactionCreate received",
			);

			// ElizaOS Channel Whitelist Check
			// Follow-up interactions (modals, buttons, autocomplete) always bypass the channel whitelist
			// since they are responses to commands initiated by the user.
			// Slash commands respect the whitelist unless bypassChannelWhitelist: true.
			const isFollowUpInteraction = Boolean(
				interaction.isModalSubmit() ||
					interaction.isMessageComponent() ||
					interaction.isAutocomplete(),
			);

			// Skip if channel restrictions are set and this interaction is not in an allowed channel
			// - Follow-up interactions (modals, components, autocomplete) always bypass
			// - Slash commands respect whitelist unless they have bypassChannelWhitelist: true
			if (
				!isFollowUpInteraction &&
				this.allowedChannelIds &&
				interaction.channelId &&
				!this.isChannelAllowed(interaction.channelId) &&
				!bypassChannelRestriction
			) {
				// For slash commands, send a response to avoid Discord's "application did not respond" error
				// Other interaction types (non-slash) can fail silently
				if (isSlashCommand && interaction.isCommand()) {
					try {
						await interaction.reply({
							content: "This command is not available in this channel.",
							ephemeral: true,
						});
					} catch (responseError) {
						this.runtime.logger.debug(
							{
								src: "plugin:discord",
								agentId: this.runtime.agentId,
								error:
									responseError instanceof Error
										? responseError.message
										: String(responseError),
							},
							"Could not send channel restriction response",
						);
					}
				}
				this.runtime.logger.debug(
					{
						src: "plugin:discord",
						agentId: this.runtime.agentId,
						channelId: interaction.channelId,
						allowedChannelIds: this.allowedChannelIds,
						isSlashCommand,
						isModalSubmit,
						isComponent,
						bypassChannelRestriction,
					},
					"[DiscordService] interactionCreate ignored (channel not allowed)",
				);
				return;
			}

			// Run custom validator if provided for slash commands
			// This is the final permission check layer, after Discord's native checks
			// and our channel whitelist checks have already passed.
			//
			// Why validators?
			// - ElizaOS-specific permission systems (when implemented)
			// - Complex business logic (rate limiting, feature flags, etc.)
			// - Dynamic permissions based on runtime state
			// - Anything that can't be expressed via Discord's native permissions
			if (isSlashCommand && interaction.commandName) {
				const command = this.slashCommands.find(
					(cmd) => cmd.name === interaction.commandName,
				);
				if (command?.validator) {
					try {
						const isValid = await command.validator(interaction, this.runtime);
						if (!isValid) {
							// Send default response if validator didn't respond
							// This prevents Discord from showing "Interaction failed" after 3 seconds
							// or leaving a "thinking" indicator if the validator called deferReply()
							if (!interaction.replied) {
								try {
									const errorMessage =
										"You do not have permission to use this command.";
									if (interaction.deferred) {
										// Validator called deferReply() - use editReply() to resolve the deferred state
										await interaction.editReply({ content: errorMessage });
									} else {
										await interaction.reply({
											content: errorMessage,
											ephemeral: true,
										});
									}
								} catch (responseError) {
									// Validator may have already responded or interaction expired
									this.runtime.logger.debug(
										{
											src: "plugin:discord",
											agentId: this.runtime.agentId,
											commandName: interaction.commandName,
											error:
												responseError instanceof Error
													? responseError.message
													: String(responseError),
										},
										"Could not send validator rejection response (may have already responded)",
									);
								}
							}
							this.runtime.logger.debug(
								{
									src: "plugin:discord",
									agentId: this.runtime.agentId,
									commandName: interaction.commandName,
								},
								"[DiscordService] interactionCreate ignored (custom validator returned false)",
							);
							return;
						}
					} catch (error) {
						// Send error response if validator threw and didn't respond
						// or left a "thinking" indicator via deferReply()
						if (!interaction.replied) {
							try {
								const errorMessage =
									"An error occurred while validating this command.";
								if (interaction.deferred) {
									// Validator called deferReply() - use editReply() to resolve the deferred state
									await interaction.editReply({ content: errorMessage });
								} else {
									await interaction.reply({
										content: errorMessage,
										ephemeral: true,
									});
								}
							} catch (responseError) {
								// Validator may have already responded or interaction expired
								this.runtime.logger.debug(
									{
										src: "plugin:discord",
										agentId: this.runtime.agentId,
										commandName: interaction.commandName,
										error:
											responseError instanceof Error
												? responseError.message
												: String(responseError),
									},
									"Could not send validator error response (may have already responded)",
								);
							}
						}
						this.runtime.logger.error(
							{
								src: "plugin:discord",
								agentId: this.runtime.agentId,
								commandName: interaction.commandName,
								error: error instanceof Error ? error.message : String(error),
							},
							"[DiscordService] Custom validator threw error",
						);
						return;
					}
				}
			}

			try {
				await this.handleInteractionCreate(interaction);

				// After standard interaction handling, route slash commands to built-in handlers
				if (interaction.isChatInputCommand()) {
					await handleBuiltinSlashCommand(interaction, this.runtime);
				}
			} catch (error) {
				this.runtime.logger.error(
					{
						src: "plugin:discord",
						agentId: this.runtime.agentId,
						error: error instanceof Error ? error.message : String(error),
					},
					"Error handling interaction",
				);
			}
		});

		this.client.on(
			"userStream",
			(entityId, name, userName, channel, opusDecoder) => {
				const clientUser = this.client?.user;
				if (clientUser && entityId !== clientUser.id) {
					// Ensure voiceManager exists
					if (this.voiceManager) {
						this.voiceManager.handleUserStream(
							entityId,
							name,
							userName,
							channel,
							opusDecoder,
						);
					}
				}
			},
		);
	}

	public async stop(): Promise<void> {
		this.runtime.logger.info("Stopping Discord service");
		this.timeouts.forEach(clearTimeout);
		this.timeouts = [];

		// Flush pending debounced messages
		if (this.channelDebouncer) {
			try { this.channelDebouncer.flushAll(); } catch { /* */ }
			this.channelDebouncer.destroy();
			this.channelDebouncer = undefined;
		}
		if (this.messageDebouncer) {
			try { this.messageDebouncer.flushAll(); } catch { /* */ }
			this.messageDebouncer.destroy();
			this.messageDebouncer = undefined;
		}

		// Voice manager cleanup
		if (this.voiceManager) {
			try { this.voiceManager.removeAllListeners(); } catch { /* */ }
		}

		if (this.client) {
			try {
				await this.client.destroy();
				this.runtime.logger.info("Discord client destroyed");
			} catch (error) {
				this.runtime.logger.warn(
					`Discord client destroy failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			} finally {
				this.client = null;
			}
		}

		this.clientReadyPromise = null;
		this.messageManager = undefined;
		this.voiceManager = undefined;
		this.runtime.logger.info("Discord service stopped");
	}

	/**
	 * Asynchronously retrieves the type of a given channel.
	 *
	 * @param {Channel} channel - The channel for which to determine the type.
	 * @returns {Promise<ChannelType>} A Promise that resolves with the type of the channel.
	 */
	async getChannelType(channel: Channel): Promise<ChannelType> {
		switch (channel.type) {
			case DiscordChannelType.DM:
				return ChannelType.DM;

			case DiscordChannelType.GroupDM:
				return ChannelType.DM; // Group DMs treated as DM

			case DiscordChannelType.GuildText:
			case DiscordChannelType.GuildNews: // Announcement channels
			case DiscordChannelType.PublicThread:
			case DiscordChannelType.PrivateThread:
			case DiscordChannelType.AnnouncementThread:
			case DiscordChannelType.GuildForum: // Forum channels
				return ChannelType.GROUP;

			case DiscordChannelType.GuildVoice:
			case DiscordChannelType.GuildStageVoice: // Stage channels
				return ChannelType.VOICE_GROUP;

			default:
				// Fallback for any unrecognized channel types
				this.runtime.logger.debug(
					{
						src: "plugin:discord",
						agentId: this.runtime.agentId,
						channelType: channel.type,
					},
					"Unknown channel type, defaulting to GROUP",
				);
				return ChannelType.GROUP;
		}
	}
}

export default DiscordService;
