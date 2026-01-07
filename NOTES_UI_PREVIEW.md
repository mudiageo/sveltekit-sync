# Notes Page - Updated with collection.presence()

## Code Changes

### Before (using channel):
```typescript
const channel = syncEngine.channel('notes', { presence: true }, currentUser);
await channel.subscribe();
channel.track({ viewing: 'notes', editing: id });
```

### After (using collection.presence()):
```typescript
const presence = notesStore.presence({
  user: currentUser,
  custom: { viewing: 'notes' }
});
presence.updatePresence({ custom: { editing: id } });
```

## Benefits of collection.presence()

1. **Simpler API**: No subscribe/unsubscribe needed
2. **Automatic scoping**: Uses 'notes' table name automatically
3. **Cleaner code**: Direct access via `presence.others`
4. **Less boilerplate**: One line to initialize

## Visual UI (Same as before)

```
┌─────────────────────────────────────────────────────────────────┐
│ Notes                          [●] [👤] [Search___] [+ New Note] │
├─────────────────────────────────────────────────────────────────┤
│ ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│ │ ● User42 is  │  │              │  │              │          │
│ │   editing    │  │              │  │              │          │
│ │              │  │              │  │              │          │
│ │ Meeting      │  │ Shopping     │  │ Ideas        │          │
│ │ Notes        │  │ List         │  │              │          │
│ │              │  │              │  │              │          │
│ │ Notes from   │  │ - Milk       │  │ - Feature X  │          │
│ │ today's...   │  │ - Bread      │  │ - Improve Y  │          │
│ │              │  │              │  │              │          │
│ │     [Delete] │  │     [Delete] │  │     [Delete] │          │
│ └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## Code Comparison

### Initialization
```typescript
// Channel API (more complex)
const channel = syncEngine.channel('notes', { presence: true, broadcast: true }, user);
await channel.subscribe();
const collaborators = channel.presence?.others || [];

// Collection API (simpler) ✅
const presence = notesStore.presence({ user, custom: { viewing: 'notes' } });
const collaborators = presence.others;
```

### Updating State
```typescript
// Channel API
channel.track({ viewing: 'notes', editing: noteId });

// Collection API ✅
presence.updatePresence({ custom: { editing: noteId } });
```

### Cleanup
```typescript
// Channel API
await channel.unsubscribe();

// Collection API ✅
presence.destroy();
```

## When to Use Each API

**Use `collection.presence()` (Primary)**
- ✅ Most common use case
- ✅ Presence scoped to a table/collection
- ✅ Simple presence tracking
- ✅ Minimal code

**Use `syncEngine.channel()` (Advanced)**
- Custom channel names (e.g., 'document:123')
- Need custom event broadcasting
- Multiple channels per collection
- Fine-grained control
