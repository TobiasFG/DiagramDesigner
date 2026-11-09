import { promises as fs } from 'node:fs';
import { applyPatches, enablePatches, type Patch } from 'immer';
import { parseDocument } from 'yaml';
import { formatLayout } from '../model/layout-format';
import { fileKind } from '../model/parse';
import type { LayoutFile } from '../model/schema';
import { issueMessage, validateFile } from '../model/validate-file';
import { atomicWrite, readText, resolveInRoot, sha256 } from './files';
import { editYamlText } from './yaml-edit';

enablePatches();

/** One file touched by a command. Patch paths are relative to the file's data. */
export interface WriteChange {
	path: string;
	/** SHA-256 of the file the client based its edit on; null when creating it. */
	baseHash: string | null;
	patches: Patch[];
}

export interface WriteRequest {
	changes: WriteChange[];
}

export interface FileState {
	path: string;
	/** null when the file does not exist (deleted). */
	text: string | null;
	hash: string | null;
}

export type WriteResult =
	| { status: 200; files: FileState[] }
	| { status: 409; conflicts: FileState[] }
	| { status: 400 | 422; error: string };

let queue: Promise<unknown> = Promise.resolve();

/** Serialises writes so each one sees the result of the previous. */
export function enqueueWrite(root: string, req: WriteRequest): Promise<WriteResult> {
	const run = queue.then(() => applyWrite(root, req));
	queue = run.catch(() => undefined);
	return run;
}

const hashOf = (text: string | undefined) => (text === undefined ? null : sha256(text));

export async function applyWrite(root: string, req: WriteRequest): Promise<WriteResult> {
	if (!Array.isArray(req?.changes) || !req.changes.length)
		return { status: 400, error: 'no changes' };
	const current = new Map<string, string | undefined>();
	for (const change of req.changes) {
		let abs: string;
		try {
			abs = resolveInRoot(root, change.path);
		} catch (e) {
			return { status: 400, error: (e as Error).message };
		}
		current.set(change.path, await readText(abs));
	}
	const conflicts = req.changes
		.filter((c) => hashOf(current.get(c.path)) !== c.baseHash)
		.map((c) => ({
			path: c.path,
			text: current.get(c.path) ?? null,
			hash: hashOf(current.get(c.path))
		}));
	if (conflicts.length) return { status: 409, conflicts };

	const outputs: { path: string; text: string | null }[] = [];
	for (const change of req.changes) {
		const kind = fileKind(change.path)!;
		const before = current.get(change.path);
		const deleted = change.patches.some((p) => p.path.length === 0 && p.op === 'remove');
		if (deleted) {
			outputs.push({ path: change.path, text: null });
			continue;
		}
		const doc = parseDocument(before ?? '');
		if (doc.errors.length) {
			return {
				status: 422,
				error: `${change.path} has syntax errors (${doc.errors[0].message.split('\n')[0]}); fix it in the editor first`
			};
		}
		const oldData = before === undefined ? undefined : (doc.toJS() ?? undefined);
		let newData: unknown;
		try {
			// Creating a file arrives as a root-level "add", which immer only accepts as "replace".
			const patches = change.patches.map((p) =>
				p.path.length === 0 && p.op === 'add' ? { ...p, op: 'replace' as const } : p
			);
			newData = applyPatches(oldData ?? {}, patches);
		} catch (e) {
			return {
				status: 422,
				error: `${change.path}: patch does not apply (${(e as Error).message})`
			};
		}
		// Reject only issues the edit introduces; pre-existing ones stay the user's to fix.
		const known = new Set(validateFile(kind, oldData).issues.map(issueMessage));
		const introduced = validateFile(kind, newData)
			.issues.map(issueMessage)
			.filter((m) => !known.has(m));
		if (introduced.length)
			return { status: 422, error: `${change.path}: ${introduced.join('; ')}` };
		let text: string;
		if (kind === 'layout') text = formatLayout(newData as LayoutFile);
		else text = editYamlText(before ?? '', newData);
		outputs.push({ path: change.path, text });
	}

	for (const out of outputs) {
		const abs = resolveInRoot(root, out.path);
		if (out.text === null) await fs.rm(abs, { force: true });
		else if (out.text !== current.get(out.path)) await atomicWrite(abs, out.text);
	}
	return {
		status: 200,
		files: outputs.map((o) => ({
			path: o.path,
			text: o.text,
			hash: o.text === null ? null : sha256(o.text)
		}))
	};
}
