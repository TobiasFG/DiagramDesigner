import {
	mkdtempSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	existsSync,
	readdirSync,
	cpSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyWrite, enqueueWrite } from '../../src/lib/server/write';
import { listDesignFiles, readDesign, resolveInRoot, sha256 } from '../../src/lib/server/files';
import { loadConfig } from '../../src/lib/server/config';
import { FIXTURE_ROOT } from './helpers';

let root: string;
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const hash = (rel: string) => sha256(read(rel));

beforeEach(() => {
	root = mkdtempSync(path.join(tmpdir(), 'sdv-write-'));
	cpSync(FIXTURE_ROOT, root, { recursive: true });
});

describe('write service', () => {
	it('applies patches to YAML keeping everything else byte-identical', async () => {
		const before = read('model/shop.model.yaml');
		const res = await applyWrite(root, {
			changes: [
				{
					path: 'model/shop.model.yaml',
					baseHash: sha256(before),
					patches: [{ op: 'replace', path: ['elements', 2, 'name'], value: 'Stripe' }]
				}
			]
		});
		expect(res.status).toBe(200);
		const after = read('model/shop.model.yaml');
		expect(after).toBe(before.replace('name: Payment Provider', 'name: Stripe'));
		expect(res.status === 200 && res.files[0].hash).toBe(sha256(after));
	});

	it('rejects a stale base hash with 409 and the current contents', async () => {
		const res = await applyWrite(root, {
			changes: [{ path: 'model/shop.model.yaml', baseHash: 'old', patches: [] }]
		});
		expect(res.status).toBe(409);
		expect(res.status === 409 && res.conflicts[0]).toMatchObject({
			path: 'model/shop.model.yaml',
			text: read('model/shop.model.yaml'),
			hash: hash('model/shop.model.yaml')
		});
	});

	it('rejects results that fail validation with a message naming the field', async () => {
		const res = await applyWrite(root, {
			changes: [
				{
					path: 'model/shop.model.yaml',
					baseHash: hash('model/shop.model.yaml'),
					patches: [{ op: 'replace', path: ['elements', 0, 'kind'], value: 'robot' }]
				}
			]
		});
		expect(res.status).toBe(422);
		expect(res.status === 422 && res.error).toMatch(/elements\[0\]\.kind/);
	});

	it('creates layout files in the stable format and deletes files', async () => {
		const layout = {
			version: 1,
			view: 'system-context',
			nodes: { shop: { pinned: true, x: 10, y: 20 } },
			edges: {}
		};
		const res = await applyWrite(root, {
			changes: [
				{
					path: 'layout/system-context.layout.json',
					baseHash: null,
					patches: [{ op: 'add', path: [], value: layout }]
				}
			]
		});
		expect(res.status).toBe(200);
		expect(read('layout/system-context.layout.json')).toBe(
			'{\n  "version": 1,\n  "view": "system-context",\n  "nodes": {\n    "shop": { "x": 10, "y": 20, "pinned": true }\n  },\n  "edges": {}\n}\n'
		);
		const del = await applyWrite(root, {
			changes: [
				{
					path: 'layout/system-context.layout.json',
					baseHash: hash('layout/system-context.layout.json'),
					patches: [{ op: 'remove', path: [] }]
				}
			]
		});
		expect(del.status).toBe(200);
		expect(existsSync(path.join(root, 'layout/system-context.layout.json'))).toBe(false);
		// Atomic writes leave no temp files behind.
		expect(readdirSync(path.join(root, 'layout')).filter((f) => f.endsWith('.tmp'))).toEqual([]);
	});

	it('refuses paths outside the design root and non-design files', async () => {
		expect(
			(
				await applyWrite(root, {
					changes: [{ path: '../evil.model.yaml', baseHash: null, patches: [] }]
				})
			).status
		).toBe(400);
		expect(() => resolveInRoot(root, 'model/notes.txt')).toThrow();
		expect((await applyWrite(root, { changes: [] })).status).toBe(400);
	});

	it('refuses to edit a file with syntax errors', async () => {
		writeFileSync(path.join(root, 'model/bad.model.yaml'), 'elements: [\n');
		const res = await applyWrite(root, {
			changes: [
				{ path: 'model/bad.model.yaml', baseHash: hash('model/bad.model.yaml'), patches: [] }
			]
		});
		expect(res.status).toBe(422);
	});

	it('serialises concurrent writes', async () => {
		const h = hash('model/shop.model.yaml');
		const p = (value: string) =>
			enqueueWrite(root, {
				changes: [
					{
						path: 'model/shop.model.yaml',
						baseHash: h,
						patches: [{ op: 'replace', path: ['elements', 3, 'name'], value }]
					}
				]
			});
		const [a, b] = await Promise.all([p('A'), p('B')]);
		expect(a.status).toBe(200);
		// The second write was based on the original hash and must conflict.
		expect(b.status).toBe(409);
	});

	it('writes every file of a multi-file change', async () => {
		const res = await applyWrite(root, {
			changes: [
				{
					path: 'model/shop.model.yaml',
					baseHash: hash('model/shop.model.yaml'),
					patches: [{ op: 'replace', path: ['elements', 0, 'name'], value: 'Buyer' }]
				},
				{
					path: 'views/views.view.yaml',
					baseHash: hash('views/views.view.yaml'),
					patches: [{ op: 'replace', path: ['views', 0, 'title'], value: 'Context' }]
				}
			]
		});
		expect(res.status).toBe(200);
		expect(read('model/shop.model.yaml')).toContain('name: Buyer');
		expect(read('views/views.view.yaml')).toContain('title: Context');
	});
});

describe('files and config', () => {
	it('lists design files and hashes them', async () => {
		expect(await listDesignFiles(root)).toEqual([
			'model/delivery.model.yaml',
			'model/domain.model.yaml',
			'model/flows.model.yaml',
			'model/interactions.model.yaml',
			'model/shop.model.yaml',
			'views/views.view.yaml'
		]);
		const files = await readDesign(root);
		expect(files[0].hash).toBe(sha256(files[0].text));
	});

	it('loads sdv.config.ts, resolving paths against it; SDV_ROOT overrides the root', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sdv-config-'));
		mkdirSync(path.join(dir, 'sub'));
		writeFileSync(
			path.join(dir, 'sdv.config.ts'),
			"export default { root: 'my-design', exportDir: 'out', formats: ['svg'], snapGrid: 0 } satisfies Record<string, unknown>;\n"
		);
		const c = await loadConfig({ cwd: path.join(dir, 'sub'), env: {} });
		expect(c).toMatchObject({
			root: path.join(dir, 'my-design'),
			exportDir: path.join(dir, 'out'),
			formats: ['svg'],
			snapGrid: 0,
			theme: 'light'
		});
		const o = await loadConfig({ cwd: dir, env: { SDV_ROOT: 'elsewhere' } });
		expect(o.root).toBe(path.join(dir, 'elsewhere'));
		const none = await loadConfig({ cwd: tmpdir(), env: {}, configFile: undefined });
		expect(none.root).toBeTruthy();
	});
});
