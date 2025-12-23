import {
  ChannelType,
  type Content,
  EventType,
  type HandlerCallback,
  type Media,
  type Memory,
  ServiceType,
  stringToUuid,
  type UUID,
  createUniqueUuid,
} from '@elizaos/core';

// See service.ts for detailed documentation on Discord ID handling.
// Key point: Discord snowflake IDs (e.g., "1253563208833433701") are NOT valid UUIDs.
// Use stringToUuid() to convert them, not asUUID() which would throw an error.
import type { ICompatRuntime } from './compat';
import {
  type Channel,
  type Client,
  ChannelType as DiscordChannelType,
  type Message as DiscordMessage,
  type TextChannel,
  AttachmentBuilder,
} from 'discord.js';
import { AttachmentManager } from './attachments';
import { getDiscordSettings } from './environment';
import { DiscordSettings, IDiscordService } from './types';
import {
  canSendMessage,
  extractUrls,
  getAttachmentFileName,
  getMessageService,
  getUnifiedMessagingAPI,
  editMessageContent,
  sendMessageInChunks,
} from './utils';

/**
 * Class representing a Message Manager for handling Discord messages.
 */

export class MessageManager {
  private client: Client;
  private runtime: ICompatRuntime;
  private attachmentManager: AttachmentManager;
  private getChannelType: (channel: Channel) => Promise<ChannelType>;
  private discordSettings: DiscordSettings;
  private discordService: IDiscordService;
  private progressiveMessages: Map<string, {
    message: DiscordMessage;
    timeout: NodeJS.Timeout;
  }> = new Map();
  /**
   * Constructor for a new instance of MessageManager.
   * @param {IDiscordService} discordService - The Discord service instance.
   * @param {ICompatRuntime} runtime - The agent runtime instance (with cross-core compat).
   * @throws {Error} If the Discord client is not initialized
   */
  constructor(discordService: IDiscordService, runtime: ICompatRuntime) {
    // Guard against null client - fail fast with a clear error
    if (!discordService.client) {
      const errorMsg = 'Discord client not initialized - cannot create MessageManager';
      runtime.logger.error({ src: 'plugin:discord', agentId: runtime.agentId }, errorMsg);
      throw new Error(errorMsg);
    }

    this.client = discordService.client;
    this.runtime = runtime;
    this.attachmentManager = new AttachmentManager(this.runtime);
    this.getChannelType = discordService.getChannelType;
    this.discordService = discordService;
    // Load Discord settings with proper priority (env vars > character settings > defaults)
    this.discordSettings = getDiscordSettings(this.runtime);
  }


  /**
   * Track a progressive message with TTL cleanup
   * 
   * Why track messages: When an action sends multiple updates with the same
   * correlation ID, we need to remember which Discord message to edit. This
   * map stores the message reference so we can edit it later.
   * 
   * Why 60-second TTL: If an action crashes, hangs, or throws an exception
   * before calling complete/fail, we'd leak memory forever. The TTL ensures
   * stale entries are cleaned up automatically. 60 seconds is generous enough
   * for any legitimate action while preventing unbounded growth.
   * 
   * Why clear existing timeout: If an action sends multiple updates (which is
   * the whole point!), we need to reset the TTL with each update. Otherwise
   * a long-running action with frequent updates could have its tracking expire
   * mid-execution.
   */
  private trackProgressiveMessage(key: string, message: DiscordMessage): void {
    // Clear any existing timeout for this key
    const existing = this.progressiveMessages.get(key);
    if (existing?.timeout) {
      clearTimeout(existing.timeout);
    }

    // Set 60-second TTL
    const timeout = setTimeout(() => {
      this.progressiveMessages.delete(key);
      this.runtime.logger.debug(`Progressive message ${key} TTL expired`);
    }, 60000);

    this.progressiveMessages.set(key, { message, timeout });
  }

  /**
   * Reset TTL for an existing progressive message
   */
  private resetProgressiveTTL(key: string): void {
    const existing = this.progressiveMessages.get(key);
    if (!existing) return;

    // Clear old timeout
    clearTimeout(existing.timeout);

    // Set new 60-second TTL
    const timeout = setTimeout(() => {
      this.progressiveMessages.delete(key);
      this.runtime.logger.debug(`Progressive message ${key} TTL expired`);
    }, 60000);

    existing.timeout = timeout;
  }

  /**
   * Clean up a progressive message tracking entry
   */
  private cleanupProgressiveMessage(key: string): void {
    const existing = this.progressiveMessages.get(key);
    if (existing) {
      clearTimeout(existing.timeout);
      this.progressiveMessages.delete(key);
    }
  }

  /**
   * Handles incoming Discord messages and processes them accordingly.
   *
   * @param {DiscordMessage} message - The Discord message to be handled
   */
  async handleMessage(message: DiscordMessage) {
    // this filtering is already done in setupEventListeners
    /*
    if (
      this.discordSettings.allowedChannelIds?.length &&
      !this.discordSettings.allowedChannelIds.some((id: string) => id === message.channel.id)
    ) {
      return;
    }
    */

    if (message.interaction || message.author.id === this.client.user?.id) {
      return;
    }

    if (this.discordSettings.shouldIgnoreBotMessages && message.author?.bot) {
      return;
    }

    if (
      this.discordSettings.shouldIgnoreDirectMessages &&
      message.channel.type === DiscordChannelType.DM
    ) {
      return;
    }

    const isBotMentioned = !!(
      this.client.user?.id && message.mentions.users?.has(this.client.user.id)
    );
    const isReplyToBot =
      !!message.reference?.messageId && message.mentions.repliedUser?.id === this.client.user?.id;
    const isInThread = message.channel.isThread();
    const isDM = message.channel.type === DiscordChannelType.DM;

    if (this.discordSettings.shouldRespondOnlyToMentions) {
      const shouldProcess = isDM || isBotMentioned || isReplyToBot;

      if (!shouldProcess) {
        this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId: message.channel.id }, 'Strict mode: ignoring message (no mention or reply)');
        return;
      }

      this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId: message.channel.id }, 'Strict mode: processing message');
    }

    const entityId = createUniqueUuid(this.runtime, message.author.id);
    const userName = message.author.bot
      ? `${message.author.username}#${message.author.discriminator}`
      : message.author.username;
    // Use server-specific displayName (nickname) if available, fallback to global displayName
    const name = message.member?.displayName || message.author.displayName;
    const channelId = message.channel.id;
    const roomId = createUniqueUuid(this.runtime, channelId);

    // Determine channel type and server ID for ensureConnection
    let type: ChannelType;
    let serverId: string | undefined;

    if (message.guild) {
      const guild = await message.guild.fetch();
      type = await this.getChannelType(message.channel as Channel);
      if (type === null) {
        // usually a forum type post
        this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId: message.channel.id }, 'Null channel type');
      }
      serverId = guild.id;
    } else {
      type = ChannelType.DM;
      serverId = message.channel.id;
    }

    await this.runtime.ensureConnection({
      entityId,
      roomId,
      userName,
      name: name,
      source: 'discord',
      channelId: message.channel.id,
      // Convert Discord snowflake to UUID (see service.ts header for why stringToUuid not asUUID)
      messageServerId: serverId ? stringToUuid(serverId) : undefined,
      type,
      worldId: createUniqueUuid(this.runtime, serverId ?? roomId) as UUID,
      worldName: message.guild?.name,
    });

    try {
      const canSendResult = canSendMessage(message.channel);
      if (!canSendResult.canSend) {
        return this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, channelId: message.channel.id, reason: canSendResult.reason }, 'Cannot send message to channel');
      }

      const { processedContent, attachments } = await this.processMessage(message);

      // Note: Audio attachments are already processed in processMessage via
      // attachmentManager.processAttachments(message.attachments), so no need
      // to process them again here.

      if (!processedContent && !attachments?.length) {
        // Only process messages that are not empty
        return;
      }

      const channel = message.channel as TextChannel;

      // Store the typing data to be used by the callback
      const typingData = {
        interval: null as ReturnType<typeof setInterval> | null,
        cleared: false,
        started: false,
      };

      // Use the service's buildMemoryFromMessage method with pre-processed content
      const newMessage = await this.discordService.buildMemoryFromMessage(message, {
        processedContent,
        processedAttachments: attachments,
        extraContent: {
          mentionContext: {
            isMention: isBotMentioned,
            isReply: isReplyToBot,
            isThread: isInThread,
            mentionType: isBotMentioned
              ? 'platform_mention'
              : isReplyToBot
                ? 'reply'
                : isInThread
                  ? 'thread'
                  : 'none',
          },
        },
        extraMetadata: {
          // Reply attribution for cross-agent filtering
          // WHY: When user replies to another bot's message, we need to know
          // so other agents can ignore it (only the replied-to agent should respond)
          replyToAuthor: message.mentions.repliedUser
            ? {
              id: message.mentions.repliedUser.id,
              username: message.mentions.repliedUser.username,
              isBot: message.mentions.repliedUser.bot,
            }
            : undefined,
        },
      });

      if (!newMessage) {
        this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, messageId: message.id }, 'Failed to build memory from message');
        return;
      }

      const messageId = newMessage.id;

      const callback: HandlerCallback = async (content: Content) => {
        try {
          // target is set but not addressed to us handling
          if (
            content.target &&
            typeof content.target === 'string' &&
            content.target.toLowerCase() !== 'discord'
          ) {
            return [];
          }

          // Start typing indicator only when we're actually going to respond
          if (!typingData.started) {
            typingData.started = true;

            const startTyping = () => {
              try {
                // sendTyping is not available at test time
                if (channel.sendTyping) {
                  channel.sendTyping();
                }
              } catch (err) {
                this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, error: err instanceof Error ? err.message : String(err) }, 'Error sending typing indicator');
              }
            };

            // Start typing immediately
            startTyping();

            // Create interval to keep the typing indicator active while processing
            typingData.interval = setInterval(startTyping, 8000); // there is no stop typing, it times out after 10s

            // Add a small delay to ensure typing indicator is visible
            // This simulates the bot "thinking" before responding
            //await new Promise((resolve) => setTimeout(resolve, 1500));
          }

          if (message.id && !content.inReplyTo) {
            content.inReplyTo = createUniqueUuid(this.runtime, message.id);
          }

          // Handle progressive updates
          // 
          // Why check metadata: Actions use ProgressiveMessage helper, which sets
          // metadata.progressiveUpdate to signal this is part of a progressive chain.
          // Normal actions don't set this, so they skip this logic entirely.
          const progressiveUpdate = (content.metadata as any)?.progressiveUpdate;
          if (progressiveUpdate?.correlationId) {
            const key = `${channel.id}:${progressiveUpdate.correlationId}`;
            const existing = this.progressiveMessages.get(key);

            if (existing) {
              // Edit existing message
              // 
              // Why edit instead of send new: This is the core of progressive updates.
              // By editing the same message repeatedly, we show live status without
              // cluttering chat history. Users see "Searching..." turn into "Found!"
              // turn into "Now playing!" in a single message bubble.
              const edited = await editMessageContent(existing.message, content.text || '');
              if (edited) {
                this.resetProgressiveTTL(key);

                // If this is an interim update, don't create memory
                // 
                // Why skip memory for interim: Only the final message should be saved
                // to conversation history. Saving "Searching..." and "Found!" and
                // "Setting up..." would bloat the database with transient status text
                // that has no value after the action completes.
                if (progressiveUpdate.isInterim) {
                  return [];
                }

                // Final message - clean up tracking and create memory
                // 
                // Why clean up: This action is done, so we don't need to track its
                // message anymore. Free up the memory and clear the timeout.
                this.cleanupProgressiveMessage(key);

                // Clear typing indicator for final progressive message
                // 
                // Why clear here: Progressive updates complete, user has their answer.
                // Without this, typing indicator stays active indefinitely, making
                // users think the bot is still processing.
                if (typingData.interval && !typingData.cleared) {
                  clearInterval(typingData.interval);
                  typingData.cleared = true;
                }

                const memory: Memory = {
                  id: createUniqueUuid(this.runtime, edited.id),
                  entityId: this.runtime.agentId,
                  agentId: this.runtime.agentId,
                  content: {
                    ...content,
                    actions: content.actions,
                    inReplyTo: messageId,
                    url: edited.url,
                    channelType: type,
                  },
                  roomId,
                  createdAt: edited.createdTimestamp,
                };
                await this.runtime.createMemory(memory, 'messages');
                return [memory];
              } else {
                // Edit failed, fall back to sending new message
                // 
                // Why fallback: Discord edit can fail if the message was deleted,
                // the bot lost permissions, or we hit rate limits. Rather than
                // failing silently, send a new message so the user still gets
                // feedback. This graceful degradation prevents user-facing errors.
                this.runtime.logger.warn(`Failed to edit progressive message ${key}, falling back to new message`);
                this.cleanupProgressiveMessage(key);
              }
            }

            // First update or edit failed - send new message and track it
            // 
            // Why send new on first: The first update has no existing message to edit,
            // so we must send a new one. We then track it so subsequent updates can
            // edit this message.
            // Convert Media attachments to Discord AttachmentBuilder format
            const files: AttachmentBuilder[] = [];
            if (content.attachments && content.attachments.length > 0) {
              for (const media of content.attachments) {
                if (media.url) {
                  const fileName = getAttachmentFileName(media);
                  files.push(new AttachmentBuilder(media.url, { name: fileName }));
                }
              }
            }

            let messages: any[] = [];
            if (content?.channelType === 'DM') {
              const u = await this.client.users.fetch(message.author.id);
              if (!u) {
                this.runtime.logger.warn('Discord - User not found', message.author.id);
                return [];
              }
              await u.send(content.text || '');
              messages = [content];
            } else {
              messages = await sendMessageInChunks(
                channel,
                content.text ?? '',
                message.id!,
                files
              );
            }

            // Track the first message for future edits
            // 
            // Why track: Store this message so subsequent updates with the same
            // correlation ID can edit it instead of sending new messages.
            if (messages.length > 0 && messages[0].id) {
              this.trackProgressiveMessage(key, messages[0]);
            }

            // If interim, don't create memory
            if (progressiveUpdate.isInterim) {
              return [];
            }

            // Final message - clean up and create memory
            this.cleanupProgressiveMessage(key);

            // Clear typing indicator for final progressive message
            // 
            // Why clear here: This path handles first-time sends that are final
            // (e.g., when edit fallback occurs). Same reasoning as edit path -
            // progressive updates complete, stop showing typing.
            if (typingData.interval && !typingData.cleared) {
              clearInterval(typingData.interval);
              typingData.cleared = true;
            }

            const memories: Memory[] = [];
            for (const m of messages) {
              const memory: Memory = {
                id: createUniqueUuid(this.runtime, m.id),
                entityId: this.runtime.agentId,
                agentId: this.runtime.agentId,
                content: {
                  ...content,
                  actions: content.actions,
                  inReplyTo: messageId,
                  url: m.url,
                  channelType: type,
                },
                roomId,
                createdAt: m.createdTimestamp,
              };
              memories.push(memory);
            }
            for (const m of memories) {
              await this.runtime.createMemory(m, 'messages');
            }
            return memories;
          }

          // Normal (non-progressive) message flow
          let messages: any[] = [];
          if (content?.channelType === 'DM') {
            const u = await this.client.users.fetch(message.author.id);
            if (!u) {
              this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId, entityId: message.author.id }, 'User not found for DM');
              return [];
            }

            // Convert Media attachments to Discord AttachmentBuilder format for DMs
            const files: AttachmentBuilder[] = [];
            if (content.attachments && content.attachments.length > 0) {
              for (const media of content.attachments) {
                if (media.url) {
                  const fileName = getAttachmentFileName(media);
                  files.push(new AttachmentBuilder(media.url, { name: fileName }));
                }
              }
            }

            const textContent = content.text ?? '';
            const hasText = textContent.trim().length > 0;
            if (!hasText && files.length === 0) {
              this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Skipping DM response: no text or attachments');
              return [];
            }

            const dmMessage = await u.send({
              content: textContent,
              files: files.length > 0 ? files : undefined,
            });
            messages = [dmMessage];
          } else {
            // Convert Media attachments to Discord AttachmentBuilder format
            const files: AttachmentBuilder[] = [];
            if (content.attachments && content.attachments.length > 0) {
              for (const media of content.attachments) {
                if (media.url) {
                  const fileName = getAttachmentFileName(media);
                  files.push(new AttachmentBuilder(media.url, { name: fileName }));
                }
              }
            }
            // Pass runtime to enable smart (LLM-assisted) splitting for complex content
            messages = await sendMessageInChunks(channel, content.text ?? '', message.id!, files, undefined, this.runtime);
          }

          const memories: Memory[] = [];
          for (const m of messages) {
            const actions = content.actions;
            // Only attach files to the memory for the message that actually carries them
            const hasAttachments = m.attachments?.size > 0;

            const memory: Memory = {
              id: createUniqueUuid(this.runtime, m.id),
              entityId: this.runtime.agentId,
              agentId: this.runtime.agentId,
              content: {
                ...content,
                text: m.content || content.text || ' ',
                actions,
                inReplyTo: messageId,
                url: m.url,
                channelType: type,
                // Only include attachments for the message chunk that actually has them
                attachments: hasAttachments && content.attachments ? content.attachments : undefined,
              },
              roomId,
              createdAt: m.createdTimestamp,
            };
            memories.push(memory);
          }

          for (const m of memories) {
            await this.runtime.createMemory(m, 'messages');
          }

          // Clear typing indicator when done
          if (typingData.interval && !typingData.cleared) {
            clearInterval(typingData.interval);
            typingData.cleared = true;
          }

          return memories;
        } catch (error) {
          this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error handling message callback');
          // Clear typing indicator on error
          if (typingData.interval && !typingData.cleared) {
            clearInterval(typingData.interval);
            typingData.cleared = true;
          }
          return [];
        }
      };

      // Use unified messaging API if available, otherwise fall back to direct message service
      // This provides a clearer, more traceable flow for message processing
      const unifiedAPI = getUnifiedMessagingAPI(this.runtime);
      const messageService = getMessageService(this.runtime);

      if (unifiedAPI) {
        this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Using unified messaging API');
        await unifiedAPI.sendMessage(
          this.runtime.agentId,
          newMessage,
          {
            onResponse: callback,
          }
        );
      } else if (messageService) {
        // Newer core with messageService
        this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Using messageService API');
        await messageService.handleMessage(this.runtime, newMessage, callback);
      } else {
        // Older core - use event-based message handling (backwards compatible)
        this.runtime.logger.debug({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Using event-based message handling');
        await this.runtime.emitEvent([EventType.MESSAGE_RECEIVED], {
          runtime: this.runtime,
          message: newMessage,
          callback,
          source: 'discord',
        });
      }

      // Failsafe: clear typing indicator after 30 seconds if it was started and something goes wrong
      setTimeout(() => {
        if (typingData.started && typingData.interval && !typingData.cleared) {
          clearInterval(typingData.interval);
          typingData.cleared = true;
          this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Typing indicator failsafe timeout triggered');
        }
      }, 30000);
    } catch (error) {
      this.runtime.logger.error({ src: 'plugin:discord', agentId: this.runtime.agentId, error: error instanceof Error ? error.message : String(error) }, 'Error handling message');
    }
  }

  /**
   * Processes the message content, mentions, code blocks, attachments, and URLs to generate
   * processed content and media attachments.
   *
   * @param {DiscordMessage} message The message to process
   * @returns {Promise<{ processedContent: string; attachments: Media[] }>} Processed content and media attachments
   */
  async processMessage(
    message: DiscordMessage
  ): Promise<{ processedContent: string; attachments: Media[] }> {
    let processedContent = message.content;
    let attachments: Media[] = [];

    if (message.embeds && message.embeds.length) {
      for (const i in message.embeds) {
        const embed = message.embeds[i];
        // type: rich
        processedContent += '\nEmbed #' + (parseInt(i) + 1) + ':\n';
        processedContent += '  Title:' + (embed.title ?? '(none)') + '\n';
        processedContent += '  Description:' + (embed.description ?? '(none)') + '\n';
      }
    }
    if (message.reference) {
      let messageId;
      if (message.reference.messageId) {
        messageId = createUniqueUuid(this.runtime, message.reference.messageId);
      } else {
        // optional: try to fetch the referenced message to get a definite id
        try {
          const refMsg = await message.fetchReference(); // throws if missing
          messageId = createUniqueUuid(this.runtime, refMsg.id);
        } catch {
          // no referenced message available — handle gracefully
        }
      }
      if (messageId) {
        // context currently doesn't know message ID
        processedContent +=
          '\nReferencing MessageID ' + messageId + ' (discord: ' + message.reference.messageId + ')';
        // in our channel
        if (message.reference.channelId !== message.channel.id) {
          const roomId = createUniqueUuid(this.runtime, message.reference.channelId);
          processedContent += ' in channel ' + roomId;
        }
        // in our guild
        if (
          message.reference.guildId &&
          message.guild &&
          message.reference.guildId !== message.guild.id
        ) {
          processedContent += ' in guild ' + message.reference.guildId;
        }
        processedContent += '\n';
      }
    }

    const mentionRegex = /<@!?(\d+)>/g;
    processedContent = processedContent.replace(mentionRegex, (match, entityId) => {
      const user = message.mentions.users.get(entityId);
      if (user) {
        return `${user.username} (@${entityId})`;
      }
      return match;
    });

    const codeBlockRegex = /```([\s\S]*?)```/g;
    let match;
    while ((match = codeBlockRegex.exec(processedContent))) {
      const codeBlock = match[1];
      const lines = codeBlock.split('\n');
      const title = lines[0];
      const description = lines.slice(0, 3).join('\n');
      const attachmentId = `code-${Date.now()}-${Math.floor(Math.random() * 1000)}`.slice(-5);
      attachments.push({
        id: attachmentId,
        url: '',
        title: title || 'Code Block',
        source: 'Code',
        description: description,
        text: codeBlock,
      });
      processedContent = processedContent.replace(match[0], `Code Block (${attachmentId})`);
    }

    if (message.attachments.size > 0) {
      attachments = await this.attachmentManager.processAttachments(message.attachments);
    }

    // Extract and clean URLs from the message content
    const urls = extractUrls(processedContent, this.runtime);

    for (const url of urls) {
      // Use string literal type for getService, assume methods exist at runtime
      const videoService = this.runtime.getService(ServiceType.VIDEO) as any; // Cast to any
      if (videoService?.isVideoUrl(url)) {
        try {
          const videoInfo = await videoService.processVideo(url, this.runtime);

          attachments.push({
            id: `youtube-${Date.now()}`,
            url: url,
            title: videoInfo.title,
            source: 'YouTube',
            description: videoInfo.description,
            text: videoInfo.text,
          });
        } catch (error) {
          // Handle video processing errors gracefully - the URL is still preserved in the message
          const errorMsg = error instanceof Error ? error.message : String(error);
          this.runtime.logger.warn(`Failed to process video ${url}: ${errorMsg}`);
        }
      } else {
        // Use string literal type for getService, assume methods exist at runtime
        const browserService = this.runtime.getService(ServiceType.BROWSER) as any; // Cast to any
        if (!browserService) {
          this.runtime.logger.warn({ src: 'plugin:discord', agentId: this.runtime.agentId }, 'Browser service not found');
          continue;
        }

        try {
          this.runtime.logger.debug(`Fetching page content for cleaned URL: "${url}"`);
          const { title, description: summary } = await browserService.getPageContent(
            url,
            this.runtime
          );

          attachments.push({
            id: `webpage-${Date.now()}`,
            url: url,
            title: title || 'Web Page',
            source: 'Web',
            description: summary,
            text: summary,
          });
        } catch (error) {
          // Silently handle browser errors (certificate issues, timeouts, dead sites, etc.)
          // The URL is still preserved in the message content, just without scraped metadata
          const errorMsg = error instanceof Error ? error.message : String(error);
          const errorString = String(error);

          // Check for common expected failures that don't need logging
          const isExpectedFailure =
            errorMsg.includes('ERR_CERT') ||
            errorString.includes('ERR_CERT') ||
            errorMsg.includes('Timeout') ||
            errorString.includes('Timeout') ||
            errorMsg.includes('ERR_NAME_NOT_RESOLVED') ||
            errorString.includes('ERR_NAME_NOT_RESOLVED') ||
            errorMsg.includes('ERR_HTTP_RESPONSE_CODE_FAILURE') ||
            errorString.includes('ERR_HTTP_RESPONSE_CODE_FAILURE');

          if (!isExpectedFailure) {
            this.runtime.logger.warn(`Failed to fetch page content for ${url}: ${errorMsg}`);
          }
          // Expected failures are silently handled - no logging needed
        }
      }
    }

    return { processedContent, attachments };
  }

  /**
   * Asynchronously fetches the bot's username and discriminator from Discord API.
   *
   * @param {string} botToken The token of the bot to authenticate the request
   * @returns {Promise<string>} A promise that resolves with the bot's username and discriminator
   * @throws {Error} If there is an error while fetching the bot details
   */

  async fetchBotName(botToken: string) {
    const url = 'https://discord.com/api/v10/users/@me';
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bot ${botToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Error fetching bot details: ${response.statusText}`);
    }

    const data = await response.json();
    const discriminator = data.discriminator;
    return (data as { username: string }).username + (discriminator ? `#${discriminator}` : '');
  }
}
