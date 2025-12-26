// Core sync engine
export { SyncEngine, CollectionStore } from './client/sync.svelte.js';

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