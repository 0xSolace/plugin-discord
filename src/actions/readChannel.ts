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
} from "@elizaos/core";
import { DiscordService } from "../service";
import { DISCORD_SERVICE_NAME } from "../constants";
import { PermissionsBitField, type TextChannel } from "discord.js";

/**
 * Template for extracting channel information from the user's request.
 *
 * @type {string}
 * @description This template is used to determine which channel the user wants to read messages from,
 * and optionally how many messages to retrieve.
 *
 * @param {string} recentMessages - Placeholder for recent messages related to the request.
 * @param {string} senderName - Name of the sender requesting channel messages.
 *
 * @returns {string} - Formatted template with instructions and JSON structure for response.
 */
export const channelInfoTemplate = `# Messages we are searching for channel information
  {{recentMessages}}
  
  # Instructions: {{senderName}} is requesting to read messages from a specific Discord channel. Your goal is to determine:
  1. The channel they want to read from (could be the current channel or a mentioned channel)
  2. How many messages they want to read (default to 10 if not specified)
  
  If they say "this channel" or "here", use the current channel.
  If they mention a specific channel name or ID, extract that.
  
  Your response must be formatted as a JSON block with this structure:
  \`\`\`json
  {
    "channelIdentifier": "<current|channel-name|channel-id>",
    "messageCount": <number between 1 and 50>
  }
  \`\`\`
  `;

/**
 * Get channel information from the user's request
 * @param {IAgentRuntime} runtime - The runtime object to interact with the agent.
 * @param {Memory} _message - The memory object containing the input message.
 * @param {State} state - The state of the conversation.
 * @returns {Promise<{channelIdentifier: string, messageCount: number} | null>} Channel info or null if not parseable.
 */
const getChannelInfo = async (
  runtime: IAgentRuntime,
  _message: Memory,
  state: State
): Promise<{ channelIdentifier: string; messageCount: number } | null> => {
  const prompt = composePromptFromState({
    state,
    template: channelInfoTemplate,
  });

  for (let i = 0; i < 3; i++) {
    const response = await runtime.useModel(ModelType.TEXT_SMALL, {
      prompt,
    });

    const parsedResponse = parseJSONObjectFromText(response) as {
      channelIdentifier: string;
      messageCount: number;
    } | null;

    if (parsedResponse?.channelIdentifier) {
      // Ensure messageCount is within bounds
      const messageCount = Math.min(
        Math.max(parsedResponse.messageCount || 10, 1),
        50
      );
      return {
        channelIdentifier: parsedResponse.channelIdentifier,
        messageCount,
      };
    }
  }
  return null;
};

export const readChannel: Action = {
  name: "READ_CHANNEL",
  similes: [
    "READ_MESSAGES",
    "GET_CHANNEL_MESSAGES",
    "FETCH_MESSAGES",
    "SHOW_CHANNEL_HISTORY",
    "GET_CHAT_HISTORY",
    "READ_CHAT",
  ],
  description:
    "Reads recent messages from a Discord channel and returns them to the user.",
  validate: async (_runtime: IAgentRuntime, message: Memory, _state: State) => {
    if (message.content.source !== "discord") {
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
    const discordService = runtime.getService(
      DISCORD_SERVICE_NAME
    ) as DiscordService;

    if (!discordService || !discordService.client) {
      console.error("Discord service not found or not initialized");
      return;
    }

    const channelInfo = await getChannelInfo(runtime, message, state);
    if (!channelInfo) {
      console.error("Couldn't parse channel information from message");
      await callback({
        text: "I couldn't understand which channel you want me to read from. Please specify the channel name or say 'this channel' for the current channel.",
        source: "discord",
      });
      return;
    }

    try {
      let targetChannel: TextChannel | null = null;
      const room = state.data?.room || (await runtime.getRoom(message.roomId));

      // Determine the target channel
      if (
        channelInfo.channelIdentifier === "current" ||
        channelInfo.channelIdentifier === "this" ||
        channelInfo.channelIdentifier === "here"
      ) {
        // Use current channel
        if (room?.channelId) {
          targetChannel = (await discordService.client.channels.fetch(
            room.channelId
          )) as TextChannel;
        }
      } else if (channelInfo.channelIdentifier.match(/^\d+$/)) {
        // It's a channel ID
        targetChannel = (await discordService.client.channels.fetch(
          channelInfo.channelIdentifier
        )) as TextChannel;
      } else if (room?.serverId) {
        // It's a channel name - search in the current server
        const guild = await discordService.client.guilds.fetch(room.serverId);
        const channels = await guild.channels.fetch();

        targetChannel =
          (channels.find(
            (channel) =>
              channel?.name
                .toLowerCase()
                .includes(channelInfo.channelIdentifier.toLowerCase()) &&
              channel.isTextBased()
          ) as TextChannel | undefined) || null;
      }

      if (!targetChannel || !targetChannel.isTextBased()) {
        await callback({
          text: "I couldn't find that channel or I don't have access to it. Make sure the channel exists and I have permission to read messages there.",
          source: "discord",
        });
        return;
      }

      // Check permissions
      const botMember = targetChannel.guild?.members.cache.get(
        discordService.client.user!.id
      );
      if (botMember) {
        const permissions = targetChannel.permissionsFor(botMember);
        if (!permissions?.has(PermissionsBitField.Flags.ReadMessageHistory)) {
          await callback({
            text: "I don't have permission to read message history in that channel.",
            source: "discord",
          });
          return;
        }
      }

      // Fetch messages
      const messages = await targetChannel.messages.fetch({
        limit: channelInfo.messageCount,
      });

      if (messages.size === 0) {
        await callback({
          text: `No messages found in <#${targetChannel.id}>.`,
          source: "discord",
        });
        return;
      }

      // Format messages for display
      const formattedMessages = Array.from(messages.values())
        .reverse() // Show oldest first
        .map((msg) => {
          const timestamp = new Date(msg.createdTimestamp).toLocaleString();
          const author = msg.author.username;
          const content = msg.content || "[No text content]";
          const attachments =
            msg.attachments.size > 0
              ? `\n📎 Attachments: ${msg.attachments.map((a) => a.name || "unnamed").join(", ")}`
              : "";

          return `**${author}** (${timestamp}):\n${content}${attachments}`;
        })
        .join("\n\n---\n\n");

      const response: Content = {
        text: `Here are the last ${messages.size} messages from <#${targetChannel.id}>:\n\n${formattedMessages}`,
        actions: ["READ_CHANNEL_RESPONSE"],
        source: message.content.source,
      };

      await callback(response);
    } catch (error) {
      console.error("Error reading channel:", error);
      await callback({
        text: "I encountered an error while trying to read the channel messages. Please make sure I have the necessary permissions and try again.",
        source: "discord",
      });
    }
  },
  examples: [
    [
      {
        name: "{{name1}}",
        content: {
          text: "Can you read the last 20 messages from this channel?",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "I'll read the last 20 messages from this channel for you.",
          actions: ["READ_CHANNEL"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Show me what's been said in #general",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "Let me fetch the recent messages from #general.",
          actions: ["READ_CHANNEL"],
        },
      },
    ],
    [
      {
        name: "{{name1}}",
        content: {
          text: "Read messages here",
        },
      },
      {
        name: "{{name2}}",
        content: {
          text: "I'll read the recent messages from this channel.",
          actions: ["READ_CHANNEL"],
        },
      },
    ],
  ] as ActionExample[][],
} as Action;

export default readChannel;
