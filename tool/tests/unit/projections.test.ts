import { describe, expect, it } from 'vitest';
import { matchPattern, select } from '../../src/lib/model/select';
import { knownLayoutIds, project } from '../../src/lib/projections';
import { backEdges } from '../../src/lib/projections/flow';
import type { RenderGraph, SequenceGraph } from '../../src/lib/projections/types';
import { loadFixture, loadStrings } from './helpers';

const graph = (viewId: string, model = loadFixture().model) =>
	project(model, viewId) as RenderGraph;
const ids = (g: RenderGraph) => g.nodes.map((n) => n.id);
const edgeIds = (g: RenderGraph) => g.edges.map((e) => e.id);

describe('include/exclude patterns', () => {
	const { model } = loadFixture();
	it('resolves ids, children, descendants, globs and tags', () => {
		expect([...matchPattern(model.elements, 'shop.*')]).toEqual([
			'storefront',
			'order-service',
			'order-db',
			'order-events'
		]);
		expect([...matchPattern(model.elements, 'order-service.**')]).toEqual([
			'order-api',
			'order-domain',
			'order-repo'
		]);
		expect([...matchPattern(model.elements, 'shop.**')]).toHaveLength(7);
		expect([...matchPattern(model.elements, 'order-*')].sort()).toEqual([
			'order-api',
			'order-db',
			'order-domain',
			'order-events',
			'order-repo',
			'order-service'
		]);
		expect([...matchPattern(model.elements, 'tag:internal')]).toEqual(['order-repo']);
		expect([...matchPattern(model.elements, '*')]).toEqual([
			'customer',
			'shop',
			'payments',
			'warehouse'
		]);
		expect(matchPattern(model.elements, 'nothing').size).toBe(0);
	});
	it('excluding an entity also hides its descendants and reports unmatched patterns', () => {
		const sel = select(model.elements, ['shop.**'], ['order-service', 'ghost'], []);
		expect([...sel.ids]).toEqual(['storefront', 'order-db', 'order-events']);
		expect(sel.unmatched).toEqual(['ghost']);
	});
});

describe('component projection', () => {
	it('scope + include + depth + exclude + aggregated edges', () => {
		const g = graph('shop-containers');
		expect(ids(g)).toEqual([
			'customer',
			'shop',
			'storefront',
			'order-service',
			'order-db',
			'order-events',
			'payments',
			'warehouse'
		]);
		expect(g.nodes.find((n) => n.id === 'shop')).toMatchObject({ type: 'boundary', isGroup: true });
		expect(g.nodes.find((n) => n.id === 'storefront')!.parentId).toBe('shop');
		// order-service has three components hidden below the depth limit.
		const os = g.nodes.find((n) => n.id === 'order-service')!;
		expect(os.type === 'element' && os.data.hiddenChildren).toBe(3);
		expect(edgeIds(g)).toEqual([
			'customer->shop#0',
			'customer->storefront#0',
			'order-service->payments#0',
			'order-service->order-events#0',
			'order-events->warehouse#0',
			'storefront->order-service#agg',
			'order-service->order-db#agg'
		]);
		const agg = g.edges.find((e) => e.id === 'storefront->order-service#agg')!;
		expect(agg.data).toMatchObject({ count: 1, label: 'Submits orders', dashed: false });
		expect(g.edges.find((e) => e.id === 'order-service->order-events#0')!.data.dashed).toBe(true);
		expect(g.layout).toEqual({
			algorithm: 'layered',
			direction: 'RIGHT',
			spacing: 60,
			lanes: undefined
		});
	});

	it('depth 0 collapses systems into leaves and merges their relationships', () => {
		const g = graph('system-context');
		expect(ids(g)).toEqual(['customer', 'shop', 'payments', 'warehouse']);
		expect(edgeIds(g)).toEqual(['customer->shop#0', 'shop->payments#agg', 'shop->warehouse#agg']);
	});

	it('explicit relationships win over aggregated ones between the same pair', () => {
		const g = graph('system-context');
		// customer->storefront is lifted to customer->shop, which already exists explicitly.
		expect(g.edges.filter((e) => e.source === 'customer')).toHaveLength(1);
	});

	it('collapsed groups (layout file) hide their children', () => {
		const { model } = loadStrings({
			'model/a.model.yaml':
				'elements:\n  - id: s\n    kind: system\n    children:\n      - { id: a, kind: container }\n      - { id: b, kind: container }\n  - { id: x, kind: person }\nrelationships:\n  - { from: x, to: a }\n  - { from: x, to: b, sync: false }\n',
			'views/v.view.yaml': 'views:\n  - { id: v, type: component }\n',
			'layout/v.layout.json':
				'{ "version": 1, "view": "v", "nodes": { "s": { "collapsed": true } } }'
		});
		const g = project(model, 'v') as RenderGraph;
		expect(ids(g)).toEqual(['s', 'x']);
		expect(g.edges).toHaveLength(1);
		expect(g.edges[0]).toMatchObject({
			id: 'x->s#agg',
			type: 'aggregated',
			data: { count: 2, dashed: false }
		});
	});

	it('aggregateEdges: false drops lifted relationships', () => {
		const { model } = loadStrings({
			'model/a.model.yaml':
				'elements:\n  - id: s\n    kind: system\n    children: [ { id: a, kind: container } ]\n  - { id: x, kind: person }\nrelationships:\n  - { from: x, to: a }\n',
			'views/v.view.yaml':
				'views:\n  - { id: v, type: component, depth: 0, aggregateEdges: false }\n'
		});
		expect((project(model, 'v') as RenderGraph).edges).toEqual([]);
	});

	it('parallel relationships get distinct keys', () => {
		const { model } = loadStrings({
			'model/a.model.yaml':
				'elements:\n  - { id: a, kind: system }\n  - { id: b, kind: system }\nrelationships:\n  - { from: a, to: b, label: one }\n  - { from: a, to: b, label: two }\n',
			'views/v.view.yaml': 'views:\n  - { id: v, type: component }\n'
		});
		expect(edgeIds(project(model, 'v') as RenderGraph)).toEqual(['a->b#0', 'a->b#1']);
	});
});

describe('class and object projections', () => {
	it('renders compartments, stereotypes and UML markers', () => {
		const g = graph('order-domain');
		const order = g.nodes.find((n) => n.id === 'order')!;
		expect(order.type === 'class' && order.data.attributes.map((a) => a.text)).toEqual([
			'- id: UUID',
			'+ total: Money',
			'+ status: OrderStatus'
		]);
		expect(order.type === 'class' && order.data.methods.map((a) => a.text)).toEqual([
			'+ addLine(line: OrderLine): void',
			'+ place(): void'
		]);
		const status = g.nodes.find((n) => n.id === 'order-status')!;
		expect(status.type === 'class' && status.data.values).toEqual([
			'draft',
			'placed',
			'paid',
			'shipped',
			'cancelled'
		]);
		const byType = Object.fromEntries(g.edges.map((e) => [e.data.relationType, e.data]));
		expect(byType.composition).toMatchObject({
			markerStart: 'diamond-filled',
			startLabel: '1',
			endLabel: '1..*',
			label: 'lines'
		});
		expect(byType.inheritance).toMatchObject({ markerEnd: 'triangle', dashed: false });
		expect(byType.realization).toMatchObject({ markerEnd: 'triangle', dashed: true });
		expect(byType.dependency).toMatchObject({ markerEnd: 'open-arrow', dashed: true });
		expect(byType.association).toMatchObject({ markerStart: 'none', markerEnd: 'none' });
		expect(g.layout.direction).toBe('UP');
	});

	it('truncates long compartments with "+N more" and honours show toggles', () => {
		const attrs = Array.from({ length: 20 }, (_, i) => `{ name: a${i} }`).join(', ');
		const { model } = loadStrings({
			'model/a.model.yaml': `classes:\n  - { id: big, attributes: [${attrs}], methods: [ { name: m } ] }\n  - { id: other }\n`,
			'views/v.view.yaml': 'views:\n  - { id: v, type: class, show: { methods: false } }\n'
		});
		const g = project(model, 'v') as RenderGraph;
		const big = g.nodes[0];
		expect(
			big.type === 'class' && [
				big.data.attributes.length,
				big.data.more.attributes,
				big.data.showMethods
			]
		).toEqual([11, 9, false]);
		// Unstructured graphs (no edges) stay layered; with only associations it would be stress.
		expect(g.layout.algorithm).toBe('layered');
	});

	it('objects show "name : Class" with slots in attribute order', () => {
		const g = graph('example-order');
		const o = g.nodes.find((n) => n.id === 'order-42')!;
		expect(o.type === 'object' && o.data).toEqual({
			label: 'order42 : Order',
			rows: [
				{ name: 'id', value: 'a1b2' },
				{ name: 'total', value: '99.00 DKK' },
				{ name: 'status', value: 'placed' }
			]
		});
		expect(edgeIds(g)).toEqual(['order-42->line-1#0', 'order-42->line-2#0']);
	});
});

describe('flow, pipeline and sequence projections', () => {
	it('flows: lanes by actor and distinct back-edges', () => {
		const g = graph('checkout-flow');
		expect(g.layout.lanes).toEqual(['lane:unassigned', 'lane:storefront', 'lane:order-service']);
		expect(g.nodes.find((n) => n.id === 'validate')!.parentId).toBe('lane:order-service');
		expect(g.edges.filter((e) => e.data.back).map((e) => e.id)).toEqual(['backorder->submit#0']);
		const pay = g.nodes.find((n) => n.id === 'pay')!;
		expect(pay.type === 'flow' && pay.data).toMatchObject({ flowType: 'subflow', ref: 'payment' });
		expect(
			backEdges({
				id: 'f',
				nodes: [{ id: 'a', type: 'start' }],
				transitions: [{ from: 'a', to: 'a' }]
			})
		).toEqual(new Set([0]));
	});

	it('pipelines: stages as groups, jobs inside, needs and artifact edges', () => {
		const g = graph('ci-pipeline');
		expect(ids(g)).toEqual([
			'trigger',
			'build',
			'compile',
			'lint',
			'test',
			'unit',
			'e2e',
			'deploy',
			'release',
			'bundle'
		]);
		expect(g.nodes.find((n) => n.id === 'unit')!.parentId).toBe('test');
		expect(edgeIds(g)).toEqual([
			'trigger->build#0',
			'build->test#0',
			'unit->e2e#0',
			'test->deploy#0',
			'compile->bundle#0',
			'bundle->e2e#0',
			'bundle->release#0'
		]);
		expect(g.edges.filter((e) => e.type === 'artifact').every((e) => e.data.dashed)).toBe(true);
		const release = g.nodes.find((n) => n.id === 'release')!;
		expect(release.type === 'job' && release.data.status).toBe('pending');
	});

	it('sequence: participants, messages, groups and notes', () => {
		const s = project(loadFixture().model, 'place-order') as SequenceGraph;
		expect(s.participants.map((p) => [p.id, p.kind, p.plain])).toEqual([
			['customer', 'person', false],
			['order-service', 'container', false],
			['payments', 'external', false],
			['order-db', 'datastore', false]
		]);
		expect(s.items.map((i) => i.type)).toEqual([
			'message',
			'message',
			'message',
			'message',
			'group',
			'note'
		]);
		const self = s.items[1];
		expect(self.type === 'message' && self.kind).toBe('self');
		const group = s.items[4];
		expect(group.type === 'group' && group.branches.map((b) => [b.label, b.items.length])).toEqual([
			['charge succeeded', 2],
			['charge failed', 1]
		]);
		expect(group.type === 'group' && group.branches[1].items[0].path).toEqual([
			'steps',
			4,
			'else',
			0,
			'steps',
			0
		]);
	});

	it('missing sources produce a diagnostic, not a crash', () => {
		const { model } = loadStrings({
			'views/v.view.yaml':
				'views:\n  - { id: v, type: pipeline, source: nope }\n  - { id: w, type: sequence, source: nope }\n'
		});
		expect((project(model, 'v') as RenderGraph).diagnostics[0].message).toContain('not found');
		expect((project(model, 'w') as SequenceGraph).diagnostics[0].message).toContain('not found');
		expect(project(model, 'unknown')).toBeUndefined();
	});

	it('knows which layout ids are legitimate per view', () => {
		const { model } = loadFixture();
		expect(knownLayoutIds(model, 'ci-pipeline').has('trigger')).toBe(true);
		expect(knownLayoutIds(model, 'checkout-flow').has('lane:storefront')).toBe(true);
		expect(knownLayoutIds(model, 'place-order')).toEqual(
			new Set(['customer', 'order-service', 'payments', 'order-db'])
		);
	});
});
