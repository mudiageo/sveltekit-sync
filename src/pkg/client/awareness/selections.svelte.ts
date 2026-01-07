import type { UsePresenceReturn } from '../hooks/usePresence.svelte.js';
import type { Selection, PresenceState } from '../../realtime/types.js';

export interface SelectionTrackingOptions {
  /** Element to track selections within */
  element?: HTMLElement;
  /** Throttle selection updates in milliseconds (default: 100ms) */
  throttle?: number;
}

export interface SelectionInfo {
  user: {
    id: string;
    name?: string;
    avatar?: string;
    [key: string]: any;
  };
  selection: Selection;
  presence: PresenceState;
}

/**
 * Track and display text selections of other users.
 * Returns a reactive map of selections keyed by userId:clientId.
 */
export function useSelectionTracking<T = any>(
  presence: UsePresenceReturn<T>,
  options: SelectionTrackingOptions = {}
): {
  selections: Map<string, SelectionInfo>;
  startTracking: () => void;
  stopTracking: () => void;
} {
  const throttleMs = options.throttle ?? 100;
  const element = options.element;
  
  let isTracking = $state(false);
  let selections = $state(new Map<string, SelectionInfo>());
  let selectionHandler: (() => void) | null = null;
  let lastUpdate = 0;
  
  const updateSelections = () => {
    const newSelections = new Map<string, SelectionInfo>();
    
    for (const p of presence.others) {
      if (p.selection) {
        const key = `${p.userId}:${p.clientId}`;
        newSelections.set(key, {
          user: p.user || { id: p.userId },
          selection: p.selection,
          presence: p
        });
      }
    }
    
    selections = newSelections;
  };
  
  const startTracking = () => {
    if (isTracking) return;
    
    isTracking = true;
    
    // Track my selection
    selectionHandler = () => {
      const now = Date.now();
      if (now - lastUpdate < throttleMs) return;
      
      lastUpdate = now;
      
      const selection = window.getSelection();
      
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        
        // Only track if selection is within target element
        if (element && !element.contains(range.commonAncestorContainer)) {
          presence.updateSelection(null);
          return;
        }
        
        presence.updateSelection({
          start: range.startOffset,
          end: range.endOffset,
          text: selection.toString()
        });
      } else {
        presence.updateSelection(null);
      }
    };
    
    document.addEventListener('selectionchange', selectionHandler);
    
    // Watch for changes in presence.others
    $effect(() => {
      updateSelections();
    });
  };
  
  const stopTracking = () => {
    if (!isTracking) return;
    
    isTracking = false;
    
    if (selectionHandler) {
      document.removeEventListener('selectionchange', selectionHandler);
      selectionHandler = null;
    }
    
    selections.clear();
  };
  
  return {
    get selections() {
      return selections;
    },
    startTracking,
    stopTracking
  };
}
