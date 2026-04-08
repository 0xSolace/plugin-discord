import {
	createUniqueUuid,
	type IAgentRuntime,
	type Metadata,
	Role,
} from "@elizaos/core";

const CANONICAL_OWNER_SETTING_KEY = "MILADY_ADMIN_ENTITY_ID";

function getCanonicalOwnerId(runtime: IAgentRuntime): string | undefined {
	const value = runtime.getSetting?.(CANONICAL_OWNER_SETTING_KEY);
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

export function buildDiscordWorldMetadata(
	runtime: IAgentRuntime,
	guildOwnerId: string | undefined,
): Metadata | undefined {
	const ownerId = getCanonicalOwnerId(runtime);
	if (ownerId) {
		return {
			ownership: { ownerId },
			roles: {
				[ownerId]: Role.OWNER,
			},
		};
	}

	if (!guildOwnerId) {
		return undefined;
	}

	const discordOwnerId = createUniqueUuid(runtime, guildOwnerId);
	return {
		ownership: { ownerId: discordOwnerId },
		roles: {
			[discordOwnerId]: Role.OWNER,
		},
	};
}

export function buildDiscordEntityMetadata(
	userId: string,
	userName: string,
	name: string,
	globalName?: string,
): Metadata {
	return {
		default: {
			username: userName,
			name,
		},
		discord: {
			id: userId,
			userId,
			userName,
			username: userName,
			name,
			...(typeof globalName === "string" && globalName.length > 0
				? { globalName }
				: {}),
		},
		originalId: userId,
		username: userName,
		displayName: name,
	};
}
