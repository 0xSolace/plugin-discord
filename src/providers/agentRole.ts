import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from '@elizaos/core';
import { ChannelType } from '@elizaos/core';
import type { GuildChannel, GuildMember, PermissionsBitField } from 'discord.js';
import type { DiscordService } from '../service';
import { DISCORD_SERVICE_NAME } from '../constants';

/**
 * Agent Role Provider
 * 
 * Provides information about the agent's role, permissions, and status in the current Discord server.
 * This helps the agent understand what actions it can take and how to behave appropriately.
 * 
 * Information provided:
 * - Agent's roles in the guild
 * - Key permissions (admin, moderate, manage channels, etc.)
 * - Agent's nickname in the guild
 * - Whether the agent owns the server
 * - Bot vs user status
 */
export const agentRoleProvider: Provider = {
  name: 'agentRole',
  description: 'Information about the agent\'s role and permissions in the current Discord server',
  dynamic: true,

  get: async (runtime: IAgentRuntime, message: Memory, state: State): Promise<ProviderResult> => {
    // Only applies to Discord messages
    if (message.content.source !== 'discord') {
      return {
        data: {},
        values: {},
        text: '',
      };
    }

    const room = state.data?.room ?? (await runtime.getRoom(message.roomId));
    if (!room) {
      return {
        data: {},
        values: {},
        text: '',
      };
    }

    // DMs don't have roles
    if (room.type === ChannelType.DM) {
      return {
        data: {
          isDM: true,
          hasRoles: false,
        },
        values: {
          isDM: 'true',
          hasRoles: 'false',
        },
        text: 'This is a direct message conversation. Server roles and permissions do not apply.',
      };
    }

    const channelId = room.channelId ?? '';
    if (!channelId) {
      return {
        data: {},
        values: {},
        text: '',
      };
    }

    const discordService = runtime.getService(DISCORD_SERVICE_NAME) as DiscordService;
    if (!discordService?.client) {
      return {
        data: {},
        values: {},
        text: '',
      };
    }

    // Get the channel and guild
    let channel = discordService.client.channels.cache.get(channelId) as GuildChannel | undefined;
    if (!channel) {
      try {
        channel = await discordService.client.channels.fetch(channelId) as GuildChannel | undefined;
      } catch {
        return {
          data: {},
          values: {},
          text: '',
        };
      }
    }

    const guild = channel?.guild;
    if (!guild) {
      return {
        data: {},
        values: {},
        text: '',
      };
    }

    // Get the bot's member object in this guild
    let botMember: GuildMember | undefined;
    try {
      botMember = guild.members.cache.get(discordService.client.user?.id ?? '');
      if (!botMember && discordService.client.user?.id) {
        botMember = await guild.members.fetch(discordService.client.user.id);
      }
    } catch {
      // Bot might not be in guild cache yet
    }

    if (!botMember) {
      return {
        data: {
          guildName: guild.name,
          guildId: guild.id,
        },
        values: {
          guildName: guild.name,
        },
        text: `In server "${guild.name}" but role information is not available.`,
      };
    }

    // Extract role information
    const roles = botMember.roles.cache
      .filter(role => role.name !== '@everyone')
      .sort((a, b) => b.position - a.position)
      .map(role => ({
        name: role.name,
        color: role.hexColor,
        position: role.position,
        isHoisted: role.hoist,
        isMentionable: role.mentionable,
      }));

    const roleNames = roles.map(r => r.name);
    const highestRole = roles[0]?.name || 'None';

    // Extract key permissions
    const permissions = botMember.permissions as PermissionsBitField;
    const keyPermissions = {
      administrator: permissions.has('Administrator'),
      manageGuild: permissions.has('ManageGuild'),
      manageChannels: permissions.has('ManageChannels'),
      manageRoles: permissions.has('ManageRoles'),
      manageMessages: permissions.has('ManageMessages'),
      kickMembers: permissions.has('KickMembers'),
      banMembers: permissions.has('BanMembers'),
      moderateMembers: permissions.has('ModerateMembers'),
      manageNicknames: permissions.has('ManageNicknames'),
      manageWebhooks: permissions.has('ManageWebhooks'),
      manageEmojisAndStickers: permissions.has('ManageEmojisAndStickers'),
      mentionEveryone: permissions.has('MentionEveryone'),
      useExternalEmojis: permissions.has('UseExternalEmojis'),
      addReactions: permissions.has('AddReactions'),
      attachFiles: permissions.has('AttachFiles'),
      embedLinks: permissions.has('EmbedLinks'),
      readMessageHistory: permissions.has('ReadMessageHistory'),
      connect: permissions.has('Connect'),
      speak: permissions.has('Speak'),
      muteMembers: permissions.has('MuteMembers'),
      deafenMembers: permissions.has('DeafenMembers'),
      moveMembers: permissions.has('MoveMembers'),
      prioritySpeaker: permissions.has('PrioritySpeaker'),
    };

    // Determine role type
    const isAdmin = keyPermissions.administrator;
    const isModerator = keyPermissions.manageMessages || keyPermissions.kickMembers || keyPermissions.moderateMembers;
    const isOwner = guild.ownerId === discordService.client.user?.id;

    // Build descriptive text
    const agentName = runtime.character?.name || 'The agent';
    let text = `# ${agentName}'s Discord Role Information\n\n`;
    text += `**Server:** ${guild.name}\n`;
    text += `**Nickname:** ${botMember.nickname || botMember.user.username}\n`;
    text += `**Highest Role:** ${highestRole}\n`;
    
    if (roleNames.length > 0) {
      text += `**All Roles:** ${roleNames.join(', ')}\n`;
    }

    text += '\n## Status\n';
    if (isOwner) {
      text += '- 👑 Server Owner\n';
    }
    if (isAdmin) {
      text += '- ⚡ Administrator (full permissions)\n';
    } else if (isModerator) {
      text += '- 🛡️ Moderator (can manage messages/members)\n';
    } else {
      text += '- 👤 Regular member\n';
    }

    text += '\n## Key Permissions\n';
    const enabledPermissions = Object.entries(keyPermissions)
      .filter(([, enabled]) => enabled)
      .map(([perm]) => perm);
    
    if (enabledPermissions.length > 0) {
      text += enabledPermissions.map(p => `- ✓ ${formatPermissionName(p)}`).join('\n');
    } else {
      text += '- Basic permissions only';
    }

    text += '\n\n## Behavioral Guidelines\n';
    if (isAdmin) {
      text += `${agentName} has administrator privileges and should use them responsibly. `;
      text += 'Avoid making server-wide changes unless explicitly requested.\n';
    } else if (isModerator) {
      text += `${agentName} has moderation capabilities. `;
      text += 'Use moderation actions only when necessary and appropriate.\n';
    } else {
      text += `${agentName} has standard member permissions. `;
      text += 'Focus on conversation and available actions within these permissions.\n';
    }

    return {
      data: {
        guildId: guild.id,
        guildName: guild.name,
        nickname: botMember.nickname,
        username: botMember.user.username,
        roles,
        roleNames,
        highestRole,
        permissions: keyPermissions,
        isOwner,
        isAdmin,
        isModerator,
        joinedAt: botMember.joinedAt?.toISOString(),
      },
      values: {
        guildName: guild.name,
        highestRole,
        isOwner: String(isOwner),
        isAdmin: String(isAdmin),
        isModerator: String(isModerator),
        roleCount: String(roleNames.length),
      },
      text,
    };
  },
};

/**
 * Format a permission name for display
 */
function formatPermissionName(permission: string): string {
  // Convert camelCase to Title Case with spaces
  return permission
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .trim();
}

export default agentRoleProvider;

