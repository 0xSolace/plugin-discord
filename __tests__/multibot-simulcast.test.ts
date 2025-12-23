/**
 * Multi-Bot Simulcast Mode Tests
 * 
 * Tests simulcast routing where a single audio stream is broadcast
 * to multiple Discord bots in the same guild
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PassThrough, Readable } from 'node:stream';
import { AudioRouter } from '@elizaos/plugin-music-player';
import type { VoiceTarget } from '../src/types';

describe('Multi-Bot Simulcast Mode', () => {
  let router: AudioRouter;
  let mockTargets: VoiceTarget[];
  let audioStream: Readable;

  beforeEach(() => {
    // Create audio router in simulcast mode
    router = new AudioRouter('simulcast');

    // Create mock voice targets (simulating multiple bots)
    mockTargets = [
      createMockTarget('bot1', 'guild1', 'channel1', 'MainStage'),
      createMockTarget('bot2', 'guild1', 'channel2', 'VIPRoom'),
      createMockTarget('bot3', 'guild1', 'channel3', 'Lounge'),
    ];

    // Register targets with router
    router.registerTargets(mockTargets);

    // Create test audio stream
    audioStream = createTestAudioStream();
  });

  afterEach(async () => {
    // Cleanup: stop all routing
    await router.unrouteAll();
  });

  it('should route single stream to multiple targets in simulcast mode', async () => {
    // Act: Route audio to all targets
    await router.route(
      'test-stream',
      audioStream,
      mockTargets.map(t => t.id),
      'simulcast'
    );

    // Assert: All targets should be playing
    const routes = router.getActiveRoutes();
    expect(routes).toHaveLength(1);
    expect(routes[0].sourceId).toBe('test-stream');
    expect(routes[0].targetIds).toHaveLength(3);
    expect(routes[0].mode).toBe('simulcast');

    // Verify each target is playing
    for (const target of mockTargets) {
      expect((target as any).isPlaying).toBe(true);
    }
  });

  it('should synchronize audio across all targets', async () => {
    // Act: Route with timestamp tracking
    const startTime = Date.now();
    await router.route('sync-test', audioStream, mockTargets.map(t => t.id));
    const routeTime = Date.now() - startTime;

    // Assert: Route should complete quickly (under 100ms for simulcast)
    expect(routeTime).toBeLessThan(100);

    // Verify all targets started within acceptable window
    const playbackTimes = mockTargets.map(t => (t as any).playbackStartTime);
    const maxDelta = Math.max(...playbackTimes) - Math.min(...playbackTimes);

    // All targets should start within 50ms of each other
    expect(maxDelta).toBeLessThan(50);
  });

  it('should handle target failure gracefully', async () => {
    // Arrange: Make one target fail
    const failingTarget = mockTargets[1];
    (failingTarget as any).shouldFail = true;

    // Act: Route should complete without throwing (failed target is logged but doesn't block)
    await router.route('resilient-stream', audioStream, mockTargets.map(t => t.id));

    // Allow time for playback to start
    await new Promise(resolve => setTimeout(resolve, 50));

    // Assert: Other targets should still be playing
    expect((mockTargets[0] as any).isPlaying).toBe(true);
    expect((mockTargets[2] as any).isPlaying).toBe(true);
    // Failed target should not be playing
    expect((mockTargets[1] as any).isPlaying).toBe(false);
  });

  it('should support adding target to active route', async () => {
    // Arrange: Start with 2 targets
    const initialTargets = mockTargets.slice(0, 2);
    await router.route('dynamic-stream', audioStream, initialTargets.map(t => t.id));

    // Act: Add third target
    await router.addTargetToRoute('dynamic-stream', mockTargets[2].id);

    // Assert: Route should now have 3 targets
    const route = router.getRoute('dynamic-stream');
    expect(route?.targetIds).toHaveLength(3);
  });

  it('should support removing target from active route', async () => {
    // Arrange: Start with all targets
    await router.route('remove-test', audioStream, mockTargets.map(t => t.id));

    // Act: Remove one target
    await router.removeTargetFromRoute('remove-test', mockTargets[1].id);

    // Assert: Route should now have 2 targets
    const route = router.getRoute('remove-test');
    expect(route?.targetIds).toHaveLength(2);
    expect(route?.targetIds).not.toContain(mockTargets[1].id);

    // Removed target should be stopped
    expect((mockTargets[1] as any).isPlaying).toBe(false);
  });

  it('should handle stream end gracefully', async () => {
    // Arrange: Create a new stream that we can end properly
    const endableStream = new PassThrough();

    // Route audio
    await router.route('end-test', endableStream, mockTargets.map(t => t.id));

    // Allow time for routing to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    // Act: End the stream properly
    endableStream.end();
    await new Promise(resolve => setTimeout(resolve, 100));  // Wait for processing

    // Assert: Targets should handle end gracefully
    for (const target of mockTargets) {
      expect((target as any).hasError).toBe(false);
    }
  });

  it('should clean up resources on unroute', async () => {
    // Arrange: Route audio
    await router.route('cleanup-test', audioStream, mockTargets.map(t => t.id));

    // Act: Unroute
    await router.unroute('cleanup-test');

    // Assert: Route should be removed
    expect(router.isRouted('cleanup-test')).toBe(false);

    // All targets should be stopped
    for (const target of mockTargets) {
      expect((target as any).isPlaying).toBe(false);
    }
  });

  it('should handle multiple concurrent routes', async () => {
    // Arrange: Create multiple streams
    const stream1 = createTestAudioStream();
    const stream2 = createTestAudioStream();

    // Act: Route to different target subsets
    await router.route('route-1', stream1, [mockTargets[0].id, mockTargets[1].id]);
    await router.route('route-2', stream2, [mockTargets[2].id]);

    // Assert: Both routes should be active
    const routes = router.getActiveRoutes();
    expect(routes).toHaveLength(2);

    const route1 = router.getRoute('route-1');
    const route2 = router.getRoute('route-2');

    expect(route1?.targetIds).toHaveLength(2);
    expect(route2?.targetIds).toHaveLength(1);
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
    hasError: false,
    playbackStartTime: 0,

    play: async (stream: Readable) => {
      if (target.shouldFail) {
        target.isPlaying = false;
        throw new Error(`Mock failure for ${target.id}`);
      }
      target.isPlaying = true;
      target.playbackStartTime = Date.now();

      // Consume stream with proper error handling
      return new Promise<void>((resolve) => {
        stream.on('data', () => { });
        stream.on('end', () => {
          target.isPlaying = false;
          resolve();
        });
        stream.on('error', () => {
          target.hasError = true;
          target.isPlaying = false;
          resolve();
        });
        stream.on('close', () => {
          target.isPlaying = false;
          resolve();
        });
        // Resolve immediately to not block routing
        // The stream handlers will update state asynchronously
        resolve();
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

function createTestAudioStream(): Readable {
  const stream = new PassThrough();

  // Emit test audio data
  setImmediate(() => {
    for (let i = 0; i < 10; i++) {
      stream.write(Buffer.from(`test-audio-chunk-${i}`));
    }
  });

  return stream;
}

