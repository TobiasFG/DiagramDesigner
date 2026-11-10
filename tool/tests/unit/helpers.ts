import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDesign, type LoadedDesign, type SourceFile } from '../../src/lib/model/loader';

export const FIXTURE_ROOT = fileURLToPath(new URL('../../../design', import.meta.url));

function walk(dir: string, base = dir): string[] {
	return readdirSync(dir).flatMap((name) => {
		const abs = path.join(dir, name);
		return statSync(abs).isDirectory()
			? walk(abs, base)
			: [path.relative(base, abs).split(path.sep).join('/')];
	});
}

export function fixtureSources(): SourceFile[] {
	return walk(FIXTURE_ROOT)
		.sort()
		.map((p) => ({ path: p, text: readFileSync(path.join(FIXTURE_ROOT, p), 'utf8') }));
}

export function loadFixture(): LoadedDesign {
	return loadDesign(fixtureSources());
}

export function loadStrings(files: Record<string, string>): LoadedDesign {
	return loadDesign(Object.entries(files).map(([p, text]) => ({ path: p, text })));
}
