import { SyncEngine } from '$lib/sync.svelte';
import { IndexedDBAdapter } from '$lib/adapters/indexeddb';
import { IDBAdapter } from '$lib/adapters/idb';
import { pushChanges, pullChanges, getInitialData, subscribeToSync } from '$lib/sync.remote';
import { browser } from '$app/environment';

const adapter = new IndexedDBAdapter('myapp-db', 1);

export const syncEngine = new SyncEngine({
  local: {
    db: null,
    adapter
  },
  remote: {
    push:data => pushChanges(data),
    pull: data => pullChanges(data)
  },
  syncInterval: 30000,
  conflictResolution: 'last-write-wins',
  onSync: (status) => {
    console.log('Sync status:', status);
  }
});

// Initialize with optimized first load
export async function initDB() {
  // Only run in browser
  if (!browser) {
    console.warn('initDB called on server - skipping');
    return;
  }

  try {
    await adapter.init({ 
      todos: 'id',
      notes: 'id',
      tasks: 'id'
      
    });

    await syncEngine.init();
    
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
  
  // Fast initial load - get all data at once
  const clientId = await adapter.getClientId();
  const initialData = await getInitialData({ tables: ['todos', 'notes'] });
  
  // Populate local DB
  for (const [table, records] of Object.entries(initialData)) {
    for (const record of records) {
      await adapter.insert(table, record);
    }
  }
  
  // Set up real-time sync
  if (browser) {
    setupRealtimeSync(clientId);
  }
}

// Real-time updates via SSE or WebSocket
async function setupRealtimeSync(clientId: string) {
  try {
    const tables = ['todos', 'notes'];

// Create query parameters string
const queryParams = new URLSearchParams({
    clientId: clientId,
});

// A better way to handle array of tables for clarity
const url = `/api/subscribeToSync?clientId=${encodeURIComponent(clientId)}&` + 
            tables.map(t => `tables=${encodeURIComponent(t)}`).join('&');

const response = await fetch(url, {
    method: 'GET', 
    headers: {
    'Content-Type': 'application/json' 
}
});

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    
    const decoder = new TextDecoder();
 
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const text = decoder.decode(value);
      const operations = JSON.parse(text);
      
      // Apply remote changes instantly
      for (const op of operations) {
        switch (op.operation) {
          case 'insert':
          case 'update':
            await adapter.update(op.table, op.data.id, op.data);
            break;
          case 'delete':
            await adapter.delete(op.table, op.data.id);
            break;
        }
      }
      
      // Trigger collection stores to reload
      await todosStore.reload();
      await notesStore.reload();
    }

      
    
    
       
    
  } catch (error) {
    console.error('Realtime sync error:', error);
    // Fall back to polling
  }
}

// Create stores
export const todosStore = syncEngine.collection<{
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
}>('todos');

export const notesStore = syncEngine.collection<{
  id: string;
  title: string;
  content: string;
  tags: string[];
}>('notes');
