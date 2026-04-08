/**
 * Inbound envelope formatting for Discord messages.
 *
 * Wraps inbound messages with structured metadata before passing to the agent,
 * giving the LLM much richer context about where/when/who the message is from.
 *
 * Format:
 *   [Discord #general | MyServer] @username (Mon 04/07/2026 14:30 MDT): Hello world
 *   [Discord DM] @shadow (Mon 04/07/2026 14:30 MDT): Hey there
 *   [Discord #parent › thread-name | MyServer] @user (Mon 04/07/2026 14:30 MDT) replying to @other:
 *   > quoted reply text
 *   actual message
 *
 * Features:
 * - Channel name resolution (including thread → parent hierarchy)
 * - Sender name resolution (nickname > display name > username)
 * - Timestamp with weekday (models struggle to derive DOW)
 * - Chat type detection: DM, channel, thread, forum
 * - Reply-to context: fetches referenced message, quotes author and content
 * - Guild name for multi-server context
 * - Configurable via DISCORD_ENVELOPE_ENABLED (default: true)
 * - Non-critical: errors fall back to raw content gracefully
 *
 * Ported from OpenClaw's envelope.ts with discord.js adaptation.
 */

import {
	ChannelType as DiscordChannelType,
	type Message as DiscordMessage,
	type TextChannel,
	type ThreadChannel,
} from "discord.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ChatType = "dm" | "channel" | "thread" | "forum";

export interface EnvelopeResult {
	/** The formatted content with envelope prefix */
	formattedContent: string;
	/** Detected chat type */
	chatType: ChatType;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Format a timestamp as "Mon 04/07/2026 14:30 MDT"
 * Includes weekday because models struggle to derive day-of-week from dates.
 */
function formatTimestamp(timestamp: number | Date): string {
	const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
	const dow = WEEKDAYS[date.getDay()];
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	const year = date.getFullYear();
	const hours = String(date.getHours()).padStart(2, "0");
	const minutes = String(date.getMinutes()).padStart(2, "0");

	// Get timezone abbreviation
	let tz: string;
	try {
		tz =
			date
				.toLocaleTimeString("en-US", { timeZoneName: "short" })
				.split(" ")
				.pop() ?? "UTC";
	} catch {
		tz = "UTC";
	}

	return `${dow} ${month}/${day}/${year} ${hours}:${minutes} ${tz}`;
}

/**
 * Detect the chat type from a Discord message.
 */
function detectChatType(message: DiscordMessage): ChatType {
	const channelType = message.channel.type;

	if (
		channelType === DiscordChannelType.DM ||
		channelType === DiscordChannelType.GroupDM
	) {
		return "dm";
	}

	if (
		channelType === DiscordChannelType.PublicThread ||
		channelType === DiscordChannelType.PrivateThread ||
		channelType === DiscordChannelType.AnnouncementThread
	) {
		// Check if parent is a forum
		const thread = message.channel as ThreadChannel;
		if (thread.parent?.type === DiscordChannelType.GuildForum) {
			return "forum";
		}
		return "thread";
	}

	return "channel";
}

/**
 * Get the sender's display name, preferring nickname > globalName > displayName > username.
 */
function getSenderName(message: DiscordMessage): string {
	// Guild nickname
	if (message.member?.nickname) {
		return message.member.nickname;
	}
	// Global display name
	if (message.author.globalName) {
		return message.author.globalName;
	}
	// displayName (falls back to username in discord.js)
	return message.author.displayName ?? message.author.username;
}

/**
 * Build the channel label, e.g., "#general | MyServer" or "#parent › thread | MyServer"
 */
function buildChannelLabel(message: DiscordMessage, chatType: ChatType): string {
	if (chatType === "dm") {
		return "DM";
	}

	const guildName = message.guild?.name;
	let channelPart: string;

	if (chatType === "thread" || chatType === "forum") {
		const thread = message.channel as ThreadChannel;
		const parentName = thread.parent?.name ?? "unknown";
		const threadName = thread.name ?? "thread";
		channelPart = `#${parentName} › ${threadName}`;
	} else {
		const channel = message.channel as TextChannel;
		channelPart = `#${channel.name ?? message.channel.id}`;
	}

	return guildName ? `${channelPart} | ${guildName}` : channelPart;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format an inbound Discord message with structured metadata envelope.
 *
 * @param message - The Discord message
 * @param rawContent - The raw/processed content text
 * @returns EnvelopeResult with formatted content and chat type
 */
export async function formatInboundEnvelope(
	message: DiscordMessage,
	rawContent: string,
): Promise<EnvelopeResult> {
	const chatType = detectChatType(message);
	const channelLabel = buildChannelLabel(message, chatType);
	const senderName = getSenderName(message);
	const timestamp = formatTimestamp(message.createdTimestamp ?? Date.now());

	// Build reply-to context if this is a reply
	let replyContext = "";
	if (message.reference?.messageId) {
		try {
			const refMessage = await message.fetchReference();
			if (refMessage) {
				const refAuthor =
					refMessage.author?.displayName ??
					refMessage.author?.username ??
					"unknown";
				const refContent = refMessage.content ?? "";
				const truncatedRef =
					refContent.length > 200
						? `${refContent.substring(0, 200)}...`
						: refContent;
				if (truncatedRef) {
					replyContext = ` replying to @${refAuthor}:\n> ${truncatedRef}\n`;
				} else {
					replyContext = ` replying to @${refAuthor}:\n`;
				}
			}
		} catch {
			// Could not fetch referenced message — skip reply context
		}
	}

	// Build the envelope
	const header = `[Discord ${channelLabel}] @${senderName} (${timestamp})`;

	let formattedContent: string;
	if (replyContext) {
		formattedContent = `${header}${replyContext}${rawContent}`;
	} else {
		formattedContent = `${header}: ${rawContent}`;
	}

	return { formattedContent, chatType };
}
