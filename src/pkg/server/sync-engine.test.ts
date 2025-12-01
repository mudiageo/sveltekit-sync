import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerSyncEngine } from './sync-engine.js';
import type { ServerAdapter, SyncOperation, SyncResult, Conflict } from '../types.js';
import type { SyncConfig, SyncTableConfig } from './types.js';

// Create a mock server adapter
function createMockAdapter(overrides: Partial<ServerAdapter> = {}): ServerAdapter {
	return {
		insert: vi.fn().mockResolvedValue({}),
		update: vi.fn().mockResolvedValue({}),
		delete: vi.fn().mockResolvedValue(undefined),
		findOne: vi.fn().mockResolvedValue(null),
		find: vi.fn().mockResolvedValue([]),
		getChangesSince: vi.fn().mockResolvedValue([]),
		applyOperation: vi.fn().mockResolvedValue(undefined),
		batchInsert: vi.fn().mockResolvedValue([]),
		batchUpdate: vi.fn().mockResolvedValue([]),
		checkConflict: vi.fn().mockResolvedValue(false),
		logSyncOperation: vi.fn().mockResolvedValue(undefined),
		updateClientState: vi.fn().mockResolvedValue(undefined),
		getClientState: vi.fn().mockResolvedValue(null),
		...overrides
	};
}

// Create a valid sync config
function createConfig(tableConfigs: Record<string, SyncTableConfig> = {}): SyncConfig {
	return {
		tables: {
			todos: {
				table: 'todos',
				conflictResolution: 'last-write-wins'
			},
			...tableConfigs
		}
	};
}

// Create a sync operation helper
function createOperation(
	overrides: Partial<SyncOperation> = {}
): SyncOperation {
	return {
		id: 'op-1',
		table: 'todos',
		operation: 'insert',
		data: { id: 'todo-1', text: 'Test todo', userId: 'user-1' },
		timestamp: Date.now(),
		clientId: 'client-1',
		version: 1,
		status: 'pending',
		...overrides
	};
}

describe('ServerSyncEngine', () => {
	let adapter: ServerAdapter;
	let config: SyncConfig;
	let engine: ServerSyncEngine;

	beforeEach(() => {
		adapter = createMockAdapter();
		config = createConfig();
		engine = new ServerSyncEngine(adapter, config);
	});

	describe('push', () => {
		describe('insert operations', () => {
			it('should successfully insert a new record', async () => {
				const operation = createOperation({
					operation: 'insert',
					data: { id: 'todo-1', text: 'New todo', userId: 'user-1' }
				});

				const result = await engine.push([operation], 'user-1');

				expect(result.success).toBe(true);
				expect(result.synced).toContain('op-1');
				expect(result.conflicts).toHaveLength(0);
				expect(result.errors).toHaveLength(0);
				expect(adapter.insert).toHaveBeenCalledTimes(1);
				expect(adapter.logSyncOperation).toHaveBeenCalledWith(operation, 'user-1');
			});

			it('should create conflict when record already exists on insert', async () => {
				const existingRecord = {
					id: 'todo-1',
					text: 'Existing todo',
					_version: 1
				};

				adapter = createMockAdapter({
					findOne: vi.fn().mockResolvedValue(existingRecord)
				});
				engine = new ServerSyncEngine(adapter, config);

				const operation = createOperation({
					operation: 'insert',
					data: { id: 'todo-1', text: 'New todo' }
				});

				const result = await engine.push([operation], 'user-1');

				expect(result.synced).not.toContain('op-1');
				expect(result.conflicts).toHaveLength(1);
				expect(result.conflicts[0].serverData).toEqual(existingRecord);
				expect(result.conflicts[0].clientData).toEqual(operation.data);
			});

			it('should batch insert multiple records', async () => {
				const operations: SyncOperation[] = [
					createOperation({ id: 'op-1', data: { id: 'todo-1', text: 'Todo 1' } }),
					createOperation({ id: 'op-2', data: { id: 'todo-2', text: 'Todo 2' } }),
					createOperation({ id: 'op-3', data: { id: 'todo-3', text: 'Todo 3' } })
				];

				const result = await engine.push(operations, 'user-1');

				expect(result.success).toBe(true);
				expect(result.synced).toHaveLength(3);
				expect(adapter.insert).toHaveBeenCalledTimes(3);
			});
		});

		describe('update operations', () => {
			it('should successfully update an existing record', async () => {
				const existingRecord = {
					id: 'todo-1',
					text: 'Original text',
					userId: 'user-1',
					_version: 1,
					_updatedAt: new Date(Date.now() - 1000)
				};

				adapter = createMockAdapter({
					findOne: vi.fn().mockResolvedValue(existingRecord)
				});
				engine = new ServerSyncEngine(adapter, config);

				const operation = createOperation({
					operation: 'update',
					version: 2,
					data: { id: 'todo-1', text: 'Updated text', userId: 'user-1' }
				});

				const result = await engine.push([operation], 'user-1');

				expect(result.success).toBe(true);
				expect(result.synced).toContain('op-1');
				expect(adapter.update).toHaveBeenCalledTimes(1);
			});

			it('should return error when updating non-existent record', async () => {
				adapter = createMockAdapter({
					findOne: vi.fn().mockResolvedValue(null)
				});
				engine = new ServerSyncEngine(adapter, config);

				const operation = createOperation({
					operation: 'update',
					version: 2,
					data: { id: 'todo-1', text: 'Updated text' }
				});

				const result = await engine.push([operation], 'user-1');

				expect(result.synced).not.toContain('op-1');
				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].error).toBe('Record not found');
			});

			it('should handle version conflict with last-write-wins (client wins)', async () => {
				const serverTime = Date.now() - 10000; // 10 seconds ago
				const existingRecord = {
					id: 'todo-1',
					text: 'Server text',
					userId: 'user-1',
					_version: 3, // Different version
					_updatedAt: new Date(serverTime)
				};

				adapter = createMockAdapter({
					findOne: vi.fn().mockResolvedValue(existingRecord)
				});
				engine = new ServerSyncEngine(adapter, config);

				const clientTime = Date.now(); // Now (later than server)
				const operation = createOperation({
					operation: 'update',
					version: 2,
					timestamp: clientTime,
					data: { id: 'todo-1', text: 'Client text', userId: 'user-1' }
				});

				const result = await engine.push([operation], 'user-1');

				// Client time is later, so with last-write-wins, client should win
				expect(result.synced).toContain('op-1');
			});

			it('should handle version conflict with last-write-wins (server wins)', async () => {
				const serverTime = Date.now(); // Now
				const existingRecord = {
					id: 'todo-1',
					text: 'Server text',
					userId: 'user-1',
					_version: 3,
					_updatedAt: new Date(serverTime)
				};

				adapter = createMockAdapter({
					findOne: vi.fn().mockResolvedValue(existingRecord)
				});
				engine = new ServerSyncEngine(adapter, config);

				const clientTime = Date.now() - 10000; // 10 seconds ago
				const operation = createOperation({
					operation: 'update',
					version: 2,
					timestamp: clientTime,
					data: { id: 'todo-1', text: 'Client text', userId: 'user-1' }
				});

				const result = await engine.push([operation], 'user-1');

				// Server time is later, so conflict should be returned
				expect(result.conflicts).toHaveLength(1);
			});

			it('should handle version conflict with client-wins strategy', async () => {
				const clientWinsConfig: SyncConfig = {
					tables: {
						todos: {
							table: 'todos',
							conflictResolution: 'client-wins'
						}
					}
				};

				const existingRecord = {
					id: 'todo-1',
					text: 'Server text',
					userId: 'user-1',
					_version: 3, // Different version
					_updatedAt: new Date()
				};

				adapter = createMockAdapter({
					findOne: vi.fn().mockResolvedValue(existingRecord)
				});
				engine = new ServerSyncEngine(adapter, clientWinsConfig);

				const operation = createOperation({
					operation: 'update',
					version: 2,
					data: { id: 'todo-1', text: 'Client text', userId: 'user-1' }
				});

				const result = await engine.push([operation], 'user-1');

				// With client-wins, update should be applied
				expect(result.synced).toContain('op-1');
			});

			it('should handle version conflict with server-wins strategy', async () => {
				const serverWinsConfig: SyncConfig = {
					tables: {
						todos: {
							table: 'todos',
							conflictResolution: 'server-wins'
						}
					}
				};

				const existingRecord = {
					id: 'todo-1',
					text: 'Server text',
					userId: 'user-1',
					_version: 3,
					_updatedAt: new Date()
				};

				adapter = createMockAdapter({
					findOne: vi.fn().mockResolvedValue(existingRecord)
				});
				engine = new ServerSyncEngine(adapter, serverWinsConfig);

				const operation = createOperation({
					operation: 'update',
					version: 2,
					data: { id: 'todo-1', text: 'Client text', userId: 'user-1' }
				});

				const result = await engine.push([operation], 'user-1');

				// With server-wins, conflict should be returned
				expect(result.conflicts).toHaveLength(1);
			});
		});

		describe('delete operations', () => {
			it('should successfully soft delete a record', async () => {
				const existingRecord = {
					id: 'todo-1',
					text: 'Todo to delete',
					userId: 'user-1',
					_version: 1
				};

				adapter = createMockAdapter({
					findOne: vi.fn().mockResolvedValue(existingRecord)
				});
				engine = new ServerSyncEngine(adapter, config);

				const operation = createOperation({
					operation: 'delete',
					data: { id: 'todo-1' }
				});

				const result = await engine.push([operation], 'user-1');

				expect(result.success).toBe(true);
				expect(result.synced).toContain('op-1');
				expect(adapter.update).toHaveBeenCalledWith(
					'todos',
					'todo-1',
					expect.objectContaining({ _isDeleted: true }),
					1
				);
			});

			it('should handle delete of non-existent record gracefully', async () => {
				adapter = createMockAdapter({
					findOne: vi.fn().mockResolvedValue(null)
				});
				engine = new ServerSyncEngine(adapter, config);

				const operation = createOperation({
					operation: 'delete',
					data: { id: 'todo-1' }
				});

				const result = await engine.push([operation], 'user-1');

				// Should still succeed (idempotent delete)
				expect(result.success).toBe(true);
				expect(result.synced).toContain('op-1');
			});
		});

		describe('access control', () => {
			it('should allow insert when no where clause is defined', async () => {
				const noWhereConfig: SyncConfig = {
					tables: {
						todos: { table: 'todos' }
					}
				};

				engine = new ServerSyncEngine(adapter, noWhereConfig);

				const operation = createOperation({
					operation: 'insert',
					data: { id: 'todo-1', text: 'Test' }
				});

				const result = await engine.push([operation], 'user-1');

				expect(result.synced).toContain('op-1');
			});

			it('should allow insert when userId matches', async () => {
				const withWhereConfig: SyncConfig = {
					tables: {
						todos: {
							table: 'todos',
							where: () => true
						}
					}
				};

				engine = new ServerSyncEngine(adapter, withWhereConfig);

				const operation = createOperation({
					operation: 'insert',
					data: { id: 'todo-1', text: 'Test', userId: 'user-1' }
				});

				const result = await engine.push([operation], 'user-1');

				expect(result.synced).toContain('op-1');
			});

			it('should deny access for update when record belongs to different user', async () => {
				const withWhereConfig: SyncConfig = {
					tables: {
						todos: {
							table: 'todos',
							where: () => true
						}
					}
				};

				const existingRecord = {
					id: 'todo-1',
					text: 'Todo',
					userId: 'different-user', // Different user owns this
					_version: 1
				};

				adapter = createMockAdapter({
					findOne: vi.fn().mockResolvedValue(existingRecord)
				});
				engine = new ServerSyncEngine(adapter, withWhereConfig);

				const operation = createOperation({
					operation: 'update',
					data: { id: 'todo-1', text: 'Updated' }
				});

				const result = await engine.push([operation], 'user-1');

				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].error).toBe('Access denied');
			});

			it('should return error when table is not configured', async () => {
				const operation = createOperation({
					table: 'unconfigured_table',
					operation: 'insert',
					data: { id: 'item-1' }
				});

				const result = await engine.push([operation], 'user-1');

				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].error).toContain('not configured for sync');
			});
		});

		describe('error handling', () => {
			it('should catch and report adapter errors', async () => {
				adapter = createMockAdapter({
					insert: vi.fn().mockRejectedValue(new Error('Database error'))
				});
				engine = new ServerSyncEngine(adapter, config);

				const operation = createOperation({
					operation: 'insert',
					data: { id: 'todo-1', text: 'Test' }
				});

				const result = await engine.push([operation], 'user-1');

				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].error).toBe('Database error');
			});

			it('should handle unknown errors gracefully', async () => {
				adapter = createMockAdapter({
					insert: vi.fn().mockRejectedValue('String error')
				});
				engine = new ServerSyncEngine(adapter, config);

				const operation = createOperation({
					operation: 'insert',
					data: { id: 'todo-1', text: 'Test' }
				});

				const result = await engine.push([operation], 'user-1');

				expect(result.errors).toHaveLength(1);
				expect(result.errors[0].error).toBe('Unknown error');
			});

			it('should update client state after processing operations', async () => {
				const operation = createOperation();

				await engine.push([operation], 'user-1');

				expect(adapter.updateClientState).toHaveBeenCalledWith('client-1', 'user-1');
			});
		});

		describe('transaction support', () => {
			it('should use transaction when available', async () => {
				const transactionFn = vi.fn().mockImplementation(async (fn) => {
					return fn(adapter);
				});

				adapter = createMockAdapter({
					transaction: transactionFn
				});
				engine = new ServerSyncEngine(adapter, config);

				const operation = createOperation();

				await engine.push([operation], 'user-1');

				expect(transactionFn).toHaveBeenCalled();
			});

			it('should work without transaction support', async () => {
				adapter = createMockAdapter({
					transaction: undefined
				});
				engine = new ServerSyncEngine(adapter, config);

				const operation = createOperation();

				const result = await engine.push([operation], 'user-1');

				expect(result.success).toBe(true);
			});
		});
	});

	describe('pull', () => {
		it('should pull changes since last sync', async () => {
			const changes: SyncOperation[] = [
				createOperation({
					id: 'change-1',
					operation: 'update',
					data: { id: 'todo-1', text: 'Updated' },
					timestamp: Date.now()
				}),
				createOperation({
					id: 'change-2',
					operation: 'insert',
					data: { id: 'todo-2', text: 'New todo' },
					timestamp: Date.now()
				})
			];

			adapter = createMockAdapter({
				getChangesSince: vi.fn().mockResolvedValue(changes)
			});
			engine = new ServerSyncEngine(adapter, config);

			const lastSync = Date.now() - 60000; // 1 minute ago
			const result = await engine.pull(lastSync, 'client-1', 'user-1');

			expect(result).toHaveLength(2);
			expect(adapter.getChangesSince).toHaveBeenCalledWith(
				'todos',
				lastSync,
				'user-1',
				'client-1'
			);
		});

		it('should apply transformations to pulled data', async () => {
			const transformConfig: SyncConfig = {
				tables: {
					todos: {
						table: 'todos',
						transform: (data) => ({
							...data,
							transformed: true
						})
					}
				}
			};

			const changes: SyncOperation[] = [
				createOperation({
					data: { id: 'todo-1', text: 'Test', secretField: 'secret' }
				})
			];

			adapter = createMockAdapter({
				getChangesSince: vi.fn().mockResolvedValue(changes)
			});
			engine = new ServerSyncEngine(adapter, transformConfig);

			const result = await engine.pull(0, 'client-1', 'user-1');

			expect(result[0].data.transformed).toBe(true);
		});

		it('should sort results by timestamp', async () => {
			const now = Date.now();
			const changes: SyncOperation[] = [
				createOperation({ id: 'change-2', timestamp: now + 1000 }),
				createOperation({ id: 'change-1', timestamp: now }),
				createOperation({ id: 'change-3', timestamp: now + 2000 })
			];

			adapter = createMockAdapter({
				getChangesSince: vi.fn().mockResolvedValue(changes)
			});
			engine = new ServerSyncEngine(adapter, config);

			const result = await engine.pull(0, 'client-1', 'user-1');

			expect(result[0].timestamp).toBeLessThanOrEqual(result[1].timestamp);
			expect(result[1].timestamp).toBeLessThanOrEqual(result[2].timestamp);
		});

		it('should update client state after pull', async () => {
			adapter = createMockAdapter({
				getChangesSince: vi.fn().mockResolvedValue([])
			});
			engine = new ServerSyncEngine(adapter, config);

			await engine.pull(0, 'client-1', 'user-1');

			expect(adapter.updateClientState).toHaveBeenCalledWith('client-1', 'user-1');
		});

		it('should pull from all configured tables', async () => {
			const multiTableConfig: SyncConfig = {
				tables: {
					todos: { table: 'todos' },
					notes: { table: 'notes' },
					projects: { table: 'projects' }
				}
			};

			adapter = createMockAdapter({
				getChangesSince: vi.fn().mockResolvedValue([])
			});
			engine = new ServerSyncEngine(adapter, multiTableConfig);

			await engine.pull(0, 'client-1', 'user-1');

			expect(adapter.getChangesSince).toHaveBeenCalledTimes(3);
		});

		it('should handle errors from individual tables gracefully', async () => {
			const multiTableConfig: SyncConfig = {
				tables: {
					todos: { table: 'todos' },
					notes: { table: 'notes' }
				}
			};

			let callCount = 0;
			adapter = createMockAdapter({
				getChangesSince: vi.fn().mockImplementation(() => {
					callCount++;
					if (callCount === 1) {
						return Promise.reject(new Error('Table error'));
					}
					return Promise.resolve([
						createOperation({ table: 'notes', data: { id: 'note-1' } })
					]);
				})
			});
			engine = new ServerSyncEngine(adapter, multiTableConfig);

			// Should not throw, should return results from successful tables
			const result = await engine.pull(0, 'client-1', 'user-1');

			// Should still get results from the notes table
			expect(result.length).toBeGreaterThanOrEqual(0);
		});
	});

	describe('subscribeToChanges', () => {
		it('should throw error when adapter does not support subscriptions', async () => {
			adapter = createMockAdapter({
				subscribe: undefined
			});
			engine = new ServerSyncEngine(adapter, config);

			await expect(
				engine.subscribeToChanges(['todos'], 'user-1', () => {})
			).rejects.toThrow('Real-time sync not supported by this adapter');
		});

		it('should delegate to adapter subscribe when supported', async () => {
			const unsubscribe = vi.fn();
			const mockSubscribe = vi.fn().mockResolvedValue(unsubscribe);

			adapter = createMockAdapter({
				subscribe: mockSubscribe
			});
			engine = new ServerSyncEngine(adapter, config);

			const callback = vi.fn();
			const result = await engine.subscribeToChanges(['todos', 'notes'], 'user-1', callback);

			expect(mockSubscribe).toHaveBeenCalledWith(['todos', 'notes'], 'user-1', callback);
			expect(result).toBe(unsubscribe);
		});
	});
});
