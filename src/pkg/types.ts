export type SyncStatus = 'idle' | 'syncing' | 'error' | 'conflict' | 'offline';

export interface SyncOperation<T = any> {
  id: string;
  table: string;
  operation: 'insert' | 'update' | 'delete';
  data: T;
  timestamp: number;
  clientId: string;
  version: number;
  status: 'pending' | 'synced' | 'error';
  error?: string;
  userId?: string; // For multi-user support
}

export interface SyncResult {
  success: boolean;
  synced: string[]; // IDs of successfully synced operations
  conflicts: Conflict[];
  errors: Array<{ id: string; error: string }>;
}

export interface Conflict<T = any> {
  operation: SyncOperation<T>;
  serverData: T;
  clientData: T;
  resolution?: 'client-wins' | 'server-wins' | 'merged';
}

export interface SyncConfig<TLocalDB = any, TRemoteDB = any> {
  // Local database adapter
  local: {
    db: TLocalDB;
    adapter: LocalAdapter<TLocalDB>;
  };

  // Remote sync functions
  remote: {
    push: (ops: SyncOperation[]) => Promise<SyncResult>;
    pull: (lastSync: number, clientId: string) => Promise<SyncOperation[]>;
    resolve?: (conflict: Conflict) => Promise<SyncOperation>;
  };

  // Sync settings
  syncInterval?: number; // Auto-sync interval in ms (0 to disable)
  batchSize?: number; // Number of operations to sync at once
  conflictResolution?: 'client-wins' | 'server-wins' | 'manual' | 'last-write-wins';
  retryAttempts?: number;
  retryDelay?: number;
  realtime?: RealtimeClientConfig;

  // Callbacks
  onSync?: (status: SyncStatus) => void;
  onConflict?: (conflict: Conflict) => void;
  onError?: (error: Error) => void;
}

export interface ClientState {
  clientId: string;
  userId: string;
  lastSync: Date;
  lastActive: Date;
}

// Universal Server Adapter Interface
export interface ServerAdapter<TDB = any> {
  // Core CRUD operations
  insert(table: string, data: any): Promise<any>;
  update(table: string, id: string, data: any, version: number): Promise<any>;
  delete(table: string, id: string): Promise<void>;
  findOne(table: string, id: string): Promise<any | null>;
  find(table: string, filter?: QueryFilter): Promise<any[]>;

  // Sync-specific operations
  getChangesSince(
    table: string,
    timestamp: number,
    userId?: string,
    excludeClientId?: string
  ): Promise<SyncOperation[]>;

  applyOperation(op: SyncOperation, userId?: string): Promise<void>;

  // Batch operations for efficiency
  batchInsert(table: string, records: any[]): Promise<any[]>;
  batchUpdate(table: string, updates: Array<{ id: string; data: any }>): Promise<any[]>;

  // Conflict detection
  checkConflict(table: string, id: string, expectedVersion: number): Promise<boolean>;
  
  // Sync metadata operations
  logSyncOperation(op: SyncOperation, userId: string): Promise<void>;
  updateClientState(clientId: string, userId: string): Promise<void>;
  getClientState(clientId: string): Promise<ClientState | null>;
 
  // Optional: Real-time support
  subscribe?(
    tables: string[],
    userId: string,
    callback: (ops: SyncOperation[]) => void
  ): Promise<() => void>;

  // Transaction support
  transaction?<T>(fn: (adapter: ServerAdapter<TDB>) => Promise<T>): Promise<T>;
}

export interface QueryFilter {
  where?: Record<string, any>;
  orderBy?: { field: string; direction: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}

// Universal Client Adapter Interface
export interface ClientAdapter<TDB = any> {
  // Core operations
  insert(table: string, data: any): Promise<any>;
  update(table: string, id: string, data: any): Promise<any>;
  delete(table: string, id: string): Promise<void>;
  find(table: string, query?: any): Promise<any[]>;
  findOne(table: string, id: string): Promise<any | null>;

  // Sync queue
  addToQueue(op: SyncOperation): Promise<void>;
  getQueue(): Promise<SyncOperation[]>;
  removeFromQueue(ids: string[]): Promise<void>;
  updateQueueStatus(id: string, status: SyncOperation['status'], error?: string): Promise<void>;

  // Metadata
  getLastSync(): Promise<number>;
  setLastSync(timestamp: number): Promise<void>;
  getClientId(): Promise<string>;

  // Batch operations
  batchInsert?(table: string, records: any[]): Promise<any[]>;
  batchDelete?(table: string, ids: string[]): Promise<void>;

  // Clear all data (for logout/reset)
  clear?(): Promise<void>;
}

// Local Adapter Interface (Enhanced Client Adapter with initialization tracking)
export interface LocalAdapter<TDB = any> extends ClientAdapter<TDB> {
  // Check if DB has been initialized with data
  isInitialized(): Promise<boolean>;
  setInitialized(value: boolean): Promise<void>;
}

export type RealtimeStatus = 'connected' | 'connecting' | 'disconnected' | 'fallback';

export interface RealtimeClientConfig {
  /** Enable realtime sync (default: true) */
  enabled?: boolean;
  
  /** SSE endpoint URL (default: '/api/sync/realtime') */
  endpoint?: string;
  
  /** Tables to subscribe to (default: [] = all tables) */
  tables?: string[];
  
  /** Reconnect interval in ms (default: 1000) */
  reconnectInterval?: number;
  
  /** Maximum reconnect interval in ms (default: 30000) */
  maxReconnectInterval?: number;
  
  /** Max reconnect attempts before fallback to polling (default: 5) */
  maxReconnectAttempts?: number;
  
  /** Heartbeat timeout in ms (default: 45000) */
  heartbeatTimeout?: number;
  }