import type { SyncChannel } from './channel.svelte.js';
import type { PresenceState, CursorPosition, Selection, EditingState } from '../realtime/types.js';

export interface PresenceStoreOptions<T = any> {
  /** User information */
  user: {
    id: string;
    name?: string;
    avatar?: string;
    [key: string]: any;
  };
  /** Initial custom state */
  initialState?: T;
  /** Idle timeout in ms (default: 5 minutes) */
  idleTimeout?: number;
  /** Heartbeat interval in ms (default: 30 seconds) */
  heartbeatInterval?: number;
}

/**
 * Client-side presence state manager.
 * Manages local presence state and syncs with other users via a channel.
 */
export class PresenceStore<T = any> {
  private channel: SyncChannel;
  private options: Required<PresenceStoreOptions<T>>;
  
  // Local state (reactive with $state)
  private myState = $state<PresenceState<T>>({
    userId: '',
    clientId: '',
    status: 'online',
    lastUpdated: Date.now()
  });
  
  private othersState = $state<Map<string, PresenceState<T>>>(new Map());
  
  // Timers
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivityTime = Date.now();
  
  // Debouncing
  private cursorUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private selectionUpdateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(channel: SyncChannel, options: PresenceStoreOptions<T>) {
    this.channel = channel;
    this.options = {
      user: options.user,
      initialState: options.initialState as T | undefined,
      idleTimeout: options.idleTimeout ?? 300000, // 5 minutes
      heartbeatInterval: options.heartbeatInterval ?? 30000, // 30 seconds
    } as Required<PresenceStoreOptions<T>>;
    
    // Initialize local state
    this.myState = {
      userId: this.options.user.id,
      clientId: '', // Will be set during subscription
      user: this.options.user,
      status: 'online',
      custom: this.options.initialState,
      lastUpdated: Date.now()
    };
    
    this.setupEventListeners();
    this.startIdleDetection();
    this.startHeartbeat();
  }
  
  /**
   * Get my presence state (reactive)
   */
  get me(): Readonly<PresenceState<T>> {
    return this.myState;
  }
  
  /**
   * Get all other users' presence states (reactive)
   */
  get others(): ReadonlyArray<PresenceState<T>> {
    return Array.from(this.othersState.values());
  }
  
  /**
   * Get count of other online users
   */
  get othersCount(): number {
    return this.othersState.size;
  }
  
  /**
   * Get count of all online users (including me)
   */
  get onlineCount(): number {
    return this.othersState.size + 1;
  }
  
  /**
   * Update cursor position (debounced)
   */
  updateCursor(position: CursorPosition, debounceMs = 50): void {
    this.resetActivity();
    
    if (this.cursorUpdateTimer) {
      clearTimeout(this.cursorUpdateTimer);
    }
    
    this.cursorUpdateTimer = setTimeout(() => {
      this.myState.cursor = position;
      this.myState.lastUpdated = Date.now();
      this.broadcastUpdate();
    }, debounceMs);
  }
  
  /**
   * Update text selection (debounced)
   */
  updateSelection(selection: Selection | null, debounceMs = 100): void {
    this.resetActivity();
    
    if (this.selectionUpdateTimer) {
      clearTimeout(this.selectionUpdateTimer);
    }
    
    this.selectionUpdateTimer = setTimeout(() => {
      this.myState.selection = selection || undefined;
      this.myState.lastUpdated = Date.now();
      this.broadcastUpdate();
    }, debounceMs);
  }
  
  /**
   * Update editing state
   */
  updateEditing(editing: EditingState | null): void {
    this.resetActivity();
    this.myState.editing = editing || undefined;
    this.myState.lastUpdated = Date.now();
    this.broadcastUpdate();
  }
  
  /**
   * Update custom state
   */
  updateCustom(custom: Partial<T>): void {
    this.resetActivity();
    this.myState.custom = {
      ...this.myState.custom,
      ...custom
    } as T;
    this.myState.lastUpdated = Date.now();
    this.broadcastUpdate();
  }
  
  /**
   * Set status (online, idle, away)
   */
  setStatus(status: 'online' | 'idle' | 'away'): void {
    if (this.myState.status !== status) {
      this.myState.status = status;
      this.myState.lastUpdated = Date.now();
      this.broadcastUpdate();
    }
  }
  
  /**
   * Get a specific user's presence by userId
   */
  getUser(userId: string): PresenceState<T> | null {
    for (const presence of this.othersState.values()) {
      if (presence.userId === userId) {
        return presence;
      }
    }
    return null;
  }
  
  /**
   * Get all users currently editing a specific resource
   */
  getUsersEditing(resourceId: string): PresenceState<T>[] {
    return this.others.filter(
      p => p.editing?.resourceId === resourceId
    );
  }
  
  /**
   * Get all online users
   */
  getOnlineUsers(): PresenceState<T>[] {
    return this.others.filter(p => p.status === 'online');
  }
  
  /**
   * Clean up resources
   */
  destroy(): void {
    this.stopIdleDetection();
    this.stopHeartbeat();
    
    if (this.cursorUpdateTimer) {
      clearTimeout(this.cursorUpdateTimer);
    }
    
    if (this.selectionUpdateTimer) {
      clearTimeout(this.selectionUpdateTimer);
    }
    
    // Untrack presence
    this.channel.untrack();
  }
  
  /**
   * Setup event listeners for presence updates from other users
   */
  private setupEventListeners(): void {
    this.channel.on('presence:sync', (presences: PresenceState<T>[]) => {
      // Full sync of all presence states in the channel
      this.othersState.clear();
      for (const presence of presences) {
        if (presence.userId !== this.myState.userId || presence.clientId !== this.myState.clientId) {
          const key = `${presence.userId}:${presence.clientId}`;
          this.othersState.set(key, presence);
        }
      }
    });
    
    this.channel.on('presence:join', (presence: PresenceState<T>) => {
      if (presence.userId !== this.myState.userId || presence.clientId !== this.myState.clientId) {
        const key = `${presence.userId}:${presence.clientId}`;
        this.othersState.set(key, presence);
      }
    });
    
    this.channel.on('presence:update', (presence: PresenceState<T>) => {
      if (presence.userId !== this.myState.userId || presence.clientId !== this.myState.clientId) {
        const key = `${presence.userId}:${presence.clientId}`;
        this.othersState.set(key, presence);
      }
    });
    
    this.channel.on('presence:leave', (presence: PresenceState<T>) => {
      const key = `${presence.userId}:${presence.clientId}`;
      this.othersState.delete(key);
    });
  }
  
  /**
   * Broadcast presence update to other users
   */
  private broadcastUpdate(): void {
    this.channel.track(this.myState);
  }
  
  /**
   * Start idle detection
   */
  private startIdleDetection(): void {
    if (typeof window === 'undefined') return;
    
    // Track user activity
    const activityEvents = ['mousemove', 'mousedown', 'keypress', 'scroll', 'touchstart'];
    
    const handleActivity = () => {
      this.resetActivity();
      
      if (this.myState.status === 'idle') {
        this.setStatus('online');
      }
    };
    
    for (const event of activityEvents) {
      window.addEventListener(event, handleActivity, { passive: true });
    }
    
    // Check for idle state
    this.idleTimer = setInterval(() => {
      const timeSinceActivity = Date.now() - this.lastActivityTime;
      
      if (timeSinceActivity > this.options.idleTimeout && this.myState.status === 'online') {
        this.setStatus('idle');
      }
    }, 10000); // Check every 10 seconds
  }
  
  /**
   * Stop idle detection
   */
  private stopIdleDetection(): void {
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }
  
  /**
   * Reset activity timer
   */
  private resetActivity(): void {
    this.lastActivityTime = Date.now();
  }
  
  /**
   * Start heartbeat to keep presence alive
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      // Send heartbeat by updating lastUpdated timestamp
      this.myState.lastUpdated = Date.now();
      this.broadcastUpdate();
    }, this.options.heartbeatInterval);
  }
  
  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
