import { describe, expect, it } from 'vitest';
import type { LandscapeBox } from '../../src/lib/landscape/layout';
import { apiHosts, openBoxes, type Camera } from '../../src/lib/landscape/open';

const box = (
	id: string,
	absX: number,
	absY: number,
	size: number,
	parentId?: string,
	kind: 'group' | 'leaf' | 'table' = 'group'
) =>
	({
		id,
		absX,
		absY,
		width: size,
		height: size,
		group: kind === 'group',
		table: kind === 'table' ? [] : undefined,
		parentId
	}) as LandscapeBox;
// Two systems side by side: a holds module m (its name 34px at zoom 1), which holds a model
// card (rows 13px); b holds a leaf (name 15px).
const boxes = [
	box('a', 0, 0, 1000),
	box('m', 50, 50, 400, 'a'),
	box('t', 100, 150, 100, 'm', 'table'),
	box('b', 2000, 0, 1000),
	box('l', 2100, 100, 100, 'b', 'leaf')
];
const cam = (x: number, y: number, zoom: number): Camera => ({
	x,
	y,
	zoom,
	width: 1000,
	height: 1000
});
const open = (c: Camera) => [...openBoxes(boxes, c)].sort();

describe('open boxes', () => {
	it('keeps a box closed while its children would be drawn under 12px', () => {
		// m's name 34 × 0.3 = 10.2px.
		expect(open(cam(0, 0, 0.3))).toEqual([]);
	});

	it('opens a box once its children read at 12px, each box by its own children', () => {
		// m's name 12.2px opens a; b's leaf 5.4px keeps b closed though it is in view.
		expect(open(cam(0, 0, 0.36))).toEqual(['a']);
	});

	it('opens and closes at the same size: model rows at 12px', () => {
		// Rows 13 × 0.93 = 12.1px opens m; 13 × 0.92 = 11.96px closes it.
		expect(open(cam(0, 0, 0.93))).toEqual(['a', 'm']);
		expect(open(cam(0, 0, 0.92))).toEqual(['a']);
	});

	it('keeps a box closed while none of it is on screen', () => {
		// At zoom 1 b's leaf reads, but b starts at 2000px; then panned to b, a is off screen.
		expect(open(cam(0, 0, 1))).toEqual(['a', 'm']);
		expect(open(cam(-1500, 0, 1))).toEqual(['b']);
	});

	it('keeps a box open while any of it is on screen, its children not', () => {
		// a spans 50000px; the canvas shows a corner of it past m.
		expect(open(cam(-45000, -45000, 50))).toEqual(['a']);
	});
});

describe('api hosts', () => {
	const withApis = [{ ...boxes[0], apis: ['a1'] }, { ...boxes[1], apis: ['m1', 'm2'] }, boxes[2]];
	it('draws an api on its parent box while that box is shown', () => {
		expect(apiHosts(withApis, new Set(['a']))).toEqual(
			new Map([
				['a', ['a1']],
				['m', ['m1', 'm2']]
			])
		);
	});

	it('moves an api to the nearest shown box round its hidden parent', () => {
		expect(apiHosts(withApis, new Set())).toEqual(new Map([['a', ['a1', 'm1', 'm2']]]));
	});
});
