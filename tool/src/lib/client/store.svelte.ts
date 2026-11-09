import { applyPatches, enablePatches, type Patch } from 'immer';
import type { ClientConfig } from '../config';
import type { Command, CommandContext, DesignData } from '../commands/core';
import { applyCommand, patchesByFile, touchedFiles } from '../commands/runner';
import type { Diagnostic } from '../model/diagnostics';
import type { SourceFile } from '../model/loader';
import { buildModel, type Model } from '../model/model';
import { fileKind, locate, parseFile, type ParsedFile } from '../model/parse';
import type { FileState, WriteRequest, WriteResult } from '../server/write';
import type { ChangedEvent } from '../server/vite-plugin';

enablePatches();

export interface ModelResponse {
	files: SourceFile[];
	readOnly: boolean;
	config: ClientConfig;
}

export interface Transport {
	load(): Promise<ModelResponse>;
	write(req: WriteRequest): Promise<WriteResult>;
}

export const httpTransport: Transport = {
	async load() {
		const res = await fetch('/api/model');
		if (!res.ok) throw new Error(`GET /api/model failed: ${res.status}`);
		return res.json();
	},
	async write(req) {
		const res = await fetch('/api/write', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(req)
		});
		const body = await res.json().catch(() => ({}));
		if (res.status === 200 || res.status === 409 || res.status === 422 || res.status === 400)
			return body as WriteResult;
		return { status: 422, error: body.message ?? `write failed (${res.status})` };
	}
};

export interface FileMeta {
	text: string;
	hash: string;
	parsed: ParsedFile;
}

export interface Notice {
	id: number;
	kind: 'info' | 'error' | 'conflict';
	text: string;
}

interface HistoryEntry {
	label: string;
	patches: Patch[];
	inverse: Patch[];
}

type PersistResult = { ok: true } | { ok: false; conflicts?: FileState[]; error?: string };

const DEFAULT_CONFIG: ClientConfig = {
	theme: 'light',
	snapGrid: 10,
	defaultModelFile: 'model/model.model.yaml',
	defaultViewFile: 'views/views.view.yaml',
	formats: ['mermaid', 'svg']
};

/**
 * Client-side design state. The file data is the source of truth for the in-memory model;
 * canvas edits and external file edits both end up here.
 */
export class DesignStore {
	data = $state.raw<DesignData>({});
	meta = $state.raw<Record<string, FileMeta>>({});
	config = $state.raw<ClientConfig>(DEFAULT_CONFIG);
	readOnly = $state(false);
	loaded = $state(false);
	loadError = $state<string | null>(null);
	undoStack = $state.raw<HistoryEntry[]>([]);
	redoStack = $state.raw<HistoryEntry[]>([]);
	notices = $state.raw<Notice[]>([]);
	/** Increments on every applied external change (used by tests and the reload indicator). */
	externalChanges = $state(0);

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
	#noticeId = 0;

	private transport: Transport;

	constructor(transport: Transport) {
		this.transport = transport;
	}

	/** Queued like every other operation, so change events arriving meanwhile apply afterwards. */
	load(): Promise<void> {
		return this.#serial(() => this.#load());
	}

	async #load(): Promise<void> {
		try {
			const res = await this.transport.load();
			this.config = res.config;
			this.readOnly = res.readOnly;
			const meta: Record<string, FileMeta> = {};
			const data: DesignData = {};
			for (const f of res.files) {
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

	notify(kind: Notice['kind'], text: string) {
		const notice = { id: ++this.#noticeId, kind, text };
		this.notices = [...this.notices, notice];
		if (kind === 'info') setTimeout(() => this.dismiss(notice.id), 6000);
	}

	dismiss(id: number) {
		this.notices = this.notices.filter((n) => n.id !== id);
	}

	#ctx(): CommandContext {
		return { model: this.model, config: this.config, notices: [] };
	}

	/** Dry run: which files a command would change, or why it cannot run. */
	preview(cmd: Command): { files: string[]; error?: string } {
		try {
			return { files: touchedFiles(applyCommand(this.data, cmd, this.#ctx()).patches) };
		} catch (e) {
			return { files: [], error: (e as Error).message };
		}
	}

	/** Runs operations one at a time so every write is based on the previous result. */
	#serial<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.#chain.then(fn, fn);
		this.#chain = next.catch(() => undefined);
		return next;
	}

	execute(cmd: Command): Promise<boolean> {
		return this.#serial(() => this.#run(cmd, true));
	}

	async #run(cmd: Command, retry: boolean): Promise<boolean> {
		if (this.readOnly) {
			this.notify('error', 'This build is read-only');
			return false;
		}
		const ctx = this.#ctx();
		let applied;
		try {
			applied = applyCommand(this.data, cmd, ctx);
		} catch (e) {
			this.notify('error', (e as Error).message);
			return false;
		}
		if (!applied.patches.length) return true;
		for (const n of ctx.notices) this.notify('info', n);
		const entry: HistoryEntry = {
			label: cmd.label,
			patches: applied.patches,
			inverse: applied.inverse
		};
		this.data = applied.next;
		this.undoStack = [...this.undoStack, entry].slice(-200);
		this.redoStack = [];
		const res = await this.#persist(applied.patches);
		if (res.ok) return true;
		this.data = applyPatches(this.data, applied.inverse);
		this.undoStack = this.undoStack.filter((e) => e !== entry);
		if (res.conflicts) {
			this.#applyFiles(res.conflicts, false);
			this.#clearHistory();
			if (!retry) return false;
			const ok = await this.#run(cmd, false);
			this.notify(
				ok ? 'info' : 'conflict',
				ok
					? `Files changed on disk; "${cmd.label}" was re-applied on top.`
					: `"${cmd.label}" conflicts with changes on disk and was not applied.`
			);
			return ok;
		}
		this.notify('error', res.error ?? 'write failed');
		return false;
	}

	async #persist(patches: Patch[]): Promise<PersistResult> {
		const changes = [...patchesByFile(patches)].map(([path, ps]) => ({
			path,
			baseHash: this.meta[path]?.hash ?? null,
			patches: ps
		}));
		let res: WriteResult;
		try {
			res = await this.transport.write({ changes });
		} catch (e) {
			return { ok: false, error: `write failed: ${(e as Error).message}` };
		}
		if (res.status === 200) {
			this.#applyFiles(res.files, true);
			return { ok: true };
		}
		if (res.status === 409) return { ok: false, conflicts: res.conflicts };
		return { ok: false, error: res.error };
	}

	/** Takes file contents from the server. Own writes keep the (identical) optimistic data. */
	#applyFiles(files: FileState[], ownWrite: boolean) {
		const meta = { ...this.meta };
		const data = { ...this.data };
		for (const f of files) {
			if (f.text === null || f.hash === null) {
				delete meta[f.path];
				delete data[f.path];
				continue;
			}
			const parsed = parseFile(f.path, f.text);
			meta[f.path] = { text: f.text, hash: f.hash, parsed };
			// A file with syntax errors keeps its last valid data so the diagram stays visible.
			if (!ownWrite && parsed.data !== undefined) data[f.path] = parsed.data;
		}
		this.meta = meta;
		this.data = data;
	}

	#clearHistory() {
		this.undoStack = [];
		this.redoStack = [];
	}

	undo(): Promise<boolean> {
		return this.#serial(() => this.#step('undo'));
	}

	redo(): Promise<boolean> {
		return this.#serial(() => this.#step('redo'));
	}

	async #step(dir: 'undo' | 'redo'): Promise<boolean> {
		const from = dir === 'undo' ? this.undoStack : this.redoStack;
		const entry = from[from.length - 1];
		if (!entry || this.readOnly) return false;
		const forward = dir === 'undo' ? entry.inverse : entry.patches;
		const back = dir === 'undo' ? entry.patches : entry.inverse;
		this.data = applyPatches(this.data, forward);
		if (dir === 'undo') {
			this.undoStack = this.undoStack.slice(0, -1);
			this.redoStack = [...this.redoStack, entry];
		} else {
			this.redoStack = this.redoStack.slice(0, -1);
			this.undoStack = [...this.undoStack, entry];
		}
		const res = await this.#persist(forward);
		if (res.ok) return true;
		this.data = applyPatches(this.data, back);
		if (res.conflicts) {
			this.#applyFiles(res.conflicts, false);
			this.#clearHistory();
			this.notify(
				'conflict',
				`Could not ${dir} "${entry.label}": the files changed on disk. History was cleared.`
			);
		} else {
			this.notify('error', res.error ?? `${dir} failed`);
			if (dir === 'undo') {
				this.redoStack = this.redoStack.slice(0, -1);
				this.undoStack = [...this.undoStack, entry];
			} else {
				this.undoStack = this.undoStack.slice(0, -1);
				this.redoStack = [...this.redoStack, entry];
			}
		}
		return false;
	}

	/** A file changed on disk (editor save, git checkout, ...). Own writes are recognised by hash. */
	onExternalChange(ev: ChangedEvent): Promise<void> {
		return this.#serial(async () => {
			if (!fileKind(ev.path) || ev.hash === (this.meta[ev.path]?.hash ?? null)) return;
			const touched = [...this.undoStack, ...this.redoStack].some((e) =>
				touchedFiles(e.patches).includes(ev.path)
			);
			if (touched) this.#clearHistory();
			this.#applyFiles([{ path: ev.path, text: ev.text, hash: ev.hash }], false);
			this.externalChanges++;
		});
	}

	/** Resolves once every queued operation has finished. */
	idle(): Promise<void> {
		return this.#chain.then(() => undefined);
	}
}

export const design = new DesignStore(httpTransport);
