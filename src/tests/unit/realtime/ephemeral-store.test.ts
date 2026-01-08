/**
 * EphemeralStore Unit Tests
 * 
 * Tests for the in-memory ephemeral data store.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EphemeralStore, type EphemeralEntry } from '$pkg/realtime/ephemeral-store.js';

describe('EphemeralStore', () => {
  let store: EphemeralStore;

  beforeEach(() => {
    store = new EphemeralStore();
  });

  afterEach(() => {
    store.destroy();
  });

  describe('initialization', () => {
    it('should create a store with default config', () => {
      expect(store).toBeDefined();
      expect(store.size()).toBe(0);
    });

    it('should create a store with custom TTL', () => {
      const customStore = new EphemeralStore({ ttl: 120000 });
      expect(customStore).toBeDefined();
      customStore.destroy();
    });

    it('should accept an onExpire callback', () => {
      const onExpire = vi.fn();
      const customStore = new EphemeralStore({ onExpire });
      expect(customStore).toBeDefined();
      customStore.destroy();
    });
  });

  describe('set and get', () => {
    it('should store and retrieve data', () => {
      const entry = {
        data: { message: 'Hello' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      };

      store.set('key1', entry);
      const retrieved = store.get('key1');

      expect(retrieved).toEqual({ message: 'Hello' });
    });

    it('should return full entry with metadata', () => {
      const entry = {
        data: { message: 'Hello' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      };

      store.set('key1', entry);
      const retrieved = store.getEntry('key1');

      expect(retrieved).toBeDefined();
      expect(retrieved?.data).toEqual({ message: 'Hello' });
      expect(retrieved?.userId).toBe('user1');
      expect(retrieved?.clientId).toBe('client1');
      expect(retrieved?.channel).toBe('channel1');
      expect(retrieved?.updatedAt).toBeGreaterThan(0);
      expect(retrieved?.expiresAt).toBeGreaterThan(retrieved!.updatedAt);
    });

    it('should return null for non-existent key', () => {
      const retrieved = store.get('nonexistent');
      expect(retrieved).toBeNull();
    });

    it('should update existing entry', () => {
      const entry = {
        data: { count: 1 },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      };

      store.set('key1', entry);
      
      const updatedEntry = {
        data: { count: 2 },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      };
      
      store.set('key1', updatedEntry);
      const retrieved = store.get('key1');

      expect(retrieved).toEqual({ count: 2 });
    });
  });

  describe('delete', () => {
    it('should delete an entry', () => {
      const entry = {
        data: { message: 'Hello' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      };

      store.set('key1', entry);
      expect(store.get('key1')).not.toBeNull();

      const deleted = store.delete('key1');
      expect(deleted).toBe(true);
      expect(store.get('key1')).toBeNull();
    });

    it('should return false when deleting non-existent entry', () => {
      const deleted = store.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('query by channel', () => {
    beforeEach(() => {
      store.set('key1', {
        data: { msg: 'Message 1' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      store.set('key2', {
        data: { msg: 'Message 2' },
        userId: 'user2',
        clientId: 'client2',
        channel: 'channel1'
      });

      store.set('key3', {
        data: { msg: 'Message 3' },
        userId: 'user3',
        clientId: 'client3',
        channel: 'channel2'
      });
    });

    it('should get all entries for a channel', () => {
      const entries = store.getByChannel('channel1');
      expect(entries).toHaveLength(2);
      expect(entries.map(e => e.userId)).toContain('user1');
      expect(entries.map(e => e.userId)).toContain('user2');
    });

    it('should return empty array for non-existent channel', () => {
      const entries = store.getByChannel('nonexistent');
      expect(entries).toHaveLength(0);
    });

    it('should get all data values in channel', () => {
      const data = store.getAllInChannel('channel1');
      expect(data).toHaveLength(2);
      expect(data).toContainEqual({ msg: 'Message 1' });
      expect(data).toContainEqual({ msg: 'Message 2' });
    });

    it('should exclude specific client when getting channel data', () => {
      const data = store.getAllInChannel('channel1', 'client1');
      expect(data).toHaveLength(1);
      expect(data[0]).toEqual({ msg: 'Message 2' });
    });
  });

  describe('query by user', () => {
    beforeEach(() => {
      store.set('key1', {
        data: { msg: 'Message 1' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      store.set('key2', {
        data: { msg: 'Message 2' },
        userId: 'user1',
        clientId: 'client2',
        channel: 'channel2'
      });

      store.set('key3', {
        data: { msg: 'Message 3' },
        userId: 'user2',
        clientId: 'client3',
        channel: 'channel1'
      });
    });

    it('should get all entries for a user', () => {
      const entries = store.getByUser('user1');
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.userId === 'user1')).toBe(true);
    });

    it('should get entry by channel and user', () => {
      const entry = store.getByChannelAndUser('channel1', 'user1');
      expect(entry).toBeDefined();
      expect(entry?.userId).toBe('user1');
      expect(entry?.channel).toBe('channel1');
    });

    it('should return null when channel+user combination not found', () => {
      const entry = store.getByChannelAndUser('channel1', 'user99');
      expect(entry).toBeNull();
    });
  });

  describe('remove operations', () => {
    beforeEach(() => {
      store.set('key1', {
        data: { msg: '1' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      store.set('key2', {
        data: { msg: '2' },
        userId: 'user2',
        clientId: 'client1',
        channel: 'channel1'
      });

      store.set('key3', {
        data: { msg: '3' },
        userId: 'user1',
        clientId: 'client2',
        channel: 'channel2'
      });
    });

    it('should remove all entries for a client', () => {
      const removed = store.removeByClient('client1');
      expect(removed).toBe(2);
      expect(store.size()).toBe(1);
    });

    it('should remove all entries in a channel', () => {
      const removed = store.removeByChannel('channel1');
      expect(removed).toBe(2);
      expect(store.size()).toBe(1);
    });

    it('should return 0 when removing non-existent client', () => {
      const removed = store.removeByClient('nonexistent');
      expect(removed).toBe(0);
    });
  });

  describe('TTL and expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortStore = new EphemeralStore({ ttl: 100, cleanupInterval: 0 });
      
      shortStore.set('key1', {
        data: { msg: 'Expiring' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      expect(shortStore.get('key1')).not.toBeNull();

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(shortStore.get('key1')).toBeNull();
      
      shortStore.destroy();
    });

    it('should call onExpire callback when cleaning up', async () => {
      const onExpire = vi.fn();
      const shortStore = new EphemeralStore({ 
        ttl: 50, 
        cleanupInterval: 100,
        onExpire 
      });
      
      shortStore.set('key1', {
        data: { msg: 'Expiring' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      // Wait for cleanup to run
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(onExpire).toHaveBeenCalled();
      
      shortStore.destroy();
    });

    it('should manually cleanup expired entries', () => {
      const shortStore = new EphemeralStore({ ttl: 50, cleanupInterval: 0 });
      
      shortStore.set('key1', {
        data: { msg: 'Expiring' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      // Manually advance time by modifying the entry
      const entry = shortStore.getEntry('key1');
      if (entry) {
        entry.expiresAt = Date.now() - 1000; // Already expired
      }

      shortStore.cleanup();
      expect(shortStore.size()).toBe(0);
      
      shortStore.destroy();
    });
  });

  describe('clear and size', () => {
    beforeEach(() => {
      store.set('key1', {
        data: { msg: '1' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      store.set('key2', {
        data: { msg: '2' },
        userId: 'user2',
        clientId: 'client2',
        channel: 'channel2'
      });
    });

    it('should return correct size', () => {
      expect(store.size()).toBe(2);
    });

    it('should clear all entries', () => {
      store.clear();
      expect(store.size()).toBe(0);
    });
  });

  describe('destroy', () => {
    it('should stop cleanup interval and clear store', () => {
      store.set('key1', {
        data: { msg: '1' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      expect(store.size()).toBe(1);
      
      store.destroy();
      
      expect(store.size()).toBe(0);
    });
  });
});
