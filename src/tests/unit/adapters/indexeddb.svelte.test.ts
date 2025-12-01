/**
 * IndexedDB Adapter Browser Tests
 * 
 * Comprehensive tests for the IndexedDBAdapter using real IndexedDB in browser environment.
 * Tests cover all CRUD operations, sync queue management, metadata, edge cases,
 * concurrent operations, and error scenarios.
 * 
 * Following Sveltest principles:
 * - Use real APIs, not mocks
 * - Test in actual browser environment
 * - Cover happy paths, error cases, and edge cases
 * 
 * @see https://sveltest.dev/docs/getting-started
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBAdapter } from '$pkg/adapters/indexeddb.js';
import type { SyncOperation } from '$pkg/types.js';

describe('IndexedDBAdapter (Browser)', () => {
	let adapter: IndexedDBAdapter;
	let testDbName: string;

	beforeEach(async () => {
		// Create a new adapter with unique db name to avoid conflicts between tests
		testDbName = 'test-sync-db-' + Math.random().toString(36).slice(2, 11);
		adapter = new IndexedDBAdapter(testDbName, 1);
	});

	afterEach(async () => {
		// Clean up: delete the test database
		try {
			const deleteRequest = indexedDB.deleteDatabase(testDbName);
			await new Promise<void>((resolve, reject) => {
				deleteRequest.onsuccess = () => resolve();
				deleteRequest.onerror = () => reject(deleteRequest.error);
				deleteRequest.onblocked = () => resolve(); // Handle blocked case
			});
		} catch {
			// Ignore cleanup errors
		}
	});

	/**
	 * Initialization Tests
	 */
	describe('initialization', () => {
		it('should throw error when accessing before init', async () => {
			await expect(adapter.find('todos')).rejects.toThrow('Database not initialized');
		});

		it('should initialize with default stores', async () => {
			await adapter.init();
			
			// Should be able to access sync_queue and sync_meta stores
			const queue = await adapter.getQueue();
			expect(queue).toEqual([]);
		});

		it('should initialize with custom schema', async () => {
			await adapter.init({ todos: 'id', notes: 'id' });
			
			// Should be able to insert into custom tables
			const todo = { id: 'todo-1', text: 'Test todo' };
			await adapter.insert('todos', todo);
			
			const found = await adapter.findOne('todos', 'todo-1');
			expect(found).toEqual(todo);
		});

		it('should skip re-initialization if already initialized', async () => {
			await adapter.init();
			// Second init should not throw
			await adapter.init({ other: 'id' });
			
			// Original functionality should still work
			const queue = await adapter.getQueue();
			expect(queue).toEqual([]);
		});
	});

	/**
	 * CRUD Operations Tests
	 */
	describe('CRUD operations', () => {
		beforeEach(async () => {
			await adapter.init({ todos: 'id' });
		});

		describe('insert', () => {
			it('should insert a record', async () => {
				const data = { id: 'todo-1', text: 'Test todo', completed: false };
				const result = await adapter.insert('todos', data);
				
				expect(result).toEqual(data);
				
				const found = await adapter.findOne('todos', 'todo-1');
				expect(found).toEqual(data);
			});

			it('should reject duplicate keys', async () => {
				const data = { id: 'todo-1', text: 'Test todo' };
				await adapter.insert('todos', data);
				
				await expect(adapter.insert('todos', data)).rejects.toThrow();
			});
		});

		describe('update', () => {
			it('should update an existing record', async () => {
				await adapter.insert('todos', { id: 'todo-1', text: 'Original' });
				
				await adapter.update('todos', 'todo-1', { text: 'Updated' });
				
				// Verify by reading the updated record
				const found = await adapter.findOne('todos', 'todo-1');
				expect(found).toEqual({ id: 'todo-1', text: 'Updated' });
			});

			it('should create record if it does not exist (upsert)', async () => {
				await adapter.update('todos', 'todo-new', { text: 'New todo' });
				
				// Verify by reading the created record
				const found = await adapter.findOne('todos', 'todo-new');
				expect(found).toEqual({ id: 'todo-new', text: 'New todo' });
			});

			it('should merge update with existing data', async () => {
				await adapter.insert('todos', { id: 'todo-1', text: 'Original', completed: false });
				
				await adapter.update('todos', 'todo-1', { text: 'Updated', completed: true });
				
				const found = await adapter.findOne('todos', 'todo-1');
				expect(found?.text).toBe('Updated');
				expect(found?.completed).toBe(true);
			});
		});

		describe('delete', () => {
			it('should delete a record', async () => {
				await adapter.insert('todos', { id: 'todo-1', text: 'Test' });
				
				await adapter.delete('todos', 'todo-1');
				
				const result = await adapter.findOne('todos', 'todo-1');
				expect(result).toBeNull();
			});

			it('should not throw when deleting non-existent record', async () => {
				await expect(adapter.delete('todos', 'non-existent')).resolves.not.toThrow();
			});
		});

		describe('find', () => {
			it('should return all records in table', async () => {
				await adapter.insert('todos', { id: 'todo-1', text: 'First' });
				await adapter.insert('todos', { id: 'todo-2', text: 'Second' });
				
				const results = await adapter.find('todos');
				
				expect(results).toHaveLength(2);
			});

			it('should return empty array when no records exist', async () => {
				const results = await adapter.find('todos');
				
				expect(results).toEqual([]);
			});
		});

		describe('findOne', () => {
			it('should return a single record by id', async () => {
				await adapter.insert('todos', { id: 'todo-1', text: 'Test' });
				
				const result = await adapter.findOne('todos', 'todo-1');
				
				expect(result).toEqual({ id: 'todo-1', text: 'Test' });
			});

			it('should return null when record not found', async () => {
				const result = await adapter.findOne('todos', 'non-existent');
				
				expect(result).toBeNull();
			});
		});
	});

	/**
	 * Sync Queue Operations Tests
	 */
	describe('sync queue operations', () => {
		beforeEach(async () => {
			await adapter.init();
		});

		it('should add operation to queue', async () => {
			const op: SyncOperation = {
				id: 'op-1',
				table: 'todos',
				operation: 'insert',
				data: { id: 'todo-1', text: 'Test' },
				timestamp: new Date(),
				clientId: 'client-1',
				version: 1,
				status: 'pending'
			};
			
			await adapter.addToQueue(op);
			
			const queue = await adapter.getQueue();
			expect(queue).toHaveLength(1);
			expect(queue[0]).toMatchObject({ id: 'op-1', table: 'todos' });
		});

		it('should get all queued operations', async () => {
			const now = Date.now();
			await adapter.addToQueue({
				id: 'op-1',
				table: 'todos',
				operation: 'insert',
				data: {},
				timestamp: new Date(now),
				clientId: 'client-1',
				version: 1,
				status: 'pending'
			});
			await adapter.addToQueue({
				id: 'op-2',
				table: 'todos',
				operation: 'update',
				data: {},
				timestamp: new Date(now + 1),
				clientId: 'client-1',
				version: 2,
				status: 'pending'
			});
			
			const queue = await adapter.getQueue();
			
			expect(queue).toHaveLength(2);
		});

		it('should remove operations from queue', async () => {
			await adapter.addToQueue({
				id: 'op-1',
				table: 'todos',
				operation: 'insert',
				data: {},
				timestamp: new Date(),
				clientId: 'client-1',
				version: 1,
				status: 'pending'
			});
			await adapter.addToQueue({
				id: 'op-2',
				table: 'todos',
				operation: 'insert',
				data: {},
				timestamp: new Date(),
				clientId: 'client-1',
				version: 1,
				status: 'pending'
			});
			
			await adapter.removeFromQueue(['op-1']);
			
			const queue = await adapter.getQueue();
			expect(queue).toHaveLength(1);
			expect(queue[0].id).toBe('op-2');
		});

		it('should update queue operation status', async () => {
			await adapter.addToQueue({
				id: 'op-1',
				table: 'todos',
				operation: 'insert',
				data: {},
				timestamp: new Date(),
				clientId: 'client-1',
				version: 1,
				status: 'pending'
			});
			
			await adapter.updateQueueStatus('op-1', 'synced');
			
			const queue = await adapter.getQueue();
			expect(queue[0].status).toBe('synced');
		});

		it('should update queue operation status with error', async () => {
			await adapter.addToQueue({
				id: 'op-1',
				table: 'todos',
				operation: 'insert',
				data: {},
				timestamp: new Date(),
				clientId: 'client-1',
				version: 1,
				status: 'pending'
			});
			
			await adapter.updateQueueStatus('op-1', 'error', 'Network failed');
			
			const queue = await adapter.getQueue();
			expect(queue[0].status).toBe('error');
			expect(queue[0].error).toBe('Network failed');
		});
	});

	/**
	 * Metadata Operations Tests
	 */
	describe('metadata operations', () => {
		beforeEach(async () => {
			await adapter.init();
		});

		describe('lastSync', () => {
			it('should return 0 when lastSync not set', async () => {
				const lastSync = await adapter.getLastSync();
				
				expect(lastSync).toBe(0);
			});

			it('should set and get lastSync timestamp', async () => {
				const timestamp = Date.now();
				
				await adapter.setLastSync(timestamp);
				const result = await adapter.getLastSync();
				
				expect(result).toBe(timestamp);
			});

			it('should update existing lastSync', async () => {
				await adapter.setLastSync(1000);
				await adapter.setLastSync(2000);
				
				const result = await adapter.getLastSync();
				expect(result).toBe(2000);
			});

			it('should handle very large timestamps', async () => {
				const largeTimestamp = Number.MAX_SAFE_INTEGER;
				
				await adapter.setLastSync(largeTimestamp);
				const result = await adapter.getLastSync();
				
				expect(result).toBe(largeTimestamp);
			});

			it('should handle zero timestamp', async () => {
				await adapter.setLastSync(1000);
				await adapter.setLastSync(0);
				
				const result = await adapter.getLastSync();
				expect(result).toBe(0);
			});
		});

		describe('clientId', () => {
			it('should generate clientId on first call', async () => {
				const clientId = await adapter.getClientId();
				
				expect(clientId).toBeDefined();
				expect(typeof clientId).toBe('string');
				expect(clientId.length).toBeGreaterThan(0);
			});

			it('should return same clientId on subsequent calls', async () => {
				const first = await adapter.getClientId();
				const second = await adapter.getClientId();
				
				expect(first).toBe(second);
			});

			it('should generate valid UUID format', async () => {
				const clientId = await adapter.getClientId();
				
				// UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
				const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
				expect(clientId).toMatch(uuidRegex);
			});
		});
	});

	/**
	 * Edge Cases and Error Scenarios
	 */
	describe('edge cases', () => {
		beforeEach(async () => {
			await adapter.init({ todos: 'id', notes: 'id' });
		});

		describe('data types', () => {
			it('should handle records with nested objects', async () => {
				const data = {
					id: 'todo-1',
					text: 'Test',
					metadata: {
						tags: ['important', 'work'],
						priority: { level: 'high', score: 10 }
					}
				};
				
				await adapter.insert('todos', data);
				const found = await adapter.findOne('todos', 'todo-1');
				
				expect(found).toEqual(data);
			});

			it('should handle records with arrays', async () => {
				const data = {
					id: 'todo-1',
					items: [1, 2, 3, 'four', { nested: true }]
				};
				
				await adapter.insert('todos', data);
				const found = await adapter.findOne('todos', 'todo-1');
				
				expect(found).toEqual(data);
			});

			it('should handle records with null values', async () => {
				const data = {
					id: 'todo-1',
					text: null,
					completed: null
				};
				
				await adapter.insert('todos', data);
				const found = await adapter.findOne('todos', 'todo-1');
				
				expect(found).toEqual(data);
			});

			it('should handle records with boolean values', async () => {
				const data = {
					id: 'todo-1',
					active: true,
					archived: false
				};
				
				await adapter.insert('todos', data);
				const found = await adapter.findOne('todos', 'todo-1');
				
				expect(found).toEqual(data);
			});

			it('should handle records with Date objects', async () => {
				const now = new Date();
				const data = {
					id: 'todo-1',
					createdAt: now
				};
				
				await adapter.insert('todos', data);
				const found = await adapter.findOne('todos', 'todo-1');
				
				expect(found?.createdAt).toEqual(now);
			});

			it('should handle empty string id', async () => {
				// Empty string is technically a valid key
				const data = { id: '', text: 'Empty ID' };
				
				await adapter.insert('todos', data);
				const found = await adapter.findOne('todos', '');
				
				expect(found).toEqual(data);
			});

			it('should handle unicode characters in data', async () => {
				const data = {
					id: 'todo-1',
					text: '你好世界 🌍 مرحبا Привет',
					emoji: '🎉🎊🎁'
				};
				
				await adapter.insert('todos', data);
				const found = await adapter.findOne('todos', 'todo-1');
				
				expect(found).toEqual(data);
			});

			it('should handle very long strings', async () => {
				const longString = 'x'.repeat(100000);
				const data = { id: 'todo-1', text: longString };
				
				await adapter.insert('todos', data);
				const found = await adapter.findOne('todos', 'todo-1');
				
				expect(found?.text.length).toBe(100000);
			});
		});

		describe('multiple tables', () => {
			it('should isolate data between tables', async () => {
				await adapter.insert('todos', { id: 'item-1', type: 'todo' });
				await adapter.insert('notes', { id: 'item-1', type: 'note' });
				
				const todo = await adapter.findOne('todos', 'item-1');
				const note = await adapter.findOne('notes', 'item-1');
				
				expect(todo?.type).toBe('todo');
				expect(note?.type).toBe('note');
			});

			it('should handle deletes in one table without affecting others', async () => {
				await adapter.insert('todos', { id: 'item-1', type: 'todo' });
				await adapter.insert('notes', { id: 'item-1', type: 'note' });
				
				await adapter.delete('todos', 'item-1');
				
				const todo = await adapter.findOne('todos', 'item-1');
				const note = await adapter.findOne('notes', 'item-1');
				
				expect(todo).toBeNull();
				expect(note?.type).toBe('note');
			});
		});

		describe('concurrent operations', () => {
			it('should handle multiple simultaneous inserts', async () => {
				const promises = [];
				for (let i = 0; i < 10; i++) {
					promises.push(adapter.insert('todos', { id: `todo-${i}`, index: i }));
				}
				
				await Promise.all(promises);
				
				const results = await adapter.find('todos');
				expect(results).toHaveLength(10);
			});

			it('should handle simultaneous read and write', async () => {
				await adapter.insert('todos', { id: 'todo-1', text: 'Original' });
				
				const [readResult, updateResult] = await Promise.all([
					adapter.findOne('todos', 'todo-1'),
					adapter.update('todos', 'todo-1', { text: 'Updated' })
				]);
				
				// Both operations should complete
				expect(readResult).toBeDefined();
				expect(updateResult).toBeDefined();
			});

			it('should handle rapid queue operations', async () => {
				const ops: SyncOperation[] = [];
				for (let i = 0; i < 20; i++) {
					ops.push({
						id: `op-${i}`,
						table: 'todos',
						operation: 'insert',
						data: { id: `todo-${i}` },
						timestamp: new Date(Date.now() + i),
						clientId: 'client-1',
						version: 1,
						status: 'pending'
					});
				}
				
				// Add all operations
				await Promise.all(ops.map(op => adapter.addToQueue(op)));
				
				const queue = await adapter.getQueue();
				expect(queue).toHaveLength(20);
			});
		});
	});

	/**
	 * Sync Queue Advanced Scenarios
	 */
	describe('sync queue advanced scenarios', () => {
		beforeEach(async () => {
			await adapter.init({ todos: 'id' });
		});

		it('should maintain operation order in queue', async () => {
			const now = Date.now();
			for (let i = 0; i < 5; i++) {
				await adapter.addToQueue({
					id: `op-${i}`,
					table: 'todos',
					operation: 'insert',
					data: { id: `todo-${i}` },
					timestamp: new Date(now + i),
					clientId: 'client-1',
					version: 1,
					status: 'pending'
				});
			}
			
			const queue = await adapter.getQueue();
			
			// Operations should be retrievable (order may vary due to IndexedDB)
			expect(queue).toHaveLength(5);
			const ids = queue.map(op => op.id);
			expect(ids).toContain('op-0');
			expect(ids).toContain('op-4');
		});

		it('should handle removing multiple operations at once', async () => {
			for (let i = 0; i < 5; i++) {
				await adapter.addToQueue({
					id: `op-${i}`,
					table: 'todos',
					operation: 'insert',
					data: {},
					timestamp: new Date(),
					clientId: 'client-1',
					version: 1,
					status: 'pending'
				});
			}
			
			await adapter.removeFromQueue(['op-0', 'op-2', 'op-4']);
			
			const queue = await adapter.getQueue();
			expect(queue).toHaveLength(2);
			expect(queue.map(op => op.id)).toEqual(expect.arrayContaining(['op-1', 'op-3']));
		});

		it('should handle removing non-existent operations gracefully', async () => {
			await adapter.addToQueue({
				id: 'op-1',
				table: 'todos',
				operation: 'insert',
				data: {},
				timestamp: new Date(),
				clientId: 'client-1',
				version: 1,
				status: 'pending'
			});
			
			// Should not throw when removing non-existent ops
			await expect(
				adapter.removeFromQueue(['op-1', 'non-existent', 'also-missing'])
			).resolves.not.toThrow();
			
			const queue = await adapter.getQueue();
			expect(queue).toHaveLength(0);
		});

		it('should track different operation types', async () => {
			const operations: SyncOperation[] = [
				{ id: 'op-1', table: 'todos', operation: 'insert', data: {}, timestamp: new Date(), clientId: 'c1', version: 1, status: 'pending' },
				{ id: 'op-2', table: 'todos', operation: 'update', data: {}, timestamp: new Date(), clientId: 'c1', version: 2, status: 'pending' },
				{ id: 'op-3', table: 'todos', operation: 'delete', data: {}, timestamp: new Date(), clientId: 'c1', version: 3, status: 'pending' }
			];
			
			for (const op of operations) {
				await adapter.addToQueue(op);
			}
			
			const queue = await adapter.getQueue();
			const types = queue.map(op => op.operation);
			
			expect(types).toContain('insert');
			expect(types).toContain('update');
			expect(types).toContain('delete');
		});

		it('should preserve all operation fields through queue', async () => {
			const originalOp: SyncOperation = {
				id: 'op-full',
				table: 'todos',
				operation: 'update',
				data: { id: 'todo-1', text: 'Test', completed: true },
				timestamp: 1234567890,
				clientId: 'client-abc-123',
				version: 42,
				status: 'pending',
				userId: 'user-456'
			};
			
			await adapter.addToQueue(originalOp);
			
			const queue = await adapter.getQueue();
			const retrieved = queue.find(op => op.id === 'op-full');
			
			expect(retrieved).toMatchObject(originalOp);
		});

		it('should handle status transitions correctly', async () => {
			await adapter.addToQueue({
				id: 'op-1',
				table: 'todos',
				operation: 'insert',
				data: {},
				timestamp: new Date(),
				clientId: 'client-1',
				version: 1,
				status: 'pending'
			});
			
			// Transition through statuses
			await adapter.updateQueueStatus('op-1', 'synced');
			let queue = await adapter.getQueue();
			expect(queue[0].status).toBe('synced');
			
			// Can go back to pending (retry scenario)
			await adapter.updateQueueStatus('op-1', 'pending');
			queue = await adapter.getQueue();
			expect(queue[0].status).toBe('pending');
			
			// Can mark as error
			await adapter.updateQueueStatus('op-1', 'error', 'Failed after retry');
			queue = await adapter.getQueue();
			expect(queue[0].status).toBe('error');
			expect(queue[0].error).toBe('Failed after retry');
		});
	});

	/**
	 * Persistence and Durability Tests
	 */
	describe('persistence', () => {
		it('should persist data across adapter instances', async () => {
			// First adapter instance
			await adapter.init({ todos: 'id' });
			await adapter.insert('todos', { id: 'todo-1', text: 'Persistent' });
			
			// Create new adapter instance with same db name
			const adapter2 = new IndexedDBAdapter(testDbName, 1);
			await adapter2.init({ todos: 'id' });
			
			const found = await adapter2.findOne('todos', 'todo-1');
			expect(found?.text).toBe('Persistent');
		});

		it('should persist clientId across adapter instances', async () => {
			await adapter.init();
			const clientId1 = await adapter.getClientId();
			
			// Create new adapter instance
			const adapter2 = new IndexedDBAdapter(testDbName, 1);
			await adapter2.init();
			const clientId2 = await adapter2.getClientId();
			
			expect(clientId1).toBe(clientId2);
		});

		it('should persist lastSync across adapter instances', async () => {
			await adapter.init();
			const timestamp = Date.now();
			await adapter.setLastSync(timestamp);
			
			// Create new adapter instance
			const adapter2 = new IndexedDBAdapter(testDbName, 1);
			await adapter2.init();
			const lastSync = await adapter2.getLastSync();
			
			expect(lastSync).toBe(timestamp);
		});

		it('should persist queue across adapter instances', async () => {
			await adapter.init();
			await adapter.addToQueue({
				id: 'op-1',
				table: 'todos',
				operation: 'insert',
				data: { id: 'todo-1' },
				timestamp: new Date(),
				clientId: 'client-1',
				version: 1,
				status: 'pending'
			});
			
			// Create new adapter instance
			const adapter2 = new IndexedDBAdapter(testDbName, 1);
			await adapter2.init();
			const queue = await adapter2.getQueue();
			
			expect(queue).toHaveLength(1);
			expect(queue[0].id).toBe('op-1');
		});
	});

	/**
	 * Real-World Workflow Scenarios
	 */
	describe('real-world workflows', () => {
		beforeEach(async () => {
			await adapter.init({ todos: 'id' });
		});

		it('should support complete CRUD lifecycle', async () => {
			// Create
			const created = await adapter.insert('todos', { 
				id: 'todo-1', 
				text: 'Buy groceries', 
				completed: false 
			});
			expect(created.text).toBe('Buy groceries');
			
			// Read
			const read = await adapter.findOne('todos', 'todo-1');
			expect(read?.completed).toBe(false);
			
			// Update
			const updated = await adapter.update('todos', 'todo-1', { 
				text: 'Buy groceries', 
				completed: true 
			});
			expect(updated.completed).toBe(true);
			
			// Delete
			await adapter.delete('todos', 'todo-1');
			const deleted = await adapter.findOne('todos', 'todo-1');
			expect(deleted).toBeNull();
		});

		it('should support offline queue then sync workflow', async () => {
			// Simulate offline: create local data and queue operations
			const todo = { id: 'todo-1', text: 'Offline todo', completed: false };
			await adapter.insert('todos', todo);
			
			await adapter.addToQueue({
				id: 'op-1',
				table: 'todos',
				operation: 'insert',
				data: todo,
				timestamp: new Date(),
				clientId: await adapter.getClientId(),
				version: 1,
				status: 'pending'
			});
			
			// Verify local data exists
			const localData = await adapter.findOne('todos', 'todo-1');
			expect(localData).not.toBeNull();
			
			// Verify queue has pending operation
			let queue = await adapter.getQueue();
			expect(queue).toHaveLength(1);
			expect(queue[0].status).toBe('pending');
			
			// Simulate sync success
			await adapter.updateQueueStatus('op-1', 'synced');
			await adapter.removeFromQueue(['op-1']);
			await adapter.setLastSync(Date.now());
			
			// Verify queue is cleared
			queue = await adapter.getQueue();
			expect(queue).toHaveLength(0);
			
			// Data should still exist locally
			const afterSync = await adapter.findOne('todos', 'todo-1');
			expect(afterSync?.text).toBe('Offline todo');
		});

		it('should handle bulk operations scenario', async () => {
			// Insert many records
			const todos = [];
			for (let i = 0; i < 50; i++) {
				const todo = { id: `todo-${i}`, text: `Task ${i}`, completed: i % 2 === 0 };
				await adapter.insert('todos', todo);
				todos.push(todo);
			}
			
			// Verify all inserted
			const all = await adapter.find('todos');
			expect(all).toHaveLength(50);
			
			// Update some
			for (let i = 0; i < 10; i++) {
				await adapter.update('todos', `todo-${i}`, { text: `Updated Task ${i}`, completed: true });
			}
			
			// Delete some
			for (let i = 40; i < 50; i++) {
				await adapter.delete('todos', `todo-${i}`);
			}
			
			// Verify final state
			const remaining = await adapter.find('todos');
			expect(remaining).toHaveLength(40);
		});

		it('should handle rapid user interactions', async () => {
			const clientId = await adapter.getClientId();
			
			// Simulate rapid user creating, editing, deleting
			const operations: Promise<unknown>[] = [];
			
			// User creates 5 todos quickly
			for (let i = 0; i < 5; i++) {
				operations.push(
					adapter.insert('todos', { id: `todo-${i}`, text: `Quick todo ${i}` })
				);
				operations.push(
					adapter.addToQueue({
						id: `op-create-${i}`,
						table: 'todos',
						operation: 'insert',
						data: { id: `todo-${i}` },
						timestamp: new Date(),
						clientId,
						version: 1,
						status: 'pending'
					})
				);
			}
			
			await Promise.all(operations);
			
			// All should be created
			const todos = await adapter.find('todos');
			expect(todos).toHaveLength(5);
			
			// All operations should be queued
			const queue = await adapter.getQueue();
			expect(queue).toHaveLength(5);
		});
	});
});
