import type { Message as DiscordMessage, TextChannel } from "discord.js";
import {
	DEFAULT_DRAFT_CHUNK_CONFIG,
	type DraftChunkConfig,
	findBreakPoint,
} from "./draft-chunking";

type DraftReplyToMode = "off" | "first" | "all";

export interface DraftStreamOptions {
	throttleMs?: number;
	minInitialChars?: number;
	maxChars?: number;
	chunkConfig?: Partial<DraftChunkConfig>;
	log?: (msg: string) => void;
	warn?: (msg: string) => void;
}

export interface DraftStreamController {
	start: (
		channel: TextChannel,
		replyToMessageId?: string,
		replyToMode?: DraftReplyToMode,
	) => Promise<DiscordMessage | null>;
	update: (text: string) => void;
	finalize: (text: string) => Promise<DiscordMessage[]>;
	abort: (reason?: string) => Promise<void>;
	messageId: () => string | undefined;
	isStarted: () => boolean;
	isDone: () => boolean;
}

const DEFAULT_THROTTLE_MS = 1_200;
const DEFAULT_MIN_INITIAL_CHARS = 40;
const DISCORD_MAX_CHARS = 2_000;

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
	let draftReplyToMessageId: string | undefined;
	let draftReplyToMode: DraftReplyToMode = "first";
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

	const sendOrEdit = async (text: string): Promise<boolean> => {
		if (done || !channel) {
			return false;
		}

		const trimmed = text.trimEnd();
		if (!trimmed) {
			return false;
		}

		const displayText =
			trimmed.length > maxChars
				? `${trimmed.slice(0, maxChars - 3)}...`
				: trimmed;
		if (displayText === lastSentText) {
			return true;
		}

		try {
			if (draftMessage) {
				await draftMessage.edit({ content: displayText });
			} else {
				warn(
					"draft-stream: sendOrEdit called before start, sending new message",
				);
				draftMessage = await channel.send({ content: displayText });
			}
			lastSentText = displayText;
			return true;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			if (
				errorMessage.includes("Unknown Message") ||
				errorMessage.includes("10008")
			) {
				warn("draft-stream: message was deleted externally, stopping");
				done = true;
				return false;
			}
			warn(`draft-stream: edit failed: ${errorMessage}`);
			return false;
		}
	};

	const flush = async (): Promise<void> => {
		clearThrottle();
		if (pendingText !== null) {
			const text = pendingText;
			pendingText = null;
			await sendOrEdit(text);
		}
	};

	const scheduleUpdate = (text: string) => {
		pendingText = text;
		if (!throttleTimer) {
			throttleTimer = setTimeout(async () => {
				throttleTimer = null;
				await flush();
			}, throttleMs);
		}
	};

	const start = async (
		nextChannel: TextChannel,
		replyToMessageId?: string,
		replyToMode: DraftReplyToMode = "first",
	): Promise<DiscordMessage | null> => {
		if (started) {
			warn("draft-stream: start() called twice, ignoring");
			return draftMessage;
		}
		started = true;
		channel = nextChannel;
		draftReplyToMessageId = replyToMessageId;
		draftReplyToMode = replyToMode;

		try {
			const sendOptions: {
				content: string;
				reply?: { messageReference: string };
			} = { content: "..." };
			if (replyToMessageId && replyToMode !== "off") {
				sendOptions.reply = { messageReference: replyToMessageId };
			}

			draftMessage = await nextChannel.send(sendOptions);
			lastSentText = "...";
			log(
				`draft-stream: started (messageId=${draftMessage.id}, throttle=${throttleMs}ms)`,
			);
			return draftMessage;
		} catch (error) {
			const errorMessage =
				error instanceof Error ? error.message : String(error);
			warn(`draft-stream: failed to send initial message: ${errorMessage}`);
			done = true;
			return null;
		}
	};

	const update = (text: string) => {
		if (done || !started) {
			return;
		}
		if (
			draftMessage &&
			lastSentText === "..." &&
			text.length < minInitialChars
		) {
			return;
		}
		scheduleUpdate(text);
	};

	const finalize = async (text: string): Promise<DiscordMessage[]> => {
		if (done) {
			return draftMessage ? [draftMessage] : [];
		}

		clearThrottle();
		pendingText = null;

		if (!started || !draftMessage) {
			warn("draft-stream: finalize called before start");
			done = true;
			return [];
		}

		const trimmed = text.trimEnd();
		if (!trimmed) {
			try {
				await draftMessage.delete();
			} catch {
				// Ignore failed placeholder cleanup.
			}
			done = true;
			return [];
		}

		if (trimmed.length <= maxChars) {
			await sendOrEdit(trimmed);
			done = true;
			log("draft-stream: finalized (single message)");
			return [draftMessage];
		}

		const chunkConfig = {
			...DEFAULT_DRAFT_CHUNK_CONFIG,
			...options.chunkConfig,
		};
		const breakPoint = findBreakPoint(
			trimmed,
			maxChars,
			chunkConfig.breakPreference,
		);
		const firstChunk = trimmed.slice(0, breakPoint).trimEnd();
		let remaining = trimmed.slice(breakPoint).trimStart();

		await sendOrEdit(firstChunk);

		const allMessages: DiscordMessage[] = [draftMessage];
		while (remaining.length > 0 && channel) {
			const nextBreak = findBreakPoint(
				remaining,
				maxChars,
				chunkConfig.breakPreference,
			);
			const chunk = remaining.slice(0, nextBreak).trimEnd();
			remaining = remaining.slice(nextBreak).trimStart();
			if (!chunk) {
				continue;
			}
			try {
				const overflowMessage = await channel.send({
					content: chunk,
					...(draftReplyToMessageId && draftReplyToMode === "all"
						? {
								reply: { messageReference: draftReplyToMessageId },
							}
						: {}),
				});
				allMessages.push(overflowMessage);
			} catch (error) {
				warn(
					`draft-stream: overflow send failed: ${error instanceof Error ? error.message : String(error)}`,
				);
				break;
			}
		}

		done = true;
		log("draft-stream: finalized (multi-message)");
		return allMessages;
	};

	const abort = async (reason?: string): Promise<void> => {
		if (done) {
			return;
		}
		done = true;
		clearThrottle();
		pendingText = null;

		if (!draftMessage) {
			return;
		}

		const errorText = reason
			? `⚠️ ${reason}`
			: "⚠️ Response generation was interrupted.";
		try {
			await draftMessage.edit({ content: errorText });
		} catch {
			try {
				await draftMessage.delete();
			} catch {
				// Give up.
			}
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
