import { describe, expect, it } from 'vitest';
import { LEAF, layoutLandscape, modelLinks } from '../../src/lib/landscape/layout';
import { textWidth } from '../../src/lib/render/text';
import { loadFixture, loadStrings } from './helpers';

const { model } = loadFixture();
type Box = { absX: number; absY: number; width: number; height: number };
const overlap = (a: Box, b: Box) =>
	a.absX < b.absX + b.width &&
	b.absX < a.absX + a.width &&
	a.absY < b.absY + b.height &&
	b.absY < a.absY + a.height;
const inside = (child: Box, parent: Box) =>
	child.absX >= parent.absX &&
	child.absY >= parent.absY &&
	child.absX + child.width <= parent.absX + parent.width &&
	child.absY + child.height <= parent.absY + parent.height;

describe('landscape layout', () => {
	const boxes = layoutLandscape(model);
	const box = (id: string) => boxes.find((b) => b.id === id)!;

	it('lays out every entity, parents before their children', () => {
		expect(boxes.map((b) => b.id).sort()).toEqual([...model.elements.keys()].sort());
		const index = new Map(boxes.map((b, i) => [b.id, i]));
		for (const b of boxes)
			if (b.parentId) expect(index.get(b.parentId)!).toBeLessThan(index.get(b.id)!);
	});

	it('puts systems in one row in file order and nests children inside their parent', () => {
		expect([box('erp').absY, box('erp').absX < box('webshop').absX]).toEqual([
			box('webshop').absY,
			true
		]);
		expect(overlap(box('erp'), box('webshop'))).toBe(false);
		for (const b of boxes.filter((b) => b.parentId)) {
			const parent = box(b.parentId!);
			expect(inside(b, parent)).toBe(true);
			expect([b.x, b.y]).toEqual([b.absX - parent.absX, b.absY - parent.absY]);
		}
	});

	it('fits each box to its content instead of sharing a size with its siblings', () => {
		const leaves = boxes.filter((b) => !b.group && !b.table);
		for (const b of leaves)
			expect(b.width).toBe(
				Math.max(LEAF.minWidth, textWidth(model.elements.get(b.id)!.name, LEAF.font, true) + 36)
			);
		const sizes = new Set(
			model.elements.get('erp')!.childIds.map((id) => `${box(id).width}x${box(id).height}`)
		);
		expect(sizes.size).toBeGreaterThan(1);
	});

	it('is empty for an empty model', () => {
		expect(layoutLandscape(loadStrings({}).model)).toEqual([]);
	});

	it('draws a referenced model inside the referencing entity too, sized as a table', () => {
		const fields = Array.from(
			{ length: 12 },
			(_, i) => `  - { id: f${i}, name: f${i}, type: int }`
		);
		const boxes = layoutLandscape(
			loadStrings({
				's/s.system.yaml': 'id: s\n',
				's/m.module.yaml': 'id: m\nparent: s\n',
				's/db.module.yaml': 'id: db\nparent: s\nmodels: [a]\n',
				's/a.model.yaml': ['id: a', 'ownedBy: m', 'fields:', ...fields].join('\n')
			}).model
		);
		const owned = boxes.find((b) => b.id === 'a')!;
		const ref = boxes.find((b) => b.id === 'db>a')!;
		expect([owned.parentId, owned.ref]).toEqual(['m', false]);
		expect([ref.parentId, ref.elementId, ref.ref, ref.group]).toEqual(['db', 'a', true, false]);
		expect(owned.height).toBeGreaterThan(12 * 20);
		expect(boxes.find((b) => b.id === 'db')!.group).toBe(true);
	});

	const tables = loadStrings({
		's/s.system.yaml': 'id: s\n',
		's/a.model.yaml': 'id: a\nownedBy: s\nfields: [{ id: a-id, name: id, type: uuid, pk: true }]\n',
		's/b.model.yaml': [
			'id: b',
			'ownedBy: s',
			'fields:',
			...Array.from({ length: 8 }, (_, i) => `  - { id: b${i}, name: f${i}, type: int }`),
			'  - { id: b-a, name: aId, type: uuid, ref: a-id }',
			'  - { id: b-up, name: up, type: uuid, ref: b }'
		].join('\n'),
		's/c.model.yaml': 'id: c\nownedBy: s\nfields: [{ id: c-x, name: x, type: int }]\n',
		's/d.model.yaml': [
			'id: d',
			'ownedBy: s',
			'fields:',
			'  - { id: d-a, name: aId, type: uuid, ref: a }',
			'  - { id: d-c, name: cs, model: c, many: true }'
		].join('\n')
	}).model;

	it('packs a level of tables as a masonry, each table at its own size', () => {
		const boxes = layoutLandscape(tables);
		const box = (id: string) => boxes.find((b) => b.id === id)!;
		// Columns: [a, c, d] and [b]; c and d fill in under the short a.
		expect(box('a').height).toBeLessThan(box('b').height);
		expect([box('c').absX, box('d').absX]).toEqual([box('a').absX, box('a').absX]);
		expect(box('d').absY).toBeGreaterThan(box('c').absY);
		expect(box('a').width).not.toBe(box('c').width);
		const cards = boxes.filter((b) => b.table);
		for (const x of cards) for (const y of cards) if (x !== y) expect(overlap(x, y)).toBe(false);
	});

	it('links field refs to sibling tables, facing each other', () => {
		const links = modelLinks(tables, layoutLandscape(tables));
		expect(links.map((l) => [l.id, l.kind, l.target, l.sourceHandle, l.targetHandle])).toEqual([
			// A ref to a field ends on that field's row; a ref to a model on its name bar.
			['b.b-a', 'ref', 'a', 'out:b-a:l', 'in:a-id:r'],
			['b.b-up', 'ref', 'b', 'out:b-up:r', 'head:r'],
			// Stacked in one column, so joined round the right.
			['d.d-a', 'ref', 'a', 'out:d-a:r', 'head:r'],
			// A held model ends on the held table's name bar.
			['d.d-c', 'model', 'c', 'out:d-c:r', 'head:r']
		]);
	});
});
