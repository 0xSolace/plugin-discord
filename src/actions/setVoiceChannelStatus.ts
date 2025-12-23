import {
  type Action,
  type ActionExample,
  type Content,
  type HandlerCallback,
  type IAgentRuntime,
  type Memory,
  ModelType,
  type State,
  composePromptFromState,
  parseJSONObjectFromText,
} from '@elizaos/core';
import { DiscordService } from '../service';
import { DISCORD_SERVICE_NAME } from '../constants';
import type { BaseGuildVoiceChannel } from 'discord.js';
import { ChannelType as DiscordChannelType } from 'discord.js';

/**
 * Template for extracting voice channel status information from the user's request.
 */
export const setVoiceChannelStatusTemplate = `# Messages we are analyzing for voice channel status update
{{recentMessages}}

# Instructions: {{senderName}} is requesting to set a status on a Discord voice channel.
Extract the following information from their request:
- The channel identifier (name, ID, or mention)
- The status message they want to set (can be empty to clear the status)

Your response must be formatted as a JSON block with this structure:
\`\`\`json
{
  "channelIdentifier": "<channel-name|channel-id|#mention>",
  "statusMessage": "<status text or empty string to clear>"
}
\`\`\`
`;

/**
 * Get voice channel status information from the user's request
 */
const getVoiceChannelStatusInfo = async (
  runtime: IAgentRuntime,
  _message: Memory,
  state: State
): Promise<{ channelIdentifier: string; statusMessage: string } | null> => {
  const prompt = composePromptFromState({
    state,
    template: setVoiceChannelStatusTemplate,
  });

  for (let i = 0; i < 3; i++) {
    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
    });

    const parsedResponse = parseJSONObjectFromText(response) as {
      channelIdentifier: string;
      statusMessage: string;
    } | null;

    if (parsedResponse?.channelIdentifier !== undefined) {
      return parsedResponse;
    }
  }
  return null;
};

/**
 * Find a Discord voice channel by various identifiers
 */
const findVoiceChannel = async (
  discordService: DiscordService,
  identifier: string,
  currentServerId?: string
): Promise<BaseGuildVoiceChannel | null> => {
  if (!discordService.client) return null;

  // Remove channel mention formatting if present
  const cleanId = identifier.replace(/[<#>]/g, '');

  try {
    // Try to fetch by ID first
    if (/^\d+$/.test(cleanId)) {
      try {
        const channel = await discordService.client.channels.fetch(cleanId);
        if (channel?.type === DiscordChannelType.GuildVoice) {
          return channel as BaseGuildVoiceChannel;
        }
      } catch (e) {
        // ID not found, continue to name search
      }
    }

    // Search in the current server if available
    if (currentServerId) {
      const guild = await discordService.client.guilds.fetch(currentServerId);
      const channels = await guild.channels.fetch();

      const channel = channels.find((ch) => {
        const nameMatch =
          ch?.name.toLowerCase() === identifier.toLowerCase() ||
          ch?.name.toLowerCase().replace(/[^a-z0-9 ]/g, '') ===
            identifier.toLowerCase().replace(/[^a-z0-9 ]/g, '');

        return nameMatch && ch.type === DiscordChannelType.GuildVoice;
      });

      if (channel) {
        return channel as BaseGuildVoiceChannel;
      }
    }

    // Search in all guilds the bot is in
    const guilds = Array.from(discordService.client.guilds.cache.values());
    for (const guild of guilds) {
      try {
        const channels = await guild.channels.fetch();
        const channel = channels.find((ch) => {
          const nameMatch =
            ch?.name.toLowerCase() === identifier.toLowerCase() ||
            ch?.name.toLowerCase().replace(/[^a-z0-9 ]/g, '') ===
              identifier.toLowerCase().replace(/[^a-z0-9 ]/g, '');

          return nameMatch && ch.type === DiscordChannelType.GuildVoice;
        });

        if (channel) {
          return channel as BaseGuildVoiceChannel;
        }
      } catch (e) {
        // Continue searching in other guilds
      }
    }

    return null;
  } catch (error) {
    console.error('Error finding voice channel:', error);
    return null;
  }
};

export const setVoiceChannelStatus: Action = {
  name: 'SET_VOICE_CHANNEL_STATUS',
  similes: [
    'UPDATE_VOICE_STATUS',
    'SET_VC_STATUS',
    'CHANGE_VOICE_STATUS',
    'UPDATE_VOICE_CHANNEL_STATUS',
    'SET_VOICE_MESSAGE',
    'CLEAR_VOICE_STATUS',
  ],
  description:
    'Set or clear the status message for a Discord voice channel. The status appears at the top of the voice channel.',
  validate: async (_runtime: IAgentRuntime, message: Memory, _state: State) => {
    if (message.content.source !== 'discord') {
      return false;
    }
    return true;
  },
  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    state: State,
    _options: any,
    callback: HandlerCallback
  ) => {
    const discordService = runtime.getService(DISCORD_SERVICE_NAME) as DiscordService;

    if (!discordService || !discordService.client) {
      console.error('Discord service not found or not initialized');
      return;
    }

    const statusInfo = await getVoiceChannelStatusInfo(runtime, message, state);
    if (!statusInfo) {
      console.error("Couldn't parse voice channel status information from message");
      await callback({
        text: "I couldn't understand which voice channel and what status you want to set. Please specify the channel and status message.",
        source: 'discord',
      });
      return;
    }

    try {
      const room = state.data?.room || (await runtime.getRoom(message.roomId));
      const currentServerId = room?.serverId;

      // Find the voice channel
      const voiceChannel = await findVoiceChannel(
        discordService,
        statusInfo.channelIdentifier,
        currentServerId
      );

      if (!voiceChannel) {
        await callback({
          text: `I couldn't find a voice channel with the identifier "${statusInfo.channelIdentifier}". Please make sure the channel name or ID is correct and I have access to it.`,
          source: 'discord',
        });
        return;
      }

      // Set the voice channel status
      const success = await discordService.setVoiceChannelStatus(
        voiceChannel.id,
        statusInfo.statusMessage
      );

      if (success) {
        const responseText = statusInfo.statusMessage
          ? `I've set the status for ${voiceChannel.name} to: "${statusInfo.statusMessage}"`
          : `I've cleared the status for ${voiceChannel.name}.`;

        await runtime.createMemory(
          {
            entityId: message.entityId,
            agentId: message.agentId,
            roomId: message.roomId,
            content: {
              source: 'discord',
              thought: `I updated the voice channel status for ${voiceChannel.name}`,
              actions: ['SET_VOICE_CHANNEL_STATUS_COMPLETED'],
            },
            metadata: {
              type: 'SET_VOICE_CHANNEL_STATUS',
              channelId: voiceChannel.id,
              channelName: voiceChannel.name,
              status: statusInfo.statusMessage,
            },
          },
          'messages'
        );

        const response: Content = {
          text: responseText,
          actions: ['SET_VOICE_CHANNEL_STATUS_RESPONSE'],
          source: message.content.source,
        };

        await callback(response);
      } else {
        await callback({
          text: `I couldn't set the status for ${voiceChannel.name}. Please make sure I have the necessary permissions.`,
          source: 'discord',
        });
      }
    } catch (error) {
      console.error('Error setting voice channel status:', error);
      await callback({
        text: 'I encountered an error while trying to set the voice channel status. Please make sure I have the necessary permissions.',
        source: 'discord',
      });
    }
  },
  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Set the voice channel status to "Weekly team meeting"',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'I\'ll set the voice channel status to "Weekly team meeting".',
          actions: ['SET_VOICE_CHANNEL_STATUS'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Update the status in general-voice to "Study session"',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'I\'ll update the voice channel status to "Study session".',
          actions: ['SET_VOICE_CHANNEL_STATUS'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Clear the voice channel status',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll clear the voice channel status.",
          actions: ['SET_VOICE_CHANNEL_STATUS'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Set vc status to "Gaming night 🎮"',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'I\'ll set the voice channel status to "Gaming night 🎮".',
          actions: ['SET_VOICE_CHANNEL_STATUS'],
        },
      },
    ],
  ] as ActionExample[][],
} as Action;

export default setVoiceChannelStatus;

