import { createHash, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileKind } from '../model/parse';
import type { SourceFile } from '../model/loader';

export function sha256(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.svelte-kit']);

/** Design-relative paths (forward slashes) of every model, view and layout file, sorted. */
export async function listDesignFiles(root: string): Promise<string[]> {
	const out: string[] = [];
	const walk = async (dir: string) => {
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
			const abs = path.join(dir, e.name);
			if (e.isDirectory()) await walk(abs);
			else if (fileKind(e.name)) out.push(toRel(root, abs));
		}
	};
	await walk(root);
	return out.sort();
}

export function toRel(root: string, abs: string): string {
	return path.relative(root, abs).split(path.sep).join('/');
}

/** Resolves a design-relative path, refusing anything outside the root. */
export function resolveInRoot(root: string, rel: string): string {
	const abs = path.resolve(root, rel);
	const back = path.relative(root, abs);
	if (back.startsWith('..') || path.isAbsolute(back) || !fileKind(rel)) {
		throw new Error(`Invalid design file path: ${rel}`);
	}
	return abs;
}

export async function readDesign(root: string): Promise<SourceFile[]> {
	const files = await listDesignFiles(root);
	return Promise.all(
		files.map(async (p) => {
			const text = await fs.readFile(path.join(root, p), 'utf8');
			return { path: p, text, hash: sha256(text) };
		})
	);
}

export async function readText(abs: string): Promise<string | undefined> {
	try {
		return await fs.readFile(abs, 'utf8');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw e;
	}
}

/** Writes via a temp file in the same directory and renames it into place. */
export async function atomicWrite(abs: string, text: string): Promise<void> {
	await fs.mkdir(path.dirname(abs), { recursive: true });
	const tmp = path.join(
		path.dirname(abs),
		`.${path.basename(abs)}.${randomBytes(4).toString('hex')}.tmp`
	);
	await fs.writeFile(tmp, text, 'utf8');
	await fs.rename(tmp, abs);
}
