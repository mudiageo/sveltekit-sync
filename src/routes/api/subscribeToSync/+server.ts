import type { RequestHandler } from './$types';
import { ServerSyncEngine } from '$pkg/server/sync-engine';
import { syncSchema } from '$lib/server/sync-schema';
function getUser(req) {
  return { id: 'uswr1'}
}
const syncEngine = new ServerSyncEngine(syncSchema);

export const GET: RequestHandler = async ( {url}) => {
  // Get simple parameter
    const clientId = url.searchParams.get('clientId'); 
const user = await getUser(url);
    // Get array of parameters (if client sends ?tables=todos&tables=notes)
    const tables = url.searchParams.getAll('tables'); 

    if (!clientId || tables.length === 0) {
        return new Response('Missing parameters', { status: 400 });
    }
    
  const readableStream = new ReadableStream({
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
    
  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/event-stream', // For Server-Sent Events
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
};