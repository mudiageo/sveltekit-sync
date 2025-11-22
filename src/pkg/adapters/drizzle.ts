import { eq, and, gt, sql, inArray } from 'drizzle-orm';
import { pgTable, text, boolean, timestamp, integer, jsonb, uuid } from 'drizzle-orm/pg-core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ServerAdapter, SyncOperation, QueryFilter } from '../types.ts';

export interface DrizzleAdapterConfig {
  db: PostgresJsDatabase;
  schema: Record<string, any>;
  // Row-level security
  getFilter?: (table: string, userId: string) => any;
  // Transform data before sending to client
  transformOut?: (table: string, data: any) => any;
  // Transform data before saving to DB
  transformIn?: (table: string, data: any) => any;
}

export class DrizzleServerAdapter implements ServerAdapter<PostgresJsDatabase> {
  constructor(private config: DrizzleAdapterConfig) {}

  async insert(table: string, data: any): Promise<any> {
    const schema = this.config.schema[table];
    if (!schema) throw new Error(`Table ${table} not found in schema`);
    
    const transformed = this.config.transformIn?.(table, data) ?? data;
    const [result] = await this.config.db
      .insert(schema)
      .values(transformed)
      .returning();
    
    return this.config.transformOut?.(table, result) ?? result;
  }

  async update(table: string, id: string, data: any, expectedVersion: number): Promise<any> {
    const schema = this.config.schema[table];
    const transformed = this.config.transformIn?.(table, data) ?? data;
    
    // Optimistic locking - only update if version matches
    const [result] = await this.config.db
      .update(schema)
      .set({
        ...transformed,
        _version: sql`${schema._version} + 1`,
        _updatedAt: new Date()
      })
      .where(
        and(
          eq(schema.id, id),
          eq(schema._version, expectedVersion)
        )
      )
      .returning();
    
    if (!result) {
      throw new Error('Version conflict or record not found');
    }
    
    return this.config.transformOut?.(table, result) ?? result;
  }

  async delete(table: string, id: string): Promise<void> {
    const schema = this.config.schema[table];
    
    // Soft delete
    await this.config.db
      .update(schema)
      .set({
        _isDeleted: true,
        _updatedAt: new Date()
      })
      .where(eq(schema.id, id));
  }

  async findOne(table: string, id: string): Promise<any | null> {
    const schema = this.config.schema[table];
    const [result] = await this.config.db
      .select()
      .from(schema)
      .where(eq(schema.id, id))
      .limit(1);
    
    return result ? (this.config.transformOut?.(table, result) ?? result) : null;
  }

  async find(table: string, filter?: QueryFilter): Promise<any[]> {
    const schema = this.config.schema[table];
    let query = this.config.db.select().from(schema);
    
    if (filter?.where) {
      const conditions = Object.entries(filter.where).map(([key, value]) =>
        eq(schema[key], value)
      );
      query = query.where(and(...conditions));
    }
    
    if (filter?.limit) {
      query = query.limit(filter.limit);
    }
    
    const results = await query;
    return results.map(r => this.config.transformOut?.(table, r) ?? r);
  }

  async getChangesSince(
    table: string,
    timestamp: number,
    userId?: string,
    excludeClientId?: string
  ): Promise<SyncOperation[]> {
    const schema = this.config.schema[table];
    const timestampDate = new Date(timestamp);
    
    const conditions = [
      gt(schema._updatedAt, timestampDate)
    ];
    
    if (excludeClientId) {
      conditions.push(sql`${schema._clientId} != ${excludeClientId} OR ${schema._clientId} IS NULL`);
    }
    
    if (userId && this.config.getFilter) {
      const userFilter = this.config.getFilter(table, userId);
      conditions.push(userFilter);
    }
    
    const changes = await this.config.db
      .select()
      .from(schema)
      .where(and(...conditions))
      .orderBy(schema._updatedAt);
    
    return changes.map(row => ({
      id: crypto.randomUUID(),
      table,
      operation: row._isDeleted ? 'delete' : 'update',
      data: this.config.transformOut?.(table, row) ?? row,
      timestamp: row._updatedAt.getTime(),
      clientId: row._clientId || 'server',
      version: row._version,
      status: 'synced',
      userId: row.userId
    }));
  }

  async applyOperation(op: SyncOperation, userId?: string): Promise<void> {
    // Add userId to data if provided
    const data = userId ? { ...op.data, userId } : op.data;
    
    switch (op.operation) {
      case 'insert':
        await this.insert(op.table, {
          ...data,
          _clientId: op.clientId,
          _version: 1,
          _updatedAt: new Date(op.timestamp)
        });
        break;
      
      case 'update':
        await this.update(op.table, op.data.id, data, op.version - 1);
        break;
      
      case 'delete':
        await this.delete(op.table, op.data.id);
        break;
    }
  }

  async checkConflict(table: string, id: string, expectedVersion: number): Promise<boolean> {
    const schema = this.config.schema[table];
    const [current] = await this.config.db
      .select({ version: schema._version })
      .from(schema)
      .where(eq(schema.id, id))
      .limit(1);
    
    return current ? current.version !== expectedVersion : false;
  }

  async batchInsert(table: string, records: any[]): Promise<any[]> {
    const schema = this.config.schema[table];
    const transformed = records.map(r => this.config.transformIn?.(table, r) ?? r);
    
    const results = await this.config.db
      .insert(schema)
      .values(transformed)
      .returning();
    
    return results.map(r => this.config.transformOut?.(table, r) ?? r);
  }

  async batchUpdate(table: string, updates: Array<{ id: string; data: any }>): Promise<any[]> {
    const results = [];
    for (const { id, data } of updates) {
      const result = await this.update(table, id, data, data._version - 1);
      results.push(result);
    }
    return results;
  }

  async transaction<T>(fn: (adapter: ServerAdapter) => Promise<T>): Promise<T> {
    return this.config.db.transaction(async (tx) => {
      const txAdapter = new DrizzleServerAdapter({
        ...this.config,
        db: tx as any
      });
      return fn(txAdapter);
    });
  }
}


// All synced tables must include these columns
export const syncMetadata = {
  _version: integer('_version').notNull().default(1),
  _updatedAt: timestamp('_updated_at').notNull().defaultNow(),
  _clientId: text('_client_id'),
  _isDeleted: boolean('_is_deleted').default(false)
};

// Sync log table - tracks all changes for efficient delta sync
export const syncLog = pgTable('sync_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  operation: text('operation').notNull(), // 'insert', 'update', 'delete'
  data: jsonb('data'),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  clientId: text('client_id'),
  userId: text('user_id').notNull()
});

// Client state table - track last sync for each client
export const clientState = pgTable('client_state', {
  clientId: text('client_id').primaryKey(),
  userId: text('user_id').notNull(),
  lastSync: timestamp('last_sync').notNull().defaultNow(),
  lastActive: timestamp('last_active').notNull().defaultNow()
});

export const schema = {
  syncMetadata,
  syncLog,
  clientState
}
