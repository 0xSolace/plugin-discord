import { describe, expect, it, vi } from "vitest";

const roleState = {
	whitelist: {} as Record<string, string[]>,
};

vi.mock("@elizaos/core/roles", () => ({
	getConnectorAdminWhitelist: vi.fn(() => roleState.whitelist),
	setConnectorAdminWhitelist: vi.fn((_runtime, whitelist) => {
		roleState.whitelist = whitelist as Record<string, string[]>;
	}),
}));

import type { IAgentRuntime, UUID } from "@elizaos/core";
import { DiscordService } from "../service";

function createRuntimeMock(
	settings: Record<string, string | null> = {},
): IAgentRuntime {
	return {
		agentId: "agent-1" as UUID,
		character: { name: "Milady" },
		getSetting: vi.fn((key: string) => {
			if (key === "DISCORD_API_TOKEN") {
				return "";
			}
			return settings[key] ?? null;
		}),
		logger: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			success: vi.fn(),
		},
	} as unknown as IAgentRuntime;
}

describe("Discord owner role sync", () => {
	it("merges discovered owner ids into the runtime Discord connector whitelist", async () => {
		roleState.whitelist = {
			discord: ["999999999999999999"],
			telegram: ["telegram-owner"],
		};
		const runtime = createRuntimeMock();
		const service = new DiscordService(runtime) as DiscordService & {
			refreshOwnerDiscordUserIds: (client: unknown) => Promise<void>;
			ownerDiscordUserIds: Set<string>;
		};

		await service.refreshOwnerDiscordUserIds({
			application: {
				fetch: vi.fn().mockResolvedValue({
					owner: { id: "123456789012345678" },
					team: {
						ownerId: "234567890123456789",
						members: [{ user: { id: "345678901234567890" } }],
					},
				}),
			},
		} as unknown);

		expect([...service.ownerDiscordUserIds]).toEqual([
			"123456789012345678",
			"234567890123456789",
			"345678901234567890",
		]);
		expect(roleState.whitelist).toEqual({
			discord: [
				"999999999999999999",
				"123456789012345678",
				"234567890123456789",
				"345678901234567890",
			],
			telegram: ["telegram-owner"],
		});
	});

	it("respects an explicit empty owner-id override without merging discovered owners", async () => {
		roleState.whitelist = {
			discord: ["999999999999999999"],
			telegram: ["telegram-owner"],
		};
		const runtime = createRuntimeMock({
			MILADY_DISCORD_OWNER_USER_IDS_JSON: "[]",
		});
		const service = new DiscordService(runtime) as DiscordService & {
			refreshOwnerDiscordUserIds: (client: unknown) => Promise<void>;
			ownerDiscordUserIds: Set<string>;
		};
		const fetch = vi.fn().mockResolvedValue({
			owner: { id: "123456789012345678" },
		});

		await service.refreshOwnerDiscordUserIds({
			application: { fetch },
		} as unknown);

		expect(fetch).not.toHaveBeenCalled();
		expect([...service.ownerDiscordUserIds]).toEqual([]);
		expect(roleState.whitelist).toEqual({
			discord: ["999999999999999999"],
			telegram: ["telegram-owner"],
		});
	});

	it("uses explicit owner ids instead of auto-discovered application owners", async () => {
		roleState.whitelist = {};
		const runtime = createRuntimeMock({
			MILADY_DISCORD_OWNER_USER_IDS_JSON:
				'["123456789012345678","234567890123456789"]',
		});
		const service = new DiscordService(runtime) as DiscordService & {
			refreshOwnerDiscordUserIds: (client: unknown) => Promise<void>;
			ownerDiscordUserIds: Set<string>;
		};
		const fetch = vi.fn().mockResolvedValue({
			owner: { id: "999999999999999999" },
		});

		await service.refreshOwnerDiscordUserIds({
			application: { fetch },
		} as unknown);

		expect(fetch).not.toHaveBeenCalled();
		expect([...service.ownerDiscordUserIds]).toEqual([
			"123456789012345678",
			"234567890123456789",
		]);
		expect(roleState.whitelist).toEqual({
			discord: ["123456789012345678", "234567890123456789"],
		});
	});
});
