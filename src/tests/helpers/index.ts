/**
 * Test Helpers for sveltekit-sync
 * 
 * Following Sveltest best practices, these helpers provide:
 * - Mock adapters for isolated unit testing
 * - Test data generators for consistent test scenarios
 * - Utility functions for async testing
 * 
 * @see https://sveltest.dev/docs/best-practices
 */
import { vi } from 'vitest';
import type { LocalAdapter, SyncOperation, SyncResult, SyncConfig, Conflict } from '$pkg/types.js';

/**
 * Creates a mock LocalAdapter for testing client-side sync operations
 * 
 * Features:
 * - In-memory storage for isolation
 * - All methods are vi.fn() mocks for verification
 * - Includes test utilities for direct state manipulation
 */
export function createMockLocalAdapter(
	overrides: Partial<LocalAdapter> = {}
): LocalAdapter & {
	_storage: Map<string, Map<string, Record<string, unknown>>>;
	_queue: Map<string, SyncOperation>;
	_reset: () => void;
} {
	const storage = new Map<string, Map<string, Record<string, unknown>>>();
	const queue = new Map<string, SyncOperation>();
	let lastSync = 0;
	const clientId = 'test-client-' + Math.random().toString(36).slice(2, 11);
	let isInitialized = false;

	const getTable = (table: string): Map<string, Record<string, unknown>> => {
		if (!storage.has(table)) {
			storage.set(table, new Map());
		}
		return storage.get(table)!;
	};

	return {
		insert: vi.fn().mockImplementation(async (table: string, data: Record<string, unknown>) => {
			getTable(table).set(data.id as string, { ...data });
			return { ...data };
		}),

		update: vi.fn().mockImplementation(async (table: string, id: string, data: Record<string, unknown>) => {
			const existing = getTable(table).get(id);
			const updated = { ...existing, ...data, id };
			getTable(table).set(id, updated);
			return updated;
		}),

		delete: vi.fn().mockImplementation(async (table: string, id: string) => {
			getTable(table).delete(id);
		}),

		find: vi.fn().mockImplementation(async (table: string) => {
			return Array.from(getTable(table).values());
		}),

		findOne: vi.fn().mockImplementation(async (table: string, id: string) => {
			return getTable(table).get(id) || null;
		}),

		addToQueue: vi.fn().mockImplementation(async (op: SyncOperation) => {
			queue.set(op.id, op);
		}),

		getQueue: vi.fn().mockImplementation(async () => {
			return Array.from(queue.values());
		}),

		removeFromQueue: vi.fn().mockImplementation(async (ids: string[]) => {
			ids.forEach((id) => queue.delete(id));
		}),

		updateQueueStatus: vi.fn().mockImplementation(
			async (id: string, status: SyncOperation['status'], error?: string) => {
				const op = queue.get(id);
				if (op) {
					queue.set(id, { ...op, status, error });
				}
			}
		),

		getLastSync: vi.fn().mockImplementation(async () => lastSync),

		setLastSync: vi.fn().mockImplementation(async (timestamp: number) => {
			lastSync = timestamp;
		}),

		getClientId: vi.fn().mockImplementation(async () => clientId),

		isInitialized: vi.fn().mockImplementation(async () => isInitialized),

		setInitialized: vi.fn().mockImplementation(async (value: boolean) => {
			isInitialized = value;
		}),

		// Test utilities for direct state manipulation
		_storage: storage,
		_queue: queue,
		_reset: () => {
			storage.clear();
			queue.clear();
			lastSync = 0;
			isInitialized = false;
		},

		...overrides
	} as LocalAdapter & {
		_storage: Map<string, Map<string, Record<string, unknown>>>;
		_queue: Map<string, SyncOperation>;
		_reset: () => void;
	};
}

/**
 * Creates mock remote functions for testing sync operations
 * 
 * Simulates server-side push/pull behavior with in-memory storage
 */
export function createMockRemote(
	overrides: Partial<{
		push: (ops: SyncOperation[]) => Promise<SyncResult>;
		pull: (lastSync: number, clientId: string) => Promise<SyncOperation[]>;
		resolve: (conflict: Conflict) => Promise<SyncOperation>;
	}> = {}
) {
	const pushedOperations: SyncOperation[] = [];
	const serverData: SyncOperation[] = [];

	return {
		push: vi.fn().mockImplementation(async (ops: SyncOperation[]): Promise<SyncResult> => {
			pushedOperations.push(...ops);
			return {
				success: true,
				synced: ops.map((op) => op.id),
				conflicts: [],
				errors: []
			};
		}),

		pull: vi.fn().mockImplementation(async (): Promise<SyncOperation[]> => {
			return serverData;
		}),

		resolve: vi.fn().mockImplementation(async (conflict: Conflict): Promise<SyncOperation> => {
			return conflict.operation;
		}),

		// Test utilities
		_pushedOperations: pushedOperations,
		_serverData: serverData,
		_addServerData: (op: SyncOperation) => serverData.push(op),
		_reset: () => {
			pushedOperations.length = 0;
			serverData.length = 0;
		},

		...overrides
	};
}

/**
 * Creates a test sync config with sensible defaults
 */
export function createTestSyncConfig<TLocalDB = unknown, TRemoteDB = unknown>(
	overrides: Partial<SyncConfig<TLocalDB, TRemoteDB>> = {}
): SyncConfig<TLocalDB, TRemoteDB> {
	const adapter = createMockLocalAdapter();
	const remote = createMockRemote();

	return {
		local: {
			db: null as TLocalDB,
			adapter: adapter as unknown as LocalAdapter<TLocalDB>
		},
		remote: {
			push: remote.push,
			pull: remote.pull,
			resolve: remote.resolve
		},
		syncInterval: 0, // Disable auto-sync by default for predictable testing
		batchSize: 50,
		conflictResolution: 'last-write-wins',
		retryAttempts: 3,
		retryDelay: 100,
		onSync: vi.fn(),
		onConflict: vi.fn(),
		onError: vi.fn(),
		...overrides
	};
}

/**
 * Creates a SyncOperation for testing
 */
export function createTestOperation(
	overrides: Partial<SyncOperation> = {}
): SyncOperation {
	return {
		id: 'test-op-' + Math.random().toString(36).slice(2, 11),
		table: 'todos',
		operation: 'insert',
		data: { id: 'test-item-' + Math.random().toString(36).slice(2, 11), text: 'Test item' },
		timestamp: Date.now(),
		clientId: 'test-client',
		version: 1,
		status: 'pending',
		...overrides
	};
}

/**
 * Creates a test todo item with sync metadata
 */
export function createTestTodo(overrides: Partial<{
	id: string;
	text: string;
	completed: boolean;
	userId: string;
	_version: number;
	_updatedAt: Date;
	_isDeleted: boolean;
	_clientId: string;
}> = {}) {
	return {
		id: 'todo-' + Math.random().toString(36).slice(2, 11),
		text: 'Test todo',
		completed: false,
		userId: 'user-1',
		_version: 1,
		_updatedAt: new Date(),
		_isDeleted: false,
		_clientId: 'client-1',
		...overrides
	};
}

/**
 * Wait for a condition to be true (useful for async testing)
 * 
 * @param condition - Function that returns boolean or Promise<boolean>
 * @param timeout - Maximum time to wait in milliseconds
 * @param interval - Time between checks in milliseconds
 */
export async function waitFor(
	condition: () => boolean | Promise<boolean>,
	timeout = 5000,
	interval = 50
): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (await condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, interval));
	}
	throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Delay for a specified time
 */
export function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock BroadcastChannel for Node.js environment
 * 
 * Required for testing multi-tab sync coordination
 */
export class MockBroadcastChannel {
	name: string;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	private static channels = new Map<string, Set<MockBroadcastChannel>>();
	private closed = false;

	constructor(name: string) {
		this.name = name;
		if (!MockBroadcastChannel.channels.has(name)) {
			MockBroadcastChannel.channels.set(name, new Set());
		}
		MockBroadcastChannel.channels.get(name)!.add(this);
	}

	postMessage(message: unknown): void {
		if (this.closed) {
			return;
		}
		const channels = MockBroadcastChannel.channels.get(this.name);
		if (channels) {
			channels.forEach((channel) => {
				if (channel !== this && channel.onmessage && !channel.closed) {
					try {
						channel.onmessage({ data: message });
					} catch {
						// Ignore errors from message handlers
					}
				}
			});
		}
	}

	close(): void {
		this.closed = true;
		const channels = MockBroadcastChannel.channels.get(this.name);
		if (channels) {
			channels.delete(this);
		}
	}

	static reset(): void {
		this.channels.clear();
	}
}

/**
 * Set up global BroadcastChannel mock for tests
 */
export function setupBroadcastChannelMock(): void {
	if (typeof globalThis.BroadcastChannel === 'undefined') {
		(globalThis as unknown as { BroadcastChannel: typeof MockBroadcastChannel }).BroadcastChannel = MockBroadcastChannel;
	} else {
		(globalThis as unknown as { BroadcastChannel: typeof MockBroadcastChannel }).BroadcastChannel = MockBroadcastChannel;
	}
}
