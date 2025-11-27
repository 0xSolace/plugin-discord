import type { Character, EntityPayload, MessagePayload, WorldPayload, Memory } from '@elizaos/core';
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
