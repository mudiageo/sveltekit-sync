/**
 * Tests for the ServerSyncEngine HTTP push/pull handlers.
 * Verifies that the `handle` hook correctly routes POST /push and GET /pull
 * requests in zero-config and authenticated modes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServerSyncEngine } from '$pkg/server/sync-engine.js';
import type { ServerAdapter, SyncOperation } from '$pkg/types.js';
import type { SyncConfig } from '$pkg/server/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function createConfig(overrides: Partial<SyncConfig> = {}): SyncConfig {
	return {
		tables: {
			todos: { table: 'todos', conflictResolution: 'last-write-wins' }
		},
		...overrides
	};
}

function createOperation(overrides: Partial<SyncOperation> = {}): SyncOperation {
	return {
		id: 'op-1',
		table: 'todos',
		operation: 'insert',
		data: { id: 'item-1', text: 'Test' },
		timestamp: Date.now(),
		clientId: 'client-1',
		version: 1,
		status: 'pending',
		...overrides
	};
}

/** Build a minimal SvelteKit-like RequestEvent for testing */
function buildEvent(options: {
	method: string;
	pathname: string;
	searchParams?: Record<string, string>;
	body?: unknown;
}): any {
	const url = new URL(`http://localhost${options.pathname}`);
	for (const [k, v] of Object.entries(options.searchParams ?? {})) {
		url.searchParams.set(k, v);
	}

	const request = new Request(url.toString(), {
		method: options.method,
		headers: { 'Content-Type': 'application/json' },
		body: options.body != null ? JSON.stringify(options.body) : undefined
	});

	return {
		request,
		url,
		resolve: async (ev: any) => new Response('passthrough')
	};
}

function buildHandleArg(event: any) {
	return { event, resolve: event.resolve };
}

// ─── Push handler ─────────────────────────────────────────────────────────────

describe('ServerSyncEngine — POST /api/sync/push', () => {
	let adapter: ServerAdapter;
	let engine: ServerSyncEngine;
	let handle: (arg: { event: any; resolve: any }) => Promise<Response>;

	beforeEach(() => {
		adapter = createMockAdapter();
		engine = new ServerSyncEngine(adapter, createConfig());
		({ handle } = engine.createRealtimeHandlers());
	});

	it('returns 200 and a SyncResult for a valid push', async () => {
		const ops = [createOperation()];
		const event = buildEvent({ method: 'POST', pathname: '/api/sync/push', body: ops });

		const response = await handle(buildHandleArg(event));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toHaveProperty('success', true);
		expect(body).toHaveProperty('synced');
	});

	it('passes through non-sync paths', async () => {
		const event = buildEvent({ method: 'POST', pathname: '/api/other' });

		const response = await handle(buildHandleArg(event));

		expect(await response.text()).toBe('passthrough');
	});

	it('returns 401 when authenticate returns null', async () => {
		const secureEngine = new ServerSyncEngine(
			adapter,
			createConfig({ authenticate: async () => null })
		);
		const { handle: secureHandle } = secureEngine.createRealtimeHandlers();

		const ops = [createOperation()];
		const event = buildEvent({ method: 'POST', pathname: '/api/sync/push', body: ops });

		const response = await secureHandle(buildHandleArg(event));

		expect(response.status).toBe(401);
	});

	it('uses the authenticated userId for the push', async () => {
		const pushSpy = vi.spyOn(engine, 'push').mockResolvedValue({
			success: true,
			synced: [],
			conflicts: [],
			errors: []
		});

		const secureEngine = new ServerSyncEngine(
			adapter,
			createConfig({ authenticate: async () => ({ userId: 'user-42' }) })
		);
		const spySecure = vi.spyOn(secureEngine, 'push').mockResolvedValue({
			success: true,
			synced: [],
			conflicts: [],
			errors: []
		});
		const { handle: secureHandle } = secureEngine.createRealtimeHandlers();

		const ops = [createOperation()];
		const event = buildEvent({ method: 'POST', pathname: '/api/sync/push', body: ops });

		await secureHandle(buildHandleArg(event));

		expect(spySecure).toHaveBeenCalledWith(ops, 'user-42');
		pushSpy.mockRestore();
	});

	it('uses a custom endpoint path', async () => {
		const customEngine = new ServerSyncEngine(
			adapter,
			createConfig({ endpoint: '/sync' })
		);
		const { handle: customHandle } = customEngine.createRealtimeHandlers();

		const ops = [createOperation()];
		const event = buildEvent({ method: 'POST', pathname: '/sync/push', body: ops });

		const response = await customHandle(buildHandleArg(event));

		expect(response.status).toBe(200);
	});

	it('returns 500 when push throws', async () => {
		vi.spyOn(engine, 'push').mockRejectedValue(new Error('DB failure'));
		const { handle: errHandle } = engine.createRealtimeHandlers();

		const ops = [createOperation()];
		const event = buildEvent({ method: 'POST', pathname: '/api/sync/push', body: ops });

		const response = await errHandle(buildHandleArg(event));

		expect(response.status).toBe(500);
	});
});

// ─── Pull handler ─────────────────────────────────────────────────────────────

describe('ServerSyncEngine — GET /api/sync/pull', () => {
	let adapter: ServerAdapter;
	let engine: ServerSyncEngine;
	let handle: (arg: { event: any; resolve: any }) => Promise<Response>;

	beforeEach(() => {
		adapter = createMockAdapter();
		engine = new ServerSyncEngine(adapter, createConfig());
		({ handle } = engine.createRealtimeHandlers());
	});

	it('returns 200 and an array of operations', async () => {
		const event = buildEvent({
			method: 'GET',
			pathname: '/api/sync/pull',
			searchParams: { lastSync: '0', clientId: 'client-1' }
		});

		const response = await handle(buildHandleArg(event));

		expect(response.status).toBe(200);
		const body = await response.json();
		expect(Array.isArray(body)).toBe(true);
	});

	it('passes lastSync and clientId to engine.pull', async () => {
		const pullSpy = vi.spyOn(engine, 'pull').mockResolvedValue([]);

		const event = buildEvent({
			method: 'GET',
			pathname: '/api/sync/pull',
			searchParams: { lastSync: '9999', clientId: 'my-client' }
		});

		await handle(buildHandleArg(event));

		expect(pullSpy).toHaveBeenCalledWith(9999, 'my-client', '');
	});

	it('returns 401 when authenticate returns null', async () => {
		const secureEngine = new ServerSyncEngine(
			adapter,
			createConfig({ authenticate: async () => null })
		);
		const { handle: secureHandle } = secureEngine.createRealtimeHandlers();

		const event = buildEvent({
			method: 'GET',
			pathname: '/api/sync/pull',
			searchParams: { lastSync: '0', clientId: 'x' }
		});

		const response = await secureHandle(buildHandleArg(event));

		expect(response.status).toBe(401);
	});

	it('returns 500 when pull throws', async () => {
		vi.spyOn(engine, 'pull').mockRejectedValue(new Error('DB error'));

		const event = buildEvent({
			method: 'GET',
			pathname: '/api/sync/pull',
			searchParams: { lastSync: '0', clientId: 'x' }
		});

		const response = await handle(buildHandleArg(event));

		expect(response.status).toBe(500);
	});

	it('uses a custom endpoint path', async () => {
		const customEngine = new ServerSyncEngine(
			adapter,
			createConfig({ endpoint: '/sync' })
		);
		const { handle: customHandle } = customEngine.createRealtimeHandlers();

		const event = buildEvent({
			method: 'GET',
			pathname: '/sync/pull',
			searchParams: { lastSync: '0', clientId: 'c' }
		});

		const response = await customHandle(buildHandleArg(event));

		expect(response.status).toBe(200);
	});
});
