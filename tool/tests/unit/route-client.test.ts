import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { layoutLandscape } from '../../src/lib/landscape/layout';
import {
	loadRouter,
	routeKey,
	routeLines,
	type Rect,
	type RouteEnd,
	type RouteLine
} from '../../src/lib/landscape/route';
import { RouteClient, type RoutePort } from '../../src/lib/landscape/route-client';
import { routeService, type ToRouter } from '../../src/lib/landscape/route-service';
import { loadDesign } from '../../src/lib/model/loader';

beforeAll(() => loadRouter());

/** route-worker.ts in this thread: messages copied both ways as a worker's are, a task later. */
class InProcess implements RoutePort {
	onmessage: RoutePort['onmessage'] = null;
	onerror: RoutePort['onerror'] = null;
	sent: ToRouter[] = [];
	private serve = routeService((m) =>
		setTimeout(() => this.onmessage?.({ data: structuredClone(m) }))
	);
	postMessage(m: ToRouter) {
		this.sent.push(m);
		const copy = structuredClone(m);
		setTimeout(() => void this.serve(copy));
	}
	terminate() {}
	/** The keys of the lines it was asked to route, in order. */
	routed() {
		return this.sent.flatMap((m) => (m.type === 'route' ? [routeKey(m.lines)] : []));
	}
}

const rect = (x0: number, y0: number, w: number, h: number): Rect => ({
	x0,
	y0,
	x1: x0 + w,
	y1: y0 + h
});
const on = (id: string, r: Rect, y = (r.y0 + r.y1) / 2): RouteEnd => ({
	on: id,
	x0: r.x0,
	x1: r.x1,
	y,
	sides: ['l', 'r']
});

/** The example design's lines between cards, ends on their boxes' middles, among its cards. */
function example() {
	const root = fileURLToPath(new URL('../../../examples/commerce', import.meta.url));
	const walk = (dir: string): string[] =>
		readdirSync(dir).flatMap((name) => {
			const abs = path.join(dir, name);
			return statSync(abs).isDirectory() ? walk(abs) : [abs];
		});
	const { model } = loadDesign(
		walk(root).map((abs) => ({
			path: path.relative(root, abs).split(path.sep).join('/'),
			text: readFileSync(abs, 'utf8')
		}))
	);
	const { boxes: laid, lines: laidLines } = layoutLandscape(model);
	const byId = new Map(laid.map((b) => [b.id, b]));
	const boxes = new Map(
		laid.filter((b) => !b.group).map((b) => [b.id, rect(b.absX, b.absY, b.width, b.height)])
	);
	const end = (id: string): RouteEnd => {
		const b = byId.get(id)!;
		const r = rect(b.absX, b.absY, b.width, b.height);
		return boxes.has(id) ? on(id, r) : { ...on(id, r), on: undefined, sides: ['r'] };
	};
	const lines: RouteLine[] = laidLines.map((l) => ({
		id: l.id,
		s: end(l.source),
		t: end(l.target)
	}));
	// What lights looking at each card: its own lines, routed apart from the rest.
	const looks = [...boxes].map(([id, r]) => ({
		x: (r.x0 + r.x1) / 2,
		y: (r.y0 + r.y1) / 2,
		lines: () => lines.filter((l) => l.s.on === id || l.t.on === id)
	}));
	return { boxes, lines, looks };
}

describe('RouteClient', () => {
	it('routes in workers exactly as on the page, now and ahead', async () => {
		const { boxes, lines, looks } = example();
		expect(lines.length).toBeGreaterThan(5);
		const client = new RouteClient(new InProcess(), new InProcess());
		await client.ready;
		const key = routeKey(lines);
		const done = vi.fn();
		client.want(boxes, key, lines, done);
		await vi.waitFor(() => expect(done).toHaveBeenCalled());
		expect(client.get(boxes, key)).toEqual(routeLines(boxes, lines));

		client.ahead(boxes, looks, { x: 0, y: 0 });
		const lit = looks.map((l) => l.lines()).filter((ls) => ls.length);
		expect(lit.length).toBeGreaterThan(3);
		await vi.waitFor(() => {
			for (const ls of lit) expect(client.get(boxes, routeKey(ls))).toBeDefined();
		});
		for (const ls of lit) expect(client.get(boxes, routeKey(ls))).toEqual(routeLines(boxes, ls));
		client.destroy();
	});

	const boxes = new Map([
		['a', rect(0, 0, 100, 60)],
		['b', rect(300, 0, 100, 60)],
		['c', rect(0, 300, 100, 60)]
	]);
	const line = (id: string, s: string, t: string, y = 30): RouteLine => ({
		id,
		s: on(s, boxes.get(s)!, boxes.get(s)!.y0 + y),
		t: on(t, boxes.get(t)!, boxes.get(t)!.y0 + y)
	});

	it('routes the newest of what is wanted', async () => {
		const now = new InProcess();
		const client = new RouteClient(now, new InProcess());
		const done = vi.fn();
		const want = (ls: RouteLine[]) => client.want(boxes, routeKey(ls), ls, done);
		const [first, stale, lit] = [
			[line('x', 'a', 'b')],
			[line('x', 'a', 'c')],
			[line('x', 'b', 'c')]
		];
		want(first);
		want(stale);
		want(lit);
		await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(2));
		expect(now.routed()).toEqual([routeKey(first), routeKey(lit)]);
		// Kept: wanting them again routes nothing.
		want(lit);
		expect(now.routed()).toHaveLength(2);
		expect(client.get(boxes, routeKey(stale))).toBeUndefined();
		client.destroy();
	});

	it('routes ahead the nearest first, skipping looks without lines or routed already', async () => {
		const later = new InProcess();
		const client = new RouteClient(new InProcess(), later);
		const ab = [line('x', 'a', 'b')];
		const ac = [line('y', 'a', 'c')];
		const looks = [
			{ x: 350, y: 30, lines: () => ab },
			{ x: 50, y: 330, lines: () => ac },
			{ x: 50, y: 30, lines: () => [] },
			{ x: 340, y: 30, lines: () => ab }
		];
		client.ahead(boxes, looks, { x: 50, y: 400 });
		await vi.waitFor(() => expect(client.get(boxes, routeKey(ab))).toBeDefined());
		expect(later.routed()).toEqual([routeKey(ac), routeKey(ab)]);
		client.destroy();
	});

	it('forgets what was routed among other boxes, not among the same boxes rebuilt', async () => {
		const client = new RouteClient(new InProcess(), new InProcess());
		const ls = [line('x', 'a', 'b')];
		const key = routeKey(ls);
		const done = vi.fn();
		client.want(boxes, key, ls, done);
		await vi.waitFor(() => expect(done).toHaveBeenCalled());
		expect(client.get(new Map(boxes), key)).toBeDefined();
		const moved = new Map([...boxes, ['c', rect(150, -100, 100, 300)]]);
		expect(client.get(moved, key)).toBeUndefined();
		client.want(moved, key, ls, done);
		expect(client.get(boxes, key)).toBeUndefined();
		await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(2));
		expect(client.get(moved, key)).toEqual(routeLines(moved, ls));
		expect(client.get(moved, '')).toEqual(new Map());
		client.destroy();
	});

	it('finds what was routed among boxes again on going back to them, routing nothing', async () => {
		const now = new InProcess();
		const client = new RouteClient(now, new InProcess());
		const ls = [line('x', 'a', 'b')];
		const key = routeKey(ls);
		const done = vi.fn();
		client.want(boxes, key, ls, done);
		await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1));
		// A focus: other boxes, its lines routed among them.
		const focus = new Map([
			['a', boxes.get('a')!],
			['b', rect(200, 0, 100, 60)]
		]);
		client.want(focus, key, ls, done);
		await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(2));
		expect(now.routed()).toHaveLength(2);
		// Back to the whole landscape, rebuilt alike: kept, told at once.
		const back = new Map(boxes);
		client.want(back, key, ls, done);
		expect(done).toHaveBeenCalledTimes(3);
		expect(client.get(back, key)).toEqual(routeLines(boxes, ls));
		expect(now.routed()).toHaveLength(2);
		client.destroy();
	});

	it('keeps lines routed for boxes left meanwhile, for going back', async () => {
		const now = new InProcess();
		const client = new RouteClient(now, new InProcess());
		const ls = [line('x', 'a', 'b')];
		const key = routeKey(ls);
		const done = vi.fn();
		client.want(boxes, key, ls, done);
		// Left before they came, and back.
		client.want(new Map([['a', boxes.get('a')!]]), '', [], done);
		client.want(boxes, key, ls, done);
		await vi.waitFor(() => expect(client.get(boxes, key)).toBeDefined());
		expect(now.routed()).toHaveLength(1);
		client.destroy();
	});
});
