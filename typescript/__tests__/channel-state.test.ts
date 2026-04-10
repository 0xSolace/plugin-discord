import { ChannelType } from "@elizaos/core";
import { describe, expect, it, vi } from "vitest";
import { channelStateProvider } from "../providers/channelState";
import { ServiceType } from "../types";

describe("channelStateProvider", () => {
	it("includes discord speaker and bot usernames in group-chat context", async () => {
		const runtime = {
			agentId: "agent-1",
			getRoom: vi.fn().mockResolvedValue({
				id: "room-1",
				type: ChannelType.GROUP,
				channelId: "channel-1",
			}),
			getService: vi.fn().mockImplementation((serviceType: string) => {
				if (serviceType !== ServiceType.DISCORD) {
					return null;
				}
				return {
					client: {
						user: {
							username: "EizaBot",
						},
						channels: {
							cache: new Map(),
							fetch: vi.fn().mockResolvedValue({
								name: "general",
								guild: {
									name: "Milady HQ",
								},
							}),
						},
					},
				};
			}),
			logger: {
				error: vi.fn(),
				warn: vi.fn(),
				debug: vi.fn(),
			},
		} as never;

		const result = await channelStateProvider.get(
			runtime,
			{
				roomId: "room-1",
				content: { source: "discord" },
				metadata: {
					entityName: "Shaw",
					entityUserName: "shawmakesmagic",
					discord: {
						name: "Shaw",
						userName: "shawmakesmagic",
					},
				},
			} as never,
			{
				agentName: "eliza",
				senderName: "Shaw",
				data: {},
			} as never,
		);

		expect(result.text).toContain(
			"The current speaker is Shaw (discord username: shawmakesmagic).",
		);
		expect(result.text).toContain(
			"On Discord, eliza is logged in as eliza (discord username: EizaBot).",
		);
	});
});
