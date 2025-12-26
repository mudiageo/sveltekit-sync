export { QueryBuilder, type QueryResult } from './builder.js';
export {
  eq, ne, gt, gte, lt, lte,
  inArray, notInArray,
  contains, startsWith, endsWith,
  between, isNull, isNotNull,
  and, or, not,
  type QueryOperator,
  type WhereCondition,
  type LogicalOperator
} from './operators.js';
export {
  createFieldsProxy,
  type FieldsProxy,
  type FieldReference,
  type FieldCondition,
  type OrderByCondition
} from './field-proxy.js';