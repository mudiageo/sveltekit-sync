/**
 * usePresence Hook Tests
 * 
 * Tests for the Svelte 5 runes-compatible presence hook.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { usePresence } from '$pkg/client/hooks/usePresence.svelte.js';
import { SyncChannel } from '$pkg/client/channel.svelte.js';
import type { User } from '$pkg/client/presence.svelte.js';

// Mock RealtimeClient
function createMockRealtimeClient() {
  return {
    on: vi.fn(() => () => {}),
    send: vi.fn(),
    status: 'connected' as const
  };
}

describe('usePresence Hook', () => {
  let mockClient: ReturnType<typeof createMockRealtimeClient>;
  let channel: SyncChannel;
  const testUser: User = { id: 'user-1', name: 'Test User' };

  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = createMockRealtimeClient();
    channel = new SyncChannel(
      mockClient as any,
      'test-channel',
      testUser,
      { presence: true }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with channel presence', () => {
      const presence = usePresence(channel, testUser);

      expect(presence.myPresence).toBeDefined();
      expect(presence.myPresence.user.id).toBe('user-1');
      expect(presence.others).toEqual([]);
      expect(presence.othersCount).toBe(0);
      expect(presence.onlineCount).toBe(1);
    });

    it('should throw error if channel has no presence', () => {
      const channelWithoutPresence = new SyncChannel(
        mockClient as any,
        'test-channel',
        testUser,
        { presence: false }
      );

      expect(() => {
        usePresence(channelWithoutPresence, testUser);
      }).toThrow('Channel must have presence enabled');
    });
  });

  describe('reactive state', () => {
    it('should provide reactive others array', () => {
      const presence = usePresence(channel, testUser);

      expect(presence.others).toEqual([]);
      expect(Array.isArray(presence.others)).toBe(true);
    });

    it('should provide reactive counts', () => {
      const presence = usePresence(channel, testUser);

      expect(presence.othersCount).toBe(0);
      expect(presence.onlineCount).toBe(1);
    });
  });

  describe('actions', () => {
    it('should update cursor position', () => {
      const presence = usePresence(channel, testUser);

      presence.updateCursor({ x: 100, y: 200 });

      expect(presence.myPresence.cursor).toEqual({ x: 100, y: 200 });
    });

    it('should update selection', () => {
      const presence = usePresence(channel, testUser);

      const selection = {
        start: { x: 10, y: 20 },
        end: { x: 30, y: 40 },
        text: 'selected text'
      };

      presence.updateSelection(selection);

      expect(presence.myPresence.selection).toEqual(selection);
    });

    it('should set status', () => {
      const presence = usePresence(channel, testUser);

      presence.setStatus('idle');

      expect(presence.myPresence.status).toBe('idle');
    });
  });

  describe('cleanup', () => {
    it('should cleanup without errors', () => {
      const presence = usePresence(channel, testUser, {
        trackCursor: true,
        trackSelection: true
      });

      expect(() => {
        presence.destroy();
      }).not.toThrow();
    });
  });
});
