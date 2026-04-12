import { Role, type UUID } from "@elizaos/core";
import { describe, expect, it } from "vitest";
import {
	buildDiscordEntityMetadata,
	buildDiscordWorldMetadata,
	extractDiscordOwnerUserIds,
	parseDiscordOwnerUserIds,
	resolveDiscordRuntimeEntityId,
	resolveMiladyOwnerEntityId,
} from "../identity";

function createRuntimeMock() {
	return {
		agentId: "agent-1" as UUID,
		getSetting: () => null,
	} as const;
}

describe("Discord identity helpers", () => {
	it("prefers the ELIZA canonical owner over the Discord guild owner", () => {
		const runtime = {
			...createRuntimeMock(),
			getSetting: (key: string) =>
				key === "ELIZA_ADMIN_ENTITY_ID" ? "owner-canonical-uuid" : null,
		};
		const metadata = buildDiscordWorldMetadata(runtime as never, "owner-raw");

		expect(metadata).toEqual({
			ownership: { ownerId: "owner-canonical-uuid" },
			roles: {
				"owner-canonical-uuid": Role.OWNER,
			},
		});
	});

	it("falls back to the legacy Milady owner setting when needed", () => {
		const runtime = {
			...createRuntimeMock(),
			getSetting: (key: string) =>
				key === "MILADY_ADMIN_ENTITY_ID" ? "owner-canonical-uuid" : null,
		};
		const metadata = buildDiscordWorldMetadata(runtime as never, "owner-raw");

		expect(metadata).toEqual({
			ownership: { ownerId: "owner-canonical-uuid" },
			roles: {
				"owner-canonical-uuid": Role.OWNER,
			},
		});
	});

	it("falls back to the Discord guild owner when no canonical owner is configured", () => {
		const runtime = createRuntimeMock();
		const metadata = buildDiscordWorldMetadata(runtime as never, "owner-raw");
		const ownerId = resolveMiladyOwnerEntityId(runtime as never);

		expect(metadata).toEqual({
			ownership: { ownerId },
			roles: {
				[ownerId]: Role.OWNER,
			},
		});
	});

	it("still assigns canonical owner metadata when the guild owner is unknown", () => {
		const runtime = createRuntimeMock();
		const ownerId = resolveMiladyOwnerEntityId(runtime as never);

		expect(buildDiscordWorldMetadata(runtime as never, undefined)).toEqual({
			ownership: { ownerId },
			roles: {
				[ownerId]: Role.OWNER,
			},
		});
	});

	it("preserves raw Discord ids in entity metadata for role resolution", () => {
		expect(
			buildDiscordEntityMetadata(
				"discord-owner-111",
				"shaw#0001",
				"Shaw",
				"Shaw Walters",
			),
		).toEqual({
			default: {
				username: "shaw#0001",
				name: "Shaw",
			},
			discord: {
				id: "discord-owner-111",
				userId: "discord-owner-111",
				userName: "shaw#0001",
				username: "shaw#0001",
				name: "Shaw",
				globalName: "Shaw Walters",
			},
			originalId: "discord-owner-111",
			username: "shaw#0001",
			displayName: "Shaw",
		});
	});

	it("maps the Discord application owner onto the canonical Milady owner entity", () => {
		const runtime = createRuntimeMock();
		expect(
			resolveDiscordRuntimeEntityId(runtime as never, "123456789012345678", [
				"123456789012345678",
			]),
		).toBe(resolveMiladyOwnerEntityId(runtime as never));
	});

	it("extracts owner ids from Discord application owner and team metadata", () => {
		expect(
			extractDiscordOwnerUserIds({
				owner: {
					id: "123456789012345678",
				},
				team: {
					ownerId: "234567890123456789",
					members: [
						{ user: { id: "345678901234567890" } },
						{ id: "123456789012345678" },
					],
				},
			}),
		).toEqual([
			"123456789012345678",
			"234567890123456789",
			"345678901234567890",
		]);
	});

	it("includes guild owner in world metadata roles when snowflake is provided", () => {
		const runtime = createRuntimeMock();
		const canonicalOwnerId = resolveMiladyOwnerEntityId(runtime as never);
		const guildOwnerSnowflake = "987654321098765432";
		const metadata = buildDiscordWorldMetadata(
			runtime as never,
			guildOwnerSnowflake,
		);

		// Should have two OWNER entries: canonical owner + guild owner entity
		expect(metadata?.ownership?.ownerId).toBe(canonicalOwnerId);
		const roles = metadata?.roles as Record<string, unknown>;
		expect(roles[canonicalOwnerId]).toBe(Role.OWNER);
		// Guild owner entity ID is distinct from canonical owner
		const roleKeys = Object.keys(roles);
		expect(roleKeys.length).toBe(2);
		expect(Object.values(roles).every((r) => r === Role.OWNER)).toBe(true);
	});

	it("extracts owner ids from Collection-like team members", () => {
		// Discord.js returns team.members as a Collection (Map-like), not Array.
		const membersMap = new Map([
			["345678901234567890", { id: "345678901234567890" }],
			["456789012345678901", { user: { id: "456789012345678901" } }],
		]);
		expect(
			extractDiscordOwnerUserIds({
				owner: { id: "123456789012345678" },
				team: {
					ownerId: "234567890123456789",
					members: membersMap,
				},
			}),
		).toEqual([
			"123456789012345678",
			"234567890123456789",
			"345678901234567890",
			"456789012345678901",
		]);
	});

	it("parses explicit owner ids from runtime settings JSON", () => {
		expect(
			parseDiscordOwnerUserIds(
				JSON.stringify(["123456789012345678", "invalid", "234567890123456789"]),
			),
		).toEqual(["123456789012345678", "234567890123456789"]);
	});
});
