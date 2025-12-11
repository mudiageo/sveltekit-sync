/**
 * RealtimeServer Unit Tests
 * 
 * Tests for the server-side realtime connection manager.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealtimeServer, createRealtimeServer } from '$pkg/realtime/server.js';
import type { SyncOperation } from '$pkg/types.js';
import { createTestOperation } from '../../helpers/index.js';

describe('RealtimeServer', () => {
	let server: RealtimeServer;

	beforeEach(() => {
		server = new RealtimeServer();
	});

	afterEach(() => {
		server.destroy();
	});

	describe('initialization', () => {
		it('should create a server with default config', () => {
			expect(server).toBeDefined();
			expect(server.getConnectionCount()).toBe(0);
		});

		it('should create a server with custom config', () => {
			const customServer = new RealtimeServer({
				enabled: true,
				heartbeatInterval: 60000,
				maxConnectionsPerUser: 10
			});

			expect(customServer).toBeDefined();
			expect(customServer.getConnectionCount()).toBe(0);

			customServer.destroy();
		});

		it('should start heartbeat when enabled', () => {
			const heartbeatServer = new RealtimeServer({
				enabled: true,
				heartbeatInterval: 1000
			});

			expect(heartbeatServer).toBeDefined();

			heartbeatServer.destroy();
		});
	});

	describe('factory function', () => {
		it('should create a server via factory function', () => {
			const factoryServer = createRealtimeServer({ enabled: true });

			expect(factoryServer).toBeDefined();
			expect(factoryServer).toBeInstanceOf(RealtimeServer);

			factoryServer.destroy();
		});
	});

	describe('configure', () => {
		it('should update configuration at runtime', () => {
			server.configure({ heartbeatInterval: 45000 });

			expect(server).toBeDefined();
		});

		it('should handle enabling/disabling at runtime', () => {
			server.configure({ enabled: false });
			expect(server.getConnectionCount()).toBe(0);

			server.configure({ enabled: true });
			expect(server.getConnectionCount()).toBe(0);
		});
	});

	describe('createConnection', () => {
		it('should create an SSE response', () => {
			const response = server.createConnection(
				'conn-1',
				'user-1',
				'client-1',
				['todos']
			);

			expect(response).toBeInstanceOf(Response);
			expect(response.headers.get('Content-Type')).toBe('text/event-stream');
			expect(response.headers.get('Cache-Control')).toBe('no-cache');
			expect(response.headers.get('Connection')).toBe('keep-alive');
		});

		it('should return 503 when disabled', () => {
			const disabledServer = new RealtimeServer({ enabled: false });

			const response = disabledServer.createConnection(
				'conn-1',
				'user-1',
				'client-1'
			);

			expect(response.status).toBe(503);

			disabledServer.destroy();
		});

		it('should enforce max connections per user', () => {
			const limitedServer = new RealtimeServer({ maxConnectionsPerUser: 2 });

			// Create first connection
			limitedServer.createConnection('conn-1', 'user-1', 'client-1');
			expect(limitedServer.getConnectionCount()).toBe(1);

			// Create second connection
			limitedServer.createConnection('conn-2', 'user-1', 'client-1');
			expect(limitedServer.getConnectionCount()).toBe(2);

			// Third connection should remove the oldest
			limitedServer.createConnection('conn-3', 'user-1', 'client-1');
			expect(limitedServer.getConnectionCount()).toBe(2);

			limitedServer.destroy();
		});

		it('should filter tables to allowed ones', () => {
			const restrictedServer = new RealtimeServer({
				allowedTables: ['todos']
			});

			const response = restrictedServer.createConnection(
				'conn-1',
				'user-1',
				'client-1',
				['todos', 'notes', 'settings']
			);

			expect(response).toBeInstanceOf(Response);

			restrictedServer.destroy();
		});
	});

	describe('connection management', () => {
		it('should track active connections', () => {
			expect(server.getConnectionCount()).toBe(0);

			server.createConnection('conn-1', 'user-1', 'client-1');
			expect(server.getConnectionCount()).toBe(1);

			server.createConnection('conn-2', 'user-2', 'client-2');
			expect(server.getConnectionCount()).toBe(2);
		});

		it('should track user connections', () => {
			server.createConnection('conn-1', 'user-1', 'client-1');
			server.createConnection('conn-2', 'user-1', 'client-2');
			server.createConnection('conn-3', 'user-2', 'client-3');

			const user1Connections = server.getUserConnections('user-1');
			const user2Connections = server.getUserConnections('user-2');

			expect(user1Connections).toHaveLength(2);
			expect(user2Connections).toHaveLength(1);
		});

		it('should return empty array for user with no connections', () => {
			const connections = server.getUserConnections('nonexistent-user');

			expect(connections).toEqual([]);
		});
	});

	describe('broadcast', () => {
		it('should broadcast operations to all connections', () => {
			const handler = vi.fn();
			server.on('broadcast', handler);

			const operation = createTestOperation({
				table: 'todos',
				operation: 'insert'
			});

			// Create connections
			server.createConnection('conn-1', 'user-1', 'client-1', ['todos']);
			server.createConnection('conn-2', 'user-2', 'client-2', ['todos']);

			server.broadcast([operation]);

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					operations: [operation],
					tables: ['todos']
				})
			);
		});

		it('should exclude originating client from broadcast', () => {
			const operation = createTestOperation({
				table: 'todos',
				operation: 'insert'
			});

			server.createConnection('conn-1', 'user-1', 'client-1', ['todos']);
			server.createConnection('conn-2', 'user-2', 'client-2', ['todos']);

			// Should not throw
			expect(() => server.broadcast([operation], 'client-1')).not.toThrow();
		});

		it('should filter operations by subscribed tables', () => {
			const todosOp = createTestOperation({ table: 'todos' });
			const notesOp = createTestOperation({ table: 'notes' });

			// Connection only subscribed to 'todos'
			server.createConnection('conn-1', 'user-1', 'client-1', ['todos']);

			// Should not throw
			expect(() => server.broadcast([todosOp, notesOp])).not.toThrow();
		});

		it('should broadcast to all tables when subscription is empty', () => {
			const operation = createTestOperation({ table: 'todos' });

			// Empty tables array = all tables
			server.createConnection('conn-1', 'user-1', 'client-1', []);

			expect(() => server.broadcast([operation])).not.toThrow();
		});

		it('should not broadcast when disabled', () => {
			const disabledServer = new RealtimeServer({ enabled: false });
			const handler = vi.fn();
			disabledServer.on('broadcast', handler);

			const operation = createTestOperation();

			disabledServer.broadcast([operation]);

			expect(handler).not.toHaveBeenCalled();

			disabledServer.destroy();
		});

		it('should not broadcast empty operations array', () => {
			const handler = vi.fn();
			server.on('broadcast', handler);

			server.broadcast([]);

			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe('sendToUser', () => {
		it('should send operations to specific user connections', () => {
			const operation = createTestOperation({ table: 'todos' });

			server.createConnection('conn-1', 'user-1', 'client-1', ['todos']);
			server.createConnection('conn-2', 'user-1', 'client-2', ['todos']);
			server.createConnection('conn-3', 'user-2', 'client-3', ['todos']);

			// Should not throw
			expect(() => server.sendToUser('user-1', [operation])).not.toThrow();
		});

		it('should filter operations by user subscribed tables', () => {
			const todosOp = createTestOperation({ table: 'todos' });
			const notesOp = createTestOperation({ table: 'notes' });

			server.createConnection('conn-1', 'user-1', 'client-1', ['todos']);

			expect(() => server.sendToUser('user-1', [todosOp, notesOp])).not.toThrow();
		});
	});

	describe('sendtoAll', () => {
		it('should send custom event to all connections', () => {
			server.createConnection('conn-1', 'user-1', 'client-1');
			server.createConnection('conn-2', 'user-2', 'client-2');

			expect(() => server.sendtoAll('custom', { message: 'hello' })).not.toThrow();
		});

		it('should handle sending to no connections', () => {
			expect(() => server.sendtoAll('custom', { message: 'hello' })).not.toThrow();
		});
	});

	describe('disconnectAll', () => {
		it('should disconnect all clients', () => {
			server.createConnection('conn-1', 'user-1', 'client-1');
			server.createConnection('conn-2', 'user-2', 'client-2');

			expect(server.getConnectionCount()).toBe(2);

			server.disconnectAll();

			expect(server.getConnectionCount()).toBe(0);
		});
	});

	describe('event emitting', () => {
		it('should emit connected event when connection is added', () => {
			const handler = vi.fn();
			server.on('connected', handler);

			server.createConnection('conn-1', 'user-1', 'client-1');

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'conn-1',
					userId: 'user-1',
					clientId: 'client-1'
				})
			);
		});

		it('should emit disconnected event when connection is removed', () => {
			const handler = vi.fn();
			server.on('disconnected', handler);

			// Create and immediately close connection via stream cancel
			const response = server.createConnection('conn-1', 'user-1', 'client-1');
			const reader = response.body?.getReader();
			reader?.cancel();

			// Wait a bit for the cancel to propagate
			return new Promise<void>((resolve) => {
				setTimeout(() => {
					expect(handler).toHaveBeenCalled();
					resolve();
				}, 10);
			});
		});
	});

	describe('destroy', () => {
		it('should clean up all resources', () => {
			server.createConnection('conn-1', 'user-1', 'client-1');
			server.createConnection('conn-2', 'user-2', 'client-2');

			server.destroy();

			expect(server.getConnectionCount()).toBe(0);
		});

		it('should stop heartbeat on destroy', () => {
			const heartbeatServer = new RealtimeServer({
				enabled: true,
				heartbeatInterval: 1000
			});

			heartbeatServer.destroy();

			expect(heartbeatServer.getConnectionCount()).toBe(0);
		});

		it('should remove all event listeners on destroy', () => {
			const handler = vi.fn();
			server.on('broadcast', handler);

			server.destroy();

			expect(server.listenerCount('broadcast')).toBe(0);
		});
	});
});
