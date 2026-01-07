import type { SyncOperation } from '../types.js';

export type RealtimeEventType = 
  | 'operations'      // Sync operations data
  | 'connected'       // Connection established
  | 'heartbeat'       // Keep-alive ping
  | 'error'           // Error occurred
  | 'reconnect'       // Server requesting reconnect
  | 'presence:sync'   // Full presence state for a channel
  | 'presence:join'   // User joined
  | 'presence:update' // User updated their presence
  | 'presence:leave'  // User left
  | 'ephemeral:update'; // Generic ephemeral data update

export interface RealtimeEvent<T = any> {
  type: RealtimeEventType;
  data: T;
  timestamp: number;
}

export interface OperationsEvent {
  operations: SyncOperation[];
  tables: string[];
}

export interface ErrorEvent {
  code: string;
  message: string;
}

export type RealtimeStatus = 
  | 'connected'       // SSE connection active
  | 'connecting'      // Attempting to connect
  | 'disconnected'    // Not connected
  | 'fallback';       // Using polling fallback

export interface RealtimeClientConfig {
  /** Enable realtime sync (default: true) */
  enabled?: boolean;
  
  /** SSE endpoint URL (default: '/api/sync/realtime') */
  endpoint?: string;
  
  /** Tables to subscribe to (default: all tables - empty array means all) */
  tables?: string[];
  
  /** Initial reconnect delay in ms (default: 1000) */
  reconnectInterval?: number;
  
  /** Maximum reconnect delay in ms (default: 30000) */
  maxReconnectInterval?: number;
  
  /** Max reconnect attempts before fallback (default: 5) */
  maxReconnectAttempts?: number;
  
  /** Heartbeat timeout in ms - disconnect if no heartbeat (default: 45000) */
  heartbeatTimeout?: number;
  
  /** Callback when connection status changes */
  onStatusChange?: (status: RealtimeStatus) => void;
  
  /** Callback when operations are received */
  onOperations?: (operations: SyncOperation[]) => void;
  
  /** Callback on error */
  onError?: (error: Error) => void;
}

export type RealtimeClientConfigResolved = Required<RealtimeClientConfig>;

export interface RealtimeServerConfig {
  /** Enable realtime features (default: true) */
  enabled?: boolean;
  
  /**
   * URL path for the SSE endpoint
   */
  path?: string;
  
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  
  /** Connection timeout in ms (default: 0 = no timeout) */
  connectionTimeout?: number;
  
  /** Max connections per user (default: 5) */
  maxConnectionsPerUser?: number;
  
  /** Custom authentication function */
  authenticate?: (request: Request) => Promise<{ userId: string; clientId: string } | null>;
  
  /** Tables allowed for realtime (default: all configured tables) */
  allowedTables?: string[];
  
  /** Presence TTL in ms (default: 60000 = 60s) */
  presenceTtl?: number;
  
  /** Ephemeral data TTL in ms (default: 60000 = 60s) */
  ephemeralTtl?: number;
}

export type RealtimeServerConfigResolved = Required<RealtimeServerConfig>;

export interface RealtimeConnection {
  id: string;
  userId: string;
  clientId: string;
  tables: string[];
  controller: ReadableStreamDefaultController<Uint8Array>;
  createdAt: number;
  lastActivity: number;
}

export type RealtimeEventHandler<T = any> = (data: T) => void;

export interface RealtimeEventEmitter {
  on<T = any>(event: string, handler: RealtimeEventHandler<T>): () => void;
  off(event: string, handler: RealtimeEventHandler): void;
  emit<T = any>(event: string, data: T): void;
}

// Presence and Ephemeral Data Types

export interface PresenceState<T = any> {
  userId: string;
  clientId: string;
  user?: {
    id: string;
    name?: string;
    avatar?: string;
    [key: string]: any;
  };
  status: 'online' | 'idle' | 'away';
  cursor?: CursorPosition;
  selection?: Selection;
  editing?: EditingState;
  custom?: T;
  lastUpdated: number;
}

export interface CursorPosition {
  x: number;
  y: number;
  relativeX?: number; // Relative to container
  relativeY?: number;
}

export interface Selection {
  start: number;
  end: number;
  text?: string;
}

export interface EditingState {
  resourceId: string; // Document/field ID
  resourceType?: string; // 'document', 'field', etc.
  startedAt: number;
}

export interface PresenceEvent<T = any> {
  type: 'join' | 'update' | 'leave' | 'sync';
  channel: string;
  presence: PresenceState<T> | PresenceState<T>[]; // Array for 'sync', single for others
  timestamp: number;
}

export interface EphemeralMessage<T = any> {
  channel: string;
  event: string;
  data: T;
  userId: string;
  clientId: string;
  timestamp: number;
}

export interface ClientMessage<T = any> {
  type: 'presence' | 'ephemeral';
  channel: string;
  data: T;
}