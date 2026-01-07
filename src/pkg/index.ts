// Core sync engine
export { SyncEngine, CollectionStore } from './client/sync.svelte.js';

// Channel and Presence
export { SyncChannel, type ChannelOptions } from './client/channel.svelte.js';
export { PresenceStore, type PresenceStoreOptions } from './client/presence.svelte.js';

// Hooks
export { usePresence, type UsePresenceOptions, type UsePresenceReturn } from './client/hooks/usePresence.svelte.js';

// Awareness utilities
export {
  useCursorTracking,
  useSelectionTracking,
  useWhoIsHere,
  type CursorTrackingOptions,
  type CursorInfo,
  type SelectionTrackingOptions,
  type SelectionInfo,
  type UserAvatar
} from './client/awareness/index.js';

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

// Realtime types
export type {
  RealtimeStatus,
  PresenceState,
  CursorPosition,
  Selection,
  EditingState,
  PresenceEvent
} from './realtime/types.js';

export { QueryBuilder, type QueryResult } from './client/query/index.js';
export {
  eq, ne, gt, gte, lt, lte,
  inArray, notInArray,
  contains, startsWith, endsWith,
  between, isNull, isNotNull,
  and, or, not
} from './client/query/index.js';
export type {
  FieldsProxy,
  FieldReference,
  FieldCondition,
  QueryOperator
} from './client/query/index.js';