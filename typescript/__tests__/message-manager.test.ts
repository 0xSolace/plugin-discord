import { ChannelType, type Memory } from "@elizaos/core";
import { ChannelType as DiscordChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { MessageManager } from "../messages";

describe("Discord MessageManager", () => {
	it("persists inbound messages even when strict mention mode ignores them", async () => {
		const persistedMemory: Memory = {
			id: "memory-1" as Memory["id"],
			entityId: "entity-1" as Memory["entityId"],
			agentId: "agent-1" as Memory["agentId"],
			roomId: "room-1" as Memory["roomId"],
			content: {
				text: "hello there",
				source: "discord",
				channelType: ChannelType.GROUP,
			},
			createdAt: 1710000000000,
		};

		const messageService = {
			handleMessage: vi.fn(),
		};

		const runtime = {
			agentId: "agent-1",
			character: {
				name: "Eiza",
				settings: {
					discord: {
						shouldRespondOnlyToMentions: true,
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
			getService: vi.fn().mockReturnValue(messageService),
			ensureConnection: vi.fn().mockResolvedValue(undefined),
			getMemoryById: vi.fn().mockResolvedValue(null),
			createMemory: vi.fn().mockResolvedValue(persistedMemory.id),
		} as any;

		const discordService = {
			client: {
				user: {
					id: "bot-user-id",
				},
			},
			getChannelType: vi.fn().mockResolvedValue(ChannelType.GROUP),
			buildMemoryFromMessage: vi.fn().mockResolvedValue(persistedMemory),
		} as any;

		const manager = new MessageManager(discordService, runtime);
		vi.spyOn(manager, "processMessage").mockResolvedValue({
			processedContent: "hello there",
			attachments: [],
		});

		const message = {
			id: "discord-message-1",
			content: "hello there",
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
			},
			channel: {
				id: "channel-1",
				type: DiscordChannelType.GuildText,
				isThread: () => false,
			},
			mentions: {
				users: new Map(),
				repliedUser: null,
			},
			reference: null,
			interaction: null,
			attachments: new Map(),
		};

		await manager.handleMessage(message as any);

		expect(runtime.createMemory).toHaveBeenCalledWith(
			persistedMemory,
			"messages",
		);
		expect(messageService.handleMessage).not.toHaveBeenCalled();
	});
});
