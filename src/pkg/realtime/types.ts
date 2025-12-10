import type { SyncOperation } from '../types.js';

export type RealtimeEventType = 
  | 'operations'      // Sync operations data
  | 'connected'       // Connection established
  | 'heartbeat'       // Keep-alive ping
  | 'error'           // Error occurred
  | 'reconnect';      // Server requesting reconnect

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