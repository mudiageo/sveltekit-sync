// Proxy-based typed field references for query building
import type { QueryOperator } from './operators.js';
import { eq, ne, gt, gte, lt, lte, inArray, notInArray, contains, startsWith, endsWith, between, isNull, isNotNull } from './operators.js';

export const FIELD_SYMBOL = Symbol('field-reference');

export interface FieldReference<T, K extends keyof T = keyof T> {
  [FIELD_SYMBOL]: true;
  fieldName: K;
  
  // Comparison methods
  eq(value: T[K]): FieldCondition<T, K>;
  ne(value: T[K]): FieldCondition<T, K>;
  gt(value: T[K]): FieldCondition<T, K>;
  gte(value: T[K]): FieldCondition<T, K>;
  lt(value: T[K]): FieldCondition<T, K>;
  lte(value: T[K]): FieldCondition<T, K>;
  
  // Array methods
  in(values: T[K][]): FieldCondition<T, K>;
  notIn(values: T[K][]): FieldCondition<T, K>;
  
  // String methods (only available for string fields)
  contains(value: string): FieldCondition<T, K>;
  startsWith(value: string): FieldCondition<T, K>;
  endsWith(value: string): FieldCondition<T, K>;
  
  // Range
  between(min: T[K], max: T[K]): FieldCondition<T, K>;
  
  // Null checks
  isNull(): FieldCondition<T, K>;
  isNotNull(): FieldCondition<T, K>;
  
  // Ordering
  asc(): OrderByCondition<T, K>;
  desc(): OrderByCondition<T, K>;
}

export interface FieldCondition<T, K extends keyof T = keyof T> {
  [FIELD_SYMBOL]: true;
  fieldName: K;
  operator: QueryOperator;
}

export interface OrderByCondition<T, K extends keyof T = keyof T> {
  [FIELD_SYMBOL]: true;
  fieldName: K;
  direction: 'asc' | 'desc';
}

export function isFieldCondition(value: any): value is FieldCondition<any> {
  return value !== null && typeof value === 'object' && FIELD_SYMBOL in value && 'operator' in value;
}

export function isOrderByCondition(value: any): value is OrderByCondition<any> {
  return value !== null && typeof value === 'object' && FIELD_SYMBOL in value && 'direction' in value;
}

export function isFieldReference(value: any): value is FieldReference<any> {
  return value !== null && typeof value === 'object' && FIELD_SYMBOL in value;
}

function createFieldCondition<T, K extends keyof T>(fieldName: K, operator: QueryOperator): FieldCondition<T, K> {
  return { [FIELD_SYMBOL]: true, fieldName, operator };
}

function createOrderByCondition<T, K extends keyof T>(fieldName: K, direction: 'asc' | 'desc'): OrderByCondition<T, K> {
  return { [FIELD_SYMBOL]: true, fieldName, direction };
}

function createFieldReference<T, K extends keyof T>(fieldName: K): FieldReference<T, K> {
  return {
    [FIELD_SYMBOL]: true,
    fieldName,
    
    // Comparison
    eq: (value: T[K]) => createFieldCondition<T, K>(fieldName, eq(value)),
    ne: (value: T[K]) => createFieldCondition<T, K>(fieldName, ne(value)),
    gt: (value: T[K]) => createFieldCondition<T, K>(fieldName, gt(value)),
    gte: (value: T[K]) => createFieldCondition<T, K>(fieldName, gte(value)),
    lt: (value: T[K]) => createFieldCondition<T, K>(fieldName, lt(value)),
    lte: (value: T[K]) => createFieldCondition<T, K>(fieldName, lte(value)),
    
    // Array
    in: (values: T[K][]) => createFieldCondition<T, K>(fieldName, inArray(values)),
    notIn: (values: T[K][]) => createFieldCondition<T, K>(fieldName, notInArray(values)),
    
    // String
    contains: (value: string) => createFieldCondition<T, K>(fieldName, contains(value)),
    startsWith: (value: string) => createFieldCondition<T, K>(fieldName, startsWith(value)),
    endsWith: (value: string) => createFieldCondition<T, K>(fieldName, endsWith(value)),
    
    // Range
    between: (min: T[K], max: T[K]) => createFieldCondition<T, K>(fieldName, between(min, max)),
    
    // Null
    isNull: () => createFieldCondition<T, K>(fieldName, isNull()),
    isNotNull: () => createFieldCondition<T, K>(fieldName, isNotNull()),
    
    // Ordering
    asc: () => createOrderByCondition<T, K>(fieldName, 'asc'),
    desc: () => createOrderByCondition<T, K>(fieldName, 'desc'),
  };
}

// Type for the proxy that maps all keys of T to FieldReference
export type FieldsProxy<T> = {
  readonly [K in keyof T]: FieldReference<T, K>;
};

/**
 * Creates a proxy that returns typed field references for any property access
 */
export function createFieldsProxy<T extends Record<string, any>>(): FieldsProxy<T> {
  return new Proxy({} as FieldsProxy<T>, {
    get(_target, prop: string) {
      return createFieldReference<T, keyof T>(prop as keyof T);
    }
  });
}