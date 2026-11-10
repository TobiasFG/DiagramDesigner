import { describe, expect, it } from 'vitest';
import { LEAF, layoutLandscape, modelLinks } from '../../src/lib/landscape/layout';
import { textWidth } from '../../src/lib/render/text';
import { createNodeElk } from '../../src/lib/layout/elk-node';
import { layoutGraph } from '../../src/lib/layout/layout';
import { formatLayout } from '../../src/lib/model/layout-format';
import type { LayoutFile } from '../../src/lib/model/schema';
import { project } from '../../src/lib/projections';
import type { RenderGraph } from '../../src/lib/projections/types';
import { edgeGeometry, clip, pointAlong } from '../../src/lib/render/edges';
import { loadFixture, loadStrings } from './helpers';

const elk = createNodeElk();
const { model } = loadFixture();
const g = (id: string) => project(model, id) as RenderGraph;
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
		const fields = Array.from({ length: 12 }, (_, i) => `  - { name: f${i}, type: int }`);
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
		's/a.model.yaml': 'id: a\nownedBy: s\nfields: [{ name: id, type: uuid, pk: true }]\n',
		's/b.model.yaml': [
			'id: b',
			'ownedBy: s',
			'fields:',
			...Array.from({ length: 8 }, (_, i) => `  - { name: f${i}, type: int }`),
			'  - { name: aId, type: uuid, ref: a }',
			'  - { name: up, type: uuid, ref: b }'
		].join('\n'),
		's/c.model.yaml': 'id: c\nownedBy: s\nfields: [{ name: x, type: int }]\n',
		's/d.model.yaml': 'id: d\nownedBy: s\nfields: [{ name: aId, type: uuid, ref: a }]\n'
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
		expect(links.map((l) => [l.id, l.target, l.sourceHandle, l.targetHandle])).toEqual([
			['b.aId', 'a', 'aId:l', 'head:r'],
			['b.up', 'b', 'up:r', 'head:r'],
			// Stacked in one column, so joined round the right.
			['d.aId', 'a', 'aId:r', 'head:r']
		]);
	});
});

describe('ELK layout', () => {
	it('lays out compound graphs with children inside their groups', async () => {
		const pg = await layoutGraph(g('erp-modules'), undefined, elk);
		const erp = pg.nodes.find((n) => n.node.id === 'erp')!;
		const children = pg.nodes.filter((n) => n.node.parentId === 'erp');
		expect(children).toHaveLength(2);
		for (const child of children) {
			expect(inside(child, erp)).toBe(true);
			expect(child.absX - erp.absX).toBe(child.x);
		}
		expect(pg.nodes.every((n) => Number.isInteger(n.x) && Number.isInteger(n.absY))).toBe(true);
	});

	it('is deterministic', async () => {
		const a = await layoutGraph(g('erp-modules'), undefined, elk);
		const b = await layoutGraph(g('erp-modules'), undefined, elk);
		expect(a.nodes.map((n) => [n.absX, n.absY])).toEqual(b.nodes.map((n) => [n.absX, n.absY]));
	});

	it('keeps pinned nodes exactly where the layout file says and moves others off them', async () => {
		const base = await layoutGraph(g('landscape'), undefined, elk);
		const webshop = base.nodes.find((n) => n.node.id === 'webshop')!;
		const layout: LayoutFile = {
			version: 1,
			view: 'landscape',
			nodes: { erp: { x: webshop.absX, y: webshop.absY, pinned: true } }
		};
		const pg = await layoutGraph(g('landscape'), layout, elk);
		const erp = pg.nodes.find((n) => n.node.id === 'erp')!;
		expect([erp.absX, erp.absY, erp.pinned]).toEqual([webshop.absX, webshop.absY, true]);
		expect(pg.nodes.some((n) => n !== erp && overlap(n, erp))).toBe(false);
	});

	it('grows groups to contain pinned children and applies stored sizes', async () => {
		const layout: LayoutFile = {
			version: 1,
			view: 'erp-modules',
			nodes: {
				orders: { x: 900, y: 500, pinned: true },
				'order-api': { w: 300, h: 200 }
			}
		};
		const pg = await layoutGraph(g('erp-modules'), layout, elk);
		const erp = pg.nodes.find((n) => n.node.id === 'erp')!;
		const orders = pg.nodes.find((n) => n.node.id === 'orders')!;
		expect(orders.x).toBe(900);
		expect(erp.width).toBeGreaterThanOrEqual(900 + orders.width);
		expect(pg.nodes.find((n) => n.node.id === 'order-api')).toMatchObject({
			width: 300,
			height: 200
		});
	});

	it('meets the performance target: 200 nested nodes in under a second', async () => {
		const files: Record<string, string> = {
			'views/v.view.yaml': 'views:\n  - { id: v, type: component }\n'
		};
		for (let s = 0; s < 20; s++) {
			files[`s${s}/s${s}.system.yaml`] = `id: s${s}\n`;
			for (let i = 0; i < 9; i++)
				files[`s${s}/m${i}.module.yaml`] = `id: m${s}-${i}\nparent: s${s}\n`;
		}
		const graph = project(loadStrings(files).model, 'v') as RenderGraph;
		expect(graph.nodes).toHaveLength(200);
		await layoutGraph(graph, undefined, elk); // warm up the JIT
		const t = performance.now();
		await layoutGraph(graph, undefined, elk);
		expect(performance.now() - t).toBeLessThan(1000);
	}, 20_000);
});

describe('edge geometry', () => {
	const a = { x: 0, y: 0, width: 100, height: 50 };
	const b = { x: 300, y: 0, width: 100, height: 50 };

	it('clips floating edges at the node outline', () => {
		expect(clip(a, [300, 25])).toEqual([100, 25]);
		expect(clip({ ...a, outline: 'diamond' }, [50, 200])).toEqual([50, 50]);
		const geom = edgeGeometry({ source: a, target: b });
		expect(geom.points).toEqual([
			[100, 25],
			[300, 25]
		]);
		expect(geom.label).toEqual([200, 25]);
	});

	it('uses the ELK route only while both ends are where ELK put them', () => {
		const route: [number, number][] = [
			[100, 25],
			[200, 25],
			[200, 30],
			[300, 30]
		];
		expect(
			edgeGeometry({ source: a, target: b, route, routeBoxes: { source: a, target: b } }).points
		).toBe(route);
		expect(
			edgeGeometry({
				source: { ...a, x: 10 },
				target: b,
				route,
				routeBoxes: { source: a, target: b }
			}).points
		).not.toBe(route);
	});

	it('spreads parallel edges and loops self edges', () => {
		const one = edgeGeometry({ source: a, target: b, parallel: { index: 0, count: 2 } });
		const two = edgeGeometry({ source: a, target: b, parallel: { index: 1, count: 2 } });
		expect(one.d).toContain('Q');
		expect(one.label[1]).not.toBe(two.label[1]);
		expect(edgeGeometry({ source: a, target: a }).d).toContain('C');
	});

	it('finds points along a polyline', () => {
		expect(
			pointAlong(
				[
					[0, 0],
					[10, 0],
					[10, 10]
				],
				0.75
			)
		).toEqual([10, 5]);
	});
});

describe('layout file format', () => {
	it('is stable: fixed key order, sorted entries, one line per entry', () => {
		const text = formatLayout({
			version: 1,
			view: 'v',
			nodes: { b: { pinned: true, y: 2, x: 1 }, a: { x: 5, y: 6, w: 10, h: 20, pinned: true } },
			edges: {
				'a->b#0': {
					labelPos: 0.5,
					points: [
						[1, 2],
						[3, 4]
					]
				}
			}
		});
		expect(text).toBe(
			[
				'{',
				'  "version": 1,',
				'  "view": "v",',
				'  "nodes": {',
				'    "a": { "x": 5, "y": 6, "w": 10, "h": 20, "pinned": true },',
				'    "b": { "x": 1, "y": 2, "pinned": true }',
				'  },',
				'  "edges": {',
				'    "a->b#0": { "points": [[1, 2], [3, 4]], "labelPos": 0.5 }',
				'  }',
				'}',
				''
			].join('\n')
		);
		expect(JSON.parse(text).nodes.a.w).toBe(10);
	});
});
