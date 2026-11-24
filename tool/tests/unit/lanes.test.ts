import { describe, expect, it } from 'vitest';
import { LANE, laneLines, lanePoints, tidy, type LaneLine } from '../../src/lib/landscape/lanes';
import type { Point, Rect } from '../../src/lib/landscape/route';

const pts = (...xy: number[]): Point[] =>
	Array.from({ length: xy.length / 2 }, (_, i) => ({ x: xy[2 * i], y: xy[2 * i + 1] }));
const line = (id: string, ...xy: number[]): LaneLine => ({ id, points: pts(...xy) });
/** Screen px between lanes at `zoom` with room to spare. */
const step = (zoom: number) => Math.min(Math.max(LANE.pitch * zoom, LANE.least), LANE.most);

/** Whether two routes cross: a level piece of one through an upright piece of the other. */
function cross(a: Point[], b: Point[]) {
	for (let i = 0; i + 1 < a.length; i++)
		for (let j = 0; j + 1 < b.length; j++)
			for (const [p, q] of [
				[
					[a[i], a[i + 1]],
					[b[j], b[j + 1]]
				],
				[
					[b[j], b[j + 1]],
					[a[i], a[i + 1]]
				]
			]) {
				const [h0, h1] = p;
				const [v0, v1] = q;
				if (h0.y !== h1.y || v0.x !== v1.x) continue;
				const inside = (v: number, s: number, t: number) =>
					v > Math.min(s, t) + 1e-6 && v < Math.max(s, t) - 1e-6;
				if (inside(v0.x, h0.x, h1.x) && inside(h0.y, v0.y, v1.y)) return true;
			}
	return false;
}

/** The pieces two routes both run along. */
function shared(a: Point[], b: Point[]) {
	let n = 0;
	for (let i = 0; i + 1 < a.length; i++)
		for (let j = 0; j + 1 < b.length; j++) {
			const [p, q, r, s] = [a[i], a[i + 1], b[j], b[j + 1]];
			const level = p.y === q.y && r.y === s.y && p.y === r.y;
			const upright = p.x === q.x && r.x === s.x && p.x === r.x;
			const [lo, hi] = level
				? [
						Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x)),
						Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x))
					]
				: upright
					? [
							Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y)),
							Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y))
						]
					: [0, 0];
			if (hi - lo > 0.5) n++;
		}
	return n;
}

describe('lanes', () => {
	it('drops repeated and straight-through points, but keeps a doubling back', () => {
		expect(tidy(pts(0, 0, 0, 0, 50, 0, 100, 0, 100, 40))).toEqual(pts(0, 0, 100, 0, 100, 40));
		expect(tidy(pts(0, 0, 50, 0, 20, 0))).toEqual(pts(0, 0, 50, 0, 20, 0));
	});

	it('leaves lines that share nothing on their routes', () => {
		const out = laneLines([line('a', 0, 0, 100, 0), line('b', 0, 20, 100, 20)], []);
		expect(out.get('a')!.lanes).toEqual([undefined]);
		expect(out.get('b')!.lanes).toEqual([undefined]);
	});

	it('puts lines out of one point side by side, the one turning up above', () => {
		const out = laneLines(
			[line('down', 0, 0, 150, 0, 150, 60), line('up', 0, 0, 100, 0, 100, -60)],
			[]
		);
		const [up, down] = [out.get('up')!, out.get('down')!];
		expect(up.lanes[0]).toMatchObject({ nx: 0, ny: -0.5, step: LANE.least });
		expect(down.lanes[0]).toMatchObject({ nx: 0, ny: 0.5 });
		// Their uprights share nothing: no lane.
		expect(up.lanes[1]).toBeUndefined();
		// Drawn: apart, both ends included, and not crossing.
		const [a, b] = [lanePoints(up, 1), lanePoints(down, 1)];
		expect(a[0]).toEqual({ x: 0, y: -step(1) / 2 });
		expect(b[0]).toEqual({ x: 0, y: step(1) / 2 });
		expect(shared(a, b)).toBe(0);
		expect(cross(a, b)).toBe(false);
	});

	it('nests lines turning the same way: the first to turn off on that side', () => {
		const out = laneLines(
			[line('far', 0, 0, 100, 0, 100, -60), line('near', 0, 0, 50, 0, 50, -60)],
			[]
		);
		expect(out.get('near')!.lanes[0]!.ny).toBe(-0.5);
		const [a, b] = [lanePoints(out.get('near')!, 1), lanePoints(out.get('far')!, 1)];
		expect(cross(a, b)).toBe(false);
	});

	it('keeps lines apart round corners they turn together, without crossing', () => {
		const lines = [
			line('a', 0, 0, 100, 0, 100, 100, 200, 100),
			line('b', 0, 0, 100, 0, 100, 200),
			line('c', -50, 0, 100, 0, 100, 100, 0, 100),
			line('d', 0, -40, 0, 0, 100, 0, 100, 150, 300, 150)
		];
		const out = laneLines(lines, []);
		const drawn = lines.map((l) => lanePoints(out.get(l.id)!, 1));
		for (let i = 0; i < drawn.length; i++)
			for (let j = i + 1; j < drawn.length; j++) {
				expect(shared(drawn[i], drawn[j]), `${lines[i].id} ${lines[j].id}`).toBe(0);
				expect(cross(drawn[i], drawn[j]), `${lines[i].id} ${lines[j].id}`).toBe(false);
			}
	});

	it('spreads lines along one trunk apart, and the middle one on it', () => {
		const trunk = [100, 0, 100, 100, 300, 100];
		const lines = [
			line('a', 0, -30, 100, -30, ...trunk.slice(0, 4), ...trunk.slice(2), 300, 140),
			line('b', 0, 0, ...trunk, 400, 100),
			line('c', 0, 30, 100, 30, ...trunk.slice(2), 300, 60)
		];
		const out = laneLines(lines, []);
		const drawn = lines.map((l) => lanePoints(out.get(l.id)!, 1));
		for (let i = 0; i < 3; i++)
			for (let j = i + 1; j < 3; j++) expect(shared(drawn[i], drawn[j])).toBe(0);
		expect(new Set(out.get('b')!.lanes.map((l) => l?.ny ?? l?.nx))).toContain(0);
	});

	it('closes lanes up zoomed out, as far as the boxes beside them leave room', () => {
		const boxes: Rect[] = [
			{ x0: 0, y0: -100, x1: 200, y1: -10 },
			{ x0: 0, y0: 10, x1: 200, y1: 100 }
		];
		const out = laneLines(
			[line('a', -50, 0, 250, 0, 250, -50), line('b', -50, 0, 250, 0, 250, 50)],
			boxes
		);
		const lane = out.get('a')!.lanes[0]!;
		// 10 px to either box, LANE.standoff kept: 6 px for half a step.
		expect(lane.room).toBeCloseTo((10 - LANE.standoff) / 0.5);
		for (const zoom of [2, 1, 0.5, 0.1, 0.01]) {
			const y = lanePoints(out.get('a')!, zoom)[1].y;
			expect(Math.abs(y)).toBeLessThanOrEqual(10 - LANE.standoff + 1e-9);
			// On screen: a step apart until the room runs out.
			expect(Math.abs(y * zoom)).toBeCloseTo(Math.min(step(zoom) / 2, 6 * zoom));
		}
	});

	it('leans lanes away from a box the route runs close beside', () => {
		// A box 8 px above the stretch, nothing below: the lanes spread downwards.
		const boxes: Rect[] = [{ x0: 0, y0: -100, x1: 200, y1: -8 }];
		// Each turns down at its own x: lanes 0 to 4. Their ends have room to slide.
		const lines = [0, 1, 2, 3, 4].map((k) => ({
			...line(`l${k}`, -50, 0, 250 + 10 * k, 0, 250 + 10 * k, 400),
			ends: [100, 100] as const
		}));
		const out = laneLines(lines, boxes);
		for (const zoom of [1, 0.5]) {
			const ys = lines.map((l) => lanePoints(out.get(l.id)!, zoom)[1].y);
			expect(Math.min(...ys)).toBeGreaterThanOrEqual(-(8 - LANE.standoff) - 1e-9);
			// Still a full step apart on screen.
			const sorted = [...ys].sort((a, b) => a - b);
			for (let i = 1; i < sorted.length; i++)
				expect((sorted[i] - sorted[i - 1]) * zoom).toBeCloseTo(step(zoom));
		}
	});

	it('slides an end no further than its line allows along what it ends on', () => {
		const lines = [
			{ ...line('a', 0, 0, 100, 0, 100, -50), ends: [1, 10] as const },
			line('b', 0, 0, 100, 0, 100, 50)
		];
		const out = laneLines(lines, []);
		expect(out.get('a')!.lanes[0]!.room).toBeCloseTo(2);
		expect(lanePoints(out.get('a')!, 0.01)[0].y).toBeCloseTo(-1);
	});

	it('shifts a corner no more than half the piece it bends into', () => {
		const out = laneLines(
			[line('a', 0, 0, 100, 0, 100, -6, 200, -6), line('b', 0, 0, 100, 0, 100, 50)],
			[]
		);
		// The 6 px jog keeps at least half: a half step shifts its end 3 px at most.
		expect(out.get('a')!.lanes[0]!.room).toBeLessThanOrEqual(6 - 1);
	});
});
