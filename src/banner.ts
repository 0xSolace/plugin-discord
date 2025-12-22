/**
 * Discord Plugin Settings Banner
 * Beautiful ANSI art display for configuration on startup
 * Includes tiered permission system for invite URLs
 */

import type { IAgentRuntime } from '@elizaos/core';
import { getPermissionValues, type DiscordPermissionValues } from './permissions';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  blue: '\x1b[34m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
};

export interface PluginSetting {
  name: string;
  value: unknown;
  defaultValue?: unknown;
  sensitive?: boolean;
  required?: boolean;
}

export interface BannerOptions {
  pluginName: string;
  description?: string;
  settings: PluginSetting[];
  runtime: IAgentRuntime;
  /** Discord Application ID for generating invite URLs */
  applicationId?: string;
  /** Permission values for the 3x2 tier matrix */
  discordPermissions?: DiscordPermissionValues;
  /** @deprecated Use applicationId + discordPermissions instead */
  discordInviteLink?: string;
}

function mask(v: string): string {
  if (!v || v.length <= 8) return '••••••••';
  return `${v.slice(0, 4)}${'•'.repeat(Math.min(12, v.length - 8))}${v.slice(-4)}`;
}

function fmtVal(value: unknown, sensitive: boolean, maxLen: number): string {
  let s: string;
  if (value === undefined || value === null || value === '') {
    s = '(not set)';
  } else if (sensitive) {
    s = mask(String(value));
  } else {
    s = String(value);
  }
  if (s.length > maxLen) s = s.slice(0, maxLen - 3) + '...';
  return s;
}

function pad(s: string, n: number): string {
  const len = s.replace(/\x1b\[[0-9;]*m/g, '').length;
  if (len >= n) return s;
  return s + ' '.repeat(n - len);
}

function line(content: string): string {
  const ansiPattern = /\x1b\[[0-9;]*m/g;
  const len = content.replace(ansiPattern, '').length;

  if (len <= 78) {
    return content + ' '.repeat(78 - len);
  }

  // Truncate based on visible character count, not raw string position
  // This avoids cutting in the middle of ANSI escape sequences
  let visibleCount = 0;
  let result = '';
  let i = 0;

  while (i < content.length && visibleCount < 78) {
    const remaining = content.slice(i);
    const match = remaining.match(/^\x1b\[[0-9;]*m/);

    if (match) {
      // Include ANSI sequence without counting toward visible length
      result += match[0];
      i += match[0].length;
    } else {
      // Regular visible character
      result += content[i];
      visibleCount++;
      i++;
    }
  }

  // Reset any unclosed ANSI sequences after truncation
  return result + ANSI.reset;
}

/**
 * Print the Discord plugin settings banner with tiered invite URLs
 */
export function printBanner(options: BannerOptions): void {
  const { settings, runtime } = options;
  const R = ANSI.reset,
    D = ANSI.dim,
    B = ANSI.bold;
  const c1 = ANSI.brightBlue,
    c2 = ANSI.brightCyan,
    c3 = ANSI.brightMagenta;

  const top = `${c1}╔${'═'.repeat(78)}╗${R}`;
  const mid = `${c1}╠${'═'.repeat(78)}╣${R}`;
  const bot = `${c1}╚${'═'.repeat(78)}╝${R}`;
  const row = (s: string) => `${c1}║${R}${line(s)}${c1}║${R}`;

  const lines: string[] = [''];
  lines.push(top);
  lines.push(row(` ${B}Character: ${runtime.character.name}${R}`));
  lines.push(mid);
  lines.push(row(`${c2}     ██████╗ ██╗███████╗ ██████╗ ██████╗ ██████╗ ██████╗     ${c3}◖ ◗${R}`));
  lines.push(row(`${c2}     ██╔══██╗██║██╔════╝██╔════╝██╔═══██╗██╔══██╗██╔══██╗   ${c3}◖===◗${R}`));
  lines.push(row(`${c2}     ██║  ██║██║███████╗██║     ██║   ██║██████╔╝██║  ██║    ${c3}╰─╯${R}`));
  lines.push(row(`${c2}     ██████╔╝██║╚════██║╚██████╗╚██████╔╝██║  ██║██████╔╝   ${c3}(◠◠)${R}`));
  lines.push(row(`${c2}     ╚═════╝ ╚═╝╚══════╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝     ${c3}‿‿${R}`));
  lines.push(row(`${D}            Bot Integration  •  Servers  •  Channels  •  Voice${R}`));
  lines.push(mid);

  const NW = 34,
    VW = 26,
    SW = 8;
  lines.push(row(` ${B}${pad('ENV VARIABLE', NW)} ${pad('VALUE', VW)} ${pad('STATUS', SW)}${R}`));
  lines.push(row(` ${D}${'-'.repeat(NW)} ${'-'.repeat(VW)} ${'-'.repeat(SW)}${R}`));

  for (const s of settings) {
    const set = s.value !== undefined && s.value !== null && s.value !== '';
    const isDefault = set && s.defaultValue !== undefined && s.value === s.defaultValue;

    let ico: string, st: string;
    if (!set && s.required) {
      ico = `${ANSI.brightRed}◆${R}`;
      st = `${ANSI.brightRed}REQUIRED${R}`;
    } else if (!set) {
      ico = `${D}○${R}`;
      st = `${D}unset${R}`;
    } else if (isDefault) {
      ico = `${ANSI.brightBlue}●${R}`;
      st = `${ANSI.brightBlue}default${R}`;
    } else {
      ico = `${ANSI.brightGreen}✓${R}`;
      st = `${ANSI.brightGreen}custom${R}`;
    }

    const name = pad(s.name, NW - 2);
    const val = pad(fmtVal(s.value ?? s.defaultValue, s.sensitive ?? false, VW), VW);
    const status = pad(st, SW);
    lines.push(row(` ${ico} ${c2}${name}${R} ${val} ${status}`));
  }

  lines.push(mid);
  lines.push(
    row(
      ` ${D}${ANSI.brightGreen}✓${D} custom  ${ANSI.brightBlue}●${D} default  ○ unset  ${ANSI.brightRed}◆${D} required      → Set in .env${R}`
    )
  );
  lines.push(bot);

  // Add Discord invite links organized by voice capability
  if (options.applicationId && options.discordPermissions) {
    const p = options.discordPermissions;
    const baseUrl = `https://discord.com/api/oauth2/authorize?client_id=${options.applicationId}&scope=bot%20applications.commands&permissions=`;

    lines.push('');
    lines.push(`${B}${ANSI.brightCyan}🔗 Discord Bot Invite${R}`);
    lines.push('');
    lines.push(`   ${B}🎙️  With Voice:${R}`);
    lines.push(`   ${ANSI.brightGreen}● Basic${R}      ${baseUrl}${p.basicVoice}`);
    lines.push(`   ${ANSI.brightYellow}● Moderator${R}  ${baseUrl}${p.moderatorVoice}`);
    lines.push(`   ${ANSI.brightRed}● Admin${R}      ${baseUrl}${p.adminVoice}`);
    lines.push('');
    lines.push(`   ${B}💬 Without Voice:${R}`);
    lines.push(`   ${ANSI.brightCyan}○ Basic${R}      ${baseUrl}${p.basic}`);
    lines.push(`   ${ANSI.brightMagenta}○ Moderator${R}  ${baseUrl}${p.moderator}`);
    lines.push(`   ${ANSI.brightBlue}○ Admin${R}      ${baseUrl}${p.admin}`);
  } else if (options.discordInviteLink) {
    // Backwards compatibility
    lines.push('');
    lines.push(`${B}${ANSI.brightCyan}🔗 Discord Bot Invite:${R} ${options.discordInviteLink}`);
  }

  lines.push('');

  runtime.logger.info(lines.join('\n'));
}

/**
 * Simple banner for backwards compatibility
 * @deprecated Use printBanner with BannerOptions instead
 */
export function printDiscordBanner(runtime: IAgentRuntime): void {
  // Get settings
  const apiToken = runtime.getSetting('DISCORD_API_TOKEN');
  const applicationId = runtime.getSetting('DISCORD_APPLICATION_ID');
  const ignoreBots = runtime.getSetting('DISCORD_SHOULD_IGNORE_BOT_MESSAGES');
  const ignoreDMs = runtime.getSetting('DISCORD_SHOULD_IGNORE_DIRECT_MESSAGES');
  const onlyMentions = runtime.getSetting('DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS');
  const listenChannels = runtime.getSetting('DISCORD_LISTEN_CHANNEL_IDS');
  const voiceChannelId = runtime.getSetting('DISCORD_VOICE_CHANNEL_ID');

  printBanner({
    pluginName: 'plugin-discord',
    description: 'Discord bot integration for servers and channels',
    applicationId: applicationId || undefined,
    discordPermissions: applicationId ? getPermissionValues() : undefined,
    settings: [
      { name: 'DISCORD_API_TOKEN', value: apiToken, sensitive: true, required: true },
      { name: 'DISCORD_APPLICATION_ID', value: applicationId },
      { name: 'DISCORD_VOICE_CHANNEL_ID', value: voiceChannelId },
      { name: 'DISCORD_LISTEN_CHANNEL_IDS', value: listenChannels },
      { name: 'DISCORD_SHOULD_IGNORE_BOT_MESSAGES', value: ignoreBots, defaultValue: 'false' },
      { name: 'DISCORD_SHOULD_IGNORE_DIRECT_MESSAGES', value: ignoreDMs, defaultValue: 'false' },
      { name: 'DISCORD_SHOULD_RESPOND_ONLY_TO_MENTIONS', value: onlyMentions, defaultValue: 'false' },
    ],
    runtime,
  });
}
