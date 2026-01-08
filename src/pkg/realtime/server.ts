import type { SyncOperation, ServerAdapter } from '../types.js';
import type { SyncConfig } from '../server/types.js';
import type { 
  RealtimeServerConfig, 
  RealtimeServerConfigResolved,
  RealtimeConnection,
  RealtimeEvent,
  PresenceData,
  PresenceJoinEvent,
  PresenceUpdateEvent,
  PresenceLeaveEvent,
  PresenceSyncEvent,
  EphemeralDataEvent
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
  private presenceStore: EphemeralStore<any>;
  private ephemeralStore: EphemeralStore<any>;

  constructor(config: RealtimeServerConfig = {}) {
    super();
    this.config = this.resolveConfig(config);
    
    // Initialize ephemeral stores
    this.presenceStore = new EphemeralStore({
      ttl: config.presenceTtl ?? 60000,
      onExpire: (entry) => this.handlePresenceExpire(entry)
    });
    
    this.ephemeralStore = new EphemeralStore({
      ttl: config.ephemeralTtl ?? 60000
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
   * Handle incoming client message (from POST requests)
   */
  handleClientMessage(message: any, userId: string, clientId: string): void {
    const { type, data } = message;
    
    switch (type) {
      case 'presence:join':
      case 'presence:update':
        this.handlePresenceUpdate(data, userId, clientId);
        break;
      case 'presence:leave':
        this.handlePresenceLeave(data, userId, clientId);
        break;
      case 'ephemeral':
        this.handleEphemeralData(data, userId, clientId);
        break;
      case 'channel:join':
        this.handleChannelJoin(data, userId, clientId);
        break;
      case 'channel:leave':
        this.handleChannelLeave(data, userId, clientId);
        break;
      default:
        console.warn(`Unknown message type: ${type}`);
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
  
  // Presence handlers
  private setupPresenceHandlers(): void {
    // No-op for now, presence is handled via handleClientMessage
  }
  
  private setupEphemeralHandlers(): void {
    // No-op for now, ephemeral data is handled via handleClientMessage
  }
  
  private handlePresenceUpdate(data: PresenceData, userId: string, clientId: string): void {
    const { channel, state } = data;
    const key = `${channel}:${userId}:${clientId}`;
    
    // Check if this is a new presence (join) or update
    const existing = this.presenceStore.getEntry(key);
    const isJoin = !existing;
    
    // Store/update presence
    this.presenceStore.set(key, {
      data: state,
      userId,
      clientId,
      channel
    });
    
    // Broadcast to other clients in the channel
    const eventType = isJoin ? 'presence:join' : 'presence:update';
    const event: PresenceJoinEvent | PresenceUpdateEvent = {
      userId,
      clientId,
      channel,
      state
    };
    
    this.broadcastToChannel(channel, {
      type: eventType,
      data: event,
      timestamp: Date.now()
    }, clientId);
  }
  
  private handlePresenceLeave(data: { channel: string }, userId: string, clientId: string): void {
    const { channel } = data;
    const key = `${channel}:${userId}:${clientId}`;
    
    // Remove presence
    this.presenceStore.delete(key);
    
    // Broadcast leave event
    const event: PresenceLeaveEvent = {
      userId,
      clientId,
      channel
    };
    
    this.broadcastToChannel(channel, {
      type: 'presence:leave',
      data: event,
      timestamp: Date.now()
    });
  }
  
  private handlePresenceExpire(entry: EphemeralEntry): void {
    // Broadcast leave event when presence expires
    const event: PresenceLeaveEvent = {
      userId: entry.userId,
      clientId: entry.clientId,
      channel: entry.channel
    };
    
    this.broadcastToChannel(entry.channel, {
      type: 'presence:leave',
      data: event,
      timestamp: Date.now()
    });
  }
  
  private handleEphemeralData(data: EphemeralDataEvent, userId: string, clientId: string): void {
    const { channel, event: eventName, data: eventData } = data;
    
    // Store ephemeral data
    const key = `${channel}:${eventName}:${Date.now()}:${Math.random()}`;
    this.ephemeralStore.set(key, {
      data: eventData,
      userId,
      clientId,
      channel
    });
    
    // Broadcast to channel
    this.broadcastToChannel(channel, {
      type: 'ephemeral',
      data: {
        channel,
        event: eventName,
        data: eventData,
        userId,
        clientId
      },
      timestamp: Date.now()
    }, clientId);
  }
  
  private handleChannelJoin(data: { channel: string }, userId: string, clientId: string): void {
    const { channel } = data;
    
    // Find connection for this client
    const connectionId = this.findConnectionId(userId, clientId);
    if (!connectionId) return;
    
    // Add to channel subscriptions
    if (!this.channelSubscriptions.has(channel)) {
      this.channelSubscriptions.set(channel, new Set());
    }
    this.channelSubscriptions.get(channel)!.add(connectionId);
    
    // Send current presence state for this channel
    this.sendPresenceSync(connectionId, channel);
  }
  
  private handleChannelLeave(data: { channel: string }, userId: string, clientId: string): void {
    const { channel } = data;
    
    // Find connection for this client
    const connectionId = this.findConnectionId(userId, clientId);
    if (!connectionId) return;
    
    // Remove from channel subscriptions
    const subs = this.channelSubscriptions.get(channel);
    if (subs) {
      subs.delete(connectionId);
      if (subs.size === 0) {
        this.channelSubscriptions.delete(channel);
      }
    }
  }
  
  private sendPresenceSync(connectionId: string, channel: string): void {
    const presenceEntries = this.presenceStore.getByChannel(channel);
    const presence: Record<string, any> = {};
    
    for (const entry of presenceEntries) {
      const key = `${entry.userId}`;
      presence[key] = entry.data;
    }
    
    const event: PresenceSyncEvent = {
      channel,
      presence
    };
    
    this.sendToConnection(connectionId, {
      type: 'presence:sync',
      data: event,
      timestamp: Date.now()
    });
  }
  
  private broadcastToChannel(channel: string, event: RealtimeEvent, excludeClientId?: string): void {
    const subs = this.channelSubscriptions.get(channel);
    if (!subs) return;
    
    for (const connectionId of subs) {
      const connection = this.connections.get(connectionId);
      if (!connection) continue;
      
      // Skip the client that originated the event
      if (excludeClientId && connection.clientId === excludeClientId) {
        continue;
      }
      
      this.sendToConnection(connectionId, event);
    }
  }
  
  private findConnectionId(userId: string, clientId: string): string | null {
    const userConns = this.userConnections.get(userId);
    if (!userConns) return null;
    
    for (const connId of userConns) {
      const conn = this.connections.get(connId);
      if (conn && conn.clientId === clientId) {
        return connId;
      }
    }
    
    return null;
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
        