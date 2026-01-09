/**
 * PresenceStore Unit Tests
 * 
 * Tests for the client-side presence and awareness features.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PresenceStore } from '$pkg/client/presence.svelte.js';
import type { User, PresenceState, CursorPosition, Selection, EditingState } from '$pkg/client/presence.svelte.js';
import { RealtimeClient } from '$pkg/realtime/client.js';

// Mock RealtimeClient
class MockRealtimeClient extends RealtimeClient {
  public sentMessages: Array<{ type: string; data: any }> = [];
  public eventHandlers: Map<string, Set<(data: any) => void>> = new Map();

  constructor() {
    super({ enabled: false }); // Don't actually connect
  }

  async send(type: string, data: any): Promise<void> {
    this.sentMessages.push({ type, data });
    return Promise. resolve(); // Explicitly return a resolved Promise
    }

  on<T>(event: string, handler: (data: T) => void): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler as any);

    return () => {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        handlers.delete(handler as any);
      }
    };
  }

  // Simulate receiving an event from server
  simulateEvent(event: string, data: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }
}


describe('PresenceStore', () => {
  let mockClient: MockRealtimeClient;
  let store: PresenceStore;
  const testUser: User = { id: 'user-1', name: 'Test User', email: 'test@example.com' };

  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = new MockRealtimeClient();
    store = new PresenceStore(mockClient as any, 'todos', testUser);
  });

  afterEach(() => {
    store.destroy();
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with online status', () => {
      // Access internal state via the public API
      expect(store.others).toEqual([]);
      expect(store.othersCount).toBe(0);
    });

    it('should generate a color if not provided', () => {
      const storeNoColor = new PresenceStore(mockClient as any, 'todos', { id: 'u2', name: 'No Color' });
      // Color should be assigned internally
      storeNoColor.destroy();
    });

    it('should broadcast initial presence on setup', () => {
      expect(mockClient.emit).toHaveBeenCalledWith('presence:update', expect.objectContaining({
        userId: 'user-1',
        table: 'todos',
        state: expect.objectContaining({ status: 'online' })
      }));
    });

    it('should work without realtime client (null)', () => {
      const offlineStore = new PresenceStore(null, 'todos', testUser);
      expect(offlineStore.others).toEqual([]);
      offlineStore.destroy();
    });
  });

  describe('presence updates', () => {
    it('should update cursor position', () => {
      const cursor: CursorPosition = { x: 100, y: 200 };
      store.updateCursor(cursor);
      
      expect(mockClient.emit).toHaveBeenLastCalledWith('presence:update', 
        expect.objectContaining({
          state: expect.objectContaining({ cursor })
        })
      );
    });

    it('should update selection', () => {
      const selection: Selection = {
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        text: 'selected text'
      };
      store.updateSelection(selection);
      
      expect(mockClient.emit).toHaveBeenLastCalledWith('presence:update',
        expect.objectContaining({
          state: expect.objectContaining({ selection })
        })
      );
    });

    it('should clear selection when null is passed', () => {
      store.updateSelection(null);
      
      expect(mockClient.emit).toHaveBeenLastCalledWith('presence:update',
        expect.objectContaining({
          state: expect.objectContaining({ selection: undefined })
        })
      );
    });

    it('should update editing state', () => {
      const editing: EditingState = {
        resourceId: 'todo-1',
        field: 'text',
        action: 'typing',
        timestamp: Date.now()
      };
      store.updateEditing(editing);
      
      expect(mockClient.emit).toHaveBeenLastCalledWith('presence:update',
        expect.objectContaining({
          state: expect.objectContaining({ editing })
        })
      );
    });

    it('should update custom presence state', () => {
      store.updatePresence({ custom: { customField: 'value' } });
      
      expect(mockClient.emit).toHaveBeenLastCalledWith('presence:update',
        expect.objectContaining({
          state: expect.objectContaining({ custom: { customField: 'value' } })
        })
      );
    });
  });

  describe('status management', () => {
    it('should set idle status after inactivity', () => {
      vi.advanceTimersByTime(5 * 60 * 1000 + 100); // 5 min + buffer
      
      expect(mockClient.emit).toHaveBeenLastCalledWith('presence:update',
        expect.objectContaining({
          state: expect.objectContaining({ status: 'idle' })
        })
      );
    });

    it('should set active status manually', () => {
      store.setIdle();
      store.setActive();
      
      expect(mockClient.emit).toHaveBeenLastCalledWith('presence:update',
        expect.objectContaining({
          state: expect.objectContaining({ status: 'online' })
        })
      );
    });

    it('should set custom status', () => {
      store.setStatus('away');
      
      expect(mockClient.emit).toHaveBeenLastCalledWith('presence:update',
        expect.objectContaining({
          state: expect.objectContaining({ status: 'away' })
        })
      );
    });
  });

  describe('receiving presence updates', () => {
    it('should track other users joining', () => {
      const otherUser: PresenceState = {
        user: { id: 'user-2', name: 'Other User' },
        status: 'online',
        lastSeen: Date.now()
      };
      
      mockClient.simulateEvent('presence:join', { userId: 'user-2', state: otherUser });
      
      expect(store.othersCount).toBe(1);
      expect(store.others[0].user.name).toBe('Other User');
    });

    it('should update other users presence', () => {
      const otherUser: PresenceState = {
        user: { id: 'user-2', name: 'Other' },
        status: 'online',
        lastSeen: Date.now()
      };
      
      mockClient.simulateEvent('presence:join', { userId: 'user-2', state: otherUser });
      mockClient.simulateEvent('presence:update', { 
        userId: 'user-2', 
        state: { ...otherUser, status: 'idle' } 
      });
      
      expect(store.getUser('user-2')?.status).toBe('idle');
    });

    it('should remove users on leave', () => {
      mockClient.simulateEvent('presence:join', { 
        userId: 'user-2', 
        state: { user: { id: 'user-2', name: 'Other' }, status: 'online', lastSeen: Date.now() } 
      });
      mockClient.simulateEvent('presence:leave', { userId: 'user-2' });
      
      expect(store.othersCount).toBe(0);
    });

    it('should ignore own presence updates', () => {
      mockClient.simulateEvent('presence:update', { 
        userId: 'user-1', 
        state: { user: testUser, status: 'online', lastSeen: Date.now() } 
      });
      
      expect(store.othersCount).toBe(0);
    });
  });

  describe('queries', () => {
    beforeEach(() => {
      // Add some other users
      mockClient.simulateEvent('presence:join', {
        userId: 'user-2',
        state: { user: { id: 'user-2', name: 'User 2' }, status: 'online', lastSeen: Date.now() }
      });
      mockClient.simulateEvent('presence:join', {
        userId: 'user-3',
        state: { user: { id: 'user-3', name: 'User 3' }, status: 'idle', lastSeen: Date.now() }
      });
      mockClient.simulateEvent('presence:join', {
        userId: 'user-4',
        state: { 
          user: { id: 'user-4', name: 'User 4' }, 
          status: 'online', 
          lastSeen: Date.now(),
          editing: { resourceId: 'todo-1', timestamp: Date.now() }
        }
      });
    });

    it('should get online users only', () => {
      const online = store.getOnlineUsers();
      expect(online.length).toBe(2);
      expect(online.map(u => u.user.id)).toContain('user-2');
      expect(online.map(u => u.user.id)).toContain('user-4');
    });

    it('should get users editing a specific resource', () => {
      const editing = store.getUsersEditing('todo-1');
      expect(editing.length).toBe(1);
      expect(editing[0].user.id).toBe('user-4');
    });

    it('should get a specific user', () => {
      const user = store.getUser('user-2');
      expect(user?.user.name).toBe('User 2');
    });

    it('should return null for non-existent user', () => {
      expect(store.getUser('non-existent')).toBeNull();
    });
  });

  describe('follow feature', () => {
    it('should track following state', () => {
      const unfollow = store.follow('user-2');
      expect(store.isFollowing('user-2')).toBe(true);
      expect(store.isFollowing('user-3')).toBe(false);
      unfollow();
    });

    it('should emit following:update events', () => {
      const handler = vi.fn();
      store.on('following:update', handler);
      
      mockClient.simulateEvent('presence:join', {
        userId: 'user-2',
        state: { user: { id: 'user-2', name: 'User 2' }, status: 'online', lastSeen: Date.now() }
      });
      
      store.follow('user-2');
      
      mockClient.simulateEvent('presence:update', {
        userId: 'user-2',
        state: { user: { id: 'user-2', name: 'User 2' }, status: 'idle', lastSeen: Date.now() }
      });
      
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        user: expect.objectContaining({ id: 'user-2' })
      }));
    });

    it('should stop following', () => {
      store.follow('user-2');
      store.stopFollowing();
      expect(store.isFollowing('user-2')).toBe(false);
    });
  });

  describe('heartbeat', () => {
    it('should broadcast presence periodically', () => {
      const initialCallCount = mockClient.emit.mock.calls.length;
      
      vi.advanceTimersByTime(30000); // Heartbeat interval
      
      expect(mockClient.emit.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  describe('cleanup', () => {
    it('should broadcast leave on destroy', () => {
      store.destroy();
      
      expect(mockClient.emit).toHaveBeenLastCalledWith('presence:leave', {
        table: 'todos',
        userId: 'user-1'
      });
    });

    it('should clear event listeners on destroy', () => {
      const handler = vi.fn();
      store.on('update', handler);
      store.destroy();
      
      // Should not receive events after destroy
      mockClient.simulateEvent('presence:update', {
        userId: 'user-2',
        state: { user: { id: 'user-2', name: 'Other' }, status: 'online', lastSeen: Date.now() }
      });
      
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('CollectionStore.presence() integration', () => {
    it('should create presence store from collection', async () => {
      // Import dynamically to avoid issues
      const { SyncEngine } = await import('$pkg/client/sync.svelte.js');
      const { IndexedDBAdapter } = await import('$pkg/adapters/indexeddb.js');
      
      // Mock adapter
      const mockAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        insert: vi.fn().mockResolvedValue({ id: '1' }),
        update: vi.fn().mockResolvedValue({ id: '1' }),
        delete: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        query: vi.fn().mockResolvedValue([])
      };

      // Create sync engine with realtime
      const engine = new SyncEngine({
        local: { db: null, adapter: mockAdapter as any },
        remote: {
          push: vi.fn().mockResolvedValue({ success: true }),
          pull: vi.fn().mockResolvedValue([])
        },
        realtime: {
          enabled: true,
          endpoint: '/api/sync/realtime'
        }
      });

      // Create collection
      const todosStore = engine.collection<{ id: string; text: string }>('todos');

      // Create presence from collection
      const presence = todosStore.presence({
        user: { id: 'user-1', name: 'Test User' },
        custom: { editing: 'todo-1' }
      });

      expect(presence).toBeDefined();
      expect(presence).toBeInstanceOf(PresenceStore);
      
      // Calling again should return same instance
      const presence2 = todosStore.presence({
        user: { id: 'user-1', name: 'Test User' }
      });
      
      expect(presence2).toBe(presence);

      presence.destroy();
      engine.destroy();
    });

    it('should use collection table name for presence', async () => {
      const { SyncEngine } = await import('$pkg/client/sync.svelte.js');
      
      const mockAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        insert: vi.fn().mockResolvedValue({ id: '1' }),
        update: vi.fn().mockResolvedValue({ id: '1' }),
        delete: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        query: vi.fn().mockResolvedValue([])
      };

      const engine = new SyncEngine({
        local: { db: null, adapter: mockAdapter as any },
        remote: {
          push: vi.fn().mockResolvedValue({ success: true }),
          pull: vi.fn().mockResolvedValue([])
        },
        realtime: {
          enabled: true,
          endpoint: '/api/sync/realtime'
        }
      });

      const notesStore = engine.collection<{ id: string; content: string }>('notes');
      const presence = notesStore.presence({
        user: { id: 'user-1', name: 'Test User' }
      });

      // The presence store should be scoped to 'notes' table
      expect(presence).toBeDefined();
      
      presence.destroy();
      engine.destroy();
    });

    it('should support custom state in collection presence', async () => {
      const { SyncEngine } = await import('$pkg/client/sync.svelte.js');
      
      const mockAdapter = {
        init: vi.fn().mockResolvedValue(undefined),
        insert: vi.fn().mockResolvedValue({ id: '1' }),
        update: vi.fn().mockResolvedValue({ id: '1' }),
        delete: vi.fn().mockResolvedValue(undefined),
        getAll: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        query: vi.fn().mockResolvedValue([])
      };

      const engine = new SyncEngine({
        local: { db: null, adapter: mockAdapter as any },
        remote: {
          push: vi.fn().mockResolvedValue({ success: true }),
          pull: vi.fn().mockResolvedValue([])
        },
        realtime: {
          enabled: true,
          endpoint: '/api/sync/realtime'
        }
      });

      const todosStore = engine.collection<{ id: string; text: string }>('todos');
      const presence = todosStore.presence({
        user: { id: 'user-1', name: 'Test User' },
        custom: { editing: 'todo-123', mode: 'focus' }
      });

      expect(presence).toBeDefined();
      expect(presence.myPresence.custom).toEqual({ editing: 'todo-123', mode: 'focus' });
      
      presence.destroy();
      engine.destroy();
    });
  });
});