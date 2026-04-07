/**
 * Status reaction controller for Discord messages.
 *
 * Manages an emoji reaction lifecycle on user messages to indicate processing status:
 *   ⏳ (queued) → 🤔 (thinking) → ✅ (done) or ❌ (error)
 *
 * Configurable scope controls when reactions are shown:
 *   - "all": React to all messages
 *   - "group-mentions": React only to messages that mention the bot in group channels
 *   - "none": Disabled
 *
 * Inspired by OpenClaw's channels/status-reactions.ts pattern.
 */

import type { Message as DiscordMessage } from "discord.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type StatusReactionScope = "all" | "group-mentions" | "none";

export type StatusReactionEmojis = {
	queued: string;
	thinking: string;
	done: string;
	error: string;
};

export type StatusReactionControllerOptions = {
	/** Whether reactions are enabled. */
	enabled: boolean;
	/** Called when a reaction API call fails (e.g., missing permissions). */
	onError?: (err: unknown) => void;
};

export type StatusReactionController = {
	/** Set queued reaction (⏳). Call when message is first received. */
	setQueued: () => Promise<void>;
	/** Set thinking reaction (🤔). Call when processing begins. */
	setThinking: () => Promise<void>;
	/** Set done reaction (✅). Call when response is sent. Terminal state. */
	setDone: () => Promise<void>;
	/** Set error reaction (❌). Call on processing failure. Terminal state. */
	setError: () => Promise<void>;
	/** Clean up all bot reactions. */
	clear: () => Promise<void>;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_STATUS_EMOJIS: StatusReactionEmojis = {
	queued: "⏳",
	thinking: "🤔",
	done: "✅",
	error: "❌",
};

// ─────────────────────────────────────────────────────────────────────────────
// Scope Resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine if status reactions should be shown for a given message context.
 */
export function shouldShowStatusReaction(params: {
	scope: StatusReactionScope;
	isDM: boolean;
	isBotMentioned: boolean;
	isReplyToBot: boolean;
}): boolean {
	const { scope, isDM, isBotMentioned, isReplyToBot } = params;

	if (scope === "none") return false;
	if (scope === "all") return true;

	// "group-mentions": show in DMs always, in groups only when mentioned/replied-to
	if (scope === "group-mentions") {
		return isDM || isBotMentioned || isReplyToBot;
	}

	return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a status reaction controller for a Discord message.
 *
 * The controller manages the lifecycle of emoji reactions on the user's message.
 * It serializes reaction API calls and handles the transition between states.
 *
 * Usage:
 * ```ts
 * const reactions = createStatusReactionController(message, { enabled: true });
 * await reactions.setQueued();    // ⏳
 * await reactions.setThinking();  // removes ⏳, adds 🤔
 * await reactions.setDone();      // removes 🤔, adds ✅
 * ```
 */
export function createStatusReactionController(
	message: DiscordMessage,
	options: StatusReactionControllerOptions,
	emojis: StatusReactionEmojis = DEFAULT_STATUS_EMOJIS,
): StatusReactionController {
	const { enabled, onError } = options;

	let currentEmoji: string | null = null;
	let finished = false;
	let chainPromise = Promise.resolve();

	// Known emojis we manage (for cleanup)
	const managedEmojis = new Set([
		emojis.queued,
		emojis.thinking,
		emojis.done,
		emojis.error,
	]);

	/**
	 * Serialize async operations to prevent race conditions on reaction API calls.
	 */
	function enqueue(fn: () => Promise<void>): Promise<void> {
		chainPromise = chainPromise.then(fn, fn);
		return chainPromise;
	}

	/**
	 * Safely add a reaction to the message.
	 */
	async function addReaction(emoji: string): Promise<void> {
		try {
			await message.react(emoji);
		} catch (err) {
			if (onError) onError(err);
		}
	}

	/**
	 * Safely remove a specific bot reaction from the message.
	 */
	async function removeReaction(emoji: string): Promise<void> {
		try {
			const botUser = message.client?.user;
			if (!botUser) return;
			const reaction = message.reactions.resolve(emoji);
			if (reaction) {
				await reaction.users.remove(botUser.id);
			}
		} catch (err) {
			// Common: Missing Permissions, Unknown Message, etc.
			// These are expected in channels where bot lacks MANAGE_MESSAGES
			if (onError) onError(err);
		}
	}

	/**
	 * Transition to a new emoji: remove old, add new.
	 */
	async function transitionTo(newEmoji: string): Promise<void> {
		if (!enabled || finished) return;

		// Remove the previous emoji if different
		if (currentEmoji && currentEmoji !== newEmoji) {
			await removeReaction(currentEmoji);
		}

		// Add the new emoji
		await addReaction(newEmoji);
		currentEmoji = newEmoji;
	}

	/**
	 * Terminal transition: set final emoji and mark as finished.
	 */
	async function finishWith(emoji: string): Promise<void> {
		if (!enabled) return;
		finished = true;

		// Remove the current intermediate emoji
		if (currentEmoji && currentEmoji !== emoji) {
			await removeReaction(currentEmoji);
		}

		await addReaction(emoji);
		currentEmoji = emoji;
	}

	// ───────────────────────────────────────────────────────────────────────
	// Public API
	// ───────────────────────────────────────────────────────────────────────

	return {
		setQueued: () => enqueue(() => transitionTo(emojis.queued)),
		setThinking: () => enqueue(() => transitionTo(emojis.thinking)),
		setDone: () => enqueue(() => finishWith(emojis.done)),
		setError: () => enqueue(() => finishWith(emojis.error)),
		clear: () =>
			enqueue(async () => {
				if (!enabled) return;
				finished = true;
				for (const emoji of managedEmojis) {
					await removeReaction(emoji);
				}
				currentEmoji = null;
			}),
	};
}
