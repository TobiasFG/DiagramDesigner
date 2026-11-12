import { describe, expect, it } from 'vitest';
import {
	apiUses,
	bodyFields,
	bodyModels,
	RAIL,
	railGroups,
	railOf,
	railRowY
} from '../../src/lib/landscape/apis';
import { loadStrings } from './helpers';

const api = (id: string, parent: string, lines: string[]) =>
	[`id: ${id}`, `parent: ${parent}`, 'method: GET', `path: /${id}`, ...lines].join('\n');

const { model } = loadStrings({
	's/s.system.yaml': 'id: s\n',
	's/m.module.yaml': 'id: m\nparent: s\nname: Orders\n',
	's/o.model.yaml': [
		'id: o',
		'ownedBy: m',
		'fields:',
		'  - { id: o-id, name: id, type: uuid }',
		'  - { id: o-total, name: total, type: decimal }',
		'  - { id: o-note, name: note, type: string }'
	].join('\n'),
	's/whole.api.yaml': api('whole', 'm', ['responses: [{ status: 200, model: o }]']),
	's/trim.api.yaml': api('trim', 'm', ['request: { model: o, omit: [o-id, o-total] }']),
	's/own.api.yaml': api('own', 's', [
		'request: { fields: [{ id: q-note, name: comment, type: string, to: [o-note] }] }',
		'responses: [{ status: 200, fields: [{ id: r-sum, name: sum, type: decimal, from: [o-total] }] }]'
	])
});

describe('api bodies', () => {
	it('carries all of a model, less omit, or only pick', () => {
		expect(bodyFields(model, { model: 'o' })).toEqual(['o-id', 'o-total', 'o-note']);
		expect(bodyFields(model, { model: 'o', omit: ['o-id'] })).toEqual(['o-total', 'o-note']);
		expect(bodyFields(model, { model: 'o', pick: ['o-note'] })).toEqual(['o-note']);
		expect(bodyFields(model, { fields: [] })).toEqual([]);
	});

	it('knows which bodies send into or return each model field, and through which api field', () => {
		const uses = apiUses(model);
		expect(uses.fedBy.get('o-note')).toEqual([
			{ api: 'own', part: 'request', via: 'q-note' },
			{ api: 'trim', part: 'request' }
		]);
		expect(uses.fedBy.get('o-id')).toBeUndefined();
		expect(uses.returnedBy.get('o-total')).toEqual([
			{ api: 'own', part: 200, via: 'r-sum' },
			{ api: 'whole', part: 200 }
		]);
	});

	it('lists the models a body uses, with the fields a trimmed one keeps', () => {
		expect(bodyModels(model, 'trim')).toEqual([
			{ part: 'request', model: 'o', fields: ['o-note'] }
		]);
		expect(bodyModels(model, 'own')).toEqual([]);
	});
});

describe('api rail', () => {
	it('needs no headings for a box’s own apis, and groups apis moved up by their owner', () => {
		expect(railGroups(model, 'm', ['whole', 'trim'])).toEqual([{ apis: ['whole', 'trim'] }]);
		expect(railGroups(model, 's', ['whole', 'own', 'trim'])).toEqual([
			{ title: 's', apis: ['own'] },
			{ title: 'Orders', apis: ['whole', 'trim'] }
		]);
	});

	it('shrinks the rows to fit the rail, however many there are', () => {
		const few = railOf(model, [{ apis: ['whole'] }], 400);
		expect(few.scale).toBe(1);
		const many = Array.from({ length: 60 }, () => 'whole');
		const crowded = railOf(model, [{ apis: many }], 400);
		expect(crowded.scale).toBeCloseTo((400 * (1 - 2 * RAIL.inset)) / (RAIL.head + 60 * RAIL.row));
		expect(crowded.width).toBeCloseTo(few.width * crowded.scale);
	});

	it('finds an api’s row below the header and group headings', () => {
		const rail = railOf(model, railGroups(model, 's', ['own', 'whole', 'trim']), 400);
		expect(railRowY(rail, 'trim')).toBe(RAIL.head + 2 * RAIL.group + 2.5 * RAIL.row);
		expect(railRowY(rail, 'nope')).toBeUndefined();
	});
});
