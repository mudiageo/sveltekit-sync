import { type DBSchema, openDB, type IDBPDatabase } from 'idb';
import { browser } from '$app/environment'
interface SyncMeta {
  key: string;
  value: any;
}

interface SyncQueueItem {
  id: string;
  [key: string]: any;
}

interface SyncOperation extends SyncQueueItem {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error?: string;
}

interface SyncDBSchema extends DBSchema {
  sync_queue: {
    key: string;
    value: SyncOperation;
  };
  sync_meta: {
    key: string;
    value: SyncMeta;
  };
  [key: string]: {
    key: string;
    value: any;
  };
}

export class IDBAdapter implements LocalAdapter<IDBPDatabase<SyncDBSchema>> {
  private db: IDBPDatabase<SyncDBSchema> | null = null;
  private dbName: string;
  private version: number;

  constructor(dbName = 'sync-db', version = 1) {
    this.dbName = dbName;
    this.version = version;
    if (!this.db && browser) this.init()
  }
  private ensureInitialized(): void {
    if (!this.db) {
      throw new Error('Database not initialized. Call adapter.init() first.');
    }
  }
  

  async init(schema?: { [table: string]: string }): Promise<void> {
    if (this.db) return; // Already initialized
    
    this.db = await openDB<SyncDBSchema>(this.dbName, this.version, {
      upgrade(db) {
        // Create default stores
        if (!db.objectStoreNames.contains('sync_queue')) {
          db.createObjectStore('sync_queue', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sync_meta')) {
          db.createObjectStore('sync_meta', { keyPath: 'key' });
        }

        // Create user-defined stores
        if (schema) {
          Object.keys(schema).forEach(table => {
            if (!db.objectStoreNames.contains(table)) {
              db.createObjectStore(table, { keyPath: 'id' });
            }
          });
        }
      },
    });
  }

  async insert(table: string, data: any): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.add(table as any, data);
    return data;
  }

  async update(table: string, id: string, data: any): Promise<any> {
    if (!this.db) throw new Error('Database not initialized');
    const updated = { ...data, id };
    await this.db.put(table as any, updated);
    return updated;
  }

  async delete(table: string, id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.db.delete(table as any, id);
  }

  async find(table: string, query?: any): Promise<any[]> {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.getAll(table as any);
  }

  async findOne(table: string, id: string): Promise<any | null> {
    if (!this.db) throw new Error('Database not initialized');
    const result = await this.db.get(table as any, id);
    return result || null;
  }

  async addToQueue(op: SyncOperation): Promise<void> {
    await this.insert('sync_queue', op);
  }

  async getQueue(): Promise<SyncOperation[]> {
    return this.find('sync_queue');
  }

  async removeFromQueue(ids: string[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    
    const tx = this.db.transaction('sync_queue', 'readwrite');
    await Promise.all(ids.map(id => tx.store.delete(id)));
    await tx.done;
  }

  async updateQueueStatus(
    id: string,
    status: SyncOperation['status'],
    error?: string
  ): Promise<void> {
    const op = await this.findOne('sync_queue', id);
    if (op) {
      await this.update('sync_queue', id, { ...op, status, error });
    }
  }

  async getLastSync(): Promise<number> {
    const meta = await this.findOne('sync_meta', 'lastSync');
    return meta?.value || 0;
  }

  async setLastSync(timestamp: number): Promise<void> {
    await this.update('sync_meta', 'lastSync', {
      key: 'lastSync',
      value: timestamp,
    });
  }

  async getClientId(): Promise<string> {
    let meta = await this.findOne('sync_meta', 'clientId');
    if (!meta) {
      const clientId = crypto.randomUUID();
      await this.insert('sync_meta', { key: 'clientId', value: clientId });
      return clientId;
    }
    return meta.value;
  }
}