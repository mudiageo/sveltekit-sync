/**
 * Types Module Unit Tests
 * 
 * Tests for core type interfaces and type guards.
 * Following Sveltest Foundation First approach - all test cases are defined upfront.
 * 
 * @see https://sveltest.dev/docs/testing-patterns
 */
import { describe, it, expect } from 'vitest';
import type {
	SyncStatus,
	SyncOperation,
	SyncResult,
	Conflict,
	SyncConfig,
	ClientState,
	ServerAdapter,
	QueryFilter,
	ClientAdapter,
	LocalAdapter
} from '$pkg/types.js';

describe('Types Module', () => {
	/**
	 * SyncStatus Type Tests
	 * Valid values: 'idle' | 'syncing' | 'error' | 'conflict' | 'offline'
	 */
	describe('SyncStatus', () => {
		it('should allow valid sync status values', () => {
			const validStatuses: SyncStatus[] = ['idle', 'syncing', 'error', 'conflict', 'offline'];
			expect(validStatuses).toHaveLength(5);
			expect(validStatuses).toContain('idle');
			expect(validStatuses).toContain('syncing');
			expect(validStatuses).toContain('error');
			expect(validStatuses).toContain('conflict');
			expect(validStatuses).toContain('offline');
		});
	});

	/**
	 * SyncOperation Type Tests
	 * Core type for tracking all sync operations
	 */
	describe('SyncOperation', () => {
		it('should create a valid insert operation', () => {
			const insertOp: SyncOperation = {
				id: 'op-1',
				table: 'todos',
				operation: 'insert',
				data: { id: 'todo-1', text: 'Test todo' },
				timestamp: new Date(),
				clientId: 'client-1',
				version: 1,
				status: 'pending'
			};

			expect(insertOp.id).toBe('op-1');
			expect(insertOp.table).toBe('todos');
			expect(insertOp.operation).toBe('insert');
			expect(insertOp.status).toBe('pending');
			expect(insertOp.version).toBe(1);
		});

		it('should create a valid update operation', () => {
			const updateOp: SyncOperation = {
				id: 'op-2',
				table: 'todos',
				operation: 'update',
				data: { id: 'todo-1', text: 'Updated todo' },
				timestamp: new Date(),
				clientId: 'client-1',
				version: 2,
				status: 'pending'
			};

			expect(updateOp.operation).toBe('update');
			expect(updateOp.version).toBe(2);
		});

		it('should create a valid delete operation', () => {
			const deleteOp: SyncOperation = {
				id: 'op-3',
				table: 'todos',
				operation: 'delete',
				data: { id: 'todo-1' },
				timestamp: new Date(),
				clientId: 'client-1',
				version: 1,
				status: 'pending'
			};

			expect(deleteOp.operation).toBe('delete');
		});

		it('should support optional error and userId properties', () => {
			const opWithError: SyncOperation = {
				id: 'op-4',
				table: 'todos',
				operation: 'insert',
				data: { id: 'todo-1' },
				timestamp: new Date(),
				clientId: 'client-1',
				version: 1,
				status: 'error',
				error: 'Network error',
				userId: 'user-1'
			};

			expect(opWithError.error).toBe('Network error');
			expect(opWithError.userId).toBe('user-1');
		});

		it('should support synced status', () => {
			const syncedOp: SyncOperation = {
				id: 'op-5',
				table: 'todos',
				operation: 'insert',
				data: { id: 'todo-1' },
				timestamp: new Date(),
				clientId: 'client-1',
				version: 1,
				status: 'synced'
			};

			expect(syncedOp.status).toBe('synced');
		});
	});

	/**
	 * SyncResult Type Tests
	 * Response type from sync operations
	 */
	describe('SyncResult', () => {
		it('should create a successful sync result', () => {
			const result: SyncResult = {
				success: true,
				synced: ['op-1', 'op-2', 'op-3'],
				conflicts: [],
				errors: []
			};

			expect(result.success).toBe(true);
			expect(result.synced).toHaveLength(3);
			expect(result.conflicts).toHaveLength(0);
			expect(result.errors).toHaveLength(0);
		});

		it('should create a result with conflicts', () => {
			const conflict: Conflict = {
				operation: {
					id: 'op-1',
					table: 'todos',
					operation: 'update',
					data: { id: 'todo-1', text: 'Client text' },
					timestamp: new Date(),
					clientId: 'client-1',
					version: 2,
					status: 'pending'
				},
				serverData: { id: 'todo-1', text: 'Server text' },
				clientData: { id: 'todo-1', text: 'Client text' }
			};

			const result: SyncResult = {
				success: true,
				synced: ['op-2'],
				conflicts: [conflict],
				errors: []
			};

			expect(result.conflicts).toHaveLength(1);
			expect(result.conflicts[0].serverData.text).toBe('Server text');
			expect(result.conflicts[0].clientData.text).toBe('Client text');
		});

		it('should create a result with errors', () => {
			const result: SyncResult = {
				success: false,
				synced: [],
				conflicts: [],
				errors: [
					{ id: 'op-1', error: 'Network error' },
					{ id: 'op-2', error: 'Validation failed' }
				]
			};

			expect(result.success).toBe(false);
			expect(result.errors).toHaveLength(2);
			expect(result.errors[0].error).toBe('Network error');
		});
	});

	/**
	 * Conflict Type Tests
	 * Represents sync conflicts between client and server
	 */
	describe('Conflict', () => {
		it('should create a conflict with resolution', () => {
			const conflict: Conflict = {
				operation: {
					id: 'op-1',
					table: 'todos',
					operation: 'update',
					data: { id: 'todo-1' },
					timestamp: new Date(),
					clientId: 'client-1',
					version: 2,
					status: 'pending'
				},
				serverData: { id: 'todo-1', _version: 2 },
				clientData: { id: 'todo-1', _version: 1 },
				resolution: 'client-wins'
			};

			expect(conflict.resolution).toBe('client-wins');
		});

		it('should support all resolution types', () => {
			const resolutions: Conflict['resolution'][] = ['client-wins', 'server-wins', 'merged'];
			expect(resolutions).toContain('client-wins');
			expect(resolutions).toContain('server-wins');
			expect(resolutions).toContain('merged');
		});
	});

	/**
	 * ClientState Type Tests
	 * Tracks client sync state on the server
	 */
	describe('ClientState', () => {
		it('should create a valid client state', () => {
			const state: ClientState = {
				clientId: 'client-1',
				userId: 'user-1',
				lastSync: new Date('2024-01-01'),
				lastActive: new Date('2024-01-02')
			};

			expect(state.clientId).toBe('client-1');
			expect(state.userId).toBe('user-1');
			expect(state.lastSync).toBeInstanceOf(Date);
			expect(state.lastActive).toBeInstanceOf(Date);
		});
	});

	/**
	 * QueryFilter Type Tests
	 * Used for filtering and sorting data queries
	 */
	describe('QueryFilter', () => {
		it('should create a valid query filter', () => {
			const filter: QueryFilter = {
				where: { completed: true, userId: 'user-1' },
				orderBy: [
					{ field: 'createdAt', direction: 'desc' },
					{ field: 'priority', direction: 'asc' }
				],
				limit: 10,
				offset: 0
			};

			expect(filter.where?.completed).toBe(true);
			expect(filter.orderBy).toHaveLength(2);
			expect(filter.limit).toBe(10);
			expect(filter.offset).toBe(0);
		});

		it('should support partial query filter', () => {
			const filter: QueryFilter = {
				limit: 5
			};

			expect(filter.where).toBeUndefined();
			expect(filter.orderBy).toBeUndefined();
			expect(filter.limit).toBe(5);
		});
	});

	/**
	 * SyncConfig Type Tests
	 * Configuration for the sync engine
	 */
	describe('SyncConfig', () => {
		it('should create a minimal sync config', () => {
			const mockPush = async () => ({
				success: true,
				synced: [],
				conflicts: [],
				errors: []
			});
			const mockPull = async () => [];
			const mockAdapter = {} as LocalAdapter;

			const config: SyncConfig = {
				local: {
					db: null,
					adapter: mockAdapter
				},
				remote: {
					push: mockPush,
					pull: mockPull
				}
			};

			expect(config.local).toBeDefined();
			expect(config.remote.push).toBeDefined();
			expect(config.remote.pull).toBeDefined();
		});

		it('should create a full sync config with all options', () => {
			const mockAdapter = {} as LocalAdapter;
			const mockPush = async () => ({
				success: true,
				synced: [],
				conflicts: [],
				errors: []
			});
			const mockPull = async () => [];
			const mockResolve = async (conflict: Conflict) => conflict.operation;

			const config: SyncConfig = {
				local: {
					db: null,
					adapter: mockAdapter
				},
				remote: {
					push: mockPush,
					pull: mockPull,
					resolve: mockResolve
				},
				syncInterval: 30000,
				batchSize: 50,
				conflictResolution: 'last-write-wins',
				retryAttempts: 3,
				retryDelay: 1000,
				onSync: () => {},
				onConflict: () => {},
				onError: () => {}
			};

			expect(config.syncInterval).toBe(30000);
			expect(config.batchSize).toBe(50);
			expect(config.conflictResolution).toBe('last-write-wins');
			expect(config.retryAttempts).toBe(3);
			expect(config.retryDelay).toBe(1000);
		});

		it('should support all conflict resolution strategies', () => {
			const strategies: SyncConfig['conflictResolution'][] = [
				'client-wins',
				'server-wins',
				'manual',
				'last-write-wins'
			];

			expect(strategies).toContain('client-wins');
			expect(strategies).toContain('server-wins');
			expect(strategies).toContain('manual');
			expect(strategies).toContain('last-write-wins');
		});
	});

	/**
	 * ServerAdapter Interface Tests
	 * Required methods for server-side storage
	 */
	describe('ServerAdapter Interface', () => {
		it('should define required methods', () => {
			const mockAdapter: ServerAdapter = {
				insert: async () => ({}),
				update: async () => ({}),
				delete: async () => {},
				findOne: async () => null,
				find: async () => [],
				getChangesSince: async () => [],
				applyOperation: async () => {},
				batchInsert: async () => [],
				batchUpdate: async () => [],
				checkConflict: async () => false,
				logSyncOperation: async () => {},
				updateClientState: async () => {},
				getClientState: async () => null
			};

			expect(mockAdapter.insert).toBeDefined();
			expect(mockAdapter.update).toBeDefined();
			expect(mockAdapter.delete).toBeDefined();
			expect(mockAdapter.findOne).toBeDefined();
			expect(mockAdapter.find).toBeDefined();
			expect(mockAdapter.getChangesSince).toBeDefined();
			expect(mockAdapter.applyOperation).toBeDefined();
			expect(mockAdapter.batchInsert).toBeDefined();
			expect(mockAdapter.batchUpdate).toBeDefined();
			expect(mockAdapter.checkConflict).toBeDefined();
			expect(mockAdapter.logSyncOperation).toBeDefined();
			expect(mockAdapter.updateClientState).toBeDefined();
			expect(mockAdapter.getClientState).toBeDefined();
		});

		it('should support optional subscribe and transaction methods', () => {
			const mockAdapter: ServerAdapter = {
				insert: async () => ({}),
				update: async () => ({}),
				delete: async () => {},
				findOne: async () => null,
				find: async () => [],
				getChangesSince: async () => [],
				applyOperation: async () => {},
				batchInsert: async () => [],
				batchUpdate: async () => [],
				checkConflict: async () => false,
				logSyncOperation: async () => {},
				updateClientState: async () => {},
				getClientState: async () => null,
				subscribe: async () => () => {},
				transaction: async (fn) => fn({} as ServerAdapter)
			};

			expect(mockAdapter.subscribe).toBeDefined();
			expect(mockAdapter.transaction).toBeDefined();
		});
	});

	/**
	 * ClientAdapter Interface Tests
	 * Required methods for client-side storage
	 */
	describe('ClientAdapter Interface', () => {
		it('should define required methods', () => {
			const mockAdapter: ClientAdapter = {
				insert: async () => ({}),
				update: async () => ({}),
				delete: async () => {},
				find: async () => [],
				findOne: async () => null,
				addToQueue: async () => {},
				getQueue: async () => [],
				removeFromQueue: async () => {},
				updateQueueStatus: async () => {},
				getLastSync: async () => 0,
				setLastSync: async () => {},
				getClientId: async () => 'client-1'
			};

			expect(mockAdapter.insert).toBeDefined();
			expect(mockAdapter.update).toBeDefined();
			expect(mockAdapter.delete).toBeDefined();
			expect(mockAdapter.find).toBeDefined();
			expect(mockAdapter.findOne).toBeDefined();
			expect(mockAdapter.addToQueue).toBeDefined();
			expect(mockAdapter.getQueue).toBeDefined();
			expect(mockAdapter.removeFromQueue).toBeDefined();
			expect(mockAdapter.updateQueueStatus).toBeDefined();
			expect(mockAdapter.getLastSync).toBeDefined();
			expect(mockAdapter.setLastSync).toBeDefined();
			expect(mockAdapter.getClientId).toBeDefined();
		});

		it('should support optional batch and clear methods', () => {
			const mockAdapter: ClientAdapter = {
				insert: async () => ({}),
				update: async () => ({}),
				delete: async () => {},
				find: async () => [],
				findOne: async () => null,
				addToQueue: async () => {},
				getQueue: async () => [],
				removeFromQueue: async () => {},
				updateQueueStatus: async () => {},
				getLastSync: async () => 0,
				setLastSync: async () => {},
				getClientId: async () => 'client-1',
				batchInsert: async () => [],
				batchDelete: async () => {},
				clear: async () => {}
			};

			expect(mockAdapter.batchInsert).toBeDefined();
			expect(mockAdapter.batchDelete).toBeDefined();
			expect(mockAdapter.clear).toBeDefined();
		});
	});

	/**
	 * LocalAdapter Interface Tests
	 * Extends ClientAdapter with initialization tracking
	 */
	describe('LocalAdapter Interface', () => {
		it('should extend ClientAdapter with initialization tracking', () => {
			const mockAdapter: LocalAdapter = {
				insert: async () => ({}),
				update: async () => ({}),
				delete: async () => {},
				find: async () => [],
				findOne: async () => null,
				addToQueue: async () => {},
				getQueue: async () => [],
				removeFromQueue: async () => {},
				updateQueueStatus: async () => {},
				getLastSync: async () => 0,
				setLastSync: async () => {},
				getClientId: async () => 'client-1',
				isInitialized: async () => false,
				setInitialized: async () => {}
			};

			expect(mockAdapter.isInitialized).toBeDefined();
			expect(mockAdapter.setInitialized).toBeDefined();
		});
	});
});
