import { createUniqueUuid, Role, type UUID } from "@elizaos/core";
import { describe, expect, it } from "vitest";
import {
	buildDiscordEntityMetadata,
	buildDiscordWorldMetadata,
} from "../identity";

function createRuntimeMock() {
	return {
		agentId: "agent-1" as UUID,
		getSetting: () => null,
	} as const;
}

describe("Discord identity helpers", () => {
	it("prefers the canonical Milady owner over the Discord guild owner", () => {
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
		const ownerId = createUniqueUuid(runtime as never, "owner-raw");

		expect(metadata).toEqual({
			ownership: { ownerId },
			roles: {
				[ownerId]: Role.OWNER,
			},
		});
	});

	it("returns no world metadata when the guild owner is unknown", () => {
		expect(
			buildDiscordWorldMetadata(createRuntimeMock() as never, undefined),
		).toBeUndefined();
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
});
