import type { Character, EntityPayload, MessagePayload, WorldPayload } from '@elizaos/core';
import type {
  Client as DiscordJsClient,
  Interaction,
  Guild,
  GuildMember,
  Message,
  MessageReaction,
  User,
  VoiceState,
} from 'discord.js';

/**
 * Discord-specific event types
 */
export enum DiscordEventTypes {
  // Message events (prefixed versions of core events)
  MESSAGE_RECEIVED = 'DISCORD_MESSAGE_RECEIVED',
  MESSAGE_SENT = 'DISCORD_MESSAGE_SENT',

  // slash commands event
  SLASH_COMMAND = 'DISCORD_SLASH_COMMAND',
  MODAL_SUBMIT = 'DISCORD_MODAL_SUBMIT',

  // Reaction events
  REACTION_RECEIVED = 'DISCORD_REACTION_RECEIVED',
  REACTION_REMOVED = 'DISCORD_REACTION_REMOVED',

  // Server events
  WORLD_JOINED = 'DISCORD_WORLD_JOINED',
  WORLD_CONNECTED = 'DISCORD_SERVER_CONNECTED',

  // User events
  ENTITY_JOINED = 'DISCORD_USER_JOINED',
  ENTITY_LEFT = 'DISCORD_USER_LEFT',

  // Voice events
  VOICE_STATE_CHANGED = 'DISCORD_VOICE_STATE_CHANGED',
}

/**
 * Discord-specific message received payload
 */
export interface DiscordMessageReceivedPayload extends MessagePayload {
  /** The original Discord message */
  originalMessage: Message;
}

/**
 * Discord-specific message sent payload
 */
export interface DiscordMessageSentPayload extends MessagePayload {
  /** The original Discord messages sent */
  originalMessages: Message[];
}

/**
 * Discord-specific reaction received payload
 */
export interface DiscordReactionPayload extends MessagePayload {
  /** The original Discord reaction */
  originalReaction: MessageReaction;
  /** The user who reacted */
  user: User;
}
/**
 * Discord-specific server payload
 */
export interface DiscordServerPayload extends WorldPayload {
  /** The original Discord guild */
  server: Guild;
}

/**
 * Discord-specific user joined payload
 */
export interface DiscordUserJoinedPayload extends EntityPayload {
  /** The original Discord guild member */
  member: GuildMember;
}

/**
 * Discord-specific user left payload
 */
export interface DiscordUserLeftPayload extends EntityPayload {
  /** The original Discord guild member */
  member: GuildMember;
}

/**
 * Discord-specific voice state changed payload
 */
export interface DiscordVoiceStateChangedPayload {
  /** The original Discord voice state */
  voiceState: VoiceState;
}

/**
 * Discord slash command definition with hybrid permission system.
 * 
 * This interface combines Discord's native permission features with ElizaOS-specific
 * controls to provide a flexible, developer-friendly API for command permissions.
 * 
 * ## Design Philosophy
 * - **Zero config = works everywhere** (default behavior)
 * - **Simple flags** for common use cases (guild-only, admin-only, etc.)
 * - **Native Discord features** where possible (leverages Discord's permission system)
 * - **Programmatic control** for advanced scenarios (custom validators)
 * 
 * ## Permission Layers
 * 
 * Commands go through multiple permission checks in this order:
 * 1. **Discord native checks** (handled by Discord before interaction fires):
 *    - `requiredPermissions`: User must have these Discord permissions
 *    - `guildOnly`/`contexts`: Command availability in guilds vs DMs
 * 2. **ElizaOS channel whitelist** (CHANNEL_IDS env var):
 *    - If set, commands only work in whitelisted channels
 *    - Unless `bypassChannelWhitelist: true` is set
 * 3. **Custom validator** (if provided):
 *    - Runs after all other checks
 *    - Full programmatic control for complex logic
 * 
 * @example
 * // Default: works everywhere
 * { name: 'help', description: 'Show help' }
 * 
 * @example
 * // Guild-only command
 * { name: 'serverinfo', description: 'Show server info', guildOnly: true }
 * 
 * @example
 * // Requires Discord permission
 * { 
 *   name: 'config', 
 *   description: 'Configure bot',
 *   requiredPermissions: PermissionFlagsBits.ManageGuild 
 * }
 * 
 * @example
 * // Bypasses channel whitelist (works in all channels)
 * { 
 *   name: 'dumpchannel', 
 *   description: 'Export channel',
 *   bypassChannelWhitelist: true 
 * }
 * 
 * @example
 * // Advanced: custom validation
 * {
 *   name: 'admin',
 *   description: 'Admin command',
 *   validator: async (interaction, runtime) => {
 *     // Custom logic here
 *     return interaction.user.id === runtime.getSetting('ADMIN_USER_ID');
 *   }
 * }
 */
export interface DiscordSlashCommand {
  /** Command name (must be lowercase, no spaces) */
  name: string;

  /** Command description shown in Discord UI */
  description: string;

  /** Command options/parameters */
  options?: Array<{
    name: string;
    type: number;
    description: string;
    required?: boolean;
    channel_types?: number[];
  }>;

  // ==================== Simple Permission Flags ====================

  /**
   * If true, command only works in guilds (not DMs).
   * Transformed to Discord's `contexts: [0]` during registration.
   * 
   * Use this for commands that need server context (e.g., server info, moderation).
   */
  guildOnly?: boolean;

  /**
   * If true, command bypasses CHANNEL_IDS whitelist restrictions.
   * 
   * Use this for utility commands that should work everywhere regardless of
   * channel restrictions (e.g., help, export, diagnostics).
   * 
   * Note: This is an ElizaOS-specific feature, not a Discord native feature.
   * Discord handles this via Server Settings > Integrations UI, but we provide
   * programmatic control for better developer experience.
   */
  bypassChannelWhitelist?: boolean;

  // ==================== Discord Native Permissions ====================

  /**
   * Discord permission bitfield required to use this command.
   * Transformed to `default_member_permissions` during registration.
   * 
   * Common values (from Discord.js PermissionFlagsBits):
   * - `ManageGuild`: Server settings
   * - `ManageChannels`: Channel management
   * - `ManageMessages`: Delete messages
   * - `BanMembers`: Ban users
   * - `KickMembers`: Kick users
   * - `ModerateMembers`: Timeout users
   * - `ManageRoles`: Role management
   * - `Administrator`: Full access
   * 
   * Set to `null` to explicitly allow everyone (overrides Discord's defaults).
   * 
   * @example
   * requiredPermissions: PermissionFlagsBits.ManageGuild
   * 
   * @example
   * // Multiple permissions (combine with bitwise OR)
   * requiredPermissions: PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ModerateMembers
   */
  requiredPermissions?: bigint | string | null;

  // ==================== Advanced Options ====================

  /**
   * Raw Discord contexts array. Overrides `guildOnly` if provided.
   * - 0 = Guild (server channels)
   * - 1 = BotDM (DMs with the bot)
   * - 2 = PrivateChannel (group DMs)
   * 
   * Most developers should use `guildOnly` instead of this.
   */
  contexts?: number[];

  /**
   * If provided, register this command only in specific guilds (servers).
   * Otherwise, command is registered globally and appears in all guilds.
   * 
   * Guild-specific commands update instantly, while global commands can take
   * up to 1 hour to propagate. Use this for testing or server-specific features.
   * 
   * @example
   * guildIds: ['123456789012345678', '987654321098765432']
   */
  guildIds?: string[];

  /**
   * Custom validation function for advanced permission logic.
   * 
   * Called after Discord's native checks and channel whitelist checks.
   * Return `true` to allow the command, `false` to block it.
   * 
   * **Important**: If your validator returns `false`, you should respond to the interaction
   * before returning to provide context to the user. If you don't respond, a generic
   * "You do not have permission to use this command." message will be sent automatically.
   * 
   * This is useful for:
   * - ElizaOS-specific permission systems (when implemented)
   * - Complex business logic (e.g., rate limiting, feature flags)
   * - Dynamic permissions based on runtime state
   * 
   * @param interaction - The Discord interaction object (can be used to reply/respond)
   * @param runtime - The ElizaOS runtime instance
   * @returns Promise resolving to true if command should execute, false otherwise
   * 
   * @example
   * // Simple validator without custom response (uses default)
   * validator: async (interaction, runtime) => {
   *   const userId = interaction.user.id;
   *   const allowedUsers = runtime.getSetting('ALLOWED_USERS')?.split(',') ?? [];
   *   return allowedUsers.includes(userId);
   * }
   * 
   * @example
   * // Validator with custom rejection message
   * validator: async (interaction, runtime) => {
   *   const userId = interaction.user.id;
   *   const isAllowed = await checkUserPermission(userId);
   *   if (!isAllowed) {
   *     await interaction.reply({
   *       content: 'This command is only available to premium users.',
   *       ephemeral: true,
   *     });
   *     return false;
   *   }
   *   return true;
   * }
   */
  validator?: (interaction: any, runtime: any) => Promise<boolean>;
}

/**
 * Discord-specific slash commands payload for command execution
 */
export interface DiscordSlashCommandPayload {
  interaction: Interaction;
  client: DiscordJsClient;
  commands: DiscordSlashCommand[];
}

/**
 * Maps Discord event types to their payload interfaces
 */
export interface DiscordEventPayloadMap {
  [DiscordEventTypes.MESSAGE_RECEIVED]: DiscordMessageReceivedPayload;
  [DiscordEventTypes.MESSAGE_SENT]: DiscordMessageSentPayload;
  [DiscordEventTypes.REACTION_RECEIVED]: DiscordReactionPayload;
  [DiscordEventTypes.REACTION_REMOVED]: DiscordReactionPayload;
  [DiscordEventTypes.WORLD_JOINED]: DiscordServerPayload;
  [DiscordEventTypes.WORLD_CONNECTED]: DiscordServerPayload;
  [DiscordEventTypes.ENTITY_JOINED]: DiscordUserJoinedPayload;
  [DiscordEventTypes.ENTITY_LEFT]: DiscordUserLeftPayload;
  [DiscordEventTypes.SLASH_COMMAND]: DiscordSlashCommandPayload;
  [DiscordEventTypes.MODAL_SUBMIT]: DiscordSlashCommandPayload;
  [DiscordEventTypes.VOICE_STATE_CHANGED]: DiscordVoiceStateChangedPayload;
}

/**
 * Interface representing a Discord service.
 *
 * @typedef {Object} IDiscordService
 * @property {DiscordJsClient} client - The Discord client object.
 * @property {Character} character - The character object.
 */
export interface IDiscordService {
  // Allow client to be null to handle initialization failures
  client: DiscordJsClient | null;
  character: Character;
}

export const DISCORD_SERVICE_NAME = 'discord';

export const ServiceType = {
  DISCORD: 'discord',
} as const;

export interface DiscordComponentOptions {
  type: number;
  custom_id: string;
  label?: string;
  style?: number;
  placeholder?: string;
  min_values?: number;
  max_values?: number;
  options?: Array<{
    label: string;
    value: string;
    description?: string;
  }>;
}

export interface DiscordActionRow {
  type: 1;
  components: DiscordComponentOptions[];
}

// maybe discord character settings makes more sense?
export interface DiscordSettings {
  allowedChannelIds?: string[];
  shouldIgnoreBotMessages?: boolean;
  shouldIgnoreDirectMessages?: boolean;
  shouldRespondOnlyToMentions?: boolean;
  //[key: string]: any; // still allows extension
}
