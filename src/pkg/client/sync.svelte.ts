import type { Conflict, SyncConfig, SyncOperation, SyncStatus } from '../types.js';
import { RealtimeClient } from '../realtime/client.js'
import { type RealtimeStatus as RTStatus } from '../realtime/types.js'
import { QueryBuilder } from './query/builder.js'
import { createFieldsProxy, type FieldsProxy } from './query/field-proxy.js'


// MULTI-TAB SYNC COORDINATOR
class MultiTabCoordinator {
  private channel: BroadcastChannel;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  constructor(channelName: string) {
    this.channel = new BroadcastChannel(channelName);
    this.channel.onmessage = (event) => {
      const { type, payload } = event.data;
      const handlers = this.listeners.get(type);
      if (handlers) {
        handlers.forEach(handler => handler(payload));
      }
    };
  }

  broadcast(type: string, payload: any): void {
    this.channel.postMessage({ type, payload });
  }

  on(type: string, handler: (data: any) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.listeners.get(type);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }

  close(): void {
    this.channel.close();
  }
}

// SYNC ENGINE CORE
export class SyncEngine<TLocalDB = any, TRemoteDB = any> {
  private config: Required<SyncConfig<TLocalDB, TRemoteDB>>;
  private syncTimer: number | null = null;
  private isSyncing = $state(false);
  private syncStatus = $state<SyncStatus>('idle');
  private pendingOps = $state<SyncOperation[]>([]);
  private conflicts = $state<Conflict[]>([]);
  private lastSync = $state<number>(0);
  private clientId = $state<string>('');
  private isInitialized = $state(false);
  private multiTab: MultiTabCoordinator;
  private collections: Map<string, CollectionStore<any>> = new Map();
  private realtimeClient: RealtimeClient | null = null;
  private realtimeStatus: RTStatus = $state('disconnected');
  
  constructor(config: SyncConfig<TLocalDB, TRemoteDB>) {
    this.config = {
      syncInterval: 30000,
      batchSize: 50,
      conflictResolution: 'last-write-wins',
      retryAttempts: 3,
      retryDelay: 1000,
      onSync: () => { },
      onConflict: () => { },
      onError: () => { },
      ...config
    };

    this.multiTab = new MultiTabCoordinator('sveltekit-sync');
    this.setupMultiTabSync();
    
    // Initialise realtime
    if (typeof window !== 'undefined'){
      const realtimeConfig = {
        enabled: true,
        endpoint: '/api/sync/realtime',
        tables: [],
        reconnectInterval: 1000,
        maxReconnectInterval: 30000,
        maxReconnectAttempts: 5,
        heartbeatTimeout: 45000,
        ...config.realtime,
        onStatusChange: (status: RTStatus) => {
          this.realtimeStatus = status;
          this.handleRealtimeStatusChange(status);
        },
        onOperations: (operations: SyncOperation[]) => {
          this.handleRealtimeOperations(operations)
        },
        onError: (error: Error) => {
          console.error('Realtime error', error);
          this.config.onError(error)
        }
      }
      
      this.realtimeClient = new RealtimeClient(realtimeConfig)
    }
  }
  

  private setupMultiTabSync(): void {
    // Listen for changes from other tabs
    this.multiTab.on('data-changed', async ({ table, operation, data }) => {
      const collection = this.collections.get(table);
      if (collection) {
        await collection.reload();
      }
    });

    // Listen for sync events from other tabs
    this.multiTab.on('sync-complete', async () => {
      // Reload all collections when another tab syncs
      for (const collection of this.collections.values()) {
        await collection.reload();
      }
    });
  }
  
  private handleRealtimeStatusChange(status: RTStatus): void {
    if(status === 'fallback') {
      // SSE failed, ensure polling is active
      if(this.config.syncInterval > 0 && !this.syncTimer) this.startAutoSync();
      
    } else if(status === 'connected'){
      // TODO SSE connected, we can optionally reduce polling frequency
      // but keep it as fallback
    }
  }
  private async handleRealtimeOperations(operations: SyncOperation[]): Promise<void> {
    // TODO create apply
    for (const op of operations) {
      if (op.clientId === this.clientId) continue;
        
      try {
        switch (op.operation) {
          case 'insert':
            await this.config.local.adapter.insert(op.table, op.data);
            break;
          case 'update':
            await this.config.local.adapter.update(op.table, op.data.id, op.data);
            break;
          case 'delete':
            await this.config.local.adapter.delete(op.table, op.data.id);
            break;
        }
        
        //Update collection
        const collection = this.collections.get(op.table);
        
        if (collection) await collection.reload();
      } catch (error) {
        console.error('Failed to apply realtime operation:', error);
      }
    }
    
    
    //update lastSync timestamp
    if (operations.length > 0) {
      const maxTimestamp = Math.max(...operations.map((op: SyncOperation) => op.timestamp));
      if (maxTimestamp > this.lastSync) {
        await this.config.local.adapter.setLastSync(maxTimestamp);
        this.lastSync = maxTimestamp;
      }
    }
    
    this.multiTab.broadcast('sync-complete', {})
  } 

  async init(): Promise<void> {
    if (this.isInitialized) {
      console.warn('SyncEngine already initialized');
      return;
    }

    try {
      this.clientId = await this.config.local.adapter.getClientId();
      this.lastSync = await this.config.local.adapter.getLastSync();
      this.pendingOps = await this.config.local.adapter.getQueue();

      // Check if this is the first time initializing
      const hasInitialData = await this.config.local.adapter.isInitialized();

      if (!hasInitialData) {
        // First initialization - pull initial data
        await this.pullInitialData();
        await this.config.local.adapter.setInitialized(true);
      }

      this.isInitialized = true;

      if (this.config.syncInterval > 0) {
        this.startAutoSync();
      }
      
      // Start realtime connection
      if (this.realtimeClient) {
        this.realtimeClient.init(this.clientId);
      }
      
    } catch (error) {
      console.error('SyncEngine initialization failed:', error);
      throw new Error(`Failed to initialize sync engine: ${error}`);
    }
  }

  private async pullInitialData(): Promise<void> {
    try {
      // Pull all data from server (lastSync = 0 means "get everything")
      const operations = await this.config.remote.pull(0, this.clientId);

      // Apply operations to local DB
      for (const op of operations) {
        try {
          switch (op.operation) {
            case 'insert':
            case 'update':
              await this.config.local.adapter.update(op.table, op.data.id, op.data);
              break;
            case 'delete':
              await this.config.local.adapter.delete(op.table, op.data.id);
              break;
          }
        } catch (error) {
          console.error('Failed to apply initial operation:', error);
        }
      }

      // Update last sync timestamp
      if (operations.length > 0) {
        const maxTimestamp = Math.max(...operations.map((op: SyncOperation) => op.timestamp));
        await this.config.local.adapter.setLastSync(maxTimestamp);
        this.lastSync = maxTimestamp;
      }
    } catch (error) {
      console.error('Failed to pull initial data:', error);
      throw error;
    }
  }

  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error(
        'SyncEngine not initialized. Call syncEngine.init() before using collections.'
      );
    }
  }

  async create(table: string, data: any): Promise<any> {
    this.ensureInitialized();

    const id = data.id || crypto.randomUUID();
    const record = { ...data, id, _version: 1, _updatedAt: new Date() };

    await this.config.local.adapter.insert(table, record);

    const operation: SyncOperation = {
      id: crypto.randomUUID(),
      table,
      operation: 'insert',
      data: record,
      timestamp: new Date(),
      clientId: this.clientId,
      version: 1,
      status: 'pending'
    };

    await this.config.local.adapter.addToQueue(operation);
    this.pendingOps.push(operation);

    // Notify other tabs
    this.multiTab.broadcast('data-changed', { table, operation: 'insert', data: record });

    if (this.config.syncInterval === 0) {
      this.sync();
    }

    return record;
  }

  async update(table: string, id: string, data: any): Promise<any> {
    this.ensureInitialized();

    const current = await this.config.local.adapter.findOne(table, id);
    const version = (current?._version || 0) + 1;
    const record = { ...data, id, _version: version, _updatedAt: new Date() };

    await this.config.local.adapter.update(table, id, record);

    const operation: SyncOperation = {
      id: crypto.randomUUID(),
      table,
      operation: 'update',
      data: record,
      timestamp: new Date(),
      clientId: this.clientId,
      version,
      status: 'pending'
    };

    await this.config.local.adapter.addToQueue(operation);
    this.pendingOps.push(operation);

    // Notify other tabs
    this.multiTab.broadcast('data-changed', { table, operation: 'update', data: record });

    if (this.config.syncInterval === 0) {
      this.sync();
    }

    return record;
  }

  async delete(table: string, id: string): Promise<void> {
    this.ensureInitialized();

    await this.config.local.adapter.delete(table, id);

    const operation: SyncOperation = {
      id: crypto.randomUUID(),
      table,
      operation: 'delete',
      data: { id },
      timestamp: new Date(),
      clientId: this.clientId,
      version: 1,
      status: 'pending'
    };

    await this.config.local.adapter.addToQueue(operation);
    this.pendingOps.push(operation);

    // Notify other tabs
    this.multiTab.broadcast('data-changed', { table, operation: 'delete', data: { id } });

    if (this.config.syncInterval === 0) {
      this.sync();
    }
  }

  async find(table: string, query?: any): Promise<any[]> {
    this.ensureInitialized();
    return this.config.local.adapter.find(table, query);
  }

  async findOne(table: string, id: string): Promise<any | null> {
    this.ensureInitialized();
    return this.config.local.adapter.findOne(table, id);
  }

  async sync(force = false): Promise<void> {
    if (this.isSyncing && !force) return;

    this.isSyncing = true;
    this.syncStatus = 'syncing';
    this.config.onSync('syncing');

    try {
      await this.push();
      await this.pull();

      if (this.conflicts.length > 0) {
        await this.resolveConflicts();
      }

      // Notify other tabs that sync completed
      this.multiTab.broadcast('sync-complete', {});

      this.syncStatus = 'idle';
      this.config.onSync('idle');
    } catch (error) {
      this.syncStatus = 'error';
      this.config.onSync('error');
      this.config.onError(error as Error);
      throw error;
    } finally {
      this.isSyncing = false;
    }
  }

  private async push(): Promise<void> {
    const queue = await this.config.local.adapter.getQueue();
    const pending = queue.filter((op: SyncOperation) => op.status === 'pending');

    if (pending.length === 0) return;

    for (let i = 0; i < pending.length; i += this.config.batchSize) {
      const batch = pending.slice(i, i + this.config.batchSize);

      try {
        const result = await this.config.remote.push(batch);

        if (result.synced.length > 0) {
          await this.config.local.adapter.removeFromQueue(result.synced);
          this.pendingOps = this.pendingOps.filter((op: SyncOperation) => !result.synced.includes(op.id));
        }

        if (result.conflicts.length > 0) {
          this.conflicts.push(...result.conflicts);
          this.syncStatus = 'conflict';
          this.config.onSync('conflict');
          result.conflicts.forEach((c: Conflict) => this.config.onConflict(c));
        }

        for (const error of result.errors) {
          await this.config.local.adapter.updateQueueStatus(error.id, 'error', error.error);
        }
      } catch (error) {
        console.error('Push error:', error);
        throw error;
      }
    }
  }

  private async pull(): Promise<void> {
    const lastSync = await this.config.local.adapter.getLastSync();
    const operations = await this.config.remote.pull(lastSync, this.clientId);

    for (const op of operations) {
      if (op.clientId === this.clientId) continue;

      try {
        switch (op.operation) {
          case 'insert':
            await this.config.local.adapter.insert(op.table, op.data);
            break;
          case 'update':
            await this.config.local.adapter.update(op.table, op.data.id, op.data);
            break;
          case 'delete':
            await this.config.local.adapter.delete(op.table, op.data.id);
            break;
        }
      } catch (error) {
        console.error('Failed to apply remote operation:', error);
      }
    }

    const newLastSync = Math.max(...operations.map((op: SyncOperation) => op.timestamp), lastSync);
    await this.config.local.adapter.setLastSync(newLastSync);
    this.lastSync = newLastSync;
  }

  private async resolveConflicts(): Promise<void> {
    for (const conflict of this.conflicts) {
      let resolved: SyncOperation | null = null;

      switch (this.config.conflictResolution) {
        case 'client-wins':
          resolved = conflict.operation;
          break;

        case 'server-wins':
          resolved = {
            ...conflict.operation,
            data: conflict.serverData
          };
          break;

        case 'last-write-wins':
          const serverTime = conflict.serverData._updatedAt || 0;
          const clientTime = conflict.clientData._updatedAt || 0;
          resolved = serverTime > clientTime
            ? { ...conflict.operation, data: conflict.serverData }
            : conflict.operation;
          break;

        case 'manual':
          if (this.config.remote.resolve) {
            resolved = await this.config.remote.resolve(conflict);
          }
          break;
      }

      if (resolved) {
        await this.config.local.adapter.update(
          resolved.table,
          resolved.data.id,
          resolved.data
        );
        await this.config.local.adapter.removeFromQueue([conflict.operation.id]);
      }
    }

    this.conflicts = [];
  }

  private startAutoSync(): void {
    this.stopAutoSync();
    this.syncTimer = window.setInterval(() => {
      this.sync();
    }, this.config.syncInterval);
  }

  private stopAutoSync(): void {
    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  get state() {
    return {
      isSyncing: this.isSyncing,
      status: this.syncStatus,
      pendingOps: this.pendingOps,
      conflicts: this.conflicts,
      lastSync: this.lastSync,
      hasPendingChanges: this.pendingOps.length > 0,
      realtimeStatus: this.realtimeStatus,
      isRealtimeConnected: this.realtimeStatus === 'connected',
    };
  }

  collection<T extends Record<string, any>>(tableName: string) {
    if (!this.collections.has(tableName)) {
      const collection = new CollectionStore<T>(this, tableName);
      this.collections.set(tableName, collection);
    }
    return this.collections.get(tableName)! as CollectionStore<T>;
  }

  async forcePush(): Promise<void> {
    await this.push();
  }

  async forcePull(): Promise<void> {
    await this.pull();
  }
  
  get realtime(): RealtimeClient | null {
    return this.realtimeClient;
  }
  
  enableRealtime(): void {
    this.realtimeClient?.enable();
  }

  disableRealtime(): void {
    this.realtimeClient?.disable();
  }
  
  /** Force realtime reconnection */
  reconnectRealtime(): void {
    this.realtimeClient?.reconnect();
  }

  destroy(): void {
    this.stopAutoSync();
    this.multiTab.close();
    this.realtimeClient?.destroy();
  }
}

// COLLECTION STORE
export class CollectionStore<T extends Record<string, any>> {
  private engine: SyncEngine;
  private tableName: string;

  data = $state<T[]>([]);
  isLoading = $state(false);
  error = $state<Error | null>(null);
  private _initialized = $state(false);
  
  private _fields: FieldsProxy<T>;
  
  
  constructor(engine: SyncEngine, tableName: string) {
    this.engine = engine;
    this.tableName = tableName;
    this._fields = createFieldsProxy<T>();
  }
  
  /**
   * Get typed field references for building queries
   * Usage: todosStore.$.completed.eq(false)
   */
  get $(): FieldsProxy<T> {
    return this._fields;
  }
  
  /**
   * Alias for $ - get typed field references
   * Usage: todosStore.fields.completed.eq(false)
   */
  get fields(): FieldsProxy<T> {
    return this._fields;
  }

  /**
   * Create a new query builder for this collection
   * Supports multiple query syntaxes
   * 1. Callback (full type inference):
   *    .where(todo => todo.completed === false)
   * 2. Object syntax (simple equality): 
   *    .where({ completed: false })
   * 3. Object with operators:
   *    .where({ priority: gte(5) })
   * 4. Proxy callback:
   *    .where(f => f.completed.eq(false))
   * 5. Field condition:
   *    .where(fields.completed.eq(false))
   * @returns A new QueryBuilder instance
   */
  query(): QueryBuilder<T> {
    return new QueryBuilder<T>(this);
  }

  get count(): number {
    return this.data.length;
  }

  get isEmpty(): boolean {
    return this.data.length === 0;
  }

  async create(data: Omit<T, 'id'>): Promise<T> {
    try {
      this.error = null;
      const id = data.id || crypto.randomUUID()
      const tempRecord = { ...data, id };
      this.data.push(tempRecord);
      
      const record = await this.engine.create(this.tableName, tempRecord);

      const index = this.data.findIndex(item => item.id === id);
      if (index !== -1) this.data[index] = record;
      
      return record;
    } catch (error) {
      this.error = error as Error;
      throw error;
    }
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    try {
      this.error = null;
      const index = this.data.findIndex(item => item.id === id);
      if (index === -1) throw new Error(`Record with id ${id} not found`);
      
      const updatedRecord = { ...this.data[index], ...data };
      this.data[index] = updatedRecord; // Optimistic update
      
      const record = await this.engine.update(this.tableName, id, data);
      this.data[index] = record;
    
      return record;
    } catch (error) {
      this.error = error as Error;
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this.error = null;
      const index = this.data.findIndex(item => item.id === id);
      if (index === -1) throw new Error(`Record with id ${id} not found`);
      
      // Optimistic delete
      this.data.splice(index, 1);
      
      await this.engine.delete(this.tableName, id);
  
    } catch (error) {
      this.error = error as Error;
      throw error;
    }
  }
  

  async findOne(id: string): Promise<T | null> {
    try {
      this.error = null;
      return await this.engine.findOne(this.tableName, id);
    } catch (error) {
      this.error = error as Error;
      throw error;
    }
  }

  async load(query?: any): Promise<void> {
    try {
      this.isLoading = true;
      this.error = null;
      this.data = await this.engine.find(this.tableName, query);
      this._initialized = true;
    } catch (error) {
      this.error = error as Error;
      console.error(`Error loading ${this.tableName}:`, error);
      throw error;
    } finally {
      this.isLoading = false;
    }
  }

  async reload(): Promise<void> {
    await this.load();
  }

  find(predicate: (item: T) => boolean): T | undefined {
    return this.data.find(predicate);
  }

  filter(predicate: (item: T) => boolean): T[] {
    return this.data.filter(predicate);
  }

  map<U>(mapper: (item: T) => U): U[] {
    return this.data.map(mapper);
  }

  sort(compareFn: (a: T, b: T) => number): T[] {
    return [...this.data].sort(compareFn);
  }

  async createMany(items: Omit<T, 'id'>[]): Promise<T[]> {
    const results: T[] = [];
    for (const item of items) {
      results.push(await this.create(item));
    }
    return results;
  }

  async deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete(id);
    }
  }

  async updateMany(updates: { id: string; data: Partial<T> }[]): Promise<T[]> {
    const results: T[] = [];
    for (const { id, data } of updates) {
      results.push(await this.update(id, data));
    }
    return results;
  }

  clear(): void {
    this.data = [];
  }
}
