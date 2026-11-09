import adapter from '@sveltejs/adapter-static';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';

/** Watches the design root and pushes `sdv:changed` HMR events (see src/lib/server/vite-plugin.ts). */
function sdvPlugin(): Plugin {
	return {
		name: 'sdv-design-watcher',
		apply: 'serve',
		async configureServer(server) {
			// Loaded through tsx at runtime so the config bundle stays free of app modules.
			const { tsImport } = await import('tsx/esm/api');
			const url = new URL('./src/lib/server/vite-plugin.ts', import.meta.url).href;
			const mod = (await tsImport(
				url,
				import.meta.url
			)) as typeof import('./src/lib/server/vite-plugin');
			await mod.attachDesignWatcher(server);
		}
	};
}

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// The static build is a read-only viewer: every page falls back to the SPA shell.
			adapter: adapter({ fallback: 'index.html', strict: false })
		}),
		sdvPlugin()
	],
	server: { host: 'localhost' },
	preview: { host: 'localhost' },
	worker: { format: 'es' },
	test: {
		include: ['tests/unit/**/*.test.ts'],
		environment: 'node',
		coverage: {
			provider: 'v8',
			include: ['src/lib/model/**', 'src/lib/projections/**', 'src/lib/export/**'],
			exclude: ['src/lib/export/png.ts'],
			thresholds: { lines: 80 }
		}
	}
});
