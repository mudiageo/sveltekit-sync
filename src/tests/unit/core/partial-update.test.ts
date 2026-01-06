/**
 * Partial Update Tests
 * 
 * Tests to ensure partial updates merge with existing data correctly
 * and don't lose object properties after sync operations.
 * 
 * @see https://github.com/mudiageo/sveltekit-sync/issues/XXX
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncEngine } from '$pkg/client/sync.svelte.js';
import type { SyncConfig, SyncOperation } from '$pkg/types.js';
import { 
	createMockLocalAdapter, 
	createMockRemote, 
	MockBroadcastChannel, 
	setupBroadcastChannelMock 
} from '../../helpers/index.js';

// Set up global mocks before tests
setupBroadcastChannelMock();

describe('Partial Update - Data Merging', () => {
	let adapter: ReturnType<typeof createMockLocalAdapter>;
	let remote: ReturnType<typeof createMockRemote>;
	let config: SyncConfig;
	let engine: SyncEngine;

	beforeEach(() => {
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
		MockBroadcastChannel.reset();
	});

	afterEach(() => {
		engine.destroy();
	});

	describe('update method', () => {
		it('should merge partial update with existing data', async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();

			// Create initial record with multiple properties
			const created = await engine.create('todos', { 
				text: 'Original', 
				completed: false,
				priority: 5,
				tags: ['work', 'urgent']
			});

			// Clear the add to queue mock to track only the update
			adapter.addToQueue.mockClear();

			// Update only one property
			const updated = await engine.update('todos', created.id, { completed: true });

			// Verify all original properties are preserved
			expect(updated.text).toBe('Original');
			expect(updated.completed).toBe(true);
			expect(updated.priority).toBe(5);
			expect(updated.tags).toEqual(['work', 'urgent']);
			expect(updated._version).toBe(2);
		});

		it('should preserve properties not included in partial update', async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();

			const created = await engine.create('todos', { 
				text: 'Task',
				completed: false,
				description: 'Detailed description',
				dueDate: '2024-12-31'
			});

			// Update only text field
			const updated = await engine.update('todos', created.id, { text: 'Updated Task' });

			// All other properties should be preserved
			expect(updated.text).toBe('Updated Task');
			expect(updated.completed).toBe(false);
			expect(updated.description).toBe('Detailed description');
			expect(updated.dueDate).toBe('2024-12-31');
		});
	});

	describe('handleRealtimeOperations', () => {
		it('should merge partial update from realtime operations', async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();

			// Create initial record
			const created = await engine.create('todos', { 
				text: 'Original',
				completed: false,
				priority: 3,
				category: 'work'
			});

			// Simulate realtime update with partial data
			const realtimeOp: SyncOperation = {
				id: crypto.randomUUID(),
				table: 'todos',
				operation: 'update',
				data: { id: created.id, completed: true },
				timestamp: Date.now(),
				clientId: 'other-client',
				version: 2,
				status: 'synced'
			};

			// Apply the realtime operation
			await engine['handleRealtimeOperations']([realtimeOp]);

			// Verify the data was merged
			const record = await engine.findOne('todos', created.id);
			expect(record.text).toBe('Original');
			expect(record.completed).toBe(true);
			expect(record.priority).toBe(3);
			expect(record.category).toBe('work');
		});
	});

	describe('pull method', () => {
		it('should merge partial update from pull operations', async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();

			// Create initial record
			const created = await engine.create('todos', { 
				text: 'Original',
				completed: false,
				assignee: 'Alice',
				labels: ['bug', 'high']
			});

			// Mock remote pull to return partial update
			remote.pull.mockResolvedValue([
				{
					id: crypto.randomUUID(),
					table: 'todos',
					operation: 'update',
					data: { id: created.id, text: 'Updated from server' },
					timestamp: Date.now(),
					clientId: 'other-client',
					version: 2,
					status: 'synced'
				}
			]);

			// Perform pull
			await engine['pull']();

			// Verify the data was merged
			const record = await engine.findOne('todos', created.id);
			expect(record.text).toBe('Updated from server');
			expect(record.completed).toBe(false);
			expect(record.assignee).toBe('Alice');
			expect(record.labels).toEqual(['bug', 'high']);
		});
	});

	describe('pullInitialData method', () => {
		it('should handle partial update data during initial pull', async () => {
			// Mock that DB is not initialized
			adapter.isInitialized.mockResolvedValue(false);

			// Mock remote pull to return data
			remote.pull.mockResolvedValue([
				{
					id: crypto.randomUUID(),
					table: 'todos',
					operation: 'insert',
					data: { 
						id: 'todo-1', 
						text: 'Initial',
						completed: false,
						priority: 5
					},
					timestamp: Date.now(),
					clientId: 'server',
					version: 1,
					status: 'synced'
				},
				{
					id: crypto.randomUUID(),
					table: 'todos',
					operation: 'update',
					data: { id: 'todo-1', completed: true },
					timestamp: Date.now() + 1000,
					clientId: 'other-client',
					version: 2,
					status: 'synced'
				}
			]);

			await engine.init();

			// Verify the final record has merged data
			const record = await engine.findOne('todos', 'todo-1');
			expect(record.text).toBe('Initial');
			expect(record.completed).toBe(true);
			expect(record.priority).toBe(5);
		});
	});

	describe('complex nested objects', () => {
		it('should preserve nested objects during partial updates', async () => {
			adapter.isInitialized.mockResolvedValue(true);
			await engine.init();

			const created = await engine.create('todos', { 
				text: 'Task',
				metadata: {
					author: 'Alice',
					created: '2024-01-01',
					tags: ['important']
				},
				settings: {
					notifications: true,
					theme: 'dark'
				}
			});

			// Update only nested property
			const updated = await engine.update('todos', created.id, { 
				text: 'Updated Task'
			});

			// Nested objects should be preserved
			expect(updated.metadata).toEqual({
				author: 'Alice',
				created: '2024-01-01',
				tags: ['important']
			});
			expect(updated.settings).toEqual({
				notifications: true,
				theme: 'dark'
			});
		});
	});
});
