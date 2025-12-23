/**
 * Audio Channel System for Discord Voice
 * 
 * WHY CHANNELS:
 * Discord can only play one audio stream at a time per voice connection.
 * The channel system provides logical separation and priority-based mixing:
 * - TTS can interrupt/duck music
 * - Music plays when TTS is silent
 * - SFX can overlay without interrupting
 * - Ambient provides background layer
 * 
 * PRIORITY SYSTEM:
 * Higher priority channels can interrupt or duck lower priority channels.
 * When a high-priority channel finishes, lower priority channels resume.
 * 
 * Example flow:
 * 1. Music playing on CHANNEL_MUSIC (priority 50)
 * 2. TTS starts on CHANNEL_TTS (priority 100) → music ducks to 20%
 * 3. TTS finishes → music ramps back to 100%
 * 
 * EXTENSIBILITY:
 * Plugins can register custom channels (4, 5, 6...) for special use cases
 * like mixing multiple music tracks or custom audio layers.
 */

import type { AudioChannelConfig } from './voice';

// ============================================================================
// PREDEFINED AUDIO CHANNELS
// ============================================================================

/**
 * Channel 0: Text-to-Speech
 * 
 * WHY HIGHEST PRIORITY (100):
 * When the bot speaks, users need to hear it clearly. TTS interrupts or ducks
 * everything else because spoken responses are time-sensitive communication.
 * 
 * WHY NOT PAUSABLE:
 * TTS utterances should complete or be cancelled, not paused mid-sentence.
 * 
 * WHY NOT INTERRUPTIBLE:
 * TTS is already the highest priority - nothing should interrupt it.
 */
export const CHANNEL_TTS = 0;

/**
 * Channel 1: Music Playback
 * 
 * WHY PRIORITY 50 (MEDIUM):
 * Music is the primary audio content but should yield to TTS/announcements.
 * Lower than TTS so DJ commentary can duck the music.
 * 
 * WHY PAUSABLE:
 * Music can be paused/resumed - this enables skip, pause/play controls.
 * 
 * WHY INTERRUPTIBLE:
 * Higher priority channels (TTS) should be able to duck/interrupt music.
 * 
 * DUCK VOLUME (0.2):
 * When ducked, music plays at 20% volume - audible but not overwhelming.
 */
export const CHANNEL_MUSIC = 1;

/**
 * Channel 2: Sound Effects
 * 
 * WHY PRIORITY 30:
 * SFX are short bursts that should layer with music but yield to speech.
 * Lower than music so they don't interrupt the main audio experience.
 * 
 * WHY NOT PAUSABLE:
 * SFX are typically short and should complete naturally.
 * 
 * WHY INTERRUPTIBLE:
 * Both TTS and music can take precedence over SFX.
 */
export const CHANNEL_SFX = 2;

/**
 * Channel 3: Ambient Background
 * 
 * WHY LOWEST PRIORITY (20):
 * Ambient sounds are background atmosphere - they should never compete
 * with speech, music, or sound effects.
 * 
 * WHY INTERRUPTIBLE:
 * Everything takes priority over ambient sounds.
 * 
 * DUCK VOLUME (0.1):
 * When ducked, ambient plays at 10% - barely audible background.
 */
export const CHANNEL_AMBIENT = 3;

// ============================================================================
// DEFAULT CHANNEL CONFIGURATIONS
// ============================================================================

/**
 * Default configurations for the predefined channels.
 * 
 * WHY EXPORT CONFIGS:
 * Allows plugins to understand channel behaviors without accessing VoiceManager.
 * Useful for deciding which channel to use based on audio type.
 */
export const DEFAULT_CHANNEL_CONFIGS: Record<number, AudioChannelConfig> = {
  [CHANNEL_TTS]: {
    channel: CHANNEL_TTS,
    priority: 100,
    canPause: false,
    interruptible: false,
    volume: 1.0,
  },
  [CHANNEL_MUSIC]: {
    channel: CHANNEL_MUSIC,
    priority: 50,
    canPause: true,
    interruptible: true,
    volume: 1.0,
    duckVolume: 0.2,
  },
  [CHANNEL_SFX]: {
    channel: CHANNEL_SFX,
    priority: 30,
    canPause: false,
    interruptible: true,
    volume: 1.0,
  },
  [CHANNEL_AMBIENT]: {
    channel: CHANNEL_AMBIENT,
    priority: 20,
    canPause: false,
    interruptible: true,
    volume: 0.5,
    duckVolume: 0.1,
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get a human-readable name for a channel number.
 * Useful for logging and debugging.
 */
export function getChannelName(channel: number): string {
  switch (channel) {
    case CHANNEL_TTS:
      return 'TTS';
    case CHANNEL_MUSIC:
      return 'Music';
    case CHANNEL_SFX:
      return 'SFX';
    case CHANNEL_AMBIENT:
      return 'Ambient';
    default:
      return `Custom-${channel}`;
  }
}

/**
 * Check if a channel can interrupt another channel based on priority.
 */
export function canInterrupt(
  newChannel: number,
  existingChannel: number,
  configs: Record<number, AudioChannelConfig> = DEFAULT_CHANNEL_CONFIGS
): boolean {
  const newConfig = configs[newChannel];
  const existingConfig = configs[existingChannel];

  if (!newConfig || !existingConfig) {
    return false;
  }

  return newConfig.priority > existingConfig.priority && existingConfig.interruptible;
}

