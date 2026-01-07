# Presence & Awareness System

This document describes the presence and awareness features of sveltekit-sync, enabling real-time collaboration features like cursor tracking, "who's online", and custom presence state.

## Architecture

The presence system is built on three main components:

1. **EphemeralStore** (server): In-memory storage for presence data with automatic TTL-based expiration
2. **Bidirectional Communication**: POST endpoint for client→server messages + SSE for server→client
3. **Channel API**: Groups related real-time features (presence, custom events) in isolated channels

## Quick Start

### 1. Basic Presence Tracking

```svelte
<script lang="ts">
  import { syncEngine } from '$lib/db';
  import { usePresence } from 'sveltekit-sync';

  const currentUser = { id: 'user-123', name: 'Alice', avatar: '/alice.jpg' };
  
  // Create a channel for this document
  const channel = syncEngine.channel('document:abc', { presence: true });
  
  // Initialize presence tracking
  const presence = usePresence(channel, {
    user: currentUser,
    trackCursor: true,  // Auto-track mouse cursor
    idleTimeout: 300000 // 5 minutes
  });

  // Get reactive state
  const collaborators = $derived(presence.others);
  const onlineCount = $derived(presence.onlineCount);
</script>

<div class="presence-bar">
  <span>{onlineCount} online</span>
  
  {#each collaborators as person (person.clientId)}
    <img src={person.user?.avatar} alt={person.user?.name} />
  {/each}
</div>
```

### 2. Cursor Tracking

```svelte
<script lang="ts">
  import { useCursorTracking } from 'sveltekit-sync';
  
  let containerRef: HTMLElement;
  const { cursors, startTracking, stopTracking } = useCursorTracking(presence, {
    container: containerRef,
    throttle: 50 // Update every 50ms
  });
  
  $effect(() => {
    startTracking();
    return () => stopTracking();
  });
</script>

<div bind:this={containerRef} class="canvas">
  {#each [...cursors.values()] as { user, position }}
    <div 
      class="cursor" 
      style="left: {position.x}px; top: {position.y}px;"
    >
      <span>{user.name}</span>
    </div>
  {/each}
  
  <!-- Your content -->
</div>
```

### 3. "Who's Here" Widget

```svelte
<script lang="ts">
  import { useWhoIsHere } from 'sveltekit-sync';
  
  const whoIsHere = useWhoIsHere(presence);
</script>

<div class="avatars">
  {#if whoIsHere.isAlone}
    <p>You're alone</p>
  {:else}
    {#each whoIsHere.users as { user, color, status }}
      <div 
        class="avatar"
        class:idle={status === 'idle'}
        style="border-color: {color};"
      >
        <img src={user.avatar} alt={user.name} />
      </div>
    {/each}
    <span class="count">+{whoIsHere.count}</span>
  {/if}
</div>
```

### 4. Custom Presence State

Track custom application state (e.g., current tool, editing field):

```svelte
<script lang="ts">
  import { usePresence } from 'sveltekit-sync';
  
  interface MyPresence {
    tool: 'select' | 'pen' | 'eraser';
    color: string;
  }
  
  const presence = usePresence<MyPresence>(channel, {
    user: currentUser,
    initialState: { tool: 'select', color: '#000000' }
  });
  
  function changeTool(tool: MyPresence['tool']) {
    presence.updateCustom({ tool });
  }
  
  // See what tools others are using
  const othersTools = $derived(
    presence.others.map(p => ({ user: p.user, tool: p.custom?.tool }))
  );
</script>
```

### 5. Editing Indicators

Show who's editing what:

```svelte
<script lang="ts">
  function startEditing(fieldId: string) {
    presence.updateEditing({
      resourceId: fieldId,
      resourceType: 'field',
      startedAt: Date.now()
    });
  }
  
  function stopEditing() {
    presence.updateEditing(null);
  }
  
  // Find who's editing a specific field
  function getEditorsForField(fieldId: string) {
    return presence.getUsersEditing(fieldId);
  }
</script>

<input 
  onfocus={() => startEditing('title')}
  onblur={() => stopEditing()}
  placeholder="Title"
/>

{#each getEditorsForField('title') as editor}
  <span class="editor-badge">{editor.user?.name} is editing</span>
{/each}
```

### 6. Custom Channel Events

Beyond presence, channels support custom event broadcasting:

```svelte
<script lang="ts">
  const channel = syncEngine.channel('document:abc', { 
    presence: true, 
    broadcast: true 
  });
  
  // Send custom events
  function addComment(text: string, position: { x: number, y: number }) {
    channel.broadcast('comment:add', { text, position, author: currentUser });
  }
  
  // Listen for custom events
  channel.on('comment:add', (comment) => {
    console.log('New comment:', comment);
    // Show comment in UI
  });
</script>
```

## Server Setup

### 1. Configure Realtime Server

```typescript
// src/lib/server/sync.ts
import { createServerSync } from 'sveltekit-sync/server';
import { DrizzleAdapter } from 'sveltekit-sync/adapters/drizzle';
import { db } from '$lib/server/db';
import * as schema from '$lib/server/db/schema';

const adapter = new DrizzleAdapter({ db, schema });

export const { sync, GET, POST, handle } = createServerSync({
  adapter,
  config: {
    tables: {
      todos: { table: 'todos' }
    },
    realtime: {
      enabled: true,
      path: '/api/sync/realtime',
      presenceTtl: 60000,      // 60 seconds
      ephemeralTtl: 60000,
      authenticate: async (request) => {
        // Your auth logic
        const user = await getUser(request);
        return user ? {
          userId: user.id,
          clientId: request.headers.get('x-client-id') || crypto.randomUUID()
        } : null;
      }
    }
  }
});
```

### 2. API Route

```typescript
// src/routes/api/sync/realtime/+server.ts
export { GET, POST } from '$lib/server/sync';
```

### 3. Hooks (Optional)

For global realtime handling:

```typescript
// src/hooks.server.ts
import { handle as realtimeHandle } from '$lib/server/sync';

export const handle = realtimeHandle;
```

## API Reference

### `usePresence(channel, options)`

Main hook for presence tracking.

**Options:**
- `user` - User information (required)
- `initialState` - Custom initial state
- `idleTimeout` - Time before marking user as idle (default: 5min)
- `heartbeatInterval` - How often to send heartbeat (default: 30s)
- `trackCursor` - Auto-track mouse cursor
- `trackSelection` - Auto-track text selection

**Returns:**
- `others` - Array of other users' presence states (reactive)
- `myPresence` - Current user's presence state (reactive)
- `othersCount` - Number of other online users
- `onlineCount` - Total online users including self
- `updateCursor(position)` - Update cursor position
- `updateSelection(selection)` - Update text selection
- `updateEditing(editing)` - Set editing state
- `updateCustom(custom)` - Update custom state
- `setStatus(status)` - Set online/idle/away
- `getUser(userId)` - Get specific user's presence
- `getUsersEditing(resourceId)` - Get users editing a resource
- `destroy()` - Cleanup

### `useCursorTracking(presence, options)`

Track and display cursor positions.

**Options:**
- `throttle` - Throttle updates in ms (default: 50)
- `container` - Container element for cursor tracking

**Returns:**
- `cursors` - Map of user cursors
- `startTracking()` - Start tracking
- `stopTracking()` - Stop tracking

### `useSelectionTracking(presence, options)`

Track and display text selections.

**Options:**
- `throttle` - Throttle updates in ms (default: 100)
- `element` - Element to track selections within

**Returns:**
- `selections` - Map of user selections
- `startTracking()` - Start tracking
- `stopTracking()` - Stop tracking

### `useWhoIsHere(presence)`

Simple "who's online" helper.

**Returns:**
- `users` - Array of online users with avatar colors
- `count` - Number of users
- `onlineCount` - Number actively online (not idle)
- `isAlone` - True if no other users

### `SyncChannel`

Channel for grouping realtime features.

**Methods:**
- `subscribe()` - Subscribe to channel events
- `unsubscribe()` - Unsubscribe from channel
- `track(state)` - Update presence state
- `untrack()` - Stop tracking presence
- `broadcast(event, data)` - Send custom event
- `on(event, handler)` - Listen for events

### `EphemeralStore` (Server)

In-memory store for ephemeral data.

**Methods:**
- `set(key, entry)` - Store data
- `get(key)` - Retrieve data
- `delete(key)` - Remove data
- `getByChannel(channel)` - Query by channel
- `getByUser(userId)` - Query by user
- `cleanup()` - Remove expired entries
- `destroy()` - Cleanup resources

## Types

### `PresenceState<T>`

```typescript
interface PresenceState<T = any> {
  userId: string;
  clientId: string;
  user?: { id: string; name?: string; avatar?: string };
  status: 'online' | 'idle' | 'away';
  cursor?: CursorPosition;
  selection?: Selection;
  editing?: EditingState;
  custom?: T;
  lastUpdated: number;
}
```

### `CursorPosition`

```typescript
interface CursorPosition {
  x: number;
  y: number;
  relativeX?: number;  // Relative to container
  relativeY?: number;
}
```

### `EditingState`

```typescript
interface EditingState {
  resourceId: string;
  resourceType?: string;
  startedAt: number;
}
```

## Best Practices

1. **Channel Naming**: Use descriptive, hierarchical names: `document:${id}`, `room:${roomId}`, `page:${pageId}`

2. **Cleanup**: Always call `destroy()` when unmounting components to prevent memory leaks

3. **Throttling**: Adjust throttle values based on your use case:
   - Cursor: 50ms (20 updates/sec)
   - Selection: 100ms (10 updates/sec)
   - Custom state: Consider debouncing

4. **TTL Configuration**: Balance between real-time accuracy and server load:
   - Presence TTL: 60s (users marked offline after 60s of inactivity)
   - Heartbeat: 30s (updates every 30s)

5. **Security**: Always authenticate realtime requests on the server

6. **Scaling**: For multi-server deployments, use Redis instead of in-memory `EphemeralStore`

## Performance Considerations

- **Debouncing**: Cursor and selection updates are automatically debounced
- **Channel Isolation**: Each channel is independent - no cross-channel chatter
- **Automatic Cleanup**: Expired presence entries are automatically removed
- **Efficient Broadcasting**: Only sends updates to relevant channel subscribers

## Troubleshooting

**Presence not updating:**
- Ensure realtime endpoint is accessible
- Check authentication is working
- Verify channel names match between client and server

**High server load:**
- Increase throttle intervals
- Increase heartbeat interval
- Reduce number of channels

**Memory issues:**
- Lower presence TTL
- Lower ephemeral TTL
- Implement custom cleanup logic
