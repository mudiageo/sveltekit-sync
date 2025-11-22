import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';
import { syncSchema } from './sync-schema';
import { syncLog, clientState } from '$lib/server/db/schema';
import { eq, and, gt, sql, inArray } from 'drizzle-orm';
import type { SyncOperation, SyncResult, Conflict } from '$pkg/sync-engine';

export class ServerSyncEngine {
  private config = syncSchema;
  
  constructor (config) {
    this.config = config;
  }

  // ============================================================================
  // PUSH: Apply client changes to server
  // ============================================================================

  async push(operations: SyncOperation[], userId: string): Promise<SyncResult> {
    const synced: string[] = [];
    const conflicts: Conflict[] = [];
    const errors: Array<{ id: string; error: string }> = [];

    // Process operations in transaction
    await db.transaction(async (tx) => {
      for (const op of operations) {
        try {
          const tableConfig = this.config.tables[op.table];
          if (!tableConfig) {
            errors.push({ id: op.id, error: `Table ${op.table} not configured for sync` });
            continue;
          }

          // Verify user has access to this record
          if (!await this.checkAccess(op, userId, tx)) {
            errors.push({ id: op.id, error: 'Access denied' });
            continue;
          }

          const table = schema[tableConfig.table];

          switch (op.operation) {
            case 'insert': {
              // Check if record already exists
              const existing = await tx
                .select()
                .from(table)
                .where(eq(table.id, op.data.id))
                .limit(1);

              if (existing.length > 0) {
                // Conflict: record exists
                conflicts.push({
                  operation: op,
                  serverData: existing[0],
                  clientData: op.data
                });
                continue;
              }

              // Insert new record
              await tx.insert(table).values({
                ...op.data,
                userId,
                _clientId: op.clientId,
                _version: 1,
                _updatedAt: new Date(op.timestamp)
              });

              // Log the operation
              await this.logOperation(tx, op, userId);
              synced.push(op.id);
              break;
            }

            case 'update': {
              // Get current version from server
              const current = await tx
                .select()
                .from(table)
                .where(eq(table.id, op.data.id))
                .limit(1);

              if (current.length === 0) {
                errors.push({ id: op.id, error: 'Record not found' });
                continue;
              }

              // Check for version conflict
              if (current[0]._version !== op.version - 1) {
                // Conflict: versions don't match
                const resolution = await this.resolveConflict(
                  tableConfig,
                  op,
                  current[0]
                );

                if (resolution === 'conflict') {
                  conflicts.push({
                    operation: op,
                    serverData: current[0],
                    clientData: op.data
                  });
                  continue;
                }
                // If resolved automatically, continue with update
              }

              // Update record
              await tx
                .update(table)
                .set({
                  ...op.data,
                  _version: current[0]._version + 1,
                  _updatedAt: new Date(op.timestamp),
                  _clientId: op.clientId
                })
                .where(eq(table.id, op.data.id));

              await this.logOperation(tx, op, userId);
              synced.push(op.id);
              break;
            }

            case 'delete': {
              // Soft delete - mark as deleted instead of removing
              await tx
                .update(table)
                .set({
                  _isDeleted: true,
                  _updatedAt: new Date(op.timestamp)
                })
                .where(eq(table.id, op.data.id));

              await this.logOperation(tx, op, userId);
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
      await this.updateClientState(tx, operations[0]?.clientId, userId);
    });

    return { success: true, synced, conflicts, errors };
  }

  // ============================================================================
  // PULL: Get changes since last sync
  // ============================================================================

  async pull(lastSync: number, clientId: string, userId: string): Promise<SyncOperation[]> {
    const operations: SyncOperation[] = [];
    const lastSyncDate = new Date(lastSync);

    // For each configured table, get changes
    for (const [tableName, tableConfig] of Object.entries(this.config.tables)) {
      try {
        const table = schema[tableConfig.table];

        // Build query with user's access filter
        let query = db
          .select()
          .from(table)
          .where(
            and(
              gt(table._updatedAt, lastSyncDate),
              // Don't send back changes from this client (already applied locally)
              sql`${table._clientId} != ${clientId} OR ${table._clientId} IS NULL`,
              // Apply row-level security
              tableConfig.where ? tableConfig.where(userId) : undefined
            )
          )
          .limit(this.config.batchSize || 100);

        const changes = await query;

        // Convert to sync operations
        for (const row of changes) {
          const data = tableConfig.transform ? tableConfig.transform(row) : row;
          
          operations.push({
            id: crypto.randomUUID(),
            table: tableName,
            operation: row._isDeleted ? 'delete' : 'update',
            data,
            timestamp: row._updatedAt.getTime(),
            clientId: row._clientId || 'server',
            version: row._version,
            status: 'synced'
          });
        }
      } catch (error) {
        console.error(`Error pulling changes from ${tableName}:`, error);
      }
    }

    // Sort by timestamp to maintain order
    operations.sort((a, b) => a.timestamp - b.timestamp);

    // Update last sync time
    await this.updateClientState(db, clientId, userId);

    return operations;
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private async checkAccess(
    op: SyncOperation,
    userId: string,
    tx: any
  ): Promise<boolean> {
    // Implement row-level security check
    const tableConfig = this.config.tables[op.table];
    if (!tableConfig.where) return true;

    const table = schema[tableConfig.table];
    const result = await tx
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.id, op.data.id),
          tableConfig.where(userId)
        )
      )
      .limit(1);

    return result.length > 0 || op.operation === 'insert';
  }

  private async resolveConflict(
    tableConfig: SyncTableConfig,
    clientOp: SyncOperation,
    serverData: any
  ): Promise<'conflict' | 'resolved'> {
    const strategy = tableConfig.conflictResolution || 'last-write-wins';

    switch (strategy) {
      case 'server-wins':
        return 'conflict'; // Return conflict to let client know server version wins
      
      case 'client-wins':
        return 'resolved'; // Allow client update to proceed
      
      case 'last-write-wins': {
        const serverTime = serverData._updatedAt.getTime();
        const clientTime = clientOp.timestamp;
        return clientTime > serverTime ? 'resolved' : 'conflict';
      }
      
      default:
        return 'conflict';
    }
  }

  private async logOperation(tx: any, op: SyncOperation, userId: string): Promise<void> {
    await tx.insert(syncLog).values({
      tableName: op.table,
      recordId: op.data.id,
      operation: op.operation,
      data: op.data,
      timestamp: new Date(op.timestamp),
      clientId: op.clientId,
      userId
    });
  }

  private async updateClientState(tx: any, clientId: string, userId: string): Promise<void> {
    await tx
      .insert(clientState)
      .values({
        clientId,
        userId,
        lastSync: new Date(),
        lastActive: new Date()
      })
      .onConflictDoUpdate({
        target: clientState.clientId,
        set: {
          lastSync: new Date(),
          lastActive: new Date()
        }
      });
  }

  // ============================================================================
  // REAL-TIME: Get changes in real-time using Postgres LISTEN/NOTIFY
  // ============================================================================

  async subscribeToChanges(
    tables: string[],
    userId: string,
    callback: (ops: SyncOperation[]) => void
  ): Promise<() => void> {
    // Implement using Postgres LISTEN/NOTIFY or WebSocket
    // This is a simplified example
    const channel = `sync_${userId}`;
    
    // Set up trigger in Postgres to notify on changes
    // CREATE OR REPLACE FUNCTION notify_sync_change()
    // RETURNS trigger AS $$
    // BEGIN
    //   PERFORM pg_notify('sync_channel', json_build_object(
    //     'table', TG_TABLE_NAME,
    //     'operation', TG_OP,
    //     'data', row_to_json(NEW)
    //   )::text);
    //   RETURN NEW;
    // END;
    // $$ LANGUAGE plpgsql;

    // Cleanup function
    return () => {
      // Unsubscribe
    };
  }
}
