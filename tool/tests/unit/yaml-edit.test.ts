import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { produce } from 'immer';
import { editYamlText } from '../../src/lib/server/yaml-edit';

const FIXTURE = readFileSync(
	new URL('../fixtures/roundtrip/comments.model.yaml', import.meta.url),
	'utf8'
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Data = any;

function edit(text: string, recipe: (d: Data) => void): string {
	return editYamlText(text, produce(parseDocument(text).toJS() ?? {}, recipe));
}

/** Lines only in a, lines only in b (multiset diff). */
function diff(a: string, b: string): { removed: string[]; added: string[] } {
	const count = (s: string) => {
		const m = new Map<string, number>();
		for (const l of s.split('\n')) m.set(l, (m.get(l) ?? 0) + 1);
		return m;
	};
	const ca = count(a);
	const cb = count(b);
	const removed = [...ca].flatMap(([l, n]) => Array(Math.max(0, n - (cb.get(l) ?? 0))).fill(l));
	const added = [...cb].flatMap(([l, n]) => Array(Math.max(0, n - (ca.get(l) ?? 0))).fill(l));
	return { removed, added };
}

describe('YAML round-trip', () => {
	it('is byte-identical when nothing changes', () => {
		expect(edit(FIXTURE, () => {})).toBe(FIXTURE);
	});

	it('changes only the edited scalar and keeps its quoting and comment', () => {
		const out = edit(FIXTURE, (d) => {
			d.elements[0].name = 'Online Shop';
		});
		expect(diff(FIXTURE, out)).toEqual({
			removed: ['    name: "Web Shop" # double-quoted name'],
			added: ['    name: "Online Shop" # double-quoted name']
		});
	});

	it('edits inside a flow map keep the flow style', () => {
		const out = edit(FIXTURE, (d) => {
			d.relationships[0].label = 'Buys from';
		});
		expect(diff(FIXTURE, out)).toEqual({
			removed: ['  - { from: customer, to: shop, label: Uses } # flow map with comment'],
			added: ['  - { from: customer, to: shop, label: Buys from } # flow map with comment']
		});
	});

	it('appends new list items in the style of their siblings', () => {
		const out = edit(FIXTURE, (d) => {
			d.classes[0].attributes.push({ name: 'status', type: 'OrderStatus' });
		});
		expect(diff(FIXTURE, out)).toEqual({
			removed: [],
			added: ['      - { name: status, type: OrderStatus }']
		});
	});

	it('adds new keys at the end of the map', () => {
		const out = edit(FIXTURE, (d) => {
			d.elements[1].description = 'Buys things';
		});
		expect(out).toContain('  - id: customer\n    kind: person\n    description: Buys things\n');
		expect(diff(FIXTURE, out).removed).toEqual([]);
	});

	it('removing an item keeps comments of the others', () => {
		const out = edit(FIXTURE, (d) => {
			d.elements[0].children.splice(0, 1);
		});
		const { removed } = diff(FIXTURE, out);
		expect(removed).toEqual([
			'      - id: api',
			'        kind: container',
			'        technology: Node # tech comment'
		]);
		expect(out).toContain('# comment before children after a blank line');
		expect(out).toContain('# Trailing document comment');
	});

	it('moves comments with reordered items', () => {
		const out = edit(FIXTURE, (d) => {
			d.elements.reverse();
		});
		expect(out.indexOf('# comment before second top-level item')).toBeLessThan(
			out.indexOf('- id: customer')
		);
		expect(out.indexOf('- id: customer')).toBeLessThan(out.indexOf('- id: shop # trailing on id'));
		expect(out).toContain('- id: shop # trailing on id');
	});

	it('removing a key drops only that line', () => {
		const out = edit(FIXTURE, (d) => {
			delete d.relationships[1].sync;
		});
		expect(diff(FIXTURE, out)).toEqual({ removed: ['    sync: false'], added: [] });
	});

	it('adds a new section at the end', () => {
		const out = edit(FIXTURE, (d) => {
			d.flows = [{ id: 'f', nodes: [{ id: 'start', type: 'start' }] }];
		});
		const withoutTrailer = FIXTURE.replace('# Trailing document comment\n', '');
		expect(out.startsWith(withoutTrailer)).toBe(true);
		expect(out.endsWith('# Trailing document comment\n')).toBe(true);
		expect(parseDocument(out).toJS().flows[0].nodes[0].type).toBe('start');
	});

	it('quotes strings that would otherwise read as another type', () => {
		const out = edit('msg: 402\n', (d) => {
			d.msg = '403';
		});
		expect(parseDocument(out).toJS().msg).toBe('403');
	});

	it('keeps unpadded flow collections unpadded, even on the edited line', () => {
		const text =
			'# c\nviews:\n  - id: v\n    include: ["a.*", b]\n    export: { formats: [mermaid, svg] }\n';
		const out = edit(text, (d) => {
			d.views[0].include.push('c');
		});
		expect(out).toBe(
			'# c\nviews:\n  - id: v\n    include: ["a.*", b, c]\n    export: { formats: [mermaid, svg] }\n'
		);
		const quoted = edit('x: [a]\ny: 1\n', (d) => {
			d.x.push('[ keep ]');
		});
		expect(quoted).toBe('x: [a, "[ keep ]"]\ny: 1\n');
	});

	it('moves content-identical items without ids instead of recreating them', () => {
		const text = 'steps:\n  - { from: a, to: b } # first\n  - { from: b, to: a } # second\n';
		const out = edit(text, (d) => {
			d.steps.reverse();
		});
		expect(out).toBe('steps:\n  - { from: b, to: a } # second\n  - { from: a, to: b } # first\n');
	});

	it('copies quoting of sibling items for new list entries', () => {
		const text = 'a:\n  - { name: x, visibility: "+" }\n';
		const out = edit(text, (d) => {
			d.a.push({ name: 'y', visibility: '-' });
		});
		expect(out).toBe('a:\n  - { name: x, visibility: "+" }\n  - { name: y, visibility: "-" }\n');
	});

	it('creates content for an empty document', () => {
		const out = edit('', (d) => {
			d.elements = [{ id: 'a', kind: 'system' }];
		});
		expect(out).toBe('elements:\n  - id: a\n    kind: system\n');
	});
});
