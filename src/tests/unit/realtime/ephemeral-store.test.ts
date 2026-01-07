import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EphemeralStore } from '../../../pkg/realtime/ephemeral-store.js';

describe('EphemeralStore', () => {
  let store: EphemeralStore<any>;

  beforeEach(() => {
    store = new EphemeralStore({ ttl: 1000, cleanupInterval: 0 }); // No automatic cleanup in tests
  });

  afterEach(() => {
    store.destroy();
  });

  describe('Basic Operations', () => {
    it('should set and get an entry', () => {
      store.set('key1', {
        data: { value: 'test' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      const result = store.get('key1');
      expect(result).toEqual({ value: 'test' });
    });

    it('should return null for non-existent key', () => {
      const result = store.get('non-existent');
      expect(result).toBeNull();
    });

    it('should delete an entry', () => {
      store.set('key1', {
        data: { value: 'test' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      const deleted = store.delete('key1');
      expect(deleted).toBe(true);
      expect(store.get('key1')).toBeNull();
    });

    it('should check if key exists', () => {
      store.set('key1', {
        data: { value: 'test' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      expect(store.has('key1')).toBe(true);
      expect(store.has('non-existent')).toBe(false);
    });
  });

  describe('TTL and Expiration', () => {
    it('should expire entries after TTL', async () => {
      const shortTtlStore = new EphemeralStore({ ttl: 50, cleanupInterval: 0 });
      
      shortTtlStore.set('key1', {
        data: { value: 'test' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      expect(shortTtlStore.get('key1')).toEqual({ value: 'test' });

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 60));

      expect(shortTtlStore.get('key1')).toBeNull();
      
      shortTtlStore.destroy();
    });

    it('should call onExpire callback when cleaning up expired entries', async () => {
      const onExpire = vi.fn();
      const shortTtlStore = new EphemeralStore({ ttl: 50, cleanupInterval: 0, onExpire });

      shortTtlStore.set('key1', {
        data: { value: 'test' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 60));

      // Manually trigger cleanup
      shortTtlStore.cleanup();

      expect(onExpire).toHaveBeenCalledTimes(1);
      expect(onExpire).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { value: 'test' },
          userId: 'user1',
          clientId: 'client1',
          channel: 'channel1'
        })
      );

      shortTtlStore.destroy();
    });
  });

  describe('Query Methods', () => {
    beforeEach(() => {
      store.set('key1', {
        data: { value: 'user1-client1' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      store.set('key2', {
        data: { value: 'user1-client2' },
        userId: 'user1',
        clientId: 'client2',
        channel: 'channel1'
      });

      store.set('key3', {
        data: { value: 'user2-client1' },
        userId: 'user2',
        clientId: 'client1',
        channel: 'channel1'
      });

      store.set('key4', {
        data: { value: 'user1-channel2' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel2'
      });
    });

    it('should get entries by channel', () => {
      const entries = store.getByChannel('channel1');
      expect(entries).toHaveLength(3);
      expect(entries.every(e => e.channel === 'channel1')).toBe(true);
    });

    it('should get entries by user', () => {
      const entries = store.getByUser('user1');
      expect(entries).toHaveLength(3);
      expect(entries.every(e => e.userId === 'user1')).toBe(true);
    });

    it('should get all data in channel', () => {
      const data = store.getAllInChannel('channel1');
      expect(data).toHaveLength(3);
      expect(data).toContainEqual({ value: 'user1-client1' });
      expect(data).toContainEqual({ value: 'user1-client2' });
      expect(data).toContainEqual({ value: 'user2-client1' });
    });

    it('should get all data in channel excluding a client', () => {
      const data = store.getAllInChannel('channel1', 'client1');
      expect(data).toHaveLength(1);
      expect(data).toContainEqual({ value: 'user1-client2' });
    });

    it('should return empty array for non-existent channel', () => {
      const entries = store.getByChannel('non-existent');
      expect(entries).toEqual([]);
    });
  });

  describe('Store Management', () => {
    it('should return correct size', () => {
      expect(store.size()).toBe(0);

      store.set('key1', {
        data: { value: 'test1' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      store.set('key2', {
        data: { value: 'test2' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      expect(store.size()).toBe(2);
    });

    it('should return all keys', () => {
      store.set('key1', {
        data: { value: 'test1' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      store.set('key2', {
        data: { value: 'test2' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      const keys = store.keys();
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toHaveLength(2);
    });

    it('should clear all entries', () => {
      store.set('key1', {
        data: { value: 'test1' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      store.set('key2', {
        data: { value: 'test2' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      expect(store.size()).toBe(2);

      store.clear();

      expect(store.size()).toBe(0);
      expect(store.keys()).toEqual([]);
    });
  });

  describe('Entry Metadata', () => {
    it('should store and retrieve full entry with metadata', () => {
      const now = Date.now();
      
      store.set('key1', {
        data: { value: 'test' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      const entry = store.getEntry('key1');
      
      expect(entry).toBeTruthy();
      expect(entry?.data).toEqual({ value: 'test' });
      expect(entry?.userId).toBe('user1');
      expect(entry?.clientId).toBe('client1');
      expect(entry?.channel).toBe('channel1');
      expect(entry?.updatedAt).toBeGreaterThanOrEqual(now);
      expect(entry?.expiresAt).toBeGreaterThan(now);
    });

    it('should update expiresAt when setting existing key', async () => {
      store.set('key1', {
        data: { value: 'test' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      const firstEntry = store.getEntry('key1');
      const firstExpires = firstEntry?.expiresAt;

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));

      // Update the same key
      store.set('key1', {
        data: { value: 'updated' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      const secondEntry = store.getEntry('key1');
      const secondExpires = secondEntry?.expiresAt;

      expect(secondExpires).toBeGreaterThan(firstExpires!);
    });
  });

  describe('Automatic Cleanup', () => {
    it('should automatically clean up expired entries', async () => {
      const autoCleanupStore = new EphemeralStore({ 
        ttl: 50, 
        cleanupInterval: 100 
      });

      autoCleanupStore.set('key1', {
        data: { value: 'test' },
        userId: 'user1',
        clientId: 'client1',
        channel: 'channel1'
      });

      expect(autoCleanupStore.get('key1')).toEqual({ value: 'test' });

      // Wait for TTL to expire and cleanup to run
      await new Promise(resolve => setTimeout(resolve, 160));

      expect(autoCleanupStore.get('key1')).toBeNull();

      autoCleanupStore.destroy();
    });
  });
});
