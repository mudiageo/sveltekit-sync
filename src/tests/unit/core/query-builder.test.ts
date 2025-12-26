import { describe, it, expect, beforeEach } from 'vitest';
import { QueryBuilder } from '$pkg/query/builder.js';
import { 
  eq, gt, gte, inArray, notInArray, contains, and, or, not, startsWith, endsWith, ne, lt, lte, between, isNull, isNotNull 
} from '$pkg/query/operators.js';
import { createFieldsProxy } from '$pkg/query/field-proxy.js';

// Mock collection store
interface Todo {
  id: string;
  text: string;
  completed: boolean;
  priority: number;
  tags: string[];
  createdAt: number;
  assignee?: string | null;
};

function getTodos(): Todo[] {
  return [
    { id: '1', text: 'Urgent email', completed: false, priority: 7, tags: ['work'], createdAt: 100, assignee: 'bob' },
    { id: '2', text: 'Write tests', completed: true, priority: 5, tags: ['dev'], createdAt: 70, assignee: null },
    { id: '3', text: 'Meeting', completed: false, priority: 6, tags: ['work', 'urgent'], createdAt: 130, assignee: undefined },
    { id: '4', text: 'Buy milk', completed: false, priority: 3, tags: ['personal'], createdAt: 80, assignee: 'bob' },
    { id: '5', text: 'Release', completed: true, priority: 9, tags: ['dev', 'important'], createdAt: 30, assignee: 'amy' }
  ];
}

let collection: { 
  data: Todo[], 
  delete: (id: string) => Promise<void>, 
  update: (id: string, data: Partial<Todo>) => Promise<Todo> 
};

function createBuilder() {
  return new QueryBuilder<Todo>(collection)
}

beforeEach(() => {
  const todos = getTodos();
  collection = {
    data: todos,
    delete: async (id: string) => { 
      const idx = collection.data.findIndex(t => t.id === id);
      if (idx > -1) collection.data.splice(idx, 1);
    },
    update: async (id: string, data: Partial<Todo>) => {
      const idx = collection.data.findIndex(t => t.id === id);
      if (idx > -1) {
        collection.data[idx] = { ...collection.data[idx], ...data };
        return collection.data[idx];
      }
      throw new Error('Not found');
    },
  };
});

describe('Hybrid QueryBuilder', () => {
  it('filters with callback predicate', async () => {
    const builder = new QueryBuilder<Todo>(collection);
    const result = await builder
      .where(todo => todo.completed === false)
      .get();
    expect(result.map(r => r.id)).toEqual(['1', '3', '4']);
  });

  it('filters with object syntax', async () => {
    const builder = new QueryBuilder<Todo>(collection);
    const result = await builder
      .where({ completed: true, priority: 5 })
      .get();
    expect(result.map(r => r.id)).toEqual(['2']);
  });

  it('filters using operator syntax', async () => {
    const builder = new QueryBuilder<Todo>(collection);
    const result = await builder
      .where({ priority: gte(6) })
      .get();
    expect(result.map(r => r.id)).toEqual(['1', '3', '5']);
  });

  it('filters with proxy callback', async () => {
    const builder = new QueryBuilder<Todo>(collection);
    const result = await builder
      .where(f => f.completed.eq(false))
      .where(f => f.priority.gte(6))
      .get();
    expect(result.map(r => r.id)).toEqual(['1', '3']);
  });

  it('filters with direct field references', async () => {
    const fields = createFieldsProxy<Todo>();
    const builder = new QueryBuilder<Todo>(collection);
    const result = await builder
      .where(fields.completed.eq(false))
      .where(fields.tags.contains('work'))
      .get();
    expect(result.map(r => r.id)).toEqual(['1', '3']);
  });

  it('handles logical operators (and/or/not)', async () => {
    const builder = new QueryBuilder<Todo>(collection);
    const result = await builder
      .where(and(
        { completed: false },
        or(
          { tags: contains('urgent') },
          { text: contains('milk') }
        )
      ))
      .get();
    expect(result.map(r => r.id)).toEqual(['3', '4']);
  });

  it('sorts, limits and offsets results', async () => {
    const builder = new QueryBuilder<Todo>(collection);
    const result = await builder
      .orderBy('createdAt', 'desc')
      .limit(2)
      .offset(1)
      .get();
    expect(result.map(r => r.createdAt)).toEqual([100, 80]); // 130 skipped by offset(1)
  });

  it('returns first, last, count, exists', async () => {
    const builder = new QueryBuilder<Todo>(collection);
    expect((await builder.where({ completed: false }).first())?.id).toBe('1');
    expect((await builder.where({ completed: false }).last())?.id).toBe('4');
    
    const query = new QueryBuilder<Todo>(collection);
    expect(await query.where({ tags: contains('dev') }).count()).toBe(2);
    expect(await builder.where({ text: 'Nope' }).exists()).toBe(false);
  });

  it('aggregates: sum, avg, min, max', async () => {
    const builder = new QueryBuilder<Todo>(collection);
    expect(await builder.where({ completed: false }).sum('priority')).toBe(7 + 6 + 3);
    expect(await builder.where({ completed: false }).avg('priority')).toBe((7 + 6 + 3) / 3);

    expect(await createBuilder().min('createdAt')).toBe(30);
    expect(await createBuilder().max('priority')).toBe(9);
  });

  it('can delete and update with query', async () => {
    // delete all completed
    let builder = new QueryBuilder<Todo>(collection);
    const count = await builder.where({ completed: true }).delete();
    expect(count).toBe(2);
    expect(collection.data.some(t => t.completed)).toBe(false);

    // update all remaining to completed
    builder = new QueryBuilder<Todo>(collection);
    const updated = await builder.where({ completed: false }).update({ completed: true });
    expect(updated).toBe(3);
    expect(collection.data.every(t => t.completed)).toBe(true);
  });

  it('supports null/notNull, between, in, notIn', async () => {
    const builder = new QueryBuilder<Todo>(collection);
    expect((await builder.where({ assignee: isNull() }).count())).toBe(2);
    
    expect((await createBuilder().where({ assignee: isNotNull() }).count())).toBe(3);

    expect(await createBuilder().where({ createdAt: between(70, 130) }).pluck('id')).toEqual(['1', '2', '3', '4']);
    expect(await createBuilder().where({ id: inArray(['1', '5']) }).pluck('id')).toEqual(['1', '5']);
    expect(await createBuilder().where({ priority: notInArray([3, 5, 6]) }).pluck('id')).toEqual(['1', '5']);
  });


  it('supports contains, startsWith, endsWith string operators', async () => {
    // contains
    let builder = new QueryBuilder<Todo>(collection);
    let result = await builder.where({ text: contains('milk') }).get();
    expect(result.map(r => r.id)).toEqual(['4']);
  
    // startsWith
    builder = new QueryBuilder<Todo>(collection);
    result = await builder.where({ text: startsWith('Urg') }).get();
    expect(result.map(r => r.id)).toEqual(['1']);
  
    // endsWith
    builder = new QueryBuilder<Todo>(collection);
    result = await builder.where({ text: endsWith('mail') }).get();
    expect(result.map(r => r.id)).toEqual(['1']);
  });
  
  it('supports between for numbers', async () => {
    const builder = new QueryBuilder<Todo>(collection);
    const result = await builder.where({ createdAt: between(80, 120) }).get();
    expect(result.map(r => r.id)).toEqual(['1', '4']);
  });
  
  it('supports isNull and isNotNull', async () => {
    const builder = new QueryBuilder<Todo>(collection);
    const nullAssignee = await builder.where({ assignee: isNull() }).get();
    expect(nullAssignee.map(r => r.id)).toContain('2');
    expect(nullAssignee.map(r => r.id)).toContain('3');

    const notNullAssignee = await createBuilder().where({ assignee: isNotNull() }).get();
    
    const notNullAssigneeIds = notNullAssignee.map(r => r.id);
    expect(notNullAssigneeIds).toContain('1');
    expect(notNullAssigneeIds).toContain('4');
    expect(notNullAssigneeIds).toContain('5');
  });
  
  it('creates and uses a FieldProxy for every field and method', async () => {
    const fields = createFieldsProxy<Todo>();
    // eq
    expect(fields.completed.eq(true)).toMatchObject({ fieldName: 'completed' });
    // ne
    expect(fields.text.ne('test')).toMatchObject({ fieldName: 'text' });
    // gt/gte/lt/lte
    expect(fields.priority.gt(1)).toMatchObject({ fieldName: 'priority' });
    expect(fields.priority.gte(1)).toMatchObject({ fieldName: 'priority' });
    expect(fields.priority.lt(10)).toMatchObject({ fieldName: 'priority' });
    expect(fields.priority.lte(10)).toMatchObject({ fieldName: 'priority' });
    // in/notIn
    expect(fields.tags.in(['dev'])).toMatchObject({ fieldName: 'tags' });
    expect(fields.tags.notIn(['dev'])).toMatchObject({ fieldName: 'tags' });
    // contains/startsWith/endsWith for strings
    expect(fields.text.contains('abc')).toMatchObject({ fieldName: 'text' });
    expect(fields.text.startsWith('a')).toMatchObject({ fieldName: 'text' });
    expect(fields.text.endsWith('b')).toMatchObject({ fieldName: 'text' });
    // between
    expect(fields.createdAt.between(1, 2)).toMatchObject({ fieldName: 'createdAt' });
    // isNull/isNotNull
    expect(fields.assignee.isNull()).toMatchObject({ fieldName: 'assignee' });
    expect(fields.assignee.isNotNull()).toMatchObject({ fieldName: 'assignee' });
    // ordering
    expect(fields.priority.asc()).toMatchObject({ fieldName: 'priority', direction: 'asc' });
    expect(fields.priority.desc()).toMatchObject({ fieldName: 'priority', direction: 'desc' });
  });
  
});