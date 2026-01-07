/**
 * Selection Tracking Utility
 * 
 * Automatically tracks text selections and displays selections for other users.
 */
import type { UsePresenceReturn } from '../hooks/usePresence.svelte.js';
import type { User, Selection } from '../presence.svelte.js';

export interface SelectionTrackingOptions {
  element: HTMLElement | null;
  throttle?: number;
}

export interface SelectionTrackingReturn {
  selections: Map<string, { user: User; selection: Selection }>;
  startTracking(): void;
  stopTracking(): void;
}

/**
 * Track text selections for collaborative editing
 * 
 * @param presence - The presence hook instance
 * @param options - Configuration options
 * @returns Selection tracking API
 * 
 * @example
 * ```typescript
 * const presence = usePresence(channel, currentUser);
 * const selectionTracking = useSelectionTracking(presence, {
 *   element: editorElement,
 *   throttle: 100
 * });
 * 
 * selectionTracking.startTracking();
 * 
 * // Access selections map
 * const selections = selectionTracking.selections;
 * for (const [userId, { user, selection }] of selections) {
 *   highlightSelection(user, selection);
 * }
 * ```
 */
export function useSelectionTracking(
  presence: UsePresenceReturn<any>,
  options: SelectionTrackingOptions
): SelectionTrackingReturn {
  const opts = {
    throttle: 100,
    ...options
  };

  const selections = $state(new Map<string, { user: User; selection: Selection }>());
  let isTracking = $state(false);
  let throttleTimer: number | null = null;
  let unsubscribeJoin: (() => void) | null = null;
  let unsubscribeUpdate: (() => void) | null = null;
  let unsubscribeLeave: (() => void) | null = null;

  function updateSelectionsMap() {
    selections.clear();
    for (const state of presence.others) {
      if (state.selection) {
        selections.set(state.user.id, {
          user: state.user,
          selection: state.selection
        });
      }
    }
  }

  function handleSelectionChange() {
    if (throttleTimer || !opts.element) return;

    const selection = window.getSelection();
    
    if (selection && selection.rangeCount > 0 && selection.toString().length > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const elementRect = opts.element.getBoundingClientRect();
      
      presence.updateSelection({
        start: {
          x: rect.left - elementRect.left,
          y: rect.top - elementRect.top
        },
        end: {
          x: rect.right - elementRect.left,
          y: rect.bottom - elementRect.top
        },
        text: selection.toString()
      });
    } else {
      presence.updateSelection(null);
    }

    throttleTimer = window.setTimeout(() => {
      throttleTimer = null;
    }, opts.throttle);
  }

  function startTracking(): void {
    if (isTracking || !opts.element) return;
    
    isTracking = true;

    document.addEventListener('selectionchange', handleSelectionChange);

    // Listen for presence changes
    unsubscribeJoin = presence.on('join', updateSelectionsMap);
    unsubscribeUpdate = presence.on('update', updateSelectionsMap);
    unsubscribeLeave = presence.on('leave', updateSelectionsMap);

    // Initial update
    updateSelectionsMap();
  }

  function stopTracking(): void {
    if (!isTracking) return;
    
    isTracking = false;

    document.removeEventListener('selectionchange', handleSelectionChange);

    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }

    unsubscribeJoin?.();
    unsubscribeUpdate?.();
    unsubscribeLeave?.();
    
    selections.clear();
  }

  return {
    get selections() {
      return selections;
    },
    startTracking,
    stopTracking
  };
}
