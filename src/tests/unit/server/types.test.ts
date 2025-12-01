/**
 * Server Types Unit Tests
 * 
 * Tests for server-side configuration types.
 * Following Sveltest Foundation First approach.
 * 
 * @see https://sveltest.dev/docs/testing-patterns
 */
import { describe, it, expect } from 'vitest';
import type { SyncTableConfig, SyncConfig } from '$pkg/server/types.js';

describe('Server Types Module', () => {
	/**
	 * SyncTableConfig Tests
	 * Configuration for individual sync tables
	 */
	describe('SyncTableConfig', () => {
		it('should create a minimal table config', () => {
			const config: SyncTableConfig = {
				table: 'todos'
			};

			expect(config.table).toBe('todos');
			expect(config.columns).toBeUndefined();
			expect(config.where).toBeUndefined();
			expect(config.transform).toBeUndefined();
			expect(config.conflictResolution).toBeUndefined();
		});

		it('should create a table config with columns', () => {
			const config: SyncTableConfig = {
				table: 'todos',
				columns: ['id', 'text', 'completed', 'userId', '_version', '_updatedAt']
			};

			expect(config.columns).toHaveLength(6);
			expect(config.columns).toContain('id');
			expect(config.columns).toContain('_version');
		});

		it('should create a table config with where clause', () => {
			const config: SyncTableConfig = {
				table: 'todos',
				where: (userId: string) => ({ userId })
			};

			expect(config.where).toBeDefined();
			expect(config.where!('user-1')).toEqual({ userId: 'user-1' });
		});

		it('should create a table config with transform function', () => {
			interface Todo {
				id: string;
				text: string;
				internalNotes?: string;
			}

			const config: SyncTableConfig<Todo> = {
				table: 'todos',
				transform: (row: Todo) => {
					// eslint-disable-next-line @typescript-eslint/no-unused-vars
					const { internalNotes, ...safe } = row;
					return safe;
				}
			};

			const result = config.transform!({
				id: 'todo-1',
				text: 'Test',
				internalNotes: 'Secret notes'
			});

			expect(result).not.toHaveProperty('internalNotes');
			expect(result.id).toBe('todo-1');
			expect(result.text).toBe('Test');
		});

		it('should support all conflict resolution strategies', () => {
			const configs: SyncTableConfig[] = [
				{ table: 'todos', conflictResolution: 'client-wins' },
				{ table: 'todos', conflictResolution: 'server-wins' },
				{ table: 'todos', conflictResolution: 'last-write-wins' }
			];

			expect(configs[0].conflictResolution).toBe('client-wins');
			expect(configs[1].conflictResolution).toBe('server-wins');
			expect(configs[2].conflictResolution).toBe('last-write-wins');
		});

		it('should create a full table config with all options', () => {
			const config: SyncTableConfig = {
				table: 'todos',
				columns: ['id', 'text', 'completed'],
				where: (userId) => ({ userId }),
				transform: (row) => ({ ...row, transformed: true }),
				conflictResolution: 'last-write-wins'
			};

			expect(config.table).toBe('todos');
			expect(config.columns).toHaveLength(3);
			expect(config.where).toBeDefined();
			expect(config.transform).toBeDefined();
			expect(config.conflictResolution).toBe('last-write-wins');
		});
	});

	/**
	 * SyncConfig Tests
	 * Global server sync configuration
	 */
	describe('SyncConfig', () => {
		it('should create a minimal sync config', () => {
			const config: SyncConfig = {
				tables: {
					todos: { table: 'todos' }
				}
			};

			expect(config.tables).toBeDefined();
			expect(config.tables.todos).toBeDefined();
			expect(config.batchSize).toBeUndefined();
			expect(config.enableRealtime).toBeUndefined();
		});

		it('should create a sync config with multiple tables', () => {
			const config: SyncConfig = {
				tables: {
					todos: { table: 'todos', conflictResolution: 'last-write-wins' },
					notes: { table: 'notes', conflictResolution: 'server-wins' },
					projects: { table: 'projects', conflictResolution: 'client-wins' }
				}
			};

			expect(Object.keys(config.tables)).toHaveLength(3);
			expect(config.tables.todos.conflictResolution).toBe('last-write-wins');
			expect(config.tables.notes.conflictResolution).toBe('server-wins');
			expect(config.tables.projects.conflictResolution).toBe('client-wins');
		});

		it('should create a sync config with global settings', () => {
			const config: SyncConfig = {
				tables: {
					todos: { table: 'todos' }
				},
				batchSize: 100,
				enableRealtime: true
			};

			expect(config.batchSize).toBe(100);
			expect(config.enableRealtime).toBe(true);
		});

		it('should create a complex production-like config', () => {
			const config: SyncConfig = {
				tables: {
					todos: {
						table: 'todos',
						columns: ['id', 'text', 'completed', 'userId', 'createdAt', 'updatedAt', '_version', '_updatedAt'],
						where: (userId: string) => ({ userId }),
						conflictResolution: 'last-write-wins'
					},
					notes: {
						table: 'notes',
						columns: ['id', 'title', 'content', 'userId', 'tags', 'createdAt', '_version', '_updatedAt'],
						where: (userId: string) => ({ userId }),
						transform: (note: { internalNotes?: string }) => {
							// eslint-disable-next-line @typescript-eslint/no-unused-vars
							const { internalNotes, ...safeNote } = note;
							return safeNote;
						}
					},
					teamTodos: {
						table: 'team_todos',
						columns: ['id', 'text', 'completed', 'teamId', 'assignedTo', 'createdAt', '_version', '_updatedAt']
					}
				},
				batchSize: 100,
				enableRealtime: true
			};

			expect(Object.keys(config.tables)).toHaveLength(3);
			expect(config.tables.todos.where).toBeDefined();
			expect(config.tables.notes.transform).toBeDefined();
			expect(config.tables.teamTodos.where).toBeUndefined();
			expect(config.batchSize).toBe(100);
			expect(config.enableRealtime).toBe(true);
		});

		it('should allow accessing tables by key', () => {
			const config: SyncConfig = {
				tables: {
					todos: { table: 'todos', conflictResolution: 'last-write-wins' }
				}
			};

			const tableName = 'todos';
			const tableConfig = config.tables[tableName];

			expect(tableConfig.table).toBe('todos');
			expect(tableConfig.conflictResolution).toBe('last-write-wins');
		});

		it('should allow iterating over tables', () => {
			const config: SyncConfig = {
				tables: {
					todos: { table: 'todos' },
					notes: { table: 'notes' },
					projects: { table: 'projects' }
				}
			};

			const tableNames = Object.keys(config.tables);
			const tableConfigs = Object.values(config.tables);
			const entries = Object.entries(config.tables);

			expect(tableNames).toEqual(['todos', 'notes', 'projects']);
			expect(tableConfigs).toHaveLength(3);
			expect(entries).toHaveLength(3);

			for (const [, tableConfig] of entries) {
				expect(tableConfig.table).toBeDefined();
			}
		});
	});
});
