import { applyPatches } from 'immer';
import { describe, expect, it } from 'vitest';
import {
	cleanValue,
	readAt,
	uniqueId,
	type Command,
	type DesignData
} from '../../src/lib/commands/core';
import { deleteEntity, deleteMany } from '../../src/lib/commands/delete';
import {
	alignMoves,
	distributeMoves,
	moveNodes,
	resetLayout,
	resizeNode,
	setCollapsed,
	setColumnWidth,
	setEdgePoints,
	unpinNode
} from '../../src/lib/commands/layout';
import {
	addClass,
	addClassRelation,
	addElement,
	addFlowNode,
	addJob,
	addMember,
	addNeeds,
	addObject,
	addObjectLink,
	addRelationship,
	addStage,
	addTransition,
	moveJob,
	moveMember,
	parseAttribute,
	parseMethod,
	patchEntity,
	removeFromView,
	removeMember,
	removeNeeds,
	renameEntity,
	reparentElement,
	setEntity,
	setFlowNodeActor,
	setSlot,
	updateMember
} from '../../src/lib/commands/model';
import {
	addParticipant,
	insertStep,
	moveParticipant,
	moveStep,
	removeParticipant,
	removeStep,
	wrapSteps
} from '../../src/lib/commands/sequence';
import { applyCommand, patchesByFile } from '../../src/lib/commands/runner';
import { buildModel } from '../../src/lib/model/model';
import { ctxFor, loadFixture } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function run(cmd: Command, data?: DesignData) {
	const base = data ?? loadFixture().data;
	const model = buildModel(base);
	const ctx = ctxFor(base, model);
	const applied = applyCommand(base, cmd, ctx);
	// Every command is undoable: the inverse patches restore the original data.
	expect(applyPatches(applied.next, applied.inverse)).toEqual(base);
	return {
		...applied,
		before: base,
		after: applied.next as Record<string, Any>,
		notices: ctx.notices,
		model: buildModel(applied.next)
	};
}

const SHOP = 'model/shop.model.yaml';
const DOMAIN = 'model/domain.model.yaml';
const VIEWS = 'views/views.view.yaml';
const INTER = 'model/interactions.model.yaml';

describe('layout commands', () => {
	it('moves pin nodes and snap to the grid', () => {
		const { after, patches } = run(
			moveNodes('shop-containers', [{ id: 'customer', x: 13, y: 27 }])
		);
		expect(after['layout/shop-containers.layout.json']).toEqual({
			version: 1,
			view: 'shop-containers',
			nodes: { customer: { x: 10, y: 30, pinned: true } },
			edges: {}
		});
		expect([...patchesByFile(patches).keys()]).toEqual(['layout/shop-containers.layout.json']);
	});

	it('drops stale layout entries and reports them once', () => {
		const data = {
			...loadFixture().data,
			'layout/shop-containers.layout.json': {
				version: 1,
				view: 'shop-containers',
				nodes: { ghost: { x: 1, y: 1 } },
				edges: { 'ghost->shop#0': {} }
			}
		};
		const { after, notices } = run(
			moveNodes('shop-containers', [{ id: 'customer', x: 0, y: 0 }]),
			data
		);
		expect(Object.keys(after['layout/shop-containers.layout.json'].nodes)).toEqual(['customer']);
		expect(after['layout/shop-containers.layout.json'].edges).toEqual({});
		expect(notices).toEqual(['Dropped layout entries for removed items: ghost, ghost->shop#0']);
	});

	it('resize, unpin, collapse, bend, columns and reset', () => {
		let data = run(
			resizeNode('shop-containers', 'shop', { x: 0, y: 0, width: 401, height: 299 })
		).after;
		expect(data['layout/shop-containers.layout.json'].nodes.shop).toEqual({
			x: 0,
			y: 0,
			w: 400,
			h: 300,
			pinned: true
		});
		data = run(setCollapsed('shop-containers', 'shop', true), data).after;
		expect(data['layout/shop-containers.layout.json'].nodes.shop).toEqual({
			x: 0,
			y: 0,
			pinned: true,
			collapsed: true
		});
		data = run(unpinNode('shop-containers', 'shop'), data).after;
		expect(data['layout/shop-containers.layout.json'].nodes.shop).toEqual({ collapsed: true });
		data = run(setEdgePoints('shop-containers', 'customer->shop#0', [[1.4, 2.6]]), data).after;
		expect(data['layout/shop-containers.layout.json'].edges['customer->shop#0']).toEqual({
			points: [[1, 3]]
		});
		data = run(setColumnWidth('place-order', 'customer', 250), data).after;
		expect(data['layout/place-order.layout.json'].columns).toEqual({ customer: 250 });
		data = run(resetLayout('shop-containers'), data).after;
		expect(data['layout/shop-containers.layout.json']).toBeUndefined();
	});

	it('aligns and distributes in absolute coordinates, returning parent-relative moves', () => {
		const boxes = [
			{ id: 'a', absX: 0, absY: 0, width: 10, height: 10, parentX: 0, parentY: 0 },
			{ id: 'b', absX: 50, absY: 20, width: 10, height: 30, parentX: 40, parentY: 0 },
			{ id: 'c', absX: 200, absY: 5, width: 10, height: 10, parentX: 0, parentY: 0 }
		];
		expect(alignMoves(boxes, 'left').map((m) => m.x)).toEqual([0, -40, 0]);
		expect(alignMoves(boxes, 'bottom').map((m) => m.y)).toEqual([40, 20, 40]);
		expect(distributeMoves(boxes, 'horizontal').map((m) => m.x)).toEqual([0, 100 - 40, 200]);
	});
});

describe('model commands', () => {
	it('renames and patches entities; empty values remove the field', () => {
		const { model } = loadFixture();
		const ref = { kind: 'element' as const, ...model.elements.get('storefront')!.loc };
		const { after } = run(renameEntity(ref, 'Web Front'));
		expect(readAt(after, SHOP, [...ref.path, 'name'])).toBe('Web Front');
		const cleared = run(patchEntity(ref, { technology: '', description: undefined })).after;
		expect(readAt(cleared, SHOP, ref.path)).toEqual({
			id: 'storefront',
			kind: 'container',
			name: 'Storefront'
		});
		const rel = { kind: 'relationship' as const, ...model.relationships[0].loc };
		expect(readAt(run(renameEntity(rel, 'Buys')).after, SHOP, [...rel.path, 'label'])).toBe('Buys');
	});

	it('rejects edits that introduce schema errors, naming the field', () => {
		const { model, data } = loadFixture();
		const ref = { kind: 'element' as const, ...model.elements.get('storefront')!.loc };
		expect(() =>
			applyCommand(data, patchEntity(ref, { kind: 'spaceship' }), ctxFor(data, model))
		).toThrow(/elements\[1\]\.children\[0\]\.kind/);
	});

	it('adds elements into a parent, into the view include list, and pins them', () => {
		const { after, model } = run(
			addElement({
				kind: 'container',
				parentId: 'shop',
				viewId: 'system-context',
				position: { x: 42, y: 17 }
			})
		);
		expect(model.elements.get('new-container')).toMatchObject({ parentId: 'shop' });
		// system-context lists its elements explicitly, so the new one is added to include.
		expect(readAt(after, VIEWS, ['views', 0, 'include'])).toEqual([
			'customer',
			'shop',
			'payments',
			'warehouse',
			'new-container'
		]);
		expect(after['layout/system-context.layout.json'].nodes['new-container']).toEqual({
			x: 40,
			y: 20,
			pinned: true
		});
		// shop-containers already includes "shop.*": no include change.
		const other = run(
			addElement({ kind: 'container', parentId: 'shop', viewId: 'shop-containers' })
		).after;
		expect(readAt(other, VIEWS, ['views', 1, 'include'])).toEqual([
			'shop.*',
			'customer',
			'payments',
			'warehouse'
		]);
		// Top-level entities go to the default model file.
		expect(run(addElement({ kind: 'person' })).after['model/model.model.yaml']).toEqual({
			elements: [{ id: 'new-person', kind: 'person', name: 'New Person' }]
		});
	});

	it('adds relationships to the file of their source', () => {
		const { after } = run(addRelationship('warehouse', 'shop'));
		expect(after[SHOP].relationships.at(-1)).toEqual({ from: 'warehouse', to: 'shop' });
		const { model, data } = loadFixture();
		expect(() => applyCommand(data, addRelationship('shop', 'nope'), ctxFor(data, model))).toThrow(
			'unknown element "nope"'
		);
	});

	it('reparents elements, keeping the moved subtree and cleaning empty parents', () => {
		const { model, after } = run(
			reparentElement('order-api', 'shop', 'shop-containers', { x: 5, y: 5 })
		);
		expect(model.elements.get('order-api')!.parentId).toBe('shop');
		const top = run(reparentElement('order-events', undefined)).model;
		expect(top.rootElementIds).toContain('order-events');
		expect(after['layout/shop-containers.layout.json'].nodes['order-api']).toEqual({
			x: 10,
			y: 10,
			pinned: true
		});
		const { data } = loadFixture();
		expect(() =>
			applyCommand(data, reparentElement('shop', 'order-api'), ctxFor(data, buildModel(data)))
		).toThrow('into itself');
		// Moving the last child out removes the empty children list.
		let one = run(reparentElement('order-api', undefined)).after;
		one = run(reparentElement('order-domain', undefined), one).after;
		one = run(reparentElement('order-repo', undefined), one).after;
		expect(readAt(one, SHOP, ['elements', 1, 'children', 1, 'children'])).toBeUndefined();
		expect(buildModel(one).rootElementIds).toEqual([
			'customer',
			'shop',
			'payments',
			'warehouse',
			'order-api',
			'order-domain',
			'order-repo'
		]);
	});

	it('edits classes: add, members, relations', () => {
		const added = run(
			addClass({ kind: 'interface', viewId: 'order-domain', position: { x: 0, y: 0 } })
		);
		expect(added.model.classes.get('new-interface')!.def).toEqual({
			id: 'new-interface',
			name: 'NewInterface',
			kind: 'interface'
		});
		let data = run(
			addMember('order', 'attributes', parseAttribute('+ discount: Percent = 0'))
		).after;
		expect(readAt(data, DOMAIN, ['classes', 1, 'attributes', 3])).toEqual({
			name: 'discount',
			type: 'Percent',
			visibility: '+',
			default: '0'
		});
		data = run(
			updateMember('order', 'methods', 1, parseMethod('# cancel(reason: string): bool')),
			data
		).after;
		expect(readAt(data, DOMAIN, ['classes', 1, 'methods', 1])).toEqual({
			name: 'cancel',
			params: 'reason: string',
			returns: 'bool',
			visibility: '#'
		});
		data = run(moveMember('order', 'attributes', 0, 2), data).after;
		expect(
			(readAt(data, DOMAIN, ['classes', 1, 'attributes']) as Any[]).map((a) => a.name)
		).toEqual(['total', 'status', 'id', 'discount']);
		data = run(removeMember('order-status', 'values', 0), data).after;
		expect(readAt(data, DOMAIN, ['classes', 3, 'values'])).toEqual([
			'placed',
			'paid',
			'shipped',
			'cancelled'
		]);
		data = run(addClassRelation('order-line', 'order-status', 'dependency'), data).after;
		expect(readAt(data, DOMAIN, ['classes', 2, 'relations'])).toEqual([
			{ type: 'dependency', to: 'order-status' }
		]);
		expect(() => parseAttribute('')).toThrow();
		expect(parseMethod('go()')).toEqual({ name: 'go' });
	});

	it('edits objects: add, slots, links', () => {
		let data = run(addObject('order')).after;
		expect(readAt(data, DOMAIN, ['objects', 3])).toEqual({ id: 'order-1', class: 'order' });
		data = run(setSlot('order-42', 'status', 'paid'), data).after;
		data = run(setSlot('line-1', 'sku', undefined), data).after;
		expect(readAt(data, DOMAIN, ['objects', 0, 'slots', 'status'])).toBe('paid');
		expect(Object.keys(readAt(data, DOMAIN, ['objects', 1, 'slots']) as object)).toEqual([
			'quantity',
			'price'
		]);
		data = run(addObjectLink('line-1', 'line-2', 'next'), data).after;
		expect(readAt(data, DOMAIN, ['objects', 1, 'links'])).toEqual([
			{ to: 'line-2', label: 'next' }
		]);
	});

	it('edits flows: nodes, transitions, lanes, type conversion', () => {
		let data = run(addFlowNode('checkout', 'decision', { actor: 'storefront' })).after;
		expect(readAt(data, 'model/flows.model.yaml', ['flows', 0, 'nodes', 7])).toEqual({
			id: 'decision',
			type: 'decision',
			name: 'Decision?',
			actor: 'storefront'
		});
		data = run(addTransition('checkout', 'decision', 'done', 'ok'), data).after;
		expect(
			(readAt(data, 'model/flows.model.yaml', ['flows', 0, 'transitions']) as Any[]).at(-1)
		).toEqual({ from: 'decision', to: 'done', label: 'ok' });
		data = run(setFlowNodeActor('checkout', 'validate', undefined), data).after;
		expect(
			readAt(data, 'model/flows.model.yaml', ['flows', 0, 'nodes', 2, 'actor'])
		).toBeUndefined();
		const ref = {
			kind: 'flowNode' as const,
			file: 'model/flows.model.yaml',
			path: ['flows', 0, 'nodes', 2]
		};
		data = run(patchEntity(ref, { type: 'io' }), data).after;
		expect(readAt(data, 'model/flows.model.yaml', [...ref.path, 'type'])).toBe('io');
	});

	it('edits pipelines: stages, jobs, needs and artifacts', () => {
		const P = 'model/delivery.model.yaml';
		let data = run(addStage('ci')).after;
		expect(readAt(data, P, ['pipelines', 0, 'stages', 3])).toEqual({
			id: 'stage',
			jobs: [],
			needs: ['deploy']
		});
		data = run(addJob('ci', 'build'), data).after;
		expect((readAt(data, P, ['pipelines', 0, 'stages', 0, 'jobs']) as Any[]).at(-1)).toEqual({
			id: 'job'
		});
		data = run(moveJob('ci', 'lint', 'test'), data).after;
		expect(
			(readAt(data, P, ['pipelines', 0, 'stages', 1, 'jobs']) as Any[]).map((j) => j.id)
		).toEqual(['unit', 'e2e', 'lint']);
		data = run(addNeeds('ci', 'build', 'deploy'), data).after;
		expect(readAt(data, P, ['pipelines', 0, 'stages', 2, 'needs'])).toEqual(['test', 'build']);
		data = run(addNeeds('ci', 'bundle', 'unit'), data).after;
		expect(readAt(data, P, ['pipelines', 0, 'artifacts', 0, 'consumedBy'])).toEqual([
			'e2e',
			'release',
			'unit'
		]);
		data = run(removeNeeds('ci', 'unit', 'e2e'), data).after;
		expect(readAt(data, P, ['pipelines', 0, 'stages', 1, 'jobs', 1, 'needs'])).toBeUndefined();
		const { model } = loadFixture();
		const d0 = loadFixture().data;
		expect(() => applyCommand(d0, addNeeds('ci', 'build', 'unit'), ctxFor(d0, model))).toThrow(
			'connect two stages'
		);
	});

	it('replaces an entity from the properties panel, cleaning undefined fields', () => {
		const { model } = loadFixture();
		const ref = { kind: 'element' as const, ...model.elements.get('payments')!.loc };
		const { after } = run(
			setEntity(
				ref,
				cleanValue({ id: 'payments', kind: 'external', name: 'Stripe', description: undefined })
			)
		);
		expect(readAt(after, SHOP, ref.path)).toEqual({
			id: 'payments',
			kind: 'external',
			name: 'Stripe'
		});
	});

	it('remove from view edits only the view', () => {
		const { after, patches } = run(removeFromView('shop-containers', 'order-db'));
		expect(readAt(after, VIEWS, ['views', 1, 'exclude'])).toEqual(['tag:internal', 'order-db']);
		expect([...patchesByFile(patches).keys()]).toEqual([VIEWS]);
		// An explicitly included id is just removed from include.
		const ctx = run(removeFromView('system-context', 'warehouse')).after;
		expect(readAt(ctx, VIEWS, ['views', 0, 'include'])).toEqual(['customer', 'shop', 'payments']);
		expect(readAt(ctx, VIEWS, ['views', 0, 'exclude'])).toBeUndefined();
		// Generated views are materialised into the default view file first.
		const { data } = loadFixture();
		expect(() =>
			applyCommand(data, removeFromView('payment', 'charge'), ctxFor(data, buildModel(data)))
		).toThrow('only component');
	});

	it('generates unique kebab-case ids', () => {
		expect(uniqueId('New Container', (x) => x === 'new-container')).toBe('new-container-2');
		expect(uniqueId('42', () => false)).toBe('x-42');
	});
});

describe('delete cascades', () => {
	it('deleting an element removes descendants, relationships, participants and view references', () => {
		const { model } = loadFixture();
		const { after, patches } = run(
			deleteEntity({ kind: 'element', ...model.elements.get('order-service')!.loc })
		);
		const m = buildModel(after);
		for (const id of ['order-service', 'order-api', 'order-domain', 'order-repo'])
			expect(m.elements.has(id)).toBe(false);
		expect(
			m.relationships.some((r) => ['order-service', 'order-api', 'order-repo'].includes(r.def.from))
		).toBe(false);
		expect(m.interactions.get('place-order')!.def.participants).toEqual([
			'customer',
			'payments',
			'order-db'
		]);
		// Every message involved order-service; the emptied alt fragment goes too, the note keeps order-db.
		expect(m.interactions.get('place-order')!.def.steps).toEqual([
			{ note: 'Stored in one transaction', over: 'order-db' }
		]);
		expect(readAt(after, VIEWS, ['views', 2, 'scope'])).toBeUndefined();
		expect(readAt(after, VIEWS, ['views', 2, 'include'])).toEqual([
			'storefront',
			'order-db',
			'payments'
		]);
		expect(
			m.flows.get('checkout')!.def.nodes.find((n) => n.id === 'validate')!.actor
		).toBeUndefined();
		// order.componentOf pointed at order-domain, a descendant.
		expect(m.classes.get('order')!.def.componentOf).toBeUndefined();
		expect([...patchesByFile(patches).keys()].sort()).toEqual([
			DOMAIN,
			'model/flows.model.yaml',
			INTER,
			SHOP,
			VIEWS
		]);
		expect(m.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
	});

	it('deleting a class removes relations to it and its objects', () => {
		const { model } = loadFixture();
		const m = run(deleteEntity({ kind: 'class', ...model.classes.get('order-line')!.loc })).model;
		expect(m.classes.get('order')!.def.relations!.map((r) => r.to)).toEqual([
			'aggregate-root',
			'order-status'
		]);
		expect([...m.objects.keys()]).toEqual(['order-42']);
		expect(m.objects.get('order-42')!.def.links).toEqual([]);
	});

	it('deleting flow nodes, stages and steps removes what points at them', () => {
		const { model } = loadFixture();
		const flow = model.flows.get('checkout')!;
		const f = run(
			deleteEntity({ kind: 'flowNode', file: flow.loc.file, path: [...flow.loc.path, 'nodes', 3] })
		).model.flows.get('checkout')!.def;
		expect(f.nodes.map((n) => n.id)).not.toContain('in-stock');
		expect(f.transitions!.some((t) => t.from === 'in-stock' || t.to === 'in-stock')).toBe(false);
		const pipe = model.pipelines.get('ci')!;
		const p = run(
			deleteEntity({ kind: 'stage', file: pipe.loc.file, path: [...pipe.loc.path, 'stages', 0] })
		).model.pipelines.get('ci')!.def;
		expect(p.stages[0].needs).toEqual([]);
		expect(p.artifacts![0].producedBy).toBeUndefined();
		const inter = model.interactions.get('place-order')!;
		const i = run(
			deleteEntity({ kind: 'message', file: inter.loc.file, path: [...inter.loc.path, 'steps', 0] })
		).model.interactions.get('place-order')!.def;
		expect(i.steps).toHaveLength(5);
	});

	it('deleteMany removes edges first, then nodes by id', () => {
		const { model } = loadFixture();
		const rels = model.relationships.filter(
			(r) => r.def.to === 'order-db' || r.def.from === 'customer'
		);
		const { model: m } = run(
			deleteMany(
				rels.map((r) => ({ kind: 'relationship' as const, ...r.loc })),
				[
					{ kind: 'element', id: 'order-repo' },
					{ kind: 'element', id: 'customer' }
				]
			)
		);
		expect(m.elements.has('order-repo')).toBe(false);
		expect(m.elements.has('customer')).toBe(false);
		expect(m.relationships.map((r) => r.key)).toEqual([
			'storefront->order-api#0',
			'order-api->order-domain#0',
			'order-service->payments#0',
			'order-service->order-events#0',
			'order-events->warehouse#0'
		]);
	});

	it('deleting a view removes its layout file', () => {
		const data = {
			...loadFixture().data,
			'layout/place-order.layout.json': { version: 1, view: 'place-order', nodes: {} }
		};
		const m = buildModel(data);
		const { after } = run(
			deleteEntity({ kind: 'view', ...m.views.get('place-order')!.loc! }),
			data
		);
		expect(after['layout/place-order.layout.json']).toBeUndefined();
		// The interaction now gets a generated default view.
		expect(buildModel(after).views.get('place-order')!.generated).toBe(true);
	});
});

describe('sequence commands', () => {
	const steps = (data: DesignData) =>
		(readAt(data, INTER, ['interactions', 0, 'steps']) as Any[]).map(
			(s) => s.msg ?? s.group ?? s.note
		);

	it('adds, moves and removes participants (with their messages)', () => {
		let data = run(addParticipant('place-order', 'warehouse', 0)).after;
		expect(readAt(data, INTER, ['interactions', 0, 'participants'])).toEqual([
			'warehouse',
			'customer',
			'order-service',
			'payments',
			'order-db'
		]);
		data = run(moveParticipant('place-order', 'warehouse', 4), data).after;
		expect((readAt(data, INTER, ['interactions', 0, 'participants']) as string[]).at(-1)).toBe(
			'warehouse'
		);
		data = run(removeParticipant('place-order', 'payments'), data).after;
		expect(steps(data)).toEqual(['POST /orders', 'validate()', 'alt', 'Stored in one transaction']);
	});

	it('inserts, reorders, wraps and removes steps', () => {
		let data = run(
			insertStep('place-order', ['steps'], 1, {
				from: 'customer',
				to: 'order-service',
				msg: 'hello'
			})
		).after;
		expect(steps(data).slice(0, 3)).toEqual(['POST /orders', 'hello', 'validate()']);
		data = run(moveStep('place-order', ['steps', 1], ['steps'], 3), data).after;
		expect(steps(data).slice(0, 3)).toEqual(['POST /orders', 'validate()', 'hello']);
		data = run(moveStep('place-order', ['steps', 0], ['steps', 5, 'steps'], 0), data).after;
		expect((readAt(data, INTER, ['interactions', 0, 'steps', 4, 'steps']) as Any[])[0].msg).toBe(
			'POST /orders'
		);
		data = run(wrapSteps('place-order', ['steps'], 0, 2, 'loop', 'retry'), data).after;
		expect(readAt(data, INTER, ['interactions', 0, 'steps', 0])).toMatchObject({
			group: 'loop',
			label: 'retry'
		});
		data = run(removeStep('place-order', ['steps', 0]), data).after;
		expect(steps(data)).toEqual(['charge()', 'ok', 'alt', 'Stored in one transaction']);
		const { data: d0, model } = loadFixture();
		expect(() =>
			applyCommand(d0, wrapSteps('place-order', ['steps'], 2, 2, 'opt'), ctxFor(d0, model))
		).toThrow('consecutive');
		expect(() =>
			applyCommand(
				d0,
				moveStep('place-order', ['steps', 4], ['steps', 4, 'steps'], 0),
				ctxFor(d0, model)
			)
		).toThrow('into itself');
	});
});
