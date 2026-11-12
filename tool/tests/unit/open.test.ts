import { describe, expect, it } from 'vitest';
import type { LandscapeBox } from '../../src/lib/landscape/layout';
import { openBoxes, type Camera } from '../../src/lib/landscape/open';

const box = (id: string, absX: number, absY: number, size: number, parentId?: string) =>
	({ id, absX, absY, width: size, height: size, group: true, parentId }) as LandscapeBox;
// Two systems side by side, one module in the first.
const boxes = [box('a', 0, 0, 100), box('m', 10, 10, 40, 'a'), box('b', 200, 0, 100)];
const cam = (x: number, y: number, zoom: number): Camera => ({
	x,
	y,
	zoom,
	width: 1000,
	height: 1000
});
const open = (c: Camera) => [...openBoxes(boxes, c)].sort();

describe('open boxes', () => {
	it('keeps every box closed in the overview', () => {
		expect(open(cam(0, 0, 1.5))).toEqual([]);
	});

	it('opens a box that is large and in view, not one the same size off screen', () => {
		// a spans 400px of 1000, fully in view; m inside it 160px; b only 50px in view.
		expect(open(cam(150, 0, 4))).toEqual(['a']);
	});

	it('opens and closes at the same share seen: 20%', () => {
		// a spans 600px; 120px (20%) in view opens it, 114px (19%) closes it.
		expect(open(cam(-480, 0, 6))).toContain('a');
		expect(open(cam(-486, 0, 6))).not.toContain('a');
	});

	it('keeps a box open while it covers the canvas, however little of it is seen', () => {
		// a spans 5000px; the canvas shows a 1000px corner of it, past m.
		expect(open(cam(-4000, -4000, 50))).toEqual(['a']);
	});

	it('opens the boxes round a box that opens', () => {
		// m spans 800px fully in view.
		expect(open(cam(-200, -200, 20))).toEqual(['a', 'm']);
	});
});
