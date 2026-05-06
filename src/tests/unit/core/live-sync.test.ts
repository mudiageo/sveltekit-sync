/**
 * Tests for the simplified remote functions API:
 *   1. Zero-config mode  — no `remote` config, engine uses default fetch calls
 *   2. live.syncStream   — replaces both `pull` and realtime subscription
 *   3. applyServerOps    — public helper for wiring query.live reactivity
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncEngine } from '$pkg/client/sync.svelte.js';
import type { SyncConfig, SyncOperation, SyncResult } from '$pkg/types.js';
import {
	createMockLocalAdapter,
	createMockRemote,
	createMockLiveRemote,
	createTestOperation,
	MockBroadcastChannel,
	setupBroadcastChannelMock
} from '../../helpers/index.js';

setupBroadcastChannelMock();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEngine(config: SyncConfig) {
	return new SyncEngine(config);
}

// ─── Zero-config ──────────────────────────────────────────────────────────────

describe('SyncEngine — zero-config (no remote)', () => {
	let adapter: ReturnType<typeof createMockLocalAdapter>;
	let engine: SyncEngine;
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		adapter = createMockLocalAdapter();
		adapter.isInitialized.mockResolvedValue(true);

		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		engine = makeEngine({ local: { db: null, adapter }, syncInterval: 0 });
		MockBroadcastChannel.reset();
	});

	afterEach(() => {
		engine.destroy();
		vi.unstubAllGlobals();
	});

	it('constructs without a remote config', () => {
		expect(engine).toBeDefined();
		expect(engine.state.status).toBe('idle');
	});

	it('uses fetch to pull on init', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => []
		});

		await engine.init();

		// Should NOT have called pull — adapter says already initialized
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('uses fetch to pull initial data on first init', async () => {
		adapter.isInitialized.mockResolvedValue(false);

		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => []
		});

		await engine.init();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url] = fetchMock.mock.calls[0];
		expect(url.toString()).toContain('/api/sync/pull');
	});

	it('uses a custom endpoint for pull', async () => {
		engine.destroy();
		adapter = createMockLocalAdapter();
		adapter.isInitialized.mockResolvedValue(false);

		fetchMock.mockResolvedValue({ ok: true, json: async () => [] });

		engine = makeEngine({ local: { db: null, adapter }, endpoint: '/custom/sync', syncInterval: 0 });
		await engine.init();

		const [url] = fetchMock.mock.calls[0];
		expect(url.toString()).toContain('/custom/sync/pull');
	});

	it('uses fetch to push pending operations during sync', async () => {
		// Initialize the engine first
		await engine.init();

		// Add a pending operation before sync
		const op = createTestOperation({ status: 'pending' });
		adapter.getQueue.mockResolvedValue([op]);

		// push response (sync does push → pull)
		const pushResult: SyncResult = { success: true, synced: [op.id], conflicts: [], errors: [] };
		fetchMock.mockResolvedValueOnce({ ok: true, json: async () => pushResult });
		// pull response
		fetchMock.mockResolvedValueOnce({ ok: true, json: async () => [] });

		await engine.sync();

		const pushCall = fetchMock.mock.calls.find((c) => {
			const url = c[0]?.toString?.() ?? '';
			return url.includes('/api/sync/push');
		});
		expect(pushCall).toBeDefined();
		expect(pushCall![1].method).toBe('POST');
	});

	it('throws on a failed fetch pull', async () => {
		adapter.isInitialized.mockResolvedValue(false);
		fetchMock.mockResolvedValue({ ok: false, statusText: 'Not Found' });

		await expect(engine.init()).rejects.toThrow();
	});
});

// ─── live.syncStream ──────────────────────────────────────────────────────────

describe('SyncEngine — remote.live.syncStream', () => {
	let adapter: ReturnType<typeof createMockLocalAdapter>;
	let remote: ReturnType<typeof createMockRemote>;
	let liveRemote: ReturnType<typeof createMockLiveRemote>;
	let engine: SyncEngine;

	beforeEach(() => {
		adapter = createMockLocalAdapter();
		adapter.isInitialized.mockResolvedValue(true);
		remote = createMockRemote();
		liveRemote = createMockLiveRemote();

		engine = makeEngine({
			local: { db: null, adapter },
			remote: {
				push: remote.push,
				live: liveRemote.live
			},
			syncInterval: 0
		});
		MockBroadcastChannel.reset();
	});

	afterEach(() => {
		engine.destroy();
	});

	it('does not call remote.pull when live.syncStream is provided', async () => {
		adapter.isInitialized.mockResolvedValue(false);

		await engine.init();

		expect(liveRemote.live.syncStream).toHaveBeenCalledWith(
			expect.objectContaining({ clientId: expect.any(String), lastSync: 0 })
		);
		expect(remote.pull).not.toHaveBeenCalled();
	});

	it('passes the current lastSync to syncStream on each pull', async () => {
		adapter.isInitialized.mockResolvedValue(false);
		adapter.getLastSync.mockResolvedValue(12345);

		await engine.init();

		const [callArg] = liveRemote.live.syncStream.mock.calls[0];
		expect(callArg.lastSync).toBe(0); // initial pull uses 0
	});

	it('applies server operations returned by syncStream', async () => {
		const serverOp = createTestOperation({
			operation: 'insert',
			clientId: 'other-client',
			status: 'synced'
		});
		liveRemote._addServerData(serverOp);
		adapter.isInitialized.mockResolvedValue(false);

		await engine.init();

		expect(adapter.update).toHaveBeenCalledWith(
			serverOp.table,
			serverOp.data.id,
			expect.objectContaining({ id: serverOp.data.id })
		);
	});

	it('skips operations from own clientId during initial pull', async () => {
		const clientId = await adapter.getClientId();
		const ownOp = createTestOperation({ clientId, operation: 'insert', status: 'synced' });
		liveRemote._addServerData(ownOp);
		adapter.isInitialized.mockResolvedValue(false);

		await engine.init();

		// The operation came from this client, so it should not be re-applied
		expect(adapter.insert).not.toHaveBeenCalled();
	});

	it('still pushes pending operations to remote.push', async () => {
		const op = createTestOperation({ status: 'pending' });
		adapter.getQueue.mockResolvedValue([op]);

		await engine.sync();

		expect(remote.push).toHaveBeenCalledWith([op]);
	});
});

// ─── applyServerOps ───────────────────────────────────────────────────────────

describe('SyncEngine.applyServerOps', () => {
	let adapter: ReturnType<typeof createMockLocalAdapter>;
	let remote: ReturnType<typeof createMockRemote>;
	let engine: SyncEngine;

	beforeEach(async () => {
		adapter = createMockLocalAdapter();
		adapter.isInitialized.mockResolvedValue(true);
		remote = createMockRemote();

		engine = makeEngine({
			local: { db: null, adapter },
			remote: { push: remote.push, pull: remote.pull },
			syncInterval: 0
		});

		await engine.init();
		MockBroadcastChannel.reset();
	});

	afterEach(() => {
		engine.destroy();
	});

	it('does nothing when passed an empty array', async () => {
		await engine.applyServerOps([]);
		expect(adapter.insert).not.toHaveBeenCalled();
		expect(adapter.update).not.toHaveBeenCalled();
	});

	it('applies an insert operation from another client', async () => {
		const op = createTestOperation({ operation: 'insert', clientId: 'server-client', status: 'synced' });

		await engine.applyServerOps([op]);

		expect(adapter.insert).toHaveBeenCalledWith(op.table, op.data);
	});

	it('applies an update operation and merges with existing data', async () => {
		const existing = { id: 'item-1', text: 'old', _version: 1 };
		adapter.findOne.mockResolvedValue(existing);

		const op = createTestOperation({
			operation: 'update',
			data: { id: 'item-1', text: 'new' },
			clientId: 'server-client',
			status: 'synced'
		});

		await engine.applyServerOps([op]);

		expect(adapter.update).toHaveBeenCalledWith(
			op.table,
			'item-1',
			expect.objectContaining({ text: 'new', id: 'item-1' })
		);
	});

	it('applies a delete operation', async () => {
		const op = createTestOperation({
			operation: 'delete',
			data: { id: 'item-1' },
			clientId: 'server-client',
			status: 'synced'
		});

		await engine.applyServerOps([op]);

		expect(adapter.delete).toHaveBeenCalledWith(op.table, 'item-1');
	});

	it('skips operations from own clientId', async () => {
		const clientId = engine.state.clientId ?? await adapter.getClientId();
		const op = createTestOperation({ operation: 'insert', clientId, status: 'synced' });

		await engine.applyServerOps([op]);

		expect(adapter.insert).not.toHaveBeenCalled();
	});
});
