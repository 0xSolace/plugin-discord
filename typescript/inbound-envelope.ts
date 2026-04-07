/**
 * Inbound Envelope Formatting
 *
 * Builds a structured envelope with metadata that gets prepended to the message
 * content passed to the agent. This gives the agent much richer context about
 * where/when/who the message came from, dramatically improving response quality
 * in multi-channel scenarios.
 *
 * Inspired by OpenClaw's `auto-reply/envelope.ts` and `monitor/inbound-context.ts`.
 *
 * @module inbound-envelope
 */

import {
	ChannelType as DiscordChannelType,
	type Message as DiscordMessage,
	type TextChannel,
	type ThreadChannel,
} from "discord.js";

/**
 * Chat type classification for the envelope header.
 */
export type EnvelopeChatType = "direct" | "channel" | "thread" | "forum";

/**
 * Options for envelope formatting behavior.
 */
export interface EnvelopeOptions {
	/** Whether to include the envelope header at all. Default: true */
	enabled?: boolean;
	/** Whether to include timestamps. Default: true */
	includeTimestamp?: boolean;
	/** Whether to include reply context. Default: true */
	includeReplyContext?: boolean;
	/** Maximum length of quoted reply text. Default: 200 */
	maxReplyLength?: number;
}

/**
 * Resolved metadata about a Discord message's context.
 */
export interface InboundEnvelopeContext {
	/** Discord channel name (e.g., "#general") */
	channelName: string;
	/** Discord channel ID */
	channelId: string;
	/** Sender display name */
	senderName: string;
	/** Sender Discord ID */
	senderId: string;
	/** Message timestamp */
	timestamp: Date;
	/** Chat type classification */
	chatType: EnvelopeChatType;
	/** Guild/server name, if applicable */
	guildName?: string;
	/** Whether this message is a reply to another message */
	isReply: boolean;
	/** The content of the message being replied to */
	replyToContent?: string;
	/** The author of the message being replied to */
	replyToAuthor?: string;
	/** Thread name, if in a thread */
	threadName?: string;
	/** Parent channel name, if in a thread */
	parentChannelName?: string;
}

/**
 * Resolves the chat type from a Discord message.
 */
function resolveChatType(message: DiscordMessage): EnvelopeChatType {
	const channel = message.channel;

	if (channel.type === DiscordChannelType.DM) {
		return "direct";
	}

	if (channel.isThread()) {
		// Check if parent is a forum channel
		const parent = channel.parent;
		if (
			parent &&
			(parent.type === DiscordChannelType.GuildForum ||
				parent.type === DiscordChannelType.GuildMedia)
		) {
			return "forum";
		}
		return "thread";
	}

	return "channel";
}

/**
 * Builds the full inbound context from a Discord message.
 */
export async function buildInboundEnvelopeContext(
	message: DiscordMessage,
): Promise<InboundEnvelopeContext> {
	const channel = message.channel;
	const chatType = resolveChatType(message);

	// Resolve channel name
	let channelName: string;
	let threadName: string | undefined;
	let parentChannelName: string | undefined;

	if (channel.type === DiscordChannelType.DM) {
		channelName = "DM";
	} else if (channel.isThread()) {
		const threadChannel = channel as ThreadChannel;
		threadName = threadChannel.name;
		parentChannelName = threadChannel.parent?.name ?? undefined;
		channelName = parentChannelName
			? `#${parentChannelName} › ${threadName}`
			: `#${threadName}`;
	} else if ("name" in channel && channel.name) {
		channelName = `#${channel.name}`;
	} else {
		channelName = `channel:${channel.id}`;
	}

	// Resolve sender name (prefer nickname > display name > username)
	const senderName =
		message.member?.displayName ??
		message.author.globalName ??
		message.author.username;

	// Resolve reply context
	let isReply = false;
	let replyToContent: string | undefined;
	let replyToAuthor: string | undefined;

	if (message.reference?.messageId) {
		isReply = true;
		try {
			const referencedMsg = await message.fetchReference();
			if (referencedMsg) {
				replyToAuthor =
					referencedMsg.member?.displayName ??
					referencedMsg.author?.globalName ??
					referencedMsg.author?.username;
				replyToContent = referencedMsg.content || undefined;
			}
		} catch {
			// Referenced message may have been deleted; gracefully skip
		}
	}

	return {
		channelName,
		channelId: channel.id,
		senderName,
		senderId: message.author.id,
		timestamp: message.createdAt,
		chatType,
		guildName: message.guild?.name ?? undefined,
		isReply,
		replyToContent,
		replyToAuthor,
		threadName,
		parentChannelName,
	};
}

/**
 * Formats a timestamp for the envelope header.
 * Includes weekday for model convenience (small models struggle to derive DOW).
 */
function formatEnvelopeTimestamp(date: Date): string {
	try {
		const weekday = new Intl.DateTimeFormat("en-US", {
			weekday: "short",
		}).format(date);
		const time = new Intl.DateTimeFormat("en-US", {
			hour: "2-digit",
			minute: "2-digit",
			hour12: false,
			timeZoneName: "short",
		}).format(date);
		const dateStr = new Intl.DateTimeFormat("en-US", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
		}).format(date);
		return `${weekday} ${dateStr} ${time}`;
	} catch {
		return date.toISOString();
	}
}

/**
 * Sanitizes a string for use in the envelope header.
 * Prevents injection of brackets or newlines that could break parsing.
 */
function sanitizeHeaderPart(value: string): string {
	return value
		.replace(/\r\n|\r|\n/g, " ")
		.replaceAll("[", "(")
		.replaceAll("]", ")")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Formats the inbound envelope as a structured preamble prepended to the message body.
 *
 * Output format examples:
 *   [Discord #general | MyServer] @username (Mon 04/07/2026 14:30 MDT): Hello world
 *   [Discord DM] @shadow (Mon 04/07/2026 14:30 MDT): Hey there
 *   [Discord #parent › thread-name | MyServer] @user (Mon 04/07/2026 14:30 MDT) replying to @other: message
 */
export function formatInboundEnvelope(
	ctx: InboundEnvelopeContext,
	body: string,
	options?: EnvelopeOptions,
): string {
	if (options?.enabled === false) {
		return body;
	}

	const includeTimestamp = options?.includeTimestamp !== false;
	const includeReplyContext = options?.includeReplyContext !== false;
	const maxReplyLength = options?.maxReplyLength ?? 200;

	// Build the channel label
	const parts: string[] = ["Discord"];

	// Channel name
	parts.push(sanitizeHeaderPart(ctx.channelName));

	// Guild name (skip for DMs)
	if (ctx.guildName && ctx.chatType !== "direct") {
		parts.push(sanitizeHeaderPart(ctx.guildName));
	}

	const header = parts.join(" ");

	// Build sender + timestamp portion
	const sender = sanitizeHeaderPart(ctx.senderName);
	const timestamp = includeTimestamp
		? ` (${formatEnvelopeTimestamp(ctx.timestamp)})`
		: "";

	// Build reply context
	let replyPrefix = "";
	if (includeReplyContext && ctx.isReply && ctx.replyToAuthor) {
		replyPrefix = ` replying to @${sanitizeHeaderPart(ctx.replyToAuthor)}`;
	}

	// Assemble the envelope
	let envelope = `[${header}] @${sender}${timestamp}${replyPrefix}: ${body}`;

	// Append quoted reply content if available
	if (
		includeReplyContext &&
		ctx.isReply &&
		ctx.replyToContent
	) {
		let quoted = ctx.replyToContent;
		if (quoted.length > maxReplyLength) {
			quoted = `${quoted.slice(0, maxReplyLength)}...`;
		}
		envelope = `[${header}] @${sender}${timestamp}${replyPrefix}:\n> ${quoted.replace(/\n/g, "\n> ")}\n${body}`;
	}

	return envelope;
}
