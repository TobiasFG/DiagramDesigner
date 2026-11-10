import type { ClientConfig } from '../config';
import type { Diagnostic } from '../model/diagnostics';
import type { SourceFile } from '../model/loader';
import { buildModel, type Model } from '../model/model';
import { fileKind, locate, parseFile, type ParsedFile } from '../model/parse';
import type { ChangedEvent } from '../server/vite-plugin';

type DesignData = Record<string, unknown>;

export interface ModelResponse {
	files: SourceFile[];
	config: ClientConfig;
}

export interface FileMeta {
	text: string;
	hash: string;
	parsed: ParsedFile;
}

/** Client-side design state, loaded from the server and kept in sync with files on disk. */
export class DesignStore {
	data = $state.raw<DesignData>({});
	meta = $state.raw<Record<string, FileMeta>>({});
	config = $state.raw<ClientConfig>({ theme: 'light' });
	loaded = $state(false);
	loadError = $state<string | null>(null);

	model: Model = $derived.by(() =>
		buildModel(this.data, (file, path, key) => {
			const m = this.meta[file];
			return m ? locate(m.parsed.doc, m.parsed.lines, path, key) : undefined;
		})
	);

	diagnostics: Diagnostic[] = $derived([
		...Object.values(this.meta).flatMap((m) => m.parsed.diagnostics),
		...this.model.diagnostics
	]);

	#chain: Promise<unknown> = Promise.resolve();

	/** Queued so change events arriving meanwhile apply afterwards. */
	load(): Promise<void> {
		return this.#serial(() => this.#load());
	}

	async #load(): Promise<void> {
		try {
			const res = await fetch('/api/model');
			if (!res.ok) throw new Error(`GET /api/model failed: ${res.status}`);
			const body: ModelResponse = await res.json();
			this.config = body.config;
			const meta: Record<string, FileMeta> = {};
			const data: DesignData = {};
			for (const f of body.files) {
				if (!fileKind(f.path)) continue;
				const parsed = parseFile(f.path, f.text);
				meta[f.path] = { text: f.text, hash: f.hash!, parsed };
				if (parsed.data !== undefined) data[f.path] = parsed.data;
			}
			this.meta = meta;
			this.data = data;
			this.loaded = true;
		} catch (e) {
			this.loadError = (e as Error).message;
		}
	}

	#serial<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.#chain.then(fn, fn);
		this.#chain = next.catch(() => undefined);
		return next;
	}

	/** A file changed on disk (editor save, git checkout, ...). */
	onExternalChange(ev: ChangedEvent): Promise<void> {
		return this.#serial(async () => {
			if (!fileKind(ev.path) || ev.hash === (this.meta[ev.path]?.hash ?? null)) return;
			const meta = { ...this.meta };
			const data = { ...this.data };
			if (ev.text === null || ev.hash === null) {
				delete meta[ev.path];
				delete data[ev.path];
			} else {
				const parsed = parseFile(ev.path, ev.text);
				meta[ev.path] = { text: ev.text, hash: ev.hash, parsed };
				// A file with syntax errors keeps its last valid data so the diagram stays visible.
				if (parsed.data !== undefined) data[ev.path] = parsed.data;
			}
			this.meta = meta;
			this.data = data;
		});
	}
}

export const design = new DesignStore();
