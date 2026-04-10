/**
 * DraftStreamController - Edit-based progressive response display for Discord.
 *
 * Instead of waiting for the full LLM response and sending it all at once,
 * this controller sends an initial placeholder message and progressively edits
 * it as more text streams in. This gives users immediate visual feedback that
 * the bot is composing a response.
 *
 * Lifecycle:
 *   1. start(channel, replyToId?) -> sends initial "..." message
 *   2. update(text) -> edits with accumulated content (throttled to avoid rate limits)
 *   3. finalize(text) -> final edit with complete text, cleans up
 *   4. abort(reason?) -> edits with error indicator, cleans up
 *
 * Rate limiting: edits are throttled to at most 1 per `throttleMs` (default 1.2s).
 * Pending updates are coalesced, so the latest text always wins.
 *
 * Ported from OpenClaw's draft-stream.ts, adapted for discord.js.
 */

import type { Message as DiscordMessage, TextChannel } from "discord.js";
import {
	type DraftChunkConfig,
	DEFAULT_DRAFT_CHUNK_CONFIG,
	findBreakPoint,
} from "./draft-chunking";

export interface DraftStreamOptions {
	/** Minimum ms between edits (default: 1200) */
	throttleMs?: number;
	/** Minimum chars before sending first message, to avoid noisy push notifications (default: 40) */
	minInitialChars?: number;
	/** Maximum chars per message - hard cap at 2000 for Discord (default: 1900) */
	maxChars?: number;
	/** Chunking config for multi-message overflow */
	chunkConfig?: Partial<DraftChunkConfig>;
	/** Logger functions */
	log?: (msg: string) => void;
	warn?: (msg: string) => void;
}

export interface DraftStreamController {
	/** Send initial placeholder and begin streaming. Returns the placeholder message. */
	start: (channel: TextChannel, replyToMessageId?: string) => Promise<DiscordMessage | null>;
	/** Update the draft with new accumulated text (throttled). */
	update: (text: string) => void;
	/** Finalize with the complete response text. Returns all emitted messages (draft + overflow). */
	finalize: (text: string) => Promise<DiscordMessage[]>;
	/** Abort the draft with an optional error reason. */
	abort: (reason?: string) => Promise<void>;
	/** Get the current draft message ID (if started). */
	messageId: () => string | undefined;
	/** Check if the stream has been started. */
	isStarted: () => boolean;
	/** Check if the stream has been finalized or aborted. */
	isDone: () => boolean;
}

const DEFAULT_THROTTLE_MS = 1_200;
const DEFAULT_MIN_INITIAL_CHARS = 40;
const DISCORD_MAX_CHARS = 2000;

export function createDraftStreamController(
	options: DraftStreamOptions = {},
): DraftStreamController {
	const throttleMs = Math.max(250, options.throttleMs ?? DEFAULT_THROTTLE_MS);
	const minInitialChars = options.minInitialChars ?? DEFAULT_MIN_INITIAL_CHARS;
	const maxChars = Math.min(options.maxChars ?? 1900, DISCORD_MAX_CHARS);
	const log = options.log ?? (() => {});
	const warn = options.warn ?? (() => {});

	let channel: TextChannel | null = null;
	let draftMessage: DiscordMessage | null = null;
	let lastSentText = "";
	let pendingText: string | null = null;
	let throttleTimer: ReturnType<typeof setTimeout> | null = null;
	let started = false;
	let done = false;

	const clearThrottle = () => {
		if (throttleTimer) {
			clearTimeout(throttleTimer);
			throttleTimer = null;
		}
	};

	/**
	 * Send or edit the draft message. Returns true on success.
	 */
	const sendOrEdit = async (text: string): Promise<boolean> => {
		if (done || !channel) return false;

		const trimmed = text.trimEnd();
		if (!trimmed) return false;

		// Truncate to max chars with ellipsis if streaming text exceeds limit
		const displayText = trimmed.length > maxChars
			? trimmed.slice(0, maxChars - 3) + "..."
			: trimmed;

		if (displayText === lastSentText) return true;

		try {
			if (draftMessage) {
				// Edit existing
				await draftMessage.edit({ content: displayText });
			} else {
				// Should not happen if start() was called, but handle gracefully
				warn("draft-stream: sendOrEdit called before start, sending new message");
				draftMessage = await channel.send({ content: displayText });
			}
			lastSentText = displayText;
			return true;
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			// Handle deleted message (user or mod deleted it mid-stream)
			if (errMsg.includes("Unknown Message") || errMsg.includes("10008")) {
				warn("draft-stream: message was deleted externally, stopping");
				done = true;
				return false;
			}
			warn(`draft-stream: edit failed: ${errMsg}`);
			return false;
		}
	};

	/**
	 * Flush any pending update immediately.
	 */
	const flush = async (): Promise<void> => {
		clearThrottle();
		if (pendingText !== null) {
			const text = pendingText;
			pendingText = null;
			await sendOrEdit(text);
		}
	};

	/**
	 * Schedule a throttled update. If an update is already pending,
	 * replace its text (coalesce).
	 */
	const scheduleUpdate = (text: string) => {
		pendingText = text;
		if (!throttleTimer) {
			throttleTimer = setTimeout(async () => {
				throttleTimer = null;
				await flush();
			}, throttleMs);
		}
	};

	// --- Public API ---

	const start = async (
		ch: TextChannel,
		replyToMessageId?: string,
	): Promise<DiscordMessage | null> => {
		if (started) {
			warn("draft-stream: start() called twice, ignoring");
			return draftMessage;
		}
		started = true;
		channel = ch;

		try {
			const sendOpts: { content: string; reply?: { messageReference: string } } = {
				content: "...",
			};
			if (replyToMessageId) {
				sendOpts.reply = { messageReference: replyToMessageId };
			}

			draftMessage = await ch.send(sendOpts);
			lastSentText = "...";
			log(`draft-stream: started (messageId=${draftMessage.id}, throttle=${throttleMs}ms)`);
			return draftMessage;
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			warn(`draft-stream: failed to send initial message: ${errMsg}`);
			done = true;
			return null;
		}
	};

	const update = (text: string): void => {
		if (done || !started) return;

		// Debounce first real content until we have enough chars
		// to avoid a noisy push notification with partial text
		if (draftMessage && lastSentText === "..." && text.length < minInitialChars) {
			return;
		}

		scheduleUpdate(text);
	};

	const finalize = async (text: string): Promise<DiscordMessage[]> => {
		if (done) return draftMessage ? [draftMessage] : [];
		// NOTE: done = true is set AFTER edits complete (not before)
		// to avoid sendOrEdit() bailing out early
		clearThrottle();
		pendingText = null;

		if (!started || !draftMessage) {
			warn("draft-stream: finalize called before start");
			done = true;
			return [];
		}

		const trimmed = text.trimEnd();
		if (!trimmed) {
			// Delete the placeholder if final text is empty
			try {
				await draftMessage.delete();
			} catch { /* ignore */ }
			done = true;
			return [];
		}

		// If text fits in one message, just edit
		if (trimmed.length <= maxChars) {
			await sendOrEdit(trimmed);
			done = true;
			log("draft-stream: finalized (single message)");
			return [draftMessage];
		}

		// Text exceeds limit: edit first chunk into draft, send rest as follow-ups
		const chunkConfig = { ...DEFAULT_DRAFT_CHUNK_CONFIG, ...options.chunkConfig };
		const breakPoint = findBreakPoint(trimmed, maxChars, chunkConfig.breakPreference);
		const firstChunk = trimmed.slice(0, breakPoint).trimEnd();
		let remaining = trimmed.slice(breakPoint).trimStart();

		await sendOrEdit(firstChunk);

		// Collect all emitted messages (draft + overflow)
		const allMessages: DiscordMessage[] = [draftMessage];

		// Send overflow as new messages
		while (remaining.length > 0 && channel) {
			const nextBreak = findBreakPoint(remaining, maxChars, chunkConfig.breakPreference);
			const chunk = remaining.slice(0, nextBreak).trimEnd();
			remaining = remaining.slice(nextBreak).trimStart();

			if (chunk) {
				try {
					const overflowMsg = await channel.send({ content: chunk });
					allMessages.push(overflowMsg);
				} catch (err) {
					warn(`draft-stream: overflow send failed: ${err instanceof Error ? err.message : String(err)}`);
					break;
				}
			}
		}

		done = true;
		log("draft-stream: finalized (multi-message)");
		return allMessages;
	};

	const abort = async (reason?: string): Promise<void> => {
		if (done) return;
		done = true;
		clearThrottle();
		pendingText = null;

		if (!draftMessage) return;

		const errorText = reason
			? `⚠️ ${reason}`
			: "⚠️ Response generation was interrupted.";

		try {
			await draftMessage.edit({ content: errorText });
		} catch {
			// If we can't edit, try to delete
			try {
				await draftMessage.delete();
			} catch { /* give up */ }
		}

		log("draft-stream: aborted");
	};

	return {
		start,
		update,
		finalize,
		abort,
		messageId: () => draftMessage?.id,
		isStarted: () => started,
		isDone: () => done,
	};
}
