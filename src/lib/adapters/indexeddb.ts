import type { ClientAdapter } from '$lib/types';
import type { SyncOperation } from '$lib/types';

export class IndexedDBAdapter implements ClientAdapter<IDBDatabase> {
  private db: IDBDatabase | null = null;
  private dbName: string;
  private version: number;

  constructor(dbName = 'sync-db', version = 1) {
    this.dbName = dbName;
    this.version = version;
  }

  private ensureInitialized(): void {
    if (!this.db) {
      throw new Error('Database not initialized. Call adapter.init() first.');
    }
  }

  async init(schema?: { [table: string]: string }): Promise<void> {
    if (this.db) return; // Already initialized

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

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
      };
    });
  }

  private getStore(table: string, mode: IDBTransactionMode = 'readonly'): IDBObjectStore {
    this.ensureInitialized();
    return this.db!.transaction(table, mode).objectStore(table);
  }

  async insert(table: string, data: any): Promise<any> {
    const store = this.getStore(table, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.add(data);
      request.onsuccess = () => resolve(data);
      request.onerror = () => reject(request.error);
    });
  }

  async update(table: string, id: string, data: any): Promise<any> {
    const store = this.getStore(table, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put({ ...data, id });
      request.onsuccess = () => resolve(data);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(table: string, id: string): Promise<void> {
    const store = this.getStore(table, 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async find(table: string, query?: any): Promise<any[]> {
    const store = this.getStore(table);
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async findOne(table: string, id: string): Promise<any | null> {
    const store = this.getStore(table);
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async addToQueue(op: SyncOperation): Promise<void> {
    await this.insert('sync_queue', op);
  }

  async getQueue(): Promise<SyncOperation[]> {
    return this.find('sync_queue');
  }

  async removeFromQueue(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.delete('sync_queue', id);
    }
  }

  async updateQueueStatus(id: string, status: SyncOperation['status'], error?: string): Promise<void> {
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
    const existing = await this.findOne('sync_meta', 'lastSync');
    if (existing) {
      await this.update('sync_meta', 'lastSync', { key: 'lastSync', value: timestamp });
    } else {
      await this.insert('sync_meta', { key: 'lastSync', value: timestamp });
    }
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

  async isInitialized(): Promise<boolean> {
    const meta = await this.findOne('sync_meta', 'isInitialized');
    return meta?.value || false;
  }

  async setInitialized(value: boolean): Promise<void> {
    const existing = await this.findOne('sync_meta', 'isInitialized');
    if (existing) {
      await this.update('sync_meta', 'isInitialized', { key: 'isInitialized', value });
    } else {
      await this.insert('sync_meta', { key: 'isInitialized', value });
    }
  }
}