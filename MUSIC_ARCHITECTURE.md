# Music Architecture: Broadcast Model

> **Status**: Implemented  
> **Last Updated**: December 2025

## Overview

The music playback system uses a **broadcast-centric architecture** that decouples audio sources from audio destinations. This enables resilient streaming to multiple consumers while maintaining clean plugin separation.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                     PLUGIN-MUSIC-PLAYER                          │
│                                                                  │
│  ┌───────────┐    ┌───────────────┐    ┌──────────────────────┐ │
│  │MusicQueue │───▶│   Broadcast   │───▶│ StreamMultiplexer    │ │
│  │ (tracks)  │    │ (IAudioBroadcast) │    │ (non-blocking)      │ │
│  └───────────┘    └───────────────┘    └──────────────────────┘ │
│                          │                       │               │
│                   ┌──────▼──────┐               │               │
│                   │ StreamCore  │               │               │
│                   │(+silence gen)│              │               │
│                   └─────────────┘               │               │
└─────────────────────────────────────────────────┼───────────────┘
                                                  │
                        ┌─────────────────────────┴─────────────┐
                        │ subscribe() returns independent       │
                        │ PassThrough stream per consumer       │
                        │                                       │
              ┌─────────▼─────────┐              ┌──────────────▼──┐
              │  Discord Sink     │              │   Web Clients   │
              │ (IAudioSink)      │              │  (/stream API)  │
              │                   │              │                 │
              │ plugin-discord    │              │ plugin-music-   │
              │                   │              │ player routes   │
              └───────────────────┘              └─────────────────┘
```

## Key Contracts

### IAudioBroadcast (plugin-music-player)

The source contract - exposes a continuous audio stream that consumers can subscribe to.

```typescript
interface IAudioBroadcast extends EventEmitter {
  readonly id: string;
  
  start(): void;
  stop(): void;
  
  feedAudio(stream: Readable, metadata?: AudioBroadcastMetadata): Promise<void>;
  
  subscribe(consumerId: string): AudioSubscription;
  unsubscribe(consumerId: string): void;
  
  getCurrentMetadata(): AudioBroadcastMetadata | null;
  isPlaying(): boolean;
}
```

### IAudioSink (plugin-discord)

The destination contract - receives and plays audio streams.

```typescript
interface IAudioSink extends EventEmitter {
  readonly id: string;
  readonly status: AudioSinkStatus; // 'connected' | 'disconnected' | 'connecting' | 'error'
  
  feed(stream: Readable): Promise<void>;
  stop(): Promise<void>;
  
  connect(channelId: string): Promise<void>;
  disconnect(): Promise<void>;
}
```

## Separation of Concerns

### plugin-music-player owns:
- Queue management
- Broadcast creation and lifecycle
- Stream multiplexing
- Silence injection
- Web streaming routes
- Auto-wiring to discovered sinks

### plugin-discord owns:
- Voice connection management
- DiscordAudioSink implementation
- Audio player lifecycle
- Connection state handling
- Reconnection logic

### Neither plugin knows:
- Internal implementation details of the other
- Whether the other plugin is even loaded (graceful degradation)

## Auto-Wiring

When both plugins are loaded, `MusicService` automatically:

1. Discovers Discord service via `runtime.getService('discord')`
2. Obtains `IAudioSink` via `discordService.getAudioSink(guildId)`
3. Subscribes the sink to the broadcast when tracks start
4. Re-subscribes on sink reconnection (via `statusChange` event)

```typescript
// In MusicService
sink.on('statusChange', async (status) => {
  if (status === 'connected') {
    const subscription = broadcast.subscribe(`discord-${guildId}`);
    await sink.feed(subscription.stream);
  }
});
```

## Resilience Features

### Silence Injection
When the queue is empty, `StreamCore` injects silence frames:
- Keeps Discord voice connection alive
- Prevents timeout disconnects
- Seamless transition when new tracks are added

### Non-Blocking Multiplexing
`StreamMultiplexer` handles slow consumers:
- Each consumer gets independent PassThrough stream
- Backpressure on one consumer drops frames for that consumer only
- Other consumers (Discord, other web clients) unaffected

### Auto-Reconnection
When Discord disconnects and reconnects:
1. `DiscordAudioSink` emits `statusChange: 'connected'`
2. `MusicService` receives event
3. `MusicService` re-subscribes to broadcast
4. Audio resumes from live point (not from beginning)

## Migration from Old Architecture

The previous architecture had:
- Direct coupling between `MusicQueue` and `VoiceManager`
- No silence injection (connections dropped when queue empty)
- Single consumer (no web streaming without radio plugin)
- Manual reconnection handling

The new architecture provides:
- Contract-based decoupling
- Built-in silence injection
- Multiple consumers by default
- Automatic reconnection handling

## File Locations

### plugin-music-player
- `src/contracts.ts` - IAudioBroadcast interface
- `src/core/broadcast.ts` - Broadcast implementation
- `src/core/streamCore.ts` - StreamCore (silence injection)
- `src/core/streamMultiplexer.ts` - StreamMultiplexer (fan-out)
- `src/service.ts` - MusicService (auto-wiring)

### plugin-discord
- `src/contracts.ts` - IAudioSink interface
- `src/sinks/discordAudioSink.ts` - DiscordAudioSink implementation
- `src/service.ts` - DiscordService.getAudioSink()

## Multi-Channel Audio System

VoiceManager supports multiple logical audio channels with priority-based mixing:

```typescript
import {
  CHANNEL_TTS,      // Priority 100 - Text-to-Speech
  CHANNEL_MUSIC,    // Priority 50  - Music playback
  CHANNEL_SFX,      // Priority 30  - Sound effects
  CHANNEL_AMBIENT,  // Priority 20  - Background ambient
} from '@elizaos/plugin-discord';
```

### Priority Behavior

- **Interrupt**: Higher priority stops lower priority playback
- **Duck**: Higher priority reduces lower priority volume (when `mix: true`)
- **Restore**: When higher priority finishes, lower priority volume restores

### DJ Integration

The radio/DJ plugin can use this for smooth transitions:

```typescript
// Music playing on CHANNEL_MUSIC
// DJ intro starts on CHANNEL_TTS with mix: true
// → Music ducks to 20%
// → TTS plays
// → Music ramps back to 100%
```

## Related Documentation

- [plugin-music-player README](../plugin-music-player/README.md) - Usage and API
- [plugin-discord README](./README.md) - Discord integration
- [plugin-radio README](../plugin-radio/README.md) - Optional DJ features
