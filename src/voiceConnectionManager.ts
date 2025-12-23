import { logger } from '@elizaos/core';
import type { BaseGuildVoiceChannel } from 'discord.js';
import type { Readable } from 'node:stream';
import type { VoiceManager } from './voice';
import type { VoiceTarget } from './types';

/**
 * Represents a registered voice connection
 */
type ConnectionInfo = {
  voiceManager: VoiceManager;
  channel: BaseGuildVoiceChannel;
  botId: string;
  botAlias?: string;
};

/**
 * Tracks voice connections across multiple Discord bots
 */
export class VoiceConnectionManager {
  private connections: Map<string, ConnectionInfo> = new Map();

  /**
   * Register a voice connection
   * @param botId Discord client user ID
   * @param guildId Guild ID
   * @param channelId Channel ID
   * @param channel The voice channel
   * @param voiceManager The VoiceManager instance
   * @param botAlias Optional bot alias
   */
  registerConnection(
    botId: string,
    guildId: string,
    channelId: string,
    channel: BaseGuildVoiceChannel,
    voiceManager: VoiceManager,
    botAlias?: string
  ): void {
    const id = this.makeId(botId, guildId, channelId);
    this.connections.set(id, { voiceManager, channel, botId, botAlias });
    logger.log(`[VoiceConnectionManager] Registered connection: ${id}`);
  }

  /**
   * Unregister a voice connection
   */
  unregisterConnection(botId: string, guildId: string, channelId: string): void {
    const id = this.makeId(botId, guildId, channelId);
    this.connections.delete(id);
    logger.log(`[VoiceConnectionManager] Unregistered connection: ${id}`);
  }

  /**
   * Get a specific voice connection
   */
  getConnection(botId: string, guildId: string, channelId: string) {
    const id = this.makeId(botId, guildId, channelId);
    return this.connections.get(id);
  }

  /**
   * Get all voice targets available for audio routing
   */
  getVoiceTargets(): VoiceTarget[] {
    const targets: VoiceTarget[] = [];
    
    for (const [id, conn] of this.connections.entries()) {
      const target: VoiceTarget = {
        id,
        botId: conn.botId,
        botAlias: conn.botAlias,
        guildId: conn.channel.guild.id,
        channelId: conn.channel.id,
        channelName: conn.channel.name,
        
        play: async (stream: Readable) => {
          await conn.voiceManager.playAudio(stream, {
            guildId: conn.channel.guild.id,
          });
        },
        
        stop: async () => {
          await conn.voiceManager.stopAudio(conn.channel.guild.id);
        },
        
        getStatus: () => {
          const voiceConn = conn.voiceManager.getVoiceConnection(conn.channel.guild.id);
          return voiceConn ? 'connected' : 'disconnected';
        }
      };
      
      targets.push(target);
    }
    
    return targets;
  }

  /**
   * Get all connections for a specific bot
   */
  getConnectionsForBot(botId: string): Array<{id: string; connection: ConnectionInfo}> {
    const results: Array<{id: string; connection: ConnectionInfo}> = [];
    for (const [id, conn] of this.connections.entries()) {
      if (conn.botId === botId) {
        results.push({ id, connection: conn });
      }
    }
    return results;
  }

  /**
   * Get all connections for a specific guild
   */
  getConnectionsForGuild(guildId: string): Array<{id: string; connection: ConnectionInfo}> {
    const results: Array<{id: string; connection: ConnectionInfo}> = [];
    for (const [id, conn] of this.connections.entries()) {
      if (conn.channel.guild.id === guildId) {
        results.push({ id, connection: conn });
      }
    }
    return results;
  }

  /**
   * Create a connection ID
   */
  private makeId(botId: string, guildId: string, channelId: string): string {
    return `${botId}:${guildId}:${channelId}`;
  }

  /**
   * Clear all connections
   */
  clear(): void {
    this.connections.clear();
  }
}

