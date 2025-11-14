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

  constructor(config: SyncConfig<TLocalDB, TRemoteDB>) {
    this.config = {
      syncInterval: 30000, // 30 seconds default
      batchSize: 50,
      conflictResolution: 'last-write-wins',
      retryAttempts: 3,
      retryDelay: 1000,
      onSync: () => {},
      onConflict: () => {},
      onError: () => {},
      ...config
    };
  }

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  async init(): Promise<void> {

    if (this.isInitialized) {
      console.warn('SyncEngine already initialized');
      return;
    }

    try {
      // Load client ID and last sync timestamp
      this.clientId = await this.config.local.adapter.getClientId();
      this.lastSync = await this.config.local.adapter.getLastSync();
      
      // Load pending operations
      this.pendingOps = await this.config.local.adapter.getQueue();
      
      this.isInitialized = true;
      
      // Start auto-sync if configured
      if (this.config.syncInterval > 0) {
        this.startAutoSync();
      }
    } catch (error) {
      console.error('SyncEngine initialization failed:', error);
      throw new Error(`Failed to initialize sync engine: ${error}`);
    }
  }
private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error(
        'SyncEngine not initialized. Call syncEngine.init() before using collections. ' +
        'Make sure to initialize in your root layout or app initialization.'
      );
    }
  }
  

  // CRUD OPERATIONS WITH OPTIMISTIC UPDATES (Internal)

  async create(table: string, data: any): Promise<any> {
    const id = data.id || crypto.randomUUID();
    const record = { ...data, id, _version: 1, _updatedAt: new Date() };
    
    // Optimistic update - apply immediately to local DB
    await this.config.local.adapter.insert(table, record);
    
    // Queue sync operation
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
    
    // Trigger sync if not auto-syncing
    if (this.config.syncInterval === 0) {
      this.sync();
    }
    
    return record;
  }

  async update(table: string, id: string, data: any): Promise<any> {
    // Get current version
    const current = await this.config.local.adapter.findOne(table, id);
    const version = (current?._version || 0) + 1;
    const record = { ...data, id, _version: version, _updatedAt: new Date() };
    
    // Optimistic update
    await this.config.local.adapter.update(table, id, record);
    
    // Queue sync operation
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
    
    if (this.config.syncInterval === 0) {
      this.sync();
    }
    
    return record;
  }

  async delete(table: string, id: string): Promise<void> {
    // Optimistic delete
    await this.config.local.adapter.delete(table, id);
    
    // Queue sync operation
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
    
    if (this.config.syncInterval === 0) {
      this.sync();
    }
  }

  async find(table: string, query?: any): Promise<any[]> {
    return this.config.local.adapter.find(table, query);
  }

  async findOne(table: string, id: string): Promise<any | null> {
    return this.config.local.adapter.findOne(table, id);
  }

  // ============================================================================
  // SYNC OPERATIONS
  // ============================================================================

  async sync(force = false): Promise<void> {
    if (this.isSyncing && !force) return;
    
    this.isSyncing = true;
    this.syncStatus = 'syncing';
    this.config.onSync('syncing');
    
    try {
      // Step 1: Push local changes
      await this.push();
      
      console.log(this.conflicts)
      // Step 2: Pull remote changes
      await this.pull();
      console.log(this.conflicts)
      // Step 3: Handle conflicts
      if (this.conflicts.length > 0) {
        await this.resolveConflicts();
      }
      
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
    const pending = queue.filter(op => op.status === 'pending');
    
    if (pending.length === 0) return;
    
    // Process in batches
    for (let i = 0; i < pending.length; i += this.config.batchSize) {
      const batch = pending.slice(i, i + this.config.batchSize);
      
      try {
        const result = await this.config.remote.push(batch);
        
        // Remove successfully synced operations
        if (result.synced.length > 0) {
          await this.config.local.adapter.removeFromQueue(result.synced);
          this.pendingOps = this.pendingOps.filter(op => !result.synced.includes(op.id));
        }
        
        // Handle conflicts
        if (result.conflicts.length > 0) {
          this.conflicts.push(...result.conflicts);
          this.syncStatus = 'conflict';
          this.config.onSync('conflict');
          result.conflicts.forEach(c => this.config.onConflict(c));
        }
        
        // Update error statuses
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
    const operations = await this.config.remote.pull({lastSync, clientId: this.clientId});
    
    for (const op of operations) {
      // Skip operations from this client
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
    
    // Update last sync timestamp
    const newLastSync = Math.max(...operations.map(op => op.timestamp), lastSync);
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
        // Apply resolution
        await this.config.local.adapter.update(
          resolved.table,
          resolved.data.id,
          resolved.data
        );
        
        // Remove from conflicts and queue
        await this.config.local.adapter.removeFromQueue([conflict.operation.id]);
      }
    }
    
    this.conflicts = [];
  }

  // ============================================================================
  // AUTO-SYNC
  // ============================================================================

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

  // ============================================================================
  // STATE ACCESS (Svelte 5 Runes)
  // ============================================================================

  get state() {
    return {
      isSyncing: this.isSyncing,
      status: this.syncStatus,
      pendingOps: this.pendingOps,
      conflicts: this.conflicts,
      lastSync: this.lastSync,
      hasPendingChanges: this.pendingOps.length > 0
    };
  }

  // ============================================================================
  // COLLECTION STORE FACTORY
  // ============================================================================

  collection<T extends Record<string, any>>(tableName: string) {
    return new CollectionStore<T>(this, tableName);
  }

  // ============================================================================
  // MANUAL CONTROLS
  // ============================================================================

  async forcePush(): Promise<void> {
    await this.push();
  }

  async forcePull(): Promise<void> {
    await this.pull();
  }

  destroy(): void {
    this.stopAutoSync();
  }
}

// ERGONOMIC COLLECTION STORE

export class CollectionStore<T extends Record<string, any>> {
  private engine: SyncEngine;
  private tableName: string;
  private _data: T[] = $state([]);
  private _isLoading = $state(false);
  private _error = $state<Error | null>(null);
  private _initialized = $state(false);

  constructor(engine: SyncEngine, tableName: string) {
    this.engine = engine;
    this.tableName = tableName;
  }

  // ============================================================================
  // REACTIVE STATE (Svelte 5 Runes)
  // ============================================================================

  get current(): T[] {
    // Auto-load on first access
    // if (!this._initialized && !this._isLoading) {
    //   this.load();
    // }
    return this._data;
  }
  get data(): T[] {
    // Auto-load on first access
    // if (!this._initialized && !this._isLoading) {
    //   this.load();
    // }
    return this._data;
  }

  get isLoading(): boolean {
    return this._isLoading;
  }

  get error(): Error | null {
    return this._error;
  }

  get count(): number {
    return this._data.length;
  }

  get isEmpty(): boolean {
    return this._data.length === 0;
  }

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  async create(data: Omit<T, 'id'>): Promise<T> {
    try {
      this._error = null;
      const record = await this.engine.create(this.tableName, data);
      this._data.push(record);
      return record;
    } catch (error) {
      this._error = error as Error;
      throw error;
    }
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    try {
      this._error = null;
      const record = await this.engine.update(this.tableName, id, data);
      const index = this._data.findIndex(item => item.id === id);
      if (index !== -1) {
        this._data[index] = record;
      }
      return record;
    } catch (error) {
      this._error = error as Error;
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      this._error = null;
      await this.engine.delete(this.tableName, id);
      this._data = this._data.filter(item => item.id !== id);
    } catch (error) {
      this._error = error as Error;
      throw error;
    }
  }

  async findOne(id: string): Promise<T | null> {
    try {
      this._error = null;
      return await this.engine.findOne(this.tableName, id);
    } catch (error) {
      this._error = error as Error;
      throw error;
    }
  }

  // ============================================================================
  // LOADING & QUERYING
  // ============================================================================

  async load(query?: any): Promise<void> {
    try {
      this._isLoading = true;
      this._error = null;
      this._data = await this.engine.find(this.tableName, query);
    } catch (error) {
      this._error = error as Error;
      console.error(`Error loading ${this.tableName}:`, error);
      // throw error;
    } finally {
      this._isLoading = false;
    }
  }

  async reload(): Promise<void> {
    await this.load();
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  find(predicate: (item: T) => boolean): T | undefined {
    return this._data.find(predicate);
  }

  filter(predicate: (item: T) => boolean): T[] {
    return this._data.filter(predicate);
  }

  map<U>(mapper: (item: T) => U): U[] {
    return this._data.map(mapper);
  }

  sort(compareFn: (a: T, b: T) => number): T[] {
    return [...this._data].sort(compareFn);
  }

  // ============================================================================
  // BULK OPERATIONS
  // ============================================================================

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

  // ============================================================================
  // CLEAR LOCAL DATA
  // ============================================================================

  clear(): void {
    this._data = [];
  }
}