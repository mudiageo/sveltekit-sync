// Core sync engine
export { SyncEngine, CollectionStore } from './client/sync.svelte.js';

// Real-time and Presence
export { SyncChannel } from './client/channel.svelte.js';
export { PresenceStore } from './client/presence.svelte.js';
export { RealtimeClient } from './realtime/client.js';

// Hooks
export { usePresence, type UsePresenceOptions, type UsePresenceReturn } from './client/hooks/usePresence.svelte.js';

// Awareness Utilities
export {
  useCursorTracking,
  useSelectionTracking,
  useWhoIsHere,
  type CursorTrackingOptions,
  type CursorTrackingReturn,
  type SelectionTrackingOptions,
  type SelectionTrackingReturn,
  type WhoIsHereReturn
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

// Real-time Types
export type {
  RealtimeClientConfig,
  RealtimeStatus,
  RealtimeEvent,
  OperationsEvent
} from './realtime/types.js';

// Presence Types
export type {
  User,
  CursorPosition,
  Selection,
  EditingState,
  PresenceState
} from './client/presence.svelte.js';

// Channel Types
export type {
  ChannelOptions
} from './client/channel.svelte.js';

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