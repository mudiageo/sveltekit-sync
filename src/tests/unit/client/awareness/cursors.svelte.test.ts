/**
 * Cursor Tracking Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useCursorTracking } from '$pkg/client/awareness/cursors.svelte.js';
import { usePresence } from '$pkg/client/hooks/usePresence.svelte.js';
import { SyncChannel } from '$pkg/client/channel.svelte.js';
import type { User } from '$pkg/client/presence.svelte.js';

function createMockRealtimeClient() {
  return {
    on: vi.fn(() => () => {}),
    send: vi.fn(),
    status: 'connected' as const
  };
}

describe('useCursorTracking', () => {
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

  it('should initialize cursor tracking', () => {
    const presence = usePresence(channel, testUser);
    const cursorTracking = useCursorTracking(presence, { throttle: 50 });

    expect(cursorTracking.cursors).toBeDefined();
    expect(cursorTracking.cursors.size).toBe(0);
  });

  it('should start and stop tracking', () => {
    const presence = usePresence(channel, testUser);
    const cursorTracking = useCursorTracking(presence);

    expect(() => {
      cursorTracking.startTracking();
      cursorTracking.stopTracking();
    }).not.toThrow();
  });

  it('should track cursor with custom throttle', () => {
    const presence = usePresence(channel, testUser);
    const cursorTracking = useCursorTracking(presence, { throttle: 100 });

    cursorTracking.startTracking();
    cursorTracking.stopTracking();

    expect(cursorTracking.cursors.size).toBe(0);
  });
});
