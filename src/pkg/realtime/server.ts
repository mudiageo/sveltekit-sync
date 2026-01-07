import type { SyncOperation, ServerAdapter } from '../types.js';
import type { SyncConfig } from '../server/types.js';
import type { 
  RealtimeServerConfig, 
  RealtimeServerConfigResolved,
  RealtimeConnection,
  RealtimeEvent,
  PresenceState,
  ClientMessage,
  PresenceEvent
} from './types.js';
import { EventEmitter } from './event-emitter.js';
import { EphemeralStore, type EphemeralEntry } from './ephemeral-store.js';

/**
 * Server-side realtime connection manager.
 * Manages SSE connections and broadcasts operations to connected clients.
 */
export class RealtimeServer extends EventEmitter {
  private config: RealtimeServerConfigResolved;
  private connections: Map<string, RealtimeConnection> = new Map();
  private userConnections: Map<string, Set<string>> = new Map();
  private channelSubscriptions: Map<string, Set<string>> = new Map(); // channel -> connectionIds
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private encoder = new TextEncoder();
  
  // Ephemeral stores
  private presenceStore: EphemeralStore<PresenceState>;
  private ephemeralStore: EphemeralStore;

  constructor(config: RealtimeServerConfig = {}) {
    super();
    this.config = this.resolveConfig(config);
    
    // Initialize ephemeral stores
    this.presenceStore = new EphemeralStore<PresenceState>({
      ttl: this.config.presenceTtl ?? 60000,
      onExpire: (entry) => this.handlePresenceExpire(entry)
    });
    
    this.ephemeralStore = new EphemeralStore({
      ttl: this.config.ephemeralTtl ?? 60000
    });
    
    // Set up internal event handlers for presence
    this.setupPresenceHandlers();
    
    // Set up generic ephemeral data handlers
    this.setupEphemeralHandlers();
    
    if (this.config.enabled && this.config.heartbeatInterval > 0) {
      this.startHeartbeat();
    }
  }

  private resolveConfig(config: RealtimeServerConfig): RealtimeServerConfigResolved {
    return {
      enabled: config.enabled ?? true,
      path: config.path ?? '/api/sync/realtime',
      heartbeatInterval: config.heartbeatInterval ?? 30000,
      connectionTimeout: config.connectionTimeout ?? 0,
      maxConnectionsPerUser: config.maxConnectionsPerUser ?? 5,
      authenticate: config.authenticate ?? (async () => null),
      allowedTables: config.allowedTables ?? [],
      presenceTtl: config.presenceTtl ?? 60000,
      ephemeralTtl: config.ephemeralTtl ?? 60000,
    };
  }

  /**
   * Update configuration at runtime
   */
  configure(config: Partial<RealtimeServerConfig>): void {
    const wasEnabled = this.config.enabled;
    this.config = { ...this.config, ...config };
    
    // Handle heartbeat changes
    if (this.config.enabled && !wasEnabled) {
      this.startHeartbeat();
    } else if (!this.config.enabled && wasEnabled) {
      this.stopHeartbeat();
      this.disconnectAll();
    }
  }

  /**
   * Get active connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Get connections for a specific user
   */
  getUserConnections(userId: string): RealtimeConnection[] {
    const connectionIds = this.userConnections.get(userId);
    if (!connectionIds) return [];
    
    return Array.from(connectionIds)
      .map(id => this.connections.get(id))
      .filter((conn): conn is RealtimeConnection => conn !== undefined);
  }

  /**
   * Create an SSE response for a client connection.
   * Use this in your API route handler.
   */
  createConnection(
    connectionId: string,
    userId: string,
    clientId: string,
    tables: string[] = []
  ): Response {
    if (!this.config.enabled) {
      return new Response('Realtime disabled', { status: 503 });
    }

    // Check max connections per user
    const userConns = this.userConnections.get(userId);
    if (userConns && userConns.size >= this.config.maxConnectionsPerUser) {
      // Remove oldest connection
      const oldestId = userConns.values().next().value;
      if (oldestId) {
        this.removeConnection(oldestId);
      }
    }

    // Filter tables to allowed ones
    const allowedTables = this.config.allowedTables.length > 0
      ? tables.filter(t => this.config.allowedTables.includes(t))
      : tables;

    const stream = new ReadableStream({
      start: (controller) => {
        const connection: RealtimeConnection = {
          id: connectionId,
          userId,
          clientId,
          tables: allowedTables,
          controller,
          createdAt: Date.now(),
          lastActivity: Date.now(),
        };

        this.addConnection(connection);

        // Send connected event
        this.sendToConnection(connectionId, {
          type: 'connected',
          data: { connectionId, tables: allowedTables },
          timestamp: Date.now(),
        });
      },
      cancel: () => {
        this.removeConnection(connectionId);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering
      },
    });
  }

  /**
   * Broadcast operations to all relevant connected clients.
   * Call this after processing push operations.
   */
  broadcast(operations: SyncOperation[], excludeClientId?: string): void {
    if (!this.config.enabled || operations.length === 0) return;

    const tables = [...new Set(operations.map(op => op.table))];

    for (const connection of this.connections.values()) {
      // Skip the client that originated the operations
      if (excludeClientId && connection.clientId === excludeClientId) {
        continue;
      }

      // Filter operations for tables this connection is subscribed to
      const relevantOps = connection.tables.length === 0
        ? operations // Empty tables = all tables
        : operations.filter(op => connection.tables.includes(op.table));

      if (relevantOps.length > 0) {
        this.sendToConnection(connection.id, {
          type: 'operations',
          data: { operations: relevantOps, tables },
          timestamp: Date.now(),
        });
      }
    }

    this.emit('broadcast', { operations, tables });
  }

  /**
   * Send operations to a specific user's connections
   */
  sendToUser(userId: string, operations: SyncOperation[]): void {
    const connections = this.getUserConnections(userId);
    
    for (const connection of connections) {
      const relevantOps = connection.tables.length === 0
        ? operations
        : operations.filter(op => connection.tables.includes(op.table) );
      
      if (relevantOps.length > 0) {
        this.sendToConnection(connection.id, {
          type: 'operations',
          data: { operations:  relevantOps, tables: [...new Set(relevantOps.map(op => op.table))]},
          timestamp: Date.now()
        });
      }
    }  
  }
  
  /**
   * Send a custom event to all connections
   */
  sendtoAll<T>(type: string, data: T): void {
    const event: RealtimeEvent<T> = {
      type,
      data,
      timestamp: Date.now()
    };
    
    for (const connectionId of this.connections.keys()) {
      this.sendToConnection(connectionId, event)
    }
  }
  
  /**
   * Disconenct all clients
   */
  disconnectAll(): void {
    for (const connectionId of this.connections.keys()) {
      this.removeConnection(connectionId)
    }
  }
  
  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopHeartbeat();
    this.disconnectAll();
    this.presenceStore.destroy();
    this.ephemeralStore.destroy();
    this.removeAllListeners();
  }
  
  /**
   * Handle client messages (POST requests)
   */
  handleClientMessage(message: ClientMessage, userId: string, clientId: string): void {
    if (message.type === 'presence') {
      this.handlePresenceMessage(message.channel, message.data as PresenceState, userId, clientId);
    } else if (message.type === 'ephemeral') {
      this.handleEphemeralMessage(message.channel, message.data, userId, clientId);
    }
  }
  
  /**
   * Join a channel
   */
  joinChannel(connectionId: string, channel: string): void {
    if (!this.channelSubscriptions.has(channel)) {
      this.channelSubscriptions.set(channel, new Set());
    }
    this.channelSubscriptions.get(channel)!.add(connectionId);
    
    // Send current presence state to the joining client
    const presenceStates = this.presenceStore.getByChannel(channel);
    if (presenceStates.length > 0) {
      const connection = this.connections.get(connectionId);
      if (connection) {
        const event: PresenceEvent = {
          type: 'sync',
          channel,
          presence: presenceStates.map(e => e.data),
          timestamp: Date.now()
        };
        
        this.sendToConnection(connectionId, {
          type: 'presence:sync',
          data: event,
          timestamp: Date.now()
        });
      }
    }
  }
  
  /**
   * Leave a channel
   */
  leaveChannel(connectionId: string, channel: string): void {
    const subscribers = this.channelSubscriptions.get(channel);
    if (subscribers) {
      subscribers.delete(connectionId);
      if (subscribers.size === 0) {
        this.channelSubscriptions.delete(channel);
      }
    }
  }
  
  /**
   * Setup presence handlers
   */
  private setupPresenceHandlers(): void {
    // Presence handlers are called when presence updates are received
    // They update the store and broadcast to other clients
  }
  
  /**
   * Setup ephemeral data handlers
   */
  private setupEphemeralHandlers(): void {
    // Ephemeral handlers are called when custom ephemeral data is received
    // They update the store and broadcast to other clients
  }
  
  /**
   * Handle presence message from client
   */
  private handlePresenceMessage(
    channel: string,
    presence: PresenceState,
    userId: string,
    clientId: string
  ): void {
    const key = `${channel}:${userId}:${clientId}`;
    
    // Determine event type
    const existingEntry = this.presenceStore.getEntry(key);
    const eventType = !existingEntry ? 'join' : 'update';
    
    // Update presence in store
    this.presenceStore.set(key, {
      data: { ...presence, userId, clientId, lastUpdated: Date.now() },
      userId,
      clientId,
      channel
    });
    
    // Broadcast to other clients in the channel
    this.broadcastToChannel(channel, `presence:${eventType}`, {
      type: eventType,
      channel,
      presence: { ...presence, userId, clientId, lastUpdated: Date.now() },
      timestamp: Date.now()
    } as PresenceEvent, clientId);
  }
  
  /**
   * Handle ephemeral message from client
   */
  private handleEphemeralMessage(
    channel: string,
    data: any,
    userId: string,
    clientId: string
  ): void {
    // Store ephemeral data
    const key = `${channel}:${userId}:${clientId}:${Date.now()}`;
    this.ephemeralStore.set(key, {
      data,
      userId,
      clientId,
      channel
    });
    
    // Broadcast to other clients in the channel
    this.broadcastToChannel(channel, 'ephemeral:update', {
      channel,
      event: data.event || 'update',
      data: data.data || data,
      userId,
      clientId,
      timestamp: Date.now()
    }, clientId);
  }
  
  /**
   * Handle presence expiration (TTL expired)
   */
  private handlePresenceExpire(entry: EphemeralEntry<PresenceState>): void {
    // Broadcast leave event
    this.broadcastToChannel(entry.channel, 'presence:leave', {
      type: 'leave',
      channel: entry.channel,
      presence: entry.data,
      timestamp: Date.now()
    } as PresenceEvent);
  }
  
  /**
   * Broadcast message to all connections in a channel
   */
  private broadcastToChannel(
    channel: string,
    eventType: string,
    data: any,
    excludeClientId?: string
  ): void {
    const subscribers = this.channelSubscriptions.get(channel);
    if (!subscribers) return;
    
    const event: RealtimeEvent = {
      type: eventType,
      data,
      timestamp: Date.now()
    };
    
    for (const connectionId of subscribers) {
      const connection = this.connections.get(connectionId);
      if (connection && (!excludeClientId || connection.clientId !== excludeClientId)) {
        this.sendToConnection(connectionId, event);
      }
    }
  }
  
  private addConnection(connection: RealtimeConnection): void {
     this.connections.set(connection.id, connection);
    
    if (!this.userConnections.has(connection.userId)) {
      this.userConnections.set(connection.userId, new Set());
    }
    this.userConnections.get(connection.userId)!.add(connection.id);
      
    this.emit('connected', connection)
  }
  
  private removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId)
    if (!connection) return;
    
    try {
      connection.controller.close();
    } catch {
      //Connection may alr3ady be closed
    }
    
    this.connections.delete(connectionId);
    
    const userConns = this.userConnections.get(connection.userId);
    if (userConns) {
      userConns.delete(connectionId);
      if (userConns.size === 0) {
        this.userConnections.delete(connection.userId);
      }
    }
    this.emit('disconnected', connection)
  }
  
  private sendToConnection(connectionId: string, event: RealtimeEvent): void {
    const connection = this.connections.get(connectionId)
    if (!connection) return;
    
    try {
      const eventId = `${Date.now}-${Math.random().toString(36).substr(2, 9)}`
      const message = this.formatSSEMessage(event, eventId);
      
      connection.controller.enqueue(this.encoder.encode(message));
      connection.lastActivity = Date.now();
    } catch (error) {
      console.error(`Failed to send to connection ${connectionId}`, error)
      this.removeConnection(connectionId)
    }
    
  }
  
  private formatSSEMessage(event: RealtimeEvent, id?: string ): string {
    let message = '';
    
    if (id) {
      message += `id:${id}\n`;
    }
    
    message += `event: ${event.type}\n`;
    message += `data: ${JSON.stringify(event.data)}\n\n`;
    
    return message;
  }
  
  private startHeartbeat(): void {
    this.stopHeartbeat();
    
    this.heartbeatInterval = setInterval(() => {
      const event: RealtimeEvent = {
        type: 'heartbeat',
        data: { timestamp: Date.now()},
        timestamp: Date.now()
      };
      
      for (const connectionId of this.connections.keys()) {
        this.sendToConnection(connectionId, event);
      }
      
      // Cleanup stale conenctions
      if (this.config.connectionTimeout > 0) {
        const now = Date.now();
        for (const [id, conn] of this.connections.entries()) {
          if (now - conn.lastActivity > this.config.connectionTimeout) {
            this.removeConnection(id);
          }
        }
      }
    }, this.config.heartbeatInterval)
  }
  
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
}

/**
 * Create a realtime server with the given configuration
 */
export function createRealtimeServer(config?: RealtimeServerConfig): RealtimeServer {
  return new RealtimeServer(config)
}
        