import { 
  type QueryOperator, 
  type WhereCondition, 
  type LogicalOperator,
  type OperatorType,
  isOperator, 
  OPERATOR_SYMBOL 
} from './operators.js';
import { 
  type FieldCondition, 
  type OrderByCondition, 
  type FieldsProxy,
  isFieldCondition, 
  isOrderByCondition,
  createFieldsProxy 
} from './field-proxy.js';

// Type for orderBy callback or condition
type OrderByInput<T> = 
  | keyof T 
  | ((fields: FieldsProxy<T>) => OrderByCondition<T>)
  | OrderByCondition<T>;

// Type for where conditions
type WhereInput<T> = 
  | ((item: T) => boolean)                                           // Callback
  | ((fields: FieldsProxy<T>) => FieldCondition<T>)                  // Proxy callback
  | Partial<{ [K in keyof T]: T[K] | QueryOperator<T[K]> }>          // Object syntax
  | FieldCondition<T>                                                 // Direct field condition
  | LogicalOperator<T>;                                               // Logical operator

interface StoredCondition<T> {
  type: 'callback' | 'object' | 'field' | 'logical';
  condition: WhereInput<T>;
}

interface StoredOrderBy<T> {
  field: keyof T;
  direction: 'asc' | 'desc';
}

export interface QueryResult<T> {
  data: T[];
  total: number;
  page?: number;
  perPage?: number;
  totalPages?: number;
  hasMore?: boolean;
}

export class QueryBuilder<T extends Record<string, any>> {
  private collection: { data: T[]; delete: (id: string) => Promise<void>; update: (id: string, data: Partial<T>) => Promise<T> };
  private conditions: StoredCondition<T>[] = [];
  private orderByClauses: StoredOrderBy<T>[] = [];
  private limitCount: number | null = null;
  private offsetCount: number = 0;
  private fieldsProxy: FieldsProxy<T>;

  constructor(collection: { data: T[]; delete: (id: string) => Promise<void>; update: (id: string, data: Partial<T>) => Promise<T> }) {
    this.collection = collection;
    this.fieldsProxy = createFieldsProxy<T>();
  }

  /**
   * Add a where condition - supports multiple syntaxes:
   * 
   * 1. Callback: .where(todo => todo.completed === false)
   * 2. Object: .where({ completed: false })
   * 3. Object with operators: .where({ priority: gte(5) })
   * 4. Proxy callback: .where(f => f.completed.eq(false))
   * 5. Field condition: .where(fields.completed.eq(false))
   */
  where(condition: WhereInput<T>): this {
    const type = this.detectConditionType(condition);
    this.conditions.push({ type, condition });
    return this;
  }

  /**
   * Add multiple AND conditions at once
   */
  whereAll(...conditions: WhereInput<T>[]): this {
    for (const condition of conditions) {
      this.where(condition);
    }
    return this;
  }

  /**
   * Add an OR condition group
   */
  orWhere(...conditions: WhereInput<T>[]): this {
    // Import dynamically to avoid circular deps
    const orCondition: LogicalOperator<T> = {
      [OPERATOR_SYMBOL]: true,
      type: 'or',
      conditions: conditions as WhereCondition<T>[]
    };
    this.conditions.push({ type: 'logical', condition: orCondition });
    return this;
  }

  /**
   * Order by field - supports multiple syntaxes:
   * 
   * 1. String: .orderBy('createdAt', 'desc')
   * 2. Callback: .orderBy(f => f.createdAt.desc())
   * 3. Condition: .orderBy(fields.createdAt.desc())
   */
  orderBy(input: OrderByInput<T>, direction: 'asc' | 'desc' = 'asc'): this {
    if (typeof input === 'string') {
      this.orderByClauses.push({ field: input as keyof T, direction });
    } else if (typeof input === 'function') {
      const result = input(this.fieldsProxy);
      if (isOrderByCondition(result)) {
        this.orderByClauses.push({ field: result.fieldName, direction: result.direction });
      }
    } else if (isOrderByCondition(input)) {
      this.orderByClauses.push({ field: input.fieldName, direction: input.direction });
    }
    return this;
  }

  /**
   * Limit results
   */
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }

  /**
   * Skip results (for pagination)
   */
  offset(count: number): this {
    this.offsetCount = count;
    return this;
  }

  /**
   * Alias for offset
   */
  skip(count: number): this {
    return this.offset(count);
  }

  /**
   * Execute query and return results
   */
  async get(): Promise<T[]> {
    let results = [...this.collection.data];

    // Apply where conditions
    results = this.applyConditions(results);

    // Apply ordering
    results = this.applyOrdering(results);

    // Apply offset
    if (this.offsetCount > 0) {
      results = results.slice(this.offsetCount);
    }

    // Apply limit
    if (this.limitCount !== null) {
      results = results.slice(0, this.limitCount);
    }

    return results;
  }

  /**
   * Get first matching result
   */
  async first(): Promise<T | null> {
    const results = await this.limit(1).get();
    return results[0] ?? null;
  }

  /**
   * Get last matching result
   */
  async last(): Promise<T | null> {
    const results = await this.get();
    return results[results.length - 1] ?? null;
  }

  /**
   * Count matching results
   */
  async count(): Promise<number> {
    const results = this.applyConditions([...this.collection.data]);
    return results.length;
  }

  /**
   * Check if any results match
   */
  async exists(): Promise<boolean> {
    const first = await this.first();
    return first !== null;
  }

  /**
   * Paginate results
   */
  async paginate(page: number, perPage: number = 10): Promise<QueryResult<T>> {
    const allFiltered = this.applyConditions([...this.collection.data]);
    const total = allFiltered.length;
    const totalPages = Math.ceil(total / perPage);
    
    const data = await this
      .offset((page - 1) * perPage)
      .limit(perPage)
      .get();

    return {
      data,
      total,
      page,
      perPage,
      totalPages,
      hasMore: page < totalPages
    };
  }

  /**
   * Delete all matching records
   */
  async delete(): Promise<number> {
    const results = await this.get();
    for (const item of results) {
      await this.collection.delete((item as any).id);
    }
    return results.length;
  }

  /**
   * Update all matching records
   */
  async update(data: Partial<T>): Promise<number> {
    const results = await this.get();
    for (const item of results) {
      await this.collection.update((item as any).id, data);
    }
    return results.length;
  }

  /**
   * Get IDs of matching records
   */
  async pluck<K extends keyof T>(field: K): Promise<T[K][]> {
    const results = await this.get();
    return results.map(item => item[field]);
  }

  // Aggregate methods
  async sum(field: keyof T): Promise<number> {
    const results = await this.get();
    return results.reduce((acc, item) => acc + (Number(item[field]) || 0), 0);
  }

  async avg(field: keyof T): Promise<number> {
    const results = await this.get();
    if (results.length === 0) return 0;
    return this.sum(field).then(sum => sum / results.length);
  }

  async min<K extends keyof T>(field: K): Promise<T[K] | null> {
    const results = await this.orderBy(field as any, 'asc').limit(1).get();
    return results[0]?.[field] ?? null;
  }

  async max<K extends keyof T>(field: K): Promise<T[K] | null> {
    const results = await this.orderBy(field as any, 'desc').limit(1).get();
    return results[0]?.[field] ?? null;
  }

  // Private methods

  private detectConditionType(condition: WhereInput<T>): StoredCondition<T>['type'] {
    if (typeof condition === 'function') {
      // Try to detect if it's a proxy callback or item callback
      // by checking if it uses the fields proxy
      try {
        const testResult = (condition as any)(this.fieldsProxy);
        if (isFieldCondition(testResult)) {
          return 'field';
        }
      } catch {
        // It's a regular callback
      }
      return 'callback';
    }
    
    if (isFieldCondition(condition)) {
      return 'field';
    }
    
    if (this.isLogicalOperator(condition)) {
      return 'logical';
    }
    
    return 'object';
  }

  private isLogicalOperator(value: any): value is LogicalOperator<T> {
    return value !== null && 
           typeof value === 'object' && 
           OPERATOR_SYMBOL in value && 
           'conditions' in value;
  }

  private applyConditions(items: T[]): T[] {
    return items.filter(item => {
      return this.conditions.every(stored => this.evaluateCondition(item, stored));
    });
  }

  private evaluateCondition(item: T, stored: StoredCondition<T>): boolean {
    const { type, condition } = stored;

    switch (type) {
      case 'callback':
        // Direct callback: (item) => item.completed === false
        return (condition as (item: T) => boolean)(item);

      case 'field':
        // Proxy callback or direct field condition
        if (typeof condition === 'function') {
          const fieldCond = (condition as (fields: FieldsProxy<T>) => FieldCondition<T>)(this.fieldsProxy);
          return this.evaluateFieldCondition(item, fieldCond);
        }
        return this.evaluateFieldCondition(item, condition as FieldCondition<T>);

      case 'object':
        // Object syntax: { completed: false, priority: gte(5) }
        return this.evaluateObjectCondition(item, condition as Partial<{ [K in keyof T]: T[K] | QueryOperator<T[K]> }>);

      case 'logical':
        return this.evaluateLogicalOperator(item, condition as LogicalOperator<T>);

      default:
        return true;
    }
  }

  private evaluateFieldCondition(item: T, fieldCond: FieldCondition<T>): boolean {
    const itemValue = item[fieldCond.fieldName];
    return this.evaluateOperator(itemValue, fieldCond.operator);
  }

  private evaluateObjectCondition(item: T, obj: Partial<{ [K in keyof T]: T[K] | QueryOperator<T[K]> }>): boolean {
    for (const [key, value] of Object.entries(obj)) {
      const itemValue = item[key as keyof T];
      
      if (isOperator(value)) {
        if (!this.evaluateOperator(itemValue, value)) {
          return false;
        }
      } else {
        // Direct equality
        if (itemValue !== value) {
          return false;
        }
      }
    }
    return true;
  }

  private evaluateLogicalOperator(item: T, logical: LogicalOperator<T>): boolean {
    switch (logical.type) {
      case 'and':
        return logical.conditions.every(cond => 
          this.evaluateCondition(item, { type: this.detectConditionType(cond as WhereInput<T>), condition: cond as WhereInput<T> })
        );
      case 'or':
        return logical.conditions.some(cond => 
          this.evaluateCondition(item, { type: this.detectConditionType(cond as WhereInput<T>), condition: cond as WhereInput<T> })
        );
      case 'not':
        return !this.evaluateCondition(item, { type: this.detectConditionType(logical.conditions[0] as WhereInput<T>), condition: logical.conditions[0] as WhereInput<T> });
      default:
        return true;
    }
  }

  private evaluateOperator(itemValue: any, operator: QueryOperator): boolean {
    const { type, value } = operator;

    switch (type) {
      case 'eq':
        return itemValue === value;
      case 'ne':
        return itemValue !== value;
      case 'gt':
        return itemValue > value;
      case 'gte':
        return itemValue >= value;
      case 'lt':
        return itemValue < value;
      case 'lte':
        return itemValue <= value;
      case 'in':
        return Array.isArray(value) && value.includes(itemValue);
      case 'notIn':
        return Array.isArray(value) && !value.includes(itemValue);
      case 'contains':
        if (typeof itemValue === 'string') {
          return itemValue.includes(value);
        }
        if (Array.isArray(itemValue)) {
          return itemValue.includes(value);
        }
        return false;
      case 'startsWith':
        return typeof itemValue === 'string' && itemValue.startsWith(value);
      case 'endsWith':
        return typeof itemValue === 'string' && itemValue.endsWith(value);
      case 'between':
        const [min, max] = value as [any, any];
        return itemValue >= min && itemValue <= max;
      case 'isNull':
        return itemValue === null || itemValue === undefined;
      case 'isNotNull':
        return itemValue !== null && itemValue !== undefined;
      default:
        return true;
    }
  }

  private applyOrdering(items: T[]): T[] {
    if (this.orderByClauses.length === 0) {
      return items;
    }

    return [...items].sort((a, b) => {
      for (const { field, direction } of this.orderByClauses) {
        const aVal = a[field];
        const bVal = b[field];

        let comparison = 0;
        if (aVal < bVal) comparison = -1;
        else if (aVal > bVal) comparison = 1;

        if (comparison !== 0) {
          return direction === 'desc' ? -comparison : comparison;
        }
      }
      return 0;
    });
  }
}