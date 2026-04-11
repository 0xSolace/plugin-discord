import {
	type Action,
	type ActionExample,
	type ActionResult,
	type HandlerCallback,
	type HandlerOptions,
	type IAgentRuntime,
	type Memory,
	type State,
	logger,
} from "@elizaos/core";
import {
	ChannelType,
	type Message,
	type TextChannel,
	type DMChannel,
} from "discord.js";
import { DISCORD_SERVICE_NAME } from "../constants";
import type { DiscordService } from "../service";
import * as fs from "node:fs";
import * as path from "node:path";

// ────────────────────────────────────────────────────────────
// Credential Preset Registry
// ────────────────────────────────────────────────────────────

export interface CredentialPreset {
	/** Unique service identifier */
	name: string;
	/** Human-friendly display name */
	displayName: string;
	/** Fields to collect from the user */
	fields: CredentialField[];
	/** URL where user can generate their key */
	helpUrl: string;
	/** Short instructions shown to user */
	helpText: string;
	/** Validate collected credentials against the service API. Returns display info on success. */
	validate: (
		credentials: Record<string, string>,
	) => Promise<{ valid: boolean; identity?: string; error?: string }>;
}

interface CredentialField {
	key: string;
	label: string;
	/** If true, this field contains a secret and the message should be deleted */
	secret: boolean;
}

const CREDENTIALS_DIR = "/root/.credentials";

const presets: Map<string, CredentialPreset> = new Map();

/** Register a new credential preset. Call at module load or runtime. */
export function registerPreset(preset: CredentialPreset): void {
	presets.set(preset.name.toLowerCase(), preset);
}

/** Get a preset by name (case-insensitive). */
export function getPreset(name: string): CredentialPreset | undefined {
	return presets.get(name.toLowerCase());
}

/** List all registered preset names. */
export function listPresets(): string[] {
	return Array.from(presets.keys());
}

// ────────────────────────────────────────────────────────────
// Built-in Presets
// ────────────────────────────────────────────────────────────

registerPreset({
	name: "github",
	displayName: "GitHub",
	fields: [{ key: "token", label: "Personal Access Token", secret: true }],
	helpUrl: "https://github.com/settings/tokens",
	helpText:
		"Create a fine-grained PAT at the link above. Give it the permissions you need (repo access, etc).",
	async validate(creds) {
		try {
			const res = await fetch("https://api.github.com/user", {
				headers: {
					Authorization: `Bearer ${creds.token}`,
					Accept: "application/vnd.github+json",
				},
			});
			if (!res.ok)
				return { valid: false, error: `GitHub returned ${res.status}` };
			const data = (await res.json()) as { login?: string };
			return { valid: true, identity: `@${data.login}` };
		} catch (e) {
			return {
				valid: false,
				error: e instanceof Error ? e.message : String(e),
			};
		}
	},
});

registerPreset({
	name: "vercel",
	displayName: "Vercel",
	fields: [{ key: "token", label: "API Token", secret: true }],
	helpUrl: "https://vercel.com/account/tokens",
	helpText: "Create a token at the link above. Full Account scope works best.",
	async validate(creds) {
		try {
			const res = await fetch("https://api.vercel.com/v9/projects", {
				headers: { Authorization: `Bearer ${creds.token}` },
			});
			if (!res.ok)
				return { valid: false, error: `Vercel returned ${res.status}` };
			const data = (await res.json()) as {
				projects?: Array<{ name: string }>;
			};
			const count = data.projects?.length ?? 0;
			return { valid: true, identity: `${count} project(s) accessible` };
		} catch (e) {
			return {
				valid: false,
				error: e instanceof Error ? e.message : String(e),
			};
		}
	},
});

registerPreset({
	name: "cloudflare",
	displayName: "Cloudflare",
	fields: [
		{ key: "apiKey", label: "Global API Key", secret: true },
		{ key: "email", label: "Account Email", secret: false },
	],
	helpUrl: "https://dash.cloudflare.com/profile/api-tokens",
	helpText:
		'Go to your Cloudflare dashboard > Profile > API Tokens > "Global API Key". You\'ll also need your account email.',
	async validate(creds) {
		try {
			const res = await fetch("https://api.cloudflare.com/client/v4/zones", {
				headers: {
					"X-Auth-Key": creds.apiKey,
					"X-Auth-Email": creds.email,
				},
			});
			if (!res.ok)
				return { valid: false, error: `Cloudflare returned ${res.status}` };
			const data = (await res.json()) as {
				result?: Array<{ name: string }>;
			};
			const zones = data.result?.map((z) => z.name).join(", ") ?? "none";
			return { valid: true, identity: `zones: ${zones}` };
		} catch (e) {
			return {
				valid: false,
				error: e instanceof Error ? e.message : String(e),
			};
		}
	},
});

registerPreset({
	name: "anthropic",
	displayName: "Anthropic",
	fields: [{ key: "apiKey", label: "API Key", secret: true }],
	helpUrl: "https://console.anthropic.com/settings/keys",
	helpText: "Create an API key in the Anthropic console at the link above.",
	async validate(creds) {
		try {
			const res = await fetch("https://api.anthropic.com/v1/messages", {
				method: "POST",
				headers: {
					"x-api-key": creds.apiKey,
					"anthropic-version": "2023-06-01",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "claude-3-5-haiku-20241022",
					max_tokens: 1,
					messages: [{ role: "user", content: "hi" }],
				}),
			});
			// 200 = works, 429 = rate limited but key is valid
			if (res.ok || res.status === 429)
				return { valid: true, identity: "key verified" };
			return { valid: false, error: `Anthropic returned ${res.status}` };
		} catch (e) {
			return {
				valid: false,
				error: e instanceof Error ? e.message : String(e),
			};
		}
	},
});

registerPreset({
	name: "openai",
	displayName: "OpenAI",
	fields: [{ key: "apiKey", label: "API Key", secret: true }],
	helpUrl: "https://platform.openai.com/api-keys",
	helpText: "Create an API key at the OpenAI platform link above.",
	async validate(creds) {
		try {
			const res = await fetch("https://api.openai.com/v1/models", {
				headers: { Authorization: `Bearer ${creds.apiKey}` },
			});
			if (res.ok || res.status === 429)
				return { valid: true, identity: "key verified" };
			return { valid: false, error: `OpenAI returned ${res.status}` };
		} catch (e) {
			return {
				valid: false,
				error: e instanceof Error ? e.message : String(e),
			};
		}
	},
});

registerPreset({
	name: "fal",
	displayName: "fal.ai",
	fields: [{ key: "apiKey", label: "API Key", secret: true }],
	helpUrl: "https://fal.ai/dashboard/keys",
	helpText: "Generate an API key from your fal.ai dashboard.",
	async validate(creds) {
		try {
			// fal uses key_id:key_secret format; just check auth header is accepted
			const res = await fetch("https://rest.fal.run/fal-ai/fast-sdxl", {
				method: "POST",
				headers: {
					Authorization: `Key ${creds.apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					prompt: "test",
					image_size: { width: 64, height: 64 },
					num_images: 1,
				}),
			});
			// 200 or 422 (bad params but auth passed) or 429 means key is good
			if (res.ok || res.status === 422 || res.status === 429)
				return { valid: true, identity: "key verified" };
			return { valid: false, error: `fal.ai returned ${res.status}` };
		} catch (e) {
			return {
				valid: false,
				error: e instanceof Error ? e.message : String(e),
			};
		}
	},
});

registerPreset({
	name: "generic",
	displayName: "Custom Credential",
	fields: [
		{ key: "envName", label: "environment variable name (e.g. MY_API_KEY)", secret: false },
		{ key: "value", label: "value", secret: true },
	],
	helpUrl: "",
	helpText:
		"I'll store this as a generic credential. Give me the env var name and value.",
	async validate(_creds) {
		// No validation for generic credentials
		return { valid: true, identity: "stored (unvalidated)" };
	},
});

// ────────────────────────────────────────────────────────────
// Credential Storage
// ────────────────────────────────────────────────────────────

function ensureCredentialsDir(): void {
	if (!fs.existsSync(CREDENTIALS_DIR)) {
		fs.mkdirSync(CREDENTIALS_DIR, { recursive: true, mode: 0o700 });
	}
}

function storeCredentials(
	service: string,
	credentials: Record<string, string>,
): void {
	ensureCredentialsDir();
	const filePath = path.join(CREDENTIALS_DIR, `${service}.json`);
	fs.writeFileSync(filePath, JSON.stringify(credentials, null, 2), {
		mode: 0o600,
	});
}

function loadCredentials(
	service: string,
): Record<string, string> | null {
	const filePath = path.join(CREDENTIALS_DIR, `${service}.json`);
	if (!fs.existsSync(filePath)) return null;
	try {
		return JSON.parse(fs.readFileSync(filePath, "utf-8"));
	} catch {
		return null;
	}
}

// ────────────────────────────────────────────────────────────
// Conversation State (per-user setup sessions)
// ────────────────────────────────────────────────────────────

interface SetupSession {
	preset: CredentialPreset;
	/** Index into preset.fields for the next field to collect */
	currentFieldIndex: number;
	/** Collected values so far */
	collected: Record<string, string>;
	/** Discord channel ID where the session is active */
	channelId: string;
	/** Timestamp for session expiry */
	startedAt: number;
}

/** Active setup sessions keyed by Discord user ID */
const activeSessions = new Map<string, SetupSession>();

/** Session timeout: 5 minutes */
const SESSION_TIMEOUT_MS = 5 * 60 * 1000;

function cleanExpiredSessions(): void {
	const now = Date.now();
	for (const [userId, session] of activeSessions) {
		if (now - session.startedAt > SESSION_TIMEOUT_MS) {
			activeSessions.delete(userId);
		}
	}
}

// ────────────────────────────────────────────────────────────
// Message Deletion Helper
// ────────────────────────────────────────────────────────────

async function tryDeleteMessage(
	discordService: DiscordService,
	channelId: string,
	messageId: string,
): Promise<boolean> {
	try {
		const client = discordService.client;
		if (!client) return false;
		const channel = await client.channels.fetch(channelId);
		if (!channel || !("messages" in channel)) return false;
		const msg = await (channel as TextChannel).messages.fetch(messageId);
		await msg.delete();
		return true;
	} catch (e) {
		logger.warn(
			{ src: "setup-credentials", error: String(e) },
			"Could not delete user message containing secret",
		);
		return false;
	}
}

// ────────────────────────────────────────────────────────────
// Trigger Detection
// ────────────────────────────────────────────────────────────

const TRIGGER_PATTERNS = [
	/\bsetup\s+(github|vercel|cloudflare|anthropic|openai|fal|credentials?)\b/i,
	/\badd\s+(my\s+)?(api\s+)?key\b/i,
	/\badd\s+credentials?\b/i,
	/\bconfigure\s+(github|vercel|cloudflare|anthropic|openai|fal)\b/i,
	/\bconnect\s+(github|vercel|cloudflare|anthropic|openai|fal)\b/i,
	/^\/setup\b/i,
];

function detectSetupIntent(text: string): string | null {
	const lower = text.toLowerCase().trim();

	// Check for specific service mentions
	for (const preset of presets.keys()) {
		if (preset === "generic") continue;
		const pattern = new RegExp(
			`\\b(setup|configure|connect|add)\\s+(my\\s+)?${preset}\\b`,
			"i",
		);
		if (pattern.test(lower)) return preset;
	}

	// Check for /setup <service>
	const slashMatch = lower.match(/^\/setup\s+(\w+)/);
	if (slashMatch) {
		const service = slashMatch[1].toLowerCase();
		if (presets.has(service)) return service;
		if (service === "custom") return "generic";
	}

	// Generic trigger (no specific service)
	for (const pattern of TRIGGER_PATTERNS) {
		if (pattern.test(lower)) return null; // matched but no specific service
	}

	return undefined as unknown as string | null; // no match
}

function isSetupTrigger(text: string): boolean {
	const lower = text.toLowerCase().trim();
	for (const pattern of TRIGGER_PATTERNS) {
		if (pattern.test(lower)) return true;
	}
	return false;
}

// ────────────────────────────────────────────────────────────
// Service Selection Prompt
// ────────────────────────────────────────────────────────────

function buildServiceListMessage(): string {
	const services = listPresets()
		.filter((p) => p !== "generic")
		.map((p) => {
			const preset = getPreset(p);
			return `• **${preset?.displayName ?? p}** (\`${p}\`)`;
		});

	return [
		"Which service do you want to set up? Here's what I support:",
		"",
		...services,
		"• **Custom** (`custom`) - any env var",
		"",
		"Just tell me the name, e.g. `github` or `custom`.",
	].join("\n");
}

// ────────────────────────────────────────────────────────────
// Action Definition
// ────────────────────────────────────────────────────────────

export const setupCredentials: Action = {
	name: "SETUP_CREDENTIALS",
	similes: [
		"ADD_CREDENTIALS",
		"CONFIGURE_SERVICE",
		"CONNECT_SERVICE",
		"ADD_API_KEY",
		"SETUP_SERVICE",
	],
	description:
		"Walk the user through setting up API credentials for third-party services (GitHub, Vercel, Cloudflare, etc). " +
		"Collects keys conversationally, validates them against the service API, and stores them securely. " +
		"Deletes messages containing secrets immediately after reading.",

	validate: async (
		_runtime: IAgentRuntime,
		message: Memory,
		_state?: State,
	): Promise<boolean> => {
		if (message.content.source !== "discord") return false;

		const text = message.content.text?.trim() ?? "";
		const userId = message.entityId as string;

		// Active session for this user = always valid (they're mid-flow)
		if (activeSessions.has(userId)) return true;

		// Otherwise check for setup intent
		return isSetupTrigger(text);
	},

	handler: async (
		runtime: IAgentRuntime,
		message: Memory,
		state?: State,
		_options?: HandlerOptions,
		callback?: HandlerCallback,
	): Promise<ActionResult | undefined> => {
		const discordService = runtime.getService(
			DISCORD_SERVICE_NAME,
		) as DiscordService;

		if (!discordService?.client) {
			if (callback) {
				await callback({
					text: "Discord service isn't available right now.",
					source: "discord",
				});
			}
			return { success: false, error: "Discord service unavailable" };
		}

		const text = message.content.text?.trim() ?? "";
		const userId = message.entityId as string;
		const roomId = message.roomId as string;

		// Clean up expired sessions
		cleanExpiredSessions();

		// ── Check if we're in a DM ──────────────────────────────
		const room = state?.data?.room || (await runtime.getRoom(message.roomId));
		const channelId = (room as unknown as Record<string, unknown>)?.channelId as string ?? roomId;

		let isDM = false;
		try {
			const channel = await discordService.client.channels.fetch(channelId);
			isDM =
				channel?.type === ChannelType.DM ||
				channel?.type === ChannelType.GroupDM;
		} catch {
			// If we can't fetch the channel, assume not DM
		}

		if (!isDM && !activeSessions.has(userId)) {
			// First message in a public channel: redirect to DMs
			if (callback) {
				await callback({
					text: "Let's do this in DMs for security. I'll send you a message.",
					source: "discord",
				});
			}

			try {
				// Find the Discord user and open a DM
				const discordUser = await discordService.client.users.fetch(userId);
				const dmChannel = await discordUser.createDM();

				// Detect what they wanted and start the flow there
				const detectedService = detectSetupIntent(text);
				if (detectedService && presets.has(detectedService)) {
					const preset = presets.get(detectedService)!;
					activeSessions.set(userId, {
						preset,
						currentFieldIndex: 0,
						collected: {},
						channelId: dmChannel.id,
						startedAt: Date.now(),
					});

					const field = preset.fields[0];
					const helpLine = preset.helpUrl
						? `Here's where to get one: ${preset.helpUrl}`
						: "";
					await dmChannel.send(
						[
							`Setting up **${preset.displayName}** credentials.`,
							preset.helpText,
							helpLine,
							"",
							`Please paste your **${field.label}** here. ${field.secret ? "I'll delete your message right after reading it." : ""}`,
						]
							.filter(Boolean)
							.join("\n"),
					);
				} else {
					await dmChannel.send(buildServiceListMessage());
				}
			} catch (e) {
				logger.warn(
					{ src: "setup-credentials", error: String(e) },
					"Could not open DM with user",
				);
				if (callback) {
					await callback({
						text: "I couldn't send you a DM. Make sure your DMs are open, then try again.",
						source: "discord",
					});
				}
			}

			return { success: true, text: "Redirected to DMs" };
		}

		// ── Active session: collect next field ──────────────────
		if (activeSessions.has(userId)) {
			const session = activeSessions.get(userId)!;
			const currentField = session.preset.fields[session.currentFieldIndex];

			// Delete the message if it contains a secret
			if (currentField.secret) {
				const msgChannelId =
					(message.content as Record<string, unknown>).channelId as
						| string
						| undefined;
				const msgId = (message.content as Record<string, unknown>)
					.messageId as string | undefined;

				// Try multiple approaches to get the message ID for deletion
				const actualChannelId = msgChannelId ?? channelId;
				const actualMsgId =
					msgId ?? (message.id as string);

				if (actualMsgId) {
					await tryDeleteMessage(
						discordService,
						actualChannelId,
						actualMsgId,
					);
				}
			}

			// Store the value
			session.collected[currentField.key] = text;
			session.currentFieldIndex++;

			// More fields to collect?
			if (session.currentFieldIndex < session.preset.fields.length) {
				const nextField =
					session.preset.fields[session.currentFieldIndex];
				if (callback) {
					await callback({
						text: `Got it. Now paste your **${nextField.label}**${nextField.secret ? " (I'll delete your message)" : ""}.`,
						source: "discord",
					});
				}
				return { success: true, text: "Collecting next field" };
			}

			// All fields collected, validate
			if (callback) {
				await callback({
					text: "Validating your credentials...",
					source: "discord",
				});
			}

			const result = await session.preset.validate(session.collected);

			if (result.valid) {
				// Store credentials
				const storageKey =
					session.preset.name === "generic"
						? (session.collected.envName ?? "custom").toLowerCase().replace(/[^a-z0-9_-]/g, "_")
						: session.preset.name;

				storeCredentials(storageKey, session.collected);
				activeSessions.delete(userId);

				if (callback) {
					await callback({
						text: `✅ Connected${result.identity ? ` as ${result.identity}` : ""}. **${session.preset.displayName}** is ready.`,
						source: "discord",
					});
				}
				return { success: true, text: "Credentials stored" };
			}

			// Validation failed
			activeSessions.delete(userId);
			if (callback) {
				await callback({
					text: `❌ Validation failed: ${result.error ?? "unknown error"}. Please check your credentials and try again with \`/setup ${session.preset.name}\`.`,
					source: "discord",
				});
			}
			return {
				success: false,
				error: `Validation failed: ${result.error}`,
			};
		}

		// ── New setup request ───────────────────────────────────
		const detectedService = detectSetupIntent(text);

		// User mentioned a specific service
		if (detectedService && presets.has(detectedService)) {
			const preset = presets.get(detectedService)!;
			activeSessions.set(userId, {
				preset,
				currentFieldIndex: 0,
				collected: {},
				channelId,
				startedAt: Date.now(),
			});

			const field = preset.fields[0];
			const helpLine = preset.helpUrl
				? `Here's where to get one: ${preset.helpUrl}`
				: "";

			if (callback) {
				await callback({
					text: [
						`Setting up **${preset.displayName}** credentials.`,
						preset.helpText,
						helpLine,
						"",
						`Please paste your **${field.label}** here. ${field.secret ? "I'll delete your message right after reading it." : ""}`,
					]
						.filter(Boolean)
						.join("\n"),
					source: "discord",
				});
			}
			return { success: true, text: `Started ${preset.displayName} setup` };
		}

		// Check if user is replying with just a service name (selecting from list)
		const serviceName = text.toLowerCase().trim();
		if (presets.has(serviceName) || serviceName === "custom") {
			const presetKey = serviceName === "custom" ? "generic" : serviceName;
			const preset = presets.get(presetKey)!;
			activeSessions.set(userId, {
				preset,
				currentFieldIndex: 0,
				collected: {},
				channelId,
				startedAt: Date.now(),
			});

			const field = preset.fields[0];
			const helpLine = preset.helpUrl
				? `Here's where to get one: ${preset.helpUrl}`
				: "";

			if (callback) {
				await callback({
					text: [
						`Setting up **${preset.displayName}** credentials.`,
						preset.helpText,
						helpLine,
						"",
						`Please paste your **${field.label}** here. ${field.secret ? "I'll delete your message right after reading it." : ""}`,
					]
						.filter(Boolean)
						.join("\n"),
					source: "discord",
				});
			}
			return { success: true, text: `Started ${preset.displayName} setup` };
		}

		// No specific service detected, show the menu
		if (callback) {
			await callback({
				text: buildServiceListMessage(),
				source: "discord",
			});
		}
		return { success: true, text: "Showed service list" };
	},

	examples: [
		[
			{
				name: "{{user1}}",
				content: { text: "setup github" },
			},
			{
				name: "{{agentName}}",
				content: {
					text: "Setting up **GitHub** credentials.\nCreate a fine-grained PAT at the link above. Give it the permissions you need.\nHere's where to get one: https://github.com/settings/tokens\n\nPlease paste your **Personal Access Token** here. I'll delete your message right after reading it.",
					action: "SETUP_CREDENTIALS",
				},
			},
		],
		[
			{
				name: "{{user1}}",
				content: { text: "add my vercel key" },
			},
			{
				name: "{{agentName}}",
				content: {
					text: "Setting up **Vercel** credentials.\nCreate a token at the link above.\nHere's where to get one: https://vercel.com/account/tokens\n\nPlease paste your **API Token** here. I'll delete your message right after reading it.",
					action: "SETUP_CREDENTIALS",
				},
			},
		],
		[
			{
				name: "{{user1}}",
				content: { text: "/setup" },
			},
			{
				name: "{{agentName}}",
				content: {
					text: "Which service do you want to set up? I support GitHub, Vercel, Cloudflare, Anthropic, OpenAI, fal.ai, or a custom credential.",
					action: "SETUP_CREDENTIALS",
				},
			},
		],
		[
			{
				name: "{{user1}}",
				content: { text: "configure cloudflare" },
			},
			{
				name: "{{agentName}}",
				content: {
					text: "Setting up **Cloudflare** credentials. I'll need your Global API Key and account email.",
					action: "SETUP_CREDENTIALS",
				},
			},
		],
	] as ActionExample[][],
};

export default setupCredentials;
