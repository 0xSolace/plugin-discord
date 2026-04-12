import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IAgentRuntime } from "@elizaos/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncDiscordClientProfile } from "../profileSync";

let tempStateDir = "";
let originalCwd = "";

beforeEach(() => {
	tempStateDir = fs.mkdtempSync(
		path.join(os.tmpdir(), "milady-discord-profile-sync-"),
	);
	process.env.MILADY_STATE_DIR = tempStateDir;
	originalCwd = process.cwd();
});

afterEach(() => {
	delete process.env.MILADY_STATE_DIR;
	process.chdir(originalCwd);
	if (tempStateDir) {
		fs.rmSync(tempStateDir, { recursive: true, force: true });
		tempStateDir = "";
	}
});

describe("syncDiscordClientProfile", () => {
	it("syncs the bot username/avatar once and skips unchanged profiles", async () => {
		const avatarPath = path.join(tempStateDir, "avatar.png");
		fs.writeFileSync(avatarPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

		const runtime = {
			agentId: "agent-1",
			character: {
				name: "MiladyBot",
				username: "miladybot",
			},
			logger: {
				info: vi.fn(),
				warn: vi.fn(),
			},
		} as unknown as IAgentRuntime;

		const clientUser = {
			username: "OldBot",
			setUsername: vi.fn(async (nextName: string) => {
				clientUser.username = nextName;
			}),
			setAvatar: vi.fn(async () => undefined),
		};

		await syncDiscordClientProfile(runtime, clientUser, {
			profileAvatar: avatarPath,
			syncProfile: true,
		});

		expect(clientUser.setUsername).toHaveBeenCalledWith("MiladyBot");
		expect(clientUser.setAvatar).toHaveBeenCalledTimes(1);

		await syncDiscordClientProfile(runtime, clientUser, {
			profileAvatar: avatarPath,
			syncProfile: true,
		});

		expect(clientUser.setUsername).toHaveBeenCalledTimes(1);
		expect(clientUser.setAvatar).toHaveBeenCalledTimes(1);

		const persistedStatePath = path.join(
			tempStateDir,
			"cache",
			"discord-profile-sync.v1.json",
		);
		expect(fs.existsSync(persistedStatePath)).toBe(true);
		expect(fs.readFileSync(persistedStatePath, "utf8")).toContain(
			'"username": "MiladyBot"',
		);
	});

	it("falls back to the bundled Eliza avatar path when no explicit avatar is configured", async () => {
		const repoRoot = fs.mkdtempSync(
			path.join(os.tmpdir(), "milady-discord-profile-repo-"),
		);
		const bundledAvatarPath = path.join(
			repoRoot,
			"cloud",
			"public",
			"avatars",
			"eliza.png",
		);
		fs.mkdirSync(path.dirname(bundledAvatarPath), { recursive: true });
		fs.writeFileSync(bundledAvatarPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		process.chdir(repoRoot);

		const runtime = {
			agentId: "agent-1",
			character: {
				name: "Eliza",
				username: "eliza",
			},
			logger: {
				info: vi.fn(),
				warn: vi.fn(),
			},
		} as unknown as IAgentRuntime;

		const clientUser = {
			username: "LegacyBot",
			setUsername: vi.fn(async (nextName: string) => {
				clientUser.username = nextName;
			}),
			setAvatar: vi.fn(async () => undefined),
		};

		try {
			await syncDiscordClientProfile(runtime, clientUser, {
				syncProfile: true,
			});
		} finally {
			fs.rmSync(repoRoot, { recursive: true, force: true });
		}

		expect(clientUser.setUsername).toHaveBeenCalledWith("Eliza");
		expect(clientUser.setAvatar).toHaveBeenCalledTimes(1);
	});
});
