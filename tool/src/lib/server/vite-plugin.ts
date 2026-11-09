import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { fileKind } from '../model/parse';
import { loadConfig } from './config';
import { readText, sha256, toRel } from './files';

/** Payload of the `sdv:changed` HMR event. `text` is null when the file was deleted. */
export interface ChangedEvent {
	path: string;
	text: string | null;
	hash: string | null;
}

/**
 * Watches the design root (which may live outside the project) and pushes file contents to
 * the browser as `sdv:changed` custom HMR events, so saving in an editor updates the canvas
 * without a page reload.
 */
export async function attachDesignWatcher(server: ViteDevServer): Promise<void> {
	const config = await loadConfig();
	const root = config.root;
	server.watcher.add(root);
	const notify = async (file: string, deleted: boolean) => {
		const rel = toRel(root, file);
		if (rel.startsWith('..') || path.isAbsolute(rel) || !fileKind(rel)) return;
		const text = deleted ? null : ((await readText(file)) ?? null);
		const event: ChangedEvent = { path: rel, text, hash: text === null ? null : sha256(text) };
		server.ws.send({ type: 'custom', event: 'sdv:changed', data: event });
	};
	server.watcher.on('add', (f) => void notify(f, false));
	server.watcher.on('change', (f) => void notify(f, false));
	server.watcher.on('unlink', (f) => void notify(f, true));
}
