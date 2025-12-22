<script lang="ts">
  import { onMount } from 'svelte';
  import { todosStore } from '$lib/db';

  let newTodoText = $state('');

  // Load todos on mount
  onMount(() => {
    todosStore.load();
  });

  // Create derived state
  const completedTodos = $derived(
   await todosStore.query().where(todo => todo.completed === true).get()
  );
  
  const activeTodos = $derived(
    await todosStore.query().where(todo => todo.completed === false).get()
  );

  const sortedTodos = $derived(
    todosStore.sort((a, b) => b.createdAt - a.createdAt)
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
    const todo = todosStore.find(t => t.id === id);
    if (!todo) return;
    console.log(activeTodos)
    await todosStore.update(id, {
      completed: !todo.completed
    });
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
    <div class="stats text-muted">
      <span>{activeTodos.length} active</span>
      <span class="mx-2">•</span>
      <span>{completedTodos.length} done</span>
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
</style>
