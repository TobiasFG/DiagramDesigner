import { describe, expect, it } from 'vitest';
import {
	focusLinks,
	LEAF,
	layoutLandscape,
	modelLinks,
	relationsOf
} from '../../src/lib/landscape/layout';
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

	it('draws a model as a class where owned and a table where stored', () => {
		const m = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/m.module.yaml': 'id: m\nparent: s\n',
			's/db.module.yaml': 'id: db\nparent: s\n',
			's/o.model.yaml': [
				'id: o',
				'ownedBy: m',
				'storedIn: db',
				'fields:',
				'  - { id: o-id, name: id, type: uuid, pk: true }',
				'  - { id: o-ls, name: lines, model: l, many: true }',
				'  - { id: o-n, name: count, type: int, stored: false }'
			].join('\n'),
			's/l.model.yaml': [
				'id: l',
				'ownedBy: m',
				'storedIn: db',
				'fields:',
				'  - { id: l-o, name: orderId, type: uuid, ref: o-id }',
				'  - { id: l-q, name: qty, type: int }'
			].join('\n'),
			's/t.model.yaml':
				'id: t\nownedBy: db\nstoredIn: db\nfields: [{ id: t-x, name: x, type: int }]\n'
		}).model;
		const boxes = layoutLandscape(m);
		const box = (id: string) => boxes.find((b) => b.id === id)!;
		const names = (id: string) => box(id).fields!.map((f) => f.name);
		// The owner shows one boundary round the holder and the part it alone holds.
		expect(boxes.filter((b) => b.parentId === 'm').map((b) => b.id)).toEqual(['o#parts']);
		expect(box('o#parts')).toMatchObject({ boundary: true, group: true, elementId: 'o' });
		expect([box('o').view, box('l').view, box('l').parentId]).toEqual([
			'class',
			'class',
			'o#parts'
		]);
		expect([names('o'), names('l')]).toEqual([['id', 'lines', 'count'], ['qty']]);
		// The store shows both as tables, plus the table it owns, drawn once.
		expect([box('db>o').view, names('db>o'), names('db>l')]).toEqual([
			'table',
			['id'],
			['orderId', 'qty']
		]);
		expect([box('t').view, boxes.filter((b) => b.elementId === 't').length]).toEqual(['table', 1]);
		expect(modelLinks(m, boxes).map((l) => [l.id, l.kind])).toEqual([
			['db>l.l-o', 'ref'],
			['o.o-ls', 'model']
		]);
	});

	it('leaves a model held from several places out of any boundary', () => {
		const m = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/a.model.yaml': 'id: a\nownedBy: s\nfields: [{ id: a-x, name: x, model: x }]\n',
			's/b.model.yaml': 'id: b\nownedBy: s\nfields: [{ id: b-x, name: x, model: x }]\n',
			's/x.model.yaml': 'id: x\nownedBy: s\n'
		}).model;
		expect(
			layoutLandscape(m)
				.filter((b) => b.parentId === 's')
				.map((b) => b.id)
		).toEqual(['a', 'b', 'x']);
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
			'  - { id: b-up, name: up, type: uuid, ref: b }',
			// c is held from two places, so it stays out of a boundary.
			'  - { id: b-c, name: c, model: c }'
		].join('\n'),
		's/c.model.yaml': 'id: c\nownedBy: s\nfields: [{ id: c-x, name: amount, type: decimal }]\n',
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

	it('links field refs to sibling cards, facing each other', () => {
		const links = modelLinks(tables, layoutLandscape(tables));
		expect(links.map((l) => [l.id, l.kind, l.target, l.sourceHandle, l.targetHandle])).toEqual([
			// A ref to a field ends on that field's row; a ref to a model on its name bar.
			['b.b-a', 'ref', 'a', 'out:b-a:l', 'in:a-id:r'],
			['b.b-up', 'ref', 'b', 'out:b-up:r', 'head:r'],
			// A held model ends on the held card's name bar.
			['b.b-c', 'model', 'c', 'out:b-c:l', 'head:r'],
			// Stacked in one column, so joined round the right.
			['d.d-a', 'ref', 'a', 'out:d-a:r', 'head:r'],
			['d.d-c', 'model', 'c', 'out:d-c:r', 'head:r']
		]);
	});

	const lineage = loadStrings({
		's/s.system.yaml': 'id: s\n',
		's/db.module.yaml': 'id: db\nparent: s\n',
		's/api.module.yaml': 'id: api\nparent: s\n',
		's/src.model.yaml':
			'id: src\nownedBy: db\nstoredIn: db\nfields: [{ id: src-id, name: id, type: uuid, pk: true }, { id: src-n, name: n, type: int }]\n',
		's/copy.model.yaml': [
			'id: copy',
			'ownedBy: db',
			'storedIn: db',
			'fields:',
			'  - { id: copy-id, name: id, type: uuid, ref: src-id }',
			'  - { id: copy-n, name: n, type: int, from: [src-n] }',
			'  - { id: copy-twice, name: twice, type: int, from: [copy-n], derived: n * 2 }'
		].join('\n'),
		's/dto.model.yaml':
			'id: dto\nownedBy: api\nfields: [{ id: dto-n, name: n, type: int, from: [src-n] }]\n'
	}).model;

	it('replaces the reference and source columns with a link strip', () => {
		const boxes = layoutLandscape(lineage);
		const cols = (id: string) => boxes.find((b) => b.id === id)!.table!;
		expect(cols('copy').map((c) => c.key)).toEqual([
			'name',
			'type',
			'required',
			'nullable',
			'links'
		]);
		expect(cols('copy').at(-1)!.slots).toEqual(['ref', 'from', 'inFrom']);
		expect(cols('src').at(-1)!.slots).toEqual(['inRef', 'inFrom']);
	});

	it('indexes field links both ways', () => {
		const rels = relationsOf(lineage);
		expect(rels.out.get('copy-n')).toEqual([{ kind: 'from', field: 'copy-n', to: 'src-n' }]);
		expect(rels.in.get('src-n')!.map((l) => l.field)).toEqual(['copy-n', 'dto-n']);
	});

	it('draws lineage between sibling cards, but not inside one card', () => {
		const links = modelLinks(lineage, layoutLandscape(lineage));
		expect(links.map((l) => [l.id, l.kind, l.target])).toEqual([
			['copy.copy-id', 'ref', 'src'],
			['copy.copy-n.src-n', 'from', 'src']
		]);
	});

	it('draws the links of a focused field across boxes, both ways', () => {
		const boxes = layoutLandscape(lineage);
		const links = focusLinks(lineage, relationsOf(lineage), boxes, 'src', 'src-n');
		expect(links.map((l) => [l.source, l.sourceField, l.target, l.targetField])).toEqual([
			['copy', 'copy-n', 'src', 'src-n'],
			['dto', 'dto-n', 'src', 'src-n']
		]);
		expect(links[1].parentId).toBe('api');
	});
});
