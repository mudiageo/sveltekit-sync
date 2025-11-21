// Core sync engine
export { SyncEngine, CollectionStore } from './sync.svelte.js';

// Types
export type {
  SyncStatus,
  SyncOperation,
  SyncResult,
  Conflict,
  SyncConfig,
  ServerAdapter,
  QueryFilter,
  LocalAdapter,
  ClientAdapter
} from './types.js';

// Remote sync functions
export { pushChanges, pullChanges, getInitialData, subscribeToSync } from './sync.remote.js';