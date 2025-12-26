import { SyncEngine } from '$pkg/client/sync.svelte';
import { IndexedDBAdapter } from '$pkg/adapters/indexeddb';
import { pushChanges, pullChanges } from '$lib/sync.remote';
import { browser } from '$app/environment';

const adapter = new IndexedDBAdapter('myapp-db', 1);

export const syncEngine = new SyncEngine({
  local: {
    db: null,
    adapter
  },
  remote: {
    push: data => pushChanges(data),
    pull: (lastSync: number, clientId: string) => pullChanges({ lastSync, clientId })
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

    // SyncEngine.init() now handles initial data pull automatically
    await syncEngine.init();

    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
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
