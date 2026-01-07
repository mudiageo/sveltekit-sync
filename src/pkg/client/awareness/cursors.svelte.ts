import type { UsePresenceReturn } from '../hooks/usePresence.svelte.js';
import type { CursorPosition, PresenceState } from '../../realtime/types.js';

export interface CursorTrackingOptions {
  /** Throttle cursor updates in milliseconds (default: 50ms) */
  throttle?: number;
  /** Container element for cursor tracking */
  container?: HTMLElement;
}

export interface CursorInfo {
  user: {
    id: string;
    name?: string;
    avatar?: string;
    [key: string]: any;
  };
  position: CursorPosition;
  presence: PresenceState;
}

/**
 * Track and display cursor positions of other users.
 * Returns a reactive map of cursors keyed by userId:clientId.
 */
export function useCursorTracking<T = any>(
  presence: UsePresenceReturn<T>,
  options: CursorTrackingOptions = {}
): {
  cursors: Map<string, CursorInfo>;
  startTracking: () => void;
  stopTracking: () => void;
} {
  const throttleMs = options.throttle ?? 50;
  const container = options.container;
  
  let isTracking = $state(false);
  let cursors = $state(new Map<string, CursorInfo>());
  let mouseHandler: ((e: MouseEvent) => void) | null = null;
  let lastUpdate = 0;
  
  const updateCursors = () => {
    const newCursors = new Map<string, CursorInfo>();
    
    for (const p of presence.others) {
      if (p.cursor) {
        const key = `${p.userId}:${p.clientId}`;
        newCursors.set(key, {
          user: p.user || { id: p.userId },
          position: p.cursor,
          presence: p
        });
      }
    }
    
    cursors = newCursors;
  };
  
  const startTracking = () => {
    if (isTracking) return;
    
    isTracking = true;
    
    // Track my cursor
    const target = container || document.body;
    
    mouseHandler = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastUpdate < throttleMs) return;
      
      lastUpdate = now;
      
      const rect = target.getBoundingClientRect();
      presence.updateCursor({
        x: e.clientX,
        y: e.clientY,
        relativeX: e.clientX - rect.left,
        relativeY: e.clientY - rect.top
      });
    };
    
    target.addEventListener('mousemove', mouseHandler, { passive: true });
    
    // Watch for changes in presence.others
    $effect(() => {
      updateCursors();
    });
  };
  
  const stopTracking = () => {
    if (!isTracking) return;
    
    isTracking = false;
    
    if (mouseHandler) {
      const target = container || document.body;
      target.removeEventListener('mousemove', mouseHandler);
      mouseHandler = null;
    }
    
    cursors.clear();
  };
  
  return {
    get cursors() {
      return cursors;
    },
    startTracking,
    stopTracking
  };
}
