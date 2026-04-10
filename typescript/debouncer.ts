/**
 * Inbound message debouncer for Discord.
 *
 * Coalesces rapid messages from the same user in the same channel
 * (e.g., someone sending 3 lines quickly) into a single agent request.
 * Without this, each line triggers a separate LLM call, wasting tokens
 * and producing fragmented responses.
 *
 * Features:
 * - Groups by channelId:authorId
 * - Configurable window (default 400ms)
 * - Attachment messages flush immediately (bypass debounce)
 * - flushAll() for graceful shutdown
 *
 * Ported from OpenClaw's inbound-debounce-policy.ts with discord.js adaptation.
 */

import type { Message as DiscordMessage } from "discord.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type DebouncerFlushCallback = (messages: DiscordMessage[]) => void;

export interface MessageDebouncer {
	/** Enqueue a message for debounced processing. */
	enqueue: (message: DiscordMessage) => void;
	/** Flush all pending buffers immediately (for graceful shutdown). */
	flushAll: () => void;
	/** Number of pending entries (for monitoring). */
	pendingCount: () => number;
	/** Destroy the debouncer, clearing all timers without flushing. */
	destroy: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal state per debounce key
// ─────────────────────────────────────────────────────────────────────────────

interface PendingEntry {
	messages: DiscordMessage[];
	timer: ReturnType<typeof setTimeout>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_DEBOUNCE_MS = 400;

/**
 * Create a message debouncer.
 *
 * @param onFlush - Callback invoked with the accumulated messages when the debounce window expires
 * @param debounceMs - Debounce window in milliseconds (0 to disable debouncing)
 * @returns MessageDebouncer
 */
// ─────────────────────────────────────────────────────────────────────────────
// Channel Debouncer (groups ALL users in a channel)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CHANNEL_DEBOUNCE_MS = 3000;

export interface ChannelDebouncerOptions {
	/** Debounce window in ms (resets on each new message). Default: 3000 */
	debounceMs?: number;
	/** Cooldown after agent responds before accepting non-mention messages. Default: 30000 */
	responseCooldownMs?: number;
	/** The bot's Discord user ID, used to detect mentions/replies that flush immediately. */
	botUserId?: string;
	/** Bot's character name for name-mention detection (case-insensitive). */
	botName?: string;
}

export interface ChannelDebouncer {
	/** Enqueue a message. Mentions/replies to bot flush immediately. */
	enqueue: (message: DiscordMessage) => void;
	/** Mark that the bot just responded in a channel (starts cooldown). */
	markResponded: (channelId: string) => void;
	/** Flush all pending channel buffers. */
	flushAll: () => void;
	/** Number of channels with pending messages. */
	pendingCount: () => number;
	/** Destroy all timers without flushing. */
	destroy: () => void;
}

interface ChannelPendingEntry {
	messages: DiscordMessage[];
	timer: ReturnType<typeof setTimeout>;
}

/**
 * Create a channel-level debouncer for busy group channels.
 *
 * Unlike createMessageDebouncer (which keys by channelId:authorId),
 * this keys by channelId only, accumulating ALL messages from ALL users
 * during the debounce window. Direct mentions/replies to the bot flush
 * immediately (high priority).
 *
 * After the bot responds, a configurable cooldown period suppresses
 * non-mention messages to avoid rapid-fire responses in busy channels.
 *
 * @param onFlush - Called with all accumulated messages when the window expires.
 *                  Messages are ordered chronologically. The callback should
 *                  pick the most relevant message to process and use the rest as context.
 * @param options - Configuration options
 */
export function createChannelDebouncer(
	onFlush: DebouncerFlushCallback,
	options: ChannelDebouncerOptions = {},
): ChannelDebouncer {
	const debounceMs = options.debounceMs ?? DEFAULT_CHANNEL_DEBOUNCE_MS;
	const responseCooldownMs = options.responseCooldownMs ?? 30000;
	const botName = options.botName?.toLowerCase();

	const pending = new Map<string, ChannelPendingEntry>();
	/** Timestamp (ms) of last bot response per channel. */
	const lastResponseTime = new Map<string, number>();

	/** Check if a message is a direct mention or reply to the bot. */
	const isBotTargeted = (message: DiscordMessage): boolean => {
		// Read botUserId lazily (may be a getter that resolves after login)
		const botId = options.botUserId;
		if (!botId) return false;
		// @mention
		if (message.mentions?.users?.has(botId)) return true;
		// Reply to bot
		if (message.reference?.messageId && message.mentions?.repliedUser?.id === botId) return true;
		// Name mention (case-insensitive)
		if (botName && botName.length >= 2 && message.content?.toLowerCase().includes(botName)) return true;
		return false;
	};

	/** Check if channel is in post-response cooldown. */
	const isInCooldown = (channelId: string): boolean => {
		const lastResp = lastResponseTime.get(channelId);
		if (!lastResp) return false;
		return (Date.now() - lastResp) < responseCooldownMs;
	};

	/** Flush a single channel's buffer. */
	const flush = (channelId: string): void => {
		const entry = pending.get(channelId);
		if (!entry) return;

		clearTimeout(entry.timer);
		pending.delete(channelId);

		if (entry.messages.length > 0) {
			try {
				onFlush(entry.messages);
			} catch {
				// onFlush errors should not crash the debouncer
			}
		}
	};

	const enqueue = (message: DiscordMessage): void => {
		const channelId = message.channel.id;
		const targeted = isBotTargeted(message);

		// If bot is directly targeted, flush immediately (bypass debounce + cooldown)
		if (targeted) {
			// Flush any pending buffer first (so context isn't lost)
			const entry = pending.get(channelId);
			if (entry) {
				clearTimeout(entry.timer);
				pending.delete(channelId);
				// Include pending messages as context along with the mention
				entry.messages.push(message);
				try {
					onFlush(entry.messages);
				} catch { /* */ }
			} else {
				onFlush([message]);
			}
			return;
		}

		// During cooldown, silently drop non-targeted messages
		if (isInCooldown(channelId)) {
			return;
		}

		// If debouncing is disabled, flush immediately
		if (debounceMs <= 0) {
			onFlush([message]);
			return;
		}

		// Buffer the message and reset the timer (true debounce)
		const existing = pending.get(channelId);
		if (existing) {
			clearTimeout(existing.timer);
			existing.messages.push(message);
			existing.timer = setTimeout(() => flush(channelId), debounceMs);
		} else {
			const timer = setTimeout(() => flush(channelId), debounceMs);
			pending.set(channelId, { messages: [message], timer });
		}
	};

	const markResponded = (channelId: string): void => {
		lastResponseTime.set(channelId, Date.now());
	};

	const flushAll = (): void => {
		for (const key of Array.from(pending.keys())) {
			flush(key);
		}
	};

	const destroy = (): void => {
		for (const [, entry] of pending) {
			clearTimeout(entry.timer);
		}
		pending.clear();
		lastResponseTime.clear();
	};

	const pendingCount = (): number => pending.size;

	return { enqueue, markResponded, flushAll, pendingCount, destroy };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-User Message Debouncer (original)
// ─────────────────────────────────────────────────────────────────────────────

export function createMessageDebouncer(
	onFlush: DebouncerFlushCallback,
	debounceMs: number = DEFAULT_DEBOUNCE_MS,
): MessageDebouncer {
	const pending = new Map<string, PendingEntry>();

	/** Build the grouping key: channelId:authorId */
	const makeKey = (message: DiscordMessage): string =>
		`${message.channel.id}:${message.author.id}`;

	/** Flush a single key's buffer. */
	const flush = (key: string): void => {
		const entry = pending.get(key);
		if (!entry) return;

		clearTimeout(entry.timer);
		pending.delete(key);

		if (entry.messages.length > 0) {
			try {
				onFlush(entry.messages);
			} catch {
				// onFlush errors should not crash the debouncer
			}
		}
	};

	/** Check if a message has attachments or stickers (should bypass debounce). */
	const hasMedia = (message: DiscordMessage): boolean =>
		(message.attachments?.size ?? 0) > 0 ||
		(message.stickers?.size ?? 0) > 0;

	const enqueue = (message: DiscordMessage): void => {
		// If debouncing is disabled, flush immediately
		if (debounceMs <= 0) {
			onFlush([message]);
			return;
		}

		const key = makeKey(message);

		// Messages with attachments flush the buffer and process immediately
		if (hasMedia(message)) {
			// Flush any pending messages for this key first
			const entry = pending.get(key);
			if (entry) {
				clearTimeout(entry.timer);
				pending.delete(key);
				if (entry.messages.length > 0) {
					try {
						onFlush(entry.messages);
					} catch {
						// Swallow
					}
				}
			}
			// Then flush the attachment message immediately
			onFlush([message]);
			return;
		}

		// Regular text message: buffer and reset timer
		const existing = pending.get(key);
		if (existing) {
			clearTimeout(existing.timer);
			existing.messages.push(message);
			existing.timer = setTimeout(() => flush(key), debounceMs);
		} else {
			const timer = setTimeout(() => flush(key), debounceMs);
			pending.set(key, { messages: [message], timer });
		}
	};

	const flushAll = (): void => {
		for (const key of Array.from(pending.keys())) {
			flush(key);
		}
	};

	const destroy = (): void => {
		for (const [, entry] of pending) {
			clearTimeout(entry.timer);
		}
		pending.clear();
	};

	const pendingCount = (): number => pending.size;

	return { enqueue, flushAll, pendingCount, destroy };
}
