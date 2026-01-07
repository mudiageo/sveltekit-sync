import { PresenceStore, type PresenceStoreOptions } from '../presence.svelte.js';
import type { SyncChannel } from '../channel.svelte.js';
import type { PresenceState, CursorPosition, Selection, EditingState } from '../../realtime/types.js';

export interface UsePresenceOptions<T = any> extends Partial<PresenceStoreOptions<T>> {
  /** Auto-track mouse cursor position */
  trackCursor?: boolean;
  /** Container element for cursor tracking */
  cursorContainer?: HTMLElement;
  /** Auto-track text selection */
  trackSelection?: boolean;
  /** Element for selection tracking */
  selectionElement?: HTMLElement;
}

export interface UsePresenceReturn<T = any> {
  // Reactive state
  readonly others: ReadonlyArray<PresenceState<T>>;
  readonly othersCount: number;
  readonly onlineCount: number;
  readonly myPresence: Readonly<PresenceState<T>>;
  
  // Actions
  updateCursor: (position: CursorPosition) => void;
  updateSelection: (selection: Selection | null) => void;
  updateEditing: (editing: EditingState | null) => void;
  updateCustom: (custom: Partial<T>) => void;
  setStatus: (status: 'online' | 'idle' | 'away') => void;
  
  // Queries
  getUser: (userId: string) => PresenceState<T> | null;
  getUsersEditing: (resourceId: string) => PresenceState<T>[];
  getOnlineUsers: () => PresenceState<T>[];
  
  // Lifecycle
  destroy: () => void;
}

/**
 * Svelte 5 hook for presence tracking in a channel.
 * Provides reactive presence state and automatic tracking features.
 */
export function usePresence<T = any>(
  channel: SyncChannel,
  options: UsePresenceOptions<T> & { user: NonNullable<UsePresenceOptions<T>['user']> }
): UsePresenceReturn<T> {
  // Validate required user parameter
  if (!options.user) {
    throw new Error('usePresence: user parameter is required');
  }
  
  // Create the presence store
  const presenceStore = new PresenceStore<T>(channel, {
    user: options.user,
    initialState: options.initialState,
    idleTimeout: options.idleTimeout,
    heartbeatInterval: options.heartbeatInterval
  });
  
  // Setup auto cursor tracking if enabled
  let cursorCleanup: (() => void) | null = null;
  if (options.trackCursor && typeof window !== 'undefined') {
    cursorCleanup = setupCursorTracking(presenceStore, options.cursorContainer);
  }
  
  // Setup auto selection tracking if enabled
  let selectionCleanup: (() => void) | null = null;
  if (options.trackSelection && typeof window !== 'undefined') {
    selectionCleanup = setupSelectionTracking(presenceStore, options.selectionElement);
  }
  
  // Subscribe to the channel
  channel.subscribe();
  
  // Track initial presence
  presenceStore.setStatus('online');
  
  return {
    // Reactive getters using $derived
    get others() {
      return presenceStore.others;
    },
    get othersCount() {
      return presenceStore.othersCount;
    },
    get onlineCount() {
      return presenceStore.onlineCount;
    },
    get myPresence() {
      return presenceStore.me;
    },
    
    // Actions
    updateCursor: (position) => presenceStore.updateCursor(position),
    updateSelection: (selection) => presenceStore.updateSelection(selection),
    updateEditing: (editing) => presenceStore.updateEditing(editing),
    updateCustom: (custom) => presenceStore.updateCustom(custom),
    setStatus: (status) => presenceStore.setStatus(status),
    
    // Queries
    getUser: (userId) => presenceStore.getUser(userId),
    getUsersEditing: (resourceId) => presenceStore.getUsersEditing(resourceId),
    getOnlineUsers: () => presenceStore.getOnlineUsers(),
    
    // Lifecycle
    destroy: () => {
      if (cursorCleanup) cursorCleanup();
      if (selectionCleanup) selectionCleanup();
      presenceStore.destroy();
    }
  };
}

/**
 * Setup automatic cursor tracking
 */
function setupCursorTracking(
  presenceStore: PresenceStore,
  container?: HTMLElement
): () => void {
  const target = container || document.body;
  
  const handleMouseMove = (e: MouseEvent) => {
    const rect = target.getBoundingClientRect();
    
    presenceStore.updateCursor({
      x: e.clientX,
      y: e.clientY,
      relativeX: e.clientX - rect.left,
      relativeY: e.clientY - rect.top
    });
  };
  
  target.addEventListener('mousemove', handleMouseMove, { passive: true });
  
  return () => {
    target.removeEventListener('mousemove', handleMouseMove);
  };
}

/**
 * Setup automatic selection tracking
 */
function setupSelectionTracking(
  presenceStore: PresenceStore,
  element?: HTMLElement
): () => void {
  const target = element || document;
  
  const handleSelectionChange = () => {
    const selection = window.getSelection();
    
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      
      // Only track if selection is within target element
      if (element && !element.contains(range.commonAncestorContainer)) {
        presenceStore.updateSelection(null);
        return;
      }
      
      presenceStore.updateSelection({
        start: range.startOffset,
        end: range.endOffset,
        text: selection.toString()
      });
    } else {
      presenceStore.updateSelection(null);
    }
  };
  
  document.addEventListener('selectionchange', handleSelectionChange);
  
  return () => {
    document.removeEventListener('selectionchange', handleSelectionChange);
  };
}
