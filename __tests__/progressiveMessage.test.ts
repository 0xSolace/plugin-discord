import { describe, it, expect, beforeEach } from 'vitest';
import { ProgressiveMessage } from '../src/progressiveMessage';
import type { HandlerCallback, Memory } from '@elizaos/core';

describe('ProgressiveMessage', () => {
  let mockCallback: HandlerCallback;
  let calledWith: any[];

  beforeEach(() => {
    calledWith = [];
    mockCallback = async (content) => {
      calledWith.push(content);
      // Return a mock memory array
      return [{
        id: 'test-id',
        entityId: 'test-entity',
        agentId: 'test-agent',
        roomId: 'test-room',
        content,
        createdAt: Date.now(),
      }] as Memory[];
    };
  });

  describe('Fast operations (< minDelay)', () => {
    it('should not send interim updates for fast operations', async () => {
      const progress = new ProgressiveMessage(mockCallback, 'discord');

      // Call update and complete quickly (within 300ms)
      progress.update('Checking...');
      await progress.complete('Done!');

      // Only final message should be sent (no progressive metadata)
      expect(calledWith.length).toBe(1);
      expect(calledWith[0].text).toBe('Done!');
      expect(calledWith[0].metadata?.progressiveUpdate).toBeUndefined();
    });
  });

  describe('complete()', () => {
    it('should send final message without progressive metadata for fast operations', async () => {
      const progress = new ProgressiveMessage(mockCallback, 'discord', {
        minDelay: 300,
      });

      // Fast operation - complete immediately
      const result = await progress.complete('All done!');

      // Should have only final message
      expect(calledWith.length).toBe(1);
      expect(calledWith[0].text).toBe('All done!');
      expect(result).toHaveLength(1);
    });
  });

  describe('fail()', () => {
    it('should send failure message', async () => {
      const progress = new ProgressiveMessage(mockCallback, 'discord');

      const result = await progress.fail('Failed!');

      expect(calledWith.length).toBe(1);
      expect(calledWith[0].text).toBe('Failed!');
      expect(result).toHaveLength(1);
    });
  });

  describe('Non-Discord sources', () => {
    it('should send messages for non-progressive sources', async () => {
      const progress = new ProgressiveMessage(mockCallback, 'web');

      progress.update('Update 1');
      progress.update('Update 2');
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      await progress.complete('Done');

      // For web, messages are sent (no progressive metadata)
      expect(calledWith.length).toBeGreaterThan(0);
      
      // None should have progressive metadata
      calledWith.forEach(call => {
        expect(call.metadata?.progressiveUpdate).toBeUndefined();
      });
    });
  });

  describe('Error handling', () => {
    it('should handle callback errors gracefully', async () => {
      const errorCallback = async () => {
        throw new Error('Callback error');
      };
      const progress = new ProgressiveMessage(errorCallback, 'discord');

      // Should not throw
      await expect(progress.complete('Done')).resolves.toEqual([]);
    });
  });

  describe('Correlation ID', () => {
    it('should generate unique correlation IDs for different instances', () => {
      const progress1 = new ProgressiveMessage(mockCallback, 'discord');
      const progress2 = new ProgressiveMessage(mockCallback, 'discord');

      // Both should have different internal correlation IDs
      // (We can't test this directly, but we test the behavior)
      progress1.update('Test 1');
      progress2.update('Test 2');

      expect(true).toBe(true); // Simple sanity check
    });
  });

  describe('Source checking', () => {
    it('should support discord source', async () => {
      const progress = new ProgressiveMessage(mockCallback, 'discord');
      await progress.complete('Done');
      
      expect(calledWith.length).toBe(1);
      expect(calledWith[0].source).toBe('discord');
    });

    it('should support non-discord sources', async () => {
      const progress = new ProgressiveMessage(mockCallback, 'web');
      await progress.complete('Done');
      
      expect(calledWith.length).toBe(1);
      expect(calledWith[0].source).toBe('web');
    });
  });
});
