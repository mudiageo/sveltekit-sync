/**
 * SyncEngine Unit Tests
 * 
 * Tests for the client-side SyncEngine class.
 * Following Sveltest Foundation First approach with comprehensive coverage.
 * 
 * @see https://sveltest.dev/docs/testing-patterns
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncEngine, CollectionStore } from '$pkg/sync.svelte.js';
import type { SyncConfig, Conflict } from '$pkg/types.js';
import { 
	createMockLocalAdapter, 
	createMockRemote, 
	MockBroadcastChannel, 
	setupBroadcastChannelMock 
} from '../../helpers/index.js';

// Set up global mocks before tests
setupBroadcastChannelMock();

describe('SyncEngine', () => {
	let adapter: ReturnType<typeof createMockLocalAdapter>;
	let remote: ReturnType<typeof createMockRemote>;
	let config: SyncConfig;
	let engine: SyncEngine;

	beforeEach(() => {
		adapter = createMockLocalAdapter();
		remote = createMockRemote();
		config = {
			local: { db: null, adapter },
			remote: { push: remote.push, pull: remote.pull, resolve: remote.resolve },
			syncInterval: 0, // Disable auto-sync for predictable testing
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

	/**
	 * Initialization Tests
	 * Tests for engine setup and configuration
	 */
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

	/**
	 * CRUD Operation Tests
	 * Tests for create, read, update, delete operations
	 */
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
				const created = await engine.create('todos', { text: 'Original' });
				engine.state.pendingOps.length = 0;

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

	/**
	 * Sync Operation Tests
	 * Tests for push/pull synchronization
	 */
	describe('sync operations', () => {
		beforeEach(async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();
		});

		it('should not sync if already syncing', async () => {
			remote.push.mockImplementation(async () => {
				await new Promise((r) => setTimeout(r, 100));
				return { success: true, synced: [], conflicts: [], errors: [] };
			});

			const firstSync = engine.sync();
			const secondSync = engine.sync();

			await Promise.all([firstSync, secondSync]);

			expect(remote.push).toHaveBeenCalledTimes(0); // No pending ops initially
		});

		it('should force sync even if already syncing', async () => {
			const syncPromises: Promise<void>[] = [];

			remote.push.mockImplementation(async () => {
				await new Promise((r) => setTimeout(r, 50));
				return { success: true, synced: [], conflicts: [], errors: [] };
			});

			await engine.create('todos', { text: 'Todo' });

			syncPromises.push(engine.sync());
			syncPromises.push(engine.sync(true)); // Force sync

			await Promise.all(syncPromises);

			expect(remote.push).toHaveBeenCalled();
		});

		it('should call onSync callback with status changes', async () => {
			const onSyncMock = vi.fn();
			config.onSync = onSyncMock;
			engine = new SyncEngine(config);
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();

			await engine.create('todos', { text: 'Todo' });
			await new Promise((r) => setTimeout(r, 50));

			expect(onSyncMock).toHaveBeenCalled();
		});

		it('should handle sync failure by calling error callback', async () => {
			const onErrorMock = vi.fn();
			const onSyncMock = vi.fn();
			
			remote.push.mockRejectedValue(new Error('Network error'));
			
			const errorConfig: SyncConfig = {
				...config,
				onError: onErrorMock,
				onSync: onSyncMock,
				syncInterval: 0
			};
			
			const errorEngine = new SyncEngine(errorConfig);
			adapter.isInitialized.mockResolvedValue(true);
			await errorEngine.init();

			await adapter.addToQueue({
				id: 'op-1',
				table: 'todos',
				operation: 'insert',
				data: { id: 'todo-1', text: 'Test' },
				timestamp: new Date(),
				clientId: 'client-1',
				version: 1,
				status: 'pending'
			});

			try {
				await errorEngine.sync();
			} catch {
				// Expected
			}

			expect(onErrorMock).toHaveBeenCalled();
			
			errorEngine.destroy();
		});
	});

	/**
	 * Conflict Resolution Tests
	 * Tests for handling sync conflicts
	 */
	describe('conflict resolution', () => {
		beforeEach(async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();
		});

		it('should handle conflicts reported by remote push', async () => {
			const now = Date.now();
			const clientTime = new Date(now);
			const serverTime = new Date(now - 10000);
			
			const conflict: Conflict = {
				operation: {
					id: 'op-1',
					table: 'todos',
					operation: 'update',
					data: { id: 'todo-1', text: 'Client text', _updatedAt: clientTime },
					timestamp: clientTime,
					clientId: 'client-1',
					version: 2,
					status: 'pending'
				},
				serverData: { id: 'todo-1', text: 'Server text', _updatedAt: serverTime },
				clientData: { id: 'todo-1', text: 'Client text', _updatedAt: clientTime }
			};

			remote.push.mockResolvedValue({
				success: true,
				synced: [],
				conflicts: [conflict],
				errors: []
			});

			await adapter.insert('todos', { id: 'todo-1', text: 'Original' });
			await adapter.addToQueue({
				id: 'op-1',
				table: 'todos',
				operation: 'update',
				data: { id: 'todo-1', text: 'Client text', _updatedAt: clientTime },
				timestamp: now,
				clientId: 'client-1',
				version: 2,
				status: 'pending'
			});

			await engine.sync();

			expect(config.onConflict).toHaveBeenCalled();
		});
	});

	/**
	 * State Management Tests
	 * Tests for reactive state tracking
	 */
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

	/**
	 * Collection Store Tests
	 * Tests for reactive collection stores
	 */
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

	/**
	 * Force Push/Pull Tests
	 * Tests for manual sync operations
	 */
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

	/**
	 * Cleanup Tests
	 * Tests for resource cleanup
	 */
	describe('cleanup', () => {
		it('should clean up resources on destroy', () => {
			const engine = new SyncEngine(config);

			engine.destroy();

			expect(() => engine.destroy()).not.toThrow();
		});
	});
});

/**
 * CollectionStore Unit Tests
 * Tests for reactive collection store behavior
 */
describe('CollectionStore', () => {
	let adapter: ReturnType<typeof createMockLocalAdapter>;
	let remote: ReturnType<typeof createMockRemote>;
	let config: SyncConfig;
	let engine: SyncEngine;
	let collection: CollectionStore<{ id: string; text: string; completed: boolean }>;

	beforeEach(async () => {
		adapter = createMockLocalAdapter();
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

	/**
	 * Data State Tests
	 */
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

	/**
	 * CRUD Operation Tests
	 */
	describe('CRUD operations', () => {
		describe('create', () => {
			it('should create and add item to data array', async () => {
				const item = await collection.create({ text: 'New todo', completed: false });

				expect(item.id).toBeDefined();
				expect(item.text).toBe('New todo');
				expect(collection.data).toContainEqual(expect.objectContaining({ text: 'New todo' }));
			});

			it('should support optimistic updates', async () => {
				const createPromise = collection.create({ text: 'Optimistic', completed: false });

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

				const updatePromise = collection.update(item.id, { completed: true });

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

				const deletePromise = collection.delete(item.id);

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

	/**
	 * Batch Operation Tests
	 */
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

	/**
	 * Utility Method Tests
	 */
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

	/**
	 * Load and Reload Tests
	 */
	describe('load and reload', () => {
		it('should load data from adapter', async () => {
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
				expect(collection.isLoading).toBe(true);
				return [];
			});

			await collection.load();

			expect(collection.isLoading).toBe(false);
		});

		it('should reload data', async () => {
			await collection.create({ text: 'Initial', completed: false });

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
