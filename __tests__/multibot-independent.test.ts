/**
 * Multi-Bot Independent Mode Tests
 * 
 * Tests independent routing where different audio streams
 * are routed to different Discord bots
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough, Readable } from 'node:stream';
import { AudioRouter, ZoneManager } from '@elizaos/plugin-music-player';
import type { VoiceTarget } from '../src/types';

describe('Multi-Bot Independent Mode', () => {
  let router: AudioRouter;
  let zoneManager: ZoneManager;
  let mockTargets: VoiceTarget[];

  beforeEach(() => {
    // Create audio router in independent mode
    router = new AudioRouter('independent');
    zoneManager = new ZoneManager();

    // Create mock voice targets for different themed rooms
    mockTargets = [
      createMockTarget('jazz-bot', 'guild1', 'jazz-channel', 'JazzRoom'),
      createMockTarget('rock-bot', 'guild1', 'rock-channel', 'RockRoom'),
      createMockTarget('edm-bot', 'guild1', 'edm-channel', 'EDMRoom'),
    ];

    // Register targets
    router.registerTargets(mockTargets);

    // Create zones
    zoneManager.create('jazz', [mockTargets[0].id]);
    zoneManager.create('rock', [mockTargets[1].id]);
    zoneManager.create('edm', [mockTargets[2].id]);
  });

  afterEach(async () => {
    // Cleanup
    await router.unrouteAll();
    zoneManager.clear();
  });

  it('should route different streams to different zones', async () => {
    // Arrange: Create different audio streams
    const jazzStream = createTestAudioStream('jazz');
    const rockStream = createTestAudioStream('rock');
    const edmStream = createTestAudioStream('edm');

    // Act: Route to respective zones
    await router.route('jazz-stream', jazzStream, zoneManager.getTargets('jazz'), 'independent');
    await router.route('rock-stream', rockStream, zoneManager.getTargets('rock'), 'independent');
    await router.route('edm-stream', edmStream, zoneManager.getTargets('edm'), 'independent');

    // Wait for stream data to be processed
    await new Promise(resolve => setTimeout(resolve, 100));

    // Assert: All routes should be active independently
    const routes = router.getActiveRoutes();
    expect(routes).toHaveLength(3);

    // Each stream should be routed to its zone
    expect(router.isRouted('jazz-stream')).toBe(true);
    expect(router.isRouted('rock-stream')).toBe(true);
    expect(router.isRouted('edm-stream')).toBe(true);

    // Verify each target is playing its respective stream
    expect((mockTargets[0] as any).streamType).toBe('jazz');
    expect((mockTargets[1] as any).streamType).toBe('rock');
    expect((mockTargets[2] as any).streamType).toBe('edm');
  });

  it('should allow stopping one stream without affecting others', async () => {
    // Arrange: Route different streams
    const stream1 = createTestAudioStream('type1');
    const stream2 = createTestAudioStream('type2');

    await router.route('stream-1', stream1, [mockTargets[0].id]);
    await router.route('stream-2', stream2, [mockTargets[1].id]);

    // Act: Stop one stream
    await router.unroute('stream-1');

    // Assert: Only first target should be stopped
    expect((mockTargets[0] as any).isPlaying).toBe(false);
    expect((mockTargets[1] as any).isPlaying).toBe(true);

    // Only one route should remain
    const routes = router.getActiveRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].sourceId).toBe('stream-2');
  });

  it('should support dynamic zone reassignment', async () => {
    // Arrange: Initial setup with jazz in zone
    const jazzStream = createTestAudioStream('jazz');
    await router.route('jazz-stream', jazzStream, zoneManager.getTargets('jazz'));

    // Act: Move jazz bot to rock zone
    zoneManager.removeTarget('jazz', mockTargets[0].id);
    zoneManager.addTarget('rock', mockTargets[0].id);

    // Assert: Zone configuration updated
    expect(zoneManager.getTargets('jazz')).toHaveLength(0);
    expect(zoneManager.getTargets('rock')).toContain(mockTargets[0].id);
  });

  it('should handle zone merging', async () => {
    // Arrange: Create merged zone
    const mergedZone = zoneManager.merge('main-floor', ['jazz', 'rock']);

    // Act: Route to merged zone
    const mainStream = createTestAudioStream('main');
    await router.route('main-stream', mainStream, mergedZone.targetIds);

    // Assert: Both jazz and rock targets should be playing
    expect((mockTargets[0] as any).isPlaying).toBe(true);
    expect((mockTargets[1] as any).isPlaying).toBe(true);
    expect(mergedZone.targetIds).toHaveLength(2);
  });

  it('should support zone intersection for targeted routing', async () => {
    // Arrange: Create overlapping zones
    zoneManager.create('premium', [mockTargets[0].id, mockTargets[1].id]);

    // Act: Get intersection (targets in both original and premium)
    const premiumJazz = zoneManager.getIntersection(['jazz', 'premium']);

    // Assert: Should only include jazz bot
    expect(premiumJazz).toHaveLength(1);
    expect(premiumJazz[0]).toBe(mockTargets[0].id);
  });

  it('should allow independent volume control per zone', async () => {
    // Note: This would require VoiceTarget to support volume control
    // This test demonstrates the API design

    // Arrange: Route to different zones
    const stream1 = createTestAudioStream('type1');
    const stream2 = createTestAudioStream('type2');

    await router.route('loud-stream', stream1, [mockTargets[0].id]);
    await router.route('quiet-stream', stream2, [mockTargets[1].id]);

    // Act: Set different volumes (hypothetical API)
    // mockTargets[0].setVolume(1.0);  // Full volume
    // mockTargets[1].setVolume(0.5);  // Half volume

    // Assert: Each target maintains independent volume
    // expect((mockTargets[0] as any).volume).toBe(1.0);
    // expect((mockTargets[1] as any).volume).toBe(0.5);
  });

  it('should handle zone-based failover', async () => {
    // Arrange: Create backup zone
    const backupTarget = createMockTarget('backup-bot', 'guild1', 'backup-channel', 'Backup');
    router.registerTargets([backupTarget]);
    zoneManager.create('backup', [backupTarget.id]);

    // Route to primary
    const stream = createTestAudioStream('main');
    await router.route('main-stream', stream, zoneManager.getTargets('jazz'));

    // Act: Primary fails, route to backup
    (mockTargets[0] as any).shouldFail = true;
    await router.unroute('main-stream');

    const newStream = createTestAudioStream('main');
    await router.route('main-stream', newStream, zoneManager.getTargets('backup'));

    // Assert: Backup should now be playing
    expect((backupTarget as any).isPlaying).toBe(true);
  });

  it('should support complex routing scenarios', async () => {
    // Scenario: Main stage gets simulcast, side rooms get independent streams

    // Create main stage zone with multiple bots
    const mainStageTargets = [
      createMockTarget('main-1', 'guild1', 'main-1', 'MainStage1'),
      createMockTarget('main-2', 'guild1', 'main-2', 'MainStage2'),
    ];
    router.registerTargets(mainStageTargets);
    zoneManager.create('main-stage', mainStageTargets.map(t => t.id));

    // Route main performance to main stage (simulcast)
    const mainStream = createTestAudioStream('main-performance');
    await router.route(
      'main-performance',
      mainStream,
      zoneManager.getTargets('main-stage'),
      'simulcast'
    );

    // Route ambient music to side rooms (independent)
    const jazzAmbient = createTestAudioStream('jazz-ambient');
    await router.route('jazz-ambient', jazzAmbient, zoneManager.getTargets('jazz'), 'independent');

    // Assert: Complex routing is active
    const routes = router.getActiveRoutes();
    expect(routes).toHaveLength(2);

    const mainRoute = router.getRoute('main-performance');
    expect(mainRoute?.mode).toBe('simulcast');
    expect(mainRoute?.targetIds).toHaveLength(2);

    const jazzRoute = router.getRoute('jazz-ambient');
    expect(jazzRoute?.mode).toBe('independent');
  });
});

// Helper functions

function createMockTarget(
  botId: string,
  guildId: string,
  channelId: string,
  alias?: string
): VoiceTarget {
  const target: any = {
    id: `${botId}:${guildId}:${channelId}`,
    botId,
    botAlias: alias,
    guildId,
    channelId,
    channelName: `Test Channel ${channelId}`,
    isPlaying: false,
    shouldFail: false,
    streamType: null,
    _playPromiseResolve: null as (() => void) | null,

    play: async (stream: Readable) => {
      if (target.shouldFail) {
        throw new Error(`Mock failure for ${target.id}`);
      }
      target.isPlaying = true;

      // Return a promise that resolves when we've received stream data
      return new Promise<void>((resolve) => {
        target._playPromiseResolve = resolve;
        let resolved = false;

        // Extract stream type from data
        stream.on('data', (chunk) => {
          const data = chunk.toString();
          const match = data.match(/stream-type:(\w+)/);
          if (match) {
            target.streamType = match[1];
          }
          // Resolve after first data chunk
          if (!resolved) {
            resolved = true;
            resolve();
          }
        });

        stream.on('end', () => {
          target.isPlaying = false;
          if (!resolved) {
            resolved = true;
            resolve();
          }
        });

        stream.on('error', () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        });

        // Timeout fallback - resolve after 50ms if no data
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        }, 50);
      });
    },

    stop: async () => {
      target.isPlaying = false;
    },

    getStatus: () => {
      return target.isPlaying ? 'connected' : 'disconnected';
    },
  };

  return target as VoiceTarget;
}

function createTestAudioStream(type: string): Readable {
  const stream = new PassThrough();

  // Emit stream type marker followed by test data synchronously
  // Use process.nextTick to ensure listeners are set up first
  process.nextTick(() => {
    stream.write(Buffer.from(`stream-type:${type}`));
    for (let i = 0; i < 5; i++) {
      stream.write(Buffer.from(`${type}-audio-chunk-${i}`));
    }
  });

  return stream;
}

