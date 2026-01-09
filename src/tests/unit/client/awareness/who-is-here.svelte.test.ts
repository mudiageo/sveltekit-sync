/**
 * Who's Here Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWhoIsHere } from '$pkg/client/awareness/who-is-here.svelte.js';
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

describe('useWhoIsHere', () => {
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

  it('should provide users list', () => {
    const presence = usePresence(channel, testUser);
    const whoIsHere = useWhoIsHere(presence);

    expect(whoIsHere.users).toBeDefined();
    expect(Array.isArray(whoIsHere.users)).toBe(true);
    expect(whoIsHere.users.length).toBeGreaterThan(0);
  });

  it('should provide avatars with colors', () => {
    const presence = usePresence(channel, testUser);
    const whoIsHere = useWhoIsHere(presence);

    expect(whoIsHere.avatars).toBeDefined();
    expect(Array.isArray(whoIsHere.avatars)).toBe(true);
    expect(whoIsHere.avatars.length).toBeGreaterThan(0);
    expect(whoIsHere.avatars[0]).toHaveProperty('user');
    expect(whoIsHere.avatars[0]).toHaveProperty('color');
  });

  it('should provide count and online count', () => {
    const presence = usePresence(channel, testUser);
    const whoIsHere = useWhoIsHere(presence);

    expect(typeof whoIsHere.count).toBe('number');
    expect(typeof whoIsHere.onlineCount).toBe('number');
    expect(whoIsHere.count).toBeGreaterThan(0);
  });

  it('should indicate if user is alone', () => {
    const presence = usePresence(channel, testUser);
    const whoIsHere = useWhoIsHere(presence);

    expect(typeof whoIsHere.isAlone).toBe('boolean');
    expect(whoIsHere.isAlone).toBe(true); // No other users initially
  });
});
