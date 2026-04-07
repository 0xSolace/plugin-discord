/**
 * Inbound message debouncer for Discord.
 *
 * Coalesces rapid messages from the same author in the same channel into a single
 * processing call. This prevents double-processing when users send multi-line messages
 * or paste content that arrives as multiple messages.
 *
 * Messages with attachments flush the buffer immediately (they likely contain
 * important context that shouldn't wait).
 *
 * Inspired by OpenClaw's auto-reply/inbound-debounce.ts pattern.
 */

import type { Message as DiscordMessage } from "discord.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type MessageDebouncerOptions = {
	/** Debounce window in ms. Default: 400. */
	debounceMs?: number;
	/** Callback invoked with coalesced messages when the buffer flushes. */
	onFlush: (messages: DiscordMessage[]) => void | Promise<void>;
	/** Called on flush errors. */
	onError?: (err: unknown, messages: DiscordMessage[]) => void;
};

type DebouncerBuffer = {
	messages: DiscordMessage[];
	timeout: ReturnType<typeof setTimeout> | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a message debouncer that groups rapid messages by channel+author.
 *
 * Usage:
 * ```ts
 * const debouncer = createMessageDebouncer({
 *   debounceMs: 400,
 *   onFlush: (messages) => {
 *     // Process the combined messages
 *     const combined = messages.map(m => m.content).join('\n');
 *     handleMessage(messages[0], combined);
 *   },
 * });
 *
 * client.on('messageCreate', (message) => {
 *   debouncer.enqueue(message);
 * });
 * ```
 */
export function createMessageDebouncer(options: MessageDebouncerOptions) {
	const debounceMs = options.debounceMs ?? 400;
	const { onFlush, onError } = options;
	const buffers = new Map<string, DebouncerBuffer>();

	/**
	 * Build a unique key for channel+author grouping.
	 */
	function buildKey(message: DiscordMessage): string {
		return `${message.channel.id}:${message.author.id}`;
	}

	/**
	 * Check if a message should bypass debouncing and flush immediately.
	 * Messages with attachments or stickers are time-sensitive and shouldn't wait.
	 */
	function shouldFlushImmediately(message: DiscordMessage): boolean {
		return message.attachments.size > 0 || message.stickers.size > 0;
	}

	/**
	 * Flush a buffer: invoke onFlush with all accumulated messages.
	 */
	async function flushBuffer(key: string): Promise<void> {
		const buffer = buffers.get(key);
		if (!buffer) return;

		buffers.delete(key);

		if (buffer.timeout) {
			clearTimeout(buffer.timeout);
			buffer.timeout = null;
		}

		if (buffer.messages.length === 0) return;

		try {
			await onFlush(buffer.messages);
		} catch (err) {
			if (onError) {
				onError(err, buffer.messages);
			}
		}
	}

	/**
	 * Schedule a flush after the debounce window.
	 */
	function scheduleFlush(key: string, buffer: DebouncerBuffer): void {
		if (buffer.timeout) {
			clearTimeout(buffer.timeout);
		}
		buffer.timeout = setTimeout(() => {
			void flushBuffer(key);
		}, debounceMs);
	}

	/**
	 * Enqueue a message for debounced processing.
	 *
	 * If the message has attachments, it flushes any existing buffer for this
	 * key immediately and also processes the attachment message immediately.
	 */
	async function enqueue(message: DiscordMessage): Promise<void> {
		const key = buildKey(message);

		// Messages with attachments: flush existing buffer, then process immediately
		if (shouldFlushImmediately(message)) {
			// Flush any pending messages for this key first
			if (buffers.has(key)) {
				await flushBuffer(key);
			}
			// Process attachment message immediately (no debounce)
			try {
				await onFlush([message]);
			} catch (err) {
				if (onError) onError(err, [message]);
			}
			return;
		}

		// Regular text message: add to buffer
		const existing = buffers.get(key);
		if (existing) {
			existing.messages.push(message);
			scheduleFlush(key, existing);
			return;
		}

		// First message for this key: create new buffer
		const buffer: DebouncerBuffer = {
			messages: [message],
			timeout: null,
		};
		buffers.set(key, buffer);
		scheduleFlush(key, buffer);
	}

	/**
	 * Flush all pending buffers. Useful for graceful shutdown.
	 */
	async function flushAll(): Promise<void> {
		const keys = Array.from(buffers.keys());
		for (const key of keys) {
			await flushBuffer(key);
		}
	}

	/**
	 * Get the number of pending buffers (for monitoring).
	 */
	function pendingCount(): number {
		return buffers.size;
	}

	return {
		enqueue,
		flushAll,
		pendingCount,
	};
}

export type MessageDebouncer = ReturnType<typeof createMessageDebouncer>;
