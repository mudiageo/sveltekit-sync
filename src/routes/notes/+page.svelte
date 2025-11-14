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

  async function updateNote(id: string, content: string) {
    await notesStore.update(id, { content });
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

<div class="notes-page">
  <input bind:value={searchQuery} placeholder="Search notes..." />
  <button onclick={createNote}>New Note</button>

  <div class="notes-grid">
    {#each filteredNotes as note (note.id)}
      <div class="note-card">
        <input 
          value={note.title}
          onchange={(e) => notesStore.update(note.id, { 
            title: e.currentTarget.value 
          })}
        />
        <textarea
          value={note.content}
          onchange={(e) => updateNote(note.id, e.currentTarget.value)}
        />
        <button onclick={() => notesStore.delete(note.id)}>Delete</button>
      </div>
    {/each}
  </div>
  
  {#if notesStore.isEmpty}
    <p>No notes yet!</p>
  {/if}
</div>