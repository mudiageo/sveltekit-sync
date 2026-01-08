/**
 * SyncChannel Unit Tests
 * 
 * Tests for the channel-based real-time API.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SyncChannel } from '$pkg/client/channel.svelte.js';
import { RealtimeClient } from '$pkg/realtime/client.js';
import type { User } from '$pkg/client/presence.svelte.js';

// Mock RealtimeClient
class MockRealtimeClient extends RealtimeClient {
  public sentMessages: Array<{ type: string; data: any }> = [];
  public eventHandlers: Map<string, Set<(data: any) => void>> = new Map();

  constructor() {
    super({ enabled: false }); // Don't actually connect
  }

  async send(type: string, data: any): Promise<void> {
    this.sentMessages.push({ type, data });
  }

  joinChannel() {
    return vi.fn().mockResolvedValue(undefined);
  }

  leaveChannel() {
    return vi.fn().mockResolvedValue(undefined);
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

describe('SyncChannel', () => {
  let realtimeClient: MockRealtimeClient;
  let testUser: User;

  beforeEach(() => {
    realtimeClient = new MockRealtimeClient();
    testUser = {
      id: 'user1',
      name: 'Test User',
      email: 'test@example.com'
    };
  });

  afterEach(() => {
    realtimeClient.destroy();
  });

  describe('initialization', () => {
    it('should create a channel without options', () => {
      const channel = new SyncChannel(realtimeClient, 'test-channel');
      
      expect(channel).toBeDefined();
      expect(channel.name).toBe('test-channel');
      expect(channel.presence).toBeNull();
    });

    it('should create a channel with presence enabled', () => {
      const channel = new SyncChannel(
        realtimeClient, 
        'test-channel', 
        testUser,
        { presence: true }
      );
      
      expect(channel.presence).not.toBeNull();
      expect(channel.presence).toBeDefined();
    });

    it('should create a channel with broadcast enabled', () => {
      const channel = new SyncChannel(
        realtimeClient, 
        'test-channel',
        undefined,
        { broadcast: true }
      );
      
      expect(channel).toBeDefined();
    });

    it('should not create presence without user', () => {
      const channel = new SyncChannel(
        realtimeClient, 
        'test-channel',
        undefined,
        { presence: true }
      );
      
      expect(channel.presence).toBeNull();
    });
  });

  describe('subscribe/unsubscribe', () => {
    it('should subscribe to a channel', async () => {
      const channel = new SyncChannel(realtimeClient, 'test-channel');
      
      await channel.subscribe();
      
      expect(realtimeClient.joinChannel).toHaveBeenCalledWith('test-channel');
      expect(channel.isSubscribed()).toBe(true);
      expect(realtimeClient.sentMessages).toContainEqual({
        type: 'channel:join',
        data: { channel: 'test-channel' }
      });
    });

    it('should unsubscribe from a channel', async () => {
      const channel = new SyncChannel(realtimeClient, 'test-channel');
      
      await channel.subscribe();
      await channel.unsubscribe();
      
      expect(realtimeClient.leaveChannel).toHaveBeenCalledWith('test-channel');
      expect(channel.isSubscribed()).toBe(false);
      expect(realtimeClient.sentMessages).toContainEqual({
        type: 'channel:leave',
        data: { channel: 'test-channel' }
      });
    });

    it('should not subscribe twice', async () => {
      const channel = new SyncChannel(realtimeClient, 'test-channel');
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      await channel.subscribe();
      await channel.subscribe(); // Should warn
      
      expect(realtimeClient.joinChannel).toHaveBeenCalledTimes(1);
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should clean up presence on unsubscribe', async () => {
      const channel = new SyncChannel(
        realtimeClient, 
        'test-channel',
        testUser,
        { presence: true }
      );
      
      await channel.subscribe();
      const presenceDestroySpy = vi.spyOn(channel.presence!, 'destroy');
      
      await channel.unsubscribe();
      
      expect(presenceDestroySpy).toHaveBeenCalled();
    });

    it('should not unsubscribe if not subscribed', async () => {
      const channel = new SyncChannel(
        realtimeClient,
        'test-channel',
        testUser,
        { presence: true }
      );

      await channel.unsubscribe();

      expect(realtimeClient.leaveChannel).not.toHaveBeenCalled();
    });
  });

  describe('presence tracking', () => {
    it('should track presence state', () => {
      const channel = new SyncChannel(
        realtimeClient, 
        'test-channel',
        testUser,
        { presence: true }
      );
      
      const customState = { editing: 'document-1' };
      channel.track(customState);
      
      // Presence should be updated
      expect(channel.presence).not.toBeNull();
    });

    it('should warn when tracking without presence enabled', () => {
      const channel = new SyncChannel(realtimeClient, 'test-channel');
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      channel.track({ editing: 'doc' });
      
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });

    it('should untrack presence', () => {
      const channel = new SyncChannel(
        realtimeClient, 
        'test-channel',
        testUser,
        { presence: true }
      );
      
      const destroySpy = vi.spyOn(channel.presence!, 'destroy');
      channel.untrack();
      
      expect(destroySpy).toHaveBeenCalled();
    });
  });

  describe('custom events', () => {
    it('should listen for custom events', async () => {
      const channel = new SyncChannel(
        realtimeClient, 
        'test-channel',
        undefined,
        { broadcast: true }
      );
      
      const handler = vi.fn();
      channel.on('custom-event', handler);
      
      // Simulate receiving event from server
      realtimeClient.simulateEvent('ephemeral', {
        channel: 'test-channel',
        event: 'custom-event',
        data: { message: 'Hello' }
      });
      
      expect(handler).toHaveBeenCalledWith({ message: 'Hello' });
    });

    it('should not receive events from other channels', () => {
      const channel = new SyncChannel(
        realtimeClient, 
        'test-channel',
        undefined,
        { broadcast: true }
      );
      
      const handler = vi.fn();
      channel.on('custom-event', handler);
      
      // Simulate event from different channel
      realtimeClient.simulateEvent('ephemeral', {
        channel: 'other-channel',
        event: 'custom-event',
        data: { message: 'Hello' }
      });
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should broadcast custom events', async () => {
      const channel = new SyncChannel(
        realtimeClient, 
        'test-channel',
        undefined,
        { broadcast: true }
      );
      
      await channel.broadcast('custom-event', { message: 'Hello' });
      
      expect(realtimeClient.sentMessages).toContainEqual({
        type: 'ephemeral',
        data: {
          channel: 'test-channel',
          event: 'custom-event',
          data: { message: 'Hello' }
        }
      });
    });

    it('should unsubscribe event handler', () => {
      const channel = new SyncChannel(
        realtimeClient, 
        'test-channel',
        undefined,
        { broadcast: true }
      );
      
      const handler = vi.fn();
      const unsubscribe = channel.on('custom-event', handler);
      
      unsubscribe();
      
      // Simulate event - should not call handler
      realtimeClient.simulateEvent('ephemeral', {
        channel: 'test-channel',
        event: 'custom-event',
        data: { message: 'Hello' }
      });
      
      expect(handler).not.toHaveBeenCalled();
    });

    it('should warn when broadcasting without broadcast enabled', async () => {
      const channel = new SyncChannel(realtimeClient, 'test-channel');
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      await channel.broadcast('event', { data: 'test' });
      
      expect(consoleWarnSpy).toHaveBeenCalled();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('multiple event handlers', () => {
    it('should support multiple handlers for same event', () => {
      const channel = new SyncChannel(
        realtimeClient, 
        'test-channel',
        undefined,
        { broadcast: true }
      );
      
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      channel.on('custom-event', handler1);
      channel.on('custom-event', handler2);
      
      realtimeClient.simulateEvent('ephemeral', {
        channel: 'test-channel',
        event: 'custom-event',
        data: { message: 'Hello' }
      });
      
      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should remove specific handler when unsubscribed', () => {
      const channel = new SyncChannel(
        realtimeClient, 
        'test-channel',
        undefined,
        { broadcast: true }
      );
      
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      channel.on('custom-event', handler1);
      const unsub2 = channel.on('custom-event', handler2);
      
      unsub2(); // Unsubscribe handler2
      
      realtimeClient.simulateEvent('ephemeral', {
        channel: 'test-channel',
        event: 'custom-event',
        data: { message: 'Hello' }
      });
      
      expect(handler1).toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });
});
