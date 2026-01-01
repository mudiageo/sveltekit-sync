import type { RealtimeClient } from './realtime/client.js';

// Types
export interface User {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  color?: string;
}

export interface CursorPosition {
  x: number;
  y: number;
  line?: number;
  column?: number;
}

export interface Selection {
  start: CursorPosition;
  end: CursorPosition;
  text?: string;
}

export interface EditingState {
  resourceId: string;
  field?: string;
  action?: 'typing' | 'selecting' | 'idle';
  timestamp: number;
}

export interface PresenceState<T = any> {
  user: User;
  status: 'online' | 'idle' | 'away' | 'offline';
  lastSeen: number;
  cursor?: CursorPosition;
  selection?: Selection;
  editing?: EditingState;
  custom?: T;
}

export class PresenceStore<T = any> {
  private realtimeClient: RealtimeClient | null;
  private tableName: string;
  private myState: PresenceState<T> = $state({} as PresenceState<T>);
  private othersState: Map<string, PresenceState<T>> = $state(new Map());
  private followingUserId: string | null = $state(null);
  private heartbeatInterval: number | null = null;
  private idleTimer: number | null = null;
  private eventListeners: Map<string, Set<(data: any) => void>> = new Map();

  constructor(
    realtimeClient: RealtimeClient | null,
    tableName: string,
    user: User,
    customState?: T
  ) {
    this.realtimeClient = realtimeClient;
    this.tableName = tableName;
    
    this.myState = {
      user: { ...user, color: user.color || this.generateColor() },
      status: 'online',
      lastSeen: Date.now(),
      custom: customState
    };

    this.setupPresenceSync();
    this.startHeartbeat();
    this.setupIdleDetection();
  }

  private generateColor(): string {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', 
      '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  private setupPresenceSync(): void {
    if (!this.realtimeClient) return;

    this.realtimeClient.on('presence:update', (data: any) => {
      const { userId, state } = data;
      if (userId !== this.myState.user.id) {
        this.othersState.set(userId, state);
        this.emit('update', state);
      }
    });

    this.realtimeClient.on('presence:join', (data: any) => {
      const { userId, state } = data;
      if (userId !== this.myState.user.id) {
        this.othersState.set(userId, state);
        this.emit('join', state);
      }
    });

    this.realtimeClient.on('presence:leave', (data: any) => {
      const { userId } = data;
      const state = this.othersState.get(userId);
      if (state) {
        this.othersState.delete(userId);
        this.emit('leave', state);
      }
    });

    this.broadcastPresence();
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = window.setInterval(() => {
      this.broadcastPresence();
    }, 30000);
  }

  private setupIdleDetection(): void {
    const resetIdle = () => {
      if (this.myState.status === 'idle') {
        this.setActive();
      }
      this.resetIdleTimer();
    };

    window.addEventListener('mousemove', resetIdle);
    window.addEventListener('keydown', resetIdle);
    window.addEventListener('click', resetIdle);

    this.resetIdleTimer();
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.setIdle();
    }, 5 * 60 * 1000);
  }

  private broadcastPresence(): void {
    if (!this.realtimeClient) return;
    
    this.myState.lastSeen = Date.now();
    this.realtimeClient.emit('presence:update', {
      table: this.tableName,
      userId: this.myState.user.id,
      state: this.myState
    });
  }

  // Event system (using realtimeClient as base)
  on(event: string, handler: (data: any) => void): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);

    return () => {
      const handlers = this.eventListeners.get(event);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }

  private emit(event: string, data: any): void {
    const handlers = this.eventListeners.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  // Public API
  updatePresence(state: Partial<PresenceState<T>>): void {
    this.myState = { ...this.myState, ...state };
    this.broadcastPresence();
  }

  updateCursor(position: CursorPosition): void {
    this.myState.cursor = position;
    this.broadcastPresence();
  }

  updateSelection(selection: Selection | null): void {
    this.myState.selection = selection || undefined;
    this.broadcastPresence();
  }

  updateEditing(editing: EditingState | null): void {
    this.myState.editing = editing || undefined;
    this.broadcastPresence();
  }

  get others(): PresenceState<T>[] {
    return Array.from(this.othersState.values());
  }

  get othersCount(): number {
    return this.othersState.size;
  }

  getUser(userId: string): PresenceState<T> | null {
    return this.othersState.get(userId) || null;
  }

  getOnlineUsers(): PresenceState<T>[] {
    return this.others.filter(u => u.status === 'online');
  }

  getUsersEditing(resourceId: string): PresenceState<T>[] {
    return this.others.filter(u => u.editing?.resourceId === resourceId);
  }

  follow(userId: string): () => void {
    this.followingUserId = userId;
    const unsubscribe = this.on('update', (user) => {
      if (user.user.id === userId) {
        this.emit('following:update', user);
      }
    });
    return () => {
      this.stopFollowing();
      unsubscribe();
    };
  }

  stopFollowing(): void {
    this.followingUserId = null;
  }

  isFollowing(userId: string): boolean {
    return this.followingUserId === userId;
  }

  setStatus(status: PresenceState['status']): void {
    this.myState.status = status;
    this.broadcastPresence();
  }

  setIdle(): void {
    this.setStatus('idle');
  }

  setActive(): void {
    this.setStatus('online');
  }

  destroy(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    
    if (this.realtimeClient) {
      this.realtimeClient.emit('presence:leave', {
        table: this.tableName,
        userId: this.myState.user.id
      });
    }
    
    this.eventListeners.clear();
  }
}
