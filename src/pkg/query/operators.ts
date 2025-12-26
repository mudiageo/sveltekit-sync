// These create operator objects that can be used in object syntax queries

export const OPERATOR_SYMBOL = Symbol('query-operator');

export type OperatorType = 
  | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' 
  | 'in' | 'notIn' | 'contains' | 'startsWith' | 'endsWith'
  | 'between' | 'isNull' | 'isNotNull';

export interface QueryOperator<T = any> {
  [OPERATOR_SYMBOL]: true;
  type: OperatorType;
  value: T;
}

function createOperator<T>(type: OperatorType, value: T): QueryOperator<T> {
  return { [OPERATOR_SYMBOL]: true, type, value };
}

export function isOperator(value: any): value is QueryOperator {
  return value !== null && typeof value === 'object' && OPERATOR_SYMBOL in value;
}

// Comparison operators
export const eq = <T>(value: T): QueryOperator<T> => createOperator('eq', value);
export const ne = <T>(value: T): QueryOperator<T> => createOperator('ne', value);
export const gt = <T>(value: T): QueryOperator<T> => createOperator('gt', value);
export const gte = <T>(value: T): QueryOperator<T> => createOperator('gte', value);
export const lt = <T>(value: T): QueryOperator<T> => createOperator('lt', value);
export const lte = <T>(value: T): QueryOperator<T> => createOperator('lte', value);

// Array operators
export const inArray = <T>(values: T[]): QueryOperator<T[]> => createOperator('in', values);
export const notInArray = <T>(values: T[]): QueryOperator<T[]> => createOperator('notIn', values);

// String operators
export const contains = (value: string): QueryOperator<string> => createOperator('contains', value);
export const startsWith = (value: string): QueryOperator<string> => createOperator('startsWith', value);
export const endsWith = (value: string): QueryOperator<string> => createOperator('endsWith', value);

// Range operator
export const between = <T>(min: T, max: T): QueryOperator<[T, T]> => createOperator('between', [min, max]);

// Null operators
export const isNull = (): QueryOperator<null> => createOperator('isNull', null);
export const isNotNull = (): QueryOperator<null> => createOperator('isNotNull', null);

// Logical operators for combining conditions
export type LogicalOperator<T> = {
  [OPERATOR_SYMBOL]: true;
  type: 'and' | 'or' | 'not';
  conditions: WhereCondition<T>[];
};

export type WhereCondition<T> = 
  | ((item: T) => boolean)
  | Partial<{ [K in keyof T]: T[K] | QueryOperator<T[K]> }>
  | LogicalOperator<T>;

export function and<T>(...conditions: WhereCondition<T>[]): LogicalOperator<T> {
  return { [OPERATOR_SYMBOL]: true, type: 'and', conditions };
}

export function or<T>(...conditions: WhereCondition<T>[]): LogicalOperator<T> {
  return { [OPERATOR_SYMBOL]: true, type: 'or', conditions };
}

export function not<T>(condition: WhereCondition<T>): LogicalOperator<T> {
  return { [OPERATOR_SYMBOL]: true, type: 'not', conditions: [condition] };
}