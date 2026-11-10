import { describe, expect, it } from 'vitest';
import { matchPattern, select } from '../../src/lib/model/select';
import { knownLayoutIds, project } from '../../src/lib/projections';
import type { RenderGraph } from '../../src/lib/projections/types';
import { loadFixture, loadStrings } from './helpers';

const { model } = loadFixture();
const graph = (viewId: string, m = model) => project(m, viewId) as RenderGraph;
const ids = (g: RenderGraph) => g.nodes.map((n) => n.id);

describe('include/exclude patterns', () => {
	it('resolves ids, children, descendants, globs and tags', () => {
		expect([...matchPattern(model.elements, 'erp.*')]).toEqual([
			'inventory',
			'order-api',
			'orders'
		]);
		expect([...matchPattern(model.elements, 'orders.**')]).toEqual(['order', 'place']);
		expect([...matchPattern(model.elements, 'order*')].sort()).toEqual([
			'order',
			'order-api',
			'orders'
		]);
		expect([...matchPattern(model.elements, 'tag:internal')]).toEqual(['inventory']);
		expect([...matchPattern(model.elements, '*')]).toEqual(['erp', 'webshop']);
		expect(matchPattern(model.elements, '**').size).toBe(9);
		expect(matchPattern(model.elements, 'nothing').size).toBe(0);
	});

	it('excluding an entity also hides its descendants and reports unmatched patterns', () => {
		const sel = select(model.elements, ['erp.**'], ['orders', 'ghost'], []);
		expect([...sel.ids]).toEqual(['inventory', 'order-api']);
		expect(sel.unmatched).toEqual(['ghost']);
	});
});

describe('component projection', () => {
	it('depth 0 shows only the systems', () => {
		const g = graph('landscape');
		expect(ids(g)).toEqual(['erp', 'webshop']);
		expect(g.nodes.every((n) => n.type === 'element' && !n.parentId)).toBe(true);
		const erp = g.nodes[0];
		expect(erp.type === 'element' && erp.data).toEqual({
			kind: 'system',
			label: 'ERP',
			hiddenChildren: 3
		});
		expect(g.edges).toEqual([]);
	});

	it('scope + exclude + depth draws the scope as a boundary around its children', () => {
		const g = graph('erp-modules');
		expect(ids(g)).toEqual(['erp', 'order-api', 'orders']);
		expect(g.nodes[0]).toMatchObject({ type: 'boundary', isGroup: true });
		expect(g.nodes.slice(1).every((n) => n.parentId === 'erp')).toBe(true);
		const orders = g.nodes.find((n) => n.id === 'orders')!;
		expect(orders.type === 'element' && orders.data).toMatchObject({
			hiddenChildren: 1
		});
		expect(g.layout).toMatchObject({ algorithm: 'layered', direction: 'RIGHT' });
	});

	it('shows the whole tree without depth, and collapsed groups hide their children', () => {
		const files = {
			's/s.system.yaml': 'id: s\n',
			's/a.module.yaml': 'id: a\nparent: s\n',
			's/b.module.yaml': 'id: b\nparent: s\n',
			'views/v.view.yaml': 'views:\n  - { id: v, type: component }\n'
		};
		expect(ids(graph('v', loadStrings(files).model))).toEqual(['s', 'a', 'b']);
		const collapsed = loadStrings({
			...files,
			'layout/v.layout.json':
				'{ "version": 1, "view": "v", "nodes": { "s": { "collapsed": true } } }'
		}).model;
		const g = graph('v', collapsed);
		expect(ids(g)).toEqual(['s']);
		expect(g.nodes[0].type === 'element' && g.nodes[0].data.hiddenChildren).toBe(2);
	});

	it('returns undefined for unknown views', () => {
		expect(project(model, 'unknown')).toBeUndefined();
	});

	it('allows every entity id in a component layout file', () => {
		expect(knownLayoutIds(model, 'landscape')).toEqual(new Set(model.elements.keys()));
		expect(knownLayoutIds(model, 'unknown').size).toBe(0);
	});
});
