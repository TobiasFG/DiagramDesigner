import { AvoidLib } from 'libavoid-js';
import { LANE } from './lanes';

/**
 * Lines routed by libavoid: right-angled, round every box in the way, and lines running side
 * by side spread apart. libavoid is WebAssembly, so it is loaded once before any routing. The
 * app routes in workers (see route-client.ts).
 */

export interface Rect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	/**
	 * Room lines keep clear of it, in canvas px: `buffer` when not given, never less. Larger
	 * boxes keep more (see `clearanceOf`), so a line stays visibly off them zoomed out too.
	 */
	clear?: number;
	/**
	 * An open box, drawn round the boxes inside it: lines cross it freely, but keep `clear` off
	 * its edges instead of running along them, hidden by its border (see `clearFrames`).
	 */
	frame?: boolean;
}

export type Side = 'l' | 'r';

/**
 * One end of a line, at height `y`. On a box lines go round (`on`), it leaves by whichever
 * of `sides` routes best; else it is a free point on side `sides[0]` of `x0`…`x1`, or with
 * `point`, a bare point at `x0`.
 */
export interface RouteEnd {
	on?: string;
	/**
	 * A bare point at `x0`, `y`, met from any side: no speck of a box round it, so it can sit
	 * as close to boxes as a line can run.
	 */
	point?: boolean;
	x0: number;
	x1: number;
	y: number;
	sides: readonly Side[];
}

export interface RouteLine {
	id: string;
	s: RouteEnd;
	t: RouteEnd;
}

export type Point = { x: number; y: number };

/**
 * Room kept between a line and a box at least, and between lines side by side (the lanes'
 * pitch, so routes are planned with the room lanes take), in canvas px; `share` of a box's
 * shorter side is kept clear of it when that is more than `buffer` (see `clearanceOf`); `room`
 * is kept clear round the boxes a set of lines is routed among (see `boxesNear`).
 */
export const ROUTE = { buffer: 8, spread: LANE.pitch, share: 0.01, room: 64 };

/**
 * Where the lines at rest among a box's children are first seen: on a screen `width` by
 * `height`, once the box covers `share` of it (the Settings' default), or for the top-level
 * boxes, with the whole landscape fitted, `pad` of it spare.
 */
const SEEN = { width: 1440, height: 900, share: 0.25, pad: 0.1 };

/**
 * Canvas px between the lines at rest among the children of a box `width` by `height` (`top`:
 * among the top-level boxes, the landscape that size): `spread`, or more where they are first
 * seen zoomed out, so they are `LANE.least` px apart on screen there. The layout leaves the
 * room and the router spaces them so.
 */
export function pitchOf(width: number, height: number, top = false): number {
	const zoom = top
		? Math.min(SEEN.width / width, SEEN.height / height) / (1 + SEEN.pad)
		: Math.sqrt((SEEN.share * SEEN.width * SEEN.height) / (width * height));
	return Math.max(ROUTE.spread, Math.ceil(LANE.least / zoom));
}

/**
 * The room lines keep clear of a box `width` by `height`: `share` of its shorter side, at least
 * `buffer`, in whole px. A card keeps `buffer`; a large system keeps tens of px, so its lines
 * stand off its border at the zoom it is seen at. The layout leaves that much more room round
 * the box and inside it.
 */
export const clearanceOf = (width: number, height: number) =>
	Math.max(ROUTE.buffer, Math.round(ROUTE.share * Math.min(width, height)));

/** The room lines keep clear of `r`. */
const clearOf = (r: Rect) => Math.max(ROUTE.buffer, r.clear ?? 0);

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- an Emscripten binding
let avoid: any;

/** Loads libavoid; from `wasmUrl` in a page, from the package next to it in Node. */
export async function loadRouter(wasmUrl?: string) {
	if (avoid) return;
	await AvoidLib.load(wasmUrl);
	avoid = AvoidLib.getInstance();
}

export const routerReady = () => !!avoid;

/**
 * The boxes lines are routed round: those meeting the rectangle round the lines' ends and the
 * boxes they end on, grown to hold each with `room` to spare, until no other box meets it.
 * Every box left out lies wholly outside it, and a line never needs to leave it (it can run
 * round its edge, clear of every box inside), so the lines route the same without them. What
 * libavoid costs grows with every box it is given, and most of a large landscape's boxes are
 * far from the few lines lit at a time.
 */
export function boxesNear(
	boxes: Map<string, Rect>,
	lines: RouteLine[],
	room: number = ROUTE.room
): Map<string, Rect> {
	const out = new Map<string, Rect>();
	if (!lines.length) return out;
	const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
	const grow = (a: Rect) => {
		r.x0 = Math.min(r.x0, a.x0 - room);
		r.y0 = Math.min(r.y0, a.y0 - room);
		r.x1 = Math.max(r.x1, a.x1 + room);
		r.y1 = Math.max(r.y1, a.y1 + room);
	};
	for (const l of lines)
		for (const e of [l.s, l.t]) {
			grow({ x0: e.x0, y0: e.y, x1: e.x1, y1: e.y });
			const on = e.on === undefined ? undefined : boxes.get(e.on);
			if (on) grow(on);
		}
	for (let added = true; added;) {
		added = false;
		for (const [id, b] of boxes)
			if (!out.has(id) && b.x0 < r.x1 && b.x1 > r.x0 && b.y0 < r.y1 && b.y1 > r.y0) {
				out.set(id, b);
				grow(b);
				added = true;
			}
	}
	return out;
}

/**
 * Each line's corners, start and end included, by line id. Lines round `boxes` by id (those
 * near them: see `boxesNear`), and keep off the edges of those that are frames, each box's
 * `clear` away, and `spread` apart. With `shareEnds`, lines leaving one end run as one line
 * from it, else they spread apart there too.
 */
export function routeLines(
	boxes: Map<string, Rect>,
	lines: RouteLine[],
	shareEnds = false,
	spread = ROUTE.spread
): Map<string, Point[]> {
	const A = avoid;
	const router = new A.Router(A.OrthogonalRouting);
	router.setRoutingParameter(A.shapeBufferDistance, ROUTE.buffer);
	router.setRoutingParameter(A.idealNudgingDistance, spread);
	// A bend costs as much as this many px of line, so lines take few.
	router.setRoutingParameter(A.segmentPenalty, 50);
	// A line's end stays on its row: nudging the segments at a box slides ends along its side,
	// and can straighten a step between two rows into one run that ends on neither.
	router.setRoutingOption(A.nudgeOrthogonalSegmentsConnectedToShapes, false);
	router.setRoutingOption(A.nudgeOrthogonalTouchingColinearSegments, true);
	// No crossing penalty: libavoid calls it experimental, and it doubles the time lines take
	// together. Nudging still orders lines in a shared channel so they cross no more than needed.
	router.setRoutingOption(A.nudgeSharedPathsWithCommonEndPoint, !shareEnds);
	// No unifying pass before nudging: it only slides segments within their channels (lines
	// keep their bends and length), but costs more than all else together, and grows so fast
	// with the lines in a channel that a group of 100 lines took minutes and 200 never ended.
	router.setRoutingOption(A.performUnifyingNudgingPreprocessingStep, false);
	const temps: unknown[] = [];
	const temp = <T>(o: T) => (temps.push(o), o);
	const pt = (x: number, y: number) => temp(new A.Point(x, y));

	// libavoid keeps one room round every box, `buffer`: a box keeping more is given to it grown
	// by the rest, and lines ending on it are drawn on to its side afterwards.
	const solid = new Map<string, Rect>();
	const grown = new Map<string, Rect>();
	const frames: Rect[] = [];
	for (const [id, r] of boxes) {
		if (r.frame) {
			frames.push(r);
			continue;
		}
		const g = clearOf(r) - ROUTE.buffer;
		solid.set(id, r);
		grown.set(id, g ? { x0: r.x0 - g, y0: r.y0 - g, x1: r.x1 + g, y1: r.y1 + g } : r);
	}
	const near = boxesNear(grown, lines);

	const shapes = new Map<string, unknown>();
	const shape = (id: string, r: Rect) =>
		shapes.get(id) ??
		shapes
			.set(id, new A.ShapeRef(router, temp(new A.Rectangle(pt(r.x0, r.y0), pt(r.x1, r.y1)))))
			.get(id);
	for (const [id, r] of near) shape(id, r);
	// Pins on a box at one height and sides, shared by every line ending there.
	const pins = new Map<string, number>();
	const end = (e: RouteEnd) => {
		if (e.point) return temp(new A.ConnEnd(pt(e.x0, e.y)));
		let on = e.on;
		let box = on === undefined ? undefined : grown.get(on);
		let sides = e.sides;
		if (!box) {
			// The binding has no end that is a point with a direction, so a free end is a pin
			// on a speck of a box just inside its side.
			const x = sides[0] === 'r' ? e.x1 - 1 : e.x0;
			on = `free|${x}|${e.y}`;
			box = { x0: x, y0: e.y - 0.5, x1: x + 1, y1: e.y + 0.5 };
			sides = [sides[0]];
		}
		const ref = shape(on!, box);
		const key = `${on}|${e.y}|${sides.join('')}`;
		let cls = pins.get(key);
		if (cls === undefined) {
			cls = pins.size + 1;
			pins.set(key, cls);
			for (const side of sides)
				new A.ShapeConnectionPin(
					ref,
					cls,
					side === 'r' ? box.x1 - box.x0 : 0,
					e.y - box.y0,
					false,
					0,
					side === 'r' ? A.ConnDirRight : A.ConnDirLeft
				).setExclusive(false);
		}
		return temp(new A.ConnEnd(ref, cls));
	};
	// A pair of lines joining the same two ends both ways would lie on itself, one line with two
	// heads: one runs a spread above those ends and the other below, room for a third between.
	const at = (e: RouteEnd) => `${e.on ?? `${e.x0},${e.x1}`}|${e.y}`;
	const ends = new Set(lines.map((l) => `${at(l.s)}>${at(l.t)}`));
	const conns = lines.map((l) => {
		const pair = ends.has(`${at(l.t)}>${at(l.s)}`);
		const dy = pair ? (at(l.s) < at(l.t) ? -1 : 1) * spread : 0;
		const s = { ...l.s, y: l.s.y + dy };
		const t = { ...l.t, y: l.t.y + dy };
		return [l, new A.ConnRef(router, end(s), end(t))] as const;
	});
	router.processTransaction();

	/** An end on a grown box, at `p` on its grown side, moved on to the box's own side. */
	const onto = (e: RouteEnd, p: Point) => {
		const [r, g] = [solid.get(e.on ?? ''), grown.get(e.on ?? '')];
		if (e.point || !r || !g || r === g) return;
		if (Math.abs(p.x - g.x1) < 0.5) p.x = r.x1;
		else if (Math.abs(p.x - g.x0) < 0.5) p.x = r.x0;
	};
	const out = new Map<string, Point[]>();
	for (const [l, c] of conns) {
		const route = c.displayRoute();
		const pts: Point[] = [];
		for (let i = 0; i < route.size(); i++) {
			const p = route.get_ps(i);
			pts.push({ x: p.x, y: p.y });
		}
		if (pts.length) {
			onto(l.s, pts[0]);
			onto(l.t, pts.at(-1)!);
		}
		out.set(l.id, pts);
	}
	// The router owns its shapes, pins and lines.
	A.destroy(router);
	for (const o of temps) A.destroy(o);
	if (!frames.length) return out;
	return clearFrames(
		out,
		[...near.keys()].flatMap((id) => solid.get(id) ?? []),
		frames
	);
}

/** A straight piece of a route: across `axis` at `at`, from `lo` to `hi` along it. */
interface Span {
	/** 'x' for an upright piece, at an x; 'y' for a level one, at a y. */
	axis: 'x' | 'y';
	at: number;
	lo: number;
	hi: number;
}

interface Piece extends Span {
	id: string;
	/** It runs from corner `i` to corner `i + 1`. */
	i: number;
	/** Both its ends are bends, so it can move across itself; a piece ending a route cannot. */
	free: boolean;
}

/** A side of a box or frame, which a piece parallel to it and beside it keeps `need` off. */
interface Wall extends Span {
	need: number;
	frame: boolean;
}

/**
 * The routes with every piece running along a frame's edge, nearer than the frame's `clear`,
 * moved off it, with the pieces of other lines running beside it, so no border hides a line.
 * libavoid keeps lines clear of the boxes it routes round, but lines must cross frames, so it
 * is not told of them, and it runs a line down the middle between two boxes, which can be right
 * on the border of a frame round one of them.
 *
 * A piece moves to wherever it falls short of the room it owes frames and boxes least: clear
 * of them all where there is room, else as evenly short of each as it can, say halfway between
 * two that are too near each other. It never comes nearer than `buffer` to a box or `spread`
 * to another line, the pieces either side only grow or shrink, and a piece ending a route
 * stays.
 */
export function clearFrames(
	routes: Map<string, Point[]>,
	boxes: Rect[],
	frames: Rect[]
): Map<string, Point[]> {
	const EPS = 0.5;
	const out = new Map([...routes].map(([id, pts]) => [id, pts.map((p) => ({ ...p }))]));
	const sides = (r: Rect, frame: boolean): Wall[] => {
		const need = clearOf(r);
		return [
			{ axis: 'x', at: r.x0, lo: r.y0, hi: r.y1, need, frame },
			{ axis: 'x', at: r.x1, lo: r.y0, hi: r.y1, need, frame },
			{ axis: 'y', at: r.y0, lo: r.x0, hi: r.x1, need, frame },
			{ axis: 'y', at: r.y1, lo: r.x0, hi: r.x1, need, frame }
		];
	};
	const walls = [
		...frames.flatMap((f) => sides(f, true)),
		...boxes.flatMap((b) => sides(b, false))
	];
	const along = (a: 'x' | 'y') => (a === 'x' ? 'y' : 'x');
	const overlap = (a: Span, b: Span) => Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > EPS;
	const pieces = () => {
		const all: Piece[] = [];
		for (const [id, pts] of out)
			for (let i = 0; i + 1 < pts.length; i++) {
				const [p, q] = [pts[i], pts[i + 1]];
				const axis = Math.abs(p.x - q.x) < EPS ? 'x' : Math.abs(p.y - q.y) < EPS ? 'y' : undefined;
				if (!axis) continue;
				const [a, b] = [p[along(axis)], q[along(axis)]];
				const free = i > 0 && i + 2 < pts.length;
				all.push({ id, i, axis, at: p[axis], lo: Math.min(a, b), hi: Math.max(a, b), free });
			}
		return all;
	};
	// Walls never move, and a piece runs along a few of thousands: which are beside a piece is
	// worked out once for its span, and a piece found clear of every frame is not tested again
	// while its route stays as it is.
	const byAxis = { x: walls.filter((w) => w.axis === 'x'), y: walls.filter((w) => w.axis === 'y') };
	const besides = new Map<string, Wall[]>();
	const beside = (s: Span) => {
		const key = `${s.axis}|${s.lo}|${s.hi}`;
		let out = besides.get(key);
		if (!out) besides.set(key, (out = byAxis[s.axis].filter((w) => overlap(w, s))));
		return out;
	};
	const clear = new Set<string>();
	/** Whether a piece comes nearer than `g` to a box. */
	const nears = (s: Span, r: Rect, g: number) =>
		s.axis === 'x'
			? r.x0 - g < s.at && s.at < r.x1 + g && r.y0 - g < s.hi && s.lo < r.y1 + g
			: r.y0 - g < s.at && s.at < r.y1 + g && r.x0 - g < s.hi && s.lo < r.x1 + g;
	/** How far short of the room it owes the walls beside it a piece falls, squared, summed. */
	const short = (s: Span) =>
		beside(s).reduce((sum, w) => sum + Math.max(0, w.need - Math.abs(w.at - s.at)) ** 2, 0);
	const onFrame = (s: Span) =>
		beside(s).some((w) => w.frame && Math.abs(w.at - s.at) < w.need - EPS);

	/** The routes `bundle` is part of with it moved `d` across itself, if that is allowed. */
	const moved = (bundle: Piece[], all: Piece[], d: number) => {
		const next = new Map<string, Point[]>();
		for (const s of bundle) {
			const pts = next.get(s.id) ?? out.get(s.id)!.map((p) => ({ ...p }));
			next.set(s.id, pts);
			pts[s.i][s.axis] += d;
			pts[s.i + 1][s.axis] += d;
		}
		for (const s of bundle) {
			const to = { ...s, at: s.at + d };
			if (boxes.some((r) => nears(to, r, ROUTE.buffer - EPS))) return undefined;
			for (const o of all)
				if (!bundle.includes(o) && o.axis === s.axis && overlap(o, to))
					if (Math.abs(o.at - to.at) < ROUTE.spread - EPS) return undefined;
			// The pieces either side only grow or shrink: each keeps its way and crosses no box.
			const [was, pts] = [out.get(s.id)!, next.get(s.id)!];
			for (const [j, k] of [
				[s.i - 1, s.i],
				[s.i + 1, s.i + 2]
			]) {
				const [before, after] = [was[k][s.axis] - was[j][s.axis], pts[k][s.axis] - pts[j][s.axis]];
				if (Math.sign(before) !== Math.sign(after) || Math.abs(after) < EPS) return undefined;
				const [a, b] = [pts[j][s.axis], pts[k][s.axis]];
				const side: Span = {
					axis: along(s.axis),
					at: pts[j][along(s.axis)],
					lo: Math.min(a, b),
					hi: Math.max(a, b)
				};
				if (boxes.some((r) => nears(side, r, 0))) return undefined;
			}
		}
		return next;
	};

	// Each move leaves its pieces less short than before, so this ends.
	const stuck = new Set<string>();
	for (let tries = 1000; tries > 0; tries--) {
		const all = pieces();
		const s = all.find((p) => {
			if (stuck.has(`${p.id}|${p.i}`)) return false;
			const key = `${p.id}|${p.i}|${p.axis}|${p.at}|${p.lo}|${p.hi}`;
			if (clear.has(key)) return false;
			if (onFrame(p)) return true;
			clear.add(key);
			return false;
		});
		if (!s) break;
		// The pieces of lines running beside it, `spread` apart, move with it.
		const bundle = [s];
		for (let k = 0; k < bundle.length; k++)
			for (const o of all)
				if (
					!bundle.includes(o) &&
					o.axis === s.axis &&
					Math.abs(o.at - bundle[k].at) <= ROUTE.spread + EPS &&
					overlap(o, bundle[k])
				)
					bundle.push(o);
		const [lo, hi] = [Math.min(...bundle.map((p) => p.at)), Math.max(...bundle.map((p) => p.at))];
		// Where it could go: just clear of a wall beside it, either way, or evenly short of two.
		const near = [...new Set(bundle.flatMap(beside))].sort((a, b) => a.at - b.at);
		const ds = near.flatMap((w) => [w.at + w.need - lo, w.at - w.need - hi]);
		for (let k = 0; k + 1 < near.length; k++) {
			const [a, b] = [near[k], near[k + 1]];
			ds.push((a.at + a.need - lo + b.at - b.need - hi) / 2);
		}
		const cost = (d: number) => bundle.reduce((sum, p) => sum + short({ ...p, at: p.at + d }), 0);
		const now = cost(0);
		let best: { next: Map<string, Point[]>; cost: number; d: number } | undefined;
		if (bundle.every((p) => p.free))
			for (const d of ds) {
				const c = cost(d);
				if (c > now - EPS) continue;
				if (best && (c > best.cost || (c === best.cost && Math.abs(d) >= Math.abs(best.d))))
					continue;
				const next = moved(bundle, all, d);
				if (next) best = { next, cost: c, d };
			}
		if (best) for (const [id, pts] of best.next) out.set(id, pts);
		else for (const p of bundle) stuck.add(`${p.id}|${p.i}`);
	}
	return out;
}

/** Lines routed among `boxes` only, `spread` apart (see `pitchOf`). */
export interface RouteGroup {
	boxes: Map<string, Rect>;
	lines: RouteLine[];
	spread?: number;
}

/**
 * Each group's lines routed among its own boxes (see `routeLines`), all by line id. Lines that
 * can only run among a few boxes cost far less routed apart: what libavoid costs grows with
 * every box and every line routed together.
 */
export function routeGroups(groups: RouteGroup[], shareEnds = false): Map<string, Point[]> {
	const out = new Map<string, Point[]>();
	for (const g of groups)
		for (const [id, pts] of routeLines(g.boxes, g.lines, shareEnds, g.spread)) out.set(id, pts);
	return out;
}

/**
 * What a set of lines is known by when its routes are kept: the lines themselves, ends and all,
 * so lines ending elsewhere (a card folded or expanded, a new layout) are a new set. '' for no
 * lines, which need no routing.
 */
export const routeKey = (lines: RouteLine[], shareEnds = false) =>
	lines.length ? JSON.stringify([shareEnds, lines]) : '';

/** An SVG path through a route's corners. */
export const routePath = (pts: Point[]) =>
	pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
