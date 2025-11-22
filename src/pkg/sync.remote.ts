import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { ServerSyncEngine } from '$lib/server/sync-engine';
import { syncSchema } from './server/sync-schema';
// import { getUser } from '$lib/server/auth'; // Your auth function
function getUser(req) {
  return { id: 'uswr1' }
}
const syncEngine = new ServerSyncEngine(syncSchema);

// Validation schemas
const SyncOperationSchema = v.object({
  id: v.string(),
  table: v.string(),
  operation: v.picklist(['insert', 'update', 'delete']),
  data: v.any(),
  timestamp: v.date(),
  clientId: v.string(),
  version: v.number(),
  status: v.picklist(['pending', 'synced', 'error'])
});

const SyncOperationsArraySchema = v.array(SyncOperationSchema);


// PUSH CHANGES TO SERVER
export const pushChanges = command(
  SyncOperationsArraySchema,
  async (operations) => {
    const { request } = getRequestEvent()
    // Get authenticated user
    const user = await getUser(request);
    if (!user) {
      throw new Error('Unauthorized');
    }

    // Process the sync operations
    const result = await syncEngine.push(operations, user.id);
    await pullChanges({ lastSync: 0, clientId: operations[0].clientId }).refresh()
    return result;
  }
);

// PULL CHANGES FROM SERVER
export const pullChanges = query(
  v.object({
    lastSync: v.number(),
    clientId: v.string()
  }),
  async ({ lastSync, clientId }) => {
    const { request } = getRequestEvent()
    const user = await getUser(request);
    if (!user) {
      throw new Error('Unauthorized');
    }

    const operations = await syncEngine.pull(lastSync, clientId, user.id);
    return operations;
  }
);

// GET INITIAL DATA (First load optimization)
export const getInitialData = query(
  v.object({
    tables: v.array(v.string())
  }),
  async ({ tables }) => {
    const { request } = getRequestEvent()
    const user = await getUser(request);
    if (!user) {
      throw new Error('Unauthorized');
    }

    // Get all data for specified tables efficiently
    const data: Record<string, any[]> = {};

    for (const tableName of tables) {
      const operations = await syncEngine.pull(0, 'initial', user.id);
      data[tableName] = operations
        .filter(op => op.table === tableName)
        .map(op => op.data);
    }

    return data;
  }
);

// REALTIME SUBSCRIPTION (WebSocket/SSE)
export const subscribeToSync = query(
  v.object({
    tables: v.array(v.string()),
    clientId: v.string()
  }),
  async ({ tables, clientId }) => {
    const { request } = getRequestEvent()
    const user = await getUser(request);
    if (!user) {
      throw new Error('Unauthorized');
    }

    // Return a server-sent events stream or WebSocket connection
    // This is handled by SvelteKit's streaming capabilities
    return new ReadableStream({
      async start(controller) {
        const unsubscribe = await syncEngine.subscribeToChanges(
          tables,
          user.id,
          (operations) => {
            // Filter out operations from this client
            const filtered = operations.filter(op => op.clientId !== clientId);
            if (filtered.length > 0) {
              controller.enqueue(
                new TextEncoder().encode(JSON.stringify(filtered) + '\n')
              );
            }
          }
        );

        // Cleanup on disconnect
        request.signal.addEventListener('abort', () => {
          unsubscribe();
          controller.close();
        });
      }
    });
  }
);
