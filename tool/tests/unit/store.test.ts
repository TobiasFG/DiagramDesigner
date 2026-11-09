import { describe, expect, it } from 'vitest';
import { DesignStore, type Transport } from '../../src/lib/client/store.svelte';
import { renameEntity } from '../../src/lib/commands/model';
import { moveNodes } from '../../src/lib/commands/layout';
import type { WriteRequest, WriteResult } from '../../src/lib/server/write';
import { applyWrite } from '../../src/lib/server/write';
import { readDesign, sha256 } from '../../src/lib/server/files';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FIXTURE_ROOT } from './helpers';

/** Transport backed by a real temp directory and the real write service. */
function diskTransport() {
	const root = mkdtempSync(path.join(tmpdir(), 'sdv-store-'));
	cpSync(FIXTURE_ROOT, root, { recursive: true });
	const writes: WriteRequest[] = [];
	let intercept: ((req: WriteRequest) => WriteResult | undefined) | undefined;
	const transport: Transport = {
		load: async () => ({
			files: await readDesign(root),
			readOnly: false,
			config: {
				theme: 'light',
				snapGrid: 10,
				defaultModelFile: 'model/model.model.yaml',
				defaultViewFile: 'views/views.view.yaml',
				formats: ['svg']
			}
		}),
		write: async (req) => {
			writes.push(req);
			return intercept?.(req) ?? applyWrite(root, req);
		}
	};
	return {
		root,
		transport,
		writes,
		read: (rel: string) => readFileSync(path.join(root, rel), 'utf8'),
		write: (rel: string, text: string) => writeFileSync(path.join(root, rel), text),
		setIntercept: (fn: typeof intercept) => (intercept = fn)
	};
}

async function setup() {
	const disk = diskTransport();
	const store = new DesignStore(disk.transport);
	await store.load();
	return { store, disk };
}

const refOf = (store: DesignStore, id: string) => ({
	kind: 'element' as const,
	...store.model.elements.get(id)!.loc
});

describe('DesignStore', () => {
	it('loads files, builds the model and reports no diagnostics for the fixture', async () => {
		const { store } = await setup();
		expect(store.loaded).toBe(true);
		expect(store.model.views.size).toBe(9);
		expect(store.diagnostics).toEqual([]);
	});

	it('applies commands optimistically, writes them and records history', async () => {
		const { store, disk } = await setup();
		// Optimistic: the model already shows the change while the write is in flight.
		let during: string | undefined;
		disk.setIntercept(() => {
			during = store.model.elements.get('customer')!.name;
			return undefined;
		});
		expect(await store.execute(renameEntity(refOf(store, 'customer'), 'Shopper'))).toBe(true);
		expect(during).toBe('Shopper');
		expect(disk.read('model/shop.model.yaml')).toContain('name: Shopper');
		expect(store.meta['model/shop.model.yaml'].hash).toBe(
			sha256(disk.read('model/shop.model.yaml'))
		);
		expect(store.undoStack.map((e) => e.label)).toEqual(['Rename element']);
	});

	it('undo and redo issue normal writes', async () => {
		const { store, disk } = await setup();
		const original = disk.read('model/shop.model.yaml');
		await store.execute(renameEntity(refOf(store, 'customer'), 'Shopper'));
		await store.undo();
		expect(disk.read('model/shop.model.yaml')).toBe(original);
		expect(store.model.elements.get('customer')!.name).toBe('Customer');
		await store.redo();
		expect(disk.read('model/shop.model.yaml')).toContain('name: Shopper');
		expect(store.redoStack).toHaveLength(0);
	});

	it('rejects invalid commands without writing', async () => {
		const { store, disk } = await setup();
		expect(
			await store.execute(
				renameEntity(
					{ kind: 'element', file: 'model/shop.model.yaml', path: ['elements', 99] },
					'x'
				)
			)
		).toBe(false);
		expect(disk.writes).toHaveLength(0);
		expect(store.notices[0].kind).toBe('error');
	});

	it('on 409 reloads the conflicting file, re-applies the command and clears history', async () => {
		const { store, disk } = await setup();
		await store.execute(moveNodes('shop-containers', [{ id: 'customer', x: 0, y: 0 }]));
		// Someone edits the file in an editor; the change event has not arrived yet.
		disk.write(
			'model/shop.model.yaml',
			disk
				.read('model/shop.model.yaml')
				.replace('Buys products through the web shop', 'Shops online')
		);
		expect(await store.execute(renameEntity(refOf(store, 'storefront'), 'Front'))).toBe(true);
		const text = disk.read('model/shop.model.yaml');
		expect(text).toContain('Shops online');
		expect(text).toContain('name: Front');
		expect(store.model.elements.get('customer')!.def.description).toBe('Shops online');
		expect(store.notices.map((n) => n.text)).toContain(
			'Files changed on disk; "Rename element" was re-applied on top.'
		);
		expect(store.undoStack.map((e) => e.label)).toEqual(['Rename element']);
	});

	it('reports a conflict when the command no longer applies', async () => {
		const { store, disk } = await setup();
		const ref = refOf(store, 'warehouse');
		disk.write(
			'model/shop.model.yaml',
			disk
				.read('model/shop.model.yaml')
				.replace(/ {2}- id: warehouse[\s\S]*?tags: \[partner\]\n/, '')
		);
		expect(await store.execute(renameEntity(ref, 'WH'))).toBe(false);
		expect(store.notices.at(-1)).toMatchObject({ kind: 'conflict' });
		expect(store.model.elements.has('warehouse')).toBe(false);
	});

	it('reverts the optimistic change when the server refuses the write', async () => {
		const { store, disk } = await setup();
		disk.setIntercept(() => ({ status: 422, error: 'nope' }));
		expect(await store.execute(renameEntity(refOf(store, 'customer'), 'X'))).toBe(false);
		expect(store.model.elements.get('customer')!.name).toBe('Customer');
		expect(store.undoStack).toHaveLength(0);
	});

	it('ignores change events for its own writes and applies external ones', async () => {
		const { store, disk } = await setup();
		await store.execute(renameEntity(refOf(store, 'customer'), 'Shopper'));
		const own = disk.read('model/shop.model.yaml');
		await store.onExternalChange({ path: 'model/shop.model.yaml', text: own, hash: sha256(own) });
		expect(store.externalChanges).toBe(0);
		expect(store.undoStack).toHaveLength(1);
		const edited = own.replace('name: Shopper', 'name: Buyer');
		await store.onExternalChange({
			path: 'model/shop.model.yaml',
			text: edited,
			hash: sha256(edited)
		});
		expect(store.model.elements.get('customer')!.name).toBe('Buyer');
		// The history touched this file, so it no longer applies.
		expect(store.undoStack).toHaveLength(0);
	});

	it('keeps the last valid data when a file gets a syntax error, and reports it', async () => {
		const { store } = await setup();
		const broken = 'elements: [\n';
		await store.onExternalChange({
			path: 'model/shop.model.yaml',
			text: broken,
			hash: sha256(broken)
		});
		expect(store.model.elements.has('shop')).toBe(true);
		expect(
			store.diagnostics.some((d) => d.code === 'syntax' && d.file === 'model/shop.model.yaml')
		).toBe(true);
		await store.onExternalChange({
			path: 'model/extra.model.yaml',
			text: 'elements:\n  - { id: x, kind: person }\n',
			hash: 'h1'
		});
		expect(store.model.elements.has('x')).toBe(true);
		await store.onExternalChange({ path: 'model/extra.model.yaml', text: null, hash: null });
		expect(store.model.elements.has('x')).toBe(false);
	});

	it('previews which files a command would touch', async () => {
		const { store } = await setup();
		expect(store.preview(renameEntity(refOf(store, 'customer'), 'X')).files).toEqual([
			'model/shop.model.yaml'
		]);
	});
});
