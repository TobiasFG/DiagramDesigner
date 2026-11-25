import { beforeAll, describe, expect, it } from 'vitest';
import {
	boxesNear,
	clearanceOf,
	loadRouter,
	ROUTE,
	routeKey,
	routeLines,
	type Point,
	type Rect
} from '../../src/lib/landscape/route';

beforeAll(() => loadRouter());

const rect = (x0: number, y0: number, w: number, h: number): Rect => ({
	x0,
	y0,
	x1: x0 + w,
	y1: y0 + h
});
/** Whether a segment runs through a box. */
const hits = (a: Point, b: Point, r: Rect) =>
	Math.max(a.x, b.x) > r.x0 &&
	Math.min(a.x, b.x) < r.x1 &&
	Math.max(a.y, b.y) > r.y0 &&
	Math.min(a.y, b.y) < r.y1;

describe('routeLines', () => {
	const boxes = new Map([
		['a', rect(0, 0, 100, 60)],
		['mid', rect(150, -20, 100, 120)],
		['b', rect(300, 0, 100, 60)]
	]);
	const end = (on: string) => {
		const r = boxes.get(on)!;
		return { on, x0: r.x0, x1: r.x1, y: 30, sides: ['l', 'r'] as const };
	};

	it('runs right-angled from facing sides round the box between', () => {
		const pts = routeLines(boxes, [{ id: 'x', s: end('a'), t: end('b') }]).get('x')!;
		expect(pts[0]).toEqual({ x: 100, y: 30 });
		expect(pts.at(-1)).toEqual({ x: 300, y: 30 });
		for (let i = 1; i < pts.length; i++) {
			const [p, q] = [pts[i - 1], pts[i]];
			expect(p.x === q.x || p.y === q.y).toBe(true);
			expect(hits(p, q, boxes.get('mid')!)).toBe(false);
		}
	});

	it('ends a line on its rows when they sit at different heights', () => {
		// Facing cards with a narrow gap: the line must step between the rows, not be slid
		// along the cards' sides into one straight run that ends on neither row.
		const cards = new Map([
			['t', rect(300, 150, 93, 130)],
			['s', rect(441, 200, 259, 600)]
		]);
		const pts = routeLines(cards, [
			{
				id: 'x',
				s: { on: 's', x0: 441, x1: 700, y: 443, sides: ['l', 'r'] },
				t: { on: 't', x0: 300, x1: 393, y: 244, sides: ['l', 'r'] }
			}
		]).get('x')!;
		expect(pts[0]).toEqual({ x: 441, y: 443 });
		expect(pts.at(-1)).toEqual({ x: 393, y: 244 });
	});

	it('spreads lines running side by side', () => {
		const r = routeLines(boxes, [
			{ id: 'x', s: end('a'), t: end('b') },
			{ id: 'y', s: end('a'), t: end('b') }
		]);
		const across = (pts: Point[]) => pts.find((p, i) => i && p.y === pts[i - 1].y && p.y < 0)!.y;
		expect(Math.abs(across(r.get('x')!) - across(r.get('y')!))).toBeGreaterThanOrEqual(4);
	});

	it('runs a pair joining two ends both ways side by side, not on itself', () => {
		const r = routeLines(
			new Map([
				['a', boxes.get('a')!],
				['b', boxes.get('b')!]
			]),
			[
				{ id: 'x', s: end('a'), t: end('b') },
				{ id: 'y', s: end('b'), t: end('a') }
			]
		);
		const [x, y] = [r.get('x')!, r.get('y')!];
		expect(Math.abs(x[0].y - y.at(-1)!.y)).toBeGreaterThanOrEqual(ROUTE.spread);
		expect(Math.abs(x.at(-1)!.y - y[0].y)).toBeGreaterThanOrEqual(ROUTE.spread);
	});

	it('ends a line on a bare point even where a free end has no room', () => {
		// 12 px right of a box: closer than a free end's speck and the box can both keep clear of.
		const pts = routeLines(boxes, [
			{ id: 'x', s: end('a'), t: { point: true, x0: 412, x1: 412, y: 30, sides: [] } }
		]).get('x')!;
		expect(pts.at(-1)).toEqual({ x: 412, y: 30 });
		for (let i = 1; i < pts.length; i++)
			expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true);
	});

	it('ends a free end on the side asked', () => {
		const pts = routeLines(boxes, [
			{ id: 'x', s: end('a'), t: { x0: 500, x1: 600, y: 30, sides: ['l'] } }
		]).get('x')!;
		expect(pts.at(-1)).toEqual({ x: 500, y: 30 });
	});
});

/** How near a straight piece comes to a box. */
const distance = (a: Point, b: Point, r: Rect) =>
	Math.hypot(
		Math.max(r.x0 - Math.max(a.x, b.x), Math.min(a.x, b.x) - r.x1, 0),
		Math.max(r.y0 - Math.max(a.y, b.y), Math.min(a.y, b.y) - r.y1, 0)
	);

describe('clearance', () => {
	it('is buffer for a card and a share of the shorter side for a large box', () => {
		expect(clearanceOf(200, 60)).toBe(ROUTE.buffer);
		expect(clearanceOf(5000, 3000)).toBe(Math.round(3000 * ROUTE.share));
	});

	it('keeps lines a large box’s clearance off it, and still ends them on boxes’ sides', () => {
		const boxes = new Map<string, Rect>([
			['a', rect(0, 0, 100, 60)],
			['big', { ...rect(150, -200, 200, 460), clear: 40 }],
			['b', rect(400, 0, 100, 60)]
		]);
		const pts = routeLines(boxes, [
			{
				id: 'x',
				s: { on: 'a', x0: 0, x1: 100, y: 30, sides: ['r'] },
				t: { on: 'b', x0: 400, x1: 500, y: 30, sides: ['l'] }
			}
		]).get('x')!;
		expect(pts[0]).toEqual({ x: 100, y: 30 });
		expect(pts.at(-1)).toEqual({ x: 400, y: 30 });
		for (let i = 1; i < pts.length; i++)
			expect(distance(pts[i - 1], pts[i], boxes.get('big')!)).toBeGreaterThanOrEqual(40);
	});
});

describe('frames', () => {
	// Two open modules side by side, 40 apart, cards 32 inside. The line from `a` down to `b`
	// runs between `a2` and `b`, whose middle is right on module `m`'s right edge.
	const cards = new Map([
		['a', rect(32, 40, 68, 60)],
		['a2', rect(32, 300, 196, 60)],
		['c', rect(372, 40, 236, 60)],
		['b', rect(372, 300, 236, 60)]
	]);
	const frames = new Map([
		['frame:m', { ...rect(0, 0, 300, 400), frame: true }],
		['frame:n', { ...rect(340, 0, 300, 400), frame: true }]
	]);
	const card = (on: string, y: number) => {
		const r = cards.get(on)!;
		return { on, x0: r.x0, x1: r.x1, y, sides: ['l', 'r'] as const };
	};
	const lines = [{ id: 'x', s: card('a', 70), t: card('b', 330) }];
	/** How near each upright piece comes to an upright edge of a frame. */
	const nearest = (pts: Point[]) =>
		Math.min(
			...pts.slice(1).flatMap((p, i) => {
				const q = pts[i];
				if (p.x !== q.x) return [];
				return [...frames.values()].flatMap((f) => [Math.abs(p.x - f.x0), Math.abs(p.x - f.x1)]);
			})
		);

	it('runs a line right along a frame edge when not told of the frames', () => {
		expect(nearest(routeLines(cards, lines).get('x')!)).toBe(0);
	});

	it('keeps a line crossing frames off their edges, and clear of the boxes', () => {
		const pts = routeLines(new Map([...cards, ...frames]), lines).get('x')!;
		expect(nearest(pts)).toBeGreaterThanOrEqual(ROUTE.buffer);
		expect(pts[0]).toEqual({ x: 100, y: 70 });
		expect(pts.at(-1)).toEqual({ x: 372, y: 330 });
		for (let i = 1; i < pts.length; i++) {
			expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true);
			for (const r of cards.values()) expect(hits(pts[i - 1], pts[i], r)).toBe(false);
		}
	});

	it('moves the lines running beside it with it, keeping them apart', () => {
		const two = [
			{ id: 'x', s: card('a', 60), t: card('b', 320) },
			{ id: 'y', s: card('a', 80), t: card('b', 340) }
		];
		const r = routeLines(new Map([...cards, ...frames]), two);
		const [x, y] = [r.get('x')!, r.get('y')!];
		expect(Math.min(nearest(x), nearest(y))).toBeGreaterThanOrEqual(ROUTE.buffer - 1e-9);
		const upright = (pts: Point[]) => pts.find((p, i) => i && p.x === pts[i - 1].x)!.x;
		expect(Math.abs(upright(x) - upright(y))).toBeGreaterThanOrEqual(ROUTE.spread);
	});

	it('keeps a large frame’s clearance off its edges', () => {
		const big = new Map(
			[...frames].map(([id, f]) => [id, id === 'frame:m' ? { ...f, clear: 20 } : f])
		);
		const pts = routeLines(new Map([...cards, ...big]), lines).get('x')!;
		const upright = pts.find((p, i) => i && p.x === pts[i - 1].x)!.x;
		expect(Math.abs(upright - 300)).toBeGreaterThanOrEqual(20);
		expect(Math.abs(upright - 340)).toBeGreaterThanOrEqual(ROUTE.buffer);
	});

	it('does the best it can where frames leave too little room', () => {
		// `a2` reaches 32 of `m`'s edge and both frames want 30: nowhere is clear of them all.
		const tight = new Map([...cards, ['a2', rect(32, 300, 236, 60)]]);
		const wide = new Map([...frames].map(([id, f]) => [id, { ...f, clear: 30 }]));
		const pts = routeLines(new Map([...tight, ...wide]), lines).get('x')!;
		const upright = pts.find((p, i) => i && p.x === pts[i - 1].x)!.x;
		expect(Math.min(Math.abs(upright - 300), Math.abs(upright - 340))).toBeGreaterThanOrEqual(20);
		for (let i = 1; i < pts.length; i++)
			for (const r of [tight.get('a2')!, tight.get('c')!])
				expect(distance(pts[i - 1], pts[i], r)).toBeGreaterThanOrEqual(ROUTE.buffer);
	});

	it('leaves lines that keep off the edges as they are', () => {
		const wide = new Map([['frame:m', { ...rect(-100, -100, 1000, 1000), frame: true }]]);
		expect(routeLines(new Map([...cards, ...wide]), lines)).toEqual(routeLines(cards, lines));
	});
});

describe('boxesNear', () => {
	const at = (x0: number, x1: number, y: number, on?: string) => ({
		on,
		x0,
		x1,
		y,
		sides: ['l', 'r'] as const
	});
	const line = (s: ReturnType<typeof at>, t: ReturnType<typeof at>) => ({ id: 'x', s, t });

	it('keeps the boxes round the ends and those meeting them, and drops the far ones', () => {
		const boxes = new Map([
			['a', rect(0, 0, 100, 60)],
			['b', rect(300, 0, 100, 60)],
			// Meets the rectangle round the ends.
			['tall', rect(150, 60 + ROUTE.room - 1, 100, 400)],
			// Meets it only once it has grown round `tall`.
			['below', rect(150, 60 + 2 * ROUTE.room + 400 - 2, 100, 60)],
			['far', rect(5000, 5000, 100, 60)]
		]);
		const near = boxesNear(boxes, [line(at(0, 100, 30, 'a'), at(300, 400, 30, 'b'))]);
		expect([...near.keys()].sort()).toEqual(['a', 'b', 'below', 'tall']);
	});

	it('keeps the boxes round a free end', () => {
		const boxes = new Map([
			['a', rect(0, 0, 100, 60)],
			['x', rect(1000, 0, 100, 60)],
			['far', rect(1000, 1000, 100, 60)]
		]);
		const near = boxesNear(boxes, [line(at(0, 100, 30, 'a'), at(1000, 1100, 30))]);
		expect([...near.keys()].sort()).toEqual(['a', 'x']);
	});

	it('is empty without lines', () => {
		expect(boxesNear(new Map([['a', rect(0, 0, 10, 10)]]), []).size).toBe(0);
	});

	it('leaves routes round the boxes near them as they are', () => {
		const near = new Map([
			['a', rect(0, 0, 100, 60)],
			['mid', rect(150, -20, 100, 120)],
			['b', rect(300, 0, 100, 60)]
		]);
		const far = Array.from({ length: 40 }, (_, i) => ['f' + i, rect(2000 + i * 150, 0, 100, 60)]);
		const lines = [line(at(0, 100, 30, 'a'), at(300, 400, 40, 'b'))];
		const all = new Map([...near, ...(far as [string, Rect][])]);
		expect(boxesNear(all, lines)).toEqual(near);
		const pts = routeLines(all, lines).get('x')!;
		expect(pts.length).toBeGreaterThan(2);
		expect(routeLines(near, lines)).toEqual(routeLines(all, lines));
	});
});

describe('routeKey', () => {
	const end = (on: string, y: number) => ({ on, x0: 0, x1: 100, y, sides: ['l', 'r'] as const });
	const lines = [{ id: 'x', s: end('a', 30), t: end('b', 30) }];

	it('is the same for the same lines, and differs as an end moves', () => {
		expect(routeKey(structuredClone(lines))).toBe(routeKey(lines));
		expect(routeKey([{ ...lines[0], t: end('b', 43) }])).not.toBe(routeKey(lines));
	});

	it('is empty for no lines', () => {
		expect(routeKey([])).toBe('');
	});
});
