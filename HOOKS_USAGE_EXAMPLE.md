# Hooks & Awareness Utilities - Usage Examples

## Complete Example: Collaborative Whiteboard

This example demonstrates all the new hooks working together:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { syncEngine } from '$lib/db';
  import {
    usePresence,
    useCursorTracking,
    useSelectionTracking,
    useWhoIsHere
  } from 'sveltekit-sync';

  const currentUser = {
    id: 'user-123',
    name: 'Jane Doe',
    avatar: '/avatars/jane.jpg'
  };

  // Create channel with presence enabled
  const channel = syncEngine.channel('whiteboard:abc', { 
    presence: true,
    broadcast: true
  }, currentUser);

  // Initialize presence with auto-tracking
  const presence = usePresence(channel, currentUser, {
    customState: { tool: 'pen', color: '#FF6B6B' },
    trackCursor: true,
    idleTimeout: 300000 // 5 minutes
  });

  // Setup cursor tracking
  let canvasRef: HTMLElement;
  const cursorTracking = useCursorTracking(presence, {
    container: canvasRef,
    throttle: 50
  });

  // Who's online helper
  const whoIsHere = useWhoIsHere(presence);

  onMount(async () => {
    await channel.subscribe();
    cursorTracking.startTracking();

    return () => {
      cursorTracking.stopTracking();
      presence.destroy();
      channel.unsubscribe();
    };
  });

  // Reactive state
  const collaborators = $derived(presence.others);
  const cursors = $derived(cursorTracking.cursors);
  const { avatars, isAlone, onlineCount } = whoIsHere;

  // Handle tool changes
  function changeTool(tool: 'pen' | 'eraser' | 'select') {
    presence.updateCustom({ tool, color: '#FF6B6B' });
  }
</script>

<div class="whiteboard-app">
  <!-- Header with "Who's Here" -->
  <header>
    <h1>Collaborative Whiteboard</h1>
    
    <div class="collaborators">
      {#if isAlone}
        <span>You're alone</span>
      {:else}
        <span>{onlineCount} online</span>
        <div class="avatars">
          {#each avatars as { user, color }}
            <div 
              class="avatar" 
              style="background-color: {color}"
              title={user.name}
            >
              {user.name[0]}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </header>

  <!-- Toolbar -->
  <div class="toolbar">
    <button onclick={() => changeTool('pen')}>Pen</button>
    <button onclick={() => changeTool('eraser')}>Eraser</button>
    <button onclick={() => changeTool('select')}>Select</button>
  </div>

  <!-- Canvas with cursor tracking -->
  <div bind:this={canvasRef} class="canvas">
    <canvas id="drawing-canvas"></canvas>
    
    <!-- Render other users' cursors -->
    {#each [...cursors.values()] as { user, position }}
      <div 
        class="remote-cursor"
        style="
          left: {position.x}px;
          top: {position.y}px;
          border-color: {user.color};
        "
      >
        <svg width="20" height="20" viewBox="0 0 20 20">
          <path 
            d="M0,0 L0,16 L4,12 L7,19 L9,18 L6,11 L12,11 Z" 
            fill={user.color}
          />
        </svg>
        <span class="cursor-label" style="background-color: {user.color}">
          {user.name}
        </span>
      </div>
    {/each}

    <!-- Show what tool others are using -->
    {#each collaborators as collab}
      {#if collab.custom?.tool === 'pen'}
        <div class="user-indicator">
          {collab.user.name} is drawing
        </div>
      {/if}
    {/each}
  </div>
</div>

<style>
  .whiteboard-app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  header {
    display: flex;
    justify-content: space-between;
    padding: 1rem;
    background: var(--color-bg-secondary);
  }

  .collaborators {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .avatars {
    display: flex;
    gap: -0.5rem;
  }

  .avatar {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 600;
    font-size: 0.875rem;
    border: 2px solid white;
  }

  .canvas {
    flex: 1;
    position: relative;
    overflow: hidden;
  }

  .remote-cursor {
    position: absolute;
    pointer-events: none;
    z-index: 1000;
    transition: left 0.1s, top 0.1s;
  }

  .cursor-label {
    position: absolute;
    top: 20px;
    left: 20px;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    color: white;
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .user-indicator {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    padding: 0.5rem 1rem;
    background: var(--color-bg-secondary);
    border-radius: 8px;
    font-size: 0.875rem;
  }
</style>
```

## Benefits of Using Hooks

### Before (Manual Setup):
```typescript
// Lots of boilerplate
const channel = syncEngine.channel('doc', { presence: true }, user);
await channel.subscribe();
const presence = channel.presence;

// Manual event listeners
const unsubJoin = presence.on('join', (state) => { /* ... */ });
const unsubUpdate = presence.on('update', (state) => { /* ... */ });

// Manual cursor tracking
document.addEventListener('mousemove', (e) => {
  presence.updateCursor({ x: e.clientX, y: e.clientY });
});

// Manual cleanup
onDestroy(() => {
  unsubJoin();
  unsubUpdate();
  // etc...
});
```

### After (With Hooks):
```typescript
// Simple and clean
const presence = usePresence(channel, user, { trackCursor: true });
const cursorTracking = useCursorTracking(presence);
const whoIsHere = useWhoIsHere(presence);

// Reactive state
const others = $derived(presence.others);
const cursors = $derived(cursorTracking.cursors);

// Automatic cleanup built-in
```

## API Comparison

### usePresence
| Feature | Without Hook | With Hook |
|---------|-------------|-----------|
| Setup | 5-10 lines | 1 line |
| Reactivity | Manual state management | Built-in with $derived |
| Cursor tracking | Manual event listener | `trackCursor: true` |
| Selection tracking | Manual implementation | `trackSelection: true` |
| Cleanup | Manual unsubscribe | `destroy()` |

### useCursorTracking
- **Automatic throttling** (default 50ms)
- **Container-scoped** tracking
- **Reactive cursors map**
- **Start/stop** API

### useSelectionTracking
- **Element-scoped** selection tracking
- **Throttled updates** (default 100ms)
- **Reactive selections map**
- **Handles text extraction**

### useWhoIsHere
- **Simplified API** for online users
- **Automatic color generation**
- **Avatar-ready data**
- **isAlone helper**

## Real-world Patterns

### Pattern 1: Collaborative Text Editor
```typescript
const presence = usePresence(channel, user);
const selectionTracking = useSelectionTracking(presence, { 
  element: editorElement 
});

// Show who's editing where
for (const [userId, { user, selection }] of selections) {
  highlightRange(selection.start, selection.end, user.color);
}
```

### Pattern 2: Multiplayer Game
```typescript
const presence = usePresence(channel, user, { 
  customState: { position: { x: 0, y: 0 }, health: 100 }
});

// Update player position
function movePlayer(x: number, y: number) {
  presence.updateCustom({ position: { x, y } });
}

// See other players
const players = $derived(presence.others.map(p => p.custom));
```

### Pattern 3: Design Tool
```typescript
const presence = usePresence(channel, user);
const cursorTracking = useCursorTracking(presence, {
  container: artboardElement,
  throttle: 30 // More frequent for smoother cursors
});

// Show design tool selections
const selectedObjects = $derived(
  presence.others.filter(p => p.custom?.selectedId)
);
```

## Performance Tips

1. **Throttle appropriately**: 
   - Cursors: 30-50ms
   - Selections: 100-200ms
   - State updates: 200-500ms

2. **Scope containers**: Use specific containers rather than document.body

3. **Clean up**: Always call `destroy()` when unmounting

4. **Use custom state wisely**: Keep it under 1KB per user

5. **Test with many users**: Performance degrades with 50+ active users
