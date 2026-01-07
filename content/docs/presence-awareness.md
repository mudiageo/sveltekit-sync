# Presence & Awareness System

Real-time presence and awareness features for collaborative applications.

## Overview

The presence/awareness system enables you to track and display:
- **Who's online** - See which users are currently active
- **User activity** - Track what users are doing (editing, viewing, etc.)
- **Cursor positions** - See where other users are pointing
- **Selections** - See what text/content other users have selected
- **Custom state** - Track any application-specific presence data

## Architecture

The system uses:
- **Bidirectional communication**: SSE for server→client, POST for client→server
- **EphemeralStore**: In-memory TTL-based storage (data expires, not persisted to DB)
- **Channel-based**: Presence is scoped to channels for isolation
- **Multi-client aware**: Same user can have multiple active clients (desktop, mobile, etc.)

## Quick Start

### 1. Server Setup

```typescript
// src/lib/server/sync.ts
import { createServerSync } from 'sveltekit-sync/server';
import { DrizzleAdapter } from 'sveltekit-sync/adapters/drizzle';
import { db } from './db';
import * as schema from './db/schema';

const adapter = new DrizzleAdapter({ db, schema });

export const { sync, GET, POST, handle } = createServerSync({
  adapter,
  config: {
    tables: {
      todos: { table: 'todos', conflictResolution: 'last-write-wins' }
    },
    realtime: {
      enabled: true,
      path: '/api/sync/realtime',
      presenceTtl: 60000, // 60 seconds
      authenticate: async (request) => {
        // Your auth logic
        const session = await getSession(request);
        return {
          userId: session.userId,
          clientId: request.headers.get('x-client-id') || crypto.randomUUID()
        };
      }
    }
  }
});
```

### 2. API Route Setup

You have **two options** for setting up the realtime endpoints:

#### Option A: Using the `handle` hook (Recommended)

```typescript
// src/hooks.server.ts
import { handle as syncHandle } from '$lib/server/sync';

export const handle = syncHandle;
```

This automatically handles both GET (SSE) and POST (client messages) at the configured path. **No need to create separate API routes.**

#### Option B: Using explicit API routes

If you prefer explicit routes or need custom middleware:

```typescript
// src/routes/api/sync/realtime/+server.ts
export { GET, POST } from '$lib/server/sync';
```

Choose **either** Option A (handle) **or** Option B (explicit routes), not both.

### 3. Client Setup

```typescript
// src/lib/db.ts
import { SyncEngine } from 'sveltekit-sync';
import { IndexedDBAdapter } from 'sveltekit-sync/adapters';

export const syncEngine = new SyncEngine({
  local: {
    adapter: new IndexedDBAdapter('my-app-db', 1),
    db: null
  },
  remote: {
    push: async (ops) => {
      const res = await fetch('/api/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operations: ops })
      });
      return res.json();
    },
    pull: async (lastSync, clientId) => {
      const res = await fetch(`/api/sync/pull?lastSync=${lastSync}&clientId=${clientId}`);
      return res.json();
    }
  },
  realtime: {
    enabled: true,
    endpoint: '/api/sync/realtime'
  }
});

// Create collection stores
export const todosStore = syncEngine.collection('todos');
export const notesStore = syncEngine.collection('notes');
```

## Basic Usage - Collection Presence (Primary API)

The **primary and recommended** way to use presence is directly from your collection store. This automatically scopes presence to the collection's table and provides the simplest API.

### Simple Example

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { todosStore } from '$lib/db';
  
  const currentUser = {
    id: 'user123',
    name: 'John Doe',
    avatar: '/avatars/john.jpg'
  };

  // Create presence from collection - automatically scoped to 'todos' table
  const presence = todosStore.presence({
    user: currentUser,
    custom: { viewing: 'list' }
  });

  // Access collaborators reactively
  const others = $derived(presence.others);
  const onlineCount = $derived(presence.onlineCount);

  onMount(() => {
    todosStore.load();
    
    return () => {
      presence.destroy();
    };
  });
</script>

<div>
  <h2>Online: {onlineCount}</h2>
  {#each others as collaborator (collaborator.user.id)}
    <div class="avatar">
      <img src={collaborator.user.avatar} alt={collaborator.user.name} />
      <span>{collaborator.user.name}</span>
    </div>
  {/each}
</div>
```

### Tracking User Activity

```svelte
<script lang="ts">
  import { notesStore } from '$lib/db';
  
  const presence = notesStore.presence({
    user: currentUser,
    custom: { editing: null }
  });

  function startEditing(noteId: string) {
    presence.updatePresence({ 
      custom: { editing: noteId } 
    });
  }

  function stopEditing() {
    presence.updatePresence({ 
      custom: { editing: null } 
    });
  }

  // See who's editing what
  const editingUsers = $derived(
    presence.others.filter(u => u.custom?.editing)
  );
</script>

<div>
  {#each notes as note}
    {@const editor = editingUsers.find(u => u.custom.editing === note.id)}
    
    <div class="note">
      {#if editor}
        <span class="editing-badge">
          {editor.user.name} is editing
        </span>
      {/if}
      
      <input
        value={note.title}
        onfocus={() => startEditing(note.id)}
        onblur={stopEditing}
      />
    </div>
  {/each}
</div>
```

## Using Channels (Alternative API)

Channels provide an alternative API when you need custom channel names (not tied to tables) or want to combine presence with custom event broadcasting in a single interface.

**Use channels when:**
- You need a custom channel name (e.g., `document:123` instead of table name)
- You want to broadcast custom events alongside presence
- You need fine-grained control over channel lifecycle

**Use collection.presence() when:**
- You want presence scoped to a collection/table (most common case)
- You prefer a simpler API without explicit subscribe/unsubscribe
- You don't need custom event broadcasting

### Basic Channel Usage

```svelte
<script lang="ts">
  import { syncEngine } from '$lib/db';
  import { onMount } from 'svelte';

  const currentUser = {
    id: 'user123',
    name: 'John Doe',
    avatar: '/avatars/john.jpg'
  };

  // Create a channel for this document
  const channel = syncEngine.channel('document:abc123', {
    presence: true,
    broadcast: true
  }, currentUser);

  onMount(async () => {
    // Subscribe to the channel
    await channel.subscribe();

    // Track your presence
    channel.track({ editing: 'section-1' });

    // Cleanup on unmount
    return () => {
      channel.unsubscribe();
    };
  });

  // Access presence data
  const presence = $derived(channel.presence);
  const others = $derived(presence?.others || []);
</script>

<div>
  <h2>Collaborators ({others.length})</h2>
  {#each others as user (user.user.id)}
    <div class="avatar">
      <img src={user.user.avatar} alt={user.user.name} />
      <span class="status {user.status}">{user.status}</span>
    </div>
  {/each}
</div>
```

### Custom Events

Broadcast custom events to all channel subscribers:

```typescript
// Send a comment
await channel.broadcast('comment:add', {
  text: 'Great work!',
  position: { x: 100, y: 200 }
});

// Listen for comments
channel.on('comment:add', (comment) => {
  console.log('New comment:', comment);
  showCommentNotification(comment);
});
```

## Presence Store API

The `PresenceStore` provides methods to track and query presence:

```typescript
const presence = channel.presence;

// Update cursor position
presence.updateCursor({ x: 150, y: 250 });

// Update selection
presence.updateSelection({
  start: { x: 100, y: 200 },
  end: { x: 300, y: 200 }
});

// Update editing state
presence.updateEditing({
  resourceId: 'doc:123',
  field: 'title',
  action: 'typing',
  timestamp: Date.now()
});

// Update custom state
presence.updatePresence({ custom: { mood: '😊' } });

// Set status
presence.setStatus('away');

// Query presence
const onlineUsers = presence.getOnlineUsers();
const editingUsers = presence.getUsersEditing('doc:123');
const specificUser = presence.getUser('user456');

// Follow a user (receive their updates)
const unfollow = presence.follow('user456');
// Later: unfollow();
```

## Presence Events

Listen for presence events:

```typescript
// User joined
const unsubJoin = presence.on('join', (state) => {
  console.log(`${state.user.name} joined`);
});

// User updated
const unsubUpdate = presence.on('update', (state) => {
  console.log(`${state.user.name} updated:`, state.custom);
});

// User left
const unsubLeave = presence.on('leave', (state) => {
  console.log(`${state.user.name} left`);
});

// Cleanup
unsubJoin();
unsubUpdate();
unsubLeave();
```

## Automatic Features

### Idle Detection

Users are automatically marked as idle after 5 minutes of inactivity:

```typescript
// User is marked idle automatically
// You can also manually set status
presence.setStatus('away');
presence.setActive(); // Returns to 'online'
```

### Cursor Debouncing

Cursor updates are debounced (50ms) to prevent flooding the server:

```typescript
// These rapid updates are automatically debounced
presence.updateCursor({ x: 100, y: 100 });
presence.updateCursor({ x: 101, y: 100 });
presence.updateCursor({ x: 102, y: 100 });
// Only the last one is sent after 50ms
```

### Heartbeat

Presence is automatically refreshed every 30 seconds to keep it alive.

### TTL & Expiration

Presence data expires after 60 seconds (configurable) if not updated. When presence expires:
- `presence:leave` event is broadcast to other users
- Data is removed from EphemeralStore

## Multi-Client Support

The same user can have multiple active clients (e.g., desktop and mobile):

```typescript
// Each client tracks presence separately
// user123-desktop
channel.track({ device: 'desktop', editing: 'section-1' });

// user123-mobile  
channel.track({ device: 'mobile', viewing: 'section-2' });

// Other users see both presences
const user123Presences = others.filter(p => p.user.id === 'user123');
console.log(user123Presences); // [{ device: 'desktop' }, { device: 'mobile' }]
```

## Best Practices

1. **Scope channels appropriately**: Use granular channels (e.g., `document:123`) rather than broad channels (e.g., `all-docs`)

2. **Clean up subscriptions**: Always unsubscribe when leaving a page/component

3. **Handle offline gracefully**: Check `syncEngine.realtimeStatus` before relying on presence

4. **Optimize cursor tracking**: Use the built-in debouncing, don't send every mousemove

5. **Use custom state wisely**: Keep custom state small and relevant

6. **Test multi-user scenarios**: Always test with multiple users and clients

## Advanced: Direct PresenceStore

You can use `PresenceStore` directly without channels:

```typescript
import { PresenceStore } from 'sveltekit-sync';

const presence = new PresenceStore(
  syncEngine.realtime,
  'todos', // table name
  currentUser,
  { favoriteColor: 'blue' } // custom state
);

// Use presence methods...
presence.updateCursor({ x: 100, y: 100 });

// Cleanup
presence.destroy();
```

## Troubleshooting

### Presence not updating

1. Check that realtime is enabled in config
2. Verify SSE connection is established
3. Check browser console for errors
4. Ensure authentication returns valid userId/clientId

### Users not seeing each other

1. Verify they're in the same channel
2. Check channel subscriptions with `channel.isSubscribed()`
3. Ensure presence tracking is enabled: `{ presence: true }`

### High server load

1. Reduce `presenceTtl` if users are inactive
2. Increase cursor debounce time
3. Use more granular channels to reduce broadcast scope
4. Consider disabling presence in large public channels

## Type Definitions

```typescript
interface User {
  id: string;
  name: string;
  email?: string;
  avatar?: string;
  color?: string;
}

interface CursorPosition {
  x: number;
  y: number;
  line?: number;
  column?: number;
}

interface Selection {
  start: CursorPosition;
  end: CursorPosition;
  text?: string;
}

interface EditingState {
  resourceId: string;
  field?: string;
  action?: 'typing' | 'selecting' | 'idle';
  timestamp: number;
}

interface PresenceState<T = any> {
  user: User;
  status: 'online' | 'idle' | 'away' | 'offline';
  lastSeen: number;
  cursor?: CursorPosition;
  selection?: Selection;
  editing?: EditingState;
  custom?: T;
}
```

## See Also

- [Realtime Sync Guide](./realtime-sync.md)
- [Channel API Reference](./channel-api.md)
- [EphemeralStore Internals](./ephemeral-store.md)
