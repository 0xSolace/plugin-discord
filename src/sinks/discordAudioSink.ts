import { EventEmitter } from 'events';
import type { Readable } from 'node:stream';
import { logger } from '@elizaos/core';
import type { IAudioSink, AudioSinkStatus } from '../contracts';
import type { VoiceManager } from '../voice';

/**
 * DiscordAudioSink - Implements IAudioSink for Discord voice connections
 * 
 * WHY THIS WRAPPER:
 * VoiceManager is complex - it handles multiple guilds, channels, audio players,
 * connection states, etc. Consumer code (music-player) shouldn't need to know:
 * - How Discord manages voice connections
 * - What an AudioPlayer is
 * - How to handle Discord reconnection states
 * 
 * SIMPLIFIED INTERFACE:
 * ```
 * feed(stream) → play this audio
 * stop() → stop audio
 * status → are you connected?
 * event 'statusChange' → you reconnected/disconnected
 * ```
 * 
 * WHY STATUS MONITORING:
 * Discord voice connections can disconnect for many reasons (network hiccups,
 * region changes, voice server migrations). The sink monitors the VoiceConnection
 * and translates its complex state machine into simple status events.
 * 
 * WHO HANDLES RECONNECTION:
 * NOT this class. The sink just reports "I'm connected again". It's MusicService's
 * job to say "great, here's a new audio stream". This separation of concerns means:
 * - Discord plugin: manages Discord connection lifecycle
 * - Music plugin: manages audio stream lifecycle
 * - Neither knows about the other's internals
 * 
 * Wraps VoiceManager to provide a clean audio sink interface.
 * Emits status changes based on voice connection state.
 * Does NOT handle reconnect logic - that's the orchestrator's job.
 */
export class DiscordAudioSink extends EventEmitter implements IAudioSink {
  readonly id: string;
  private guildId: string;
  private voiceManager: VoiceManager;
  private _status: AudioSinkStatus = 'disconnected';

  constructor(id: string, guildId: string, voiceManager: VoiceManager) {
    super();
    this.id = id;
    this.guildId = guildId;
    this.voiceManager = voiceManager;

    // Monitor voice connection state
    this.setupVoiceConnectionMonitoring();
  }

  /**
   * Get current status
   */
  get status(): AudioSinkStatus {
    return this._status;
  }

  /**
   * Feed an audio stream into this sink
   * @param stream Audio stream to play
   */
  async feed(stream: Readable): Promise<void> {
    logger.debug(`[DiscordAudioSink:${this.id}] Feeding audio stream`);

    logger.debug(`[DiscordAudioSink:${this.id}] Calling voiceManager.playAudio`);

    try {
      // Use VoiceManager to play audio
      await this.voiceManager.playAudio(stream, {
        guildId: this.guildId,
        channel: 1, // Music channel
      });

      logger.debug(`[DiscordAudioSink:${this.id}] Audio stream started`);
    } catch (error) {
      logger.error(`[DiscordAudioSink:${this.id}] Error feeding stream: ${error}`);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Stop current audio playback
   */
  async stop(): Promise<void> {
    logger.debug(`[DiscordAudioSink:${this.id}] Stopping audio`);

    try {
      await this.voiceManager.stopAudio(this.guildId, 1);
    } catch (error) {
      logger.error(`[DiscordAudioSink:${this.id}] Error stopping: ${error}`);
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Get human-readable description
   */
  getDescription(): string {
    return `Discord Audio Sink (Guild: ${this.guildId})`;
  }

  /**
   * Setup monitoring of voice connection state
   * 
   * WHY MONITOR CONNECTION:
   * VoiceConnection has a complex state machine (ready, connecting, disconnected, etc.).
   * We translate this into simple AudioSinkStatus (connected, disconnected, reconnecting).
   * 
   * This abstraction means:
   * - Music-player doesn't need to understand Discord's state machine
   * - We can emit events when connection is restored
   * - Orchestrator (MusicService) can react to reconnections
   * 
   * STATE MAPPING:
   * - Discord 'ready' → AudioSink 'connected' (can receive audio)
   * - Discord 'disconnected/destroyed' → AudioSink 'disconnected' (can't receive audio)
   * - Discord 'connecting/signalling' → AudioSink 'reconnecting' (attempting to restore)
   */
  private setupVoiceConnectionMonitoring(): void {
    // Try to get and monitor voice connection
    this.tryAttachToConnection();

    // WHY POLL FOR CONNECTION:
    // The sink might be created BEFORE the bot joins a voice channel.
    // We need to periodically check for a new connection until we find one.
    // Once attached, we stop polling.
    this.connectionPollInterval = setInterval(() => {
      if (this._status === 'disconnected' && !this.connectionAttached) {
        this.tryAttachToConnection();
      } else if (this.connectionAttached) {
        // Connection attached, stop polling
        if (this.connectionPollInterval) {
          clearInterval(this.connectionPollInterval);
          this.connectionPollInterval = null;
        }
      }
    }, 500); // Check every 500ms
  }

  private connectionPollInterval: NodeJS.Timeout | null = null;
  private connectionAttached = false;
  // Store reference to the connection and listener for cleanup
  // Without storing these, we can't remove the listener in destroy(), causing memory leaks
  private attachedConnection: any = null;
  private stateChangeListener: ((oldState: any, newState: any) => void) | null = null;

  /**
   * Try to find and attach to a voice connection
   */
  private tryAttachToConnection(): void {
    const connection = this.voiceManager.getVoiceConnection(this.guildId);

    if (!connection) {
      logger.debug(`[DiscordAudioSink:${this.id}] No voice connection yet for guild ${this.guildId}`);
      this.updateStatus('disconnected');
      return;
    }

    // Mark as attached so we don't re-attach
    this.connectionAttached = true;
    this.attachedConnection = connection;
    logger.debug(`[DiscordAudioSink:${this.id}] Attached to voice connection for guild ${this.guildId}`);

    // Initial status based on connection state
    const initialStatus = connection.state.status;
    if (initialStatus === 'ready') {
      this.updateStatus('connected');
    } else if (initialStatus === 'disconnected' || initialStatus === 'destroyed') {
      this.updateStatus('disconnected');
    } else {
      this.updateStatus('reconnecting');
    }

    // Create named listener so we can remove it later
    // Anonymous listeners can't be removed, causing listener leaks
    this.stateChangeListener = (oldState: any, newState: any) => {
      logger.debug(
        `[DiscordAudioSink:${this.id}] Voice connection state: ${oldState.status} -> ${newState.status}`
      );

      switch (newState.status) {
        case 'ready':
          this.updateStatus('connected');
          break;
        case 'disconnected':
        case 'destroyed':
          this.updateStatus('disconnected');
          this.connectionAttached = false; // Allow re-attach if reconnected
          break;
        case 'connecting':
        case 'signalling':
          this.updateStatus('reconnecting');
          break;
      }
    };

    // Monitor state changes
    connection.on('stateChange', this.stateChangeListener);
  }

  /**
   * Update status and emit event
   */
  private updateStatus(newStatus: AudioSinkStatus): void {
    if (this._status === newStatus) {
      return; // No change
    }

    const oldStatus = this._status;
    this._status = newStatus;

    logger.debug(`[DiscordAudioSink:${this.id}] Status: ${oldStatus} -> ${newStatus}`);
    this.emit('statusChange', newStatus);
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    logger.debug(`[DiscordAudioSink:${this.id}] Destroying sink`);

    // Stop polling for connection
    if (this.connectionPollInterval) {
      clearInterval(this.connectionPollInterval);
      this.connectionPollInterval = null;
    }

    // Remove the stateChange listener from the voice connection
    // Without this, the listener keeps running even after destroy(), causing memory leaks
    // and potential errors when the sink is garbage collected but the listener fires
    if (this.attachedConnection && this.stateChangeListener) {
      try {
        this.attachedConnection.off('stateChange', this.stateChangeListener);
        logger.debug(`[DiscordAudioSink:${this.id}] Removed stateChange listener from voice connection`);
      } catch (error) {
        logger.debug(`[DiscordAudioSink:${this.id}] Error removing stateChange listener: ${error}`);
      }
    }

    // Null out references to allow garbage collection and prevent reuse
    this.attachedConnection = null;
    this.stateChangeListener = null;
    this.connectionAttached = false;

    // Stop any current playback
    this.stop().catch((error) => {
      logger.debug(`Error stopping during destroy: ${error}`);
    });

    // Remove all listeners from this EventEmitter instance
    this.removeAllListeners();
  }
}

