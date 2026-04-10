import { ChannelType, type Memory, ServiceType } from "@elizaos/core";
import { ChannelType as DiscordChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { MessageManager } from "../messages";

function createHarness(options?: {
	processedContent?: string;
	builtEntityId?: string;
	shouldRespondOnlyToMentions?: boolean;
	mentionedUsers?: Map<string, { id: string; username: string; bot?: boolean }>;
	repliedUser?: { id: string; username: string; bot?: boolean } | null;
	mockProcessMessage?: boolean;
	browserService?: {
		getPageContent?: (url: string) => Promise<unknown>;
	} | null;
	videoService?: {
		isVideoUrl?: (url: string) => boolean;
		processVideo?: (url: string) => Promise<unknown>;
	} | null;
}) {
	const persistedMemory: Memory = {
		id: "memory-1" as Memory["id"],
		entityId: (options?.builtEntityId ?? "entity-1") as Memory["entityId"],
		agentId: "agent-1" as Memory["agentId"],
		roomId: "room-1" as Memory["roomId"],
		content: {
			text: options?.processedContent ?? "hello there",
			source: "discord",
			channelType: ChannelType.GROUP,
		},
		createdAt: 1710000000000,
	};

	const messageService = {
		handleMessage: vi.fn().mockResolvedValue(undefined),
	};
	const channelSend = vi
		.fn()
		.mockImplementation(
			async (options?: { content?: string; files?: unknown[] }) => ({
				id: `sent-${channelSend.mock.calls.length}`,
				content: options?.content ?? "",
				url: `https://discord.com/channels/guild-1/channel-1/sent-${channelSend.mock.calls.length}`,
				createdTimestamp: 1710000000001,
				attachments: {
					size: Array.isArray(options?.files) ? options.files.length : 0,
				},
			}),
		);

	const runtime = {
		agentId: "agent-1",
		character: {
			name: "Eiza",
			settings: {
				discord: {
					shouldRespondOnlyToMentions:
						options?.shouldRespondOnlyToMentions ?? false,
				},
			},
		},
		logger: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
		getSetting: vi.fn().mockReturnValue(undefined),
		getService: vi.fn().mockImplementation((serviceType: string) => {
			if (serviceType === ServiceType.BROWSER) {
				return options?.browserService ?? null;
			}
			if (serviceType === ServiceType.VIDEO) {
				return options?.videoService ?? null;
			}
			return messageService;
		}),
		messageService,
		ensureConnection: vi.fn().mockResolvedValue(undefined),
		getMemoryById: vi.fn().mockResolvedValue(null),
		createMemory: vi.fn().mockResolvedValue(persistedMemory.id),
	} as any;

	const discordService = {
		client: {
			user: {
				id: "bot-user-id",
				username: "EizaBot",
				globalName: "Eiza",
			},
		},
		getChannelType: vi.fn().mockResolvedValue(ChannelType.GROUP),
		buildMemoryFromMessage: vi
			.fn()
			.mockImplementation(async (_message: unknown, options?: any) => ({
				...persistedMemory,
				content: {
					...persistedMemory.content,
					...(options?.extraContent ?? {}),
				},
				metadata: options?.extraMetadata,
			})),
	} as any;

	const manager = new MessageManager(discordService, runtime);
	if (options?.mockProcessMessage !== false) {
		vi.spyOn(manager, "processMessage").mockResolvedValue({
			processedContent: options?.processedContent ?? "hello there",
			attachments: [],
		});
	}

	const mentionedUsers = options?.mentionedUsers ?? new Map();
	const message = {
		id: "discord-message-1",
		content: options?.processedContent ?? "hello there",
		url: "https://discord.com/channels/guild-1/channel-1/discord-message-1",
		createdTimestamp: 1710000000000,
		author: {
			id: "user-1",
			username: "shaw",
			bot: false,
		},
		member: null,
		guild: {
			id: "guild-1",
			name: "Guild",
			ownerId: "owner-1",
			fetch: vi.fn().mockResolvedValue({ id: "guild-1" }),
			members: {
				cache: {
					get: vi.fn().mockReturnValue({ id: "bot-user-id" }),
				},
			},
		},
		channel: {
			id: "channel-1",
			type: DiscordChannelType.GuildText,
			isThread: () => false,
			send: channelSend,
			sendTyping: vi.fn(),
			guild: {
				members: {
					cache: {
						get: vi.fn().mockReturnValue({ id: "bot-user-id" }),
					},
				},
			},
			client: {
				user: {
					id: "bot-user-id",
				},
			},
			permissionsFor: vi.fn().mockReturnValue({
				has: vi.fn().mockReturnValue(true),
			}),
		},
		mentions: {
			users: mentionedUsers,
			repliedUser: options?.repliedUser ?? null,
		},
		reference: options?.repliedUser ? { messageId: "reply-1" } : null,
		interaction: null,
		attachments: new Map(),
	};

	return {
		manager,
		message,
		channelSend,
		messageService,
		persistedMemory,
		runtime,
	};
}

describe("Discord MessageManager", () => {
	it("persists inbound messages even when strict mention mode ignores them", async () => {
		const { manager, message, messageService, persistedMemory, runtime } =
			createHarness({
				shouldRespondOnlyToMentions: true,
				processedContent: "hello there",
			});

		await manager.handleMessage(message as any);

		expect(runtime.createMemory).toHaveBeenCalledWith(
			expect.objectContaining({
				...persistedMemory,
				content: expect.objectContaining({
					text: "hello there",
					mentionContext: expect.objectContaining({
						isMention: false,
						isReply: false,
					}),
				}),
			}),
			"messages",
		);
		expect(messageService.handleMessage).not.toHaveBeenCalled();
	});

	it("processes messages that mention another user when the bot is also mentioned", async () => {
		const { manager, message, messageService, runtime } = createHarness({
			processedContent: "<@user-2> <@bot-user-id> can you take this one?",
			mentionedUsers: new Map([
				["user-2", { id: "user-2", username: "alice" }],
				["bot-user-id", { id: "bot-user-id", username: "EizaBot", bot: true }],
			]),
		});

		await manager.handleMessage(message as any);

		expect(messageService.handleMessage).toHaveBeenCalledTimes(1);
		expect(messageService.handleMessage).toHaveBeenCalledWith(
			runtime,
			expect.objectContaining({
				content: expect.objectContaining({
					mentionContext: expect.objectContaining({
						isMention: true,
					}),
				}),
			}),
			expect.any(Function),
		);
		expect(runtime.createMemory).not.toHaveBeenCalled();
	});

	it("processes messages that mention another user when the bot is addressed by name", async () => {
		const { manager, message, messageService, runtime } = createHarness({
			processedContent: "<@user-2> Eiza, can you weigh in here too?",
			mentionedUsers: new Map([
				["user-2", { id: "user-2", username: "alice" }],
			]),
		});

		await manager.handleMessage(message as any);

		expect(messageService.handleMessage).toHaveBeenCalledTimes(1);
		expect(messageService.handleMessage).toHaveBeenCalledWith(
			runtime,
			expect.objectContaining({
				content: expect.objectContaining({
					mentionContext: expect.objectContaining({
						isMention: false,
					}),
				}),
			}),
			expect.any(Function),
		);
		expect(runtime.createMemory).not.toHaveBeenCalled();
	});

	it("still ignores messages that only target another user", async () => {
		const { manager, message, messageService, persistedMemory, runtime } =
			createHarness({
				processedContent: "<@user-2> can you handle this?",
				mentionedUsers: new Map([
					["user-2", { id: "user-2", username: "alice" }],
				]),
			});

		await manager.handleMessage(message as any);

		expect(runtime.createMemory).toHaveBeenCalledWith(
			expect.objectContaining({
				...persistedMemory,
				content: expect.objectContaining({
					text: "<@user-2> can you handle this?",
					mentionContext: expect.objectContaining({
						isMention: false,
						isReply: false,
					}),
				}),
			}),
			"messages",
		);
		expect(messageService.handleMessage).not.toHaveBeenCalled();
	});

	it("deduplicates the same Discord message id", async () => {
		const { manager, message, messageService } = createHarness({
			processedContent: "<@bot-user-id> what's on my schedule tomorrow?",
			mentionedUsers: new Map([
				["bot-user-id", { id: "bot-user-id", username: "EizaBot", bot: true }],
			]),
		});

		await manager.handleMessage(message as any);
		await manager.handleMessage(message as any);

		expect(messageService.handleMessage).toHaveBeenCalledTimes(1);
	});

	it("warns when one inbound Discord message triggers multiple visible replies", async () => {
		const { manager, message, runtime, channelSend } = createHarness({
			processedContent: "<@bot-user-id> check my emails from suran again",
			mentionedUsers: new Map([
				["bot-user-id", { id: "bot-user-id", username: "EizaBot", bot: true }],
			]),
		});
		runtime.messageService.handleMessage.mockImplementation(
			async (
				_runtime: unknown,
				_message: unknown,
				onResponse: (content: Record<string, unknown>) => Promise<unknown>,
			) => {
				await onResponse({
					text: "I found an email from Suran.",
					source: "action",
					action: "GMAIL_ACTION",
				});
				await onResponse({
					text: "I also remember we hit a rate limit earlier.",
					source: "action",
					action: "GMAIL_ACTION",
				});
			},
		);

		await manager.handleMessage(message as any);

		expect(channelSend).toHaveBeenCalledTimes(2);
		expect(runtime.logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({
				replyCount: 2,
				action: "GMAIL_ACTION",
				messageId: message.id,
			}),
			"Multiple Discord replies emitted for one inbound message",
		);
	});

	it("ensures inbound connections with the resolved message entity id", async () => {
		const { manager, message, runtime, persistedMemory } = createHarness({
			builtEntityId: "owner-canonical",
			processedContent: "<@bot-user-id> list files",
			mentionedUsers: new Map([
				["bot-user-id", { id: "bot-user-id", username: "EizaBot", bot: true }],
			]),
		});

		await manager.handleMessage(message as any);

		expect(runtime.ensureConnection).toHaveBeenCalledWith(
			expect.objectContaining({
				entityId: persistedMemory.entityId,
				userId: message.author.id,
			}),
		);
	});

	it("does not warn when browser service is unavailable for URL enrichment", async () => {
		const { manager, message, runtime } = createHarness({
			processedContent: "check https://example.com",
			mockProcessMessage: false,
			browserService: null,
			videoService: null,
		});

		const result = await manager.processMessage(message as any);

		expect(result).toEqual({
			processedContent: "check https://example.com",
			attachments: [],
		});
		expect(runtime.logger.warn).not.toHaveBeenCalled();
		expect(runtime.logger.debug).toHaveBeenCalledWith(
			{ src: "plugin:discord", agentId: runtime.agentId },
			"Skipping URL enrichment because browser service is unavailable",
		);
	});
});
