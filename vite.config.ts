import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import { sveltekit } from '@sveltejs/kit/vite';

/**
 * Vitest configuration following Sveltest patterns
 * @see https://sveltest.dev/docs/getting-started
 * 
 * Three test environments:
 * 1. Client (Browser) - *.svelte.test.ts - Runs in real browser with Playwright
 * 2. SSR - *.ssr.test.ts - Server-side rendering tests in Node.js
 * 3. Server - *.test.ts - Pure Node.js tests for server-side logic
 */
export default defineConfig({
	plugins: [sveltekit()],
	test: {
		// Ensure all tests have assertions to prevent false positives
		expect: { requireAssertions: true },
		projects: [
			{
				// Client tests (Browser environment)
				// For testing Svelte components, IndexedDB, BroadcastChannel, etc.
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: [
						'src/lib/server/**',
						'src/**/*.ssr.{test,spec}.{js,ts}'
					],
					setupFiles: ['./src/vitest-setup-client.ts']
				}
			},
			{
				// SSR tests (Server-side rendering)
				// For testing component rendering on the server
				extends: './vite.config.ts',
				test: {
					name: 'ssr',
					environment: 'node',
					include: ['src/**/*.ssr.{test,spec}.{js,ts}']
				}
			},
			{
				// Server tests (Node.js environment)
				// For ServerSyncEngine, DrizzleAdapter, types, utilities
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: [
						'src/**/*.svelte.{test,spec}.{js,ts}',
						'src/**/*.ssr.{test,spec}.{js,ts}'
					]
				}
			}
		],
		// Coverage configuration
		coverage: {
			include: ['src/pkg/**'],
			exclude: [
				'src/pkg/**/*.test.ts',
				'src/pkg/**/*.spec.ts',
				'src/tests/**'
			]
		}
	}
});
