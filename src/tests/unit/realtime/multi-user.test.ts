/**
 * Multi-User and Multi-Client Realtime Tests
 * 
 * Tests for complex scenarios with multiple users and clients.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { RealtimeServer } from '$pkg/realtime/server.js';
import { EphemeralStore } from '$pkg/realtime/ephemeral-store.js';
import type { PresenceData } from '$pkg/realtime/types.js';

describe('RealtimeServer - Multi-User Scenarios', () => {
  let server: RealtimeServer;

  beforeEach(() => {
    server = new RealtimeServer({
      enabled: true,
      heartbeatInterval: 0, // Disable for testing
      presenceTtl: 60000,
      ephemeralTtl: 60000
    });
  });

  afterEach(() => {
    server.destroy();
  });

  describe('multiple users in same channel', () => {
    it('should broadcast presence updates to all other users in channel', () => {
      const user1Messages: any[] = [];
      const user2Messages: any[] = [];
      const user3Messages: any[] = [];

      // Create connections for 3 users
      const conn1 = createMockConnection('conn1', 'user1', 'client1');
      const conn2 = createMockConnection('conn2', 'user2', 'client2');
      const conn3 = createMockConnection('conn3', 'user3', 'client3');

      // Override enqueue to capture messages
      conn1.controller.enqueue = (msg: Uint8Array) => {
        user1Messages.push(parseSSEMessage(msg));
      };
      conn2.controller.enqueue = (msg: Uint8Array) => {
        user2Messages.push(parseSSEMessage(msg));
      };
      conn3.controller.enqueue = (msg: Uint8Array) => {
        user3Messages.push(parseSSEMessage(msg));
      };

      // Simulate connections
      (server as any).addConnection(conn1);
      (server as any).addConnection(conn2);
      (server as any).addConnection(conn3);

      // All users join same channel
      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user1',
        'client1'
      );
      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user2',
        'client2'
      );
      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user3',
        'client3'
      );

      // User1 updates presence
      server.handleClientMessage(
        {
          type: 'presence:update',
          data: {
            channel: 'doc:123',
            state: { user: { id: 'user1', name: 'User 1' }, status: 'online' }
          }
        },
        'user1',
        'client1'
      );

      // User2 and User3 should receive the update, but not User1
      const user2PresenceUpdates = user2Messages.filter(m => m.type === 'presence:join' || m.type === 'presence:update');
      const user3PresenceUpdates = user3Messages.filter(m => m.type === 'presence:join' || m.type === 'presence:update');
      const user1PresenceUpdates = user1Messages.filter(m => m.type === 'presence:join' || m.type === 'presence:update');

      expect(user2PresenceUpdates.length).toBeGreaterThan(0);
      expect(user3PresenceUpdates.length).toBeGreaterThan(0);
      
      // User1 should not receive their own update
      const user1OwnUpdate = user1PresenceUpdates.find(m => 
        m.data?.userId === 'user1' && m.data?.clientId === 'client1'
      );
      expect(user1OwnUpdate).toBeUndefined();
    });

    it('should send presence sync to late joiners', () => {
      const user3Messages: any[] = [];

      // Create connections
      const conn1 = createMockConnection('conn1', 'user1', 'client1');
      const conn2 = createMockConnection('conn2', 'user2', 'client2');
      const conn3 = createMockConnection('conn3', 'user3', 'client3');

      conn3.controller.enqueue = (msg: Uint8Array) => {
        user3Messages.push(parseSSEMessage(msg));
      };

      (server as any).addConnection(conn1);
      (server as any).addConnection(conn2);
      (server as any).addConnection(conn3);

      // User1 and User2 join and update presence
      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user1',
        'client1'
      );
      server.handleClientMessage(
        {
          type: 'presence:update',
          data: { channel: 'doc:123', state: { user: { id: 'user1', name: 'User 1' } } }
        },
        'user1',
        'client1'
      );

      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user2',
        'client2'
      );
      server.handleClientMessage(
        {
          type: 'presence:update',
          data: { channel: 'doc:123', state: { user: { id: 'user2', name: 'User 2' } } }
        },
        'user2',
        'client2'
      );

      // User3 joins later - should receive presence sync
      user3Messages.length = 0; // Clear any previous messages
      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user3',
        'client3'
      );

      // Check for presence:sync message
      const syncMessage = user3Messages.find(m => m.type === 'presence:sync');
      expect(syncMessage).toBeDefined();
      expect(syncMessage?.data?.channel).toBe('doc:123');
      expect(Object.keys(syncMessage?.data?.presence || {}).length).toBeGreaterThan(0);
    });

    it('should handle user leaving channel', () => {
      const user2Messages: any[] = [];

      const conn1 = createMockConnection('conn1', 'user1', 'client1');
      const conn2 = createMockConnection('conn2', 'user2', 'client2');

      conn2.controller.enqueue = (msg: Uint8Array) => {
        user2Messages.push(parseSSEMessage(msg));
      };

      (server as any).addConnection(conn1);
      (server as any).addConnection(conn2);

      // Both join channel
      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user1',
        'client1'
      );
      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user2',
        'client2'
      );

      // User1 updates presence then leaves
      server.handleClientMessage(
        {
          type: 'presence:update',
          data: { channel: 'doc:123', state: { user: { id: 'user1' } } }
        },
        'user1',
        'client1'
      );

      user2Messages.length = 0; // Clear
      server.handleClientMessage(
        { type: 'presence:leave', data: { channel: 'doc:123' } },
        'user1',
        'client1'
      );

      // User2 should receive leave event
      const leaveMessage = user2Messages.find(m => m.type === 'presence:leave');
      expect(leaveMessage).toBeDefined();
      expect(leaveMessage?.data?.userId).toBe('user1');
    });
  });

  describe('single user with multiple clients', () => {
    it('should track presence for each client separately', () => {
      const conn1 = createMockConnection('conn1', 'user1', 'client1');
      const conn2 = createMockConnection('conn2', 'user1', 'client2');

      (server as any).addConnection(conn1);
      (server as any).addConnection(conn2);

      // Both clients join same channel
      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user1',
        'client1'
      );
      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user1',
        'client2'
      );

      // Update presence from both clients
      server.handleClientMessage(
        {
          type: 'presence:update',
          data: { channel: 'doc:123', state: { device: 'desktop' } }
        },
        'user1',
        'client1'
      );
      server.handleClientMessage(
        {
          type: 'presence:update',
          data: { channel: 'doc:123', state: { device: 'mobile' } }
        },
        'user1',
        'client2'
      );

      // Both presences should exist
      const presenceStore = (server as any).presenceStore as EphemeralStore;
      const channelPresence = presenceStore.getByChannel('doc:123');
      
      expect(channelPresence.length).toBe(2);
      expect(channelPresence.some(p => p.clientId === 'client1')).toBe(true);
      expect(channelPresence.some(p => p.clientId === 'client2')).toBe(true);
    });

    it('should not send presence updates to same client', () => {
      const user1Client1Messages: any[] = [];
      const user1Client2Messages: any[] = [];

      const conn1 = createMockConnection('conn1', 'user1', 'client1');
      const conn2 = createMockConnection('conn2', 'user1', 'client2');

      conn1.controller.enqueue = (msg: Uint8Array) => {
        user1Client1Messages.push(parseSSEMessage(msg));
      };
      conn2.controller.enqueue = (msg: Uint8Array) => {
        user1Client2Messages.push(parseSSEMessage(msg));
      };

      (server as any).addConnection(conn1);
      (server as any).addConnection(conn2);

      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user1',
        'client1'
      );
      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user1',
        'client2'
      );

      user1Client1Messages.length = 0;
      user1Client2Messages.length = 0;

      // Client1 updates presence
      server.handleClientMessage(
        {
          type: 'presence:update',
          data: { channel: 'doc:123', state: { editing: 'section-1' } }
        },
        'user1',
        'client1'
      );

      // Client1 should not receive its own update
      const client1OwnUpdate = user1Client1Messages.find(
        m => (m.type === 'presence:update' || m.type === 'presence:join') && m.data?.clientId === 'client1'
      );
      expect(client1OwnUpdate).toBeUndefined();

      // Client2 should receive the update from Client1 (either as join or update)
      const client2UpdateFromClient1 = user1Client2Messages.find(
        m => (m.type === 'presence:update' || m.type === 'presence:join') && m.data?.clientId === 'client1'
      );
      // Note: Since both clients belong to same user, they should see each other's presence
      // This test verifies that a client doesn't receive its own updates
      expect(client2UpdateFromClient1).toBeDefined();
    });
  });

  describe('edge cases', () => {
    it('should handle expired presence', async () => {
      const shortTtlServer = new RealtimeServer({
        enabled: true,
        heartbeatInterval: 0,
        presenceTtl: 100 // 100ms TTL
      });

      const conn1 = createMockConnection('conn1', 'user1', 'client1');
      (shortTtlServer as any).addConnection(conn1);

      shortTtlServer.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user1',
        'client1'
      );
      shortTtlServer.handleClientMessage(
        {
          type: 'presence:update',
          data: { channel: 'doc:123', state: { status: 'online' } }
        },
        'user1',
        'client1'
      );

      const presenceStore = (shortTtlServer as any).presenceStore as EphemeralStore;
      expect(presenceStore.getByChannel('doc:123').length).toBe(1);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      presenceStore.cleanup();
      expect(presenceStore.getByChannel('doc:123').length).toBe(0);

      shortTtlServer.destroy();
    });

    it('should handle channel isolation', () => {
      const user2Messages: any[] = [];

      const conn1 = createMockConnection('conn1', 'user1', 'client1');
      const conn2 = createMockConnection('conn2', 'user2', 'client2');

      conn2.controller.enqueue = (msg: Uint8Array) => {
        user2Messages.push(parseSSEMessage(msg));
      };

      (server as any).addConnection(conn1);
      (server as any).addConnection(conn2);

      // User1 in channel A, User2 in channel B
      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:A' } },
        'user1',
        'client1'
      );
      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:B' } },
        'user2',
        'client2'
      );

      user2Messages.length = 0;

      // User1 updates presence in channel A
      server.handleClientMessage(
        {
          type: 'presence:update',
          data: { channel: 'doc:A', state: { status: 'online' } }
        },
        'user1',
        'client1'
      );

      // User2 should not receive updates from channel A
      const presenceUpdate = user2Messages.find(m => 
        m.type === 'presence:update' || m.type === 'presence:join'
      );
      expect(presenceUpdate).toBeUndefined();
    });

    it('should handle ephemeral data broadcast', () => {
      const user2Messages: any[] = [];

      const conn1 = createMockConnection('conn1', 'user1', 'client1');
      const conn2 = createMockConnection('conn2', 'user2', 'client2');

      conn2.controller.enqueue = (msg: Uint8Array) => {
        user2Messages.push(parseSSEMessage(msg));
      };

      (server as any).addConnection(conn1);
      (server as any).addConnection(conn2);

      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user1',
        'client1'
      );
      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user2',
        'client2'
      );

      user2Messages.length = 0;

      // User1 sends custom ephemeral event
      server.handleClientMessage(
        {
          type: 'ephemeral',
          data: {
            channel: 'doc:123',
            event: 'comment:add',
            data: { text: 'Hello!', position: { x: 100, y: 200 } }
          }
        },
        'user1',
        'client1'
      );

      // User2 should receive the ephemeral event
      const ephemeralEvent = user2Messages.find(m => m.type === 'ephemeral');
      expect(ephemeralEvent).toBeDefined();
      expect(ephemeralEvent?.data?.event).toBe('comment:add');
      expect(ephemeralEvent?.data?.data?.text).toBe('Hello!');
    });

    it('should handle connection drops gracefully', () => {
      const conn1 = createMockConnection('conn1', 'user1', 'client1');
      (server as any).addConnection(conn1);

      server.handleClientMessage(
        { type: 'channel:join', data: { channel: 'doc:123' } },
        'user1',
        'client1'
      );
      server.handleClientMessage(
        {
          type: 'presence:update',
          data: { channel: 'doc:123', state: { status: 'online' } }
        },
        'user1',
        'client1'
      );

      expect(server.getConnectionCount()).toBe(1);

      // Simulate connection drop
      (server as any).removeConnection('conn1');

      expect(server.getConnectionCount()).toBe(0);
      expect(server.getUserConnections('user1').length).toBe(0);
    });
  });
});

// Helper functions
function createMockConnection(id: string, userId: string, clientId: string) {
  return {
    id,
    userId,
    clientId,
    tables: [],
    controller: {
      enqueue: vi.fn(),
      close: vi.fn()
    },
    createdAt: Date.now(),
    lastActivity: Date.now()
  };
}

function parseSSEMessage(data: Uint8Array): any {
  const text = new TextDecoder().decode(data);
  const lines = text.split('\n');
  let type = '';
  let jsonData = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      type = line.substring(7).trim();
    } else if (line.startsWith('data: ')) {
      jsonData = line.substring(6).trim();
    }
  }

  return {
    type,
    data: jsonData ? JSON.parse(jsonData) : null
  };
}
