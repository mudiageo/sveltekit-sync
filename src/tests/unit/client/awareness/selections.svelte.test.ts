/**
 * Selection Tracking Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSelectionTracking } from '$pkg/client/awareness/selections.svelte.js';
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

describe('useSelectionTracking', () => {
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

  it('should initialize selection tracking', () => {
    const presence = usePresence(channel, testUser);
    const element = typeof document !== 'undefined' ? document.createElement('div') : null;
    const selectionTracking = useSelectionTracking(presence, { element, throttle: 100 });

    expect(selectionTracking.selections).toBeDefined();
    expect(selectionTracking.selections.size).toBe(0);
  });

  it('should start and stop tracking', () => {
    const presence = usePresence(channel, testUser);
    const element = typeof document !== 'undefined' ? document.createElement('div') : null;
    const selectionTracking = useSelectionTracking(presence, { element });

    expect(() => {
      selectionTracking.startTracking();
      selectionTracking.stopTracking();
    }).not.toThrow();
  });
});
