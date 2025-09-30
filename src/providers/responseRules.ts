import type { IAgentRuntime, Memory, Provider } from '@elizaos/core';
import { DiscordSettings } from '../types';

/**
 * Provider that injects Discord-specific response rules into the state.
 * These rules will be evaluated by the shouldRespond logic to determine if the agent should respond.
 */
export const responseRulesProvider: Provider = {
  name: 'discordResponseRules',
  description: 'Injects Discord-specific response rules into the state',
  position: -2, // Run before shouldRespond provider (which is at -1)
  get: async (runtime: IAgentRuntime, _message: Memory) => {
    // Only apply rules if this message is from Discord
    if (_message.content.source !== 'discord') {
      return { values: {} };
    }

    const responseRules: string[] = [];

    // Get Discord settings from character
    const discordSettings = runtime.character.settings?.discord as DiscordSettings | undefined;

    // If shouldRespondToCharacterName is enabled, add the rule
    if (discordSettings?.shouldRespondToCharacterName) {
      responseRules.push(
        `ONLY respond if the EXACT name "${runtime.character.name}" appears in the LAST USER MESSAGE (not in context, not in previous messages, ONLY in the last user message).`
      );
    }

    // Return empty if no rules to add
    if (responseRules.length === 0) {
      return { text: '', values: {} };
    }

    // Build rules text for LLM context
    let rulesText = '# CRITICAL RULES\n\n';
    responseRules.forEach((rule, index) => {
      rulesText += `${index + 1}. ${rule}\n`;
    });
    rulesText += '\n If any rule above is NOT satisfied → respond IGNORE\n\n';

    // Return both text (for LLM context) and values (for potential programmatic access)
    return {
      text: rulesText,
      values: {
        responseRules,
      },
    };
  },
};