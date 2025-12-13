/**
 * Discord Plugin Settings Banner
 * Beautiful ANSI art display for configuration on startup
 */

import type { IAgentRuntime } from '@elizaos/core';

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    brightCyan: '\x1b[96m',
    brightBlue: '\x1b[94m',
    brightWhite: '\x1b[97m',
    green: '\x1b[32m',
};

export function printDiscordBanner(runtime: IAgentRuntime): void {
    // Get settings
    const apiToken = runtime.getSetting('DISCORD_API_TOKEN');
    const ignoreBots = runtime.getSetting('DISCORD_SHOULD_IGNORE_BOT_MESSAGES');
    const ignoreDMs = runtime.getSetting('DISCORD_SHOULD_IGNORE_DIRECT_MESSAGES');
    const onlyMentions = runtime.getSetting('DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS');
    const listenChannels = runtime.getSetting('DISCORD_LISTEN_CHANNEL_IDS');
    const voiceChannelId = runtime.getSetting('DISCORD_VOICE_CHANNEL_ID');

    // Check defaults
    const ignoreBotsDefault = ignoreBots === undefined;
    const ignoreDMsDefault = ignoreDMs === undefined;
    const onlyMentionsDefault = onlyMentions === undefined;

    const banner = `
${colors.brightBlue}================================================================================
${colors.brightBlue}   ____  ___  ____   ____ ____  ____  ____     ____  _     _   _  ____ ___ _   _ 
${colors.brightCyan}  |  _ \\|_ _|/ ___| / ___/ _ \\|  _ \\|  _ \\   |  _ \\| |   | | | |/ ___|_ _| \\ | |
${colors.brightCyan}  | | | || | \\___ \\| |  | | | | |_) | | | |  | |_) | |   | | | | |  _ | ||  \\| |
${colors.brightBlue}  | |_| || |  ___) | |__| |_| |  _ <| |_| |  |  __/| |___| |_| | |_| || || |\\  |
${colors.brightBlue}  |____/|___||____/ \\____\\___/|_| \\_\\____/   |_|   |_____|\\___/ \\____|___|_| \\_|
${colors.brightBlue}================================================================================${colors.reset}

${colors.cyan}Configuration:${colors.reset}
  ${colors.yellow}DISCORD_API_TOKEN${colors.reset}                    = ${apiToken ? colors.green + '***set***' : colors.dim + 'not set'} ${apiToken ? colors.green + '(configured)' : colors.dim + '(required)'}${colors.reset}
  ${colors.yellow}DISCORD_SHOULD_IGNORE_BOT_MESSAGES${colors.reset}   = ${colors.white}${ignoreBots || 'false'}${ignoreBotsDefault ? colors.dim + '*' : ''}${colors.reset} ${ignoreBotsDefault ? colors.dim + '(default)' : colors.green + '(set)'}${colors.reset}
  ${colors.yellow}DISCORD_SHOULD_IGNORE_DIRECT_MESSAGES${colors.reset} = ${colors.white}${ignoreDMs || 'false'}${ignoreDMsDefault ? colors.dim + '*' : ''}${colors.reset} ${ignoreDMsDefault ? colors.dim + '(default)' : colors.green + '(set)'}${colors.reset}
  ${colors.yellow}DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS${colors.reset} = ${colors.white}${onlyMentions || 'false'}${onlyMentionsDefault ? colors.dim + '*' : ''}${colors.reset} ${onlyMentionsDefault ? colors.dim + '(default)' : colors.green + '(set)'}${colors.reset}
  ${colors.yellow}DISCORD_LISTEN_CHANNEL_IDS${colors.reset}           = ${listenChannels ? colors.white + 'configured' + colors.reset + ' ' + colors.green + '(set)' : colors.dim + 'not set (optional)'}${colors.reset}
  ${colors.yellow}DISCORD_VOICE_CHANNEL_ID${colors.reset}             = ${voiceChannelId ? colors.white + 'configured' + colors.reset + ' ' + colors.green + '(set)' : colors.dim + 'not set (optional)'}${colors.reset}

${colors.dim}* = default value | Configure via .env file${colors.reset}
${colors.brightBlue}================================================================================${colors.reset}
`;

    // Use logger.info to include character name in logs
    runtime.logger.info(`\n${banner}\n`, 'Discord Plugin');
}

