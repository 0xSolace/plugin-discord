import type { IAgentRuntime } from '@elizaos/core';
import { parseBooleanFromText } from '@elizaos/core';
import { z } from 'zod';
import type { DiscordSettings } from './types';

/**
 * Helper functions to get environment variables with proper defaults
 */
function getEnvBoolean(name: string, fallback: boolean): boolean {
  const value = process.env?.[name];
  if (!value) return fallback;
  return value.toLowerCase() === 'true';
}

function getEnvArray(name: string, fallback: string[]): string[] {
  const value = process.env?.[name];
  if (!value || value.trim() === '') return fallback;
  return value.split(',').map(item => item.trim()).filter(item => item.length > 0);
}

/**
 * Default values that can be overridden by environment variables
 */
export const DISCORD_DEFAULTS = {
  SHOULD_IGNORE_BOT_MESSAGES: getEnvBoolean('DISCORD_SHOULD_IGNORE_BOT_MESSAGES', false),
  SHOULD_IGNORE_DIRECT_MESSAGES: getEnvBoolean('DISCORD_SHOULD_IGNORE_DIRECT_MESSAGES', false),
  SHOULD_RESPOND_ONLY_TO_MENTIONS: getEnvBoolean('DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS', false),
  SHOULD_RESPOND_TO_CHARACTER_NAME: getEnvBoolean('DISCORD_SHOULD_RESPOND_TO_CHARACTER_NAME', false),
  ALLOWED_CHANNEL_IDS: getEnvArray('CHANNEL_IDS', []),
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
  DISCORD_SHOULD_RESPOND_TO_CHARACTER_NAME: z
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
    if (runtimeValue !== undefined) {
      return transform ? transform(runtimeValue as string) : runtimeValue as T;
    }
    return characterValue ?? defaultValue;
  };

  return {
    // Start with character settings
    ...characterSettings,

    // Override with runtime settings (which include env vars)
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

    shouldRespondToCharacterName: resolveSetting(
      'DISCORD_SHOULD_RESPOND_TO_CHARACTER_NAME',
      characterSettings.shouldRespondToCharacterName,
      DISCORD_DEFAULTS.SHOULD_RESPOND_TO_CHARACTER_NAME,
      parseBooleanFromText
    ),

    allowedChannelIds: resolveSetting(
      'CHANNEL_IDS',
      characterSettings.allowedChannelIds,
      DISCORD_DEFAULTS.ALLOWED_CHANNEL_IDS,
      (value: string) => value.split(',').map(s => s.trim()).filter(s => s.length > 0)
    ),
  };
}

/**
 * Validates the Discord configuration by retrieving the Discord API token from the runtime settings
 * and parsing it with the Discord environment schema.
 *
 * @param {IAgentRuntime} runtime The agent runtime instance.
 * @returns {Promise<DiscordConfig>} A promise that resolves with the validated Discord configuration.
 * @throws {Error} If the Discord configuration validation fails, an error with detailed error messages is thrown.
 */
export async function validateDiscordConfig(runtime: IAgentRuntime): Promise<DiscordConfig> {
  try {
    const config = {
      DISCORD_API_TOKEN: runtime.getSetting('DISCORD_API_TOKEN'),
      CHANNEL_IDS: runtime.getSetting('CHANNEL_IDS'),
      DISCORD_SHOULD_IGNORE_BOT_MESSAGES: runtime.getSetting('DISCORD_SHOULD_IGNORE_BOT_MESSAGES'),
      DISCORD_SHOULD_IGNORE_DIRECT_MESSAGES: runtime.getSetting('DISCORD_SHOULD_IGNORE_DIRECT_MESSAGES'),
      DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS: runtime.getSetting('DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS'),
      DISCORD_SHOULD_RESPOND_TO_CHARACTER_NAME: runtime.getSetting('DISCORD_SHOULD_RESPOND_TO_CHARACTER_NAME'),
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
