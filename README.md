# 🔄 SvelteKit Sync

**A production-ready, local-first sync engine for SvelteKit with optimistic updates, real-time synchronization, and support for any database.**

[![npm version](https://badge.fury.io/js/sveltekit-sync.svg)](https://www.npmjs.com/package/sveltekit-sync)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Svelte 5](https://img.shields.io/badge/Svelte-5.0-ff3e00.svg)](https://svelte.dev/)

## ✨ Features

- 🚀 **Instant UI Updates** - Optimistic updates for zero-latency UX
- 🔄 **Real-time Sync** - Changes appear instantly across all devices
- 📡 **Offline-First** - Works seamlessly without internet connection
- 🗄️ **Database Agnostic** - Works with any client DB (IndexedDB, SQLite, PGlite) and server DB (Postgres, MongoDB, MySQL, etc.)
- ⚡ **Powered by Remote Functions** - Uses SvelteKit's new Remote Functions API
- 🎯 **Type-Safe** - Full TypeScript support with excellent IntelliSense
- 🔐 **Secure** - Built-in row-level security and data filtering
- 🎨 **Ergonomic API** - Simple, intuitive developer experience
- 🔀 **Conflict Resolution** - Multiple strategies for handling conflicts
- 📦 **Modular** - Install only what you need

## 📦 Installation

```bash

npm install sveltekit-sync # or your favorite package manager

```

## 🚀 Quick Start

### 1. Set Up Database Schema

```typescript
// src/lib/server/database/schema.ts
import { pgTable, text, boolean, timestamp, integer, uuid } from 'drizzle-orm/pg-core';

export const todos = pgTable('todos', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  text: text('text').notNull(),
  completed: boolean('completed').default(false),
  
  // Required sync metadata
  _version: integer('_version').notNull().default(1),
  _updatedAt: timestamp('_updated_at').notNull().defaultNow(),
  _clientId: text('_client_id'),
  _isDeleted: boolean('_is_deleted').default(false)
});
```

### 2. Configure Server Sync

```typescript
// src/lib/server/sync-schema.ts
import { sql } from 'drizzle-orm';

export const syncSchema = {
  tables: {
    todos: {
      table: 'todos',
      columns: ['id', 'text', 'completed', 'userId', '_version', '_updatedAt'],
      // Row-level security - only sync user's own data
      where: (userId: string) => sql`user_id = ${userId}`,
      conflictResolution: 'last-write-wins'
    }
  }
};
```

### 3. Create Remote Functions

```typescript
// src/lib/sync.remote.ts
import { query, command } from '$app/server';
import * as v from 'valibot';
import { ServerSyncEngine } from '$lib/server/sync-engine';
import { getUser } from '$lib/server/auth';

const syncEngine = new ServerSyncEngine();

export const pushChanges = command(
  v.array(SyncOperationSchema),
  async (operations, { request }) => {
    const user = await getUser(request);
    return await syncEngine.push(operations, user.id);
  }
);

export const pullChanges = query(
  v.object({ lastSync: v.number(), clientId: v.string() }),
  async ({ lastSync, clientId }, { request }) => {
    const user = await getUser(request);
    return await syncEngine.pull(lastSync, clientId, user.id);
  }
);
```

### 4. Initialize Client

```typescript
// src/lib/db.ts
import { SyncEngine, IndexedDBAdapter } from 'sveltekit-sync';
import { pushChanges, pullChanges } from '$lib/sync.remote';

const adapter = new IndexedDBAdapter('myapp-db', 1);

export const syncEngine = new SyncEngine({
  local: { db: null, adapter },
  remote: { push: pushChanges, pull: pullChanges },
  syncInterval: 30000, // Sync every 30 seconds
  conflictResolution: 'last-write-wins'
});

export async function initDB() {
  await adapter.init({ todos: 'id', notes: 'id' });
  await syncEngine.init();
}

// Create typed collection stores
export const todosStore = syncEngine.collection('todos');
```

### 5. Initialize in Root Layout

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { initDB, syncEngine } from '$lib/db';
  import { browser } from '$app/environment';

  onMount(async () => {
    if (browser) {
      await initDB();
    }
    return () => syncEngine.destroy();
  });

  const syncState = $derived(syncEngine.state);
</script>

<div class="app">
  {#if syncState.isSyncing}
    <div class="sync-indicator">Syncing...</div>
  {/if}
  <slot />
</div>
```

### 6. Use in Components

```svelte
<!-- src/routes/todos/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { todosStore } from '$lib/db';

  let newTodo = $state('');

  onMount(() => todosStore.load());

  async function addTodo() {
    await todosStore.create({
      text: newTodo,
      completed: false,
      createdAt: Date.now()
    });
    newTodo = '';
  }

  async function toggleTodo(id: string) {
    const todo = todosStore.find(t => t.id === id);
    if (todo) {
      await todosStore.update(id, { completed: !todo.completed });
    }
  }
</script>

<input bind:value={newTodo} on:keydown={(e) => e.key === 'Enter' && addTodo()} />

<ul>
  {#each todosStore.data as todo (todo.id)}
    <li>
      <input 
        type="checkbox" 
        checked={todo.completed}
        onchange={() => toggleTodo(todo.id)}
      />
      {todo.text}
      <button onclick={() => todosStore.delete(todo.id)}>Delete</button>
    </li>
  {/each}
</ul>
```

## 📚 Core Concepts

### Optimistic Updates

All CRUD operations apply changes **immediately** to the local database and UI, then sync in the background:

```typescript
await todosStore.create({ text: 'Buy milk' }); 
// ✅ UI updates instantly
// 🔄 Syncs to server in background
```

### Collection Stores

Collection stores provide a reactive, ergonomic API:

```typescript
const todosStore = syncEngine.collection('todos');

// Reactive state
todosStore.data         // Current data array
todosStore.isLoading    // Loading state
todosStore.error        // Error state
todosStore.count        // Item count
todosStore.isEmpty      // Empty check

// CRUD operations
await todosStore.create(data)
await todosStore.update(id, data)
await todosStore.delete(id)
await todosStore.findOne(id)

// Utility methods
todosStore.find(predicate)
todosStore.filter(predicate)
todosStore.sort(compareFn)
```

### Conflict Resolution

Built-in strategies for handling conflicts:

- **`client-wins`** - Client changes always win
- **`server-wins`** - Server changes always win
- **`last-write-wins`** - Most recent change wins (default)
- **`manual`** - Custom resolution logic

```typescript
export const syncEngine = new SyncEngine({
  conflictResolution: 'last-write-wins',
  onConflict: (conflict) => {
    console.log('Conflict detected:', conflict);
  }
});
```

## 🗄️ Database Adapters

### Client Adapters

- **IndexedDB** (built-in) - Browser storage
- **SQLite** - Coming soon
- **PGlite** - Coming soon

### Server Adapters

- **Drizzle ORM** - `sveltekit-sync/adapters/drizzle`
- **Prisma** - Coming soon
- **Postgres** - Coming soon
- **MongoDB** - Coming soon

## 🎯 Advanced Features (WIP/To be Implemented)

### Query Builder

```typescript
const active = await todosStore
  .query()
  .where('completed', false)
  .orderBy('createdAt', 'desc')
  .limit(10)
  .get();
```

### Relationships

```typescript
const projectsStore = syncEngine.collection('projects', {
  relations: {
    tasks: { type: 'hasMany', collection: 'tasks', key: 'projectId' }
  }
});

const project = await projectsStore.withRelations(['tasks']).findOne(id);
```

### Middleware/Hooks

```typescript
todosStore.before('create', (data) => ({
  ...data,
  createdBy: currentUser.id
}));

todosStore.after('update', (data) => {
  analytics.track('todo_updated', data);
});
```

### Batch Operations

```typescript
await todosStore.batch()
  .create({ text: 'Task 1' })
  .create({ text: 'Task 2' })
  .update(id, { completed: true })
  .commit();
```

### Real-time Subscriptions

```typescript
const unsubscribe = todosStore.subscribe((todos) => {
  console.log('Todos updated:', todos);
});
```

## 🔐 Security

### Row-Level Security

Control what each user can access:

```typescript
export const syncSchema = {
  tables: {
    todos: {
      where: (userId: string) => sql`user_id = ${userId}`
    }
  }
};
```

### Data Transformation

Remove sensitive fields before syncing:

```typescript
export const syncSchema = {
  tables: {
    users: {
      transform: (user) => {
        const { password, internalNotes, ...safe } = user;
        return safe;
      }
    }
  }
};
```

## 📊 Performance

- **Delta Sync** - Only changed records are synced
- **Batch Operations** - Multiple changes sent in single request
- **Intelligent Caching** - Frequently accessed data cached in memory
- **Connection Pooling** - Efficient resource usage
- **Compression** - Automatic payload compression

## 🧪 Testing

```bash
npm test                 # Run all tests
npm run test:unit        # Unit tests
npm run test:integration # Integration tests
npm run test:e2e         # End-to-end tests
```

## 📖 API Reference

Full API documentation available at [sveltekit-sync.mudiageo.me](https://sveltekit-sync.mudiageo.me)

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

MIT © Mudiaga Arharhire

## 🙏 Acknowledgments

- Built with [SvelteKit](https://svelte.dev/docs/kit)
- Inspired by [LiveStore](https://livestore.dev/) and other prior sync and local-first libraries
