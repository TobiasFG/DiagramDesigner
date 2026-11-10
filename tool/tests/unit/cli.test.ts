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
			path.join(dir, 'design/model/erp/broken.module.yaml'),
			'id: x\nparent: erp\nkind: db\n'
		);
		const bad = await sdv(dir, 'validate');
		expect(bad.code).toBe(1);
		expect(bad.err).toBe('model/erp/broken.module.yaml:3:1: error unknown field "kind" [schema]');
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
		expect(files).toEqual(['erp.mmd', 'erp.svg', 'landscape.mmd', 'landscape.svg']);
		const again = await sdv(dir, 'export');
		expect(again.out).toContain('4 export(s), 0 changed');
		expect((await sdv(dir, 'export', '--check')).code).toBe(0);
		// Editing the model makes the committed exports stale.
		const orders = path.join(dir, 'design/model/erp/orders.module.yaml');
		writeFileSync(orders, readFileSync(orders, 'utf8').replace('name: Orders', 'name: Sales'));
		const check = await sdv(dir, 'export', '--check');
		expect(check.code).toBe(1);
		expect(check.err).toContain(
			'out of date: docs/diagrams/erp.svg'.replace(
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
					'landscape',
					'--format',
					'svg',
					'--out',
					out,
					'--theme',
					'dark'
				)
			).code
		).toBe(0);
		expect(readdirSync(out)).toEqual(['landscape.svg']);
		expect(readFileSync(path.join(out, 'landscape.svg'), 'utf8')).toContain('#0d1117');
		expect((await sdv(dir, 'export', '--view', 'nope')).code).toBe(2);
		expect((await sdv(dir, 'export', '--format', 'gif')).code).toBe(2);
		writeFileSync(path.join(dir, 'design/model/erp/broken.module.yaml'), 'id: x\nparent: ghost\n');
		const blocked = await sdv(dir, 'export');
		expect(blocked.code).toBe(1);
		expect(blocked.err).toContain('export blocked');
	});
});

describe('sdv md-sync', () => {
	it('replaces only the marked regions', async () => {
		const dir = repo();
		await sdv(dir, 'export', '--view', 'erp-modules', '--format', 'svg');
		const md = path.join(dir, 'docs/architecture.md');
		const before = [
			'# Architecture',
			'',
			'Intro text stays.',
			'<!-- sdv:view erp-modules format=mermaid -->',
			'old content',
			'<!-- /sdv:view -->',
			'',
			'<!-- sdv:view erp-modules format=svg -->',
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
				'# Architecture\n\nIntro text stays.\n<!-- sdv:view erp-modules format=mermaid -->\n```mermaid\n---\ntitle: "ERP — modules"\n---\nflowchart LR\n'
			)
		).toBe(true);
		expect(after).not.toContain('old content');
		expect(after).toContain(
			'<!-- sdv:view erp-modules format=svg -->\n![ERP — modules](diagrams/erp.svg)\n<!-- /sdv:view -->\nTrailing text.\n'
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

describe('sdv new', () => {
	it('creates an entity file with a generated id that validates', async () => {
		const dir = repo();
		const file = 'design/model/erp/billing.module.yaml';
		const res = await sdv(dir, 'new', file, '--parent', 'erp');
		expect(res.code).toBe(0);
		expect(res.out).toBe(`created ${file}`);
		expect(readFileSync(path.join(dir, file), 'utf8')).toMatch(
			/^id: [a-z][a-z0-9]{9}\nparent: erp\nname: billing\n$/
		);
		expect((await sdv(dir, 'validate', '-q')).code).toBe(0);
		expect((await sdv(dir, 'new', file)).code).toBe(1);
	});

	it('rejects file names without a known kind', async () => {
		const dir = repo();
		expect((await sdv(dir, 'new', 'x.planet.yaml')).code).toBe(2);
		expect((await sdv(dir, 'new')).code).toBe(2);
		expect(existsSync(path.join(dir, 'x.planet.yaml'))).toBe(false);
	});
});

describe('sdv schema', () => {
	it('writes JSON Schemas for entity, view and layout files', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sdv-schema-'));
		expect((await sdv(dir, 'schema', '--out', dir)).code).toBe(0);
		const entity = JSON.parse(readFileSync(path.join(dir, 'entity.schema.json'), 'utf8'));
		expect(entity.title).toBe('System Design Viewer entity file');
		expect(Object.keys(entity.properties)).toEqual([
			'id',
			'parent',
			'ownedBy',
			'models',
			'fields',
			'indexes',
			'name',
			'tags',
			'links',
			'meta'
		]);
		expect(existsSync(path.join(dir, 'view.schema.json'))).toBe(true);
		expect(existsSync(path.join(dir, 'layout.schema.json'))).toBe(true);
	});

	it('prints help and rejects unknown commands', async () => {
		expect((await sdv(tmpdir(), '--help')).out).toContain('sdv validate');
		expect((await sdv(tmpdir(), 'frobnicate')).code).toBe(2);
	});
});
