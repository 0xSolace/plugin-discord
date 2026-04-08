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
