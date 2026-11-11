import { describe, expect, it } from 'vitest';
import { formatDiagnostic, hasErrors, type Diagnostic } from '../../src/lib/model/diagnostics';
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

	it('stores models in a system or module and lists them there', () => {
		const { model, diagnostics } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/m.module.yaml': 'id: m\nparent: s\nstoredIn: s\n',
			's/db.module.yaml': 'id: db\nparent: s\nmodels: [a]\n',
			's/u.logic-unit.yaml': 'id: u\nparent: m\n',
			's/a.model.yaml': 'id: a\nownedBy: m\nstoredIn: db\n',
			's/b.model.yaml': 'id: b\nownedBy: db\nstoredIn: db\n',
			's/c.model.yaml': 'id: c\nownedBy: m\nstoredIn: u\n',
			's/d.model.yaml': 'id: d\nownedBy: m\nstoredIn: ghost\n'
		});
		expect(codes(diagnostics)).toEqual([
			'dangling-ref',
			'model-only',
			'own-model-ref',
			'parent-kind'
		]);
		// Stored where owned: listed once, as a child.
		expect(model.elements.get('db')!.storedIds).toEqual(['a']);
		expect(model.elements.get('db')!.childIds).toEqual(['b']);
	});

	it('keeps keys and indexes on stored fields', () => {
		const { diagnostics } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/b.model.yaml': 'id: b\nownedBy: s\n',
			's/a.model.yaml': [
				'id: a',
				'ownedBy: s',
				'fields:',
				'  - { id: f1, name: n, type: int, stored: false, pk: true }',
				'  - { id: f2, name: bs, model: b, many: true }',
				'indexes:',
				'  - { name: ix, fields: [f1, f2] }'
			].join('\n')
		});
		expect(codes(diagnostics)).toEqual(['unknown-field', 'unknown-field', 'unstored-key']);
	});

	it('checks model fields and indexes', () => {
		const { diagnostics } = loadStrings({
			's/s.system.yaml': 'id: s\nfields: [{ id: x, name: x, type: int }]\n',
			's/a.model.yaml': [
				'id: a',
				'ownedBy: s',
				'fields:',
				'  - { id: f1, name: id, type: uuid, pk: true, pi: true, nullable: true }',
				'  - { id: f2, name: id, type: int, required: true }',
				'indexes:',
				'  - { name: ix, fields: [f1, nope, g1], unique: true }'
			].join('\n'),
			's/b.model.yaml': 'id: b\nownedBy: s\nfields: [{ id: g1, name: x, type: int }]\n'
		});
		expect(codes(diagnostics)).toEqual([
			'duplicate-field',
			'model-only',
			'nullable-key',
			'unknown-field',
			'unknown-field'
		]);
		expect(diagnostics.find((d) => d.code === 'unknown-field')!.line).toBe(7);
	});

	it('checks that field refs point at models or fields, by id', () => {
		const { diagnostics } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/a.model.yaml': [
				'id: a',
				'ownedBy: s',
				'fields:',
				'  - { id: f1, name: self, type: uuid, ref: a }',
				'  - { id: f2, name: ghost, type: uuid, ref: nope }',
				'  - { id: f3, name: sys, type: uuid, ref: s }',
				'  - { id: f4, name: up, type: uuid, ref: f1 }',
				'  - { id: a, name: clash, type: uuid }'
			].join('\n')
		});
		expect(codes(diagnostics)).toEqual(['dangling-ref', 'duplicate-id', 'not-a-model']);
		expect(diagnostics.find((d) => d.code === 'not-a-model')!.line).toBe(6);
	});

	it('checks held models: exactly one of type and model, and the model must exist', () => {
		const { diagnostics } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/b.model.yaml': 'id: b\nownedBy: s\nfields: [{ id: b1, name: x, type: int }]\n',
			's/a.model.yaml': [
				'id: a',
				'ownedBy: s',
				'fields:',
				'  - { id: f1, name: ok, model: b, many: true }',
				'  - { id: f2, name: both, type: int, model: b }',
				'  - { id: f3, name: none }',
				'  - { id: f4, name: keyed, model: b, ref: b1 }',
				'  - { id: f5, name: ghost, model: nope }',
				'  - { id: f6, name: sys, model: s }'
			].join('\n')
		});
		expect(codes(diagnostics)).toEqual([
			'dangling-ref',
			'field-type',
			'field-type',
			'field-type',
			'not-a-model'
		]);
	});

	it('checks lineage: from points at fields and never loops', () => {
		const { diagnostics } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/a.model.yaml': [
				'id: a',
				'ownedBy: s',
				'fields:',
				'  - { id: f1, name: src, type: int }',
				'  - { id: f2, name: copy, type: int, from: [f1], derived: doubled }',
				'  - { id: f3, name: self, type: int, from: [f3] }',
				'  - { id: f4, name: model, type: int, from: [a] }',
				'  - { id: f5, name: x, type: int, from: [f6] }',
				'  - { id: f6, name: y, type: int, from: [f5] }'
			].join('\n')
		});
		expect(codes(diagnostics)).toEqual(['dangling-ref', 'lineage-cycle', 'lineage-cycle']);
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
