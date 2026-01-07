/**
 * EphemeralStore - In-memory store for transient data like presence
 * 
 * Data stored here is not persisted to database and expires after TTL.
 * Used for presence, awareness, and other real-time ephemeral data.
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
 * Generic in-memory store for ephemeral data
 */
export class EphemeralStore<T = any> {
  private store: Map<string, EphemeralEntry<T>> = new Map();
  private ttl: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private onExpire?: (entry: EphemeralEntry<T>) => void;

  constructor(options: EphemeralStoreOptions = {}) {
    this.ttl = options.ttl ?? 60000; // Default 60 seconds
    this.onExpire = options.onExpire;

    // Start automatic cleanup
    const interval = options.cleanupInterval ?? 30000; // Default 30 seconds
    if (interval > 0) {
      this.cleanupInterval = setInterval(() => {
        this.cleanup();
      }, interval);
    }
  }

  /**
   * Store or update an entry
   */
  set(key: string, entry: Omit<EphemeralEntry<T>, 'expiresAt' | 'updatedAt'>): void {
    const now = Date.now();
    this.store.set(key, {
      ...entry,
      updatedAt: now,
      expiresAt: now + this.ttl,
    });
  }

  /**
   * Get an entry by key
   * Returns null if not found or expired
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
   * Get full entry with metadata
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
   * Delete an entry
   * Returns true if entry existed
   */
  delete(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    this.store.delete(key);
    return true;
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
   * Get all entries for a specific user across all channels
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
   * Get all data values in a channel (without metadata)
   * Optionally exclude a specific client
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
   * Get entry by channel and user
   */
  getByChannelAndUser(channel: string, userId: string): EphemeralEntry<T> | null {
    const now = Date.now();

    for (const entry of this.store.values()) {
      if (entry.channel === channel && entry.userId === userId && entry.expiresAt > now) {
        return entry;
      }
    }

    return null;
  }

  /**
   * Remove all entries for a specific client
   */
  removeByClient(clientId: string): number {
    let removed = 0;
    
    for (const [key, entry] of this.store.entries()) {
      if (entry.clientId === clientId) {
        this.store.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Remove all entries in a channel
   */
  removeByChannel(channel: string): number {
    let removed = 0;
    
    for (const [key, entry] of this.store.entries()) {
      if (entry.channel === channel) {
        this.store.delete(key);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Clean up expired entries
   * Called automatically on interval
   */
  cleanup(): void {
    const now = Date.now();
    const expired: string[] = [];

    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        expired.push(key);
        if (this.onExpire) {
          this.onExpire(entry);
        }
      }
    }

    for (const key of expired) {
      this.store.delete(key);
    }
  }

  /**
   * Get the number of entries in the store
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Stop cleanup interval and clear store
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}
