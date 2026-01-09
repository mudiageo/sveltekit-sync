/**
 * Cursor Tracking Utility
 * 
 * Automatically tracks mouse movements and displays cursors for other users.
 */
import type { UsePresenceReturn } from '../hooks/usePresence.svelte.js';
import type { User, CursorPosition } from '../presence.svelte.js';

export interface CursorTrackingOptions {
  throttle?: number;  // Throttle updates in ms (default 50)
  container?: HTMLElement;
}

export interface CursorTrackingReturn {
  cursors: Map<string, { user: User; position: CursorPosition }>;
  startTracking(): void;
  stopTracking(): void;
}

/**
 * Track cursor positions for collaborative editing
 * 
 * @param presence - The presence hook instance
 * @param options - Configuration options
 * @returns Cursor tracking API
 * 
 * @example
 * ```typescript
 * const presence = usePresence(channel, currentUser);
 * const cursorTracking = useCursorTracking(presence, {
 *   throttle: 50,
 *   container: canvasElement
 * });
 * 
 * cursorTracking.startTracking();
 * 
 * // Access cursors map
 * const cursors = cursorTracking.cursors;
 * for (const [userId, { user, position }] of cursors) {
 *   renderCursor(user, position);
 * }
 * ```
 */
export function useCursorTracking(
  presence: UsePresenceReturn<any>,
  options?: CursorTrackingOptions
): CursorTrackingReturn {
  const opts = {
    throttle: 50,
    container: typeof document !== 'undefined' ? document.body : null,
    ...options
  };

  const cursors = $state(new Map<string, { user: User; position: CursorPosition }>());
  let isTracking = $state(false);
  let throttleTimer: number | null = null;
  let unsubscribeJoin: (() => void) | null = null;
  let unsubscribeUpdate: (() => void) | null = null;
  let unsubscribeLeave: (() => void) | null = null;

  function updateCursorsMap() {
    cursors.clear();
    for (const state of presence.others) {
      if (state.cursor) {
        cursors.set(state.user.id, {
          user: state.user,
          position: state.cursor
        });
      }
    }
  }

  function handleMouseMove(e: MouseEvent) {
    if (throttleTimer) return;

    const container = opts.container;
    const rect = container?.getBoundingClientRect();
    
    const position: CursorPosition = {
      x: rect ? e.clientX - rect.left : e.clientX,
      y: rect ? e.clientY - rect.top : e.clientY
    };

    presence.updateCursor(position);

    throttleTimer = window.setTimeout(() => {
      throttleTimer = null;
    }, opts.throttle);
  }

  function startTracking(): void {
    if (isTracking) return;
    
    isTracking = true;
    const container = opts.container;

    if (container) {
      container.addEventListener('mousemove', handleMouseMove as EventListener);
    }

    // Listen for presence changes
    unsubscribeJoin = presence.on('join', updateCursorsMap);
    unsubscribeUpdate = presence.on('update', updateCursorsMap);
    unsubscribeLeave = presence.on('leave', updateCursorsMap);

    // Initial update
    updateCursorsMap();
  }

  function stopTracking(): void {
    if (!isTracking) return;
    
    isTracking = false;
    const container = opts.container;

    if (container) {
      container.removeEventListener('mousemove', handleMouseMove as EventListener);
    }

    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }

    unsubscribeJoin?.();
    unsubscribeUpdate?.();
    unsubscribeLeave?.();
    
    cursors.clear();
  }

  return {
    get cursors() {
      return cursors;
    },
    startTracking,
    stopTracking
  };
}
