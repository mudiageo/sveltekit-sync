import type { RealtimeServerConfig } from '../realtime/types.js'

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
  realtime?: RealtimeServerConfig;
  // Global settings
  batchSize?: number;

  /**
   * Base URL path for HTTP sync endpoints (default: `'/api/sync'`).
   *
   * Enables zero-config server setup — the library's `handle` hook from
   * `createServerSync` will automatically serve:
   * - `POST  {endpoint}/push`      — process client operations
   * - `GET   {endpoint}/pull`      — return server changes
   * - `GET   {endpoint}/realtime`  — SSE stream (requires `realtime` config)
   */
  endpoint?: string;

  /**
   * Authentication callback for `push` and `pull` HTTP endpoints.
   *
   * Falls back to `realtime.authenticate` when not set.
   * If neither is configured, endpoints run in anonymous mode
   * (userId is treated as an empty string).
   *
   * Return `null` to reject the request with HTTP 401.
   */
  authenticate?: (request: Request) => Promise<{ userId: string } | null>;
}
