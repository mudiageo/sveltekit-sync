# Fluent Query Builder API

The Query Builder provides a powerful, type-safe, and flexible way to filter, search, sort, and manipulate records in your collection stores. It supports multiple syntaxes: callback predicates, object-based conditions, operator helpers, and proxy-based, fully-typed field accessors.

## Features

- **Fluent chainable** syntax (`where()`, `orderBy()`, `limit()`, etc.)
- **Multiple filtering styles:** callback, plain object, operator helpers, proxy fields
- **Logical operators:** and/or/not
- **Type-safe field references** and auto-complete with field proxies
- **Bulk and aggregate operations:** `delete()`, `update()`, `count()`, `sum()`, `paginate()`
- **Composable and ergonomic** for complex or simple use-cases

---

## Usage Examples

### 1. Predicate (Callback) Syntax

```typescript
const results = await todosStore
  .query()
  .where(todo => todo.completed === false && todo.priority > 5)
  .orderBy(todo => todo.createdAt, 'desc')
  .limit(5)
  .get();
```

### 2. Object Syntax

```typescript
const importantTodos = await todosStore
  .query()
  .where({ completed: false, priority: 10 })
  .get();
```

### 3. Operator Helper Syntax

Import operators such as `eq`, `gte`, `contains`:

```typescript
import { eq, gte, lt, inArray, contains } from 'sveltekit-sync';

const custom = await todosStore
  .query()
  .where({
    completed: eq(false),
    priority: gte(5),
    text: contains("urgent"),
    id: inArray(['id1', 'id2'])
  })
  .orderBy('createdAt', 'desc')
  .get();
```

### 4. Proxy Field Syntax (Type-Safe)

Use the proxy to get auto-completed, typed fields and type-safe operators:

```typescript
const { $ } = todosStore;

const proxyResults = await todosStore
  .query()
  .where($.completed.eq(false))
  .where($.priority.gte(5))
  .orderBy($.createdAt.desc())
  .get();
```

Or directly:

```typescript
const results = await todosStore
  .query()
  .where(fields => fields.completed.eq(false))
  .where(fields => fields.priority.between(3, 8))
  .get();
```

### 5. Logical Operators

Chain complex conditions using `and`, `or`, and `not`:

```typescript
import { and, or, contains } from 'sveltekit-sync';

const complex = await todosStore
  .query()
  .where(and(
    { completed: false },
    or(
      { priority: 10 },
      { text: contains('meeting') }
    )
  ))
  .get();
```

---

## All Available Query Methods

| Method              | Description                                           |
|---------------------|------------------------------------------------------|
| `where()`           | Add a filtering condition. Supports all input styles.|
| `orWhere()`         | Add an OR filtering group.                           |
| `orderBy()`         | Sort results by field, direction or proxy accessor.  |
| `limit()`           | Limit the number of results.                         |
| `offset()`/`skip()` | Skip a number of results.                            |
| `get()`             | Execute and return array of results.                 |
| `first()`           | Return the first result (or `null`).                 |
| `last()`            | Return the last result (or `null`).                  |
| `count()`           | Count matching results.                              |
| `exists()`          | Returns true if any match.                           |
| `paginate()`        | Paginated query with metadata.                       |
| `sum(field)`        | Sum values for a field.                              |
| `avg(field)`        | Average values for a field.                          |
| `min(field)`        | Minimum value for a field.                           |
| `max(field)`        | Maximum value for a field.                           |
| `pluck(field)`      | Array of field values (by key).                      |
| `delete()`          | Delete all results matching the current query.       |
| `update(data)`      | Update fields on all matching records.               |

---

## Supported Operators & Examples

| Operator         | Helper              | Example                                    |
|------------------|--------------------|--------------------------------------------|
| Equals           | `eq(value)`        | `{ status: eq('active') }`                 |
| Not equals       | `ne(value)`        | `{ status: ne('done') }`                   |
| Greater than     | `gt(value)`        | `{ score: gt(10) }`                        |
| Greater/equal    | `gte(value)`       | `{ score: gte(5) }`                        |
| Less than        | `lt(value)`        | `{ score: lt(5) }`                         |
| Less/equal       | `lte(value)`       | `{ score: lte(10) }`                       |
| In array         | `inArray([...])`   | `{ status: inArray(['new', 'hold']) }`     |
| Not in array     | `notIn([...])`     | `{ type: notIn(['archived', 'deleted']) }` |
| Contains string/array| `contains(val)`| `{ tags: contains('urgent') }`             |
| Starts/ends with | `startsWith(val)`/`endsWith(val)` | `{ text: startsWith('Buy') }` |
| Between          | `between(a, b)`    | `{ date: between(start, end) }`            |
| Is null          | `isNull()`         | `{ owner: isNull() }`                      |
| Not null         | `isNotNull()`      | `{ owner: isNotNull() }`                   |

---

## Example: Bulk Operations & Aggregates

```typescript
// Delete all completed
const deletedCount = await todosStore.query().where({ completed: true }).delete();

// Update all to high priority
const updatedCount = await todosStore.query().where({ completed: false }).update({ priority: 10 });

// Aggregate
const totalPriority = await todosStore.query().sum('priority');
```

---

## Pagination Example

```typescript
const { data, total, page, perPage, totalPages, hasMore } = await todosStore
  .query()
  .where({ completed: false })
  .orderBy('createdAt', 'desc')
  .paginate(1, 20);
```

---

## API Reference

```typescript
const qb = todosStore.query();

qb.where(predicate: (item: T) => boolean): this
qb.where(plainObject: Partial<T>): this
qb.where(operatorsObj: Partial<{ [K in keyof T]: QueryOperator<T[K]> }>): this
qb.where(proxyCb: (fields: FieldsProxy<T>) => FieldCondition<T, any>): this
qb.where(fieldCond: FieldCondition<T, any>): this
qb.orderBy(field: keyof T, dir?: 'asc'|'desc'): this
qb.orderBy(proxyCb: (fields: FieldsProxy<T>) => OrderByCondition<T>): this
qb.limit(n: number): this
qb.offset(n: number): this
qb.get(): Promise<T[]>
qb.first(): Promise<T|null>
qb.count(): Promise<number>
qb.exists(): Promise<boolean>
qb.paginate(page: number, perPage?: number): Promise<QueryResult<T>>
qb.delete(): Promise<number>
qb.update(data: Partial<T>): Promise<number>
qb.sum(field: keyof T): Promise<number>
qb.avg(field: keyof T): Promise<number>
qb.min(field: keyof T): Promise<number|null>
qb.max(field: keyof T): Promise<number|null>
qb.pluck(field: keyof T): Promise<T[keyof T][]>
```

---

## Type-Safe Field Proxies

Access your collection’s fields with full typing and auto-complete:

```typescript
const { $ } = todosStore;
qb.where($.status.eq('active')).orderBy($.createdAt.desc());
```

---

## Summary

- **Filter** flexibly and type-safely.
- **Chain** logical conditions and sort/paginate fluently.
- **Leverage helpers** for readable, safe complex queries.
- **Use bulk updates/deletes** and aggregations on any query.

For further details, see the [full API reference](./API.md).

---

