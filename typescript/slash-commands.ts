import type {
	ChatInputCommandInteraction,
	AutocompleteInteraction,
} from "discord.js";
import { ApplicationCommandOptionType } from "discord.js";
import type { IAgentRuntime } from "@elizaos/core";
import type { DiscordSlashCommand } from "./types";

// ────────────────────────────────────────────────────────────
// Command definition interface (higher-level than DiscordSlashCommand)
// ────────────────────────────────────────────────────────────

interface SlashCommand {
	name: string;
	description: string;
	options?: SlashCommandOption[];
	ephemeral?: boolean;
	cooldown?: number;
	ownerOnly?: boolean;
	execute: (
		interaction: ChatInputCommandInteraction,
		runtime: IAgentRuntime,
	) => Promise<void>;
	autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

interface SlashCommandOption {
	name: string;
	description: string;
	type: "string" | "number" | "boolean" | "user" | "channel" | "role";
	required?: boolean;
	choices?: Array<{ name: string; value: string }>;
	autocomplete?: boolean;
}

// ────────────────────────────────────────────────────────────
// Option type mapping
// ────────────────────────────────────────────────────────────

const OPTION_TYPE_MAP: Record<string, number> = {
	string: ApplicationCommandOptionType.String,
	number: ApplicationCommandOptionType.Number,
	boolean: ApplicationCommandOptionType.Boolean,
	user: ApplicationCommandOptionType.User,
	channel: ApplicationCommandOptionType.Channel,
	role: ApplicationCommandOptionType.Role,
};

// ────────────────────────────────────────────────────────────
// Registry
// ────────────────────────────────────────────────────────────

const commands = new Map<string, SlashCommand>();

// Cooldown tracking: command name -> user id -> last used timestamp
const cooldowns = new Map<string, Map<string, number>>();

// Available model names for the /model autocomplete
const KNOWN_MODELS = [
	"gpt-4o",
	"gpt-4o-mini",
	"gpt-4",
	"gpt-3.5-turbo",
	"claude-sonnet-4-20250514",
	"claude-opus-4-20250514",
	"claude-3.5-haiku",
	"llama-3.1-70b",
	"llama-3.1-8b",
	"gemini-2.5-pro",
	"gemini-2.5-flash",
	"mistral-large",
	"mistral-medium",
];

// ────────────────────────────────────────────────────────────
// Built-in commands
// ────────────────────────────────────────────────────────────

const helpCommand: SlashCommand = {
	name: "help",
	description: "Show available commands and usage information",
	ephemeral: true,
	async execute(interaction, _runtime) {
		const lines: string[] = ["**Available Commands**\n"];
		for (const [name, cmd] of commands) {
			const opts = cmd.options
				? cmd.options
						.map((o) => (o.required ? `<${o.name}>` : `[${o.name}]`))
						.join(" ")
				: "";
			lines.push(`\`/${name}${opts ? " " + opts : ""}\` — ${cmd.description}`);
		}
		await interaction.reply({ content: lines.join("\n"), ephemeral: true });
	},
};

const statusCommand: SlashCommand = {
	name: "status",
	description: "Show the bot's current status and uptime",
	ephemeral: true,
	async execute(interaction, runtime) {
		const uptimeMs = process.uptime() * 1000;
		const hours = Math.floor(uptimeMs / 3_600_000);
		const minutes = Math.floor((uptimeMs % 3_600_000) / 60_000);
		const seconds = Math.floor((uptimeMs % 60_000) / 1000);

		const memUsage = process.memoryUsage();
		const heapMB = (memUsage.heapUsed / 1024 / 1024).toFixed(1);
		const rssMB = (memUsage.rss / 1024 / 1024).toFixed(1);

		const agentName = runtime.character?.name || "Unknown";
		const guildCount = interaction.client.guilds.cache.size;

		const lines = [
			"**Bot Status**",
			`• Agent: **${agentName}**`,
			`• Uptime: **${hours}h ${minutes}m ${seconds}s**`,
			`• Memory: **${heapMB} MB** heap / **${rssMB} MB** RSS`,
			`• Guilds: **${guildCount}**`,
			`• Node: **${process.version}**`,
			`• Platform: **${process.platform}**`,
		];
		await interaction.reply({ content: lines.join("\n"), ephemeral: true });
	},
};

const searchCommand: SlashCommand = {
	name: "search",
	description: "Search conversation history in this channel",
	options: [
		{
			name: "query",
			description: "The search term or phrase",
			type: "string",
			required: true,
		},
		{
			name: "limit",
			description: "Maximum results to return (default: 5)",
			type: "number",
			required: false,
		},
	],
	ephemeral: true,
	cooldown: 10,
	async execute(interaction, runtime) {
		const query = interaction.options.getString("query", true);
		const limit = interaction.options.getNumber("limit") || 5;

		await interaction.deferReply({ ephemeral: true });

		try {
			const roomId = interaction.channelId;

			// Search recent memories in this room using the runtime
			const memories = await runtime.searchMemories({
				tableName: "messages",
				query,
				limit: Math.min(limit, 20),
				roomId: roomId as unknown as import("@elizaos/core").UUID,
			});

			if (!memories || memories.length === 0) {
				await interaction.editReply({
					content: `No results found for **"${query}"**`,
				});
				return;
			}

			const results = memories.slice(0, limit).map((m, i) => {
				const text = m.content?.text || "(no text)";
				const truncated =
					text.length > 120 ? text.substring(0, 120) + "..." : text;
				const date = m.createdAt
					? new Date(m.createdAt).toLocaleDateString()
					: "unknown date";
				return `**${i + 1}.** ${truncated}\n   _${date}_`;
			});

			await interaction.editReply({
				content: `**Search results for "${query}"** (${results.length} found)\n\n${results.join("\n\n")}`,
			});
		} catch (error) {
			const errMsg =
				error instanceof Error ? error.message : String(error);
			await interaction.editReply({
				content: `Search failed: ${errMsg}`,
			});
		}
	},
};

const clearCommand: SlashCommand = {
	name: "clear",
	description: "Clear the bot's conversation context in this channel",
	ephemeral: true,
	ownerOnly: false,
	async execute(interaction, _runtime) {
		await interaction.deferReply({ ephemeral: true });

		try {
			// Acknowledge the context clear request
			// Actual memory clearing would depend on runtime implementation
			await interaction.editReply({
				content:
					"Context clearing is not yet fully implemented. Use `/search` to review recent messages. I'll start fresh from here.",
			});
		} catch (error) {
			const errMsg =
				error instanceof Error ? error.message : String(error);
			await interaction.editReply({
				content: `Failed to clear context: ${errMsg}`,
			});
		}
	},
};

const settingsCommand: SlashCommand = {
	name: "settings",
	description: "View or modify bot settings for this server",
	options: [
		{
			name: "action",
			description: "What to do",
			type: "string",
			required: true,
			choices: [
				{ name: "View current settings", value: "view" },
				{ name: "Toggle response-only-on-mention", value: "toggle-mention" },
				{ name: "Toggle ignore-bots", value: "toggle-ignore-bots" },
			],
		},
	],
	ephemeral: true,
	async execute(interaction, runtime) {
		const action = interaction.options.getString("action", true);

		if (action === "view") {
			const respondOnMention =
				runtime.getSetting("DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS") ??
				"false";
			const ignoreBots =
				runtime.getSetting("DISCORD_SHOULD_IGNORE_BOT_MESSAGES") ?? "true";
			const channelIds =
				runtime.getSetting("CHANNEL_IDS") ?? "(all channels)";

			const lines = [
				"**Current Settings**",
				`• Respond only to mentions: **${respondOnMention}**`,
				`• Ignore bot messages: **${ignoreBots}**`,
				`• Allowed channels: **${channelIds}**`,
				`• Agent name: **${runtime.character?.name || "Unknown"}**`,
			];
			await interaction.reply({ content: lines.join("\n"), ephemeral: true });
		} else if (action === "toggle-mention") {
			await interaction.reply({
				content:
					"Setting `respond-only-on-mention` is controlled by the `DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS` environment variable. Restart with the updated value to change it.",
				ephemeral: true,
			});
		} else if (action === "toggle-ignore-bots") {
			await interaction.reply({
				content:
					"Setting `ignore-bots` is controlled by the `DISCORD_SHOULD_IGNORE_BOT_MESSAGES` environment variable. Restart with the updated value to change it.",
				ephemeral: true,
			});
		}
	},
};

const modelCommand: SlashCommand = {
	name: "model",
	description: "View or change the active AI model",
	options: [
		{
			name: "name",
			description: "Model name to switch to (leave empty to view current)",
			type: "string",
			required: false,
			autocomplete: true,
		},
	],
	ephemeral: true,
	async execute(interaction, runtime) {
		const modelName = interaction.options.getString("name");

		if (!modelName) {
			// View current model
			const currentModel =
				runtime.getSetting("MODEL") ||
				runtime.getSetting("DEFAULT_MODEL") ||
				"(not configured)";
			await interaction.reply({
				content: `**Current model:** \`${currentModel}\`\n\nUse \`/model name:<model>\` to switch.`,
				ephemeral: true,
			});
			return;
		}

		// Inform user about model switching
		// Actual model switching depends on runtime capabilities
		await interaction.reply({
			content: `Model switching to \`${modelName}\` is noted. The runtime model is controlled by the \`MODEL\` environment variable or character config. Update the configuration and restart to switch models.`,
			ephemeral: true,
		});
	},
	async autocomplete(interaction) {
		const focused = interaction.options.getFocused();
		const filtered = KNOWN_MODELS.filter((m) =>
			m.toLowerCase().includes(focused.toLowerCase()),
		).slice(0, 25);

		await interaction.respond(
			filtered.map((m) => ({ name: m, value: m })),
		);
	},
};

// ────────────────────────────────────────────────────────────
// Register built-in commands into the local registry
// ────────────────────────────────────────────────────────────

function registerBuiltins(): void {
	const builtins = [
		helpCommand,
		statusCommand,
		searchCommand,
		clearCommand,
		settingsCommand,
		modelCommand,
	];
	for (const cmd of builtins) {
		commands.set(cmd.name, cmd);
	}
}

// Auto-register on module load
registerBuiltins();

// ────────────────────────────────────────────────────────────
// Transform SlashCommand to DiscordSlashCommand for registration
// ────────────────────────────────────────────────────────────

function toDiscordSlashCommand(cmd: SlashCommand): DiscordSlashCommand {
	const options = cmd.options?.map((opt) => ({
		name: opt.name,
		description: opt.description,
		type: OPTION_TYPE_MAP[opt.type] ?? ApplicationCommandOptionType.String,
		required: opt.required ?? false,
		...(opt.choices ? { choices: opt.choices } : {}),
		...(opt.autocomplete ? { autocomplete: opt.autocomplete } : {}),
	}));

	return {
		name: cmd.name,
		description: cmd.description,
		options,
	};
}

// ────────────────────────────────────────────────────────────
// Registration function
// ────────────────────────────────────────────────────────────

/**
 * Registers all built-in slash commands with Discord via the runtime event system.
 *
 * Call this after the Discord client is ready. It emits the DISCORD_REGISTER_COMMANDS
 * event which the DiscordService listens for.
 *
 * @param runtime - The agent runtime
 */
export async function registerSlashCommands(
	runtime: IAgentRuntime,
): Promise<void> {
	const discordCommands: DiscordSlashCommand[] = [];
	for (const [, cmd] of commands) {
		discordCommands.push(toDiscordSlashCommand(cmd));
	}

	runtime.logger.info(
		{
			src: "slash-commands",
			count: discordCommands.length,
			names: Array.from(commands.keys()),
		},
		"Registering built-in slash commands",
	);

	runtime.emitEvent("DISCORD_REGISTER_COMMANDS", {
		runtime,
		source: "discord",
		commands: discordCommands,
	});
}

// ────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────

/**
 * Handles an incoming slash command interaction.
 * Looks up the command in the registry, checks cooldowns, and executes.
 *
 * @param interaction - The ChatInputCommandInteraction from Discord
 * @param runtime - The agent runtime
 */
export async function handleSlashCommand(
	interaction: ChatInputCommandInteraction,
	runtime: IAgentRuntime,
): Promise<void> {
	const cmd = commands.get(interaction.commandName);
	if (!cmd) {
		runtime.logger.debug(
			{
				src: "slash-commands",
				commandName: interaction.commandName,
			},
			"Unknown slash command, skipping built-in handler",
		);
		return;
	}

	// Cooldown check
	if (cmd.cooldown && cmd.cooldown > 0) {
		const userId = interaction.user.id;
		let cmdCooldowns = cooldowns.get(cmd.name);
		if (!cmdCooldowns) {
			cmdCooldowns = new Map();
			cooldowns.set(cmd.name, cmdCooldowns);
		}

		const lastUsed = cmdCooldowns.get(userId);
		const now = Date.now();
		if (lastUsed && now - lastUsed < cmd.cooldown * 1000) {
			const remaining = Math.ceil(
				(cmd.cooldown * 1000 - (now - lastUsed)) / 1000,
			);
			await interaction.reply({
				content: `Please wait **${remaining}s** before using \`/${cmd.name}\` again.`,
				ephemeral: true,
			});
			return;
		}
		cmdCooldowns.set(userId, now);
		// Auto-cleanup cooldown entry after expiry to prevent unbounded map growth
		setTimeout(() => {
			const entry = cmdCooldowns.get(userId);
			// Only delete if it's still the same timestamp (hasn't been refreshed)
			if (entry === now) {
				cmdCooldowns.delete(userId);
			}
		}, cmd.cooldown * 1000);
	}

	// Owner-only check
	if (cmd.ownerOnly) {
		const guild = interaction.guild;
		if (guild && interaction.user.id !== guild.ownerId) {
			await interaction.reply({
				content: "This command can only be used by the server owner.",
				ephemeral: true,
			});
			return;
		}
	}

	try {
		await cmd.execute(interaction, runtime);
	} catch (error) {
		const errMsg = error instanceof Error ? error.message : String(error);
		runtime.logger.error(
			{
				src: "slash-commands",
				commandName: cmd.name,
				error: errMsg,
			},
			"Error executing slash command",
		);

		// Respond if we haven't already
		const content = `An error occurred while running \`/${cmd.name}\`: ${errMsg}`;
		try {
			if (interaction.deferred) {
				await interaction.editReply({ content });
			} else if (!interaction.replied) {
				await interaction.reply({ content, ephemeral: true });
			}
		} catch {
			// Interaction may have expired
		}
	}
}

// ────────────────────────────────────────────────────────────
// Autocomplete handler
// ────────────────────────────────────────────────────────────

/**
 * Handles an autocomplete interaction for slash commands.
 * Delegates to the command's autocomplete handler if one is registered.
 *
 * @param interaction - The AutocompleteInteraction from Discord
 */
export async function handleAutocomplete(
	interaction: AutocompleteInteraction,
): Promise<void> {
	const cmd = commands.get(interaction.commandName);
	if (!cmd?.autocomplete) {
		// No autocomplete handler registered, respond with empty array
		await interaction.respond([]);
		return;
	}

	try {
		await cmd.autocomplete(interaction);
	} catch (error) {
		// Silently handle autocomplete errors to avoid breaking the UX
		try {
			await interaction.respond([]);
		} catch {
			// Interaction expired or already responded
		}
	}
}

// ────────────────────────────────────────────────────────────
// Utility exports
// ────────────────────────────────────────────────────────────

/**
 * Returns the map of all registered slash commands.
 */
export function getRegisteredCommands(): ReadonlyMap<string, SlashCommand> {
	return commands;
}

/**
 * Register a custom slash command at runtime.
 * Must call registerSlashCommands() again after adding to sync with Discord.
 */
export function addCommand(cmd: SlashCommand): void {
	commands.set(cmd.name, cmd);
}

/**
 * Remove a slash command by name.
 * Must call registerSlashCommands() again after removing to sync with Discord.
 */
export function removeCommand(name: string): boolean {
	return commands.delete(name);
}
