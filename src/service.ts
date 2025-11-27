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
import { DiscordEventTypes, type IDiscordService, type DiscordSettings, type DiscordSlashCommand } from './types';
import { getAttachmentFileName } from './utils';
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
      this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Discord API Token not provided');
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
            this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error in onReady');
            reject(error);
          }
        });
        // Handle client errors that might prevent ready event
        client.once(Events.Error, (error) => {
          this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Discord client error');
          reject(error);
        });
        // now start login
        client.login(token).catch((error) => {
          this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Failed to login to Discord');
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
      runtime.logger.error({ src: 'plugin:discord', agentId: runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error initializing Discord client');
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
      runtime.logger.error({ src: 'plugin:discord', agentId: runtime.agentId }, 'Client not ready');
      throw new Error('Discord client is not ready.');
    }

    // Skip sending if channel restrictions are set and target channel is not allowed
    if (target.channelId && this.allowedChannelIds && !this.isChannelAllowed(target.channelId)) {
      runtime.logger.warn({ src: 'plugin:discord', agentId: runtime.agentId, channelId: target.channelId }, 'Channel not in allowed list, skipping send');
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
          // user.dmChannel is a property (DMChannel | null), not a promise
          targetChannel = user.dmChannel ?? (await user.createDM());
        }
      } else {
        throw new Error('Discord SendHandler requires channelId or entityId.');
      }

      if (!targetChannel) {
        // Safely serialize target for error message (target only contains strings, but be defensive)
        const targetStr = JSON.stringify(target, (_key, value) => {
          // Convert BigInt to string if somehow present
          if (typeof value === 'bigint') {
            return value.toString();
          }
          return value;
        });
        throw new Error(
          `Could not find target Discord channel/DM for target: ${targetStr}`
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

          // Send message with text and/or attachments
          if (content.text || files.length > 0) {
            if (content.text) {
              // Split message if longer than Discord limit (2000 chars)
              const chunks = this.splitMessage(content.text, 2000);
              if (chunks.length > 1) {
                // Send all chunks except the last one without files
                for (let i = 0; i < chunks.length - 1; i++) {
                  await targetChannel.send(chunks[i]);
                }
                // Send the last chunk with files (if any)
                await targetChannel.send({
                  content: chunks[chunks.length - 1],
                  files: files.length > 0 ? files : undefined,
                });
              } else {
                // Single chunk - send with files (if any)
                await targetChannel.send({
                  content: chunks[0],
                  files: files.length > 0 ? files : undefined,
                });
              }
            } else {
              // Only attachments, no text
              await targetChannel.send({
                files: files,
              });
            }
          } else {
            runtime.logger.warn({ src: 'plugin:discord', agentId: runtime.agentId }, 'No text content or attachments provided');
          }

          // FIXME: probably should return all message.ids
          // FIXME: probably should save to memory
        } else {
          throw new Error(`Target channel ${targetChannel.id} does not have a send method.`);
        }
      } else {
        throw new Error(
          `Target channel ${targetChannel.id} is not a valid text-based channel for sending messages.`
        );
      }
    } catch (error) {
      runtime.logger.error({ src: 'plugin:discord', agentId: runtime.agentId, target, error: error instanceof Error ? error.message : String(error) }, 'Error sending message');
      throw error;
    }
  }


  /**
   * Helper function to split a string into chunks of a maximum length.
   *
   * @param {string} text - The text to split.
   * @param {number} maxLength - The maximum length of each chunk.
   * @returns {string[]} An array of text chunks.
   * @private
   */
  // Helper to split messages
  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let currentChunk = '';
    const lines = text.split('\n');
    for (const line of lines) {
      if (currentChunk.length + line.length + 1 <= maxLength) {
        currentChunk += (currentChunk ? '\n' : '') + line;
      } else {
        if (currentChunk) chunks.push(currentChunk);
        // Handle lines longer than the max length (split them)
        if (line.length > maxLength) {
          for (let i = 0; i < line.length; i += maxLength) {
            chunks.push(line.substring(i, i + maxLength));
          }
          currentChunk = ''; // Reset chunk after splitting long line
        } else {
          currentChunk = line;
        }
      }
    }
    if (currentChunk) chunks.push(currentChunk);
    return chunks;
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
        const entityId = createUniqueUuid(this.runtime, message.author.id);
        const roomId = createUniqueUuid(this.runtime, message.channel.id);

        // can't be null
        let type: ChannelType;

        if (message.guild) {
          //const guild = await message.guild.fetch();
          type = await this.getChannelType(message.channel as Channel);
          if (type === null) {
            // usually a forum type post
            this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId: message.channel.id }, 'Null channel type');
          }
        } else {
          type = ChannelType.DM;
        }

        // is this needed? just track who's in what room
        /*
        await this.runtime.ensureConnection({
          entityId,
          roomId,
          userName,
          name: name,
          source: 'discord',
          channelId: message.channel.id,
          serverId,
          type,
          worldId: createUniqueUuid(this.runtime, serverId ?? roomId) as UUID,
          worldName: message.guild?.name,
        });
        */

        // only we just need to remember these messages
        const res = await this.messageManager!.processMessage(message);
        // { processedContent, attachments }
        let processedContent
        let attachments: Media[] = []
        if (res) {
          processedContent = res.processedContent
          attachments = res.attachments
        }

        const messageId = createUniqueUuid(this.runtime, message.id);
        const sourceId = entityId; // needs to be based on message.author.id

        const userName = message.author.bot
          ? `${message.author.username}#${message.author.discriminator}`
          : message.author.username;
        const name =
          message.member?.displayName ??
          message.author.displayName ??
          message.author.globalName ??
          userName;

        const newMessage: Memory = {
          id: messageId,
          entityId: entityId,
          agentId: this.runtime.agentId,
          roomId: roomId,
          content: {
            // name: name,
            // userName: userName,
            text: processedContent || ' ',
            attachments: attachments,
            source: 'discord',
            channelType: type,
            url: message.url,
            inReplyTo: message.reference?.messageId
              ? createUniqueUuid(this.runtime, message.reference?.messageId)
              : undefined,
          },
          // metadata of memory
          metadata: {
            entityName: name,
            fromBot: message.author.bot,
            // include very technical/exact reference to this user for security reasons
            // don't remove or change this, spartan needs this
            fromId: message.author.id,
            // do we need to duplicate this, we have it in content
            // source: "discord",
            sourceId,
            // why message? all Memories contain content (which is basically a message)
            // what are the other types? see MemoryType
            type: 'message', // MemoryType.MESSAGE
            // scope: `shared`, `private`, or `room
            // timestamp
            // tags
          },
          createdAt: message.createdTimestamp,
        };

        // and then you can handle these anyway you want
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
    this.client.on('interactionCreate', async (interaction) => {
      const isSlashCommand = interaction.isCommand();
      const bypassChannelRestriction =
        isSlashCommand && this.allowAllSlashCommands.has(interaction.commandName ?? '');

      this.runtime.logger.debug(
        {
          src: 'plugin:discord',
          agentId: this.runtime.agentId,
          interactionType: interaction.type,
          commandName: isSlashCommand ? interaction.commandName : undefined,
          channelId: interaction.channelId,
          inGuild: interaction.inGuild(),
          bypassChannelRestriction,
        },
        '[DiscordService] interactionCreate received'
      );

      // ElizaOS Channel Whitelist Check
      // Skip if channel restrictions are set and this interaction is not in an allowed channel
      // unless the command is configured to bypass restrictions.
      if (
        this.allowedChannelIds &&
        interaction.channelId &&
        !this.isChannelAllowed(interaction.channelId) &&
        !bypassChannelRestriction
      ) {
        this.runtime.logger.debug(
          {
            src: 'plugin:discord',
            agentId: this.runtime.agentId,
            channelId: interaction.channelId,
            allowedChannelIds: this.allowedChannelIds,
            isSlashCommand,
            bypassChannelRestriction,
          },
          '[DiscordService] interactionCreate ignored (channel not allowed)'
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
        const command = this.slashCommands.find((cmd) => cmd.name === interaction.commandName);
        if (command?.validator) {
          try {
            const isValid = await command.validator(interaction, this.runtime);
            if (!isValid) {
              this.runtime.logger.debug(
                { src: 'plugin:discord', agentId: this.runtime.agentId, commandName: interaction.commandName },
                '[DiscordService] interactionCreate ignored (custom validator returned false)'
              );
              return;
            }
          } catch (error) {
            this.runtime.logger.error(
              { src: 'plugin:discord', agentId: this.runtime.agentId, commandName: interaction.commandName, error: error instanceof Error ? error.message : String(error) },
              '[DiscordService] Custom validator threw error'
            );
            return;
          }
        }
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
   * @param {GuildMember} member - The GuildMember object representing the new member that joined the guild.
   * @returns {Promise<void>} - A Promise that resolves once the event handling is complete.
   * @private
   */
  private async handleGuildMemberAdd(member: GuildMember) {
    this.runtime.logger.info({ src: 'plugin:discord', agentId: this.runtime.agentId, memberId: member.id, username: member.user.username }, 'New member joined');

    const guild = member.guild;

    const tag = member.user.bot
      ? `${member.user.username}#${member.user.discriminator}`
      : member.user.username;

    const worldId = createUniqueUuid(this.runtime, guild.id);
    const entityId = createUniqueUuid(this.runtime, member.id);

    // Emit standardized ENTITY_JOINED event
    this.runtime.emitEvent([EventType.ENTITY_JOINED], {
      runtime: this.runtime,
      entityId,
      worldId,
      source: 'discord',
      metadata: {
        originalId: member.id,
        username: tag,
        displayName: member.displayName || member.user.username,
        roles: member.roles.cache.map((r) => r.name),
        joinedAt: member.joinedAt?.getTime(),
      },
    });

    // Emit Discord-specific event
    this.runtime.emitEvent([DiscordEventTypes.ENTITY_JOINED], {
      runtime: this.runtime,
      entityId,
      worldId,
      member,
    });
  }

  /**
   * Handles the event when the bot joins a guild. It logs the guild name, fetches additional information about the guild, scans the guild for voice data, creates standardized world data structure, generates unique IDs, and emits events to the runtime.
   * @param {Guild} guild - The guild that the bot has joined.
   * @returns {Promise<void>} A promise that resolves when the guild creation is handled.
   * @private
   */
  private async handleGuildCreate(guild: Guild) {
    this.runtime.logger.info({ src: 'plugin:discord', agentId: this.runtime.agentId, guildId: guild.id, guildName: guild.name }, 'Joined guild');
    const fullGuild = await guild.fetch();
    // Disabled automatic voice joining - now controlled by joinVoiceChannel action
    // this.voiceManager?.scanGuild(guild);

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
      this.runtime.logger.debug(
        {
          src: 'plugin:discord',
          agentId: this.runtime.agentId,
          commandName: interaction.commandName,
          type: interaction.commandType,
          channelId: interaction.channelId,
          inGuild: interaction.inGuild(),
        },
        '[DiscordService] Slash command received'
      );

      try {
        // can't interaction.deferReply if we want to allow custom apps (showModal)
        this.runtime.emitEvent([DiscordEventTypes.SLASH_COMMAND], {
          interaction,
          client: this.client,
          commands: this.slashCommands,
        });
        this.runtime.logger.debug(
          { src: 'plugin:discord', agentId: this.runtime.agentId, commandName: interaction.commandName },
          '[DiscordService] Slash command emitted to runtime'
        );
      } catch (error) {
        this.runtime.logger.error(
          {
            src: 'plugin:discord',
            agentId: this.runtime.agentId,
            commandName: interaction.commandName,
            error: error instanceof Error ? error.message : String(error),
          },
          '[DiscordService] Failed to emit slash command'
        );
        throw error;
      }
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
    this.runtime.logger.success({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Discord client ready');

    // Initialize slash commands array (empty initially - commands registered via DISCORD_REGISTER_COMMANDS)
    // Note: We do NOT register an empty array here to avoid clearing existing commands
    // Commands will be registered when DISCORD_REGISTER_COMMANDS event is emitted
    this.slashCommands = [];

    /**
     * DISCORD_REGISTER_COMMANDS event handler
     * 
     * Registers slash commands with Discord using a hybrid permission system that combines:
     * 1. Discord's native permission features (default_member_permissions, contexts)
     * 2. ElizaOS channel whitelist bypass (bypassChannelWhitelist flag)
     * 3. Custom validation functions (validator callback)
     * 
     * ## Design Decisions:
     * 
     * ### Why Hybrid Approach?
     * - Discord's native permissions are powerful but limited to role-based access
     * - ElizaOS needs programmatic control for channel restrictions and custom logic
     * - Combining both gives developers the best of both worlds
     * 
     * ### Why Transform Simple Flags?
     * - Developer experience: `guildOnly: true` is clearer than `contexts: [0]`
     * - Abstraction: Shields developers from Discord API changes
     * - Sensible defaults: Zero config should "just work"
     * 
     * ### Why Keep allowAllChannels Map? (Backward Compatibility)
     * - Existing code uses this pattern
     * - Deprecated but still functional
     * - Prefer `bypassChannelWhitelist` on command object instead
     * 
     * ### Why Global vs Guild-Specific Registration?
     * - Global commands: Appear in all servers, 1-hour propagation delay
     * - Guild-specific: Instant updates, useful for testing/server-specific features
     * - Most commands should be global for consistency
     * 
     * @param params.commands - Array of commands to register
     * @param params.allowAllChannels - (Deprecated) Map of command names to bypass flags
     */
    // Helper function to sanitize commands for logging (converts BigInt to string)
    const sanitizeCommandForLogging = (cmd: DiscordSlashCommand): any => {
      const sanitized: any = {
        name: cmd.name,
        description: cmd.description,
        options: cmd.options,
        contexts: cmd.contexts,
        guildOnly: cmd.guildOnly,
        bypassChannelWhitelist: cmd.bypassChannelWhitelist,
        validator: cmd.validator ? '[Function]' : undefined,
      };

      // Convert BigInt requiredPermissions to string for JSON safety
      if (cmd.requiredPermissions !== undefined) {
        sanitized.requiredPermissions = typeof cmd.requiredPermissions === 'bigint'
          ? cmd.requiredPermissions.toString()
          : cmd.requiredPermissions;
      }

      // Include guildIds if present
      if (cmd.guildIds) {
        sanitized.guildIds = cmd.guildIds;
      }

      return sanitized;
    };

    this.runtime.registerEvent('DISCORD_REGISTER_COMMANDS', async (params: { commands: DiscordSlashCommand[]; allowAllChannels?: Record<string, boolean> }) => {
      // Wait for the client to be ready before processing
      await this.clientReadyPromise;

      // Sanitize commands for logging to handle BigInt values
      const sanitizedCommands = params.commands.map(sanitizeCommandForLogging);
      this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, commandCount: params.commands.length, commands: sanitizedCommands }, 'Registering Discord commands');
      if (!this.client?.application) {
        this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Cannot register commands - no app');
        return;
      }
      const commands: DiscordSlashCommand[] = params.commands;
      if (!Array.isArray(commands) || commands.length === 0) {
        this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Cannot register commands - no commands provided');
        return;
      }

      // Validate all commands
      for (const cmd of commands) {
        if (!cmd.name || !cmd.description) {
          this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, command: sanitizeCommandForLogging(cmd) }, 'Cannot register commands - invalid command');
          return;
        }
      }

      // Handle allowAllChannels flags (backward compatibility)
      // Only update bypass status for commands explicitly mentioned in allowAllChannelsMap
      // This prevents accidentally removing bypass status when a command is registered
      // without the flag (e.g., by a different plugin or in a different batch)
      const allowAllChannelsMap = params.allowAllChannels ?? {};
      for (const [commandName, shouldBypass] of Object.entries(allowAllChannelsMap)) {
        if (shouldBypass) {
          this.allowAllSlashCommands.add(commandName);
          this.runtime.logger.debug(
            { src: 'plugin:discord', agentId: this.runtime.agentId, commandName },
            '[DiscordService] Command registered with allowAllChannels bypass (deprecated)'
          );
        } else {
          // Explicitly set to false - remove from bypass set
          this.allowAllSlashCommands.delete(commandName);
          this.runtime.logger.debug(
            { src: 'plugin:discord', agentId: this.runtime.agentId, commandName },
            '[DiscordService] Command removed from allowAllChannels bypass'
          );
        }
      }

      // Handle bypassChannelWhitelist from commands directly (preferred method)
      // This is the new, cleaner API - command definitions include their own permissions
      for (const cmd of commands) {
        if (cmd.bypassChannelWhitelist) {
          this.allowAllSlashCommands.add(cmd.name);
          this.runtime.logger.debug(
            { src: 'plugin:discord', agentId: this.runtime.agentId, commandName: cmd.name },
            '[DiscordService] Command registered with bypassChannelWhitelist'
          );
        } else if (cmd.bypassChannelWhitelist === false) {
          // Explicitly set to false - remove from bypass set
          // This allows commands to be re-registered without the bypass flag
          this.allowAllSlashCommands.delete(cmd.name);
          this.runtime.logger.debug(
            { src: 'plugin:discord', agentId: this.runtime.agentId, commandName: cmd.name },
            '[DiscordService] Command removed from bypassChannelWhitelist'
          );
        }
      }

      // Queue this registration to prevent race conditions
      // Each registration waits for the previous one to complete
      let registrationError: Error | null = null;
      let registrationFailed = false;

      // Helper function to transform ElizaOS command format to Discord API format
      // This bridges our developer-friendly API with Discord's native requirements
      const transformCommand = (cmd: DiscordSlashCommand): any => {
        const discordCmd: any = {
          name: cmd.name,
          description: cmd.description,
          options: cmd.options,
        };

        // Transform contexts and guildOnly to Discord's contexts array
        // Note: contexts overrides guildOnly if provided (as documented)
        // Discord contexts: 0=Guild, 1=BotDM, 2=PrivateChannel
        if (cmd.contexts) {
          // Allow raw contexts for advanced use cases - takes precedence over guildOnly
          discordCmd.contexts = cmd.contexts;
        } else if (cmd.guildOnly) {
          // Transform guildOnly flag to Discord's contexts array
          // Why: `guildOnly: true` is more intuitive than `contexts: [0]`
          discordCmd.contexts = [0]; // 0 = Guild only (no DMs)
        }

        // Transform requiredPermissions to Discord's default_member_permissions
        // Why: Leverages Discord's native permission system for role-based access
        // Discord handles the permission checks before the interaction even fires
        if (cmd.requiredPermissions !== undefined) {
          discordCmd.default_member_permissions =
            typeof cmd.requiredPermissions === 'bigint'
              ? cmd.requiredPermissions.toString()
              : cmd.requiredPermissions;
        }

        return discordCmd;
      };

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
        // Note: cmd.name is validated earlier, but add defensive check for consistency
        for (const cmd of commands) {
          if (cmd.name) {
            commandMap.set(cmd.name, cmd);
          }
        }

        // Convert map values back to array and update this.slashCommands
        this.slashCommands = Array.from(commandMap.values());

        // Transform ALL merged commands to Discord API format
        // CRITICAL: We must transform the merged list, not just new commands,
        // because commands.set() replaces ALL global commands on Discord
        const transformedMergedCommands = this.slashCommands.map(transformCommand);

        // Separate commands into global and guild-specific based on guildIds
        // Treat undefined, null, or empty array as global commands
        const globalCommands = transformedMergedCommands.filter((_, idx) => {
          const guildIds = this.slashCommands[idx].guildIds;
          return !guildIds || guildIds.length === 0;
        });

        // Filter new commands that are guild-specific (only register new/updated guild commands)
        const newGuildSpecificCommands = commands.filter((cmd) => cmd.guildIds && cmd.guildIds.length > 0);

        // Check for error condition first
        if (!this.client?.application && globalCommands.length > 0) {
          this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, globalCommandsCount: globalCommands.length }, 'Cannot register commands - Discord client application is not available');
          throw new Error('Discord client application is not available');
        }

        // Register global commands
        // IMPORTANT: This replaces ALL global commands, so we must send the complete merged list
        let globalCommandsRegistered = false;
        if (globalCommands.length > 0 && this.client?.application) {
          await this.client.application.commands.set(globalCommands);
          globalCommandsRegistered = true;
          this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, globalCommandsCount: globalCommands.length }, 'Registered global commands');
        }

        // Register guild-specific commands
        // Note: Guild-specific commands are added individually per guild using .create() or .edit(),
        // so we only need to register the new ones from this batch
        let guildCommandsRegistered = 0;
        let guildCommandsFailed = 0;
        if (newGuildSpecificCommands.length > 0) {
          const guilds = await this.client?.guilds.fetch();
          if (guilds) {
            for (const newCmd of newGuildSpecificCommands) {
              const transformedCmd = transformCommand(newCmd);
              if (newCmd.guildIds) {
                for (const guildId of newCmd.guildIds) {
                  try {
                    const guild = guilds.get(guildId);
                    if (guild) {
                      const fullGuild = await guild.fetch();
                      const existingCommands = await fullGuild.commands.fetch();
                      const existingCommand = existingCommands.find((cmd) => cmd.name === newCmd.name);

                      if (existingCommand) {
                        // Command already exists, update it instead of creating
                        await existingCommand.edit(transformedCmd);
                        this.runtime.logger.debug(
                          { src: 'plugin:discord', agentId: this.runtime.agentId, commandName: newCmd.name, guildId: fullGuild.id, guildName: fullGuild.name },
                          'Updated existing command in guild'
                        );
                      } else {
                        // Command doesn't exist, create it
                        await fullGuild.commands.create(transformedCmd);
                        this.runtime.logger.debug(
                          { src: 'plugin:discord', agentId: this.runtime.agentId, commandName: newCmd.name, guildId: fullGuild.id, guildName: fullGuild.name },
                          'Registered command in guild'
                        );
                      }
                      guildCommandsRegistered++;
                    }
                  } catch (error) {
                    guildCommandsFailed++;
                    this.runtime.logger.error(
                      { src: 'plugin:discord', agentId: this.runtime.agentId, commandName: newCmd.name, guildId, error: error instanceof Error ? error.message : String(error) },
                      'Failed to register command in guild'
                    );
                  }
                }
              }
            }
          }
        }

        // Log successful registration after all commands have been registered
        // Only log success if we had no commands to register, or we successfully registered them
        const hasGlobalCommands = globalCommands.length > 0;
        const hasGuildCommands = newGuildSpecificCommands.length > 0;
        const allGlobalSucceeded = !hasGlobalCommands || globalCommandsRegistered;
        // For guild commands: succeed if no guild commands OR (we registered at least one AND no failures)
        // This handles the case where all guild commands fail (guildCommandsRegistered === 0 && guildCommandsFailed > 0)
        const allGuildSucceeded = !hasGuildCommands || (guildCommandsRegistered > 0 && guildCommandsFailed === 0);

        if (allGlobalSucceeded && allGuildSucceeded) {
          this.runtime.logger.info({
            src: 'plugin:discord',
            agentId: this.runtime.agentId,
            newCommands: commands.length,
            totalCommands: this.slashCommands.length,
            globalCommandsRegistered: hasGlobalCommands ? globalCommands.length : 0,
            guildCommandsRegistered: hasGuildCommands ? guildCommandsRegistered : 0
          }, 'Commands registered');
        }
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
    });

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

    this.runtime.logger.info({ src: 'plugin:discord', agentId: this.runtime.agentId, inviteUrl: `https://discord.com/api/oauth2/authorize?client_id=${readyClient.user?.id}&permissions=${requiredPermissions}&scope=bot%20applications.commands` }, 'Bot invite URL generated');

    this.runtime.logger.info({ src: 'plugin:discord', agentId: this.runtime.agentId, username: readyClient.user?.username }, 'Discord logged in');

    const guilds = await this.client?.guilds.fetch();
    if (!guilds) {
      this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Could not fetch guilds');
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
          this.runtime.logger.info({ src: 'plugin:discord', agentId: this.runtime.agentId, guildId: fullGuild.id, guildName: fullGuild.name }, 'Discord server connected');

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
      runtime.logger.info({ src: 'plugin:discord', agentId: runtime.agentId }, 'Registered send handler');
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
   * Placeholder for handling reaction addition.
   * @private
   */
  private async handleReactionAdd(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ) {
    try {
      this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Reaction added');

      // Early returns
      if (!reaction || !user) {
        this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Invalid reaction or user');
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
      const reactionMessage = `*Added <${emoji}> to: \\"${truncatedContent}\\"*`; // Escaped quotes

      // Get user info
      const userName = reaction.message.author?.username || 'unknown';
      const name = reaction.message.author?.displayName || userName;

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
        type: await this.getChannelType(reaction.message.channel as Channel),
      });

      const inReplyTo = createUniqueUuid(this.runtime, reaction.message.id);

      const memory: Memory = {
        id: reactionUUID,
        entityId,
        agentId: this.runtime.agentId,
        content: {
          // name,
          // userName,
          text: reactionMessage,
          source: 'discord',
          inReplyTo,
          channelType: await this.getChannelType(reaction.message.channel as Channel),
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

      this.runtime.emitEvent(['DISCORD_REACTION_RECEIVED', 'REACTION_RECEIVED'], {
        runtime: this.runtime,
        message: memory,
        callback,
      });
    } catch (error) {
      this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error handling reaction');
    }
  }

  /**
   * Placeholder for handling reaction removal.
   * @private
   */
  private async handleReactionRemove(
    reaction: MessageReaction | PartialMessageReaction,
    user: User | PartialUser
  ) {
    try {
      this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Reaction removed');

      let emoji = reaction.emoji.name;
      if (!emoji && reaction.emoji.id) {
        emoji = `<:${reaction.emoji.name}:${reaction.emoji.id}>`;
      }

      // Fetch the full message if it's a partial
      if (reaction.partial) {
        try {
          await reaction.fetch();
        } catch (error) {
          this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Failed to fetch message for reaction');
          return;
        }
      }

      const messageContent = reaction.message.content || '';
      const truncatedContent =
        messageContent.length > 50 ? `${messageContent.substring(0, 50)}...` : messageContent;

      const reactionMessage = `*Removed <${emoji}> from: \\"${truncatedContent}\\"*`; // Escaped quotes

      const roomId = createUniqueUuid(this.runtime, reaction.message.channel.id);

      const entityId = createUniqueUuid(this.runtime, user.id);
      const timestamp = Date.now();
      const reactionUUID = createUniqueUuid(
        this.runtime,
        `${reaction.message.id}-${user.id}-${emoji}-${timestamp}`
      );

      const userName = reaction.message.author?.username || 'unknown';
      const name = reaction.message.author?.displayName || userName;

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
        type: await this.getChannelType(reaction.message.channel as Channel),
      });

      const memory: Memory = {
        id: reactionUUID,
        entityId,
        agentId: this.runtime.agentId,
        content: {
          // name,
          // userName,
          text: reactionMessage,
          source: 'discord',
          inReplyTo: createUniqueUuid(this.runtime, reaction.message.id),
          channelType: await this.getChannelType(reaction.message.channel as Channel),
        },
        roomId,
        createdAt: Date.now(),
      };

      const callback: HandlerCallback = async (content): Promise<Memory[]> => {
        if (!reaction.message.channel) {
          this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'No channel found for reaction message');
          return [];
        }
        await (reaction.message.channel as TextChannel).send(content.text ?? '');
        return [];
      };

      this.runtime.emitEvent([DiscordEventTypes.REACTION_RECEIVED], {
        runtime: this.runtime,
        message: memory,
        callback,
      });
    } catch (error) {
      this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error handling reaction removal');
    }
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
   * Stops the Discord service and cleans up resources.
   * Implements the abstract method from the Service class.
   */
  public async stop(): Promise<void> {
    this.runtime.logger.info({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Stopping Discord service');
    this.timeouts.forEach(clearTimeout); // Clear any pending timeouts
    this.timeouts = [];
    if (this.client) {
      await this.client.destroy();
      this.client = null;
      this.runtime.logger.info({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Discord client destroyed');
    }
    // Additional cleanup if needed (e.g., voice manager)
    if (this.voiceManager) {
      // Assuming voiceManager has a stop or cleanup method
      // await this.voiceManager.stop();
    }
    this.runtime.logger.info({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Discord service stopped');
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
      case DiscordChannelType.GuildText:
        return ChannelType.GROUP;
      case DiscordChannelType.GuildVoice:
        return ChannelType.VOICE_GROUP;
      default:
        // Fallback or handle other channel types as needed
        this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, channelType: channel.type }, 'Unhandled channel type');
        return ChannelType.GROUP;
    }
  }
}

export default DiscordService;
