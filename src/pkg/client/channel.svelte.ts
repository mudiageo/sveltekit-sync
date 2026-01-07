/**
 * SyncChannel - Channel-based API for real-time features
 * 
 * Provides a composable API for presence tracking, custom events,
 * and channel-scoped communication.
 */

import type { RealtimeClient } from '../realtime/client.js';
import { PresenceStore } from './presence.svelte.js';
import type { User } from './presence.svelte.js';

export interface ChannelOptions {
  /** Enable presence tracking for this channel */
  presence?: boolean;
  /** Enable custom event broadcasting */
  broadcast?: boolean;
}

export interface ChannelOptionsResolved {
  presence: boolean;
  broadcast: boolean;
}

/**
 * Channel for scoped real-time communication
 */
export class SyncChannel {
  readonly name: string;
  readonly presence: PresenceStore | null = null;
  
  private realtimeClient: RealtimeClient;
  private options: ChannelOptionsResolved;
  private subscribed = false;
  private eventHandlers: Map<string, Set<(data: any) => void>> = new Map();
  
  constructor(
    realtimeClient: RealtimeClient,
    name: string,
    user?: User,
    options: ChannelOptions = {}
  ) {
    this.realtimeClient = realtimeClient;
    this.name = name;
    this.options = {
      presence: options.presence ?? false,
      broadcast: options.broadcast ?? false,
    };
    
    // Initialize presence if enabled
    if (this.options.presence && user) {
      this.presence = new PresenceStore(realtimeClient, name, user);
    }
    
    // Setup event listeners for channel-specific events
    this.setupEventListeners();
  }
  
  private setupEventListeners(): void {
    // Listen for ephemeral events on this channel
    this.realtimeClient.on('ephemeral', (data: any) => {
      if (data.channel === this.name) {
        const handlers = this.eventHandlers.get(data.event);
        if (handlers) {
          handlers.forEach(handler => handler(data.data));
        }
      }
    });
  }
  
  /**
   * Subscribe to the channel
   * Must be called before receiving events
   */
  async subscribe(): Promise<void> {
    if (this.subscribed) {
      console.warn(`Channel ${this.name} is already subscribed`);
      return;
    }
    
    await this.realtimeClient.joinChannel(this.name);
    this.subscribed = true;
  }
  
  /**
   * Unsubscribe from the channel
   */
  async unsubscribe(): Promise<void> {
    if (!this.subscribed) {
      return;
    }
    
    await this.realtimeClient.leaveChannel(this.name);
    this.subscribed = false;
    
    // Clean up presence if enabled
    if (this.presence) {
      this.presence.destroy();
    }
    
    // Clear event handlers
    this.eventHandlers.clear();
  }
  
  /**
   * Track presence state (if presence is enabled)
   */
  track<T>(state: T): void {
    if (!this.presence) {
      console.warn('Presence is not enabled for this channel');
      return;
    }
    
    this.presence.updatePresence({ custom: state } as any);
  }
  
  /**
   * Stop tracking presence
   */
  untrack(): void {
    if (!this.presence) {
      return;
    }
    
    this.presence.destroy();
  }
  
  /**
   * Listen for custom events on this channel
   */
  on<T>(event: string, handler: (data: T) => void): () => void {
    if (!this.options.broadcast) {
      console.warn('Broadcasting is not enabled for this channel');
    }
    
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    
    this.eventHandlers.get(event)!.add(handler);
    
    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.eventHandlers.delete(event);
        }
      }
    };
  }
  
  /**
   * Broadcast a custom event to all subscribers of this channel
   */
  async broadcast<T>(event: string, data: T): Promise<void> {
    if (!this.options.broadcast) {
      console.warn('Broadcasting is not enabled for this channel');
      return;
    }
  
    if (!this.subscribed) {
      console.warn(`Cannot broadcast on unsubscribed channel ${this.name}`);
      return;
    }
  
    await this.realtimeClient.send('ephemeral', {
      channel: this.name,
      event,
      data
    });
  }
  
  /**
   * Check if the channel is subscribed
   */
  isSubscribed(): boolean {
    return this.subscribed;
  }
}
