import { isMap, isNode, isPair, isScalar, LineCounter, parseDocument, type Document } from 'yaml';
import type { DataPath, Diagnostic } from './diagnostics';

export type FileKind = 'model' | 'view' | 'layout';

export function fileKind(path: string): FileKind | null {
	if (path.endsWith('.model.yaml') || path.endsWith('.model.yml')) return 'model';
	if (path.endsWith('.view.yaml') || path.endsWith('.view.yml')) return 'view';
	if (path.endsWith('.layout.json')) return 'layout';
	return null;
}

export interface ParsedFile {
	path: string;
	kind: FileKind;
	/** Plain JS data, or undefined when the file has syntax errors. */
	data: unknown;
	doc: Document;
	lines: LineCounter;
	diagnostics: Diagnostic[];
}

/** Parses YAML (and JSON, which is a YAML subset) keeping the CST for source positions. */
export function parseFile(path: string, text: string): ParsedFile {
	const kind = fileKind(path);
	if (!kind) throw new Error(`Not a design file: ${path}`);
	const lines = new LineCounter();
	const doc = parseDocument(text, { lineCounter: lines, prettyErrors: false, uniqueKeys: true });
	const diagnostics: Diagnostic[] = [];
	for (const err of [...doc.errors, ...doc.warnings]) {
		const pos = lines.linePos(err.pos[0]);
		diagnostics.push({
			severity: doc.errors.includes(err) ? 'error' : 'warning',
			code: 'syntax',
			message: err.message.split('\n')[0],
			file: path,
			line: pos.line,
			col: pos.col
		});
	}
	const data = doc.errors.length ? undefined : (doc.toJS() ?? {});
	return { path, kind, data, doc, lines, diagnostics };
}

/**
 * Maps a data path to a source position. Falls back to the closest existing ancestor.
 * When `key` is set, points at that key inside the map at `path` instead of its value.
 */
export function locate(
	doc: Document,
	lines: LineCounter,
	path: DataPath,
	key?: string
): { line: number; col: number } | undefined {
	let node: unknown = doc.contents;
	let best: unknown = node;
	for (const seg of path) {
		if (!isNode(node) || !('get' in node)) break;
		const next = (node as { get(k: unknown, keep: true): unknown }).get(seg, true);
		if (next === undefined || next === null) break;
		node = next;
		best = node;
	}
	if (key !== undefined && isMap(best)) {
		const pair = best.items.find((p) => isPair(p) && isScalar(p.key) && p.key.value === key);
		if (pair && isNode(pair.key) && pair.key.range) return lines.linePos(pair.key.range[0]);
	}
	if (isNode(best) && best.range) return lines.linePos(best.range[0]);
	return undefined;
}
