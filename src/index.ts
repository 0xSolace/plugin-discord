import { type IAgentRuntime, type Plugin, logger } from '@elizaos/core';
import chatWithAttachments from './actions/chatWithAttachments';
import { downloadMedia } from './actions/downloadMedia';
import joinChannel from './actions/joinChannel';
import leaveChannel from './actions/leaveChannel';
import listChannels from './actions/listChannels';
import readChannel from './actions/readChannel';
import sendDM from './actions/sendDM';
import { summarize } from './actions/summarizeConversation';
import { transcribeMedia } from './actions/transcribeMedia';
import searchMessages from './actions/searchMessages';
import createPoll from './actions/createPoll';
import getUserInfo from './actions/getUserInfo';
import reactToMessage from './actions/reactToMessage';
import pinMessage from './actions/pinMessage';
import unpinMessage from './actions/unpinMessage';
import serverInfo from './actions/serverInfo';

import { channelStateProvider } from './providers/channelState';
import { voiceStateProvider } from './providers/voiceState';
import { DiscordService } from './service';
import { DiscordTestSuite } from './tests';
import { printDiscordBanner } from './banner';

const discordPlugin: Plugin = {
  name: 'discord',
  description: 'Discord service plugin for integration with Discord servers and channels',
  services: [DiscordService],
  actions: [
    chatWithAttachments,
    downloadMedia,
    joinChannel,
    leaveChannel,
    listChannels,
    readChannel,
    sendDM,
    summarize,
    transcribeMedia,
    searchMessages,
    createPoll,
    getUserInfo,
    reactToMessage,
    pinMessage,
    unpinMessage,
    serverInfo,
  ],
  providers: [channelStateProvider, voiceStateProvider],
  tests: [new DiscordTestSuite()],
  init: async (_config: Record<string, string>, runtime: IAgentRuntime) => {
    // Print beautiful settings banner
    printDiscordBanner(runtime);
    
    const token = runtime.getSetting('DISCORD_API_TOKEN') as string;

    if (!token || token.trim() === '') {
      logger.warn(
        'Discord API Token not provided - Discord plugin is loaded but will not be functional'
      );
      logger.warn(
        'To enable Discord functionality, please provide DISCORD_API_TOKEN in your .eliza/.env file'
      );
    }
  },
};

export default discordPlugin;

// Export additional items for use by other plugins
// IDiscordService? from ./types
export { DISCORD_SERVICE_NAME } from './constants';
export { DiscordService } from './service';
export type { DiscordService as IDiscordService } from './service';

// Export event types and payload interfaces for external consumers
export { DiscordEventTypes } from './types';
export type {
  PermissionState,
  PermissionDiff,
  AuditInfo,
  PermissionPayloadRuntime,
  ChannelPermissionsChangedPayload,
  RolePermissionsChangedPayload,
  MemberRolesChangedPayload,
  RoleLifecyclePayload,
} from './types';

// Export permission utilities for external consumers
export {
  ELEVATED_PERMISSIONS,
  isElevatedRole,
  hasElevatedPermissions,
} from './permissionEvents';