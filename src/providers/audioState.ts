import type { IAgentRuntime, Memory, Provider, State } from '@elizaos/core';
import { ChannelType } from '@elizaos/core';
import type { DiscordService } from '../service';
import { DISCORD_SERVICE_NAME } from '../constants';

/**
 * Provides information about the bot's audio state, including server mute/deafen status.
 * This helps the agent understand and communicate about audio problems.
 *
 * @param {IAgentRuntime} runtime - The runtime object for the agent
 * @param {Memory} message - The message object containing room ID
 * @param {State} [state] - Optional state object for the user
 * @returns {Object} An object containing information about the audio state
 */
export const audioStateProvider: Provider = {
    name: 'audioState',
    description: 'Provides information about the bot\'s audio state including server mute/deafen status',
    dynamic: true,
    get: async (runtime: IAgentRuntime, message: Memory, state?: State) => {
        const room = await runtime.getRoom(message.roomId);
        if (!room) {
            return {
                data: {
                    isInVoiceChannel: false,
                    hasAudioIssues: false,
                },
                values: {
                    isInVoiceChannel: 'false',
                    hasAudioIssues: 'false',
                },
                text: 'Not in a voice channel',
            };
        }

        if (room.type !== ChannelType.GROUP) {
            return {
                data: {
                    isInVoiceChannel: false,
                    hasAudioIssues: false,
                    roomType: room.type,
                },
                values: {
                    isInVoiceChannel: 'false',
                    hasAudioIssues: 'false',
                    roomType: room.type,
                },
                text: 'Not in a group voice channel',
            };
        }

        const serverId = room.serverId;
        if (!serverId) {
            return {
                data: {
                    isInVoiceChannel: false,
                    hasAudioIssues: false,
                },
                values: {
                    isInVoiceChannel: 'false',
                    hasAudioIssues: 'false',
                },
                text: 'No server ID found',
            };
        }

        // Get Discord service and voice manager
        const discordService = runtime.getService(DISCORD_SERVICE_NAME) as DiscordService | null;
        if (!discordService || !discordService.voiceManager) {
            return {
                data: {
                    isInVoiceChannel: false,
                    hasAudioIssues: false,
                },
                values: {
                    isInVoiceChannel: 'false',
                    hasAudioIssues: 'false',
                },
                text: 'Discord service not available',
            };
        }

        // Use voiceManager.getVoiceConnection to resolve the correct bot/group
        // in multi-bot deployments, instead of @discordjs/voice getVoiceConnection
        // which defaults to the 'default' group
        const connection = discordService.voiceManager.getVoiceConnection(serverId);
        if (!connection) {
            return {
                data: {
                    isInVoiceChannel: false,
                    hasAudioIssues: false,
                    serverId,
                },
                values: {
                    isInVoiceChannel: 'false',
                    hasAudioIssues: 'false',
                    serverId,
                },
                text: 'Not currently connected to a voice channel',
            };
        }

        // Extract serializable connection info instead of returning the raw
        // VoiceConnection object, which is non-serializable and exposes internal state
        const voiceChannelId = connection.joinConfig?.channelId ?? null;
        const connectionStatus = connection.state?.status ?? 'unknown';
        const isConnected = connectionStatus === 'ready';

        // Get audio state from voice manager
        const audioState = discordService.voiceManager.getAudioState(serverId);
        const agentName = state?.agentName || 'The agent';

        if (!audioState) {
            return {
                data: {
                    isInVoiceChannel: true,
                    hasAudioIssues: false,
                    serverId,
                    voiceChannelId,
                    connectionStatus,
                    isConnected,
                },
                values: {
                    isInVoiceChannel: 'true',
                    hasAudioIssues: 'false',
                    serverId,
                    voiceChannelId: voiceChannelId ?? '',
                    connectionStatus,
                    isConnected: isConnected ? 'true' : 'false',
                },
                text: `${agentName} is in a voice channel with no known audio issues`,
            };
        }

        const {
            serverMute,
            serverDeaf,
            selfMute,
            selfDeaf,
        } = audioState;

        const issues: string[] = [];
        if (serverMute) issues.push('server muted');
        if (serverDeaf) issues.push('server deafened');
        if (selfMute) issues.push('self muted');
        if (selfDeaf) issues.push('self deafened');

        const hasAudioIssues = issues.length > 0;
        const issueText = issues.length > 0
            ? `${agentName} is ${issues.join(' and ')}`
            : `${agentName} has no audio restrictions`;

        return {
            data: {
                isInVoiceChannel: true,
                hasAudioIssues,
                serverMute,
                serverDeaf,
                selfMute,
                selfDeaf,
                serverId,
                voiceChannelId,
                connectionStatus,
                isConnected,
                issues,
            },
            values: {
                isInVoiceChannel: 'true',
                hasAudioIssues: hasAudioIssues ? 'true' : 'false',
                serverMute: serverMute ? 'true' : 'false',
                serverDeaf: serverDeaf ? 'true' : 'false',
                selfMute: selfMute ? 'true' : 'false',
                selfDeaf: selfDeaf ? 'true' : 'false',
                serverId,
                voiceChannelId: voiceChannelId ?? '',
                connectionStatus,
                isConnected: isConnected ? 'true' : 'false',
                issues: issues.join(', '),
            },
            text: issueText,
        };
    },
};

export default audioStateProvider;

