# 🤖 Agent Guide: SvelteKit Sync

This document is designed to help AI agents understand, generate code for, and work with the `sveltekit-sync` library.

## 📋 Project Overview

`sveltekit-sync` is a local-first synchronization engine built specifically for SvelteKit. It enables:
- **Optimistic UI Updates**: Immediate feedback for user actions.
- **Offline Support**: Full functionality without network connectivity.
- **Real-time Sync**: Background synchronization when online.
- **Database Agnostic**: Works with various adapters (IndexedDB client-side, Drizzle/Postgres server-side).

## 🏗️ Architecture

The library is organized into:
1.  **Core Library (`src/pkg`)**: Contains shared types, client-side logic, local state management, and storage adapters. Built using **Svelte 5 Runes**.
2.  **Server Modules (`src/pkg/server`)**: Contains server-only code for conflict resolution, authorization, and persistence to the server database.

### Key Files & Components

| File | Component | Description |
|------|-----------|-------------|
| `src/pkg/sync.svelte.ts` | `SyncEngine` | Main client-side class. Manages `collection` stores, sync queue, and network communication. |
| `src/pkg/server/sync-engine.ts` | `ServerSyncEngine` | Main server-side class. Processes push/pull requests, handles conflicts, and updates the DB. |
| `src/pkg/types.ts` | `SyncOperation`, `SyncResult` | Shared TypeScript definitions. **Crucial for understanding the data flow.** |
| `src/pkg/adapters/*` | Adapters | Storage adapters for different environments (IndexedDB, Drizzle, etc.). |

## 💻 Usage Patterns

### 1. Schema Definition (Server)
The library expects specific columns in your database tables for tracking sync state.
- `_version`: Integer (optimistic locking)
- `_updatedAt`: Timestamp
- `_clientId`: String (origin of last change)
- `_isDeleted`: Boolean (soft deletes)

**Example (Drizzle):**
```typescript
export const syncMetadata = {
  _version: integer('_version').notNull().default(1),
  _updatedAt: timestamp('_updated_at').notNull().defaultNow(),
  _clientId: text('_client_id'),
  _isDeleted: boolean('_is_deleted').default(false)
};

export const todos = pgTable('todos', {
  id: uuid('id').primaryKey().defaultRandom(),
  ...syncMetadata
});
```

### 2. Server-Side Setup
Use `ServerSyncEngine` in a SvelteKit API route or Remote Function.

```typescript
// src/lib/server/sync.ts
import { ServerSyncEngine } from '$pkg/server/sync-engine';
import { DrizzleAdapter } from '$pkg/adapters/drizzle';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';

const adapter = new DrizzleAdapter({ db, schema });
export const syncEngine = new ServerSyncEngine(adapter, {
    tables: {
        todos: { table: 'todos', conflictResolution: 'last-write-wins' }
    }
});
```

### 3. Client-Side Setup
Initialize `SyncEngine` with a local adapter and remote push/pull functions.

```typescript
// src/lib/db.ts
import { SyncEngine } from '$pkg/sync.svelte';
import { IndexedDBAdapter } from '$pkg/adapters/indexeddb';

export const syncEngine = new SyncEngine({
    local: { adapter: new IndexedDBAdapter('my-db', 1), db: null },
    remote: {
        push: async (ops) => { /* call server */ },
        pull: async (lastSync, clientId) => { /* call server */ }
    }
});

// Create a collection store
export const todosStore = syncEngine.collection('todos');
```

### 4. Using Stores (Svelte Components)
The stores are reactive Svelte 5 state objects.

```svelte
<script>
    import { todosStore } from '$lib/db';

    // Read data (reactive)
    let todos = $derived(todosStore.data);

    // Mutations (Async, but optimistic)
    function add() {
        todosStore.create({ text: 'New Item', completed: false });
    }
</script>

{#each todos as todo (todo.id)}
    <div>{todo.text}</div>
{/each}
```

## 🧩 Code Generation Guidelines

When generating code for this library, follow these rules:

1.  **Svelte 5 First**: Always use Runes (`$state`, `$derived`, `$effect`) instead of legacy stores (`writable`, `derived`) when interacting with the library's internals or creating UI components.
2.  **Type Safety**: Always import types from `$pkg/types` or `$lib/types`. Ensure `SyncOperation` objects are correctly formed.
3.  **Optimistic UI**: Assume operations succeed. The library handles rollback on error. Do not await `create`/`update` calls unless you specifically need the server response (e.g., for a generated ID, though IDs should ideally be client-generated UUIDs).
4.  **Soft Deletes**: Remember that `delete` operations set `_isDeleted: true`. Queries should filter these out (the library's `collection` store does this automatically).
5.  **Validation**: Use `valibot` (as seen in the project) or `zod` for validating data before passing it to the sync engine if input validation is required.
6.  **Testing**: Always create relevant tests for new features or bug fixes.
    - Use `vitest` for unit tests (colocate with source or in `src/pkg/**/*.test.ts`).
    - Ensure tests cover happy paths, error cases, and edge cases.
    - Run `pnpm test:unit` to verify your changes.

## ⚠️ Common Pitfalls

- **Missing Metadata**: Forgetting to add `syncMetadata` columns to new tables will break sync.
- **ID Generation**: IDs should be generated on the client (crypto.randomUUID() recommended) to avoid round-trip latency for inserts.
- **Reactivity**: `todosStore.data` is a `$derived` value. Do not mutate it directly. Use `todosStore.update(id, changes)`.

## 🛠️ Development Guidelines

### Package Management
This project uses **pnpm**.
- Install dependencies: `pnpm install`
- Run dev server: `pnpm dev`

### Testing
- **Unit Tests**: `pnpm test:unit` (uses Vitest)
- **Full Test Suite**: `pnpm test`

### Linting & Formatting
- **Lint**: `pnpm lint` (ESLint)
- **Type Check**: `pnpm check` (svelte-check)

### Versioning & Publishing
This project uses **Changesets** for version management.
1.  **Make Changes**: Implement your feature or fix.
2.  **Add Changeset**: Run `pnpm changeset` and follow the prompts to document your changes (patch/minor/major).
3.  **Commit**: Commit the changeset file along with your code changes.
    - *Note*: Separate `src/lib` (test env) changes from `src/pkg` (library) changes if possible. Only create changesets for `src/pkg` modifications.

## 🧠 Agent Best Practices

### 1. 🚧 Strict Directory Boundaries
**Rule**: Never import `src/lib` code into `src/pkg`. `src/pkg` must remain standalone and publishable.
- **Context**: `src/pkg` is the product (the library). `src/lib` is the test/demo environment.
- **Check**: Ensure no imports in `src/pkg` start with `$lib`.

### 2. ⚡ Async Patterns for Optimistic UI
**Guideline**: For UI actions (create/update/delete), **DO NOT await the network request** before updating the UI state.
- **Why**: The sync engine handles the background request and eventual consistency.
- **Pattern**: Update local state immediately -> Sync engine queues request -> UI reflects change instantly.

### 3. 📦 Dependency Discipline
**Rule**: Do not add new runtime dependencies to `package.json` without explicit user approval.
- **Why**: This is a library; bundle size and dependency tree complexity matter.
- **Action**: Use existing dependencies or implement lightweight solutions internally.

### 4. 🔒 Server vs. Client Isolation
**Guideline**: Ensure server-only code is never imported in client-side files.
- **Risk**: Importing `drizzle-orm` or `ServerSyncEngine` in `.svelte` files will break the build.
- **Solution**: Use `import type` for shared interfaces. Keep server code in `src/pkg/server`.

### 5. 🧪 Test-Driven Fixes
**Workflow**: When fixing a bug, **first** create a failing test case.
1.  Create a test in `src/tests/**/*` that reproduces the bug.
2.  Verify it fails.
3.  Fix the code.
4.  Verify the test passes.

## 🔍 Debugging & Troubleshooting

Agents often encounter issues where "it doesn't work." Use this checklist:

### Client-Side
- **IndexedDB**: Check `Application > IndexedDB` in DevTools to verify data is being saved locally.
- **Network**: Look for `push` (POST) and `pull` (GET) requests in the Network tab.
- **Console**: Enable verbose logging if available or check for "Sync error" messages.

### Server-Side
- **Sync Log**: Check the `sync_log` table in the database. If it's empty, operations aren't reaching the server.
- **Server Logs**: Check the terminal output for `ServerSyncEngine` errors.

## 🔐 Security & Authorization Checklist

Since this is a sync engine, security is critical.

1.  **RLS Simulation**: Always verify that the `where` clause in `sync-schema` correctly filters data by `userId`.
    ```typescript
    where: (userId) => sql`user_id = ${userId}`
    ```
2.  **Immutable Fields**: Ensure `push` operations cannot modify system fields like `_userId` or `_version` directly (the engine should handle these, but verify).
3.  **Validation**: Validate all incoming data structure using `valibot` before passing to `syncEngine.push`.

## 🚀 Performance Best Practices

1.  **Batching**: Prefer `batchInsert` (if available) or parallel promises over looping `insert` for initial data loading.
2.  **Blobs**: **Do not sync large binary files** (images/videos) directly via the sync engine.
    - *Pattern*: Upload file to storage (S3/R2) -> Get URL -> Sync the URL string.
3.  **Selective Sync**: Only sync what is needed. Use `where` clauses to limit the initial pull size.

## 📂 Project Structure Map

Use this map to respect the **Strict Directory Boundaries** rule.

```text
src/
├── pkg/                  # 📦 THE LIBRARY (Publishable)
│   ├── adapters/         # Storage adapters (IndexedDB, Drizzle)
│   ├── server/           # Server-side logic (SyncEngine)
│   ├── sync.svelte.ts    # Client-side SyncEngine
│   └── types.ts          # Shared Types
│
├── lib/                  # 🧪 TEST APP (Playground)
│   ├── server/           # App-specific server code
│   ├── components/       # App UI components
│   └── db.ts             # App DB initialization
│
└── tests/                # 🚦 TEST SUITE
    └── unit/             # Vitest unit tests
```

