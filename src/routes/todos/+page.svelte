<script lang="ts">
  import { onMount } from 'svelte';
  import { todosStore } from '$lib/db';

  let newTodoText = $state('new');

  // Load todos on mount
  onMount(() => {
    todosStore.load();
  });

  // Create derived state
  const completedTodos = $derived(
    todosStore.filter(todo => todo.completed)
  );
  
  const activeTodos = $derived(
    todosStore.filter(todo => !todo.completed)
  );

  // CRUD operations - super ergonomic!
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
  
  // Example: Sorting
const sortedTodos = $derived(
  todosStore.sort((a, b) => b.createdAt - a.createdAt)
);

// Example: Computed properties
const todoStats = $derived({
  total: todosStore.count,
  completed: todosStore.filter(t => t.completed).length,
  active: todosStore.filter(t => !t.completed).length,
  percentComplete: todosStore.count > 0 
    ? (todosStore.filter(t => t.completed).length / todosStore.count) * 100 
    : 0
});

// Example: Finding specific items
const urgentTodo = $derived(
  todosStore.find(t => t.priority === 'urgent')
);

// Example: Batch operations
async function markAllComplete() {
  const updates = todosStore.data.map(todo => ({
    id: todo.id,
    data: { completed: true }
  }));
  await todosStore.updateMany(updates);
}

</script>

<div class="todos-page">
  <h1>Todos</h1>

  <!-- Loading state -->
  {#if todosStore.isLoading}
    <p>Loading todos...</p>
  {/if}

  <!-- Error state -->
  {#if todosStore.error}
    <div class="error">
      Error: {todosStore.error.message}
    </div>
  {/if}

  <!-- Add todo form -->
  <form onsubmit={(e) => { e.preventDefault(); addTodo(); }}>
    <input 
      bind:value={newTodoText}
      placeholder="What needs to be done?"
      disabled={todosStore.isLoading}
    />
    <button type="submit">Add</button>
  </form>

  <!-- Stats -->
  <div class="stats">
    <span>Total: {todosStore.count}</span>
    <span>Active: {activeTodos.length}</span>
    <span>Completed: {completedTodos.length}</span>
  </div>

  <!-- Todo list - directly use todosStore.data -->
  <ul class="todo-list">
    {#each todosStore.data as todo (todo.id)}
      <li class:completed={todo.completed}>
        <input 
          type="checkbox" 
          checked={todo.completed}
          onchange={() => toggleTodo(todo.id)}
        />
        <span>{todo.text}</span>
        <button onclick={() => deleteTodo(todo.id)}>Delete</button>
      </li>
    {/each}
  </ul>

  <!-- Bulk actions -->
  {#if completedTodos.length > 0}
    <button onclick={deleteCompleted}>
      Clear completed ({completedTodos.length})
    </button>
  {/if}

  <!-- Empty state -->
  {#if todosStore.isEmpty && !todosStore.isLoading}
    <p class="empty">No todos yet. Add one to get started!</p>
  {/if}
</div>

<style>
  .completed span {
    text-decoration: line-through;
    opacity: 0.5;
  }
  
  .syncing { color: #2196F3; }
  .pending { color: #FF9800; }
  .synced { color: #4CAF50; }
</style>
