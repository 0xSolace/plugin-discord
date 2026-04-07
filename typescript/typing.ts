/**
 * Typing indicator controller for Discord.
 *
 * Sends typing indicators while the agent is processing a message.
 * Discord's typing indicator lasts ~10 seconds, so we re-send every 9 seconds.
 * Configurable max duration to prevent runaway typing (default: 20 min for tool-heavy runs).
 *
 * Inspired by OpenClaw's channels/typing.ts pattern.
 */

import type { TextChannel } from "discord.js";

export type TypingControllerOptions = {
	/** Interval between typing pings in ms. Default: 9000 (Discord typing lasts ~10s). */
	keepaliveIntervalMs?: number;
	/** Maximum duration before auto-stop in ms. Default: 1_200_000 (20 minutes). */
	maxDurationMs?: number;
	/** Called when a typing API call fails. */
	onError?: (err: unknown) => void;
};

export type TypingController = {
	/** Start sending typing indicators. Idempotent (safe to call multiple times). */
	start: () => void;
	/** Stop sending typing indicators and clean up. Idempotent. */
	stop: () => void;
	/** Whether the controller has been stopped. */
	isStopped: () => boolean;
};

/**
 * Create a typing indicator controller for a Discord text channel.
 *
 * Usage:
 * ```ts
 * const typing = createTypingController(channel, { onError: logger.warn });
 * typing.start();
 * // ... process message ...
 * typing.stop();
 * ```
 */
export function createTypingController(
	channel: TextChannel,
	options: TypingControllerOptions = {},
): TypingController {
	const keepaliveIntervalMs = options.keepaliveIntervalMs ?? 9_000;
	const maxDurationMs = options.maxDurationMs ?? 1_200_000; // 20 minutes
	const onError = options.onError;

	let intervalId: ReturnType<typeof setInterval> | null = null;
	let ttlTimerId: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;

	const sendTyping = () => {
		if (stopped) return;
		try {
			// sendTyping() returns a Promise but we fire-and-forget
			// to avoid blocking the processing pipeline
			if (channel.sendTyping) {
				void channel.sendTyping().catch((err) => {
					if (onError) onError(err);
				});
			}
		} catch (err) {
			if (onError) onError(err);
		}
	};

	const stop = () => {
		if (stopped) return;
		stopped = true;

		if (intervalId) {
			clearInterval(intervalId);
			intervalId = null;
		}
		if (ttlTimerId) {
			clearTimeout(ttlTimerId);
			ttlTimerId = null;
		}
	};

	const start = () => {
		if (stopped || intervalId) return; // Already started or stopped

		// Send typing immediately
		sendTyping();

		// Set up keepalive interval
		intervalId = setInterval(sendTyping, keepaliveIntervalMs);

		// Safety TTL: auto-stop after max duration
		if (maxDurationMs > 0) {
			ttlTimerId = setTimeout(() => {
				stop();
			}, maxDurationMs);
		}
	};

	return {
		start,
		stop,
		isStopped: () => stopped,
	};
}
