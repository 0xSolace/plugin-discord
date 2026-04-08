/**
 * Status reaction lifecycle controller for Discord messages.
 *
 * Provides visual feedback via emoji reactions on user messages:
 *   ⏳ (queued) → 🤔 (thinking) → ✅ (done) / ❌ (error)
 *
 * Features:
 * - Serialized API calls via promise chain (prevents race conditions)
 * - Scope gating: "all" | "group-mentions" | "none"
 * - Terminal state protection (done/error marks finished)
 * - Graceful permission error handling
 *
 * Ported from OpenClaw's status-reactions.ts with discord.js adaptation.
 */

import type { Message as DiscordMessage } from "discord.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type StatusReactionScope = "all" | "group-mentions" | "none";

export interface StatusReactionController {
	/** Mark message as queued (⏳) */
	setQueued: () => void;
	/** Mark message as thinking (🤔) */
	setThinking: () => void;
	/** Mark message as done (✅) — terminal state */
	setDone: () => void;
	/** Mark message as error (❌) — terminal state */
	setError: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const EMOJI_QUEUED = "⏳";
const EMOJI_THINKING = "🤔";
const EMOJI_DONE = "✅";
const EMOJI_ERROR = "❌";

// ─────────────────────────────────────────────────────────────────────────────
// Scope check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine whether status reactions should be shown for a given message.
 *
 * @param scope - The configured scope setting
 * @param message - The Discord message
 * @param botId - The bot's user ID
 * @returns true if reactions should be shown
 */
export function shouldShowStatusReaction(
	scope: StatusReactionScope,
	message: DiscordMessage,
	botId: string | undefined,
): boolean {
	if (scope === "none") return false;
	if (scope === "all") return true;

	// "group-mentions" — always react in DMs, only react in groups when mentioned/replied-to
	const isDM = !message.guild;
	if (isDM) return true;

	// Check if bot is mentioned
	const isMentioned = !!(botId && message.mentions.users?.has(botId));
	// Check if this is a reply to the bot
	const isReplyToBot = message.mentions.repliedUser?.id === botId;

	return isMentioned || isReplyToBot;
}

// ─────────────────────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a status reaction controller for a Discord message.
 *
 * All reaction operations are serialized through a promise chain to prevent
 * race conditions (e.g., removing an emoji before it's been added).
 *
 * @param message - The Discord message to react to
 * @returns StatusReactionController
 */
export function createStatusReactionController(
	message: DiscordMessage,
): StatusReactionController {
	let currentEmoji: string | null = null;
	let finished = false;
	let chain: Promise<void> = Promise.resolve();

	const botId = message.client?.user?.id;

	/**
	 * Queue a reaction transition through the promise chain.
	 * Removes the previous emoji (if any) then adds the new one.
	 */
	const transition = (emoji: string, terminal: boolean = false): void => {
		if (finished) return;

		chain = chain.then(async () => {
			if (finished && !terminal) return;

			try {
				// Remove previous emoji if different
				if (currentEmoji && currentEmoji !== emoji && botId) {
					try {
						const reaction = message.reactions.resolve(currentEmoji);
						if (reaction) {
							await reaction.users.remove(botId);
						}
					} catch {
						// Permission error or reaction already removed — non-critical
					}
				}

				// Add new emoji
				await message.react(emoji);
				currentEmoji = emoji;

				if (terminal) {
					finished = true;
				}
			} catch {
				// Reaction failed (missing permissions, message deleted, etc.)
				// Non-critical: don't block message processing
				if (terminal) {
					finished = true;
				}
			}
		});
	};

	return {
		setQueued: () => transition(EMOJI_QUEUED),
		setThinking: () => transition(EMOJI_THINKING),
		setDone: () => transition(EMOJI_DONE, true),
		setError: () => transition(EMOJI_ERROR, true),
	};
}
