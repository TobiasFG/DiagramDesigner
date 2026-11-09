import { describe, expect, it } from 'vitest';
import { createNodeElk } from '../../src/lib/layout/elk-node';
import { layoutGraph, toElkGraph } from '../../src/lib/layout/layout';
import { formatLayout } from '../../src/lib/model/layout-format';
import type { LayoutFile } from '../../src/lib/model/schema';
import { project } from '../../src/lib/projections';
import type { RenderGraph, SequenceGraph } from '../../src/lib/projections/types';
import { layoutSequence } from '../../src/lib/sequence/layout';
import { edgeGeometry, clip, pointAlong } from '../../src/lib/render/edges';
import { loadFixture, loadStrings } from './helpers';

const elk = createNodeElk();
const { model } = loadFixture();
const g = (id: string) => project(model, id) as RenderGraph;
const overlap = (a: { absX: number; absY: number; width: number; height: number }, b: typeof a) =>
	a.absX < b.absX + b.width &&
	b.absX < a.absX + a.width &&
	a.absY < b.absY + b.height &&
	b.absY < a.absY + a.height;

describe('ELK layout', () => {
	it('lays out compound graphs with children inside their groups and routes edges', async () => {
		const pg = await layoutGraph(g('shop-containers'), undefined, elk);
		const shop = pg.nodes.find((n) => n.node.id === 'shop')!;
		for (const child of pg.nodes.filter((n) => n.node.parentId === 'shop')) {
			expect(child.absX).toBeGreaterThanOrEqual(shop.absX);
			expect(child.absX + child.width).toBeLessThanOrEqual(shop.absX + shop.width);
			expect(child.absY + child.height).toBeLessThanOrEqual(shop.absY + shop.height);
			expect(child.absX - shop.absX).toBe(child.x);
		}
		expect(pg.edges.every((e) => e.route && e.route.length >= 2)).toBe(true);
		expect(pg.nodes.every((n) => Number.isInteger(n.x) && Number.isInteger(n.absY))).toBe(true);
	});

	it('is deterministic', async () => {
		const a = await layoutGraph(g('order-domain'), undefined, elk);
		const b = await layoutGraph(g('order-domain'), undefined, elk);
		expect(a.nodes.map((n) => [n.absX, n.absY])).toEqual(b.nodes.map((n) => [n.absX, n.absY]));
	});

	it('keeps pinned nodes exactly where the layout file says and moves others off them', async () => {
		const base = await layoutGraph(g('system-context'), undefined, elk);
		const payments = base.nodes.find((n) => n.node.id === 'payments')!;
		const layout: LayoutFile = {
			version: 1,
			view: 'system-context',
			nodes: { customer: { x: payments.absX, y: payments.absY, pinned: true } }
		};
		const pg = await layoutGraph(g('system-context'), layout, elk);
		const customer = pg.nodes.find((n) => n.node.id === 'customer')!;
		expect([customer.absX, customer.absY, customer.pinned]).toEqual([
			payments.absX,
			payments.absY,
			true
		]);
		const others = pg.nodes.filter((n) => n !== customer);
		expect(others.some((n) => overlap(n, customer))).toBe(false);
		// Edges touching a moved node lose their ELK route and are drawn floating.
		expect(pg.edges.find((e) => e.edge.id === 'customer->shop#0')!.route).toBeUndefined();
	});

	it('grows groups to contain pinned children and applies stored sizes', async () => {
		const layout: LayoutFile = {
			version: 1,
			view: 'shop-containers',
			nodes: {
				storefront: { x: 900, y: 500, pinned: true },
				customer: { x: 0, y: 0, w: 300, h: 200, pinned: true }
			}
		};
		const pg = await layoutGraph(g('shop-containers'), layout, elk);
		const shop = pg.nodes.find((n) => n.node.id === 'shop')!;
		const sf = pg.nodes.find((n) => n.node.id === 'storefront')!;
		expect(sf.x).toBe(900);
		expect(shop.width).toBeGreaterThanOrEqual(900 + sf.width);
		expect(pg.nodes.find((n) => n.node.id === 'customer')).toMatchObject({
			width: 300,
			height: 200
		});
	});

	it('uses manual bend points from the layout file', async () => {
		const layout: LayoutFile = {
			version: 1,
			view: 'system-context',
			edges: { 'customer->shop#0': { points: [[500, 500]], labelPos: 0.25 } }
		};
		const pg = await layoutGraph(g('system-context'), layout, elk);
		expect(pg.edges[0]).toMatchObject({ points: [[500, 500]], labelPos: 0.25 });
	});

	it('arranges swimlanes as columns holding their nodes', async () => {
		const pg = await layoutGraph(g('checkout-flow'), undefined, elk);
		const lanes = pg.nodes.filter((n) => n.node.type === 'lane');
		expect(lanes.map((l) => l.node.id)).toEqual([
			'lane:unassigned',
			'lane:storefront',
			'lane:order-service'
		]);
		for (let i = 1; i < lanes.length; i++)
			expect(lanes[i].absX).toBe(lanes[i - 1].absX + lanes[i - 1].width);
		for (const n of pg.nodes.filter((n) => n.node.parentId)) {
			const lane = lanes.find((l) => l.node.id === n.node.parentId)!;
			expect(n.absX).toBeGreaterThanOrEqual(lane.absX);
			expect(n.absX + n.width).toBeLessThanOrEqual(lane.absX + lane.width);
		}
		// Top-down: start above validate above done.
		const y = (id: string) => pg.nodes.find((n) => n.node.id === id)!.absY;
		expect(y('start')).toBeLessThan(y('validate'));
		expect(y('validate')).toBeLessThan(y('done'));
	});

	it('lays composition parts below their whole', () => {
		const elkGraph = toElkGraph(g('order-domain'), undefined);
		expect(elkGraph.edges!.find((e) => e.id === 'order->order-line#0')).toMatchObject({
			sources: ['order-line'],
			targets: ['order']
		});
	});

	it('meets the performance target with nested groups too', async () => {
		const systems = Array.from(
			{ length: 20 },
			(_, s) =>
				`  - id: s${s}\n    kind: system\n    children:\n${Array.from({ length: 9 }, (_, i) => `      - { id: c${s}-${i}, kind: container }`).join('\n')}`
		).join('\n');
		const rels = Array.from(
			{ length: 400 },
			(_, i) => `  - { from: c${i % 20}-${i % 9}, to: c${(i * 7 + 3) % 20}-${(i * 5 + 1) % 9} }`
		)
			.filter((l) => !/from: (c[\d-]+), to: \1 /.test(l))
			.join('\n');
		const big = loadStrings({
			'model/a.model.yaml': `elements:\n${systems}\nrelationships:\n${rels}\n`,
			'views/v.view.yaml': 'views:\n  - { id: v, type: component }\n'
		});
		const graph = project(big.model, 'v') as RenderGraph;
		expect(graph.nodes).toHaveLength(200);
		await layoutGraph(graph, undefined, elk);
		const t = performance.now();
		await layoutGraph(graph, undefined, elk);
		expect(performance.now() - t).toBeLessThan(1000);
	}, 20_000);

	it('meets the performance target: 200 nodes and 400 edges in under a second', async () => {
		const elements = Array.from(
			{ length: 200 },
			(_, i) => `  - { id: n${i}, kind: container, name: Node ${i} }`
		).join('\n');
		const rels = Array.from(
			{ length: 400 },
			(_, i) => `  - { from: n${i % 200}, to: n${(i * 7 + 13) % 200}, label: r${i} }`
		)
			.filter((l) => !/from: (n\d+), to: \1,/.test(l))
			.join('\n');
		const big = loadStrings({
			'model/a.model.yaml': `elements:\n${elements}\nrelationships:\n${rels}\n`,
			'views/v.view.yaml': 'views:\n  - { id: v, type: component }\n'
		});
		const graph = project(big.model, 'v') as RenderGraph;
		expect(graph.nodes).toHaveLength(200);
		expect(graph.edges.length).toBeGreaterThan(390);
		await layoutGraph(graph, undefined, elk); // warm up the JIT
		const t = performance.now();
		const pg = await layoutGraph(graph, undefined, elk);
		const ms = performance.now() - t;
		expect(pg.nodes).toHaveLength(200);
		expect(ms).toBeLessThan(1000);
	}, 20_000);
});

describe('sequence layout', () => {
	const s = project(model, 'place-order') as SequenceGraph;

	it('places columns by cumulative width and rows top to bottom', () => {
		const l = layoutSequence(s);
		const xs = l.columns.map((c) => c.x);
		expect(xs).toEqual([...xs].sort((a, b) => a - b));
		const ys = l.messages.map((m) => m.y);
		expect(ys).toEqual([...ys].sort((a, b) => a - b));
		expect(l.messages[1].self).toBe(true);
		expect(l.fragments).toHaveLength(1);
		expect(l.fragments[0].branches.map((b) => b.label)).toEqual([
			'charge succeeded',
			'charge failed'
		]);
		expect(l.notes[0].lines).toEqual(['Stored in one transaction']);
	});

	it('draws activation bars from activate to the matching return', () => {
		const l = layoutSequence(s);
		expect(l.activations).toHaveLength(1);
		const [a] = l.activations;
		expect(a.participant).toBe('payments');
		expect([a.y1, a.y2, a.unbalanced]).toEqual([l.messages[2].y, l.messages[3].y, false]);
	});

	it('honours column widths from the layout file', () => {
		const wide = layoutSequence({ ...s, columns: { customer: 400 } });
		expect(wide.columns[0].width).toBe(400);
		expect(wide.columns[1].x - wide.columns[0].x).toBeGreaterThan(
			layoutSequence(s).columns[1].x - layoutSequence(s).columns[0].x
		);
	});

	it('offers insertion slots before, between and after steps at every nesting level', () => {
		const l = layoutSequence(s);
		expect(l.slots.filter((x) => x.list.length === 1).map((x) => x.index)).toEqual([
			0, 1, 2, 3, 4, 5, 6
		]);
		expect(l.slots.some((x) => JSON.stringify(x.list) === '["steps",4,"else",0,"steps"]')).toBe(
			true
		);
	});

	it('meets the performance target: 150 steps in under 200 ms', () => {
		const steps = Array.from(
			{ length: 150 },
			(_, i) => `      - { from: p${i % 5}, to: p${(i + 1) % 5}, msg: call${i}() }`
		).join('\n');
		const big = loadStrings({
			'model/a.model.yaml': `interactions:\n  - id: i\n    participants: [p0, p1, p2, p3, p4]\n    steps:\n${steps}\n`
		});
		const graph = project(big.model, 'i') as SequenceGraph;
		const t = performance.now();
		const l = layoutSequence(graph);
		expect(performance.now() - t).toBeLessThan(200);
		expect(l.messages).toHaveLength(150);
	});
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
