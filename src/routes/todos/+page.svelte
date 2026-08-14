<script lang="ts">
  import { onMount } from 'svelte';
  import { todosStore, syncEngine } from '$lib/db';
  import { browser } from '$app/environment';
  import { useCursorTracking } from '$pkg'
  
  useCursorTracking()

  let newTodoText = $state('');
  let currentUser = $state({
    id: browser ? `user-${Math.random().toString(36).substr(2, 9)}` : 'user-temp',
    name: `User ${Math.floor(Math.random() * 100)}`,
    color: `hsl(${Math.random() * 360}, 70%, 50%)`
  });

  // Create channel for todos with presence
  let channel = $state(null as any);
  let collaborators = $derived(channel?.presence?.others || []);
  let onlineCount = $derived(collaborators.length + 1);

  // Load todos on mount
  onMount(async () => {
    todosStore.load();

    // Set up presence channel
    if (browser && syncEngine.realtime) {
      channel = syncEngine.channel('todos', {
        presence: true,
        broadcast: true
      }, currentUser);

      await channel.subscribe();
      channel.track({ viewing: 'todos', status: 'active' });

      // Listen for real-time events
      channel.on('todo:completed', (data: any) => {
        console.log('📣', `${data.user} completed a todo!`);
      });
    }

    return () => {
      channel?.unsubscribe();
    };
  });

  // Create derived state
  const completedTodos = $derived(
    todosStore.data.filter(todo => todo.completed === true)
  );
  
  const activeTodos = $derived(
    todosStore.data.filter(todo => todo.completed === false)
  );

  const sortedTodos = $derived(
    [...todosStore.data].sort((a, b) => b.createdAt - a.createdAt)
  );

  // CRUD operations
  async function addTodo() {
    if (!newTodoText.trim()) return;
    
    await todosStore.create({
      text: newTodoText,
      completed: false,
      createdAt: new Date()
    });
    
    newTodoText = '';
  }

  async function toggleTodo(id: string) {
    const todo = todosStore.data.find(t => t.id === id);
    if (!todo) return;
    
    await todosStore.update(id, {
      completed: !todo.completed
    });

    // Broadcast event to collaborators
    if (!todo.completed && channel) {
      await channel.broadcast('todo:completed', {
        user: currentUser.name,
        todoText: todo.text
      });
    }
  }

  async function deleteTodo(id: string) {
    await todosStore.delete(id);
  }

  async function deleteCompleted() {
    const ids = completedTodos.map(t => t.id);
    await todosStore.deleteMany(ids);
  }
</script>

<div class="todos-page animate-fade-in max-w-3xl mx-auto">
  <div class="flex items-center justify-between mb-8">
    <h1 class="heading-1">Todos</h1>
    <div class="flex items-center gap-md">
      <!-- Realtime status indicator -->
      {#if syncEngine.realtime}
        <div class="realtime-status">
          <span class="status-dot"></span>
        </div>
      {/if}

      <!-- Collaborators -->
      {#if onlineCount > 1}
        <div class="collaborators">
          <div class="avatars-group">
            {#each collaborators.slice(0, 3) as collab (collab.user.id)}
              <div 
                class="avatar" 
                style="background-color: {collab.user.color}"
                title="{collab.user.name}"
              >
                {collab.user.name.charAt(0)}
              </div>
            {/each}
            {#if collaborators.length > 3}
              <div class="avatar more">+{collaborators.length - 3}</div>
            {/if}
          </div>
          <span class="text-sm text-muted">{onlineCount} online</span>
        </div>
      {/if}

      <div class="stats text-muted">
        <span>{activeTodos.length} active</span>
        <span class="mx-2">•</span>
        <span>{completedTodos.length} done</span>
      </div>
    </div>
  </div>

  <!-- Add todo form -->
  <form onsubmit={(e) => { e.preventDefault(); addTodo(); }} class="flex gap-sm mb-8">
    <input 
      bind:value={newTodoText}
      placeholder="What needs to be done?"
      disabled={todosStore.isLoading}
      class="input"
      autofocus
    />
    <button type="submit" class="btn btn-primary" disabled={!newTodoText.trim()}>
      Add Task
    </button>
  </form>

  <!-- Error state -->
  {#if todosStore.error}
    <div class="error-banner mb-4">
      Error: {todosStore.error.message}
    </div>
  {/if}

  <!-- Todo list -->
  <div class="todo-list flex flex-col gap-sm">
    {#each sortedTodos as todo (todo.id)}
      <div class="todo-item card flex items-center justify-between p-4 {todo.completed ? 'completed' : ''}">
        <div class="flex items-center gap-md flex-1">
          <input 
            type="checkbox" 
            checked={todo.completed}
            onchange={() => toggleTodo(todo.id)}
            class="checkbox"
          />
          <span class="todo-text">{todo.text}</span>
        </div>
        <button onclick={() => deleteTodo(todo.id)} class="btn btn-ghost btn-sm text-danger">
          Delete
        </button>
      </div>
    {/each}
  </div>

  <!-- Empty state -->
  {#if todosStore.isEmpty && !todosStore.isLoading}
    <div class="empty-state text-center py-12 text-muted">
      <p>No todos yet. Add one above to get started!</p>
    </div>
  {/if}

  <!-- Bulk actions -->
  {#if completedTodos.length > 0}
    <div class="mt-8 flex justify-center">
      <button onclick={deleteCompleted} class="btn btn-ghost text-muted">
        Clear {completedTodos.length} completed items
      </button>
    </div>
  {/if}
</div>

<style>
  .max-w-3xl { max-width: 48rem; }
  .mx-auto { margin-left: auto; margin-right: auto; }
  .mb-8 { margin-bottom: var(--spacing-xl); }
  .mb-4 { margin-bottom: var(--spacing-md); }
  .mt-8 { margin-top: var(--spacing-xl); }
  .mx-2 { margin-left: 0.5rem; margin-right: 0.5rem; }
  .py-12 { padding-top: 3rem; padding-bottom: 3rem; }
  .p-4 { padding: var(--spacing-md); }
  .text-danger { color: var(--color-danger); }
  .text-sm { font-size: 0.875rem; }

  .todo-item {
    transition: all 0.2s ease;
    border: 1px solid transparent;
  }

  .todo-item:hover {
    border-color: var(--color-border);
    transform: translateY(-1px);
  }

  .todo-item.completed {
    opacity: 0.6;
    background-color: transparent;
    border: 1px solid var(--color-border);
  }

  .todo-item.completed .todo-text {
    text-decoration: line-through;
  }

  .checkbox {
    width: 1.25rem;
    height: 1.25rem;
    cursor: pointer;
    accent-color: var(--color-primary);
  }

  .error-banner {
    background-color: rgba(239, 68, 68, 0.1);
    color: var(--color-danger);
    padding: var(--spacing-md);
    border-radius: var(--radius-md);
  }

  /* Realtime status */
  .realtime-status {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
    background-color: #22c55e;
    animation: pulse 2s ease-in-out infinite;
  }

  .status-dot {
    width: 100%;
    height: 100%;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  /* Collaborators */
  .collaborators {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .avatars-group {
    display: flex;
    align-items: center;
    margin-left: -0.5rem;
  }

  .avatar {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 600;
    color: white;
    border: 2px solid var(--color-bg);
    margin-left: -0.5rem;
    transition: transform 0.2s ease;
  }

  .avatar:hover {
    transform: translateY(-2px) scale(1.1);
    z-index: 10;
  }

  .avatar.more {
    background-color: var(--color-bg-secondary);
    color: var(--color-text);
  }
</style>
