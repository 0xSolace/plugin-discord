/**
 * Typing indicator controller for Discord.
 *
 * Sends `channel.sendTyping()` immediately when processing starts,
 * re-sends every 9 seconds (Discord typing lasts ~10s), and auto-stops
 * after a configurable max duration (default 20 min for tool-heavy runs).
 *
 * Fire-and-forget: typing errors never block message processing.
 *
 * Ported from OCPlatform's typing.ts with discord.js adaptation.
 */

import type { TextChannel } from "discord.js";

export interface TypingController {
	/** Start the typing indicator loop. Safe to call multiple times (no-op after first). */
	start: () => void;
	/** Stop the typing indicator. Safe to call multiple times. */
	stop: () => void;
}

const HEARTBEAT_MS = 9_000; // Re-send typing every 9s (Discord typing lasts ~10s)
const DEFAULT_MAX_DURATION_MS = 20 * 60 * 1000; // 20 minutes max

/**
 * Create a typing indicator controller for a Discord channel.
 *
 * @param channel - The Discord text channel to send typing in
 * @param maxDurationMs - Maximum time to keep typing alive (default: 20 min)
 * @returns TypingController with start() and stop() methods
 */
export function createTypingController(
	channel: TextChannel,
	maxDurationMs: number = DEFAULT_MAX_DURATION_MS,
): TypingController {
	let interval: ReturnType<typeof setInterval> | null = null;
	let ttlTimeout: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;
	let started = false;

	const sendTyping = () => {
		if (stopped) return;
		try {
			// sendTyping returns a promise but we fire-and-forget
			if (channel.sendTyping) {
				channel.sendTyping().catch(() => {
					// Typing failures are non-critical, silently ignore
				});
			}
		} catch {
			// Swallow synchronous errors too
		}
	};

	const stop = () => {
		if (stopped) return;
		stopped = true;
		if (interval) {
			clearInterval(interval);
			interval = null;
		}
		if (ttlTimeout) {
			clearTimeout(ttlTimeout);
			ttlTimeout = null;
		}
	};

	const start = () => {
		if (started || stopped) return;
		started = true;

		// Send typing immediately
		sendTyping();

		// Heartbeat: re-send every 9 seconds
		interval = setInterval(sendTyping, HEARTBEAT_MS);

		// TTL: auto-stop after max duration
		ttlTimeout = setTimeout(stop, maxDurationMs);
	};

	return { start, stop };
}
