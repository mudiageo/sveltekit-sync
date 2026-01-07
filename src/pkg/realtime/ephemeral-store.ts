/**
 * Generic ephemeral (in-memory) data store with TTL support.
 * Used for presence data, temporary state, and other non-persistent data.
 */

export interface EphemeralEntry<T = any> {
  data: T;
  userId: string;
  clientId: string;
  channel: string;
  expiresAt: number;
  updatedAt: number;
}

export interface EphemeralStoreOptions {
  /** Time-to-live in milliseconds (default: 60000 = 60s) */
  ttl?: number;
  /** Cleanup interval in milliseconds (default: 30000 = 30s) */
  cleanupInterval?: number;
  /** Callback when an entry expires */
  onExpire?: (entry: EphemeralEntry) => void;
}

/**
 * In-memory store for ephemeral data with automatic TTL-based expiration.
 * Thread-safe for single-process use. For multi-process deployments, use Redis or similar.
 */
export class EphemeralStore<T = any> {
  private store: Map<string, EphemeralEntry<T>> = new Map();
  private ttl: number;
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null;
  private onExpire?: (entry: EphemeralEntry<T>) => void;

  constructor(options: EphemeralStoreOptions = {}) {
    this.ttl = options.ttl ?? 60000; // Default 60 seconds
    this.onExpire = options.onExpire;
    
    const cleanupInterval = options.cleanupInterval ?? 30000; // Default 30 seconds
    if (cleanupInterval > 0) {
      this.startCleanup(cleanupInterval);
    }
  }

  /**
   * Set or update an entry in the store
   */
  set(key: string, entry: Omit<EphemeralEntry<T>, 'expiresAt' | 'updatedAt'>): void {
    const now = Date.now();
    const fullEntry: EphemeralEntry<T> = {
      ...entry,
      expiresAt: now + this.ttl,
      updatedAt: now,
    };
    this.store.set(key, fullEntry);
  }

  /**
   * Get an entry from the store (returns null if expired or not found)
   */
  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Get the full entry (including metadata)
   */
  getEntry(key: string): EphemeralEntry<T> | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * Delete an entry from the store
   */
  delete(key: string): boolean {
    return this.store.delete(key);
  }

  /**
   * Check if a key exists (and is not expired)
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }

  /**
   * Get all entries for a specific channel
   */
  getByChannel(channel: string): EphemeralEntry<T>[] {
    const now = Date.now();
    const entries: EphemeralEntry<T>[] = [];

    for (const entry of this.store.values()) {
      if (entry.channel === channel && entry.expiresAt > now) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Get all entries for a specific user
   */
  getByUser(userId: string): EphemeralEntry<T>[] {
    const now = Date.now();
    const entries: EphemeralEntry<T>[] = [];

    for (const entry of this.store.values()) {
      if (entry.userId === userId && entry.expiresAt > now) {
        entries.push(entry);
      }
    }

    return entries;
  }

  /**
   * Get all data values in a channel (excluding a specific client)
   */
  getAllInChannel(channel: string, excludeClientId?: string): T[] {
    const now = Date.now();
    const data: T[] = [];

    for (const entry of this.store.values()) {
      if (
        entry.channel === channel &&
        entry.expiresAt > now &&
        (!excludeClientId || entry.clientId !== excludeClientId)
      ) {
        data.push(entry.data);
      }
    }

    return data;
  }

  /**
   * Get all keys in the store
   */
  keys(): string[] {
    const now = Date.now();
    const keys: string[] = [];

    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt > now) {
        keys.push(key);
      }
    }

    return keys;
  }

  /**
   * Get the number of entries in the store (excluding expired)
   */
  size(): number {
    const now = Date.now();
    let count = 0;

    for (const entry of this.store.values()) {
      if (entry.expiresAt > now) {
        count++;
      }
    }

    return count;
  }

  /**
   * Clear all entries from the store
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Manual cleanup of expired entries
   */
  cleanup(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt <= now) {
        expiredKeys.push(key);
        if (this.onExpire) {
          this.onExpire(entry);
        }
      }
    }

    for (const key of expiredKeys) {
      this.store.delete(key);
    }
  }

  /**
   * Start automatic cleanup
   */
  private startCleanup(interval: number): void {
    this.stopCleanup();
    this.cleanupIntervalId = setInterval(() => {
      this.cleanup();
    }, interval);
  }

  /**
   * Stop automatic cleanup
   */
  private stopCleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
  }

  /**
   * Destroy the store and clean up resources
   */
  destroy(): void {
    this.stopCleanup();
    this.clear();
  }
}
