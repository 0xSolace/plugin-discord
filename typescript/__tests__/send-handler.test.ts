import type { UUID } from "@elizaos/core";
import { ChannelType } from "@elizaos/core";
import { describe, expect, it, vi } from "vitest";
import { DiscordService } from "../service";

function createDiscordServiceHarness() {
	const runtime = {
		agentId: "agent-1" as UUID,
		logger: {
			error: vi.fn(),
			warn: vi.fn(),
			info: vi.fn(),
			debug: vi.fn(),
		},
		getEntityById: vi.fn(),
		getRoom: vi.fn(),
		getRelationships: vi.fn().mockResolvedValue([]),
		createMemory: vi.fn().mockResolvedValue(undefined),
		ensureConnection: vi.fn().mockResolvedValue(undefined),
	} as const;

	const send = vi.fn().mockResolvedValue({
		id: "msg-1",
		content: "hello discord",
		url: "https://discord.test/messages/1",
		createdTimestamp: Date.now(),
		attachments: { size: 0 },
	});
	const dmChannel = {
		id: "dm-1",
		isTextBased: () => true,
		isVoiceBased: () => false,
		send,
	} as const;
	const fetchUser = vi.fn();
	const fetchChannel = vi.fn();
	const client = {
		isReady: () => true,
		users: { fetch: fetchUser },
		channels: { fetch: fetchChannel },
		user: {
			id: "bot-1",
			username: "MiladyBot",
			displayName: "MiladyBot",
		},
	} as const;

	const service = Object.create(DiscordService.prototype) as DiscordService & {
		client: typeof client;
		runtime: typeof runtime;
		allowedChannelIds?: string[];
		getChannelType: ReturnType<typeof vi.fn>;
		isChannelAllowed: (channelId: string) => boolean;
	};
	service.client = client;
	service.runtime = runtime;
	service.allowedChannelIds = undefined;
	service.getChannelType = vi.fn().mockResolvedValue(ChannelType.DM);
	service.isChannelAllowed = () => true;

	return {
		service,
		runtime,
		client,
		dmChannel,
		send,
		fetchUser,
		fetchChannel,
	};
}

describe("Discord send handler", () => {
	it("resolves a runtime entity UUID to the entity's Discord user ID", async () => {
		const { service, runtime, dmChannel, fetchUser, send } =
			createDiscordServiceHarness();
		runtime.getEntityById.mockResolvedValue({
			metadata: {
				discord: {
					userId: "123456789012345678",
				},
			},
		});
		fetchUser.mockResolvedValue({
			dmChannel: null,
			createDM: vi.fn().mockResolvedValue(dmChannel),
		});

		await service.handleSendMessage(
			runtime as never,
			{ source: "discord", entityId: "owner-runtime-uuid" as UUID } as never,
			{ text: "hello discord" } as never,
		);

		expect(fetchUser).toHaveBeenCalledWith("123456789012345678");
		expect(send).toHaveBeenCalledWith({
			content: "hello discord",
			files: undefined,
		});
	});

	it("follows confirmed identity links when the canonical owner lacks direct Discord metadata", async () => {
		const { service, runtime, dmChannel, fetchUser, send } =
			createDiscordServiceHarness();
		runtime.getEntityById.mockImplementation(async (entityId: UUID) => {
			if (entityId === ("discord-linked-uuid" as UUID)) {
				return {
					metadata: {
						discord: {
							id: "234567890123456789",
						},
					},
				};
			}
			return {
				metadata: {},
			};
		});
		runtime.getRelationships.mockResolvedValue([
			{
				sourceEntityId: "owner-runtime-uuid",
				targetEntityId: "discord-linked-uuid",
				metadata: { status: "confirmed" },
			},
		]);
		fetchUser.mockResolvedValue({
			dmChannel: dmChannel,
			createDM: vi.fn(),
		});

		await service.handleSendMessage(
			runtime as never,
			{ source: "discord", entityId: "owner-runtime-uuid" as UUID } as never,
			{ text: "linked identity hello" } as never,
		);

		expect(fetchUser).toHaveBeenCalledWith("234567890123456789");
		expect(send).toHaveBeenCalledWith({
			content: "linked identity hello",
			files: undefined,
		});
	});

	it("resolves a Discord roomId to the room channelId before sending", async () => {
		const { service, runtime, dmChannel, fetchChannel, send } =
			createDiscordServiceHarness();
		runtime.getRoom.mockResolvedValue({
			id: "room-runtime-uuid",
			channelId: "345678901234567890",
		});
		fetchChannel.mockResolvedValue(dmChannel);

		await service.handleSendMessage(
			runtime as never,
			{ source: "discord", roomId: "room-runtime-uuid" as UUID } as never,
			{ text: "reply by room" } as never,
		);

		expect(runtime.getRoom).toHaveBeenCalledWith("room-runtime-uuid");
		expect(fetchChannel).toHaveBeenCalledWith("345678901234567890");
		expect(send).toHaveBeenCalledWith({
			content: "reply by room",
			files: undefined,
		});
	});
});
