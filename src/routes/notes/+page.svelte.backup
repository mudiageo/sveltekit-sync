<script lang="ts">
  import { onMount } from 'svelte';
  import { notesStore } from '$lib/db';

  onMount(() => {
    notesStore.load();
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
  }

  // Search notes with derived state
  let searchQuery = $state('');
  const filteredNotes = $derived(
    notesStore.filter(note => 
      note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.content.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );
</script>

<div class="notes-page animate-fade-in">
  <div class="flex items-center justify-between mb-8">
    <h1 class="heading-1">Notes</h1>
    <div class="flex gap-sm">
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
      <div class="note-card card flex flex-col gap-sm">
        <input 
          value={note.title}
          onchange={(e) => updateNote(note.id, { title: e.currentTarget.value })}
          class="note-title"
          placeholder="Note Title"
        />
        <textarea
          value={note.content}
          onchange={(e) => updateNote(note.id, { content: e.currentTarget.value })}
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
</style>