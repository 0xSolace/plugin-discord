import { EventEmitter } from 'events';
import type { Readable } from 'node:stream';

/**
 * Audio Sink Contracts
 * 
 * WHY THIS EXISTS:
 * Discord voice connections are complex (network hiccups, reconnections, state changes).
 * The sink abstraction lets music-player treat Discord as "just another audio output"
 * without knowing about Discord internals.
 * 
 * WHY STATUS EVENTS:
 * When Discord reconnects, something needs to know so it can resubscribe to the
 * broadcast. The sink emits status changes, and MusicService listens to auto-reconnect.
 * This keeps Discord plugin unaware of broadcast architecture.
 * 
 * WHY FEED() NOT PLAY():
 * "Feed" suggests the sink is passive - you give it audio and it consumes it.
 * The sink handles its own playback details internally. Music-player doesn't care
 * about Discord's AudioPlayer, channels, or connection states.
 */

/**
 * Audio sink connection status
 */
export type AudioSinkStatus = 'connected' | 'disconnected' | 'reconnecting';

/**
 * Audio sink interface - represents a destination for audio streams.
 * 
 * Implementations must:
 * - Handle connection lifecycle independently
 * - Emit status changes for orchestration layers
 * - Accept new streams when reconnecting
 * - Clean up resources on stop()
 */
export interface IAudioSink extends EventEmitter {
  /** Unique identifier for this sink */
  readonly id: string;
  
  /** Current connection status */
  readonly status: AudioSinkStatus;
  
  /**
   * Feed an audio stream into this sink
   * @param stream Audio stream to play
   * @returns Promise that resolves when playback starts
   */
  feed(stream: Readable): Promise<void>;
  
  /**
   * Stop current audio playback
   * @returns Promise that resolves when stopped
   */
  stop(): Promise<void>;
  
  /**
   * Get human-readable description of this sink
   */
  getDescription(): string;
  
  // Event emitters (typed via EventEmitter)
  on(event: 'statusChange', listener: (status: AudioSinkStatus) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  
  emit(event: 'statusChange', status: AudioSinkStatus): boolean;
  emit(event: 'error', error: Error): boolean;
}

