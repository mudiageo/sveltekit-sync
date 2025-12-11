/**
 * RealtimeClient Unit Tests
 * 
 * Browser-based tests for the client-side realtime connection manager.
 * Uses .svelte.test.ts extension to run in browser environment with Playwright.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealtimeClient, createRealtimeClient } from '$pkg/realtime/client.js';
import type { SyncOperation } from '$pkg/types.js';
import { createTestOperation } from '../../helpers/index.js';

// Store references to created event sources for testing
let lastEventSource: MockEventSource | null = null;

// Mock EventSource for testing
class MockEventSource {
	url: string;
	onopen: ((event: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;
	onerror: ((event: Event) => void) | null = null;
	readyState = 0; // CONNECTING
	private listeners: Map<string, ((event: MessageEvent) => void)[]> = new Map();
	
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSED = 2;

	constructor(url: string) {
		this.url = url;
		lastEventSource = this;
		// Simulate async connection
		setTimeout(() => {
			this.readyState = MockEventSource.OPEN;
			if (this.onopen) {
				this.onopen(new Event('open'));
			}
		}, 10);
	}

	addEventListener(type: string, listener: (event: MessageEvent) => void): void {
		if (!this.listeners.has(type)) {
			this.listeners.set(type, []);
		}
		this.listeners.get(type)!.push(listener);
	}

	removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
		const listeners = this.listeners.get(type);
		if (listeners) {
			const index = listeners.indexOf(listener);
			if (index > -1) {
				listeners.splice(index, 1);
			}
		}
	}

	close(): void {
		this.readyState = MockEventSource.CLOSED;
	}

	// Test helper to simulate incoming messages
	simulateMessage(type: string, data: unknown, lastEventId?: string): void {
		const event = new MessageEvent(type, {
			data: JSON.stringify(data),
			lastEventId
		});
		
		if (type === 'message' && this.onmessage) {
			this.onmessage(event);
		}
		
		const listeners = this.listeners.get(type);
		if (listeners) {
			listeners.forEach(listener => listener(event));
		}
	}

	// Test helper to simulate errors
	simulateError(): void {
		if (this.onerror) {
			this.onerror(new Event('error'));
		}
	}
}

describe('RealtimeClient', () => {
	let client: RealtimeClient;
	let originalEventSource: typeof EventSource | undefined;

	beforeEach(() => {
		// Mock EventSource globally
		originalEventSource = (globalThis as any).EventSource;
		(globalThis as any).EventSource = MockEventSource;
		
		client = new RealtimeClient();
	});

	afterEach(() => {
		client.destroy();
		
		// Restore original EventSource
		if (originalEventSource) {
			(globalThis as any).EventSource = originalEventSource;
		}
	});

	describe('initialization', () => {
		it('should create a client with default config', () => {
			expect(client).toBeDefined();
			expect(client.getStatus()).toBe('disconnected');
		});

		it('should create a client with custom config', () => {
			const customClient = new RealtimeClient({
				enabled: true,
				endpoint: '/custom/realtime',
				reconnectInterval: 2000,
				maxReconnectAttempts: 10
			});

			expect(customClient).toBeDefined();
			expect(customClient.getStatus()).toBe('disconnected');

			customClient.destroy();
		});

		it('should not auto-connect on creation', () => {
			expect(client.isConnected()).toBe(false);
		});
	});

	describe('factory function', () => {
		it('should create a client via factory function', () => {
			const factoryClient = createRealtimeClient({ enabled: true });

			expect(factoryClient).toBeDefined();
			expect(factoryClient).toBeInstanceOf(RealtimeClient);

			factoryClient.destroy();
		});
	});

	describe('configure', () => {
		it('should update configuration at runtime', () => {
			client.configure({ endpoint: '/new/endpoint' });

			expect(client).toBeDefined();
		});

		it('should accept partial config updates', () => {
			client.configure({ reconnectInterval: 5000 });

			expect(client).toBeDefined();
		});
	});

	describe('init', () => {
		it('should initialize with client ID and connect if enabled', async () => {
			client.init('test-client-id');

			// Wait for connection
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(client.getStatus()).toBe('connected');
		});

		it('should not connect if disabled', () => {
			const disabledClient = new RealtimeClient({ enabled: false });

			disabledClient.init('test-client-id');

			expect(disabledClient.isConnected()).toBe(false);

			disabledClient.destroy();
		});
	});

	describe('connection lifecycle', () => {
		it('should transition through connection states', async () => {
			const statusChanges: string[] = [];
			const statusClient = new RealtimeClient({
				onStatusChange: (status) => statusChanges.push(status)
			});

			statusClient.connect();

			// Wait for connection
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(statusChanges).toContain('connecting');
			expect(statusChanges).toContain('connected');

			statusClient.destroy();
		});

		it('should emit connected event on successful connection', async () => {
			const handler = vi.fn();
			client.on('connected', handler);

			client.init('test-client-id');

			// Wait for connection
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(handler).toHaveBeenCalled();
		});

		it('should handle disconnect', async () => {
			client.init('test-client-id');
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(client.isConnected()).toBe(true);

			client.disconnect();

			expect(client.getStatus()).toBe('disconnected');
		});

		it('should emit disconnected event on disconnect', async () => {
			const handler = vi.fn();
			client.on('disconnected', handler);

			client.init('test-client-id');
			await new Promise(resolve => setTimeout(resolve, 50));

			client.disconnect();

			expect(handler).toHaveBeenCalled();
		});
	});

	describe('reconnection', () => {
		it('should force reconnection when requested', async () => {
			client.init('test-client-id');
			await new Promise(resolve => setTimeout(resolve, 50));

			const connectedHandler = vi.fn();
			client.on('connected', connectedHandler);

			client.reconnect();
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(connectedHandler).toHaveBeenCalled();
		});

		it('should reset reconnect attempts on manual reconnect', async () => {
			client.init('test-client-id');
			await new Promise(resolve => setTimeout(resolve, 50));

			client.reconnect();

			expect(client.getStatus()).toBe('connecting');
		});
	});

	describe('enable/disable', () => {
		it('should enable and connect', async () => {
			const disabledClient = new RealtimeClient({ enabled: false });
			disabledClient.init('test-client-id');

			expect(disabledClient.isConnected()).toBe(false);

			disabledClient.enable();
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(disabledClient.isConnected()).toBe(true);

			disabledClient.destroy();
		});

		it('should disable and disconnect', async () => {
			client.init('test-client-id');
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(client.isConnected()).toBe(true);

			client.disable();

			expect(client.isConnected()).toBe(false);
		});
	});

	describe('event handling', () => {
		it('should handle operations events', async () => {
			const operations: SyncOperation[] = [createTestOperation()];
			const handler = vi.fn();

			client.on('operations', handler);
			client.init('test-client-id');

			// Wait for connection
			await new Promise(resolve => setTimeout(resolve, 50));

			// Simulate operations event
			if (lastEventSource) {
				lastEventSource.simulateMessage('operations', {
					operations,
					tables: ['todos']
				});
			}

			// Wait for event to propagate
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(handler).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						id: operations[0].id,
						table: 'todos',
						operation: 'insert'
					})
				])
			);
		});

		it('should call onOperations callback', async () => {
			const onOperations = vi.fn();
			const operationsClient = new RealtimeClient({ onOperations });

			operationsClient.init('test-client-id');
			await new Promise(resolve => setTimeout(resolve, 50));

			const operations: SyncOperation[] = [createTestOperation()];
			if (lastEventSource) {
				lastEventSource.simulateMessage('operations', {
					operations,
					tables: ['todos']
				});
			}

			await new Promise(resolve => setTimeout(resolve, 50));

			expect(onOperations).toHaveBeenCalledWith(
				expect.arrayContaining([
					expect.objectContaining({
						id: operations[0].id,
						table: 'todos',
						operation: 'insert'
					})
				])
			);

			operationsClient.destroy();
		});

		it('should handle heartbeat events', async () => {
			client.init('test-client-id');
			await new Promise(resolve => setTimeout(resolve, 50));

			// Should not throw
			expect(() => {
				if (lastEventSource) {
					lastEventSource.simulateMessage('heartbeat', { timestamp: Date.now() });
				}
			}).not.toThrow();

			// Add assertion to satisfy vitest
			expect(lastEventSource).toBeDefined();
		});

		it('should handle custom events', async () => {
			const handler = vi.fn();
			client.on('custom', handler);

			client.init('test-client-id');
			await new Promise(resolve => setTimeout(resolve, 50));

			if (lastEventSource) {
				lastEventSource.simulateMessage('message', {
					type: 'custom',
					data: { value: 'test' },
					timestamp: Date.now()
				});
			}

			await new Promise(resolve => setTimeout(resolve, 50));

			expect(handler).toHaveBeenCalledWith({ value: 'test' });
		});
	});

	describe('error handling', () => {
		it('should call onError callback on error', async () => {
			const onError = vi.fn();
			const errorClient = new RealtimeClient({ onError });

			errorClient.init('test-client-id');
			await new Promise(resolve => setTimeout(resolve, 50));

			if (lastEventSource) {
				lastEventSource.simulateError();
			}

			await new Promise(resolve => setTimeout(resolve, 50));

			expect(onError).toHaveBeenCalled();

			errorClient.destroy();
		});

		it('should emit error event', async () => {
			const handler = vi.fn();
			client.on('error', handler);

			client.init('test-client-id');
			await new Promise(resolve => setTimeout(resolve, 50));

			if (lastEventSource) {
				lastEventSource.simulateError();
			}

			await new Promise(resolve => setTimeout(resolve, 50));

			expect(handler).toHaveBeenCalled();
		});
	});

	describe('status', () => {
		it('should return current connection status', () => {
			expect(client.getStatus()).toBe('disconnected');
		});

		it('should check if connected', async () => {
			expect(client.isConnected()).toBe(false);

			client.init('test-client-id');
			await new Promise(resolve => setTimeout(resolve, 50));

			expect(client.isConnected()).toBe(true);
		});
	});

	describe('destroy', () => {
		it('should clean up all resources', async () => {
			client.init('test-client-id');
			await new Promise(resolve => setTimeout(resolve, 50));

			client.destroy();

			expect(client.getStatus()).toBe('disconnected');
		});

		it('should remove all event listeners', async () => {
			const handler = vi.fn();
			client.on('connected', handler);

			client.destroy();

			expect(client.listenerCount('connected')).toBe(0);
		});
	});
});
