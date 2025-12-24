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

/**
 * Template for extracting listening activity information from the user's request.
 */
export const setListeningActivityTemplate = `# Messages we are analyzing for setting listening activity
{{recentMessages}}

# Instructions: {{senderName}} is requesting to set the bot's "listening to" activity status.
Extract the following information from their request:
- The activity text they want to display (e.g., "Spotify", "your commands", "the void")
- Whether they want to clear the activity (indicated by words like "clear", "remove", "stop")

Your response must be formatted as a JSON block with this structure:
\`\`\`json
{
  "activityText": "<activity text>",
  "clearActivity": true/false
}
\`\`\`
`;

/**
 * Get listening activity information from the user's request
 * Validates that activityText and clearActivity are proper types
 * to avoid passing undefined to discordService.setListeningActivity
 */
const getListeningActivityInfo = async (
  runtime: IAgentRuntime,
  _message: Memory,
  state: State
): Promise<{ activityText: string; clearActivity: boolean } | null> => {
  const prompt = composePromptFromState({
    state,
    template: setListeningActivityTemplate,
  });

  for (let i = 0; i < 3; i++) {
    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
    });

    const parsedResponse = parseJSONObjectFromText(response) as {
      activityText?: unknown;
      clearActivity?: unknown;
    } | null;

    if (!parsedResponse) {
      continue; // Retry if parsing failed entirely
    }

    // Validate activityText is a string (can be empty for clearing)
    const activityText = parsedResponse.activityText;
    if (typeof activityText !== 'string') {
      runtime.logger.debug(
        { attempt: i + 1, activityText },
        'Invalid activityText from LLM, retrying'
      );
      continue;
    }

    // Validate clearActivity is a boolean
    const clearActivity = parsedResponse.clearActivity;
    if (typeof clearActivity !== 'boolean') {
      runtime.logger.debug(
        { attempt: i + 1, clearActivity },
        'Invalid clearActivity from LLM, retrying'
      );
      continue;
    }

    return {
      activityText: activityText.trim(),
      clearActivity,
    };
  }

  runtime.logger.warn('Failed to get valid listening activity info after 3 attempts');
  return null;
};

export const setListeningActivity: Action = {
  name: 'SET_LISTENING_ACTIVITY',
  similes: [
    'SET_LISTENING_STATUS',
    'SET_LISTENING_TO',
    'UPDATE_LISTENING_STATUS',
    'CHANGE_LISTENING_ACTIVITY',
    'SET_NOW_PLAYING',
    'CLEAR_LISTENING_STATUS',
    'SET_ACTIVITY',
    'UPDATE_STATUS',
    'SET_PRESENCE',
  ],
  description:
    'Set or clear the bot\'s "listening to" activity status. This appears under the bot\'s name in the member list (e.g., "Listening to Spotify").',
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
      // Keep diagnostic logging for debugging
      console.error('Discord service not found or not initialized');
      
      // Notify user of the error before returning
      // Using callback since this is an action handler, not a slash command
      // The message will be delivered through the same channel the user messaged in
      await callback({
        text: 'Discord service is not initialized. Please try again in a moment.',
        source: 'discord',
      });
      return;
    }

    const activityInfo = await getListeningActivityInfo(runtime, message, state);
    if (!activityInfo) {
      console.error("Couldn't parse listening activity information from message");
      await callback({
        text: "I couldn't understand what listening activity you want me to set. Please specify the activity text or ask me to clear it.",
        source: 'discord',
      });
      return;
    }

    try {
      let success = false;
      let responseText = '';

      if (activityInfo.clearActivity) {
        // Clear the activity
        success = await discordService.clearActivity();
        responseText = 'I\'ve cleared my listening activity status.';
      } else {
        // Set the listening activity
        success = await discordService.setListeningActivity(activityInfo.activityText);
        responseText = `I've set my status to "Listening to ${activityInfo.activityText}".`;
      }

      if (success) {
        await runtime.createMemory(
          {
            entityId: message.entityId,
            agentId: message.agentId,
            roomId: message.roomId,
            content: {
              source: 'discord',
              thought: activityInfo.clearActivity
                ? 'I cleared my listening activity'
                : `I set my listening activity to "${activityInfo.activityText}"`,
              actions: ['SET_LISTENING_ACTIVITY_COMPLETED'],
            },
            metadata: {
              type: 'SET_LISTENING_ACTIVITY',
              activityText: activityInfo.activityText,
              cleared: activityInfo.clearActivity,
            },
          },
          'messages'
        );

        const response: Content = {
          text: responseText,
          actions: ['SET_LISTENING_ACTIVITY_RESPONSE'],
          source: message.content.source,
        };

        await callback(response);
      } else {
        await callback({
          text: "I couldn't update my listening activity. Please try again.",
          source: 'discord',
        });
      }
    } catch (error) {
      console.error('Error setting listening activity:', error);
      await callback({
        text: 'I encountered an error while trying to update my listening activity.',
        source: 'discord',
      });
    }
  },
  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Set your status to listening to Spotify',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'I\'ll set my status to "Listening to Spotify".',
          actions: ['SET_LISTENING_ACTIVITY'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Update your listening activity to "your commands"',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'I\'ll update my status to "Listening to your commands".',
          actions: ['SET_LISTENING_ACTIVITY'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Clear your listening status',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll clear my listening activity status.",
          actions: ['SET_LISTENING_ACTIVITY'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Set listening to "lo-fi beats 🎵"',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'I\'ll set my status to "Listening to lo-fi beats 🎵".',
          actions: ['SET_LISTENING_ACTIVITY'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'Stop showing your listening activity',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll stop showing my listening activity.",
          actions: ['SET_LISTENING_ACTIVITY'],
        },
      },
    ],
  ] as ActionExample[][],
} as Action;

export default setListeningActivity;

