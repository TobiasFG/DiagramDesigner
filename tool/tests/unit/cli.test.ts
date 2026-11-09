import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../../cli/sdv';
import { syncMarkdown } from '../../cli/md-sync';
import { FIXTURE_ROOT } from './helpers';

/** A throwaway repository: sdv.config.ts + a copy of the fixture design. */
function repo() {
	const dir = mkdtempSync(path.join(tmpdir(), 'sdv-cli-'));
	cpSync(FIXTURE_ROOT, path.join(dir, 'design'), { recursive: true });
	writeFileSync(
		path.join(dir, 'sdv.config.ts'),
		"export default { root: 'design', exportDir: 'docs/diagrams', formats: ['mermaid', 'svg'] };\n"
	);
	return dir;
}

async function sdv(cwd: string, ...args: string[]) {
	const out: string[] = [];
	const err: string[] = [];
	const code = await main(args, { log: (m) => out.push(m), error: (m) => err.push(m) }, cwd);
	return { code, out: out.join('\n'), err: err.join('\n') };
}

describe('sdv validate', () => {
	it('passes on the fixture and fails with file:line:col on errors', async () => {
		const dir = repo();
		const ok = await sdv(dir, 'validate');
		expect(ok.code).toBe(0);
		expect(ok.out).toContain('0 error(s), 0 warning(s)');
		writeFileSync(
			path.join(dir, 'design/model/broken.model.yaml'),
			'elements:\n  - { id: x, kind: planet }\n'
		);
		const bad = await sdv(dir, 'validate');
		expect(bad.code).toBe(1);
		expect(bad.err).toMatch(/^model\/broken\.model\.yaml:2:\d+: error elements\[0\]\.kind/);
	});

	it('--root points at a design elsewhere', async () => {
		const dir = repo();
		expect((await sdv(tmpdir(), 'validate', '--root', path.join(dir, 'design'), '-q')).code).toBe(
			0
		);
	});
});

describe('sdv export', () => {
	it('writes mermaid and svg per view, re-exports byte-identically and --check detects drift', async () => {
		const dir = repo();
		expect((await sdv(dir, 'export', '--check')).code).toBe(1);
		const first = await sdv(dir, 'export');
		expect(first.code).toBe(0);
		const files = readdirSync(path.join(dir, 'docs/diagrams')).sort();
		expect(files).toContain('shop-containers.mmd');
		expect(files).toContain('place-order.svg');
		// Generated default views are only exported on request.
		expect(files).not.toContain('payment.svg');
		expect(files).toHaveLength(16);
		const again = await sdv(dir, 'export');
		expect(again.out).toContain('16 export(s), 0 changed');
		expect((await sdv(dir, 'export', '--check')).code).toBe(0);
		// Editing the model makes the committed exports stale.
		const model = path.join(dir, 'design/model/shop.model.yaml');
		writeFileSync(
			model,
			readFileSync(model, 'utf8').replace('name: Storefront', 'name: Web Front')
		);
		const check = await sdv(dir, 'export', '--check');
		expect(check.code).toBe(1);
		expect(check.err).toContain(
			'out of date: docs/diagrams/shop-containers.svg'.replace(
				'docs',
				path.relative(process.cwd(), path.join(dir, 'docs'))
			)
		);
	});

	it('honours --view, --format, --out and --theme; refuses to export an invalid model', async () => {
		const dir = repo();
		const out = path.join(dir, 'out');
		expect(
			(
				await sdv(
					dir,
					'export',
					'--view',
					'order-domain',
					'--format',
					'svg',
					'--out',
					out,
					'--theme',
					'dark'
				)
			).code
		).toBe(0);
		expect(readdirSync(out)).toEqual(['order-domain.svg']);
		expect(readFileSync(path.join(out, 'order-domain.svg'), 'utf8')).toContain('#0d1117');
		expect((await sdv(dir, 'export', '--view', 'nope')).code).toBe(2);
		expect((await sdv(dir, 'export', '--format', 'gif')).code).toBe(2);
		writeFileSync(
			path.join(dir, 'design/model/broken.model.yaml'),
			'relationships:\n  - { from: a, to: b }\n'
		);
		const blocked = await sdv(dir, 'export');
		expect(blocked.code).toBe(1);
		expect(blocked.err).toContain('export blocked');
	});
});

describe('sdv md-sync', () => {
	it('replaces only the marked regions', async () => {
		const dir = repo();
		await sdv(dir, 'export', '--view', 'shop-containers', '--format', 'svg');
		const md = path.join(dir, 'docs/architecture.md');
		const before = [
			'# Architecture',
			'',
			'Intro text stays.',
			'<!-- sdv:view shop-containers format=mermaid -->',
			'old content',
			'<!-- /sdv:view -->',
			'',
			'<!-- sdv:view shop-containers format=svg -->',
			'<!-- /sdv:view -->',
			'Trailing text.',
			''
		].join('\n');
		writeFileSync(md, before);
		const res = await sdv(dir, 'md-sync', md);
		expect(res.code).toBe(0);
		const after = readFileSync(md, 'utf8');
		expect(
			after.startsWith(
				'# Architecture\n\nIntro text stays.\n<!-- sdv:view shop-containers format=mermaid -->\n```mermaid\n---\ntitle: "Web Shop — containers"\n---\nflowchart LR\n'
			)
		).toBe(true);
		expect(after).not.toContain('old content');
		expect(after).toContain(
			'<!-- sdv:view shop-containers format=svg -->\n![Web Shop — containers](diagrams/shop-containers.svg)\n<!-- /sdv:view -->\nTrailing text.\n'
		);
		// Running again changes nothing.
		await sdv(dir, 'md-sync', md);
		expect(readFileSync(md, 'utf8')).toBe(after);
		expect((await sdv(dir, 'md-sync')).code).toBe(2);
	});

	it('reports unknown views', async () => {
		await expect(
			syncMarkdown(
				'<!-- sdv:view x -->\n<!-- /sdv:view -->',
				async (id) => Promise.reject(new Error(`unknown view "${id}"`)),
				'a.md'
			)
		).rejects.toThrow('unknown view "x"');
		expect(await syncMarkdown('no markers', async () => 'x', 'a.md')).toBe('no markers');
	});
});

describe('sdv schema', () => {
	it('writes JSON Schemas for model, view and layout files', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sdv-schema-'));
		expect((await sdv(dir, 'schema', '--out', dir)).code).toBe(0);
		const model = JSON.parse(readFileSync(path.join(dir, 'model.schema.json'), 'utf8'));
		expect(model.title).toBe('System Design Viewer model file');
		expect(model.properties.elements.items).toBeTruthy();
		expect(existsSync(path.join(dir, 'view.schema.json'))).toBe(true);
		expect(existsSync(path.join(dir, 'layout.schema.json'))).toBe(true);
	});

	it('prints help and rejects unknown commands', async () => {
		expect((await sdv(tmpdir(), '--help')).out).toContain('sdv validate');
		expect((await sdv(tmpdir(), 'frobnicate')).code).toBe(2);
	});
});
