/**
 * usePresence Hook
 * 
 * Svelte 5 runes-compatible hook for simplified presence/awareness usage.
 * Provides reactive state, automatic tracking, and event handling.
 */
import { PresenceStore, type User, type PresenceState, type CursorPosition, type Selection, type EditingState } from '../presence.svelte.js';
import type { SyncChannel } from '../channel.svelte.js';

export interface UsePresenceOptions<T = any> {
  customState?: T;
  idleTimeout?: number;     // Default 5 min (300000ms)
  trackCursor?: boolean;    // Auto-track mouse position
  trackSelection?: boolean; // Auto-track text selection
}

export interface UsePresenceReturn<T> {
  // Reactive state (use $derived)
  readonly others: PresenceState<T>[];
  readonly othersCount: number;
  readonly onlineCount: number;
  
  // My state
  readonly myPresence: PresenceState<T>;
  
  // Actions
  updateCursor(position: CursorPosition): void;
  updateSelection(selection: Selection | null): void;
  updateEditing(editing: EditingState | null): void;
  updateCustom(custom: Partial<T>): void;
  setStatus(status: 'online' | 'idle' | 'away'): void;
  
  // Queries
  getUser(userId: string): PresenceState<T> | null;
  getUsersEditing(resourceId: string): PresenceState<T>[];
  
  // Follow mode
  follow(userId: string): () => void;
  isFollowing(userId: string): boolean;
  
  // Events
  on(event: 'join' | 'leave' | 'update', handler: (state: PresenceState<T>) => void): () => void;
  
  // Cleanup
  destroy(): void;
}

/**
 * Create a presence hook for a channel
 * 
 * @param channel - The SyncChannel to use for presence
 * @param user - Current user information
 * @param options - Configuration options
 * @returns Presence API with reactive state and actions
 * 
 * @example
 * ```typescript
 * const presence = usePresence(channel, currentUser, {
 *   customState: { editing: 'doc-123' },
 *   trackCursor: true,
 *   idleTimeout: 300000 // 5 minutes
 * });
 * 
 * // Access reactive state
 * const collaborators = presence.others;
 * const count = presence.onlineCount;
 * 
 * // Update presence
 * presence.updateCursor({ x: 100, y: 200 });
 * presence.updateCustom({ editing: 'section-2' });
 * ```
 */
export function usePresence<T = any>(
  channel: SyncChannel,
  user: User,
  options?: UsePresenceOptions<T>
): UsePresenceReturn<T> {
  const opts = {
    idleTimeout: 300000, // 5 minutes
    trackCursor: false,
    trackSelection: false,
    ...options
  };

  // Get or create presence store from channel
  const presence = channel.presence as PresenceStore<T>;
  
  if (!presence) {
    throw new Error('Channel must have presence enabled');
  }

  // Setup automatic cursor tracking if enabled
  let cursorTrackingCleanup: (() => void) | null = null;
  if (opts.trackCursor && typeof document !== 'undefined') {
    const handleMouseMove = (e: MouseEvent) => {
      presence.updateCursor({
        x: e.clientX,
        y: e.clientY
      });
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    cursorTrackingCleanup = () => {
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }

  // Setup automatic selection tracking if enabled
  let selectionTrackingCleanup: (() => void) | null = null;
  if (opts.trackSelection && typeof document !== 'undefined') {
    const handleSelectionChange = () => {
      const selection = document.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        
        presence.updateSelection({
          start: { x: rect.left, y: rect.top },
          end: { x: rect.right, y: rect.bottom },
          text: selection.toString()
        });
      } else {
        presence.updateSelection(null);
      }
    };
    
    document.addEventListener('selectionchange', handleSelectionChange);
    selectionTrackingCleanup = () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }

  return {
    // Reactive state
    get others(): PresenceState<T>[] {
      return presence.others;
    },
    
    get othersCount(): number {
      return presence.othersCount;
    },
    
    get onlineCount(): number {
      return presence.onlineCount;
    },
    
    get myPresence(): PresenceState<T> {
      return presence.myPresence;
    },
    
    // Actions
    updateCursor(position: CursorPosition): void {
      presence.updateCursor(position);
    },
    
    updateSelection(selection: Selection | null): void {
      presence.updateSelection(selection);
    },
    
    updateEditing(editing: EditingState | null): void {
      presence.updateEditing(editing);
    },
    
    updateCustom(custom: Partial<T>): void {
      presence.updatePresence({ custom });
    },
    
    setStatus(status: 'online' | 'idle' | 'away'): void {
      presence.setStatus(status);
    },
    
    // Queries
    getUser(userId: string): PresenceState<T> | null {
      return presence.getUser(userId);
    },
    
    getUsersEditing(resourceId: string): PresenceState<T>[] {
      return presence.getUsersEditing(resourceId);
    },
    
    // Follow mode
    follow(userId: string): () => void {
      return presence.follow(userId);
    },
    
    isFollowing(userId: string): boolean {
      return presence.isFollowing(userId);
    },
    
    // Events
    on(event: 'join' | 'leave' | 'update', handler: (state: PresenceState<T>) => void): () => void {
      return presence.on(event, handler);
    },
    
    // Cleanup
    destroy(): void {
      cursorTrackingCleanup?.();
      selectionTrackingCleanup?.();
      // Note: Don't destroy the underlying presence store as it's managed by the channel
    }
  };
}
