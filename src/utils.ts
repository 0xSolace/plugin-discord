import {
  type IAgentRuntime,
  ModelType,
  logger,
  parseJSONObjectFromText,
  trimTokens,
  type Media,
} from '@elizaos/core';
import {
  AttachmentBuilder,
  ChannelType,
  type Message as DiscordMessage,
  PermissionsBitField,
  type TextChannel,
  ThreadChannel,
} from 'discord.js';
import { type DiscordComponentOptions, type DiscordActionRow } from './types';

export const MAX_MESSAGE_LENGTH = 1900;

/**
 * Cleans a URL by removing common trailing junk from Discord messages:
 * - Markdown escape backslashes (t\.co -> t.co)
 * - Markdown link leakage (url](url -> url)
 * - Trailing punctuation and markdown (*_/.,;!>)
 * - Trailing non-ASCII characters (Korean, CJK, full-width parens)
 * 
 * @param {string} url - The raw URL to clean
 * @returns {string} The cleaned URL
 */
export function cleanUrl(url: string): string {
  let clean = url;

  // 1. Remove markdown escape backslashes (e.g. "t\.co" -> "t.co")
  clean = clean.replace(/\\([._\-~])/g, '$1');

  // 2. Handle markdown link leakage (e.g. "url](url")
  const bracketIdx = clean.indexOf(']');
  if (bracketIdx > -1) {
    clean = clean.substring(0, bracketIdx);
  }

  // 3. Remove trailing junk in a loop - handles layered issues like:
  //    - Punctuation/markdown: "site.com**/" -> "site.com"
  //    - Non-ASCII (Korean, full-width parens): "site.com）" -> "site.com"
  //    - Mixed: "site.com/path）**" -> "site.com/path"
  let prev = '';
  while (prev !== clean) {
    prev = clean;
    // Strip trailing ASCII punctuation and markdown
    clean = clean.replace(/[)\]>.,;!*_/]+$/, '');
    // Strip trailing non-ASCII (Korean, CJK, full-width chars like ）)
    clean = clean.replace(/[\u0080-\uFFFF]+$/, '');
  }

  return clean;
}

/**
 * Extracts and cleans URLs from text content.
 * Handles Discord-specific URL formatting issues.
 * 
 * @param {string} text - The text to extract URLs from
 * @param {IAgentRuntime} [runtime] - Optional runtime for debug logging
 * @returns {string[]} Array of cleaned, valid URLs
 */
export function extractUrls(text: string, runtime?: IAgentRuntime): string[] {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const rawUrls = text.match(urlRegex) || [];

  return rawUrls
    .map(url => {
      const original = url;
      const clean = cleanUrl(url);

      // Debug log if URL was cleaned
      if (runtime && original !== clean) {
        runtime.logger.debug(`URL cleaned: "${original}" -> "${clean}"`);
      }

      return clean;
    })
    .filter(url => {
      // Basic validation to ensure it's still a valid URL after cleanup
      try {
        new URL(url);
        return true;
      } catch {
        if (runtime) {
          runtime.logger.debug(`Invalid URL after cleanup, skipping: "${url}"`);
        }
        return false;
      }
    });
}

/**
 * Generates a filename with proper extension from Media object.
 * Extracts extension from URL if available, otherwise infers from contentType.
 *
 * @param {Media} media - The media object to generate filename for.
 * @returns {string} A filename with appropriate extension.
 */
export function getAttachmentFileName(media: Media): string {
  // Try to extract extension from URL first
  let extension = '';
  try {
    const urlPath = new URL(media.url).pathname;
    const urlExtension = urlPath.substring(urlPath.lastIndexOf('.'));
    if (urlExtension && urlExtension.length > 1 && urlExtension.length <= 5) {
      extension = urlExtension;
    }
  } catch {
    // If URL parsing fails, try simple string extraction
    const lastDot = media.url.lastIndexOf('.');
    const queryStart = media.url.indexOf('?', lastDot);
    if (lastDot > 0 && (queryStart === -1 || queryStart > lastDot + 1)) {
      const potentialExt = media.url.substring(lastDot, queryStart > -1 ? queryStart : undefined);
      if (potentialExt.length > 1 && potentialExt.length <= 5) {
        extension = potentialExt;
      }
    }
  }

  // If no extension from URL, infer from contentType
  if (!extension && media.contentType) {
    const contentTypeMap: Record<string, string> = {
      image: '.png',
      video: '.mp4',
      audio: '.mp3',
      document: '.txt',
      link: '.html',
    };
    extension = contentTypeMap[media.contentType] || '';
  }

  // Default to .txt if still no extension (for text/document files)
  if (!extension) {
    extension = '.txt';
  }

  // Get base name from title or id
  const baseName = media.title || media.id || 'attachment';

  // Check if base name already has an extension
  const hasExtension = /\.\w{1,5}$/i.test(baseName);

  // Return filename with extension
  return hasExtension ? baseName : `${baseName}${extension}`;
}

/**
 * Generates a summary for a given text using a specified model.
 *
 * @param {IAgentRuntime} runtime - The IAgentRuntime instance.
 * @param {string} text - The text for which to generate a summary.
 * @returns {Promise<{ title: string; description: string }>} An object containing the generated title and summary.
 */
export async function generateSummary(
  runtime: IAgentRuntime,
  text: string
): Promise<{ title: string; description: string }> {
  // make sure text is under 128k characters
  text = await trimTokens(text, 100000, runtime);

  if (!text) {
    return {
      title: '',
      description: '',
    };
  }

  // Optimization: If text is short enough, do not invoke LLM for summary
  // 1000 characters is roughly 200-250 words, which is already concise enough
  if (text.length < 1000) {
    return {
      title: '', // Caller will provide default title
      description: text,
    };
  }

  runtime.logger.info(`[Summarization] Calling TEXT_SMALL for ${text.length} chars: "${text.substring(0, 50).replace(/\n/g, ' ')}..."`);

  const prompt = `Please generate a concise summary for the following text:

  Text: """
  ${text}
  """

  Respond with a JSON object in the following format:
  \`\`\`json
  {
    "title": "Generated Title",
    "summary": "Generated summary and/or description of the text"
  }
  \`\`\``;

  const response = await runtime.useModel(ModelType.TEXT_SMALL, {
    prompt,
  });

  const parsedResponse = parseJSONObjectFromText(response);

  if (parsedResponse?.title && parsedResponse?.summary) {
    return {
      title: parsedResponse.title,
      description: parsedResponse.summary,
    };
  }

  return {
    title: '',
    description: '',
  };
}

/**
 * Sends a message in chunks to a specified Discord TextChannel.
 * @param {TextChannel} channel - The Discord TextChannel to send the message to.
 * @param {string} content - The content of the message to be sent.
 * @param {string} inReplyTo - The message ID to reply to (if applicable).
 * @param {any[]} files - Array of files to attach to the message (AttachmentBuilder or plain objects).
 * @param {any[]} components - Optional components to add to the message (buttons, dropdowns, etc.).
 * @returns {Promise<DiscordMessage[]>} - Array of sent Discord messages.
 */
export async function sendMessageInChunks(
  channel: TextChannel,
  content: string,
  inReplyTo: string,
  files: Array<AttachmentBuilder | { attachment: Buffer | string; name: string }>,
  components?: DiscordActionRow[],
  runtime?: IAgentRuntime
): Promise<DiscordMessage[]> {
  const sentMessages: DiscordMessage[] = [];

  // Use smart splitting if runtime available and content is complex
  let messages: string[];
  if (runtime && content.length > MAX_MESSAGE_LENGTH && needsSmartSplit(content)) {
    messages = await smartSplitMessage(runtime, content);
  } else {
    messages = splitMessage(content);
  }
  try {
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (
        message.trim().length > 0 ||
        (i === messages.length - 1 && files && files.length > 0) ||
        components
      ) {
        const options: any = {
          content: message.trim(),
        };

        if (i === 0 && inReplyTo) {
          // Reply to the specified message for the first chunk
          options.reply = {
            messageReference: inReplyTo,
          };
        }

        // Attach files to the last message chunk
        if (i === messages.length - 1 && files && files.length > 0) {
          options.files = files;
        }

        // Add components to the last message or to a message with components only
        if (i === messages.length - 1 && components && components.length > 0) {
          try {
            // Safe JSON stringify that handles BigInt
            const safeStringify = (obj: any) => {
              return JSON.stringify(obj, (_, value) =>
                typeof value === 'bigint' ? value.toString() : value
              );
            };

            logger.info(`Components received: ${safeStringify(components)}`);

            if (!Array.isArray(components)) {
              logger.warn('Components is not an array, skipping component processing');
              // Instead of continue, maybe return or handle differently?
              // For now, let's proceed assuming it might be an empty message with components
            } else if (
              components.length > 0 &&
              components[0] &&
              'toJSON' in components[0] &&
              typeof (components[0] as any).toJSON === 'function'
            ) {
              // If it looks like discord.js components, pass them directly
              options.components = components as any;
            } else {
              // Otherwise, build components from the assumed DiscordActionRow[] structure
              const {
                ActionRowBuilder,
                ButtonBuilder,
                StringSelectMenuBuilder,
              } = require('discord.js');

              const discordComponents = (components as DiscordActionRow[]) // Cast here for building logic
                .map((row: DiscordActionRow) => {
                  if (!row || typeof row !== 'object' || row.type !== 1) {
                    logger.warn('Invalid component row structure, skipping');
                    return null;
                  }

                  if (row.type === 1) {
                    const actionRow = new ActionRowBuilder();

                    if (!Array.isArray(row.components)) {
                      logger.warn('Row components is not an array, skipping');
                      return null;
                    }

                    const validComponents = row.components
                      .map((comp: DiscordComponentOptions) => {
                        if (!comp || typeof comp !== 'object') {
                          logger.warn('Invalid component, skipping');
                          return null;
                        }

                        try {
                          if (comp.type === 2) {
                            return new ButtonBuilder()
                              .setCustomId(comp.custom_id)
                              .setLabel(comp.label || '')
                              .setStyle(comp.style || 1);
                          }

                          if (comp.type === 3) {
                            const selectMenu = new StringSelectMenuBuilder()
                              .setCustomId(comp.custom_id)
                              .setPlaceholder(comp.placeholder || 'Select an option');

                            if (typeof comp.min_values === 'number')
                              selectMenu.setMinValues(comp.min_values);
                            if (typeof comp.max_values === 'number')
                              selectMenu.setMaxValues(comp.max_values);

                            if (Array.isArray(comp.options)) {
                              selectMenu.addOptions(
                                comp.options.map((option) => ({
                                  label: option.label,
                                  value: option.value,
                                  description: option.description,
                                }))
                              );
                            }

                            return selectMenu;
                          }
                        } catch (err) {
                          logger.error(`Error creating component: ${err}`);
                          return null;
                        }
                        return null;
                      })
                      .filter(Boolean);

                    if (validComponents.length > 0) {
                      actionRow.addComponents(validComponents);
                      return actionRow;
                    }
                  }
                  return null;
                })
                .filter(Boolean);

              if (discordComponents.length > 0) {
                options.components = discordComponents;
              }
            }
          } catch (error) {
            logger.error(`Error processing components: ${error}`);
          }
        }

        const m = await channel.send(options);
        sentMessages.push(m);
      }
    }
  } catch (error) {
    logger.error(`Error sending message: ${error}`);
  }

  return sentMessages;
}

/**
 * Detects if content needs smart (LLM-based) splitting or can use simple line-based splitting.
 * Smart splitting is useful for:
 * - Code blocks that shouldn't be split mid-block
 * - Markdown with headers and sections
 * - Numbered lists that should stay together
 * 
 * @param {string} content - The content to analyze
 * @returns {boolean} True if smart splitting would be beneficial
 */
export function needsSmartSplit(content: string): boolean {
  // Check for code blocks - these shouldn't be split mid-block
  const codeBlockCount = (content.match(/```/g) || []).length;
  if (codeBlockCount >= 2) return true;

  // Check for markdown headers - content has structure
  if (/^#{1,3}\s/m.test(content)) return true;

  // Check for numbered lists (1. 2. 3.) - should stay together when possible
  if (/^\d+\.\s/m.test(content)) return true;

  // Check for very long lines without natural breakpoints
  const lines = content.split('\n');
  const hasLongUnbreakableLines = lines.some(line =>
    line.length > 500 && !line.includes('. ') && !line.includes(', ')
  );
  if (hasLongUnbreakableLines) return true;

  return false;
}

/**
 * Splits content using LLM for semantic breakpoints.
 * Only use when needsSmartSplit() returns true and runtime is available.
 * 
 * @param {IAgentRuntime} runtime - The runtime for LLM calls
 * @param {string} content - The content to split
 * @param {number} maxLength - Maximum length per chunk
 * @returns {Promise<string[]>} Array of semantically-split chunks
 */
export async function smartSplitMessage(
  runtime: IAgentRuntime,
  content: string,
  maxLength: number = MAX_MESSAGE_LENGTH
): Promise<string[]> {
  // If content fits, no splitting needed
  if (content.length <= maxLength) {
    return [content];
  }

  // Calculate approximate number of chunks needed
  const estimatedChunks = Math.ceil(content.length / (maxLength - 100));

  try {
    runtime.logger.debug(`Smart splitting ${content.length} chars into ~${estimatedChunks} chunks`);

    const prompt = `Split the following text into ${estimatedChunks} parts for Discord messages (max ${maxLength} chars each).
Keep related content together (don't split code blocks, keep list items with their headers, etc.).
Return ONLY a JSON array of strings, no explanation.

Text to split:
"""
${content}
"""

Return format: ["chunk1", "chunk2", ...]`;

    const response = await runtime.useModel(ModelType.TEXT_SMALL, { prompt });

    // Try to parse as JSON array
    const parsed = parseJSONObjectFromText(response);
    if (Array.isArray(parsed)) {
      // Validate each chunk is under limit, fall back to simple split if not
      const validChunks = parsed.every((chunk: string) =>
        typeof chunk === 'string' && chunk.length <= maxLength
      );

      if (validChunks && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (error) {
    runtime.logger.debug(`Smart split failed, falling back to simple split: ${error}`);
  }

  // Fall back to simple splitting
  return splitMessage(content, maxLength);
}

/**
 * Splits the content into an array of strings based on the maximum message length.
 * Uses simple line-based splitting. For complex content, use smartSplitMessage().
 * 
 * @param {string} content - The content to split into messages
 * @param {number} maxLength - Maximum length per message (default: 1900)
 * @returns {string[]} An array of strings that represent the split messages
 */
export function splitMessage(content: string, maxLength: number = MAX_MESSAGE_LENGTH): string[] {
  // If content fits, no splitting needed
  if (!content || content.length <= maxLength) {
    return content ? [content] : [];
  }

  const messages: string[] = [];
  let currentMessage = '';

  const rawLines = content.split('\n');
  // split all lines into maxLength chunks so any long lines are split
  const lines = rawLines.flatMap((line) => {
    const chunks: string[] = [];
    while (line.length > maxLength) {
      // Try to split at word boundary
      let splitIdx = maxLength;
      const lastSpace = line.lastIndexOf(' ', maxLength);
      if (lastSpace > maxLength * 0.7) {
        splitIdx = lastSpace;
      }
      chunks.push(line.slice(0, splitIdx));
      line = line.slice(splitIdx).trimStart();
    }
    chunks.push(line);
    return chunks;
  });

  for (const line of lines) {
    if (currentMessage.length + line.length + 1 > maxLength) {
      if (currentMessage.trim().length > 0) {
        messages.push(currentMessage.trim());
      }
      currentMessage = '';
    }
    currentMessage += `${line}\n`;
  }

  if (currentMessage.trim().length > 0) {
    messages.push(currentMessage.trim());
  }

  return messages;
}

/**
 * Checks if the bot can send messages in a given channel by checking permissions.
 * @param {TextChannel | NewsChannel | ThreadChannel} channel - The channel to check permissions for.
 * @returns {Object} Object containing information about whether the bot can send messages or not.
 * @returns {boolean} canSend - Whether the bot can send messages in the channel.
 * @returns {string} reason - The reason why the bot cannot send messages, if applicable.
 * @returns {string[]} missingPermissions - Array of missing permissions, if any.
 */
export function canSendMessage(channel) {
  // validate input
  if (!channel) {
    return {
      canSend: false,
      reason: 'No channel given',
    };
  }
  // if it is a DM channel, we can always send messages
  if (channel.type === ChannelType.DM) {
    return {
      canSend: true,
      reason: null,
    };
  }
  const botMember = channel.guild?.members.cache.get(channel.client.user.id);

  if (!botMember) {
    return {
      canSend: false,
      reason: 'Not a guild channel or bot member not found',
    };
  }

  // Required permissions for sending messages
  const requiredPermissions = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.ReadMessageHistory,
  ];

  // Add thread-specific permission if it's a thread
  if (channel instanceof ThreadChannel) {
    requiredPermissions.push(PermissionsBitField.Flags.SendMessagesInThreads);
  }

  // Check permissions
  const permissions = channel.permissionsFor(botMember);

  if (!permissions) {
    return {
      canSend: false,
      reason: 'Could not retrieve permissions',
    };
  }

  // Check each required permission
  const missingPermissions = requiredPermissions.filter((perm) => !permissions.has(perm));

  return {
    canSend: missingPermissions.length === 0,
    missingPermissions: missingPermissions,
    reason:
      missingPermissions.length > 0
        ? `Missing permissions: ${missingPermissions.map((p) => String(p)).join(', ')}`
        : null,
  };
}
