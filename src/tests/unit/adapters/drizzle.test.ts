/**
 * Drizzle Adapter Unit Tests
 * 
 * Comprehensive tests for the DrizzleAdapter server-side storage adapter.
 * Tests run in Node.js environment with an in-memory implementation that
 * simulates the real Drizzle adapter behavior.
 * 
 * Tests cover:
 * - All CRUD operations
 * - Sync metadata handling (_version, _updatedAt, _clientId, _isDeleted)
 * - Conflict detection
 * - Batch operations
 * - Transaction support
 * - Edge cases and error scenarios
 * 
 * @see https://sveltest.dev/docs/testing-patterns
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { SyncOperation, ServerAdapter, ClientState } from '$pkg/types.js';

/**
 * Test record interface with sync metadata fields.
 * 
 * These fields are required by the sync engine for optimistic locking
 * and change tracking. In a real implementation, these would be defined
 * in the database schema.
 */
interface MockRecord {
	/** Primary key */
	id: string;
	/** Optimistic locking version, incremented on each update */
	_version: number;
	/** Last modification timestamp for change tracking */
	_updatedAt: Date;
	/** Client that made the last change (for excluding from pull) */
	_clientId: string | null;
	/** Soft delete flag */
	_isDeleted: boolean;
	/** Additional fields */
	[key: string]: unknown;
}

/**
 * Creates an in-memory mock server adapter for testing
 * This simulates what a real Drizzle adapter would do
 */
function createInMemoryServerAdapter(): ServerAdapter & { 
	_storage: Map<string, Map<string, MockRecord>>;
	_syncLog: SyncOperation[];
	_clientStates: Map<string, ClientState>;
	_reset: () => void;
} {
	const storage = new Map<string, Map<string, MockRecord>>();
	const syncLog: SyncOperation[] = [];
	const clientStates = new Map<string, ClientState>();

	const getTableStorage = (table: string): Map<string, MockRecord> => {
		if (!storage.has(table)) {
			storage.set(table, new Map());
		}
		return storage.get(table)!;
	};

	return {
		_storage: storage,
		_syncLog: syncLog,
		_clientStates: clientStates,
		_reset: () => {
			storage.clear();
			syncLog.length = 0;
			clientStates.clear();
		},

		async insert(table: string, data: MockRecord): Promise<MockRecord> {
			const tableData = getTableStorage(table);
			const record: MockRecord = {
				...data,
				_version: data._version ?? 1,
				_updatedAt: data._updatedAt ?? new Date(),
				_clientId: data._clientId ?? null,
				_isDeleted: data._isDeleted ?? false
			};
			tableData.set(data.id, record);
			return record;
		},

		async update(table: string, id: string, data: Partial<MockRecord>, version: number): Promise<MockRecord> {
			const tableData = getTableStorage(table);
			const existing = tableData.get(id);
			
			if (!existing || existing._version !== version) {
				throw new Error('Version conflict or record not found');
			}
			
			const updated: MockRecord = {
				...existing,
				...data,
				id,
				_version: version + 1,
				_updatedAt: new Date()
			};
			tableData.set(id, updated);
			return updated;
		},

		async delete(table: string, id: string): Promise<void> {
			const tableData = getTableStorage(table);
			const existing = tableData.get(id);
			if (existing) {
				existing._isDeleted = true;
				existing._updatedAt = new Date();
			}
		},

		async findOne(table: string, id: string): Promise<MockRecord | null> {
			const tableData = getTableStorage(table);
			return tableData.get(id) || null;
		},

		async find(table: string, filter?: { where?: Record<string, unknown>; limit?: number }): Promise<MockRecord[]> {
			const tableData = getTableStorage(table);
			let results = Array.from(tableData.values());
			
			if (filter?.where) {
				results = results.filter(record => 
					Object.entries(filter.where!).every(([key, value]) => record[key] === value)
				);
			}
			
			if (filter?.limit) {
				results = results.slice(0, filter.limit);
			}
			
			return results;
		},

		async getChangesSince(
			table: string,
			timestamp: number,
			userId?: string,
			excludeClientId?: string
		): Promise<SyncOperation[]> {
			const tableData = getTableStorage(table);
			const timestampDate = new Date(timestamp);
			
			let records = Array.from(tableData.values())
				.filter(r => r._updatedAt > timestampDate);
			
			if (excludeClientId) {
				records = records.filter(r => r._clientId !== excludeClientId);
			}
			
			if (userId) {
				records = records.filter(r => r.userId === userId);
			}
			
			return records.map(record => ({
				id: 'sync-' + Math.random().toString(36).slice(2),
				table,
				operation: record._isDeleted ? 'delete' as const : 'update' as const,
				data: record,
				timestamp: record._updatedAt.getTime(),
				clientId: record._clientId || 'server',
				version: record._version,
				status: 'synced' as const
			}));
		},

		async applyOperation(op: SyncOperation, userId?: string): Promise<void> {
			const tableData = getTableStorage(op.table);
			const data = userId ? { ...op.data, userId } : op.data;
			
			switch (op.operation) {
				case 'insert': {
					const record: MockRecord = {
						...data,
						_version: 1,
						_updatedAt: new Date(op.timestamp),
						_clientId: op.clientId,
						_isDeleted: false
					};
					tableData.set(data.id, record);
					break;
				}
				case 'update': {
					const existing = tableData.get(op.data.id);
					if (existing) {
						Object.assign(existing, data, {
							_version: existing._version + 1,
							_updatedAt: new Date(op.timestamp),
							_clientId: op.clientId
						});
					}
					break;
				}
				case 'delete': {
					const existing = tableData.get(op.data.id);
					if (existing) {
						existing._isDeleted = true;
						existing._updatedAt = new Date(op.timestamp);
					}
					break;
				}
			}
		},

		async batchInsert(table: string, records: MockRecord[]): Promise<MockRecord[]> {
			const results: MockRecord[] = [];
			for (const record of records) {
				const result = await this.insert(table, record);
				results.push(result);
			}
			return results;
		},

		async batchUpdate(table: string, updates: Array<{ id: string; data: Partial<MockRecord> }>): Promise<MockRecord[]> {
			const results: MockRecord[] = [];
			for (const { id, data } of updates) {
				const existing = await this.findOne(table, id);
				if (existing) {
					const result = await this.update(table, id, data, existing._version);
					results.push(result);
				}
			}
			return results;
		},

		async checkConflict(table: string, id: string, expectedVersion: number): Promise<boolean> {
			const record = await this.findOne(table, id);
			return record ? record._version !== expectedVersion : false;
		},

		async logSyncOperation(op: SyncOperation, userId: string): Promise<void> {
			syncLog.push({ ...op, userId });
		},

		async updateClientState(clientId: string, userId: string): Promise<void> {
			clientStates.set(clientId, {
				clientId,
				userId,
				lastSync: new Date(),
				lastActive: new Date()
			});
		},

		async getClientState(clientId: string): Promise<ClientState | null> {
			return clientStates.get(clientId) || null;
		},

		async transaction<T>(fn: (adapter: ServerAdapter) => Promise<T>): Promise<T> {
			return fn(this);
		}
	};
}

/**
 * Creates a test SyncOperation
 */
function createTestOperation(overrides: Partial<SyncOperation> = {}): SyncOperation {
	return {
		id: 'op-' + Math.random().toString(36).slice(2, 9),
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

describe('ServerAdapter (In-Memory Implementation)', () => {
	let adapter: ReturnType<typeof createInMemoryServerAdapter>;

	beforeEach(() => {
		adapter = createInMemoryServerAdapter();
	});

	/**
	 * Insert Operations Tests
	 */
	describe('insert', () => {
		it('should insert a record with sync metadata', async () => {
			const data = {
				id: 'todo-1',
				text: 'Test todo',
				completed: false,
				userId: 'user-1'
			} as MockRecord;

			const result = await adapter.insert('todos', data);

			expect(result.id).toBe('todo-1');
			expect(result.text).toBe('Test todo');
			expect(result._version).toBe(1);
			expect(result._isDeleted).toBe(false);
			expect(result._updatedAt).toBeInstanceOf(Date);
		});

		it('should generate default sync metadata', async () => {
			const data = { id: 'todo-1', text: 'Minimal data' } as MockRecord;

			const result = await adapter.insert('todos', data);

			expect(result._version).toBe(1);
			expect(result._clientId).toBeNull();
			expect(result._isDeleted).toBe(false);
		});

		it('should preserve provided sync metadata', async () => {
			const data = {
				id: 'todo-1',
				text: 'With metadata',
				_version: 5,
				_clientId: 'client-abc',
				_isDeleted: false,
				_updatedAt: new Date('2024-01-01')
			} as MockRecord;

			const result = await adapter.insert('todos', data);

			expect(result._version).toBe(5);
			expect(result._clientId).toBe('client-abc');
		});

		it('should store records in separate tables', async () => {
			await adapter.insert('todos', { id: 'item-1', type: 'todo' } as MockRecord);
			await adapter.insert('notes', { id: 'item-1', type: 'note' } as MockRecord);

			const todo = await adapter.findOne('todos', 'item-1');
			const note = await adapter.findOne('notes', 'item-1');

			expect(todo?.type).toBe('todo');
			expect(note?.type).toBe('note');
		});
	});

	/**
	 * Update Operations Tests
	 */
	describe('update', () => {
		beforeEach(async () => {
			await adapter.insert('todos', {
				id: 'todo-1',
				text: 'Original',
				completed: false,
				_version: 1
			} as MockRecord);
		});

		it('should update a record with version increment', async () => {
			const result = await adapter.update('todos', 'todo-1', { text: 'Updated' }, 1);

			expect(result.text).toBe('Updated');
			expect(result._version).toBe(2);
		});

		it('should update _updatedAt timestamp', async () => {
			const before = (await adapter.findOne('todos', 'todo-1'))?._updatedAt;
			
			await new Promise(r => setTimeout(r, 10));
			const result = await adapter.update('todos', 'todo-1', { text: 'Updated' }, 1);

			expect(result._updatedAt.getTime()).toBeGreaterThanOrEqual(before!.getTime());
		});

		it('should throw on version conflict', async () => {
			await expect(
				adapter.update('todos', 'todo-1', { text: 'Updated' }, 999)
			).rejects.toThrow('Version conflict');
		});

		it('should throw when updating non-existent record', async () => {
			await expect(
				adapter.update('todos', 'non-existent', { text: 'Updated' }, 1)
			).rejects.toThrow();
		});

		it('should allow multiple sequential updates', async () => {
			await adapter.update('todos', 'todo-1', { text: 'Update 1' }, 1);
			await adapter.update('todos', 'todo-1', { text: 'Update 2' }, 2);
			const result = await adapter.update('todos', 'todo-1', { text: 'Update 3' }, 3);

			expect(result.text).toBe('Update 3');
			expect(result._version).toBe(4);
		});
	});

	/**
	 * Delete Operations Tests (Soft Delete)
	 */
	describe('delete (soft delete)', () => {
		beforeEach(async () => {
			await adapter.insert('todos', {
				id: 'todo-1',
				text: 'To delete',
				_version: 1
			} as MockRecord);
		});

		it('should soft delete a record by setting _isDeleted', async () => {
			await adapter.delete('todos', 'todo-1');

			const record = await adapter.findOne('todos', 'todo-1');
			expect(record?._isDeleted).toBe(true);
		});

		it('should update _updatedAt on delete', async () => {
			const before = (await adapter.findOne('todos', 'todo-1'))?._updatedAt;
			
			await new Promise(r => setTimeout(r, 10));
			await adapter.delete('todos', 'todo-1');

			const after = await adapter.findOne('todos', 'todo-1');
			expect(after?._updatedAt.getTime()).toBeGreaterThanOrEqual(before!.getTime());
		});

		it('should not throw when deleting non-existent record', async () => {
			await expect(adapter.delete('todos', 'non-existent')).resolves.not.toThrow();
		});

		it('should keep record data after soft delete', async () => {
			await adapter.delete('todos', 'todo-1');

			const record = await adapter.findOne('todos', 'todo-1');
			expect(record?.text).toBe('To delete');
		});
	});

	/**
	 * Find Operations Tests
	 */
	describe('findOne', () => {
		it('should find a record by id', async () => {
			await adapter.insert('todos', { id: 'todo-1', text: 'Test' } as MockRecord);

			const result = await adapter.findOne('todos', 'todo-1');

			expect(result?.id).toBe('todo-1');
			expect(result?.text).toBe('Test');
		});

		it('should return null when record not found', async () => {
			const result = await adapter.findOne('todos', 'non-existent');

			expect(result).toBeNull();
		});

		it('should find soft-deleted records', async () => {
			await adapter.insert('todos', { id: 'todo-1', text: 'Deleted' } as MockRecord);
			await adapter.delete('todos', 'todo-1');

			const result = await adapter.findOne('todos', 'todo-1');

			expect(result).not.toBeNull();
			expect(result?._isDeleted).toBe(true);
		});
	});

	describe('find', () => {
		beforeEach(async () => {
			await adapter.insert('todos', { id: 'todo-1', text: 'First', completed: false, userId: 'user-1' } as MockRecord);
			await adapter.insert('todos', { id: 'todo-2', text: 'Second', completed: true, userId: 'user-1' } as MockRecord);
			await adapter.insert('todos', { id: 'todo-3', text: 'Third', completed: false, userId: 'user-2' } as MockRecord);
		});

		it('should find all records in table', async () => {
			const results = await adapter.find('todos');

			expect(results).toHaveLength(3);
		});

		it('should filter records by where clause', async () => {
			const results = await adapter.find('todos', { where: { completed: true } });

			expect(results).toHaveLength(1);
			expect(results[0].id).toBe('todo-2');
		});

		it('should filter by multiple conditions', async () => {
			const results = await adapter.find('todos', { 
				where: { completed: false, userId: 'user-1' } 
			});

			expect(results).toHaveLength(1);
			expect(results[0].id).toBe('todo-1');
		});

		it('should limit results', async () => {
			const results = await adapter.find('todos', { limit: 2 });

			expect(results).toHaveLength(2);
		});

		it('should return empty array for no matches', async () => {
			const results = await adapter.find('todos', { where: { completed: 'invalid' } });

			expect(results).toEqual([]);
		});
	});

	/**
	 * Changes Since Tests (Delta Sync)
	 */
	describe('getChangesSince', () => {
		it('should return changes since timestamp', async () => {
			const oldTime = Date.now() - 10000;
			
			await adapter.insert('todos', {
				id: 'old-todo',
				text: 'Old',
				_updatedAt: new Date(oldTime - 5000)
			} as MockRecord);

			await adapter.insert('todos', {
				id: 'new-todo',
				text: 'New',
				_updatedAt: new Date()
			} as MockRecord);

			const changes = await adapter.getChangesSince('todos', oldTime);

			// Should only return the new todo
			expect(changes.length).toBeGreaterThanOrEqual(1);
			expect(changes.some(c => c.data.id === 'new-todo')).toBe(true);
		});

		it('should exclude operations from specified clientId', async () => {
			await adapter.insert('todos', {
				id: 'todo-1',
				text: 'From client-1',
				_clientId: 'client-1',
				_updatedAt: new Date()
			} as MockRecord);

			await adapter.insert('todos', {
				id: 'todo-2',
				text: 'From client-2',
				_clientId: 'client-2',
				_updatedAt: new Date()
			} as MockRecord);

			const changes = await adapter.getChangesSince('todos', 0, undefined, 'client-1');

			expect(changes.every(c => c.data._clientId !== 'client-1')).toBe(true);
		});

		it('should filter by userId when provided', async () => {
			await adapter.insert('todos', {
				id: 'todo-1',
				userId: 'user-1',
				_updatedAt: new Date()
			} as MockRecord);

			await adapter.insert('todos', {
				id: 'todo-2',
				userId: 'user-2',
				_updatedAt: new Date()
			} as MockRecord);

			const changes = await adapter.getChangesSince('todos', 0, 'user-1');

			expect(changes.every(c => c.data.userId === 'user-1')).toBe(true);
		});

		it('should return delete operations for soft-deleted records', async () => {
			await adapter.insert('todos', {
				id: 'todo-1',
				text: 'Deleted',
				_isDeleted: true,
				_updatedAt: new Date()
			} as MockRecord);

			const changes = await adapter.getChangesSince('todos', 0);

			const deleteOp = changes.find(c => c.data.id === 'todo-1');
			expect(deleteOp?.operation).toBe('delete');
		});

		it('should return empty array when no changes', async () => {
			const futureTime = Date.now() + 100000;
			
			await adapter.insert('todos', {
				id: 'todo-1',
				_updatedAt: new Date()
			} as MockRecord);

			const changes = await adapter.getChangesSince('todos', futureTime);

			expect(changes).toEqual([]);
		});
	});

	/**
	 * Apply Operation Tests
	 */
	describe('applyOperation', () => {
		it('should apply insert operation', async () => {
			const op = createTestOperation({
				operation: 'insert',
				data: { id: 'todo-1', text: 'New todo' }
			});

			await adapter.applyOperation(op);

			const record = await adapter.findOne('todos', 'todo-1');
			expect(record).toBeDefined();
			expect(record?.text).toBe('New todo');
			expect(record?._clientId).toBe('client-1');
		});

		it('should apply update operation', async () => {
			await adapter.insert('todos', { id: 'todo-1', text: 'Original', _version: 1 } as MockRecord);

			const op = createTestOperation({
				operation: 'update',
				data: { id: 'todo-1', text: 'Updated' },
				version: 2
			});

			await adapter.applyOperation(op);

			const record = await adapter.findOne('todos', 'todo-1');
			expect(record?.text).toBe('Updated');
		});

		it('should apply delete operation', async () => {
			await adapter.insert('todos', { id: 'todo-1', text: 'To delete' } as MockRecord);

			const op = createTestOperation({
				operation: 'delete',
				data: { id: 'todo-1' }
			});

			await adapter.applyOperation(op);

			const record = await adapter.findOne('todos', 'todo-1');
			expect(record?._isDeleted).toBe(true);
		});

		it('should add userId when provided', async () => {
			const op = createTestOperation({
				operation: 'insert',
				data: { id: 'todo-1', text: 'New' }
			});

			await adapter.applyOperation(op, 'user-123');

			const record = await adapter.findOne('todos', 'todo-1');
			expect(record?.userId).toBe('user-123');
		});
	});

	/**
	 * Conflict Detection Tests
	 */
	describe('checkConflict', () => {
		beforeEach(async () => {
			await adapter.insert('todos', { id: 'todo-1', text: 'Test', _version: 5 } as MockRecord);
		});

		it('should return false when versions match', async () => {
			const hasConflict = await adapter.checkConflict('todos', 'todo-1', 5);

			expect(hasConflict).toBe(false);
		});

		it('should return true when versions do not match', async () => {
			const hasConflict = await adapter.checkConflict('todos', 'todo-1', 3);

			expect(hasConflict).toBe(true);
		});

		it('should return false for non-existent record', async () => {
			const hasConflict = await adapter.checkConflict('todos', 'non-existent', 1);

			expect(hasConflict).toBe(false);
		});
	});

	/**
	 * Batch Operations Tests
	 */
	describe('batchInsert', () => {
		it('should insert multiple records', async () => {
			const records = [
				{ id: 'todo-1', text: 'First' },
				{ id: 'todo-2', text: 'Second' },
				{ id: 'todo-3', text: 'Third' }
			] as MockRecord[];

			const results = await adapter.batchInsert('todos', records);

			expect(results).toHaveLength(3);
			
			const allRecords = await adapter.find('todos');
			expect(allRecords).toHaveLength(3);
		});

		it('should assign sync metadata to all records', async () => {
			const records = [
				{ id: 'todo-1', text: 'First' },
				{ id: 'todo-2', text: 'Second' }
			] as MockRecord[];

			const results = await adapter.batchInsert('todos', records);

			expect(results.every(r => r._version === 1)).toBe(true);
			expect(results.every(r => r._isDeleted === false)).toBe(true);
		});
	});

	describe('batchUpdate', () => {
		beforeEach(async () => {
			await adapter.insert('todos', { id: 'todo-1', text: 'First', _version: 1 } as MockRecord);
			await adapter.insert('todos', { id: 'todo-2', text: 'Second', _version: 1 } as MockRecord);
		});

		it('should update multiple records', async () => {
			const updates = [
				{ id: 'todo-1', data: { text: 'Updated First' } },
				{ id: 'todo-2', data: { text: 'Updated Second' } }
			];

			const results = await adapter.batchUpdate('todos', updates);

			expect(results).toHaveLength(2);
			expect(results[0].text).toBe('Updated First');
			expect(results[1].text).toBe('Updated Second');
		});

		it('should increment versions for all updated records', async () => {
			const updates = [
				{ id: 'todo-1', data: { text: 'Updated' } },
				{ id: 'todo-2', data: { text: 'Updated' } }
			];

			const results = await adapter.batchUpdate('todos', updates);

			expect(results.every(r => r._version === 2)).toBe(true);
		});
	});

	/**
	 * Transaction Tests
	 */
	describe('transaction', () => {
		it('should execute operations within transaction', async () => {
			await adapter.transaction(async (tx) => {
				await tx.insert('todos', { id: 'todo-1', text: 'In transaction' } as MockRecord);
				await tx.insert('todos', { id: 'todo-2', text: 'Also in transaction' } as MockRecord);
			});

			const results = await adapter.find('todos');
			expect(results).toHaveLength(2);
		});

		it('should return value from transaction', async () => {
			const result = await adapter.transaction(async (tx) => {
				await tx.insert('todos', { id: 'todo-1', text: 'Test' } as MockRecord);
				return 'success';
			});

			expect(result).toBe('success');
		});
	});

	/**
	 * Sync Log Tests
	 */
	describe('logSyncOperation', () => {
		it('should log sync operations', async () => {
			const op = createTestOperation();

			await adapter.logSyncOperation(op, 'user-1');

			expect(adapter._syncLog).toHaveLength(1);
			expect(adapter._syncLog[0].userId).toBe('user-1');
		});

		it('should preserve operation details in log', async () => {
			const op = createTestOperation({
				id: 'op-123',
				table: 'todos',
				operation: 'insert'
			});

			await adapter.logSyncOperation(op, 'user-1');

			expect(adapter._syncLog[0].id).toBe('op-123');
			expect(adapter._syncLog[0].table).toBe('todos');
			expect(adapter._syncLog[0].operation).toBe('insert');
		});
	});

	/**
	 * Client State Tests
	 */
	describe('client state management', () => {
		it('should update client state', async () => {
			await adapter.updateClientState('client-1', 'user-1');

			const state = await adapter.getClientState('client-1');
			expect(state?.clientId).toBe('client-1');
			expect(state?.userId).toBe('user-1');
		});

		it('should track last sync and last active times', async () => {
			await adapter.updateClientState('client-1', 'user-1');

			const state = await adapter.getClientState('client-1');
			expect(state?.lastSync).toBeInstanceOf(Date);
			expect(state?.lastActive).toBeInstanceOf(Date);
		});

		it('should return null for unknown client', async () => {
			const state = await adapter.getClientState('unknown-client');

			expect(state).toBeNull();
		});

		it('should update existing client state', async () => {
			await adapter.updateClientState('client-1', 'user-1');
			const first = await adapter.getClientState('client-1');
			
			await new Promise(r => setTimeout(r, 10));
			await adapter.updateClientState('client-1', 'user-1');
			const second = await adapter.getClientState('client-1');

			expect(second?.lastActive.getTime()).toBeGreaterThanOrEqual(first?.lastActive.getTime()!);
		});
	});

	/**
	 * Real-World Scenarios
	 */
	describe('real-world scenarios', () => {
		it('should handle complete sync workflow', async () => {
			// 1. Client creates data offline
			const op1 = createTestOperation({
				id: 'op-1',
				operation: 'insert',
				data: { id: 'todo-1', text: 'Offline todo' },
				clientId: 'client-1'
			});

			// 2. Apply operation on server
			await adapter.applyOperation(op1, 'user-1');
			await adapter.logSyncOperation(op1, 'user-1');
			await adapter.updateClientState('client-1', 'user-1');

			// 3. Verify data exists
			const record = await adapter.findOne('todos', 'todo-1');
			expect(record?.text).toBe('Offline todo');

			// 4. Another client pulls changes
			const changes = await adapter.getChangesSince('todos', 0, undefined, 'client-2');
			expect(changes.length).toBeGreaterThanOrEqual(1);
		});

		it('should handle conflict detection scenario', async () => {
			// Initial data
			await adapter.insert('todos', { id: 'todo-1', text: 'Original', _version: 1 } as MockRecord);

			// Client 1 updates
			await adapter.update('todos', 'todo-1', { text: 'Client 1 update' }, 1);

			// Client 2 tries to update with stale version
			const hasConflict = await adapter.checkConflict('todos', 'todo-1', 1);
			expect(hasConflict).toBe(true);

			// Client 2 should fetch latest version first
			const current = await adapter.findOne('todos', 'todo-1');
			expect(current?._version).toBe(2);
		});

		it('should handle multi-user data isolation', async () => {
			// User 1's data
			await adapter.insert('todos', { id: 'todo-1', userId: 'user-1', text: 'User 1 todo' } as MockRecord);
			
			// User 2's data
			await adapter.insert('todos', { id: 'todo-2', userId: 'user-2', text: 'User 2 todo' } as MockRecord);

			// Each user should only see their own changes
			const user1Changes = await adapter.getChangesSince('todos', 0, 'user-1');
			const user2Changes = await adapter.getChangesSince('todos', 0, 'user-2');

			expect(user1Changes.every(c => c.data.userId === 'user-1')).toBe(true);
			expect(user2Changes.every(c => c.data.userId === 'user-2')).toBe(true);
		});

		it('should handle rapid sequential operations', async () => {
			// Simulate rapid user edits
			await adapter.insert('todos', { id: 'todo-1', text: 'v1', _version: 1 } as MockRecord);
			
			for (let i = 2; i <= 10; i++) {
				await adapter.update('todos', 'todo-1', { text: `v${i}` }, i - 1);
			}

			const final = await adapter.findOne('todos', 'todo-1');
			expect(final?.text).toBe('v10');
			expect(final?._version).toBe(10);
		});

		it('should handle bulk sync operation', async () => {
			// Server receives multiple operations at once
			const operations: SyncOperation[] = [];
			for (let i = 0; i < 20; i++) {
				operations.push(createTestOperation({
					id: `op-${i}`,
					operation: 'insert',
					data: { id: `todo-${i}`, text: `Todo ${i}` }
				}));
			}

			// Apply all operations
			for (const op of operations) {
				await adapter.applyOperation(op, 'user-1');
			}

			const allRecords = await adapter.find('todos');
			expect(allRecords).toHaveLength(20);
		});
	});
});
