import type { Character, EntityPayload, MessagePayload, WorldPayload, Memory, IAgentRuntime, Media, ChannelType } from '@elizaos/core';
import type {
  Channel,
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

  // Server/World events
  WORLD_JOINED = 'DISCORD_WORLD_JOINED',
  WORLD_CONNECTED = 'DISCORD_SERVER_CONNECTED',

  // User/Entity events
  // Note: ENTITY_JOINED is emitted when a user joins a Discord guild (server).
  // This is different from the core EventType.ENTITY_JOINED which requires a roomId.
  // In Discord terms: guild membership != channel membership. Users join the "world"
  // (guild) but only join specific "rooms" (channels) when they first interact there.
  // Use this event for Discord-specific handling like welcome messages or role checks.
  ENTITY_JOINED = 'DISCORD_USER_JOINED',
  ENTITY_LEFT = 'DISCORD_USER_LEFT',

  // Voice events
  VOICE_STATE_CHANGED = 'DISCORD_VOICE_STATE_CHANGED',

  // Permission audit events
  CHANNEL_PERMISSIONS_CHANGED = 'DISCORD_CHANNEL_PERMISSIONS_CHANGED',
  ROLE_PERMISSIONS_CHANGED = 'DISCORD_ROLE_PERMISSIONS_CHANGED',
  MEMBER_ROLES_CHANGED = 'DISCORD_MEMBER_ROLES_CHANGED',
  ROLE_CREATED = 'DISCORD_ROLE_CREATED',
  ROLE_DELETED = 'DISCORD_ROLE_DELETED',
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
 * Discord-specific user joined payload.
 *
 * Emitted via `DiscordEventTypes.ENTITY_JOINED` when a user joins a Discord guild.
 *
 * **Important:** This event represents guild membership, not room/channel membership.
 * The payload contains `worldId` (the guild) but no `roomId` because the user hasn't
 * joined any specific channel yet. The entity will be synced to specific rooms when
 * they first interact (send a message, join voice, etc.).
 *
 * Use this event for Discord-specific handling like:
 * - Sending welcome messages
 * - Assigning default roles
 * - Moderation checks (account age, etc.)
 * - Logging new member joins
 */
export interface DiscordUserJoinedPayload extends EntityPayload {
  /** The original Discord.js GuildMember object for full Discord API access */
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

// ============================================================================
// Permission Audit Types
// ============================================================================

/**
 * Permission state in an overwrite or role
 */
export type PermissionState = 'ALLOW' | 'DENY' | 'NEUTRAL';

/**
 * A single permission change
 */
export interface PermissionDiff {
  /** The permission name (e.g., 'ManageMessages', 'Administrator') */
  permission: string;
  /** Previous state */
  oldState: PermissionState;
  /** New state */
  newState: PermissionState;
}

/**
 * Information about who made a change, from audit logs
 */
export interface AuditInfo {
  /** Discord user ID of the executor */
  executorId: string;
  /** Discord username#discriminator or username of the executor */
  executorTag: string;
  /** Reason provided for the action, if any */
  reason: string | null;
}

/**
 * Minimal runtime interface for permission payloads.
 * Using a minimal interface avoids version mismatches across packages.
 */
export interface PermissionPayloadRuntime {
  getService(name: string): unknown;
  getSetting(key: string): unknown;
  logger: {
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}

/**
 * Payload for DISCORD_CHANNEL_PERMISSIONS_CHANGED event
 * Emitted when channel permission overwrites are created, updated, or deleted
 */
export interface ChannelPermissionsChangedPayload {
  /** Runtime instance */
  runtime: PermissionPayloadRuntime;
  /** Guild information */
  guild: { id: string; name: string };
  /** Channel where permissions changed */
  channel: { id: string; name: string };
  /** Target of the permission overwrite (role or user) */
  target: { type: 'role' | 'user'; id: string; name: string };
  /** What happened to the overwrite */
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  /** List of permission changes */
  changes: PermissionDiff[];
  /** Audit log info (null if unavailable) */
  audit: AuditInfo | null;
}

/**
 * Payload for DISCORD_ROLE_PERMISSIONS_CHANGED event
 * Emitted when a role's permissions are modified
 */
export interface RolePermissionsChangedPayload {
  /** Runtime instance */
  runtime: PermissionPayloadRuntime;
  /** Guild information */
  guild: { id: string; name: string };
  /** Role that was modified */
  role: { id: string; name: string };
  /** List of permission changes */
  changes: PermissionDiff[];
  /** Audit log info (null if unavailable) */
  audit: AuditInfo | null;
}

/**
 * Payload for DISCORD_MEMBER_ROLES_CHANGED event
 * Emitted when roles are added or removed from a member
 */
export interface MemberRolesChangedPayload {
  /** Runtime instance */
  runtime: PermissionPayloadRuntime;
  /** Guild information */
  guild: { id: string; name: string };
  /** Member whose roles changed */
  member: { id: string; tag: string };
  /** Roles that were added */
  added: Array<{ id: string; name: string; permissions: string[] }>;
  /** Roles that were removed */
  removed: Array<{ id: string; name: string; permissions: string[] }>;
  /** Audit log info (null if unavailable) */
  audit: AuditInfo | null;
}

/**
 * Payload for DISCORD_ROLE_CREATED and DISCORD_ROLE_DELETED events
 */
export interface RoleLifecyclePayload {
  /** Runtime instance */
  runtime: PermissionPayloadRuntime;
  /** Guild information */
  guild: { id: string; name: string };
  /** Role that was created or deleted */
  role: { id: string; name: string; permissions: string[] };
  /** Audit log info (null if unavailable) */
  audit: AuditInfo | null;
}

/**
 * Discord slash command definition
 */
export interface DiscordSlashCommand {
  name: string;
  description: string;
  options?: Array<{
    name: string;
    type: number;
    description: string;
    required?: boolean;
    channel_types?: number[];
  }>;
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
  [DiscordEventTypes.CHANNEL_PERMISSIONS_CHANGED]: ChannelPermissionsChangedPayload;
  [DiscordEventTypes.ROLE_PERMISSIONS_CHANGED]: RolePermissionsChangedPayload;
  [DiscordEventTypes.MEMBER_ROLES_CHANGED]: MemberRolesChangedPayload;
  [DiscordEventTypes.ROLE_CREATED]: RoleLifecyclePayload;
  [DiscordEventTypes.ROLE_DELETED]: RoleLifecyclePayload;
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
  runtime: IAgentRuntime;
  getChannelType: (channel: Channel) => Promise<ChannelType>;
  buildMemoryFromMessage: (
    message: Message,
    options?: {
      processedContent?: string;
      processedAttachments?: Media[];
      extraContent?: Record<string, any>;
    }
  ) => Promise<Memory | null>;
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

/**
 * State tracking for channel history spider to avoid re-fetching
 */
export interface ChannelSpiderState {
  /** Discord channel ID */
  channelId: string;
  /** Oldest message ID fetched (for going further back) */
  oldestMessageId?: string;
  /** Newest message ID fetched (for catching up) */
  newestMessageId?: string;
  /** Timestamp of oldest message (for comparison) */
  oldestMessageTimestamp?: number;
  /** Timestamp of newest message (for comparison) */
  newestMessageTimestamp?: number;
  /** Timestamp of last spider run */
  lastSpideredAt: number;
  /** True if we've reached the beginning of channel history */
  fullyBackfilled: boolean;
}

/**
 * Batch handler for processing messages as they arrive during history fetch
 * @returns false to stop fetching early, void/true to continue
 */
export type BatchHandler = (
  batch: Memory[],
  stats: { page: number; totalFetched: number; totalStored: number }
) => Promise<boolean | void> | boolean | void;

/**
 * Options for fetching channel history
 */
export interface ChannelHistoryOptions {
  /** Maximum number of messages to fetch (default: unlimited) */
  limit?: number;
  /** Force re-fetch, ignoring spider state */
  force?: boolean;
  /** Callback to process each batch of messages as they arrive */
  onBatch?: BatchHandler;
  /** Start fetching before this message ID */
  before?: string;
  /** Start fetching after this message ID (for catching up) */
  after?: string;
}

/**
 * Result from fetching channel history
 */
export interface ChannelHistoryResult {
  /** Fetched messages (empty if onBatch was used) */
  messages: Memory[];
  /** Statistics about the fetch operation */
  stats: {
    /** Total messages fetched from Discord */
    fetched: number;
    /** Total messages stored/processed */
    stored: number;
    /** Number of pages fetched */
    pages: number;
    /** Whether the channel is now fully backfilled */
    fullyBackfilled: boolean;
  };
}
