import type { IAgentRuntime } from '@elizaos/core';
import { parseBooleanFromText } from '@elizaos/core';
import { z } from 'zod';
import type { DiscordSettings } from './types';

/**
 * Helper functions to get environment variables with proper defaults
 */
function getEnvBoolean(name: string, fallback: boolean): boolean {
  const value = process.env?.[name];
  if (!value) {return fallback;}
  return value.toLowerCase() === 'true';
}

function getEnvArray(name: string, fallback: string[]): string[] {
  const value = process.env?.[name];
  if (!value || value.trim() === '') {return fallback;}
  return value.split(',').map(item => item.trim()).filter(item => item.length > 0);
}

/**
 * Helper function to parse number from environment variable
 */
function getEnvNumber(name: string, fallback: number): number {
  const value = process.env?.[name];
  if (!value) return fallback;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? fallback : parsed;
}

/**
 * Default values that can be overridden by environment variables
 */
export const DISCORD_DEFAULTS = {
  SHOULD_IGNORE_BOT_MESSAGES: getEnvBoolean('DISCORD_SHOULD_IGNORE_BOT_MESSAGES', false),
  SHOULD_IGNORE_DIRECT_MESSAGES: getEnvBoolean('DISCORD_SHOULD_IGNORE_DIRECT_MESSAGES', false),
  SHOULD_RESPOND_ONLY_TO_MENTIONS: getEnvBoolean('DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS', false),
  ALLOWED_CHANNEL_IDS: getEnvArray('CHANNEL_IDS', []),
  VOICE_DUCK_VOLUME: getEnvNumber('VOICE_DUCK_VOLUME', 0.2),
  VOICE_DUCK_SILENCE_TIMEOUT: getEnvNumber('VOICE_DUCK_SILENCE_TIMEOUT', 60000),
  VOICE_DUCK_RAMP_DURATION: getEnvNumber('VOICE_DUCK_RAMP_DURATION', 3000),
  VOICE_SPEAKING_THRESHOLD: getEnvNumber('VOICE_SPEAKING_THRESHOLD', 0.1),
  VOICE_LISTEN_ONLY: getEnvBoolean('DISCORD_VOICE_LISTEN_ONLY', false),
} as const;

export const discordEnvSchema = z.object({
  DISCORD_API_TOKEN: z.string().min(1, 'Discord API token is required'),
  /**
   * Comma-separated list of channel IDs to restrict the bot to.
   * If not set, the bot operates in all channels as usual.
   * These channels cannot be removed via the leaveChannel action.
   * Additional channels can be added dynamically via the joinChannel action.
   */
  CHANNEL_IDS: z
    .string()
    .nullish()
    .transform((val) =>
      val
        ? val
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
        : undefined
    ),
  DISCORD_SHOULD_IGNORE_BOT_MESSAGES: z
    .string()
    .nullish()
    .transform((val) => (val ? parseBooleanFromText(val) : undefined)),
  DISCORD_SHOULD_IGNORE_DIRECT_MESSAGES: z
    .string()
    .nullish()
    .transform((val) => (val ? parseBooleanFromText(val) : undefined)),
  DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS: z
    .string()
    .nullish()
    .transform((val) => (val ? parseBooleanFromText(val) : undefined)),
});

/**
 * Represents the type of Discord configuration settings inferred from the discordEnvSchema.
 */
export type DiscordConfig = z.infer<typeof discordEnvSchema>;

/**
 * Get Discord settings with proper priority:
 * 1. Runtime settings (environment variables via getSetting)
 * 2. Character settings
 * 3. Default values
 *
 * @param runtime - ElizaOS agent runtime instance
 * @returns Merged Discord settings
 */
export function getDiscordSettings(runtime: IAgentRuntime): DiscordSettings {
  const characterSettings = runtime.character.settings?.discord as DiscordSettings || {};

  // Helper to resolve setting value with priority: runtime > character > default
  const resolveSetting = <T>(
    envKey: string,
    characterValue: T | undefined,
    defaultValue: T,
    transform?: (value: string) => T
  ): T => {
    const runtimeValue = runtime.getSetting(envKey);
    // Treat null the same as undefined (some runtimes return null for missing settings)
    if (runtimeValue !== undefined && runtimeValue !== null) {
      // Coerce to string before transforming to handle non-string runtime values
      const normalized =
        typeof runtimeValue === 'string' ? runtimeValue : String(runtimeValue);
      return transform ? transform(normalized) : (runtimeValue as T);
    }
    return characterValue ?? defaultValue;
  };

  // Resolve allowedChannelIds separately to handle empty array case
  const resolvedAllowedChannelIds = resolveSetting<string[]>(
    'CHANNEL_IDS',
    characterSettings.allowedChannelIds,
    DISCORD_DEFAULTS.ALLOWED_CHANNEL_IDS,
    (value: string) =>
      value
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
  );

  // Helper to parse number from string with optional fallback
  // Returns the fallback value when parseFloat yields NaN, instead of defaulting to 0
  // which would incorrectly override configured defaults for settings like volume (0.2)
  const parseNumber = (value: string, fallback?: number): number => {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? (fallback ?? 0) : parsed;
  };

  return {
    ...characterSettings,
    shouldIgnoreBotMessages: resolveSetting(
      'DISCORD_SHOULD_IGNORE_BOT_MESSAGES',
      characterSettings.shouldIgnoreBotMessages,
      DISCORD_DEFAULTS.SHOULD_IGNORE_BOT_MESSAGES,
      parseBooleanFromText
    ),

    shouldIgnoreDirectMessages: resolveSetting(
      'DISCORD_SHOULD_IGNORE_DIRECT_MESSAGES',
      characterSettings.shouldIgnoreDirectMessages,
      DISCORD_DEFAULTS.SHOULD_IGNORE_DIRECT_MESSAGES,
      parseBooleanFromText
    ),

    shouldRespondOnlyToMentions: resolveSetting(
      'DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS',
      characterSettings.shouldRespondOnlyToMentions,
      DISCORD_DEFAULTS.SHOULD_RESPOND_ONLY_TO_MENTIONS,
      parseBooleanFromText
    ),

    // Collapse empty allow-lists back to undefined to keep default open behavior
    allowedChannelIds:
      resolvedAllowedChannelIds.length > 0 ? resolvedAllowedChannelIds : undefined,

    voiceDuckVolume: resolveSetting(
      'VOICE_DUCK_VOLUME',
      characterSettings.voiceDuckVolume,
      DISCORD_DEFAULTS.VOICE_DUCK_VOLUME,
      (v) => parseNumber(v, DISCORD_DEFAULTS.VOICE_DUCK_VOLUME)
    ),

    voiceDuckSilenceTimeout: resolveSetting(
      'VOICE_DUCK_SILENCE_TIMEOUT',
      characterSettings.voiceDuckSilenceTimeout,
      DISCORD_DEFAULTS.VOICE_DUCK_SILENCE_TIMEOUT,
      (v) => parseNumber(v, DISCORD_DEFAULTS.VOICE_DUCK_SILENCE_TIMEOUT)
    ),

    voiceDuckRampDuration: resolveSetting(
      'VOICE_DUCK_RAMP_DURATION',
      characterSettings.voiceDuckRampDuration,
      DISCORD_DEFAULTS.VOICE_DUCK_RAMP_DURATION,
      (v) => parseNumber(v, DISCORD_DEFAULTS.VOICE_DUCK_RAMP_DURATION)
    ),

    voiceSpeakingThreshold: resolveSetting(
      'VOICE_SPEAKING_THRESHOLD',
      characterSettings.voiceSpeakingThreshold,
      DISCORD_DEFAULTS.VOICE_SPEAKING_THRESHOLD,
      (v) => parseNumber(v, DISCORD_DEFAULTS.VOICE_SPEAKING_THRESHOLD)
    ),

    voiceListenOnly: resolveSetting(
      'DISCORD_VOICE_LISTEN_ONLY',
      characterSettings.voiceListenOnly,
      DISCORD_DEFAULTS.VOICE_LISTEN_ONLY,
      parseBooleanFromText
    ),
  };
}

/**
 * Validates the Discord configuration by retrieving the Discord API token from the runtime settings
 * and parsing it with the Discord environment schema.
 *
 * Token lookup priority:
 * - DISCORD_API_TOKEN (primary, recommended)
 * - DISCORD_BOT_TOKENS (for multi-bot setups)
 *
 * Note: DISCORD_APPLICATION_ID is NOT a valid token - it's the application/client ID
 * used for OAuth2 flows and invite URL generation, not for bot authentication.
 *
 * @param {IAgentRuntime} runtime The agent runtime instance.
 * @returns {Promise<DiscordConfig>} A promise that resolves with the validated Discord configuration.
 * @throws {Error} If the Discord configuration validation fails or no token is found.
 */
export async function validateDiscordConfig(runtime: IAgentRuntime): Promise<DiscordConfig> {
  try {
    // Look for bot token in supported environment variables
    // Note: DISCORD_APPLICATION_ID is intentionally NOT included here - it's the
    // application/client ID (numeric), not a bot token. Using it as a token would
    // cause authentication failures. Application ID is only needed for invite URLs.
    let token = runtime.getSetting('DISCORD_API_TOKEN') as string | undefined;
    
    // Fall back to DISCORD_BOT_TOKENS if DISCORD_API_TOKEN not set
    // DISCORD_BOT_TOKENS may contain comma-separated tokens for multi-bot setups
    // Extract just the first token for single-client validation
    if (!token || token.trim() === '') {
      const botTokens = runtime.getSetting('DISCORD_BOT_TOKENS') as string | undefined;
      if (botTokens && botTokens.trim()) {
        // Extract first token from comma-separated list
        // Multi-bot setup is handled by ClientRegistry, not here
        const firstToken = botTokens.split(',')[0]?.trim();
        if (firstToken) {
          token = firstToken;
        }
      }
    }

    // Validate token exists before proceeding
    if (!token || token.trim() === '') {
      throw new Error(
        'Discord bot token not found. Please set DISCORD_API_TOKEN in your environment or character settings.\n' +
        'You can get a bot token from the Discord Developer Portal: https://discord.com/developers/applications\n' +
        'Note: DISCORD_APPLICATION_ID is your application\'s client ID, not a bot token.'
      );
    }

    const config = {
      DISCORD_API_TOKEN: token,
      CHANNEL_IDS: runtime.getSetting('CHANNEL_IDS'),
      DISCORD_SHOULD_IGNORE_BOT_MESSAGES: runtime.getSetting('DISCORD_SHOULD_IGNORE_BOT_MESSAGES'),
      DISCORD_SHOULD_IGNORE_DIRECT_MESSAGES: runtime.getSetting('DISCORD_SHOULD_IGNORE_DIRECT_MESSAGES'),
      DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS: runtime.getSetting('DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS'),
    };

    return discordEnvSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.issues
        .map((err) => `${err.path.join('.')}: ${err.message}`)
        .join('\n');
      throw new Error(`Discord configuration validation failed:\n${errorMessages}`);
    }
    throw error;
  }
}
