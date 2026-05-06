import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { syncEngine } from '$lib/server/sync'
// import { getUser } from '$lib/server/auth'; // Your auth function
function getUser(req: Request) {
  return { id: 'user1' }
}

// Validation schema for sync operations
const SyncOperationSchema = v.object({
  id: v.string(),
  table: v.string(),
  operation: v.picklist(['insert', 'update', 'delete']),
  data: v.any(),
  timestamp: v.number(),
  clientId: v.string(),
  version: v.number(),
  status: v.picklist(['pending', 'synced', 'error'])
});

const SyncOperationsArraySchema = v.array(SyncOperationSchema);

// ─── SINGLE LIVE QUERY ───────────────────────────────────────────────────────
//
// `syncStream` replaces BOTH `pullChanges` (periodic pull) and
// `subscribeToSync` (realtime subscription) from the old three-function setup.
//
// • On the client, pass it to `remote.live.syncStream` in `SyncEngine`.
//   The engine will call it for the initial data fetch and every subsequent
//   periodic pull.
//
// • Because this is a `query.live`, calling `syncStream.refresh()` inside
//   `pushChanges` automatically notifies all connected clients to re-fetch —
//   no separate SSE stream management required.
//
export const syncStream = query(
  v.object({
    clientId: v.string(),
    lastSync: v.number()
  }),
  async ({ lastSync, clientId }) => {
    const { request } = getRequestEvent()
    const user = getUser(request);
    if (!user) {
      throw new Error('Unauthorized');
    }

    return syncEngine.pull(lastSync, clientId, user.id);
  }
);

// ─── PUSH COMMAND ────────────────────────────────────────────────────────────
//
// Push client operations to the server and refresh `syncStream` so that all
// connected clients receive the latest changes automatically.
//
export const pushChanges = command(
  SyncOperationsArraySchema,
  async (operations) => {
    const { request } = getRequestEvent()
    const user = getUser(request);
    if (!user) {
      throw new Error('Unauthorized');
    }

    const result = await syncEngine.push(operations, user.id);

    // Invalidate the live query → all subscribers receive fresh operations
    await syncStream.refresh();

    return result;
  }
);
