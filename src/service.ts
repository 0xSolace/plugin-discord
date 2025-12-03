import {
  ChannelType,
  type Character,
  type Content,
  type Media,
  type Entity,
  EventType,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  MemoryType,
  Role,
  Service,
  type TargetInfo,
  type UUID,
  type World,
  createUniqueUuid,
} from '@elizaos/core';
import {
  AttachmentBuilder,
  type Channel,
  ChannelType as DiscordChannelType,
  Client as DiscordJsClient,
  Events,
  GatewayIntentBits,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type Message,
  type MessageReaction,
  type PartialMessageReaction,
  type PartialUser,
  Partials,
  PermissionsBitField,
  type TextChannel,
  type User,
  type Interaction,
  Collection,
} from 'discord.js';
import { DISCORD_SERVICE_NAME } from './constants';
import { getDiscordSettings } from './environment';
import { MessageManager } from './messages';
import { DiscordEventTypes, type IDiscordService, type DiscordSettings, type DiscordSlashCommand, type ChannelHistoryOptions, type ChannelHistoryResult, type ChannelSpiderState } from './types';
import { getAttachmentFileName, splitMessage, MAX_MESSAGE_LENGTH } from './utils';
import { VoiceManager } from './voice';

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
  static serviceType: string = DISCORD_SERVICE_NAME;
  capabilityDescription = 'The agent is able to send and receive messages on discord';
  client: DiscordJsClient | null;
  character: Character;
  messageManager?: MessageManager;
  voiceManager?: VoiceManager;
  private discordSettings: DiscordSettings;
  private userSelections: Map<string, { [key: string]: any }> = new Map();
  private timeouts: ReturnType<typeof setTimeout>[] = [];
  public clientReadyPromise: Promise<void> | null = null;
  private slashCommands: DiscordSlashCommand[] = [];
  private commandRegistrationQueue: Promise<void> = Promise.resolve();
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
    const channelIdsRaw = runtime.getSetting('CHANNEL_IDS') as string | undefined;
    if (channelIdsRaw?.trim && channelIdsRaw.trim()) {
      this.allowedChannelIds = channelIdsRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, allowedChannelIds: this.allowedChannelIds }, 'Channel restrictions enabled')
    }

    // Check if Discord API token is available and valid
    const token = runtime.getSetting('DISCORD_API_TOKEN') as string;
    if (!token || token?.trim && token.trim() === '' || token === null) {
      this.runtime.logger.warn('Discord API Token not provided');
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
        partials: [Partials.Channel, Partials.Message, Partials.User, Partials.Reaction],
      });
      this.client = client

      this.runtime = runtime;
      this.voiceManager = new VoiceManager(this, runtime);
      this.messageManager = new MessageManager(this);

      this.clientReadyPromise = new Promise((resolve, reject) => {
        // once logged in
        client.once(Events.ClientReady, async (readyClient) => {
          try {
            await this.onReady(readyClient);
            resolve();
          } catch (error) {
            this.runtime.logger.error(`Error in onReady: ${error instanceof Error ? error.message : String(error)}`);
            reject(error);
          }
        });
        // Handle client errors that might prevent ready event
        client.once(Events.Error, (error) => {
          this.runtime.logger.error(`Discord client error: ${error instanceof Error ? error.message : String(error)}`);
          reject(error);
        });
        // now start login
        client.login(token).catch((error) => {
          this.runtime.logger.error(`Failed to login to Discord: ${error instanceof Error ? error.message : String(error)}`);
          if (this.client) {
            this.client.destroy().catch(() => { });
          }
          this.client = null;
          reject(error);
        });
      });

      // Attach error handler to prevent unhandled promise rejection
      // This ensures the promise rejection is handled even if no one awaits it immediately
      this.clientReadyPromise.catch((_error) => {
        // Error is already logged in the promise handlers above
        // This catch prevents unhandled promise rejection warnings
        // The promise is public and may be awaited elsewhere, but we need to handle
        // the case where it's not immediately awaited
      });

      this.setupEventListeners();
      // Note: send handler is registered automatically by runtime via registerSendHandlers() static method
    } catch (error) {
      runtime.logger.error(`Error initializing Discord client: ${error instanceof Error ? error.message : String(error)}`);
      this.client = null;
    }
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
    content: Content
  ): Promise<void> {
    if (!this.client?.isReady()) {
      runtime.logger.error('Client not ready');
      throw new Error('Discord client is not ready.');
    }

    // Skip sending if channel restrictions are set and target channel is not allowed
    if (target.channelId && this.allowedChannelIds && !this.isChannelAllowed(target.channelId)) {
      runtime.logger.warn(`Channel ${target.channelId} not in allowed list, skipping send`);
      return;
    }

    let targetChannel: Channel | undefined | null = null;

    try {
      // Determine target based on provided info
      if (target.channelId) {
        targetChannel = await this.client.channels.fetch(target.channelId);
      } else if (target.entityId) {
        // Attempt to convert runtime UUID to Discord snowflake ID
        // NOTE: This assumes a mapping exists or the UUID *is* the snowflake ID
        const discordUserId = target.entityId as string; // May need more robust conversion
        const user = await this.client.users.fetch(discordUserId);
        if (user) {
          targetChannel = (await user.dmChannel) ?? (await user.createDM());
        }
      } else {
        throw new Error('Discord SendHandler requires channelId or entityId.');
      }

      if (!targetChannel) {
        throw new Error(
          `Could not find target Discord channel/DM for target: ${JSON.stringify(target)}`
        );
      }

      // Type guard to ensure the channel is text-based
      if (targetChannel.isTextBased() && !targetChannel.isVoiceBased()) {
        // Further check if it's a channel where bots can send messages
        if ('send' in targetChannel && typeof targetChannel.send === 'function') {
          // Convert Media attachments to Discord AttachmentBuilder format
          const files: AttachmentBuilder[] = [];
          if (content.attachments && content.attachments.length > 0) {
            for (const media of content.attachments) {
              if (media.url) {
                const fileName = getAttachmentFileName(media);
                files.push(new AttachmentBuilder(media.url, { name: fileName }));
              }
            }
          }

          const sentMessages: Message[] = [];
          const roomId = createUniqueUuid(runtime, targetChannel.id);
          const channelType = await this.getChannelType(targetChannel as Channel);

          // Send message with text and/or attachments
          if (content.text || files.length > 0) {
            if (content.text) {
              // Split message if longer than Discord limit (uses safe buffer)
              const chunks = splitMessage(content.text, MAX_MESSAGE_LENGTH);
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
                files: files,
              });
              sentMessages.push(sent);
            }
          } else {
            runtime.logger.warn('No text content or attachments provided');
          }

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
                  text: sentMsg.content || content.text,
                  url: sentMsg.url,
                  channelType,
                  // Only include attachments and actions for messages that actually have attachments
                  ...(hasAttachments && content.attachments ? { attachments: content.attachments } : {}),
                  ...(hasAttachments && content.action ? { action: content.action } : {}),
                },
                metadata: {
                  type: 'message',
                },
                createdAt: sentMsg.createdTimestamp || Date.now(),
              };

              await runtime.createMemory(memory, 'messages');
              runtime.logger.debug({ src: 'plugin:discord', agentId: runtime.agentId, messageId: sentMsg.id }, 'Saved sent message to memory');
            } catch (error) {
              runtime.logger.warn(`Failed to save sent message ${sentMsg.id} to memory: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        } else {
          throw new Error(`Target channel ${targetChannel.id} does not have a send method.`);
        }
      } else {
        throw new Error(
          `Target channel ${targetChannel.id} is not a valid text-based channel for sending messages.`
        );
      }
    } catch (error) {
      runtime.logger.error(`Error sending message to ${JSON.stringify(target)}: ${error instanceof Error ? error.message : String(error)}`);
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

    const listenCidsRaw: string | string[] | undefined = this.runtime.getSetting('DISCORD_LISTEN_CHANNEL_IDS');
    const listenCids = Array.isArray(listenCidsRaw)
      ? listenCidsRaw
      : (listenCidsRaw && typeof listenCidsRaw === 'string' && listenCidsRaw.trim())
        ? listenCidsRaw.trim().split(',').map(s => s.trim()).filter(s => s.length > 0)
        : []
    // Note: talkCids and allowedCids were intended to combine listen and talk channels
    // but are currently unused. Keeping for potential future use.
    // const talkCids = this.allowedChannelIds ?? [] // CHANNEL_IDS
    // const allowedCids = [...listenCids, ...talkCids]

    // Setup handling for direct messages
    this.client.on('messageCreate', async (message) => {
      // Skip if we're sending the message or in deleted state
      if (
        message.author.id === this.client?.user?.id ||
        (message.author.bot && this.discordSettings.shouldIgnoreBotMessages)
      ) {
        this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, authorId: message.author.id, isBot: message.author.bot }, 'Ignoring message from bot or self');
        return;
      }

      if (listenCids.includes(message.channel.id) && message) {
        // Use the reusable buildMemoryFromMessage method
        const newMessage = await this.buildMemoryFromMessage(message);

        if (!newMessage) {
          this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, messageId: message.id }, 'Failed to build memory from listen channel message');
          return;
        }

        // Emit event for listen channel handlers
        this.runtime.emitEvent('DISCORD_LISTEN_CHANNEL_MESSAGE', {
          runtime: this.runtime,
          message: newMessage,
        });
      }

      // Skip if channel restrictions are set and this channel is not allowed
      if (this.allowedChannelIds && !this.isChannelAllowed(message.channel.id)) {
        // check first whether the channel is a thread...
        const channel = await this.client?.channels.fetch(message.channel.id);

        this.runtime.emitEvent('DISCORD_NOT_IN_CHANNELS_MESSAGE', {
          runtime: this.runtime,
          message: message,
        });

        if (!channel) {
          this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId: message.channel.id }, 'Channel not found');
          return;
        }
        if (channel.isThread()) {
          if (!channel.parentId || !this.isChannelAllowed(channel.parentId)) {
            this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, parentChannelId: channel.parentId }, 'Thread not in allowed channel');
            return;
          }
        } else {
          if (channel?.isTextBased()) {
            this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId: channel.id }, 'Channel not allowed');
          }
          return;
        }
      }

      try {
        // Ensure messageManager exists
        this.messageManager?.handleMessage(message);
      } catch (error) {
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error handling message');
      }
    });

    // Setup handling for reactions
    this.client.on('messageReactionAdd', async (reaction, user) => {
      if (user.id === this.client?.user?.id) {
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
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error handling reaction add');
      }
    });

    // Handle reaction removal
    this.client.on('messageReactionRemove', async (reaction, user) => {
      if (user.id === this.client?.user?.id) {
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
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error handling reaction remove');
      }
    });

    // Setup guild (server) event handlers
    this.client.on('guildCreate', async (guild) => {
      try {
        await this.handleGuildCreate(guild);
      } catch (error) {
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error handling guild create');
      }
    });

    // Setup member (user) joining handlers
    this.client.on('guildMemberAdd', async (member) => {
      try {
        await this.handleGuildMemberAdd(member);
      } catch (error) {
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error handling guild member add');
      }
    });

    // Interaction handlers
    this.client.on('interactionCreate', async (interaction) => {
      // Skip if channel restrictions are set and this interaction is not in an allowed channel
      if (
        this.allowedChannelIds &&
        interaction.channelId &&
        !this.isChannelAllowed(interaction.channelId)
      ) {
        return;
      }
      try {
        await this.handleInteractionCreate(interaction);
      } catch (error) {
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error handling interaction');
      }
    });

    this.client.on('userStream', (entityId, name, userName, channel, opusDecoder) => {
      if (entityId !== this.client?.user?.id) {
        // Ensure voiceManager exists
        this.voiceManager?.handleUserStream(entityId, name, userName, channel, opusDecoder);
      }
    });
  }

  /**
   * Handles the event when a new member joins a guild.
   *
   * **Event Design Note:**
   * We intentionally do NOT emit the standardized `EventType.ENTITY_JOINED` here.
   * In ElizaOS's abstraction model:
   * - A Discord "guild" maps to a "world" (the server/community)
   * - A Discord "channel" maps to a "room" (a specific conversation space)
   *
   * `EventType.ENTITY_JOINED` requires a `roomId` because the bootstrap plugin's
   * handler calls `syncSingleUser()` to sync the entity to a specific room. When
   * a member joins a guild, they've joined the "world" but haven't joined any
   * specific "room" yet - they're just a potential participant.
   *
   * The entity will be properly synced to rooms when they first interact:
   * - First message in a channel → message handler calls `ensureConnection()`
   * - Joining a voice channel → voice handler syncs them to that room
   *
   * We still emit the Discord-specific `DiscordEventTypes.ENTITY_JOINED` so that
   * Discord-aware plugins can react to guild member joins (e.g., welcome messages,
   * role assignment, moderation checks).
   *
   * @param {GuildMember} member - The GuildMember object representing the new member.
   * @returns {Promise<void>} - A Promise that resolves once the event handling is complete.
   * @private
   */
  private async handleGuildMemberAdd(member: GuildMember) {
    this.runtime.logger.info(`New member joined: ${member.user.username} (${member.id})`);

    const guild = member.guild;

    const tag = member.user.bot
      ? `${member.user.username}#${member.user.discriminator}`
      : member.user.username;

    const worldId = createUniqueUuid(this.runtime, guild.id);
    const entityId = createUniqueUuid(this.runtime, member.id);

    // Emit Discord-specific event for plugins that want to handle guild member joins.
    // This is NOT the standardized EventType.ENTITY_JOINED because:
    // 1. ENTITY_JOINED requires a roomId (which channel did they join?)
    // 2. Guild membership != room membership; users join rooms when they interact
    // 3. The bootstrap handler would fail without roomId anyway
    // Discord-aware plugins can listen to DiscordEventTypes.ENTITY_JOINED instead.
    this.runtime.emitEvent([DiscordEventTypes.ENTITY_JOINED], {
      runtime: this.runtime,
      entityId,
      worldId,
      source: 'discord',
      metadata: {
        type: member.user.bot ? 'bot' : 'user',
        originalId: member.id,
        username: tag,
        displayName: member.displayName || member.user.username,
        roles: member.roles.cache.map((r) => r.name),
        joinedAt: member.joinedAt?.getTime(),
      },
      member, // Include raw Discord.js member for Discord-specific handling
    });
  }

  /**
   * Handles the event when the bot joins a guild. It logs the guild name, fetches additional information about the guild, scans the guild for voice data, creates standardized world data structure, generates unique IDs, and emits events to the runtime.
   * @param {Guild} guild - The guild that the bot has joined.
   * @returns {Promise<void>} A promise that resolves when the guild creation is handled.
   * @private
   */
  private async handleGuildCreate(guild: Guild) {
    this.runtime.logger.info(`Joined guild: ${guild.name} (${guild.id})`);
    const fullGuild = await guild.fetch();
    // Disabled automatic voice joining - now controlled by joinVoiceChannel action
    // this.voiceManager?.scanGuild(guild);

    // Register slash commands for the newly joined guild
    // This ensures commands are available immediately when the bot joins a new server
    if (this.slashCommands.length > 0 && this.client?.application) {
      try {
        // Filter commands to only include Discord API fields (remove custom fields like bypassChannelWhitelist)
        const discordCommands = this.slashCommands.map(cmd => ({
          name: cmd.name,
          description: cmd.description,
          options: cmd.options || [],
        }));

        await this.client.application.commands.set(discordCommands, fullGuild.id);
        this.runtime.logger.info({ guildId: fullGuild.id, guildName: fullGuild.name, commandCount: discordCommands.length }, `Commands registered to newly joined guild`);
      } catch (error) {
        this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, guildId: fullGuild.id, guildName: fullGuild.name, error: error instanceof Error ? error.message : String(error) }, `Failed to register commands to newly joined guild`);
      }
    }

    const ownerId = createUniqueUuid(this.runtime, fullGuild.ownerId);

    // Create standardized world data structure
    const worldId = createUniqueUuid(this.runtime, fullGuild.id);
    const standardizedData = {
      runtime: this.runtime,
      rooms: await this.buildStandardizedRooms(fullGuild, worldId),
      users: await this.buildStandardizedUsers(fullGuild),
      world: {
        id: worldId,
        name: fullGuild.name,
        agentId: this.runtime.agentId,
        serverId: fullGuild.id,
        metadata: {
          ownership: fullGuild.ownerId ? { ownerId: ownerId } : undefined,
          roles: {
            [ownerId]: Role.OWNER,
          },
        },
      } as World,
      source: 'discord',
    };

    // Emit both Discord-specific and standardized events with the same data structure
    this.runtime.emitEvent([DiscordEventTypes.WORLD_JOINED], {
      runtime: this.runtime,
      server: fullGuild,
      source: 'discord',
    });

    // Emit standardized event with the same structure as WORLD_CONNECTED
    this.runtime.emitEvent([EventType.WORLD_JOINED], standardizedData);
  }

  /**
   * Handles interactions created by the user, specifically commands and message components.
   * @param {Interaction} interaction - The interaction object received.
   * @returns {Promise<void>} A promise that resolves when the interaction is handled.
   * @private
   */
  private async handleInteractionCreate(interaction: Interaction) {

    const entityId = createUniqueUuid(this.runtime, interaction.user.id);
    //this.runtime.logger.debug(`User ${interaction.user.id} => entityId ${entityId}`);
    const userName = interaction.user.bot
      ? `${interaction.user.username}#${interaction.user.discriminator}`
      : interaction.user.username;
    const name = interaction.user.displayName;
    const roomId = createUniqueUuid(this.runtime, interaction.channel?.id || userName)

    // can't be null
    let type: ChannelType;
    let serverId: string | undefined;

    if (interaction.guild) {
      const guild = await interaction.guild.fetch();
      type = await this.getChannelType(interaction.channel as Channel);
      if (type === null) {
        // usually a forum type post
        this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId: interaction.channel?.id }, 'Null channel type for interaction');
      }
      serverId = guild.id;
    } else {
      type = ChannelType.DM;
      // really can't be undefined because bootstrap's choice action
      serverId = interaction.channel?.id;
    }

    await this.runtime.ensureConnection({
      entityId,
      roomId,
      userName,
      name: name,
      source: 'discord',
      channelId: interaction.channel?.id,
      serverId,
      type,
      worldId: createUniqueUuid(this.runtime, serverId ?? roomId) as UUID,
      worldName: interaction.guild?.name,
    });

    if (interaction.isCommand()) {
      // can't interaction.deferReply if we want to allow custom apps (showModal)
      this.runtime.emitEvent([DiscordEventTypes.SLASH_COMMAND], {
        interaction,
        client: this.client,
        commands: this.slashCommands,
      });
    }

    if (interaction.isModalSubmit()) {
      // this modal.id is stored in interaction.customId
      this.runtime.emitEvent([DiscordEventTypes.MODAL_SUBMIT], {
        interaction,
        client: this.client,
      });
    }

    // Handle message component interactions (buttons, dropdowns, etc.)
    if (interaction.isMessageComponent()) {
      this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, customId: interaction.customId }, 'Received component interaction');
      const userId = interaction.user?.id;
      const messageId = interaction.message?.id;

      // Initialize user's selections if not exists
      if (!this.userSelections.has(userId)) {
        this.userSelections.set(userId, {});
      }
      const userSelections = this.userSelections.get(userId);
      if (!userSelections) {
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, entityId: userId }, 'User selections map unexpectedly missing');
        return; // Should not happen
      }

      try {
        // For select menus (type 3), store the values
        if (interaction.isStringSelectMenu()) {
          this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, entityId: userId, customId: interaction.customId, values: interaction.values }, 'Values selected');

          // Store values with messageId to scope them to this specific form
          userSelections[messageId] = {
            ...userSelections[messageId],
            [interaction.customId]: interaction.values,
          };
          // No need to call set again, modification is in place

          this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, messageId, selections: userSelections[messageId] }, 'Current selections for message');

          // Acknowledge the selection
          await interaction.deferUpdate();
          // await interaction.followUp({
          //   content: 'Selection saved!',
          //   ephemeral: true,
          // });
        }

        // For button interactions (type 2), use stored values
        if (interaction.isButton()) {
          this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, entityId: userId, customId: interaction.customId }, 'Button pressed');
          const formSelections = userSelections[messageId] || {};

          this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, formSelections }, 'Form data being submitted');

          // Set up fallback acknowledgement after 2.5 seconds if handler doesn't respond
          // This prevents "Interaction failed" errors while still allowing handlers to show modals
          // Handlers that want to show modals should do so immediately (within 3 seconds)
          const fallbackTimeout = setTimeout(async () => {
            // Remove timeout from array after execution to prevent memory leak
            const index = this.timeouts.indexOf(fallbackTimeout);
            if (index > -1) {
              this.timeouts.splice(index, 1);
            }

            // Check if interaction has already been handled
            if (!interaction.replied && !interaction.deferred) {
              try {
                await interaction.deferUpdate();
                this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, customId: interaction.customId }, 'Acknowledged button interaction via fallback');
              } catch (ackError) {
                // Interaction may have already been acknowledged, expired, or handler responded
                // This is expected and not an error
                this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, error: ackError instanceof Error ? ackError.message : String(ackError) }, 'Fallback acknowledgement skipped');
              }
            }
          }, 2500);
          // Store timeout for cleanup on service stop
          this.timeouts.push(fallbackTimeout);

          // Set up a one-time check to clear the timeout early if interaction is acknowledged
          // This prevents unnecessary timeout execution and reduces memory usage
          const earlyCheckTimeout = setTimeout(() => {
            if (interaction.replied || interaction.deferred) {
              clearTimeout(fallbackTimeout);
              // Remove timeout from array since it's been cleared early
              const index = this.timeouts.indexOf(fallbackTimeout);
              if (index > -1) {
                this.timeouts.splice(index, 1);
              }
            }
            // Remove the early check timeout itself from the array
            const earlyIndex = this.timeouts.indexOf(earlyCheckTimeout);
            if (earlyIndex > -1) {
              this.timeouts.splice(earlyIndex, 1);
            }
          }, 2000); // Check once after 2 seconds (before fallback fires)
          // Store early check timeout for cleanup
          this.timeouts.push(earlyCheckTimeout);

          // Emit an event with the interaction data and stored selections
          this.runtime.emitEvent(['DISCORD_INTERACTION'], {
            interaction: {
              customId: interaction.customId,
              componentType: interaction.componentType,
              type: interaction.type,
              user: userId,
              messageId: messageId,
              selections: formSelections, // seems not to be generic
            },
            // we need to be able to do things with the discord client
            // such as interaction.showModal
            discordInteraction: interaction,
            source: 'discord',
          });

          // Clear selections for this form only
          delete userSelections[messageId];
          // No need to call set again
          this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, messageId }, 'Cleared selections for message');

          // Note: The fallback timeout will acknowledge the interaction if the handler doesn't
          // Handlers that need to show modals must do so immediately (within 3 seconds)
          // Handlers that don't need modals can rely on the fallback or acknowledge themselves
        }
      } catch (error) {
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error handling component interaction');
        try {
          await interaction.followUp({
            content: 'There was an error processing your interaction.',
            ephemeral: true,
          });
        } catch (followUpError) {
          this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: followUpError instanceof Error ? followUpError.message : String(followUpError) }, 'Error sending follow-up message');
        }
      }
    }
  }

  /**
   * Builds a standardized list of rooms from Discord guild channels.
   *
   * @param {Guild} guild The guild to build rooms for.
   * @param {UUID} _worldId The ID of the world to associate with the rooms (currently unused in favor of direct channel to room mapping).
   * @returns {Promise<any[]>} An array of standardized room objects.
   * @private
   */
  private async buildStandardizedRooms(guild: Guild, _worldId: UUID): Promise<any[]> {
    const rooms: any[] = [];

    for (const [channelId, channel] of guild.channels.cache) {
      // Only process text and voice channels
      if (
        channel.type === DiscordChannelType.GuildText ||
        channel.type === DiscordChannelType.GuildVoice
      ) {
        const roomId = createUniqueUuid(this.runtime, channelId);
        let channelType;

        switch (channel.type) {
          case DiscordChannelType.GuildText:
            channelType = ChannelType.GROUP;
            break;
          case DiscordChannelType.GuildVoice:
            channelType = ChannelType.VOICE_GROUP;
            break;
          default:
            channelType = ChannelType.GROUP;
        }

        // For text channels, we could potentially get member permissions
        // But for performance reasons, keep this light for large guilds
        let participants: UUID[] = [];

        if (guild.memberCount < 1000 && channel.type === DiscordChannelType.GuildText) {
          try {
            // Only attempt this for smaller guilds
            // Get members with read permissions for this channel
            participants = Array.from(guild.members.cache.values())
              .filter((member: GuildMember) =>
                channel.permissionsFor(member)?.has(PermissionsBitField.Flags.ViewChannel)
              )
              .map((member: GuildMember) => createUniqueUuid(this.runtime, member.id));
          } catch (error) {
            this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId: channel.id, error: error instanceof Error ? error.message : String(error) }, 'Failed to get participants for channel');
          }
        }

        rooms.push({
          id: roomId,
          name: channel.name,
          type: channelType,
          channelId: channel.id,
          participants,
        });
      }
    }

    return rooms;
  }

  /**
   * Builds a standardized list of users (entities) from Discord guild members.
   * Implements different strategies based on guild size for performance.
   *
   * @param {Guild} guild - The guild from which to build the user list.
   * @returns {Promise<Entity[]>} A promise that resolves with an array of standardized entity objects.
   * @private
   */
  private async buildStandardizedUsers(guild: Guild): Promise<Entity[]> {
    const entities: Entity[] = [];
    const botId = this.client?.user?.id;

    // Strategy based on guild size
    if (guild.memberCount > 1000) {
      this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, guildId: guild.id, memberCount: guild.memberCount }, 'Using optimized user sync for large guild');

      // For large guilds, prioritize members already in cache + online members
      try {
        // Use cache first
        for (const [, member] of guild.members.cache) {
          const tag = member.user.bot
            ? `${member.user.username}#${member.user.discriminator}`
            : member.user.username;

          if (member.id !== botId) {
            entities.push({
              id: createUniqueUuid(this.runtime, member.id),
              names: Array.from(
                new Set(
                  [member.user.username, member.displayName, member.user.globalName].filter(
                    Boolean
                  ) as string[]
                )
              ),
              agentId: this.runtime.agentId,
              metadata: {
                default: {
                  username: tag,
                  name: member.displayName || member.user.username,
                },
                discord: member.user.globalName
                  ? {
                    username: tag,
                    name: member.displayName || member.user.username,
                    globalName: member.user.globalName,
                    userId: member.id,
                  }
                  : {
                    username: tag,
                    name: member.displayName || member.user.username,
                    userId: member.id,
                  },
              },
            });
          }
        }

        // If cache has very few members, try to get online members
        if (entities.length < 100) {
          this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, guildId: guild.id }, 'Adding online members');
          // This is a more targeted fetch that is less likely to hit rate limits
          const onlineMembers = await guild.members.fetch({ limit: 100 });

          for (const [, member] of onlineMembers) {
            if (member.id !== botId) {
              const entityId = createUniqueUuid(this.runtime, member.id);
              // Avoid duplicates
              if (!entities.some((u) => u.id === entityId)) {
                const tag = member.user.bot
                  ? `${member.user.username}#${member.user.discriminator}`
                  : member.user.username;

                entities.push({
                  id: entityId,
                  names: Array.from(
                    new Set(
                      [member.user.username, member.displayName, member.user.globalName].filter(
                        Boolean
                      ) as string[]
                    )
                  ),
                  agentId: this.runtime.agentId,
                  metadata: {
                    default: {
                      username: tag,
                      name: member.displayName || member.user.username,
                    },
                    discord: member.user.globalName
                      ? {
                        username: tag,
                        name: member.displayName || member.user.username,
                        globalName: member.user.globalName,
                        userId: member.id,
                      }
                      : {
                        username: tag,
                        name: member.displayName || member.user.username,
                        userId: member.id,
                      },
                  },
                });
              }
            }
          }
        }
      } catch (error) {
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, guildId: guild.id, error: error instanceof Error ? error.message : String(error) }, 'Error fetching members');
      }
    } else {
      // For smaller guilds, we can fetch all members
      try {
        let members = guild.members.cache;
        if (members.size === 0) {
          members = await guild.members.fetch();
        }

        for (const [, member] of members) {
          if (member.id !== botId) {
            const tag = member.user.bot
              ? `${member.user.username}#${member.user.discriminator}`
              : member.user.username;

            entities.push({
              id: createUniqueUuid(this.runtime, member.id),
              names: Array.from(
                new Set(
                  [member.user.username, member.displayName, member.user.globalName].filter(
                    Boolean
                  ) as string[]
                )
              ),
              agentId: this.runtime.agentId,
              metadata: {
                default: {
                  username: tag,
                  name: member.displayName || member.user.username,
                },
                discord: member.user.globalName
                  ? {
                    username: tag,
                    name: member.displayName || member.user.username,
                    globalName: member.user.globalName,
                    userId: member.id,
                  }
                  : {
                    username: tag,
                    name: member.displayName || member.user.username,
                    userId: member.id,
                  },
              },
            });
          }
        }
      } catch (error) {
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, guildId: guild.id, error: error instanceof Error ? error.message : String(error) }, 'Error fetching members');
      }
    }

    return entities;
  }

  /**
   * Handles tasks to be performed once the Discord client is fully ready and connected.
   * This includes fetching guilds, scanning for voice data, and emitting connection events.
   * @private
   * @returns {Promise<void>} A promise that resolves when all on-ready tasks are completed.
   */
  private async onReady(readyClient) {
    this.runtime.logger.success('Discord client ready');

    // Initialize slash commands array (empty initially - commands registered via DISCORD_REGISTER_COMMANDS)
    this.slashCommands = [];

    // Clear global commands to avoid duplicates (we use per-guild registration only)
    if (this.client?.application) {
      try {
        await this.client.application.commands.set([]);
        this.runtime.logger.debug('Cleared global commands to avoid duplicates');
      } catch (err) {
        this.runtime.logger.debug(`Could not clear global commands: ${err}`);
      }
    }

    // Set up the DISCORD_REGISTER_COMMANDS event handler BEFORE any registration
    // This ensures commands can be registered immediately when the event is emitted
    // we can lock it down to on guild too
    // // REST.put(Routes.applicationGuildCommands(clientId, '123456789012345678'), { body: [commandJson] });
    this.runtime.registerEvent('DISCORD_REGISTER_COMMANDS', async (params: { commands: DiscordSlashCommand[] }) => {
      this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, commandCount: params.commands.length }, 'Registering Discord commands');
      if (!this.client?.application) {
        this.runtime.logger.warn('Cannot register commands - no app');
        return
      }
      const commands: DiscordSlashCommand[] = params.commands
      if (!Array.isArray(commands) || commands.length === 0) {
        this.runtime.logger.warn('Cannot register commands - no commands provided');
        return
      }

      // Validate all commands
      for (const cmd of commands) {
        if (!cmd.name || !cmd.description) {
          this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, command: cmd }, 'Cannot register commands - invalid command');
          return
        }
      }

      // Queue this registration to prevent race conditions
      // Each registration waits for the previous one to complete
      let registrationError: Error | null = null;
      let registrationFailed = false;

      this.commandRegistrationQueue = this.commandRegistrationQueue.then(async () => {
        // Deduplicate commands by name: merge existing and incoming commands into a map
        // Incoming commands overwrite existing ones with the same name
        const commandMap = new Map<string, DiscordSlashCommand>();

        // First, add all existing commands to the map
        for (const cmd of this.slashCommands) {
          if (cmd.name) {
            commandMap.set(cmd.name, cmd);
          }
        }

        // Then, add incoming commands (overwriting any with the same name)
        for (const cmd of commands) {
          commandMap.set(cmd.name, cmd);
        }

        // Convert map values back to array and update this.slashCommands
        this.slashCommands = Array.from(commandMap.values());

        // Filter commands to only include Discord API fields (remove custom fields like bypassChannelWhitelist)
        const discordCommands = this.slashCommands.map(cmd => ({
          name: cmd.name,
          description: cmd.description,
          options: cmd.options || [],
        }));

        this.runtime.logger.info(`Registering ${commands.length} new commands (${this.slashCommands.length} total): ${discordCommands.map(c => c.name).join(', ')}`)

        if (!this.client?.application) {
          throw new Error('Discord client application is not available');
        }

        // Register commands per-guild only for instant availability
        // Note: We don't register globally because that causes duplicate commands
        // (Discord shows both global AND guild commands if both are registered)
        // For new guilds the bot joins, commands will be registered via guildCreate event
        const guilds = this.client.guilds.cache;
        const guildRegistrations: Promise<void>[] = [];

        for (const [guildId, guild] of guilds) {
          guildRegistrations.push(
            this.client.application.commands.set(discordCommands, guildId)
              .then(() => {
                this.runtime.logger.debug({ guildId, guildName: guild.name }, `Commands registered to guild`);
              })
              .catch((err) => {
                this.runtime.logger.warn(`Failed to register commands to guild ${guild.name}: ${err.message}`);
              })
          );
        }

        // Wait for all guild registrations to complete
        await Promise.all(guildRegistrations);

        this.runtime.logger.info(`Commands registered to ${guilds.size} guilds`)
      }).catch((error) => {
        registrationFailed = true;
        registrationError = error instanceof Error ? error : new Error(String(error));
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: registrationError.message }, 'Error registering Discord commands');
        // Don't re-throw: allow the queue to continue processing future registrations
        // even if this one failed. The error is logged and will be thrown after queue completes.
      });

      // Wait for this registration to complete
      await this.commandRegistrationQueue;

      // Throw error after queue completes if this registration failed
      // This allows the queue to continue processing future registrations
      if (registrationFailed && registrationError) {
        throw registrationError;
      }

      return
    })

    // Required permissions for the bot
    const requiredPermissions = [
      // Text Permissions
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.SendMessagesInThreads,
      PermissionsBitField.Flags.CreatePrivateThreads,
      PermissionsBitField.Flags.CreatePublicThreads,
      PermissionsBitField.Flags.EmbedLinks,
      PermissionsBitField.Flags.AttachFiles,
      PermissionsBitField.Flags.AddReactions,
      PermissionsBitField.Flags.UseExternalEmojis,
      PermissionsBitField.Flags.UseExternalStickers,
      PermissionsBitField.Flags.MentionEveryone,
      PermissionsBitField.Flags.ManageMessages,
      PermissionsBitField.Flags.ReadMessageHistory,
      // Voice Permissions
      PermissionsBitField.Flags.Connect,
      PermissionsBitField.Flags.Speak,
      PermissionsBitField.Flags.UseVAD,
      PermissionsBitField.Flags.PrioritySpeaker,
    ].reduce((a, b) => a | b, 0n);

    const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${readyClient.user?.id}&permissions=${requiredPermissions}&scope=bot%20applications.commands`;
    // Use character name if available, otherwise fallback to username, then agentId
    const agentName = this.runtime.character.name || readyClient.user?.username || this.runtime.agentId;

    this.runtime.logger.info(`Use this URL to add the "${agentName}" bot to your Discord server: ${inviteUrl}`);

    this.runtime.logger.success(`Discord client logged in successfully as ${readyClient.user?.username || agentName}`);

    const guilds = await this.client?.guilds.fetch();
    if (!guilds) {
      this.runtime.logger.warn('Could not fetch guilds');
      return;
    }
    for (const [, guild] of guilds) {
      // Disabled automatic voice joining - now controlled by joinVoiceChannel action
      // await this.voiceManager?.scanGuild(fullGuild);

      // Send after a brief delay
      const timeoutId = setTimeout(async () => {
        // For each server the client is in, fire a connected event
        try {
          const fullGuild = await guild.fetch();
          this.runtime.logger.info(`Discord server connected: ${fullGuild.name} (${fullGuild.id})`);

          // Emit Discord-specific event with full guild object
          this.runtime.emitEvent([DiscordEventTypes.WORLD_CONNECTED], {
            runtime: this.runtime,
            server: fullGuild,
            source: 'discord',
          });

          // Create platform-agnostic world data structure with simplified structure
          const worldId = createUniqueUuid(this.runtime, fullGuild.id);
          const ownerId = createUniqueUuid(this.runtime, fullGuild.ownerId);

          const standardizedData = {
            name: fullGuild.name,
            runtime: this.runtime,
            rooms: await this.buildStandardizedRooms(fullGuild, worldId),
            entities: await this.buildStandardizedUsers(fullGuild),
            world: {
              id: worldId,
              name: fullGuild.name,
              agentId: this.runtime.agentId,
              serverId: fullGuild.id,
              metadata: {
                ownership: fullGuild.ownerId ? { ownerId } : undefined,
                roles: {
                  [ownerId]: Role.OWNER,
                },
              },
            } as World,
            source: 'discord',
          };

          // Emit standardized event
          this.runtime.emitEvent([EventType.WORLD_CONNECTED], standardizedData);
        } catch (error) {
          // Add error handling to prevent crashes if the client is already destroyed
          this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error during Discord world connection');
        }
      }, 1000);

      // Store the timeout reference to be able to cancel it when stopping
      this.timeouts.push(timeoutId);
    }

    this.client?.emit('voiceManagerReady');
  }

  /**
   * Registers send handlers for the Discord service instance.
   * This allows the runtime to correctly dispatch messages to this service.
   * @param {IAgentRuntime} runtime - The agent runtime instance.
   * @param {DiscordService} serviceInstance - The instance of the DiscordService.
   * @static
   */
  static registerSendHandlers(runtime: IAgentRuntime, serviceInstance: DiscordService) {
    if (serviceInstance) {
      runtime.registerSendHandler(
        'discord',
        serviceInstance.handleSendMessage.bind(serviceInstance)
      );
      runtime.logger.info('Registered send handler');
    }
  }

  /**
   * Fetches all members who have access to a specific text channel.
   *
   * @param {string} channelId - The Discord ID of the text channel.
   * @param {boolean} [useCache=true] - Whether to prioritize cached data. Defaults to true.
   * @returns {Promise<Array<{id: string, username: string, displayName: string}>>} A promise that resolves with an array of channel member objects, each containing id, username, and displayName.
   */
  public async getTextChannelMembers(
    channelId: string,
    useCache: boolean = true
  ): Promise<Array<{ id: string; username: string; displayName: string }>> {
    this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId, useCache }, 'Fetching members for text channel');

    try {
      // Fetch the channel
      const channel = (await this.client?.channels.fetch(channelId)) as TextChannel;

      // Validate channel
      if (!channel) {
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId }, 'Channel not found');
        return [];
      }

      if (channel.type !== DiscordChannelType.GuildText) {
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId }, 'Channel is not a text channel');
        return [];
      }

      const guild = channel.guild;
      if (!guild) {
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId }, 'Channel is not in a guild');
        return [];
      }

      // Determine strategy based on guild size and cache preference
      const useCacheOnly = useCache && guild.memberCount > 1000;
      let members: Collection<string, GuildMember>;

      if (useCacheOnly) {
        this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, guildId: guild.id, memberCount: guild.memberCount }, 'Using cached members for large guild');
        members = guild.members.cache;
      } else {
        // For smaller guilds or when cache is not preferred, fetch members
        try {
          if (useCache && guild.members.cache.size > 0) {
            this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, cacheSize: guild.members.cache.size }, 'Using cached members');
            members = guild.members.cache;
          } else {
            this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, guildId: guild.id }, 'Fetching members for guild');
            members = await guild.members.fetch();
            this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, memberCount: members.size }, 'Fetched members');
          }
        } catch (error) {
          this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error fetching members');
          // Fallback to cache if fetch fails
          members = guild.members.cache;
          this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, cacheSize: members.size }, 'Fallback to cache');
        }
      }

      // Filter members by permission to view the channel
      this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId: channel.id }, 'Filtering members for channel access');
      // Explicitly type the array from values()
      const memberArray: GuildMember[] = Array.from(members.values());
      const channelMembers = memberArray
        .filter((member: GuildMember) => {
          // Skip bots except our own bot
          // Add null check for client and client.user
          if (member.user.bot && member.id !== this.client?.user?.id) {
            return false;
          }

          // Check if the member can view the channel
          return (
            channel.permissionsFor(member)?.has(PermissionsBitField.Flags.ViewChannel) ?? false
          );
        })
        .map((member: GuildMember) => ({
          id: member.id,
          username: member.user.username,
          displayName: member.displayName || member.user.username,
        }));

      this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId: channel.id, memberCount: channelMembers.length }, 'Found members with channel access');
      return channelMembers;
    } catch (error) {
      this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error fetching channel members');
      return [];
    }
  }

  /**
   * Generic handler for reaction events (add/remove).
   * @private
   */
  private async handleReaction(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser,
    type: 'add' | 'remove'
  ) {
    try {
      const actionVerb = type === 'add' ? 'added' : 'removed';
      const actionText = type === 'add' ? 'Added' : 'Removed';
      const preposition = type === 'add' ? 'to' : 'from';

      this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, type }, `Reaction ${actionVerb}`);

      // Early returns
      if (!reaction || !user) {
        this.runtime.logger.warn('Invalid reaction or user');
        return;
      }

      // Get emoji info
      let emoji = reaction.emoji.name;
      if (!emoji && reaction.emoji.id) {
        emoji = `<:${reaction.emoji.name}:${reaction.emoji.id}>`;
      }

      // Fetch full message if partial
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch partial reaction');
          return;
        }
      }

      // Generate IDs with timestamp to ensure uniqueness
      const timestamp = Date.now();
      const roomId = createUniqueUuid(this.runtime, reaction.message.channel.id);
      const entityId = createUniqueUuid(this.runtime, user.id);
      const reactionUUID = createUniqueUuid(
        this.runtime,
        `${reaction.message.id}-${user.id}-${emoji}-${timestamp}`
      );

      // Validate IDs
      if (!entityId || !roomId) {
        this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, entityId, roomId }, 'Invalid user ID or room ID');
        return;
      }

      // Process message content
      const messageContent = reaction.message.content || '';
      const truncatedContent =
        messageContent.length > 50 ? `${messageContent.substring(0, 50)}...` : messageContent;
      const reactionMessage = `*${actionText} <${emoji}> ${preposition}: \\"${truncatedContent}\\"*`;

      // Get user info
      const userName = reaction.message.author?.username || 'unknown';
      const name = reaction.message.author?.displayName || userName;

      // Get channel type once and reuse
      const channelType = await this.getChannelType(reaction.message.channel as Channel);

      await this.runtime.ensureConnection({
        entityId,
        roomId,
        userName,
        worldId: createUniqueUuid(this.runtime, reaction.message.guild?.id ?? roomId) as UUID,
        worldName: reaction.message.guild?.name,
        name: name,
        source: 'discord',
        channelId: reaction.message.channel.id,
        serverId: reaction.message.guild?.id,
        type: channelType,
      });

      const inReplyTo = createUniqueUuid(this.runtime, reaction.message.id);

      const memory: Memory = {
        id: reactionUUID,
        entityId,
        agentId: this.runtime.agentId,
        content: {
          text: reactionMessage,
          source: 'discord',
          inReplyTo,
          channelType,
        },
        roomId,
        createdAt: timestamp,
      };

      const callback: HandlerCallback = async (content): Promise<Memory[]> => {
        if (!reaction.message.channel) {
          this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'No channel found for reaction message');
          return [];
        }
        await (reaction.message.channel as TextChannel).send(content.text ?? '');
        return [];
      };

      // Emit appropriate events based on type
      const events = type === 'add'
        ? ['DISCORD_REACTION_RECEIVED', 'REACTION_RECEIVED']
        : [DiscordEventTypes.REACTION_RECEIVED];

      this.runtime.emitEvent(events, {
        runtime: this.runtime,
        message: memory,
        callback,
      });
    } catch (error) {
      this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error handling reaction');
    }
  }

  /**
   * Handles reaction addition.
   * @private
   */
  private async handleReactionAdd(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ) {
    await this.handleReaction(reaction, user, 'add');
  }

  /**
   * Handles reaction removal.
   * @private
   */
  private async handleReactionRemove(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ) {
    await this.handleReaction(reaction, user, 'remove');
  }

  /**
   * Checks if a channel ID is allowed based on both env config and dynamic additions.
   * @param {string} channelId - The channel ID to check
   * @returns {boolean} Whether the channel is allowed
   */
  public isChannelAllowed(channelId: string): boolean {
    // If no restrictions are set, allow all channels
    if (!this.allowedChannelIds) {
      return true;
    }

    // Check if channel is in the env-configured list or dynamically added
    return this.allowedChannelIds.includes(channelId) || this.dynamicChannelIds.has(channelId);
  }

  /**
   * Adds a channel to the dynamic allowed list.
   * @param {string} channelId - The channel ID to add
   * @returns {boolean} Whether the channel was successfully added
   */
  public addAllowedChannel(channelId: string): boolean {
    // Validate the channel exists
    if (!this.client?.channels.cache.has(channelId)) {
      return false;
    }

    this.dynamicChannelIds.add(channelId);
    return true;
  }

  /**
   * Removes a channel from the dynamic allowed list.
   * @param {string} channelId - The channel ID to remove
   * @returns {boolean} Whether the channel was in the list and removed
   */
  public removeAllowedChannel(channelId: string): boolean {
    // Don't allow removing channels that are in the env config
    if (this.allowedChannelIds?.includes(channelId)) {
      return false;
    }

    return this.dynamicChannelIds.delete(channelId);
  }

  /**
   * Gets the list of all allowed channels (env + dynamic).
   * @returns {string[]} Array of allowed channel IDs
   */
  public getAllowedChannels(): string[] {
    const envChannels = this.allowedChannelIds || [];
    const dynamicChannels = Array.from(this.dynamicChannelIds);
    return [...new Set([...envChannels, ...dynamicChannels])];
  }

  /**
   * Type guard to check if a channel is a guild text-based channel
   * @private
   */
  private isGuildTextBasedChannel(channel: Channel | null): channel is GuildTextBasedChannel {
    return (
      !!channel &&
      'isTextBased' in channel &&
      typeof channel.isTextBased === 'function' &&
      channel.isTextBased() &&
      'guild' in channel &&
      channel.guild !== null
    );
  }

  /**
   * Helper to delay execution
   * @private
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get spider state for a channel from the database
   * @private
   */
  private async getSpiderState(channelId: string): Promise<ChannelSpiderState | null> {
    try {
      // Create a deterministic UUID for this channel's spider state
      const stateId = createUniqueUuid(this.runtime, `discord-spider-state-${channelId}`);

      // Try to get the state memory from the database
      const stateMemory = await this.runtime.getMemoryById(stateId);

      if (stateMemory && stateMemory.content.text) {
        const state = JSON.parse(stateMemory.content.text) as ChannelSpiderState;
        this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId, state }, 'Loaded spider state from database');
        return state;
      }
    } catch (error) {
      this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error), channelId }, 'Failed to load spider state from database');
    }
    return null;
  }

  /**
   * Save spider state for a channel to the database
   * @private
   */
  private async saveSpiderState(state: ChannelSpiderState): Promise<void> {
    try {
      // Create a deterministic UUID for this channel's spider state
      const stateId = createUniqueUuid(this.runtime, `discord-spider-state-${state.channelId}`);
      const roomId = createUniqueUuid(this.runtime, state.channelId);

      this.runtime.logger.debug(`[SpiderState] Saving channel=${state.channelId} stateId=${stateId}`);

      // Check if state already exists - if so, delete it first
      let existing: Memory | null = null;
      try {
        existing = await this.runtime.getMemoryById(stateId);
        this.runtime.logger.debug(`[SpiderState] getMemoryById: ${existing ? 'EXISTS' : 'NOT_FOUND'}`);
      } catch (lookupError: any) {
        this.runtime.logger.debug(`[SpiderState] getMemoryById error: ${lookupError?.message || lookupError}`);
      }

      if (existing) {
        this.runtime.logger.debug(`[SpiderState] Deleting existing state before insert`);
        try {
          await this.runtime.deleteMemory(stateId);
          this.runtime.logger.debug(`[SpiderState] Delete successful`);
        } catch (deleteError: any) {
          this.runtime.logger.debug(`[SpiderState] Delete error: ${deleteError?.message || deleteError}`);
        }
      }

      // Ensure the world, room, entity, and connection exist before saving
      // This is required because the memories table has foreign key constraints
      // on roomId and entityId
      let serverId: string | undefined;
      let worldId: UUID;
      let channelName = state.channelId;

      // Try to get channel info from Discord to get serverId
      try {
        if (this.client?.isReady()) {
          const channel = await this.client.channels.fetch(state.channelId);
          if (channel && 'guild' in channel && channel.guild) {
            serverId = channel.guild.id;
            channelName = 'name' in channel ? (channel.name ?? state.channelId) : state.channelId;
          }
        }
      } catch {
        // If we can't fetch the channel, use a default serverId
      }

      // Create worldId based on serverId or channelId
      worldId = createUniqueUuid(this.runtime, serverId ?? state.channelId);

      // Ensure the entity exists (use agent as entity for spider state)
      const entityId = this.runtime.agentId;
      try {
        const entity = await this.runtime.getEntityById(entityId);
        if (!entity) {
          // Create the entity for the agent
          await this.runtime.createEntity({
            id: entityId,
            names: ['Spider'],
            agentId: this.runtime.agentId,
            metadata: { source: 'discord-spider' },
          });
          this.runtime.logger.debug(`[SpiderState] Created entity for agent`);
        }
      } catch (entityError: any) {
        // Entity might already exist (duplicate key), which is fine
        if (!entityError?.message?.includes('duplicate key')) {
          this.runtime.logger.debug(`[SpiderState] Entity ensure error: ${entityError?.message || entityError}`);
        }
      }

      // Ensure world exists
      try {
        await this.runtime.ensureWorldExists({
          id: worldId,
          name: serverId ? `Discord Server ${serverId}` : `Spider World ${state.channelId}`,
          agentId: this.runtime.agentId,
          serverId: serverId ?? state.channelId,
        });
        this.runtime.logger.debug(`[SpiderState] World ensured: ${worldId}`);
      } catch (worldError: any) {
        this.runtime.logger.debug(`[SpiderState] World ensure error: ${worldError?.message || worldError}`);
      }

      // Ensure room exists
      try {
        await this.runtime.ensureRoomExists({
          id: roomId,
          name: channelName,
          source: 'discord',
          type: ChannelType.GROUP,
          channelId: state.channelId,
          serverId: serverId ?? state.channelId,
          worldId,
        });
        this.runtime.logger.debug(`[SpiderState] Room ensured: ${roomId}`);
      } catch (roomError: any) {
        this.runtime.logger.debug(`[SpiderState] Room ensure error: ${roomError?.message || roomError}`);
      }

      // Ensure participant (connection) exists
      try {
        await this.runtime.ensureParticipantInRoom(entityId, roomId);
        this.runtime.logger.debug(`[SpiderState] Participant ensured in room`);
      } catch (participantError: any) {
        // Try addParticipant as fallback
        try {
          await this.runtime.addParticipant(entityId, roomId);
          this.runtime.logger.debug(`[SpiderState] Participant added to room`);
        } catch {
          this.runtime.logger.debug(`[SpiderState] Participant ensure error: ${participantError?.message || participantError}`);
        }
      }

      // Create the state memory
      const stateMemory: Memory = {
        id: stateId,
        agentId: this.runtime.agentId,
        entityId,
        roomId,
        content: {
          text: JSON.stringify(state),
          source: 'discord-spider',
        },
        metadata: {
          type: MemoryType.CUSTOM,
          source: 'discord-spider-state',
          channelId: state.channelId,
          fullyBackfilled: state.fullyBackfilled,
        } as any,
        createdAt: Date.now(),
      };

      // Store in the database
      this.runtime.logger.debug(`[SpiderState] Inserting new state`);
      await this.runtime.createMemory(stateMemory, MemoryType.CUSTOM);

      this.runtime.logger.debug(`[SpiderState] Save successful for channel ${state.channelId}`);
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      // Extract the underlying cause from DrizzleQueryError
      const causeMsg = error?.cause?.message || error?.cause || '';
      const causeCode = error?.cause?.code || '';
      const causeDetail = error?.cause?.detail || '';

      // Check if this is a duplicate key error
      if (errorMsg.includes('duplicate key') || errorMsg.includes('unique constraint') ||
        String(causeMsg).includes('duplicate key') || String(causeMsg).includes('unique constraint')) {
        this.runtime.logger.debug(`[SpiderState] Duplicate key - state already saved by another operation`);
      } else {
        this.runtime.logger.warn({
          src: 'plugin:discord',
          agentId: this.runtime.agentId,
          error: errorMsg,
          cause: String(causeMsg),
          causeCode,
          causeDetail,
          channelId: state.channelId,
        }, 'Failed to save spider state to database');
      }
    }
  }

  /**
   * Fetches message history from a Discord channel.
   * Supports pagination, state tracking, and streaming via callback.
   * 
   * @param {string} channelId - The Discord channel ID to fetch from
   * @param {ChannelHistoryOptions} options - Options for the fetch operation
   * @returns {Promise<ChannelHistoryResult>} The result with messages and stats
   */
  public async fetchChannelHistory(
    channelId: string,
    options: ChannelHistoryOptions = {}
  ): Promise<ChannelHistoryResult> {
    if (!this.client?.isReady()) {
      this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId }, 'Discord client not ready for history fetch');
      return {
        messages: [],
        stats: { fetched: 0, stored: 0, pages: 0, fullyBackfilled: false },
      };
    }

    // Fetch the channel
    const fetchedChannel = await this.client.channels.fetch(channelId);
    if (!this.isGuildTextBasedChannel(fetchedChannel)) {
      this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId, channelType: fetchedChannel?.type ?? null }, 'Channel is not a guild text-based channel');
      return {
        messages: [],
        stats: { fetched: 0, stored: 0, pages: 0, fullyBackfilled: false },
      };
    }

    const channel = fetchedChannel as GuildTextBasedChannel;
    const serverId =
      'guild' in channel && channel.guild
        ? channel.guild.id
        : 'guildId' in channel && channel.guildId
          ? channel.guildId
          : channel.id;
    const worldId = serverId ? createUniqueUuid(this.runtime, serverId) : this.runtime.agentId;

    // Ensure world and room exist
    await this.runtime.ensureWorldExists({
      id: worldId,
      agentId: this.runtime.agentId,
      serverId,
      name: ('guild' in channel && channel.guild?.name) || 'Discord',
    });

    await this.runtime.ensureRoomExists({
      id: createUniqueUuid(this.runtime, channel.id),
      agentId: this.runtime.agentId,
      name: ('name' in channel && channel.name) || channel.id,
      source: 'discord',
      type: await this.getChannelType(channel as unknown as Channel),
      channelId: channel.id,
      serverId,
      worldId,
    });

    // Load spider state
    let spiderState = options.force ? null : await this.getSpiderState(channelId);
    const channelName = ('name' in channel && channel.name) || channelId;

    let consecutiveNoNew = 0;
    let totalStored = 0;
    let totalFetched = 0;
    let pagesProcessed = 0;
    const allMessages: Memory[] = [];
    const startTime = Date.now();

    // Initialize from spider state if available, otherwise from options
    let oldestMessageId: string | undefined = spiderState?.oldestMessageId ?? options.before;
    let newestMessageId: string | undefined = spiderState?.newestMessageId ?? options.after;
    let oldestMessageTimestamp: number | undefined = spiderState?.oldestMessageTimestamp;
    let newestMessageTimestamp: number | undefined = spiderState?.newestMessageTimestamp;
    let reachedEnd = false;

    // Phase 1: If we have previous state, first catch up on new messages (forward)
    // This ensures we don't miss messages that arrived while spider was stopped
    if (!options.force && spiderState && spiderState.newestMessageId) {
      const lastDate = spiderState.newestMessageTimestamp
        ? new Date(spiderState.newestMessageTimestamp).toISOString().split('T')[0]
        : 'unknown';
      this.runtime.logger.info(`#${channelName}: Catching up on new messages since ${lastDate}`);

      let catchUpAfter: string | undefined = spiderState.newestMessageId;
      let catchUpPages = 0;

      while (catchUpAfter) {
        catchUpPages++;
        const batch = await channel.messages.fetch({ limit: 100, after: catchUpAfter });
        if (batch.size === 0) break;

        const messages = Array.from(batch.values() as IterableIterator<Message>).sort(
          (a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0)
        );
        totalFetched += messages.length;
        pagesProcessed++;

        // Update newest tracking
        if (messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          const lastTimestamp = lastMsg.createdTimestamp ?? 0;
          if (!newestMessageTimestamp || lastTimestamp > newestMessageTimestamp) {
            newestMessageId = lastMsg.id;
            newestMessageTimestamp = lastTimestamp;
          }
        }

        // Build and process memories, tracking new vs existing
        let catchUpNewCount = 0;
        let catchUpExistingCount = 0;
        const catchUpBatchMemories: Memory[] = [];

        for (const discordMessage of messages) {
          const memory = await this.buildMemoryFromMessage(discordMessage);
          if (memory && memory.id) {
            // Check if this memory already exists
            try {
              const existing = await this.runtime.getMemoryById(memory.id);
              if (existing) {
                catchUpExistingCount++;
              } else {
                catchUpNewCount++;
                catchUpBatchMemories.push(memory);
              }
            } catch {
              // If getMemoryById fails, assume it's new
              catchUpNewCount++;
              catchUpBatchMemories.push(memory);
            }
          }
        }

        // Process batch via callback or accumulate (consistent with Phase 3)
        if (options.onBatch && catchUpBatchMemories.length > 0) {
          await options.onBatch(catchUpBatchMemories, {
            page: pagesProcessed,
            totalFetched,
            totalStored: totalStored + catchUpBatchMemories.length,
          });
        } else {
          allMessages.push(...catchUpBatchMemories);
        }

        totalStored += catchUpBatchMemories.length;

        // Determine HIT (all existed) or MISS (had new messages)
        const catchUpHitMiss = catchUpExistingCount > 0 && catchUpNewCount === 0 ? 'HIT' : catchUpNewCount > 0 ? 'MISS' : 'EMPTY';

        // Save progress
        await this.saveSpiderState({
          channelId,
          oldestMessageId,
          newestMessageId,
          oldestMessageTimestamp,
          newestMessageTimestamp,
          lastSpideredAt: Date.now(),
          fullyBackfilled: spiderState.fullyBackfilled,
        });

        // Debug log for each catch-up page
        const newestDate = newestMessageTimestamp
          ? new Date(newestMessageTimestamp).toISOString().split('T')[0]
          : '?';
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        this.runtime.logger.debug(
          `#${channelName}: Catch-up page ${catchUpPages} [${catchUpHitMiss}], ${messages.length} msgs fetched (${catchUpNewCount} new, ${catchUpExistingCount} existing), ${totalFetched} total fetched, ${totalStored} total stored, newest date ${newestDate} (${elapsedSec}s)`
        );

        if (batch.size < 100) break;
        catchUpAfter = batch.first()?.id; // newest message for forward pagination
        await this.delay(250);
      }

      if (catchUpPages > 0) {
        this.runtime.logger.info(`#${channelName}: Caught up ${catchUpPages} pages of new messages`);
      }
    }

    // Phase 2: Determine backfill direction
    let before: string | undefined = options.before;
    let after: string | undefined = options.after;

    if (!options.force && spiderState) {
      if (spiderState.fullyBackfilled) {
        // Already caught up above, we're done with fetching
        reachedEnd = true;
      } else {
        // Continue backfilling from where we left off
        before = spiderState.oldestMessageId;
        const oldestDate = spiderState.oldestMessageTimestamp
          ? new Date(spiderState.oldestMessageTimestamp).toISOString().split('T')[0]
          : 'unknown';
        this.runtime.logger.info(`#${channelName}: Resuming backfill from ${oldestDate}`);
      }
    } else if (!spiderState) {
      this.runtime.logger.info(`#${channelName}: Starting fresh history fetch`);
    }

    // Phase 3: Backfill older messages (skip if already fully backfilled)
    while (!reachedEnd) {
      pagesProcessed += 1;
      const fetchParams: Record<string, any> = { limit: 100 };

      if (after) {
        fetchParams.after = after;
      } else if (before) {
        fetchParams.before = before;
      }

      const batch = await channel.messages.fetch(fetchParams);
      if (batch.size === 0) {
        reachedEnd = true;
        break;
      }

      const messages = Array.from(batch.values()).sort(
        (a, b) => (a.createdTimestamp ?? 0) - (b.createdTimestamp ?? 0)
      );
      totalFetched += messages.length;

      // Track oldest and newest messages by comparing timestamps
      if (messages.length > 0) {
        const firstMsg = messages[0];
        const lastMsg = messages[messages.length - 1];
        const firstTimestamp = firstMsg.createdTimestamp ?? 0;
        const lastTimestamp = lastMsg.createdTimestamp ?? 0;

        // Update oldest message if this is older than what we have
        if (!oldestMessageTimestamp || firstTimestamp < oldestMessageTimestamp) {
          oldestMessageId = firstMsg.id;
          oldestMessageTimestamp = firstTimestamp;
        }

        // Update newest message if this is newer than what we have
        if (!newestMessageTimestamp || lastTimestamp > newestMessageTimestamp) {
          newestMessageId = lastMsg.id;
          newestMessageTimestamp = lastTimestamp;
        }
      }

      // Build memories for this batch and check if they already exist
      const batchMemories: Memory[] = [];
      let newCount = 0;
      let existingCount = 0;

      for (const discordMessage of messages) {
        const memory = await this.buildMemoryFromMessage(discordMessage);
        if (memory && memory.id) {
          // Check if this memory already exists
          try {
            const existing = await this.runtime.getMemoryById(memory.id);
            if (existing) {
              existingCount++;
            } else {
              newCount++;
              batchMemories.push(memory);
            }
          } catch {
            // If getMemoryById fails, assume it's new
            newCount++;
            batchMemories.push(memory);
          }
        }
      }

      // Determine HIT (all existed) or MISS (had new messages)
      const hitMiss = existingCount > 0 && newCount === 0 ? 'HIT' : newCount > 0 ? 'MISS' : 'EMPTY';

      // Process batch via callback or accumulate
      if (options.onBatch) {
        const shouldContinue = await options.onBatch(batchMemories, {
          page: pagesProcessed,
          totalFetched,
          totalStored: totalStored + batchMemories.length,
        });

        if (shouldContinue === false) {
          this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId, page: pagesProcessed }, 'Batch handler requested early stop');
          break;
        }
      } else {
        allMessages.push(...batchMemories);
      }

      totalStored += batchMemories.length;
      consecutiveNoNew = batchMemories.length === 0 ? consecutiveNoNew + 1 : 0;

      // Save state after every page so we can resume if interrupted
      const incrementalState: ChannelSpiderState = {
        channelId,
        oldestMessageId,
        newestMessageId,
        oldestMessageTimestamp,
        newestMessageTimestamp,
        lastSpideredAt: Date.now(),
        fullyBackfilled: false, // Not complete yet, still in progress
      };
      await this.saveSpiderState(incrementalState);

      // Debug log for each page
      const oldestDate = oldestMessageTimestamp
        ? new Date(oldestMessageTimestamp).toISOString().split('T')[0]
        : '?';
      const newestDate = newestMessageTimestamp
        ? new Date(newestMessageTimestamp).toISOString().split('T')[0]
        : '?';
      const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
      this.runtime.logger.debug(
        `#${channelName}: Page ${pagesProcessed} [${hitMiss}], ${messages.length} msgs fetched (${newCount} new, ${existingCount} existing), ${batchMemories.length} stored, ${totalFetched} total fetched, ${totalStored} total stored, dates ${oldestDate} to ${newestDate} (${elapsedSec}s)`
      );

      // Log progress every 10 pages (1000 messages) or on first page at info level
      if (pagesProcessed === 1 || pagesProcessed % 10 === 0) {
        this.runtime.logger.info(
          `#${channelName}: Page ${pagesProcessed}, ${totalFetched} msgs fetched, ${totalStored} stored, dates ${oldestDate} to ${newestDate} (${elapsedSec}s)`
        );
      }

      this.runtime.logger.debug({
        src: 'plugin:discord',
        agentId: this.runtime.agentId,
        channelId,
        batchSize: batch.size,
        storedThisBatch: batchMemories.length,
        totalStored,
        totalFetched,
        page: pagesProcessed,
      }, 'Processed channel history batch');

      // Check stop conditions
      if (options.limit && totalFetched >= options.limit) {
        this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId, limit: options.limit }, 'Reached fetch limit');
        break;
      }

      if (batch.size < 100 || consecutiveNoNew >= 3) {
        reachedEnd = true;
        break;
      }

      // Update pagination cursor
      // Discord.js Collections are ordered newest-first:
      // - batch.first() = newest message
      // - batch.last() = oldest message
      if (after) {
        // Forward pagination: get messages after (newer than) the newest message
        after = batch.first()?.id;
      } else {
        // Backward pagination: get messages before (older than) the oldest message
        before = batch.last()?.id;
      }

      // Rate limiting
      await this.delay(250);
    }

    // Update spider state
    const newState: ChannelSpiderState = {
      channelId,
      oldestMessageId,
      newestMessageId,
      oldestMessageTimestamp,
      newestMessageTimestamp,
      lastSpideredAt: Date.now(),
      // Preserve fullyBackfilled if already true, or mark as backfilled if we reached the end going backwards
      fullyBackfilled: spiderState?.fullyBackfilled || (reachedEnd && !after),
    };
    await this.saveSpiderState(newState);

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const dateRange = oldestMessageTimestamp && newestMessageTimestamp
      ? `${new Date(oldestMessageTimestamp).toISOString().split('T')[0]} to ${new Date(newestMessageTimestamp).toISOString().split('T')[0]}`
      : 'no messages';
    const status = newState.fullyBackfilled ? '✓ complete' : '↻ partial';
    this.runtime.logger.info(
      `#${channelName}: ${status} - ${totalFetched} msgs, ${pagesProcessed} pages, ${dateRange} (${elapsedSec}s)`
    );

    return {
      messages: allMessages,
      stats: {
        fetched: totalFetched,
        stored: totalStored,
        pages: pagesProcessed,
        fullyBackfilled: newState.fullyBackfilled,
      },
    };
  }

  /**
   * Builds a Memory object from a Discord Message.
   * This is a reusable helper for converting Discord messages to ElizaOS Memory format.
   * 
   * @param {Message} message - The Discord message to convert
   * @param {Object} options - Optional parameters
   * @param {string} options.processedContent - Pre-processed text content (if already processed, to avoid double-processing)
   * @param {Media[]} options.processedAttachments - Pre-processed attachments (if already processed)
   * @param {Object} options.extraContent - Additional content fields to merge into the memory content
   * @param {Object} options.extraMetadata - Additional metadata fields to merge into the memory metadata
   * @returns {Promise<Memory | null>} The Memory object, or null if the message is invalid
   */
  public async buildMemoryFromMessage(
    message: Message,
    options?: {
      processedContent?: string;
      processedAttachments?: Media[];
      extraContent?: Record<string, any>;
      extraMetadata?: Record<string, any>;
    }
  ): Promise<Memory | null> {
    if (!message.author || !message.channel) {
      return null;
    }

    const entityId = createUniqueUuid(this.runtime, message.author.id);
    const roomId = createUniqueUuid(this.runtime, message.channel.id);
    const channel = message.channel;
    const channelType = await this.getChannelType(channel as Channel);
    const serverId = ('guild' in channel && channel.guild)
      ? channel.guild.id
      : message.guild?.id ?? message.channel.id;
    const worldId = serverId ? createUniqueUuid(this.runtime, serverId) : this.runtime.agentId;

    // Use pre-processed content if provided, otherwise process now
    let textContent: string;
    let attachments: Media[];

    if (options?.processedContent !== undefined || options?.processedAttachments !== undefined) {
      textContent = options.processedContent || ' ';
      attachments = options.processedAttachments || [];
    } else {
      const processed = this.messageManager
        ? await this.messageManager.processMessage(message)
        : { processedContent: message.content, attachments: [] };

      textContent =
        processed?.processedContent && processed.processedContent.trim().length > 0
          ? processed.processedContent
          : message.content || ' ';
      attachments = processed?.attachments ?? [];
    }

    const metadata = {
      type: 'message' as const,
      entityName:
        (message.member as any)?.displayName ??
        (message.author as any).globalName ??
        message.author.username,
      fromBot: message.author.bot,
      fromId: message.author.id,
      sourceId: entityId,
      tags: [] as string[],
      ...options?.extraMetadata,
    };

    const memory: Memory = {
      id: createUniqueUuid(this.runtime, message.id),
      entityId,
      agentId: this.runtime.agentId,
      roomId,
      content: {
        text: textContent || ' ',
        attachments,
        source: 'discord',
        channelType,
        url: message.url,
        inReplyTo: message.reference?.messageId
          ? createUniqueUuid(this.runtime, message.reference.messageId)
          : undefined,
        ...options?.extraContent,
      },
      metadata,
      createdAt: message.createdTimestamp ?? Date.now(),
      worldId,
    };

    return memory;
  }

  /**
   * Stops the Discord service and cleans up resources.
   * Implements the abstract method from the Service class.
   */
  public async stop(): Promise<void> {
    this.runtime.logger.info('Stopping Discord service');
    this.timeouts.forEach(clearTimeout); // Clear any pending timeouts
    this.timeouts = [];
    if (this.client) {
      await this.client.destroy();
      this.client = null;
      this.runtime.logger.info('Discord client destroyed');
    }
    // Additional cleanup if needed (e.g., voice manager)
    if (this.voiceManager) {
      // Assuming voiceManager has a stop or cleanup method
      // await this.voiceManager.stop();
    }
    this.runtime.logger.info('Discord service stopped');
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
        this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, channelType: channel.type }, 'Unknown channel type, defaulting to GROUP');
        return ChannelType.GROUP;
    }
  }
}

export default DiscordService;
