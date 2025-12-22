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
import { type TextChannel, type Message } from 'discord.js';

/**
 * Template for extracting reaction information from the user's request.
 */
export const reactToMessageTemplate = `# Adding reactions to Discord messages
{{recentMessages}}

# Instructions: {{senderName}} wants to add a reaction to a message. Extract:
1. Which message to react to (last, specific message reference, or by content)
2. What emoji/reaction to add

Examples:
- "react with 👍 to the last message" -> messageRef: "last", emoji: "👍"
- "add :fire: reaction" -> messageRef: "last", emoji: "🔥" or ":fire:"
- "react to that message with ❤️" -> messageRef: "previous", emoji: "❤️"
- "add a thumbs up to john's message about the meeting" -> messageRef: "john meeting", emoji: "👍"

Your response must be formatted as a JSON block:
\`\`\`json
{
  "messageRef": "<last|previous|message-id|search-text>",
  "emoji": "<emoji-character|:emoji-name:>"
}
\`\`\`
`;

/**
 * Extract emojis from text using Unicode emoji regex
 * WHY: LLMs often include the emoji they want to react with in their response text.
 * Extracting it directly is faster and more reliable than an LLM call.
 */
function extractEmojisFromText(text: string): string[] {
  if (!text) return [];

  const emojis: string[] = [];

  // Match Unicode emojis (including multi-codepoint sequences)
  const unicodeEmojiRegex = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})(?:\uFE0F)?(?:\u200D(?:\p{Emoji_Presentation}|\p{Extended_Pictographic})(?:\uFE0F)?)*/gu;

  const unicodeMatches = text.match(unicodeEmojiRegex);
  if (unicodeMatches) {
    emojis.push(...unicodeMatches);
  }

  // Match Discord custom emojis <:name:id> or <a:name:id>
  const customEmojiRegex = /<a?:\w+:\d+>/g;
  const customMatches = text.match(customEmojiRegex);
  if (customMatches) {
    emojis.push(...customMatches);
  }

  return emojis;
}

// Common Discord emoji mappings
const emojiMap: Record<string, string> = {
  ':thumbsup:': '👍',
  ':thumbs_up:': '👍',
  ':+1:': '👍',
  ':thumbsdown:': '👎',
  ':thumbs_down:': '👎',
  ':-1:': '👎',
  ':heart:': '❤️',
  ':fire:': '🔥',
  ':star:': '⭐',
  ':check:': '✅',
  ':white_check_mark:': '✅',
  ':x:': '❌',
  ':cross:': '❌',
  ':smile:': '😄',
  ':laughing:': '😆',
  ':thinking:': '🤔',
  ':eyes:': '👀',
  ':clap:': '👏',
  ':wave:': '👋',
  ':ok:': '👌',
  ':ok_hand:': '👌',
  ':raised_hands:': '🙌',
  ':pray:': '🙏',
  ':100:': '💯',
  ':rocket:': '🚀',
};

export const reactToMessage: Action = {
  name: 'REACT_TO_MESSAGE',
  similes: [
    'REACT_TO_MESSAGE',
    'ADD_REACTION',
    'REACT_MESSAGE',
    'ADD_EMOJI',
    'EMOJI_REACT',
    'MESSAGE_REACTION',
  ],
  description: 'Add an emoji reaction to a Discord message.',
  validate: async (_runtime: IAgentRuntime, message: Memory, _state: State) => {
    return message.content.source === 'discord';
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
      await callback({
        text: 'Discord service is not available.',
        source: 'discord',
      });
      return;
    }

    // ============================================================================
    // Extract reaction info - try fast path first, then LLM fallback
    // ============================================================================
    let reactionInfo: { messageRef: string; emoji: string } | null = null;

    // FAST PATH: Try to extract emoji from context (no LLM call needed)
    // WHY: When the agent says "I'll react with 👍", we can extract it directly.
    const responseText = state.data?.responseText ||
      state.data?.text ||
      (state as any).responseText ||
      '';

    if (responseText) {
      const emojis = extractEmojisFromText(responseText);
      if (emojis.length > 0) {
        runtime.logger.debug(
          { src: 'plugin:discord:action:react', emoji: emojis[0], source: 'responseText' },
          `[REACT_TO_MESSAGE] Found emoji in response text`
        );
        reactionInfo = { messageRef: 'last', emoji: emojis[0] };
      }
    }

    if (!reactionInfo) {
      // Check recent messages for this agent's last message
      const recentMessages = (state.data?.recentMessages || []) as Memory[];
      const agentLastMessage = recentMessages
        .filter(m => m.entityId === runtime.agentId)
        .pop();

      if (agentLastMessage?.content?.text) {
        const emojis = extractEmojisFromText(agentLastMessage.content.text);
        if (emojis.length > 0) {
          runtime.logger.debug(
            { src: 'plugin:discord:action:react', emoji: emojis[0], source: 'agentLastMessage' },
            `[REACT_TO_MESSAGE] Found emoji in agent's last message`
          );
          reactionInfo = { messageRef: 'last', emoji: emojis[0] };
        }
      }
    }

    if (!reactionInfo) {
      // SLOW PATH: Use LLM to extract reaction info from the conversation
      const prompt = composePromptFromState({
        state,
        template: reactToMessageTemplate,
      });

      for (let i = 0; i < 3; i++) {
        const response = await runtime.useModel(ModelType.TEXT_SMALL, {
          prompt,
        });

        const parsedResponse = parseJSONObjectFromText(response);
        if (parsedResponse?.emoji) {
          reactionInfo = {
            messageRef: parsedResponse.messageRef || 'last',
            emoji: parsedResponse.emoji,
          };
          break;
        }
      }
    }

    if (!reactionInfo) {
      // SILENT FAILURE: Don't send confusing error message
      // WHY: When the agent decides to react on its own (not from user request),
      // sending "I couldn't understand..." is confusing to users.
      runtime.logger.debug(
        { src: 'plugin:discord:action:react' },
        `[REACT_TO_MESSAGE] Could not extract reaction info - skipping silently`
      );
      return;
    }

    try {
      const room = state.data?.room || (await runtime.getRoom(message.roomId));
      if (!room?.channelId) {
        await callback({
          text: "I couldn't determine the current channel.",
          source: 'discord',
        });
        return;
      }

      const channel = await discordService.client.channels.fetch(room.channelId);
      if (!channel || !channel.isTextBased()) {
        await callback({
          text: 'I can only react to messages in text channels.',
          source: 'discord',
        });
        return;
      }

      const textChannel = channel as TextChannel;

      let targetMessage: Message | null = null;

      // Find the target message
      if (reactionInfo.messageRef === 'last' || reactionInfo.messageRef === 'previous') {
        // Get the last few messages - fetch max allowed by Discord API
        const messages = await textChannel.messages.fetch({ limit: 100 });
        const sortedMessages = Array.from(messages.values()).sort(
          (a, b) => b.createdTimestamp - a.createdTimestamp
        );

        // Skip the bot's own message and the command message
        targetMessage =
          sortedMessages.find(
            (msg) =>
              msg.id !== message.content.id && msg.author.id !== discordService.client!.user!.id
          ) || null;
      } else if (/^\d+$/.test(reactionInfo.messageRef)) {
        // It's a message ID
        try {
          targetMessage = await textChannel.messages.fetch(reactionInfo.messageRef);
        } catch (e) {
          // Message not found
        }
      } else {
        // Search for message by content/author - fetch max allowed by Discord API
        const messages = await textChannel.messages.fetch({ limit: 100 });
        const searchLower = reactionInfo.messageRef.toLowerCase();

        targetMessage =
          Array.from(messages.values()).find((msg) => {
            const contentMatch = msg.content.toLowerCase().includes(searchLower);
            const authorMatch = msg.author.username.toLowerCase().includes(searchLower);
            return contentMatch || authorMatch;
          }) || null;
      }

      if (!targetMessage) {
        await callback({
          text: "I couldn't find the message you want me to react to. Try being more specific or use 'last message'.",
          source: 'discord',
        });
        return;
      }

      // Normalize the emoji
      let emoji = reactionInfo.emoji;
      if (!/\p{Emoji}/u.test(emoji)) {
        const mapped = emojiMap[emoji.toLowerCase()];
        if (mapped) {
          emoji = mapped;
        } else if (!/<a?:\w+:\d+>/.test(emoji)) {
          // Not a custom emoji, remove colons
          emoji = emoji.replace(/:/g, '');
        }
      }

      // Add the reaction
      try {
        await targetMessage.react(emoji);

        const response: Content = {
          text: `I've added a ${emoji} reaction to the message.`,
          source: message.content.source,
        };

        await callback(response);
      } catch (error) {
        runtime.logger.error({ src: 'plugin:discord:action:react-to-message', agentId: runtime.agentId, emoji: reactionInfo.emoji, error: error instanceof Error ? error.message : String(error) }, 'Failed to add reaction');
        await callback({
          text: `I couldn't add that reaction. Make sure the emoji "${reactionInfo.emoji}" is valid and I have permission to add reactions.`,
          source: 'discord',
        });
      }
    } catch (error) {
      runtime.logger.error({ src: 'plugin:discord:action:react-to-message', agentId: runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error in react to message');
      await callback({
        text: 'I encountered an error while trying to react to the message. Please make sure I have the necessary permissions.',
        source: 'discord',
      });
    }
  },
  examples: [
    [
      {
        name: '{{name1}}',
        content: {
          text: 'react with 👍 to the last message',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll add a thumbs up reaction to the last message.",
          actions: ['REACT_TO_MESSAGE'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: 'add a fire emoji to that',
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: 'Adding a 🔥 reaction.',
          actions: ['REACT_TO_MESSAGE'],
        },
      },
    ],
    [
      {
        name: '{{name1}}',
        content: {
          text: "react to john's message about the meeting with a checkmark",
        },
      },
      {
        name: '{{name2}}',
        content: {
          text: "I'll find john's message about the meeting and add a ✅ reaction.",
          actions: ['REACT_TO_MESSAGE'],
        },
      },
    ],
  ] as ActionExample[][],
} as Action;

export default reactToMessage;
