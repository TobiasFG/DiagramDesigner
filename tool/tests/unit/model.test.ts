import { describe, expect, it } from 'vitest';
import { formatDiagnostic, hasErrors, type Diagnostic } from '../../src/lib/model/diagnostics';
import { View } from '../../src/lib/model/schema';
import { loadFixture, loadStrings } from './helpers';

const codes = (diags: Diagnostic[]) => diags.map((d) => d.code).sort();

describe('fixture design', () => {
	it('loads without diagnostics and links entities into one tree', () => {
		const { model, diagnostics } = loadFixture();
		expect(diagnostics).toEqual([]);
		expect(model.elements.size).toBe(9);
		expect(model.rootElementIds).toEqual(['erp', 'webshop']);
		expect(model.elements.get('erp')!.childIds).toEqual(['inventory', 'order-api', 'orders']);
		const place = model.elements.get('place')!;
		expect([place.parentId, place.depth, place.def.kind]).toEqual(['order', 3, 'logic-unit']);
		expect(model.elements.get('order-api')!.def).toMatchObject({ kind: 'api' });
	});

	it('defaults the name to the file name and keeps the source file', () => {
		const { model } = loadFixture();
		const checkout = model.elements.get('checkout')!;
		expect(checkout.name).toBe('checkout');
		expect(checkout.loc).toEqual({ file: 'model/webshop/checkout.module.yaml', path: [] });
		expect(model.views.get('erp-modules')!.loc).toEqual({
			file: 'views/views.view.yaml',
			path: ['views', 1]
		});
	});
});

describe('schema validation', () => {
	it('reports errors with file, line and column', () => {
		const { diagnostics } = loadStrings({
			'a/a.system.yaml': 'id: a\ntags: nope\n'
		});
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			severity: 'error',
			code: 'schema',
			file: 'a/a.system.yaml',
			line: 2,
			col: 7
		});
		expect(formatDiagnostic(diagnostics[0])).toMatch(/^a\/a\.system\.yaml:2:7: error tags: /);
	});

	it('points unknown fields at the key, including the removed description', () => {
		const { model, diagnostics } = loadStrings({
			'a/a.system.yaml': 'id: a\ndescription: Old text\n'
		});
		expect(diagnostics[0]).toMatchObject({
			line: 2,
			col: 1,
			message: 'unknown field "description"'
		});
		expect(model.elements.size).toBe(0);
	});

	it('rejects ids that are not kebab-case', () => {
		const { diagnostics } = loadStrings({ 'a/a.system.yaml': 'id: Shop\n' });
		expect(diagnostics[0].message).toContain('kebab-case');
	});

	it('reads numeric scalars in text fields as strings', () => {
		const { model, diagnostics } = loadStrings({ 'a/a.system.yaml': 'id: a\nname: 42\n' });
		expect(diagnostics).toEqual([]);
		expect(model.elements.get('a')!.name).toBe('42');
	});

	it('reports YAML syntax errors with position and drops the data', () => {
		const loaded = loadStrings({ 'a/a.system.yaml': 'id: a\n  name: [\n' });
		expect(loaded.data['a/a.system.yaml']).toBeUndefined();
		expect(loaded.diagnostics[0]).toMatchObject({
			code: 'syntax',
			severity: 'error',
			file: 'a/a.system.yaml'
		});
		expect(loaded.diagnostics[0].line).toBeGreaterThan(0);
	});

	it('ignores files that are not design files', () => {
		const { model, diagnostics } = loadStrings({ 'notes.txt': 'x', 'README.md': '# x' });
		expect(diagnostics).toEqual([]);
		expect(model.files).toEqual([]);
	});

	it('reports unknown sections in view files', () => {
		const { diagnostics } = loadStrings({ 'views/v.view.yaml': 'other: 1\n' });
		expect(diagnostics.map((d) => d.message)).toEqual(['unknown section "other"']);
	});

	it('accepts the documented view example', () => {
		expect(
			View.safeParse({
				id: 'v',
				type: 'component',
				include: ['shop.*'],
				depth: 1,
				layout: { direction: 'RIGHT' }
			}).success
		).toBe(true);
	});
});

describe('entity checks', () => {
	it('rejects unknown kinds', () => {
		const { diagnostics } = loadStrings({ 'a/a.planet.yaml': 'id: a\n' });
		expect(diagnostics.map((d) => d.code)).toEqual(['unknown-kind']);
		expect(diagnostics[0].message).toContain('expected system, module');
	});

	it('reports duplicate ids with both locations', () => {
		const { model, diagnostics } = loadStrings({
			'a/a.system.yaml': 'id: a\n',
			'b/b.system.yaml': 'name: B\nid: a\n'
		});
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({
			code: 'duplicate-id',
			file: 'b/b.system.yaml',
			line: 2
		});
		expect(diagnostics[0].message).toContain('a/a.system.yaml:1:1');
		expect(model.elements.get('a')!.loc.file).toBe('a/a.system.yaml');
	});

	it('requires a parent for everything but systems', () => {
		const { diagnostics } = loadStrings({
			'a/a.system.yaml': 'id: a\n',
			'a/b.system.yaml': 'id: b\nparent: a\n',
			'a/c.module.yaml': 'id: c\n'
		});
		expect(codes(diagnostics)).toEqual(['missing-parent', 'system-parent']);
	});

	it('places models under the single entity in ownedBy', () => {
		const { model, diagnostics } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/m.module.yaml': 'id: m\nparent: s\n',
			's/a.model.yaml': 'id: a\nownedBy: m\n',
			's/b.model.yaml': 'id: b\nownedBy: s\n'
		});
		expect(diagnostics).toEqual([]);
		expect(model.elements.get('m')!.childIds).toEqual(['a']);
		expect(model.elements.get('s')!.childIds).toEqual(['b', 'm']);
		expect(model.elements.get('a')!.depth).toBe(2);
	});

	it('requires ownedBy instead of parent on models only', () => {
		const { diagnostics } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/m.module.yaml': 'id: m\nparent: s\nownedBy: s\n',
			's/a.model.yaml': 'id: a\nparent: s\n',
			's/u.logic-unit.yaml': 'id: u\nparent: m\n',
			's/b.model.yaml': 'id: b\nownedBy: u\n',
			's/c.model.yaml': 'id: c\nownedBy: [s, m]\n'
		});
		expect(codes(diagnostics)).toEqual([
			'missing-owner',
			'model-parent',
			'owned-by',
			'parent-kind',
			'schema'
		]);
		expect(diagnostics.find((d) => d.code === 'parent-kind')!.message).toBe(
			'model cannot have a logic-unit as ownedBy; allowed: system, module'
		);
	});

	it('keeps valid model references and reports the rest', () => {
		const { model, diagnostics } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/m.module.yaml': 'id: m\nparent: s\n',
			's/a.model.yaml': 'id: a\nownedBy: m\n',
			's/db.module.yaml': 'id: db\nparent: s\nmodels: [a, ghost, m]\n',
			's/own.module.yaml': 'id: own\nparent: s\nmodels: [b]\n',
			's/b.model.yaml': 'id: b\nownedBy: own\nmodels: [a]\n'
		});
		expect(codes(diagnostics)).toEqual([
			'dangling-ref',
			'model-only',
			'not-a-model',
			'own-model-ref'
		]);
		expect(model.elements.get('db')!.refIds).toEqual(['a']);
		expect(model.elements.get('a')!.parentId).toBe('m');
	});

	it('checks model fields and indexes', () => {
		const { diagnostics } = loadStrings({
			's/s.system.yaml': 'id: s\nfields: [{ name: x, type: int }]\n',
			's/a.model.yaml': [
				'id: a',
				'ownedBy: s',
				'fields:',
				'  - { name: id, type: uuid, pk: true, pi: true }',
				'  - { name: id, type: int, required: true }',
				'indexes:',
				'  - { name: ix, fields: [id, nope], unique: true }'
			].join('\n')
		});
		expect(codes(diagnostics)).toEqual(['duplicate-field', 'model-only', 'unknown-field']);
		expect(diagnostics.find((d) => d.code === 'unknown-field')!.line).toBe(7);
	});

	it('checks that field refs point at models', () => {
		const { diagnostics } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/a.model.yaml': [
				'id: a',
				'ownedBy: s',
				'fields:',
				'  - { name: self, type: uuid, ref: a }',
				'  - { name: ghost, type: uuid, ref: nope }',
				'  - { name: sys, type: uuid, ref: s }'
			].join('\n')
		});
		expect(codes(diagnostics)).toEqual(['dangling-ref', 'not-a-model']);
		expect(diagnostics.find((d) => d.code === 'not-a-model')!.line).toBe(6);
	});

	it('gives each system its own folder', () => {
		const { diagnostics } = loadStrings({
			'a/a.system.yaml': 'id: a\n',
			'a/b.system.yaml': 'id: b\n'
		});
		expect(codes(diagnostics)).toEqual(['shared-system-folder']);
	});

	it('reports parents that do not exist, have the wrong kind or loop', () => {
		const { model, diagnostics } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/m.module.yaml': 'id: m\nparent: s\n',
			's/x.logic-unit.yaml': 'id: x\nparent: s\n',
			's/g.module.yaml': 'id: g\nparent: ghost\n',
			's/p.module.yaml': 'id: p\nparent: q\n',
			's/q.module.yaml': 'id: q\nparent: p\n'
		});
		expect(codes(diagnostics)).toEqual(['dangling-ref', 'parent-cycle', 'parent-kind']);
		expect(diagnostics.find((d) => d.code === 'parent-kind')!.message).toBe(
			'logic-unit cannot have a system as parent; allowed: module'
		);
		// Entities with a dangling or looping parent become roots so the canvas still shows them.
		expect(model.rootElementIds).toEqual(['g', 'p', 's']);
	});

	it('warns about entities outside their system folder', () => {
		const { diagnostics } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			'other/m.module.yaml': 'id: m\nparent: s\n'
		});
		expect(diagnostics).toHaveLength(1);
		expect(diagnostics[0]).toMatchObject({ code: 'outside-system-folder', severity: 'warning' });
		expect(hasErrors(diagnostics)).toBe(false);
	});
});

describe('view and layout checks', () => {
	it('checks views and layout files', () => {
		const { diagnostics } = loadStrings({
			'a/a.system.yaml': 'id: a\n',
			'views/v.view.yaml':
				'views:\n  - { id: v, type: flow }\n  - { id: w, type: component, scope: nope, include: [zzz] }\n  - { id: w, type: component }\n',
			'layout/x.layout.json': '{ "version": 1, "view": "gone", "nodes": {} }'
		});
		expect(codes(diagnostics)).toEqual([
			'dangling-ref',
			'duplicate-id',
			'layout-file-name',
			'orphan-layout',
			'unmatched-pattern',
			'view-source'
		]);
	});
});
