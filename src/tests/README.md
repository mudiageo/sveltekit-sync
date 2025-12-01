# sveltekit-sync Test Suite

This directory contains the comprehensive test suite for the sveltekit-sync library.
Tests are organized following [Sveltest best practices](https://sveltest.dev/docs/best-practices) with a
**Foundation First** approach and **Client-Server Alignment Strategy**.

## Unbreakable Rules

Following Sveltest principles:

- **Use Real APIs**: Test with real browser APIs (IndexedDB, BroadcastChannel) in client tests, not mocks
- **Foundation First**: Plan comprehensive test coverage using `.skip` blocks before implementation
- **Minimal Mocking**: Only mock external services (network requests), use real adapters otherwise
- **TypeScript Contracts**: Ensure data structures align across layers
- **Multi-Environment Testing**: Use correct environment for each test type
- **Isolation**: Each test should be independent with proper setup/teardown
- **Predictability**: Disable auto-sync (`syncInterval: 0`) for deterministic tests

## Directory Structure

```
src/tests/
├── unit/                              # Unit tests (isolated module testing)
│   ├── core/                          # Core library tests
│   │   ├── types.test.ts              # Type interface tests (server env)
│   │   └── sync-engine.svelte.test.ts # SyncEngine tests (browser env)
│   ├── server/                        # Server-side tests (Node.js)
│   │   ├── sync-engine.test.ts        # ServerSyncEngine tests
│   │   └── types.test.ts              # Server config type tests
│   └── adapters/                      # Storage adapter tests
│       ├── indexeddb.svelte.test.ts   # IndexedDB adapter (browser env)
│       └── drizzle.test.ts            # Drizzle adapter (Node.js env)
├── integration/                       # Integration tests (future)
├── e2e/                               # End-to-end tests (future)
├── helpers/                           # Test utilities
│   └── index.ts                       # Shared test helpers
└── README.md                          # This file
```

## Test Environments

Following Sveltest's multi-project Vitest setup, tests run in three different environments:

| File Pattern | Environment | Test Name | Use For |
|--------------|-------------|-----------|---------|
| `*.svelte.test.ts` | Browser (Playwright) | `client` | Browser APIs (IndexedDB, BroadcastChannel), Svelte components |
| `*.ssr.test.ts` | Node.js | `ssr` | Server-side rendering tests |
| `*.test.ts` | Node.js | `server` | Pure server logic, types, utilities |

### When to Use Each Environment

**Browser Environment (`*.svelte.test.ts`):**
- Tests that need IndexedDB (real browser storage)
- Tests that need BroadcastChannel (cross-tab communication)
- Tests for Svelte components using `vitest-browser-svelte`
- Tests for client-side SyncEngine with real reactive state
- Any test requiring real browser APIs

**SSR Environment (`*.ssr.test.ts`):**
- Testing how Svelte components render on the server
- Verifying server-side rendering output
- Testing hydration scenarios

**Node.js Environment (`*.test.ts`):**
- ServerSyncEngine tests
- Type validation tests  
- Pure function tests
- Server adapter tests (DrizzleAdapter with mocked database)
- Any test that doesn't need browser APIs

## Essential Commands

```bash
# Run all tests
pnpm test

# Run unit tests (all environments)
pnpm test:unit

# Run only client (browser) tests
pnpm test:unit -- --project client

# Run only server tests
pnpm test:unit -- --project server

# Run only SSR tests
pnpm test:unit -- --project ssr

# Run in watch mode
pnpm test:unit -- --watch

# Run specific test file
pnpm test:unit -- src/tests/unit/adapters/indexeddb.svelte.test.ts

# Run with coverage
pnpm test:coverage
```

## Writing Tests

### Client-Side Tests (Browser)

For tests needing browser APIs like IndexedDB:

```typescript
// indexeddb.svelte.test.ts - runs in browser
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBAdapter } from '$pkg/adapters/indexeddb.js';

describe('IndexedDBAdapter', () => {
  let adapter: IndexedDBAdapter;
  const testDbName = 'test-db-' + Math.random().toString(36).slice(2);

  beforeEach(async () => {
    adapter = new IndexedDBAdapter(testDbName, 1);
  });

  afterEach(async () => {
    // Clean up: delete test database
    indexedDB.deleteDatabase(testDbName);
  });

  it('should insert and retrieve records', async () => {
    await adapter.init({ todos: 'id' });
    
    await adapter.insert('todos', { id: 'todo-1', text: 'Test' });
    const found = await adapter.findOne('todos', 'todo-1');
    
    expect(found).toEqual({ id: 'todo-1', text: 'Test' });
  });
});
```

### Server-Side Tests (Node.js)

For server logic that doesn't need browser APIs:

```typescript
// sync-engine.test.ts - runs in Node.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerSyncEngine } from '$pkg/server/sync-engine.js';

describe('ServerSyncEngine', () => {
  it('should process push operations', async () => {
    const adapter = createMockServerAdapter();
    const engine = new ServerSyncEngine(adapter, config);
    
    const result = await engine.push([operation], 'user-1');
    
    expect(result.success).toBe(true);
  });
});
```

### SSR Tests

For testing server-side rendering:

```typescript
// component.ssr.test.ts - runs in Node.js for SSR
import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';
import MyComponent from './MyComponent.svelte';

describe('MyComponent SSR', () => {
  it('should render on server', () => {
    const { html } = render(MyComponent, { props: { title: 'Test' } });
    
    expect(html).toContain('Test');
  });
});
```

### Using Svelte 5 Runes in Tests

When testing reactive state with `$state` and `$derived`:

```typescript
import { untrack } from 'svelte';

it('should update reactive state', async () => {
  const engine = new SyncEngine(config);
  await engine.init();
  
  // Use untrack to read $derived values in tests
  const status = untrack(() => engine.state.status);
  expect(status).toBe('idle');
});
```

## Test Helpers

Located in `helpers/index.ts`:

- `createMockLocalAdapter()` - In-memory adapter for server-side tests
- `createMockRemote()` - Mock push/pull functions
- `createTestOperation()` - SyncOperation factory
- `createTestTodo()` - Test data factory
- `MockBroadcastChannel` - For Node.js tests only (browser tests use real API)
- `waitFor()` - Async condition helper

**Important**: For browser tests (`*.svelte.test.ts`), use real APIs instead of mocks!

## Test Scenarios Coverage

Tests should cover:

1. **Happy Paths**: Normal operation flow
2. **Error Cases**: Network failures, validation errors, conflicts
3. **Edge Cases**: Empty data, large payloads, unicode, concurrent operations
4. **Configuration Options**: All config options and their effects
5. **State Transitions**: Initialization, syncing, error states
6. **Real-World Workflows**: Complete CRUD lifecycles, offline→online sync

## Best Practices

1. **Use Real APIs**: In browser tests, use real IndexedDB, not mocks
2. **Isolation**: Each test creates its own database/adapter instance
3. **Cleanup**: Delete test databases in `afterEach`
4. **Unique Names**: Use random suffixes for test database names
5. **Predictability**: Set `syncInterval: 0` to disable auto-sync
6. **AAA Pattern**: Arrange, Act, Assert
7. **One Assertion Focus**: Each test should verify one behavior

## Coverage Goals

| Module | Target | Description |
|--------|--------|-------------|
| **Types** | 100% | All interfaces and type guards |
| **SyncEngine** | 100% | All public methods (browser tests) |
| **ServerSyncEngine** | 100% | Push/pull, conflict resolution |
| **IndexedDBAdapter** | 100% | CRUD, queue, metadata (browser tests) |
| **DrizzleAdapter** | 80%+ | With mocked Drizzle database |

## Related Documentation

- [Sveltest Getting Started](https://sveltest.dev/docs/getting-started)
- [Sveltest Best Practices](https://sveltest.dev/docs/best-practices)
- [Sveltest Testing Patterns](https://sveltest.dev/docs/testing-patterns)
- [vitest-browser-svelte](https://github.com/vitest-dev/vitest-browser-svelte)
- [Vitest Browser Mode](https://vitest.dev/guide/browser/)
