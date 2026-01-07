import type { RealtimeClient } from '../realtime/client.js';
import type { ClientMessage, PresenceState } from '../realtime/types.js';
import { EventEmitter } from '../realtime/event-emitter.js';

export interface ChannelOptions {
  /** Enable presence tracking */
  presence?: boolean;
  /** Enable custom event broadcasting */
  broadcast?: boolean;
}

/**
 * Represents a realtime channel for presence and custom events.
 * Channels group related realtime features together.
 */
export class SyncChannel extends EventEmitter {
  readonly name: string;
  private realtimeClient: RealtimeClient;
  private options: ChannelOptions;
  private isSubscribed = false;
  private presenceState: PresenceState | null = null;

  constructor(realtimeClient: RealtimeClient, name: string, options: ChannelOptions = {}) {
    super();
    this.realtimeClient = realtimeClient;
    this.name = name;
    this.options = {
      presence: options.presence ?? false,
      broadcast: options.broadcast ?? true,
    };
  }

  /**
   * Subscribe to the channel
   */
  async subscribe(): Promise<void> {
    if (this.isSubscribed) return;

    // Listen for presence events
    if (this.options.presence) {
      this.realtimeClient.on('presence:join', (data) => {
        if (data.channel === this.name) {
          this.emit('presence:join', data.presence);
        }
      });

      this.realtimeClient.on('presence:update', (data) => {
        if (data.channel === this.name) {
          this.emit('presence:update', data.presence);
        }
      });

      this.realtimeClient.on('presence:leave', (data) => {
        if (data.channel === this.name) {
          this.emit('presence:leave', data.presence);
        }
      });

      this.realtimeClient.on('presence:sync', (data) => {
        if (data.channel === this.name) {
          this.emit('presence:sync', data.presence);
        }
      });
    }

    // Listen for ephemeral events (custom broadcasts)
    if (this.options.broadcast) {
      this.realtimeClient.on('ephemeral:update', (data) => {
        if (data.channel === this.name) {
          this.emit(data.event, data.data);
        }
      });
    }

    await this.realtimeClient.joinChannel(this.name);
    this.isSubscribed = true;
  }

  /**
   * Unsubscribe from the channel
   */
  async unsubscribe(): Promise<void> {
    if (!this.isSubscribed) return;

    await this.realtimeClient.leaveChannel(this.name);
    this.removeAllListeners();
    this.isSubscribed = false;
  }

  /**
   * Track presence state (if presence is enabled)
   */
  track<T = any>(state: Partial<PresenceState<T>>): void {
    if (!this.options.presence) {
      console.warn('Presence is not enabled for this channel');
      return;
    }

    // Update local presence state
    this.presenceState = {
      ...this.presenceState,
      ...state,
      lastUpdated: Date.now(),
    } as PresenceState;

    // Send to server
    const message: ClientMessage<PresenceState> = {
      type: 'presence',
      channel: this.name,
      data: this.presenceState,
    };

    this.realtimeClient.send(message);
  }

  /**
   * Stop tracking presence
   */
  untrack(): void {
    if (!this.options.presence || !this.presenceState) return;

    // Send leave event
    const message: ClientMessage<PresenceState> = {
      type: 'presence',
      channel: this.name,
      data: {
        ...this.presenceState,
        status: 'away',
        lastUpdated: Date.now(),
      } as PresenceState,
    };

    this.realtimeClient.send(message);
    this.presenceState = null;
  }

  /**
   * Broadcast a custom event to other clients in the channel
   */
  broadcast<T = any>(event: string, data: T): void {
    if (!this.options.broadcast) {
      console.warn('Broadcasting is not enabled for this channel');
      return;
    }

    const message: ClientMessage = {
      type: 'ephemeral',
      channel: this.name,
      data: {
        event,
        data,
      },
    };

    this.realtimeClient.send(message);
  }

  /**
   * Get the current presence state
   */
  getPresence(): PresenceState | null {
    return this.presenceState;
  }

  /**
   * Check if the channel is subscribed
   */
  get subscribed(): boolean {
    return this.isSubscribed;
  }
}
