<script lang="ts">
  import { onMount } from "svelte";
  import { initDB, syncEngine } from "$lib/db.js";
  import { browser } from "$app/environment";
  import "../app.css";

  let { children } = $props();
  if (browser) await initDB();
  onMount(() => {
    // initDB();

    return () => {
      syncEngine.destroy();
    };
  });

  // Access global sync state
  const syncState = $derived(syncEngine.state);
</script>

<div class="app">
  <header>
    <div class="sync-indicator">
      {#if syncState.isSyncing}
        <span class="syncing">↻ Syncing...</span>
      {:else if syncState.hasPendingChanges}
        <span class="pending">⚠ {syncState.pendingOps.length} pending</span>
      {:else}
        <span class="synced">✓ Synced</span>
      {/if}
    </div>
    <a href="/todos">Todos</a>
    <a href="/notes">Notes</a>
  </header>

  {@render children()}
</div>
