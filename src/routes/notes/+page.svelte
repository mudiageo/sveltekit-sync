<script lang="ts">
  import { onMount } from 'svelte';
  import { notesStore, syncEngine } from '$lib/db';
  import { browser } from '$app/environment';

  let currentUser = $state({
    id: browser ? `user-${Math.random().toString(36).substr(2, 9)}` : 'user-temp',
    name: `User ${Math.floor(Math.random() * 100)}`,
    color: `hsl(${Math.random() * 360}, 70%, 50%)`
  });

  // Use collection.presence() directly - main API
  let presence = $state(null as any);
  let collaborators = $derived(presence?.others || []);
  let editingUsers = $derived(
    collaborators.filter(c => c.custom?.editing)
  );

  onMount(async () => {
    notesStore.load();

    // Initialize presence from collection store
    if (browser && syncEngine.realtime) {
      presence = notesStore.presence({
        user: currentUser,
        custom: { viewing: 'notes' }
      });
    }

    return () => {
      presence?.destroy();
    };
  });

  async function createNote() {
    await notesStore.create({
      title: 'New Note',
      content: '',
      tags: []
    });
  }

  async function updateNote(id: string, updates: Partial<any>) {
    await notesStore.update(id, updates);

    // Update presence to show editing
    if (presence) {
      presence.updatePresence({ custom: { viewing: 'notes', editing: id } });
    }
  }

  function stopEditing() {
    if (presence) {
      presence.updatePresence({ custom: { viewing: 'notes', editing: null } });
    }
  }

  function getEditingUser(noteId: string) {
    return editingUsers.find(u => u.custom?.editing === noteId);
  }

  // Search notes with derived state
  let searchQuery = $state('');
  const filteredNotes = $derived(
    notesStore.data.filter(note => 
      note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.content.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );
</script>

<div class="notes-page animate-fade-in">
  <div class="flex items-center justify-between mb-8">
    <h1 class="heading-1">Notes</h1>
    <div class="flex gap-sm items-center">
      {#if syncEngine.realtime}
        <div class="realtime-status"></div>
      {/if}
      
      {#if collaborators.length > 0}
        <div class="collaborators-mini">
          <div class="avatars-group">
            {#each collaborators.slice(0, 3) as collab (collab.user.id)}
              <div 
                class="avatar-sm" 
                style="background-color: {collab.user.color}"
                title="{collab.user.name}"
              >
                {collab.user.name.charAt(0)}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <input 
        bind:value={searchQuery} 
        placeholder="Search notes..." 
        class="input"
        style="width: 300px;"
      />
      <button onclick={createNote} class="btn btn-primary">
        + New Note
      </button>
    </div>
  </div>

  <div class="notes-grid grid grid-cols-3 gap-lg">
    {#each filteredNotes as note (note.id)}
      {@const editor = getEditingUser(note.id)}
      <div class="note-card card flex flex-col gap-sm">
        {#if editor}
          <div class="editing-indicator" style="border-color: {editor.user.color}">
            <span class="editing-dot" style="background-color: {editor.user.color}"></span>
            {editor.user.name} is editing
          </div>
        {/if}
        
        <input 
          value={note.title}
          onchange={(e) => updateNote(note.id, { title: e.currentTarget.value })}
          onfocus={() => presence?.updatePresence({ custom: { viewing: 'notes', editing: note.id } })}
          onblur={stopEditing}
          class="note-title"
          placeholder="Note Title"
        />
        <textarea
          value={note.content}
          onchange={(e) => updateNote(note.id, { content: e.currentTarget.value })}
          onfocus={() => presence?.updatePresence({ custom: { viewing: 'notes', editing: note.id } })}
          onblur={stopEditing}
          class="note-content"
          placeholder="Start typing..."
        ></textarea>
        <div class="flex justify-end mt-2">
          <button onclick={() => notesStore.delete(note.id)} class="btn btn-ghost btn-sm text-danger">
            Delete
          </button>
        </div>
      </div>
    {/each}
  </div>
  
  {#if notesStore.isEmpty}
    <div class="empty-state text-center py-12 text-muted">
      <p>No notes yet. Create one to get started!</p>
    </div>
  {/if}
</div>

<style>
  .mb-8 { margin-bottom: var(--spacing-xl); }
  .mt-2 { margin-top: var(--spacing-sm); }
  .py-12 { padding-top: 3rem; padding-bottom: 3rem; }
  .text-danger { color: var(--color-danger); }

  .note-card {
    transition: transform 0.2s ease;
    min-height: 200px;
    position: relative;
  }

  .note-card:hover {
    transform: translateY(-2px);
    border-color: var(--color-primary);
  }

  .note-title {
    font-size: 1.25rem;
    font-weight: 700;
    background: transparent;
    border: none;
    color: var(--color-text);
    width: 100%;
    padding: var(--spacing-xs) 0;
  }

  .note-title:focus {
    outline: none;
  }

  .note-content {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--color-text-muted);
    resize: none;
    font-family: inherit;
    line-height: 1.6;
    min-height: 100px;
  }

  .note-content:focus {
    outline: none;
    color: var(--color-text);
  }

  .realtime-status {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background-color: #22c55e;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .collaborators-mini {
    display: flex;
    align-items: center;
  }

  .avatars-group {
    display: flex;
    margin-left: -0.25rem;
  }

  .avatar-sm {
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.7rem;
    font-weight: 600;
    color: white;
    border: 2px solid var(--color-bg);
    margin-left: -0.25rem;
  }

  .editing-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    background-color: rgba(255, 255, 255, 0.05);
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    border-left: 3px solid;
    margin-bottom: 0.5rem;
  }

  .editing-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    animation: pulse 1.5s ease-in-out infinite;
  }
</style>
