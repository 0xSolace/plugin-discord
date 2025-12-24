/**
 * Plugin Information Providers for Discord Plugin
 *
 * Two dynamic providers:
 * 1. discordInstructionsProvider - Usage instructions for the agent/LLM
 * 2. discordSettingsProvider - Current configuration (non-sensitive)
 */

import type { IAgentRuntime, Provider, ProviderResult, Memory, State } from '@elizaos/core';

/**
 * Instructions Provider
 *
 * Provides usage instructions for the Discord plugin.
 * Helps the agent understand and explain Discord capabilities.
 */
export const discordInstructionsProvider: Provider = {
  name: 'discordInstructions',
  description: 'Instructions and capabilities for the Discord integration plugin',
  dynamic: true,

  get: async (runtime: IAgentRuntime, _message: Memory, _state: State): Promise<ProviderResult> => {
    const instructions = `
# Discord Plugin Capabilities

## What This Plugin Does

The Discord plugin integrates agents with Discord servers. It enables the agent to:
- Communicate in text channels and DMs
- Join and participate in voice channels
- Manage channel interactions
- Search and analyze conversations

## Available Actions

### Messaging
- **SEND_MESSAGE**: Send a message to a specific channel
- **SEND_DM**: Send a direct message to a user
- **CHAT_WITH_ATTACHMENTS**: Send messages with file attachments
- **REACT_TO_MESSAGE**: Add emoji reactions to messages

### Channel Management
- **JOIN_CHANNEL**: Join a voice channel
- **LEAVE_CHANNEL**: Leave the current voice channel
- **LIST_CHANNELS**: List available channels in the server
- **READ_CHANNEL**: Read recent messages from a channel

### Content Operations
- **SEARCH_MESSAGES**: Search for messages in channels
- **SUMMARIZE**: Summarize conversation history
- **TRANSCRIBE_MEDIA**: Transcribe audio/video content
- **DOWNLOAD_MEDIA**: Download media attachments

### Moderation
- **PIN_MESSAGE**: Pin important messages
- **UNPIN_MESSAGE**: Unpin messages
- **CREATE_POLL**: Create polls for user feedback
- **GET_USER_INFO**: Get information about a user
- **SERVER_INFO**: Get server information

## Voice Features

When voice is enabled:
- Join voice channels for audio interaction
- Transcribe voice messages
- Participate in voice conversations

## Best Practices

1. **Respect Permissions**: Only perform actions the bot has permissions for
2. **Rate Limits**: Discord has rate limits - avoid spamming messages
3. **Mentions**: Use @mentions sparingly to avoid notification fatigue
4. **Context**: Read recent messages before responding to ongoing conversations

## Common User Requests

- "Can you send a message to #general?" → Use SEND_MESSAGE
- "What's happening in the voice channel?" → Check voice state
- "Search for messages about X" → Use SEARCH_MESSAGES
- "Summarize the last conversation" → Use SUMMARIZE
`;

    return {
      text: instructions.trim(),
      data: {
        pluginName: 'discord',
        platform: 'Discord',
        capabilities: [
          'text-messaging',
          'voice-channels',
          'dm-support',
          'message-search',
          'media-handling',
          'polls',
          'reactions',
        ],
      },
    };
  },
};

/**
 * Settings Provider
 *
 * Exposes current Discord configuration (non-sensitive values only).
 * NEVER exposes tokens or secrets.
 */
export const discordSettingsProvider: Provider = {
  name: 'discordSettings',
  description: 'Current Discord plugin configuration (non-sensitive)',
  dynamic: true,

  get: async (runtime: IAgentRuntime, _message: Memory, _state: State): Promise<ProviderResult> => {
    // Only expose non-sensitive configuration
    // NEVER expose: DISCORD_API_TOKEN, DISCORD_BOT_TOKENS, or other secrets
    const hasApiToken = !!runtime.getSetting('DISCORD_API_TOKEN');
    const hasBotTokens = !!(runtime.getSetting('DISCORD_BOT_TOKENS') as string || '').trim();

    const settings = {
      // Check if configured (but don't expose the actual values)
      // Plugin supports either DISCORD_API_TOKEN (single bot) or DISCORD_BOT_TOKENS (multi-bot)
      isConfigured: hasApiToken || hasBotTokens,
      hasApplicationId: !!runtime.getSetting('DISCORD_APPLICATION_ID'),
      hasVoiceChannel: !!runtime.getSetting('DISCORD_VOICE_CHANNEL_ID'),

      // Non-sensitive behavior settings
      ignoreBotMessages: runtime.getSetting('DISCORD_SHOULD_IGNORE_BOT_MESSAGES') === 'true',
      ignoreDirectMessages: runtime.getSetting('DISCORD_SHOULD_IGNORE_DIRECT_MESSAGES') === 'true',
      respondOnlyToMentions: runtime.getSetting('DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS') === 'true',

      // Channel configuration (IDs are not sensitive)
      hasListenChannels: !!(runtime.getSetting('DISCORD_LISTEN_CHANNEL_IDS') as string || '').trim(),
    };

    const text = `
# Discord Plugin Settings

## Connection Status
- **Configured**: ${settings.isConfigured ? 'Yes' : 'No - DISCORD_API_TOKEN or DISCORD_BOT_TOKENS required'}
- **Application ID**: ${settings.hasApplicationId ? 'Set' : 'Not set'}

## Voice Configuration
- **Default Voice Channel**: ${settings.hasVoiceChannel ? 'Configured' : 'Not configured'}

## Message Behavior
- **Ignore Bot Messages**: ${settings.ignoreBotMessages ? 'Yes' : 'No'}
- **Ignore Direct Messages**: ${settings.ignoreDirectMessages ? 'Yes' : 'No'}
- **Respond Only to Mentions**: ${settings.respondOnlyToMentions ? 'Yes' : 'No'}

## Channel Filters
- **Listen Channels**: ${settings.hasListenChannels ? 'Specific channels configured' : 'All channels'}

## Notes
${!settings.isConfigured ? '⚠️ Discord integration is not functional without DISCORD_API_TOKEN or DISCORD_BOT_TOKENS' : '✓ Discord integration is ready'}
`;

    return {
      text: text.trim(),
      data: settings,
      values: {
        isConfigured: String(settings.isConfigured),
        ignoreBotMessages: String(settings.ignoreBotMessages),
        ignoreDirectMessages: String(settings.ignoreDirectMessages),
        respondOnlyToMentions: String(settings.respondOnlyToMentions),
      },
    };
  },
};

