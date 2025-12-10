export interface SyncTableConfig<T = any> {
  table: string;
  // Which columns to sync (omit sensitive data)
  columns?: string[];
  // Row-level security: filter what users can access
  where?: (userId: string) => any;
  // Transform data before sending to client
  transform?: (row: T) => Partial<T>;
  // Conflict resolution strategy
  conflictResolution?: 'client-wins' | 'server-wins' | 'last-write-wins';
}

export interface SyncConfig {
  tables: Record<string, SyncTableConfig>;
  // Global settings
  batchSize?: number;
  realtime?: {
    enabled: boolean;
    hearbeatInterval: number;
    maxConnectionPerUser: number;
  }
}
