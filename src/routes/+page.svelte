<div class="hero flex flex-col items-center justify-center animate-fade-in">
	<h1 class="heading-1 text-center mb-4">
		<span class="text-gradient">Local-First</span> Sync Engine
		<br />
		for SvelteKit
	</h1>
	
	<p class="text-muted text-center max-w-2xl mb-8 text-lg">
		Build real-time, offline-capable applications with ease. 
		Optimistic updates, conflict resolution, and database agnostic.
	</p>

	<div class="flex gap-md">
		<a href="/todos" class="btn btn-primary">
			Try Todos App
		</a>
		<a href="/notes" class="btn btn-ghost">
			Try Notes App
		</a>
	</div>

	<div class="features grid grid-cols-3 gap-lg mt-16 w-full">
		<div class="card">
			<div class="icon">⚡</div>
			<h3 class="heading-2 mb-2">Instant</h3>
			<p class="text-muted">Optimistic UI updates make your app feel native and responsive.</p>
		</div>
		<div class="card">
			<div class="icon">📡</div>
			<h3 class="heading-2 mb-2">Offline</h3>
			<p class="text-muted">Keep working without internet. Changes sync when you're back online.</p>
		</div>
		<div class="card">
			<div class="icon">🔄</div>
			<h3 class="heading-2 mb-2">Real-time</h3>
			<p class="text-muted">Changes propagate instantly across all connected devices.</p>
		</div>
	</div>
</div>

<style>
	.hero {
		min-height: 80vh;
		padding: var(--spacing-2xl) 0;
	}

	.text-gradient {
		background: linear-gradient(135deg, var(--color-primary) 0%, #60a5fa 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
	}

	.text-lg {
		font-size: 1.125rem;
		line-height: 1.75;
	}

	.mb-4 { margin-bottom: var(--spacing-md); }
	.mb-8 { margin-bottom: var(--spacing-2xl); }
	.mb-2 { margin-bottom: var(--spacing-sm); }
	.mt-16 { margin-top: 4rem; }
	.max-w-2xl { max-width: 42rem; }
	.text-center { text-align: center; }
	.w-full { width: 100%; }

	.icon {
		font-size: 2rem;
		margin-bottom: var(--spacing-md);
	}
</style>