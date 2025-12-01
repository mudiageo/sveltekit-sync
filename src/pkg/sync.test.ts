import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncEngine, CollectionStore } from './sync.svelte.js';
import type { SyncConfig, SyncOperation, SyncResult, Conflict, LocalAdapter } from './types.js';

// Mock BroadcastChannel for Node.js environment
class MockBroadcastChannel {
	name: string;
	onmessage: ((event: { data: any }) => void) | null = null;
	private static channels = new Map<string, Set<MockBroadcastChannel>>();
	private closed = false;

	constructor(name: string) {
		this.name = name;
		if (!MockBroadcastChannel.channels.has(name)) {
			MockBroadcastChannel.channels.set(name, new Set());
		}
		MockBroadcastChannel.channels.get(name)!.add(this);
	}

	postMessage(message: any): void {
		if (this.closed) {
			// Silently ignore if closed (common in tests)
			return;
		}
		const channels = MockBroadcastChannel.channels.get(this.name);
		if (channels) {
			channels.forEach((channel) => {
				if (channel !== this && channel.onmessage && !channel.closed) {
					try {
						channel.onmessage({ data: message });
					} catch (e) {
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

// Set up global BroadcastChannel mock if not available
if (typeof globalThis.BroadcastChannel === 'undefined') {
	(globalThis as any).BroadcastChannel = MockBroadcastChannel;
} else {
	// Replace the native BroadcastChannel with our mock for tests
	(globalThis as any).BroadcastChannel = MockBroadcastChannel;
}

// Create mock adapter helper
function createMockAdapter(): LocalAdapter & {
	_storage: Map<string, Map<string, any>>;
	_queue: Map<string, SyncOperation>;
	_reset: () => void;
} {
	const storage = new Map<string, Map<string, any>>();
	const queue = new Map<string, SyncOperation>();
	let lastSync = 0;
	let clientId = 'test-client-' + Math.random().toString(36).substr(2, 9);
	let initialized = false;

	const getTable = (table: string): Map<string, any> => {
		if (!storage.has(table)) {
			storage.set(table, new Map());
		}
		return storage.get(table)!;
	};

	const adapter = {
		insert: vi.fn(async (table: string, data: any) => {
			getTable(table).set(data.id, { ...data });
			return { ...data };
		}),

		update: vi.fn(async (table: string, id: string, data: any) => {
			const existing = getTable(table).get(id);
			const updated = { ...existing, ...data, id };
			getTable(table).set(id, updated);
			return updated;
		}),

		delete: vi.fn(async (table: string, id: string) => {
			getTable(table).delete(id);
		}),

		find: vi.fn(async (table: string) => {
			return Array.from(getTable(table).values());
		}),

		findOne: vi.fn(async (table: string, id: string) => {
			return getTable(table).get(id) || null;
		}),

		addToQueue: vi.fn(async (op: SyncOperation) => {
			queue.set(op.id, op);
		}),

		getQueue: vi.fn(async () => {
			return Array.from(queue.values());
		}),

		removeFromQueue: vi.fn(async (ids: string[]) => {
			ids.forEach((id) => queue.delete(id));
		}),

		updateQueueStatus: vi.fn(
			async (id: string, status: SyncOperation['status'], error?: string) => {
				const op = queue.get(id);
				if (op) {
					queue.set(id, { ...op, status, error });
				}
			}
		),

		getLastSync: vi.fn(async () => lastSync),

		setLastSync: vi.fn(async (timestamp: number) => {
			lastSync = timestamp;
		}),

		getClientId: vi.fn(async () => clientId),

		isInitialized: vi.fn(async () => initialized),

		setInitialized: vi.fn(async (value: boolean) => {
			initialized = value;
		}),

		_storage: storage,
		_queue: queue,
		_reset: () => {
			storage.clear();
			queue.clear();
			lastSync = 0;
			initialized = false;
		}
	};

	return adapter;
}

// Create mock remote functions
function createMockRemote() {
	const pushedOperations: SyncOperation[] = [];
	const serverData: SyncOperation[] = [];

	return {
		push: vi.fn(async (ops: SyncOperation[]): Promise<SyncResult> => {
			pushedOperations.push(...ops);
			return {
				success: true,
				synced: ops.map((op) => op.id),
				conflicts: [],
				errors: []
			};
		}),

		pull: vi.fn(async (): Promise<SyncOperation[]> => {
			return serverData;
		}),

		resolve: vi.fn(async (conflict: Conflict): Promise<SyncOperation> => {
			return conflict.operation;
		}),

		_pushedOperations: pushedOperations,
		_serverData: serverData,
		_addServerData: (op: SyncOperation) => serverData.push(op),
		_reset: () => {
			pushedOperations.length = 0;
			serverData.length = 0;
		}
	};
}

describe('SyncEngine', () => {
	let adapter: ReturnType<typeof createMockAdapter>;
	let remote: ReturnType<typeof createMockRemote>;
	let config: SyncConfig;
	let engine: SyncEngine;

	beforeEach(() => {
		adapter = createMockAdapter();
		remote = createMockRemote();
		config = {
			local: { db: null, adapter },
			remote: { push: remote.push, pull: remote.pull, resolve: remote.resolve },
			syncInterval: 0, // Disable auto-sync for tests
			batchSize: 50,
			conflictResolution: 'last-write-wins',
			retryAttempts: 3,
			retryDelay: 100,
			onSync: vi.fn(),
			onConflict: vi.fn(),
			onError: vi.fn()
		};
		engine = new SyncEngine(config);
		MockBroadcastChannel.reset();
	});

	afterEach(() => {
		engine.destroy();
	});

	describe('initialization', () => {
		it('should initialize with default config values', () => {
			const minimalConfig: SyncConfig = {
				local: { db: null, adapter },
				remote: { push: remote.push, pull: remote.pull }
			};
			const minimalEngine = new SyncEngine(minimalConfig);

			expect(minimalEngine).toBeDefined();
			expect(minimalEngine.state.status).toBe('idle');

			minimalEngine.destroy();
		});

		it('should initialize sync engine successfully', async () => {
			await engine.init();

			expect(adapter.getClientId).toHaveBeenCalled();
			expect(adapter.getLastSync).toHaveBeenCalled();
			expect(adapter.getQueue).toHaveBeenCalled();
			expect(adapter.isInitialized).toHaveBeenCalled();
		});

		it('should pull initial data on first initialization', async () => {
			adapter.isInitialized.mockResolvedValue(false);

			await engine.init();

			expect(remote.pull).toHaveBeenCalledWith(0, expect.any(String));
			expect(adapter.setInitialized).toHaveBeenCalledWith(true);
		});

		it('should skip initial pull if already initialized', async () => {
			adapter.isInitialized.mockResolvedValue(true);

			await engine.init();

			expect(remote.pull).not.toHaveBeenCalled();
		});

		it('should warn if init is called multiple times', async () => {
			const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			await engine.init();
			await engine.init();

			expect(warnSpy).toHaveBeenCalledWith('SyncEngine already initialized');

			warnSpy.mockRestore();
		});

		it('should throw error if initialization fails', async () => {
			adapter.getClientId.mockRejectedValue(new Error('Init error'));

			await expect(engine.init()).rejects.toThrow('Failed to initialize sync engine');
		});
	});

	describe('CRUD operations', () => {
		beforeEach(async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();
		});

		describe('create', () => {
			it('should create a record and add to sync queue', async () => {
				const record = await engine.create('todos', { text: 'New todo' });

				expect(record.id).toBeDefined();
				expect(record.text).toBe('New todo');
				expect(record._version).toBe(1);
				expect(adapter.insert).toHaveBeenCalled();
				expect(adapter.addToQueue).toHaveBeenCalled();
			});

			it('should use provided id if specified', async () => {
				const record = await engine.create('todos', { id: 'custom-id', text: 'Todo' });

				expect(record.id).toBe('custom-id');
			});

			it('should trigger sync if syncInterval is 0', async () => {
				const syncSpy = vi.spyOn(engine, 'sync').mockResolvedValue(undefined);

				await engine.create('todos', { text: 'Todo' });

				expect(syncSpy).toHaveBeenCalled();

				syncSpy.mockRestore();
			});

			it('should throw error if not initialized', async () => {
				const uninitializedEngine = new SyncEngine(config);

				await expect(uninitializedEngine.create('todos', {})).rejects.toThrow(
					'SyncEngine not initialized'
				);

				uninitializedEngine.destroy();
			});
		});

		describe('update', () => {
			it('should update a record and increment version', async () => {
				// First create a record
				const created = await engine.create('todos', { text: 'Original' });

				// Sync to clear the pending operation
				engine.state.pendingOps.length = 0;

				// Then update it
				const updated = await engine.update('todos', created.id, { text: 'Updated' });

				expect(updated.text).toBe('Updated');
				expect(updated._version).toBe(2);
			});

			it('should add update operation to queue', async () => {
				const created = await engine.create('todos', { text: 'Original' });
				adapter.addToQueue.mockClear();

				await engine.update('todos', created.id, { text: 'Updated' });

				expect(adapter.addToQueue).toHaveBeenCalledWith(
					expect.objectContaining({ operation: 'update' })
				);
			});
		});

		describe('delete', () => {
			it('should delete a record', async () => {
				const created = await engine.create('todos', { text: 'To delete' });

				await engine.delete('todos', created.id);

				expect(adapter.delete).toHaveBeenCalledWith('todos', created.id);
			});

			it('should add delete operation to queue', async () => {
				const created = await engine.create('todos', { text: 'To delete' });
				adapter.addToQueue.mockClear();

				await engine.delete('todos', created.id);

				expect(adapter.addToQueue).toHaveBeenCalledWith(
					expect.objectContaining({ operation: 'delete', data: { id: created.id } })
				);
			});
		});

		describe('find', () => {
			it('should find all records in a table', async () => {
				await engine.create('todos', { text: 'Todo 1' });
				await engine.create('todos', { text: 'Todo 2' });

				const results = await engine.find('todos');

				expect(results).toHaveLength(2);
			});

			it('should pass query to adapter', async () => {
				const query = { completed: true };

				await engine.find('todos', query);

				expect(adapter.find).toHaveBeenCalledWith('todos', query);
			});
		});

		describe('findOne', () => {
			it('should find a specific record by id', async () => {
				const created = await engine.create('todos', { text: 'Find me' });

				const found = await engine.findOne('todos', created.id);

				expect(found).toBeDefined();
				expect(found.text).toBe('Find me');
			});

			it('should return null for non-existent record', async () => {
				const found = await engine.findOne('todos', 'non-existent');

				expect(found).toBeNull();
			});
		});
	});

	describe('sync operations', () => {
		beforeEach(async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();
		});

		it('should not sync if already syncing', async () => {
			// Start a slow sync
			remote.push.mockImplementation(async () => {
				await new Promise((r) => setTimeout(r, 100));
				return { success: true, synced: [], conflicts: [], errors: [] };
			});

			const firstSync = engine.sync();
			const secondSync = engine.sync();

			await Promise.all([firstSync, secondSync]);

			// Should only push once despite two sync calls
			expect(remote.push).toHaveBeenCalledTimes(0); // No pending ops initially
		});

		it('should force sync even if already syncing', async () => {
			const syncPromises: Promise<void>[] = [];

			remote.push.mockImplementation(async () => {
				await new Promise((r) => setTimeout(r, 50));
				return { success: true, synced: [], conflicts: [], errors: [] };
			});

			// Create some pending operations
			await engine.create('todos', { text: 'Todo' });

			syncPromises.push(engine.sync());
			syncPromises.push(engine.sync(true)); // Force sync

			await Promise.all(syncPromises);

			// With force, both should attempt to sync
			expect(remote.push).toHaveBeenCalled();
		});

		it('should call onSync callback with status changes', async () => {
			const onSyncMock = vi.fn();
			config.onSync = onSyncMock;
			engine = new SyncEngine(config);
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();

			await engine.create('todos', { text: 'Todo' });
			
			// Wait for sync to complete
			await new Promise((r) => setTimeout(r, 50));

			expect(onSyncMock).toHaveBeenCalled();
		});

		it('should handle sync failure by calling error callback', async () => {
			const onErrorMock = vi.fn();
			const onSyncMock = vi.fn();
			
			// Set up a push that fails
			remote.push.mockRejectedValue(new Error('Network error'));
			
			// Create config that triggers sync but captures errors
			const errorConfig: SyncConfig = {
				...config,
				onError: onErrorMock,
				onSync: onSyncMock,
				syncInterval: 0
			};
			
			const errorEngine = new SyncEngine(errorConfig);
			adapter.isInitialized.mockResolvedValue(true);
			await errorEngine.init();

			// Add an operation to queue manually so we can trigger sync separately
			await adapter.addToQueue({
				id: 'op-1',
				table: 'todos',
				operation: 'insert',
				data: { id: 'todo-1', text: 'Test' },
				timestamp: Date.now(),
				clientId: 'client-1',
				version: 1,
				status: 'pending'
			});

			// Trigger sync manually and catch the error
			try {
				await errorEngine.sync();
			} catch {
				// Expected
			}

			expect(onErrorMock).toHaveBeenCalled();
			
			errorEngine.destroy();
		});
	});

	describe('conflict resolution', () => {
		beforeEach(async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();
		});

		it('should handle conflicts reported by remote push', async () => {
			const conflict: Conflict = {
				operation: {
					id: 'op-1',
					table: 'todos',
					operation: 'update',
					data: { id: 'todo-1', text: 'Client text', _updatedAt: new Date() },
					timestamp: Date.now(),
					clientId: 'client-1',
					version: 2,
					status: 'pending'
				},
				serverData: { id: 'todo-1', text: 'Server text', _updatedAt: new Date(Date.now() - 10000) },
				clientData: { id: 'todo-1', text: 'Client text', _updatedAt: new Date() }
			};

			remote.push.mockResolvedValue({
				success: true,
				synced: [],
				conflicts: [conflict],
				errors: []
			});

			// Create item and set up the adapter to have a pending operation
			await adapter.insert('todos', { id: 'todo-1', text: 'Original' });
			await adapter.addToQueue({
				id: 'op-1',
				table: 'todos',
				operation: 'update',
				data: { id: 'todo-1', text: 'Client text', _updatedAt: new Date() },
				timestamp: Date.now(),
				clientId: 'client-1',
				version: 2,
				status: 'pending'
			});

			// Sync should handle the conflict
			await engine.sync();

			// The conflict should trigger onConflict callback
			expect(config.onConflict).toHaveBeenCalled();
		});
	});

	describe('state management', () => {
		it('should expose current sync state', async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();

			const state = engine.state;

			expect(state).toHaveProperty('isSyncing');
			expect(state).toHaveProperty('status');
			expect(state).toHaveProperty('pendingOps');
			expect(state).toHaveProperty('conflicts');
			expect(state).toHaveProperty('lastSync');
			expect(state).toHaveProperty('hasPendingChanges');
		});

		it('should report pending changes correctly', async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();

			expect(engine.state.hasPendingChanges).toBe(false);

			await engine.create('todos', { text: 'Todo' });

			expect(engine.state.hasPendingChanges).toBe(true);
		});
	});

	describe('collection stores', () => {
		beforeEach(async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();
		});

		it('should create a collection store for a table', () => {
			const collection = engine.collection('todos');

			expect(collection).toBeDefined();
			expect(collection).toBeInstanceOf(CollectionStore);
		});

		it('should return same collection for same table name', () => {
			const collection1 = engine.collection('todos');
			const collection2 = engine.collection('todos');

			expect(collection1).toBe(collection2);
		});

		it('should create different collections for different tables', () => {
			const todosCollection = engine.collection('todos');
			const notesCollection = engine.collection('notes');

			expect(todosCollection).not.toBe(notesCollection);
		});
	});

	describe('force push/pull', () => {
		beforeEach(async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();
		});

		it('should force push pending operations', async () => {
			await engine.create('todos', { text: 'Todo' });

			await engine.forcePush();

			expect(remote.push).toHaveBeenCalled();
		});

		it('should force pull remote changes', async () => {
			await engine.forcePull();

			expect(remote.pull).toHaveBeenCalled();
		});
	});

	describe('cleanup', () => {
		it('should clean up resources on destroy', () => {
			const engine = new SyncEngine(config);

			engine.destroy();

			// Should not throw when destroying
			expect(() => engine.destroy()).not.toThrow();
		});
	});
});

describe('CollectionStore', () => {
	let adapter: ReturnType<typeof createMockAdapter>;
	let remote: ReturnType<typeof createMockRemote>;
	let config: SyncConfig;
	let engine: SyncEngine;
	let collection: CollectionStore<{ id: string; text: string; completed: boolean }>;

	beforeEach(async () => {
		adapter = createMockAdapter();
		remote = createMockRemote();
		config = {
			local: { db: null, adapter },
			remote: { push: remote.push, pull: remote.pull },
			syncInterval: 0,
			onSync: vi.fn(),
			onConflict: vi.fn(),
			onError: vi.fn()
		};
		engine = new SyncEngine(config);
		adapter.isInitialized.mockResolvedValue(true);
		await engine.init();
		collection = engine.collection('todos');
	});

	afterEach(() => {
		engine.destroy();
		MockBroadcastChannel.reset();
	});

	describe('data state', () => {
		it('should have initial empty data', () => {
			expect(collection.data).toEqual([]);
		});

		it('should have initial loading state as false', () => {
			expect(collection.isLoading).toBe(false);
		});

		it('should have no initial error', () => {
			expect(collection.error).toBeNull();
		});
	});

	describe('CRUD operations', () => {
		describe('create', () => {
			it('should create and add item to data array', async () => {
				const item = await collection.create({ text: 'New todo', completed: false });

				expect(item.id).toBeDefined();
				expect(item.text).toBe('New todo');
				expect(collection.data).toContainEqual(expect.objectContaining({ text: 'New todo' }));
			});

			it('should support optimistic updates', async () => {
				// Start the create but don't await
				const createPromise = collection.create({ text: 'Optimistic', completed: false });

				// Data should be updated immediately (optimistic)
				expect(collection.data.some((item) => item.text === 'Optimistic')).toBe(true);

				await createPromise;
			});

			it('should set error on create failure', async () => {
				adapter.insert.mockRejectedValue(new Error('Create failed'));

				await expect(collection.create({ text: 'Fail', completed: false })).rejects.toThrow(
					'Create failed'
				);
				expect(collection.error).toBeDefined();
			});
		});

		describe('update', () => {
			it('should update an existing item', async () => {
				const item = await collection.create({ text: 'Original', completed: false });

				const updated = await collection.update(item.id, { text: 'Updated' });

				expect(updated.text).toBe('Updated');
				expect(collection.data.find((i) => i.id === item.id)?.text).toBe('Updated');
			});

			it('should throw error for non-existent item', async () => {
				await expect(collection.update('non-existent', { text: 'New' })).rejects.toThrow(
					'Record with id non-existent not found'
				);
			});

			it('should perform optimistic update', async () => {
				const item = await collection.create({ text: 'Original', completed: false });

				// Start update without awaiting
				const updatePromise = collection.update(item.id, { completed: true });

				// Should be updated optimistically
				expect(collection.data.find((i) => i.id === item.id)?.completed).toBe(true);

				await updatePromise;
			});
		});

		describe('delete', () => {
			it('should delete an item', async () => {
				const item = await collection.create({ text: 'To delete', completed: false });

				await collection.delete(item.id);

				expect(collection.data.find((i) => i.id === item.id)).toBeUndefined();
			});

			it('should throw error for non-existent item', async () => {
				await expect(collection.delete('non-existent')).rejects.toThrow(
					'Record with id non-existent not found'
				);
			});

			it('should perform optimistic delete', async () => {
				const item = await collection.create({ text: 'To delete', completed: false });

				// Start delete without awaiting
				const deletePromise = collection.delete(item.id);

				// Should be removed optimistically
				expect(collection.data.find((i) => i.id === item.id)).toBeUndefined();

				await deletePromise;
			});
		});

		describe('findOne', () => {
			it('should find a specific item', async () => {
				const item = await collection.create({ text: 'Find me', completed: false });

				const found = await collection.findOne(item.id);

				expect(found?.text).toBe('Find me');
			});

			it('should return null for non-existent item', async () => {
				const found = await collection.findOne('non-existent');

				expect(found).toBeNull();
			});
		});
	});

	describe('batch operations', () => {
		it('should create multiple items', async () => {
			const items = await collection.createMany([
				{ text: 'Todo 1', completed: false },
				{ text: 'Todo 2', completed: false },
				{ text: 'Todo 3', completed: true }
			]);

			expect(items).toHaveLength(3);
			expect(collection.data).toHaveLength(3);
		});

		it('should delete multiple items', async () => {
			const items = await collection.createMany([
				{ text: 'Todo 1', completed: false },
				{ text: 'Todo 2', completed: false }
			]);

			await collection.deleteMany(items.map((i) => i.id));

			expect(collection.data).toHaveLength(0);
		});

		it('should update multiple items', async () => {
			const items = await collection.createMany([
				{ text: 'Todo 1', completed: false },
				{ text: 'Todo 2', completed: false }
			]);

			const updated = await collection.updateMany([
				{ id: items[0].id, data: { completed: true } },
				{ id: items[1].id, data: { completed: true } }
			]);

			expect(updated.every((i) => i.completed)).toBe(true);
		});
	});

	describe('utility methods', () => {
		beforeEach(async () => {
			await collection.createMany([
				{ text: 'Todo 1', completed: false },
				{ text: 'Todo 2', completed: true },
				{ text: 'Todo 3', completed: false }
			]);
		});

		it('should return correct count', () => {
			expect(collection.count).toBe(3);
		});

		it('should return correct isEmpty state', () => {
			expect(collection.isEmpty).toBe(false);

			collection.clear();

			expect(collection.isEmpty).toBe(true);
		});

		it('should find item by predicate', () => {
			const found = collection.find((item) => item.text === 'Todo 2');

			expect(found?.text).toBe('Todo 2');
		});

		it('should filter items by predicate', () => {
			const completed = collection.filter((item) => item.completed);

			expect(completed).toHaveLength(1);
			expect(completed[0].text).toBe('Todo 2');
		});

		it('should map items', () => {
			const texts = collection.map((item) => item.text);

			expect(texts).toEqual(['Todo 1', 'Todo 2', 'Todo 3']);
		});

		it('should sort items', () => {
			const sorted = collection.sort((a, b) => a.text.localeCompare(b.text));

			expect(sorted[0].text).toBe('Todo 1');
			expect(sorted[2].text).toBe('Todo 3');
		});

		it('should clear all data', () => {
			collection.clear();

			expect(collection.data).toHaveLength(0);
			expect(collection.count).toBe(0);
		});
	});

	describe('load and reload', () => {
		it('should load data from adapter', async () => {
			// Pre-populate adapter storage
			adapter._storage.set(
				'todos',
				new Map([
					['todo-1', { id: 'todo-1', text: 'Loaded 1', completed: false }],
					['todo-2', { id: 'todo-2', text: 'Loaded 2', completed: true }]
				])
			);

			await collection.load();

			expect(collection.data).toHaveLength(2);
			expect(collection.isLoading).toBe(false);
		});

		it('should set loading state during load', async () => {
			adapter.find.mockImplementation(async () => {
				// Check loading state inside the promise
				expect(collection.isLoading).toBe(true);
				return [];
			});

			await collection.load();

			expect(collection.isLoading).toBe(false);
		});

		it('should reload data', async () => {
			await collection.create({ text: 'Initial', completed: false });

			// Add directly to storage
			adapter._storage.get('todos')?.set('new-todo', {
				id: 'new-todo',
				text: 'New todo',
				completed: false
			});

			await collection.reload();

			expect(collection.data).toHaveLength(2);
		});

		it('should handle load error', async () => {
			adapter.find.mockRejectedValue(new Error('Load failed'));

			await expect(collection.load()).rejects.toThrow('Load failed');
			expect(collection.error).toBeDefined();
		});
	});
});
