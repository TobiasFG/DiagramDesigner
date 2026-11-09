import { describe, expect, it } from 'vitest';
import { formatDiagnostic, hasErrors, type Diagnostic } from '../../src/lib/model/diagnostics';
import { findCycle } from '../../src/lib/model/model';
import { ModelFile, View } from '../../src/lib/model/schema';
import { loadFixture, loadStrings } from './helpers';

const find = (diags: Diagnostic[], code: string) => diags.filter((d) => d.code === code);

describe('fixture design', () => {
	it('loads without diagnostics and merges all files into one namespace', () => {
		const { model, diagnostics } = loadFixture();
		expect(diagnostics).toEqual([]);
		expect(model.elements.size).toBe(11);
		expect(model.rootElementIds).toEqual(['customer', 'shop', 'payments', 'warehouse']);
		expect(model.elements.get('order-api')!.parentId).toBe('order-service');
		expect(model.elements.get('order-api')!.depth).toBe(2);
		expect(model.classes.size).toBe(6);
		expect(model.objects.size).toBe(3);
		expect([...model.flows.keys()]).toEqual(['checkout', 'payment']);
		expect(model.pipelines.has('ci')).toBe(true);
		expect(model.interactions.has('place-order')).toBe(true);
		expect(model.relationships.map((r) => r.key)).toContain('order-service->payments#0');
	});

	it('generates a default view for flows without one', () => {
		const { model } = loadFixture();
		const v = model.views.get('payment')!;
		expect(v.generated).toBe(true);
		expect(v.def).toMatchObject({ type: 'flow', source: 'payment' });
		expect(model.views.get('checkout-flow')!.generated).toBe(false);
	});

	it('keeps source locations for every entity', () => {
		const { model } = loadFixture();
		expect(model.elements.get('order-db')!.loc).toEqual({
			file: 'model/shop.model.yaml',
			path: ['elements', 1, 'children', 2]
		});
		expect(model.views.get('place-order')!.loc).toEqual({
			file: 'views/views.view.yaml',
			path: ['views', 7]
		});
	});
});

describe('schema validation', () => {
	it('reports errors with file, line and column', () => {
		const { diagnostics } = loadStrings({
			'model/a.model.yaml': 'elements:\n  - id: shop\n    kind: sistem\n'
		});
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			severity: 'error',
			code: 'schema',
			file: 'model/a.model.yaml',
			line: 3,
			col: 11
		});
		expect(diagnostics[0].message).toMatch(/^elements\[0\]\.kind: /);
		expect(formatDiagnostic(diagnostics[0])).toMatch(
			/^model\/a\.model\.yaml:3:11: error elements\[0\]\.kind/
		);
	});

	it('points unknown fields at the key', () => {
		const { diagnostics } = loadStrings({
			'model/a.model.yaml': 'elements:\n  - id: a\n    kind: system\n    colour: red\n'
		});
		expect(diagnostics[0]).toMatchObject({
			line: 4,
			col: 5,
			message: 'elements[0]: unknown field "colour"'
		});
	});

	it('rejects ids that are not kebab-case', () => {
		const { diagnostics } = loadStrings({
			'model/a.model.yaml': 'elements:\n  - { id: Shop, kind: system }\n'
		});
		expect(diagnostics[0].message).toContain('kebab-case');
	});

	it('keeps valid entities of a file with an invalid one', () => {
		const { model, diagnostics } = loadStrings({
			'model/a.model.yaml':
				'elements:\n  - { id: a, kind: system }\n  - { id: b, kind: nope }\n  - { id: c, kind: person }\n'
		});
		expect([...model.elements.keys()]).toEqual(['a', 'c']);
		expect(diagnostics).toHaveLength(1);
	});

	it('reads numeric scalars in text fields as strings', () => {
		const { model, diagnostics } = loadStrings({
			'model/a.model.yaml':
				'elements:\n  - { id: a, kind: system, name: 42 }\ninteractions:\n  - id: i\n    participants: [a]\n    steps:\n      - { from: a, to: a, msg: 402 }\n'
		});
		expect(diagnostics).toEqual([]);
		expect(model.elements.get('a')!.name).toBe('42');
	});

	it('reports YAML syntax errors with position and drops the data', () => {
		const loaded = loadStrings({ 'model/a.model.yaml': 'elements:\n  - id: a\n   kind: [\n' });
		expect(loaded.data['model/a.model.yaml']).toBeUndefined();
		expect(loaded.diagnostics[0]).toMatchObject({
			code: 'syntax',
			severity: 'error',
			file: 'model/a.model.yaml'
		});
		expect(loaded.diagnostics[0].line).toBeGreaterThan(0);
	});

	it('reports unknown sections', () => {
		const { diagnostics } = loadStrings({
			'model/a.model.yaml': 'things: []\n',
			'views/v.view.yaml': 'other: 1\n'
		});
		expect(diagnostics.map((d) => d.message).sort()).toEqual([
			'unknown section "other"',
			'unknown section "things"'
		]);
	});

	it('validates nested sequence steps through the union', () => {
		const { diagnostics } = loadStrings({
			'model/a.model.yaml':
				'interactions:\n  - id: i\n    participants: [a]\n    steps:\n      - group: alt\n        steps:\n          - { from: a, to: a, kind: shout }\n'
		});
		expect(diagnostics[0].message).toContain('interactions[0].steps[0].steps[0].kind');
	});

	it('accepts the documented examples', () => {
		expect(
			View.safeParse({
				id: 'v',
				type: 'component',
				include: ['shop.*'],
				depth: 1,
				layout: { direction: 'RIGHT' }
			}).success
		).toBe(true);
		expect(
			ModelFile.safeParse({
				objects: [
					{ id: 'o', class: 'c', links: [{ to: 'x' }, { label: 'Docs', url: 'https://x' }] }
				]
			}).success
		).toBe(true);
	});
});

describe('reference checks', () => {
	it('reports duplicate ids with both locations', () => {
		const { diagnostics } = loadStrings({
			'model/a.model.yaml': 'elements:\n  - { id: shop, kind: system }\n',
			'model/b.model.yaml': 'classes:\n  - { id: shop }\n'
		});
		const [d] = find(diagnostics, 'duplicate-id');
		expect(d.file).toBe('model/b.model.yaml');
		expect(d.message).toContain('model/a.model.yaml:2:5');
	});

	it('reports dangling references across all entity kinds', () => {
		const { diagnostics } = loadStrings({
			'model/a.model.yaml': [
				'elements:',
				'  - { id: a, kind: system }',
				'relationships:',
				'  - { from: a, to: ghost }',
				'classes:',
				'  - { id: c, relations: [ { type: association, to: nope } ] }',
				'objects:',
				'  - { id: o, class: missing }',
				'flows:',
				'  - id: f',
				'    nodes: [ { id: start, type: start }, { id: end, type: end } ]',
				'    transitions: [ { from: start, to: middle } ]',
				'pipelines:',
				'  - id: p',
				'    stages: [ { id: s, needs: [x], jobs: [ { id: j, needs: [y] } ] } ]',
				'interactions:',
				'  - id: i',
				'    participants: [a]',
				'    steps: [ { from: a, to: b } ]'
			].join('\n')
		});
		const msgs = find(diagnostics, 'dangling-ref').map((d) => d.message);
		expect(msgs).toEqual(
			expect.arrayContaining([
				'relationship to "ghost" is not an element',
				'class "c" relation to "nope" is not a class',
				'object "o" class "missing" is not a class',
				'transition to "middle" is not a node of flow "f"',
				'stage "s" needs "x" which is not a stage of pipeline "p"',
				'job "j" needs "y" which is not a job of pipeline "p"',
				'message to "b" is not a participant of "i"'
			])
		);
		expect(hasErrors(diagnostics)).toBe(true);
	});

	it('finds cycles in pipeline needs', () => {
		const { diagnostics } = loadStrings({
			'model/a.model.yaml':
				'pipelines:\n  - id: p\n    stages:\n      - { id: a, needs: [c], jobs: [] }\n      - { id: b, needs: [a], jobs: [] }\n      - { id: c, needs: [b], jobs: [] }\n'
		});
		expect(find(diagnostics, 'needs-cycle')[0].message).toBe(
			'cycle in stage needs: a -> c -> b -> a'
		);
		expect(
			findCycle(
				new Map([
					['x', ['y']],
					['y', []]
				])
			)
		).toBeUndefined();
	});

	it('warns about flows without start or end, plain participants and unbalanced activations', () => {
		const { diagnostics } = loadStrings({
			'model/a.model.yaml': [
				'flows:',
				'  - { id: f, nodes: [ { id: a, type: action } ] }',
				'interactions:',
				'  - id: i',
				'    participants: [browser, api]',
				'    steps:',
				'      - { from: browser, to: api, msg: go, activate: true }'
			].join('\n')
		});
		const warnings = diagnostics
			.filter((d) => d.severity === 'warning')
			.map((d) => d.code)
			.sort();
		expect(warnings).toEqual([
			'flow-end',
			'flow-start',
			'plain-participant',
			'plain-participant',
			'unbalanced-activation'
		]);
		expect(hasErrors(diagnostics)).toBe(false);
	});

	it('warns when an object slot is not an attribute of its class (inherited ones count)', () => {
		const { diagnostics } = loadStrings({
			'model/a.model.yaml': [
				'classes:',
				'  - { id: base, attributes: [ { name: id } ] }',
				'  - { id: c, attributes: [ { name: total } ], relations: [ { type: inheritance, to: base } ] }',
				'objects:',
				'  - { id: o, class: c, slots: { id: 1, total: 2, colour: red } }'
			].join('\n')
		});
		expect(find(diagnostics, 'unknown-slot').map((d) => d.message)).toEqual([
			'object "o" slot "colour" is not an attribute of class "c"'
		]);
	});

	it('checks views and layout files', () => {
		const { diagnostics } = loadStrings({
			'model/a.model.yaml': 'elements:\n  - { id: a, kind: system }\n',
			'views/v.view.yaml':
				'views:\n  - { id: v, type: flow }\n  - { id: w, type: component, scope: nope, include: [zzz] }\n',
			'layout/x.layout.json': '{ "version": 1, "view": "gone", "nodes": {} }'
		});
		const codes = diagnostics.map((d) => d.code).sort();
		expect(codes).toEqual([
			'dangling-ref',
			'layout-file-name',
			'orphan-layout',
			'unmatched-pattern',
			'view-source'
		]);
	});
});
