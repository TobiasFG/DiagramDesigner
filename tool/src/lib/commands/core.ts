import type { Draft } from 'immer';
import type { ClientConfig } from '../config';
import type { DataPath } from '../model/diagnostics';
import { layoutFileFor, type Model } from '../model/model';
import type { LayoutFile, View } from '../model/schema';
import { ID_PATTERN } from '../model/schema';

/** Plain data of every design file, keyed by design-relative path. */
export type DesignData = Record<string, unknown>;

export interface CommandContext {
	model: Model;
	config: Pick<ClientConfig, 'defaultModelFile' | 'defaultViewFile' | 'snapGrid'>;
	/** Messages for the user (e.g. dropped stale layout entries). */
	notices: string[];
}

/**
 * A typed edit. `run` mutates an immer draft of the design data; the resulting patches are
 * applied optimistically, written to disk and inverted for undo. Commands are re-runnable,
 * which lets a write that hit a conflict be re-applied on top of the fresh files.
 */
export interface Command {
	label: string;
	run(draft: Draft<DesignData>, ctx: CommandContext): void;
}

export class CommandError extends Error {}

export function fail(message: string): never {
	throw new CommandError(message);
}

type Obj = Record<string, unknown>;

/** Walks to the value at `path` inside a file. Throws when it does not exist. */
export function getAt<T = Obj>(draft: Draft<DesignData>, file: string, path: DataPath): T {
	let cur: unknown = draft[file];
	for (const seg of path) {
		if (cur === null || typeof cur !== 'object') fail(`${file}: nothing at ${path.join('.')}`);
		cur = (cur as Obj)[seg as string];
	}
	if (cur === undefined) fail(`${file}: nothing at ${path.join('.')}`);
	return cur as T;
}

export function parentOf(path: DataPath): { list: DataPath; index: number } {
	const index = path[path.length - 1];
	if (typeof index !== 'number') fail(`not a list item: ${path.join('.')}`);
	return { list: path.slice(0, -1), index };
}

/** Removes the list item at `path`. */
export function removeAt(draft: Draft<DesignData>, file: string, path: DataPath): unknown {
	const { list, index } = parentOf(path);
	const arr = getAt<unknown[]>(draft, file, list);
	return arr.splice(index, 1)[0];
}

/** Returns the file's top-level mapping, creating the file if needed. */
export function fileRoot(draft: Draft<DesignData>, file: string): Obj {
	if (draft[file] === undefined || draft[file] === null) draft[file] = {};
	const root = draft[file];
	if (typeof root !== 'object' || Array.isArray(root)) fail(`${file} is not a mapping`);
	return root as Obj;
}

/** Returns `obj[key]` as an array, creating it when missing. */
export function listIn<T = unknown>(obj: Obj, key: string): T[] {
	if (obj[key] === undefined || obj[key] === null) obj[key] = [];
	if (!Array.isArray(obj[key])) fail(`"${key}" is not a list`);
	return obj[key] as T[];
}

export function toKebab(text: string): string {
	const s = text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return /^[a-z]/.test(s) ? s : `x-${s || 'item'}`;
}

/** An id not in `taken`, derived from `base`. */
export function uniqueId(base: string, taken: (id: string) => boolean): string {
	const root = toKebab(base);
	if (!taken(root)) return root;
	for (let i = 2; ; i++) if (!taken(`${root}-${i}`)) return `${root}-${i}`;
}

export function assertId(id: string) {
	if (!ID_PATTERN.test(id)) fail(`"${id}" is not a valid id (kebab-case, starting with a letter)`);
}

export function snap(v: number, grid: number): number {
	return grid > 0 ? Math.round(v / grid) * grid : Math.round(v);
}

/**
 * The layout file draft of a view, created on demand. Entries for entities that no longer
 * exist are dropped (and reported once) whenever the layout is written.
 */
export function layoutDraft(
	draft: Draft<DesignData>,
	ctx: CommandContext,
	viewId: string,
	known?: Set<string>
): Draft<LayoutFile> {
	const file = layoutFileFor(viewId);
	if (!draft[file])
		draft[file] = { version: 1, view: viewId, nodes: {}, edges: {} } satisfies LayoutFile;
	const layout = draft[file] as Draft<LayoutFile>;
	layout.nodes ??= {};
	layout.edges ??= {};
	if (known) {
		const stale = Object.keys(layout.nodes).filter((id) => !known.has(id));
		for (const id of stale) delete layout.nodes[id];
		const staleEdges = Object.keys(layout.edges).filter((key) => {
			const [from, rest] = key.split('->');
			return !known.has(from) || !known.has(rest?.split('#')[0] ?? '');
		});
		for (const key of staleEdges) delete layout.edges[key];
		if (stale.length || staleEdges.length) {
			ctx.notices.push(
				`Dropped layout entries for removed items: ${[...stale, ...staleEdges].join(', ')}`
			);
		}
	}
	return layout;
}

/**
 * The editable view definition. Generated default views are first written to the default
 * view file so that view-level edits (like "remove from view") have somewhere to live.
 */
export function viewDraft(
	draft: Draft<DesignData>,
	ctx: CommandContext,
	viewId: string
): Draft<View> {
	const info = ctx.model.views.get(viewId) ?? fail(`unknown view "${viewId}"`);
	if (info.loc) return getAt<Draft<View>>(draft, info.loc.file, info.loc.path);
	const views = listIn<Draft<View>>(fileRoot(draft, ctx.config.defaultViewFile), 'views');
	views.push({ ...info.def });
	return views[views.length - 1];
}

/** Runs several commands in one draft as a single undoable step. */
export function batch(label: string, commands: Command[]): Command {
	return {
		label,
		run(draft, ctx) {
			for (const c of commands) c.run(draft, ctx);
		}
	};
}

/** Non-throwing lookup of the value at `path` inside a file. */
export function readAt(data: DesignData, file: string, path: DataPath): unknown {
	let cur: unknown = data[file];
	for (const seg of path) {
		if (cur === null || typeof cur !== 'object') return undefined;
		cur = (cur as Obj)[seg as string];
	}
	return cur;
}

/** Drops undefined values and empty optional lists produced by forms. */
export function cleanValue(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(cleanValue);
	if (v && typeof v === 'object') {
		const out: Obj = {};
		for (const [k, x] of Object.entries(v)) {
			if (x === undefined) continue;
			out[k] = cleanValue(x);
		}
		return out;
	}
	return v;
}
