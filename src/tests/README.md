# sveltekit-sync Test Suite

This directory contains the comprehensive test suite for the sveltekit-sync library.
Tests are organized following [Sveltest best practices](https://sveltest.dev/docs/best-practices).

## Directory Structure

```
src/tests/
├── unit/                    # Unit tests (isolated component testing)
│   ├── core/               # Core library tests
│   │   ├── types.test.ts   # Type interface tests
│   │   └── sync-engine.test.ts  # SyncEngine & CollectionStore tests
│   └── server/             # Server-side tests
│       ├── sync-engine.test.ts  # ServerSyncEngine tests
│       └── types.test.ts   # Server config type tests
├── integration/            # Integration tests (component interaction)
│   └── (future tests)
├── e2e/                    # End-to-end tests (full user flows)
│   └── (future tests)
├── helpers/                # Test utilities and mocks
│   └── index.ts           # Mock adapters and test helpers
└── README.md              # This file
```

## Running Tests

```bash
# Run all tests
pnpm test

# Run unit tests only
pnpm test:unit

# Run tests with coverage
pnpm test:coverage

# Run tests in watch mode
pnpm test:unit -- --watch
```

## Test Categories

### Unit Tests (`unit/`)

Isolated tests for individual modules and functions:

- **core/types.test.ts** - Tests for type interfaces and type guards
- **core/sync-engine.test.ts** - Tests for SyncEngine and CollectionStore
- **server/sync-engine.test.ts** - Tests for ServerSyncEngine
- **server/types.test.ts** - Tests for server configuration types

### Integration Tests (`integration/`)

Tests for component interactions (to be added):

- Client-server sync integration
- Multi-table sync scenarios
- Conflict resolution workflows

### E2E Tests (`e2e/`)

Full user workflow tests (to be added):

- Complete sync cycles
- Offline/online transitions
- Multi-client scenarios

## Test Helpers (`helpers/`)

Reusable utilities for testing:

- `createMockLocalAdapter()` - Mock client-side storage adapter
- `createMockRemote()` - Mock server push/pull functions
- `createTestSyncConfig()` - Pre-configured test setup
- `createTestOperation()` - SyncOperation factory
- `createTestTodo()` - Test data factory
- `MockBroadcastChannel` - BroadcastChannel mock for Node.js
- `waitFor()` - Async condition helper
- `delay()` - Timer utility

## Writing New Tests

Follow the **Foundation First** approach:

```typescript
describe('NewFeature', () => {
	// Plan all test cases first
	it.skip('should handle case A', () => {});
	it.skip('should handle case B', () => {});
	it.skip('should handle error case', () => {});
	
	// Then implement one by one
});
```

### Test Naming Conventions

- **Files**: `{module}.test.ts` for unit tests
- **Describe blocks**: Module or class name
- **It blocks**: `should {action} when {condition}`

### Using Helpers

```typescript
import { 
	createMockLocalAdapter,
	createMockRemote,
	createTestOperation,
	MockBroadcastChannel,
	setupBroadcastChannelMock
} from '../../helpers/index.js';

// Set up global mocks
setupBroadcastChannelMock();

describe('MyTest', () => {
	let adapter: ReturnType<typeof createMockLocalAdapter>;
	
	beforeEach(() => {
		adapter = createMockLocalAdapter();
		MockBroadcastChannel.reset();
	});
	
	it('should work', async () => {
		const op = createTestOperation({ table: 'todos' });
		// ...test logic
	});
});
```

## Best Practices

1. **Isolation**: Each test should be independent
2. **Predictability**: Disable auto-sync (`syncInterval: 0`) for deterministic tests
3. **Coverage**: Test happy paths, error cases, and edge cases
4. **Mocking**: Use provided helpers for consistent mocking
5. **Cleanup**: Reset mocks in `afterEach` hooks

## Coverage Goals

- **Types**: 100% interface coverage
- **SyncEngine**: All public methods and state transitions
- **ServerSyncEngine**: Push/pull operations, conflict resolution
- **Adapters**: CRUD operations, queue management
