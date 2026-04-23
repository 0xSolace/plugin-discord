import { describe, expect, it } from "vitest";

describe("@elizaos/plugin-discord", () => {
	it("exports the plugin as default", { timeout: 60_000 }, async () => {
		const mod = await import("../index.ts");
		expect(mod.default).toBeDefined();
		expect(typeof mod.default).toBe("object");
	});

	describe("plugin registration contract", () => {
		it("has a name", async () => {
			const { default: plugin } = await import("../index.ts");
			expect(typeof plugin.name).toBe("string");
			expect(plugin.name).toBe("discord");
		});

		it("has a description", async () => {
			const { default: plugin } = await import("../index.ts");
			expect(typeof plugin.description).toBe("string");
			expect(plugin.description.length).toBeGreaterThan(0);
		});

		it("has an init function", async () => {
			const { default: plugin } = await import("../index.ts");
			expect(typeof plugin.init).toBe("function");
		});

		it("has services array with DiscordService", async () => {
			const { default: plugin } = await import("../index.ts");
			expect(Array.isArray(plugin.services)).toBe(true);
			expect(plugin.services?.length).toBeGreaterThan(0);
		});

		it("has routes array", async () => {
			const { default: plugin } = await import("../index.ts");
			expect(Array.isArray(plugin.routes)).toBe(true);
		});

		it("has actions array with well-formed actions", async () => {
			const { default: plugin } = await import("../index.ts");
			expect(Array.isArray(plugin.actions)).toBe(true);
			const actions = plugin.actions ?? [];
			expect(actions.length).toBeGreaterThan(0);

			for (const action of actions) {
				expect(typeof action.name).toBe("string");
				expect(action.name.length).toBeGreaterThan(0);
				expect(typeof action.handler).toBe("function");
				expect(typeof action.validate).toBe("function");
				expect(typeof action.description).toBe("string");
			}
		});

		it("has providers array with well-formed providers", async () => {
			const { default: plugin } = await import("../index.ts");
			expect(Array.isArray(plugin.providers)).toBe(true);
			const providers = plugin.providers ?? [];
			expect(providers.length).toBeGreaterThan(0);

			for (const provider of providers) {
				expect(typeof provider.get).toBe("function");
			}
		});

		it("has tests array", async () => {
			const { default: plugin } = await import("../index.ts");
			expect(Array.isArray(plugin.tests)).toBe(true);
		});

		it("includes expected action names", async () => {
			const { default: plugin } = await import("../index.ts");
			const actionNames = plugin.actions?.map((a) => a.name);
			expect(actionNames).toContain("SEND_MESSAGE");
			expect(actionNames).toContain("SEND_DM");
			expect(actionNames).toContain("JOIN_CHANNEL");
			expect(actionNames).toContain("LEAVE_CHANNEL");
		});
	});

	describe("named exports", () => {
		it("exports DiscordService", async () => {
			const mod = await import("../index.ts");
			expect(mod.DiscordService).toBeDefined();
		});

		it("exports DISCORD_SERVICE_NAME constant", async () => {
			const mod = await import("../index.ts");
			expect(typeof mod.DISCORD_SERVICE_NAME).toBe("string");
		});

		it("exports permission utilities", async () => {
			const mod = await import("../index.ts");
			expect(typeof mod.getPermissionValues).toBe("function");
			expect(typeof mod.generateInviteUrl).toBe("function");
		});

		it("exports messaging utilities", async () => {
			const mod = await import("../index.ts");
			expect(typeof mod.escapeDiscordMarkdown).toBe("function");
			expect(typeof mod.chunkDiscordText).toBe("function");
			expect(typeof mod.truncateText).toBe("function");
			expect(typeof mod.stripDiscordFormatting).toBe("function");
		});

		it("exports allowlist utilities", async () => {
			const mod = await import("../index.ts");
			expect(typeof mod.normalizeDiscordAllowList).toBe("function");
			expect(typeof mod.validateMessageAllowed).toBe("function");
		});

		it("exports account management utilities", async () => {
			const mod = await import("../index.ts");
			expect(typeof mod.resolveDiscordToken).toBe("function");
			expect(typeof mod.normalizeAccountId).toBe("function");
			expect(typeof mod.isMultiAccountEnabled).toBe("function");
		});
	});
});
