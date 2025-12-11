import type { SyncOperation, SyncResult, Conflict, ServerAdapter } from '../types.js';
import type { SyncConfig, SyncTableConfig } from './types.js';
import { RealtimeServer } from '../realtime/server.js';
import type { RequestEvent } from '@sveltejs/kit';

export class ServerSyncEngine<TAdapter extends ServerAdapter = ServerAdapter> {
  private realtimeServer: RealtimeServer | null = null;
  
  constructor(
    private adapter: TAdapter,
    private config: SyncConfig,
  ) { 
    if (config.realtime) this.realtimeServer = new RealtimeServer(config.realtime);
  }
  
  
  // PUSH: Apply client changes to server
  async push(operations: SyncOperation[], userId: string): Promise<SyncResult> {
    const synced: string[] = [];
    const conflicts: Conflict[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    // Use transaction if available, otherwise process sequentially
    const processBatch = async (adapter: TAdapter) => {
      for (const op of operations) {
        try {
          const tableConfig = this.config.tables[op.table];
          if (!tableConfig) {
            errors.push({ id: op.id, error: `Table ${op.table} not configured for sync` });
            continue;
          }

          // Verify user has access to this record
          if (!(await this.checkAccess(op, userId, adapter))) {
            errors.push({ id: op.id, error: 'Access denied' });
            continue;
          }

          switch (op.operation) {
            case 'insert': {
              // Check if record already exists
              const existing = await adapter.findOne(op.table, op.data.id);

              if (existing) {
                conflicts.push({
                  operation: op,
                  serverData: existing,
                  clientData: op.data
                });
                continue;
              }

              // Insert new record
              await adapter.insert(op.table, {
                ...op.data,
                userId,
                _clientId: op.clientId,
                _version: 1,
                _updatedAt: new Date(op.timestamp)
              });

              await adapter.logSyncOperation(op, userId);
              synced.push(op.id);
              break;
            }

            case 'update': {
              const current = await adapter.findOne(op.table, op.data.id);

              if (!current) {
                errors.push({ id: op.id, error: 'Record not found' });
                continue;
              }

              // Check for version conflict
              if (current._version !== op.version - 1) {
                const resolution = await this.resolveConflict(
                  tableConfig,
                  op,
                  current
                );

                if (resolution === 'conflict') {
                  conflicts.push({
                    operation: op,
                    serverData: current,
                    clientData: op.data
                  });
                  continue;
                }
              }

              // Update record
              await adapter.update(op.table, op.data.id, {
                ...op.data,
                _clientId: op.clientId,
                _updatedAt: new Date(op.timestamp)
              }, current._version);

              await adapter.logSyncOperation(op, userId);
              synced.push(op.id);
              break;
            }

            case 'delete': {
              // Soft delete
              const current = await adapter.findOne(op.table, op.data.id);
              if (current) {
                await adapter.update(op.table, op.data.id, {
                  _isDeleted: true,
                  _updatedAt: new Date(op.timestamp)
                }, current._version);
              }

              await adapter.logSyncOperation(op, userId);
              synced.push(op.id);
              break;
            }
          }
        } catch (error) {
          console.error('Error processing operation:', error);
          errors.push({
            id: op.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Update client state
      if (operations.length > 0) {
        await adapter.updateClientState(operations[0].clientId, userId);
      }
    };

    // Use transaction if supported
    if (this.adapter.transaction) {
      await this.adapter.transaction(processBatch);
    } else {
      await processBatch(this.adapter);
    }

    // Broadcast to connected realtime clients
    if(this.realtimeServer && synced.length > 0) {
      const syncedOps = operations.filter(op => synced.includes(op.id));
      this.realtimeServer.broadcast(syncedOps, operations?.[0].clientId)
    }
    return { success: true, synced, conflicts, errors };
  }

  // PULL: Get changes since last sync
  async pull(lastSync: number, clientId: string, userId: string): Promise<SyncOperation[]> {
    const operations: SyncOperation[] = [];

    // For each configured table, get changes
    for (const [tableName, tableConfig] of Object.entries(this.config.tables)) {
      try {
        const changes = await this.adapter.getChangesSince(
          tableConfig.table,
          lastSync,
          userId,
          clientId
        );

        // Apply transformations
        for (const change of changes) {
          const data = tableConfig.transform
            ? tableConfig.transform(change.data)
            : change.data;

          operations.push({
            ...change,
            table: tableName,
            data
          });
        }
      } catch (error) {
        console.error(`Error pulling changes from ${tableName}:`, error);
      }
    }

    // Sort by timestamp to maintain order
    operations.sort((a, b) => a.timestamp - b.timestamp);

    // Update last sync time
    await this.adapter.updateClientState(clientId, userId);

    return operations;
  }

  // HELPER METHODS
  private async checkAccess(
    op: SyncOperation,
    userId: string,
    adapter: TAdapter
  ): Promise<boolean> {
    const tableConfig = this.config.tables[op.table];
    if (!tableConfig.where) return true;

    // For inserts, allow if user is creating their own record
    if (op.operation === 'insert') {
      if (op.userId || op.data.userId) return op.userId === userId || op.data.userId === userId;
      return true;
    }

    // For updates/deletes, check if record exists and belongs to user
    const record = await adapter.findOne(op.table, op.data.id);
    return record && record.userId === userId;
  }

  private async resolveConflict(
    tableConfig: SyncTableConfig,
    clientOp: SyncOperation,
    serverData: any
  ): Promise<'conflict' | 'resolved'> {
    const strategy = tableConfig.conflictResolution || 'last-write-wins';

    switch (strategy) {
      case 'server-wins':
        return 'conflict';

      case 'client-wins':
        return 'resolved';

      case 'last-write-wins': {
        const serverTime = serverData._updatedAt?.getTime() || 0;
        const clientTime = clientOp.timestamp;
        return clientTime > serverTime ? 'resolved' : 'conflict';
      }

      default:
        return 'conflict';
    }
  }
  
  createRealtimeHandlers() {
    const realtimeConfig = this.config.realtime;
    const realtimeServer = this.realtimeServer;
    
    async function GET(event: RequestEvent) {
      const { request, url } = event;
      
      // Authenticate the request
      const user = await realtimeConfig.authenticate(request);
      if (!user) return new Response('Unauthorised', { status: 401 });
      
      const userId = user?.userId;
      const clientId = url.searchParams.get('clientId') || user.clientId;
      if (!clientId) return new Response('Missing clientId', { status: 400 })
      
      const tablesParam = url.searchParams.get('tables');
      const tables = tablesParam ? tablesParam.split(',').filter(Boolean) : [];
      
      // Unique connection id
      const connectionId = `${userId}-${clientId}-${Date.now()}`;
      
      return realtimeServer.createConnection(connectionId, userId, clientId, tables);
       
    }
    
    async function handle({ event, resolve }) {
      const path = realtimeConfig.path ?? '/api/sync/realtime';
      
      if(event.url.pathname === path && event.request.method === 'GET') {
        return  GET(event)
      }
      return resolve(event)
    }
    
    return { GET, handle };
  }

  // REAL-TIME SUPPORT
  async subscribeToChanges(
    tables: string[],
    userId: string,
    callback: (ops: SyncOperation[]) => void
  ): Promise<() => void> {
    if (!this.adapter.subscribe) {
      throw new Error('Real-time sync not supported by this adapter');
    }

    return this.adapter.subscribe(tables, userId, callback);
  }
}


/** 
 * Create server sync engine with realtime handlers
*/
export function createServerSync({ adapter, config }: { adapter: ServerAdapter, config: SyncConfig }) {
  
  const sync = new ServerSyncEngine(adapter, config);
  
  const { GET, handle } = sync.createRealtimeHandlers();
  
  return {
    sync,
    syncEngine: sync,
    GET,
    handle,
  }
}