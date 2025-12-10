import type { SyncOperation, ServerAdapter } from '../types.js';
import type { SyncConfig } from '../server/types.js';
import type { 
  RealtimeServerConfig, 
  RealtimeServerConfigResolved,
  RealtimeConnection,
  RealtimeEvent
} from './types.js';
import { EventEmitter } from './event-emitter.js';

/**
 * Server-side realtime connection manager.
 * Manages SSE connections and broadcasts operations to connected clients.
 */
export class RealtimeServer extends EventEmitter {
  private config: RealtimeServerConfigResolved;
  private connections: Map<string, RealtimeConnection> = new Map();
  private userConnections: Map<string, Set<string>> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private encoder = new TextEncoder();

  constructor(config: RealtimeServerConfig = {}) {
    super();
    this.config = this.resolveConfig(config);
    
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
    const event: RealtimeEvent<Y> = {
      type,
      data,
      timestamp: Date.now()
    };
    
    for (const connectionId of this.connections.key()) {
      this.sendToConnection(connectionId, event)
    }
  }
  
  /**
   * Disconenct all clients
   */
  disconnectAll(): void {
    for (const connectionId of this.connections.key()) {
      this.removeConnection(connectionId)
    }
  }
  
  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopHeartbeat();
    this.disconnectAll();
    this.removeAllListeners();
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
    
    const userConns = this.userConnections.get(connection.userId)
    if (userConns) {
      userConns.delete(connectionId);
      if (userConns === 0) {
        this.userConnections.delete(connectionId);
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
        for (const [id, conn] of this.connections()) {
          if (now - conn.lastActivity > this.config.connectionTimeout) {
            this.removeConnection(id);
          }
        }
      }
    }, this.config.heartbeatInterval)
  }
  
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearinterval(this.heartbeatInterval)
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
        