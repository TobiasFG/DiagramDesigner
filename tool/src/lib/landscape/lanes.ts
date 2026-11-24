import type { Point, Rect } from './route.ts';

/**
 * Lines that share a stretch of their routes drawn side by side, each in its own lane, like
 * lines on a metro map, instead of on top of each other.
 *
 * The router runs lines leaving one end together as one (lines at rest), and lines from one
 * row out of one point. Here
 * every straight piece of a route that lies on another's is given a lane: the pieces sharing a
 * stretch are ordered so their lines cross no more than they must (see `side`), and spread
 * about where the router put them, leaning to the side with more room. On screen they are
 * `LANE.pitch` canvas px apart, but never nearer than `LANE.least` px nor further than
 * `LANE.most`: zoomed out they keep apart, zoomed in they spread with the boxes. The shift is
 * worked out by the lines' shader (see gl/lines.ts, and `lanePoints` for the same sum here).
 * Zoomed out, a lane never shifts further than the room round its stretch allows (`room`, canvas px):
 * off the boxes beside it, halfway to the next line, within the row it ends on, and short of
 * the far end of a piece it bends back along; past that its lines close up again.
 */

/**
 * The lane of one piece of a line: it is drawn `(nx, ny)` steps off its route, where `(nx, ny)`
 * is the lane's place across the stretch; a step is `LANE.pitch` × zoom screen px, between
 * `step` and `LANE.most`, and at most `room` × zoom (see `stepAt`).
 */
export interface Lane {
	nx: number;
	ny: number;
	/** Screen px between lanes at least. */
	step: number;
	/** Canvas px between lanes at most. */
	room: number;
}

export interface LaneLine {
	id: string;
	points: readonly Point[];
	/** Canvas px an end may slide along the side of what it ends on: [start, end]. */
	ends?: readonly [number, number];
}

/** A line's route without repeated or straight-through points, and each piece's lane. */
export interface Laned {
	points: Point[];
	/** By piece, `points[i]` to `points[i + 1]`; none for a piece no other shares. */
	lanes: (Lane | undefined)[];
}

/**
 * Lanes `pitch` canvas px apart, at least `least` and at most `most` screen px, so marks side by
 * side never touch; canvas px a lane keeps off a box at least; canvas px an end slides along
 * what it ends on, unless told.
 */
export const LANE = { pitch: 16, least: 12, most: 24, standoff: 4, end: 10 };

const EPS = 0.5;
/** No limit to a lane's room. */
const FREE = 1e6;

type Axis = 'x' | 'y';
/** A straight piece: across `axis` at `at` (an upright piece is at an x), from `lo` to `hi`. */
interface Piece {
	line: number;
	i: number;
	axis: Axis;
	at: number;
	lo: number;
	hi: number;
}
const along = (a: Axis): Axis => (a === 'x' ? 'y' : 'x');
/**
 * Two pieces on one line across the canvas that overlap, or touch: lines turning opposite ways
 * at one corner touch there, and moved to their lanes would run on each other.
 */
const meet = (a: Piece, b: Piece) => Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > -EPS;

/** `points` with repeats and points a line runs straight through dropped. */
export function tidy(points: readonly Point[]): Point[] {
	const out: Point[] = [];
	for (const p of points) {
		const q = out.at(-1);
		if (q && Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6) continue;
		const o = out.at(-2);
		if (o && q) {
			const [ax, ay, bx, by] = [q.x - o.x, q.y - o.y, p.x - q.x, p.y - q.y];
			// Straight on, not back: the middle point is no corner.
			if (Math.abs(ax * by - ay * bx) < 1e-6 && ax * bx + ay * by > 0) out.pop();
		}
		out.push({ x: p.x, y: p.y });
	}
	return out;
}

/**
 * Each line's route tidied, with the lane of each piece sharing a stretch with others, by line
 * id. `boxes` are what the lines run among: lanes keep off them (and off frames' edges).
 */
export function laneLines(lines: readonly LaneLine[], boxes: Iterable<Rect>): Map<string, Laned> {
	const routes = lines.map((l) => tidy(l.points));
	const lanes = routes.map((r) => new Array<Lane | undefined>(Math.max(0, r.length - 1)));
	const pieces: Piece[] = [];
	routes.forEach((pts, line) => {
		for (let i = 0; i + 1 < pts.length; i++) {
			const [p, q] = [pts[i], pts[i + 1]];
			const axis: Axis | undefined =
				Math.abs(p.x - q.x) < 1e-6 ? 'x' : Math.abs(p.y - q.y) < 1e-6 ? 'y' : undefined;
			if (!axis) continue;
			const [a, b] = [p[along(axis)], q[along(axis)]];
			pieces.push({ line, i, axis, at: p[axis], lo: Math.min(a, b), hi: Math.max(a, b) });
		}
	});

	// Pieces on one line across the canvas, meeting in a chain, share a stretch.
	const byAt = new Map<string, Piece[]>();
	for (const p of pieces) {
		const key = `${p.axis}|${Math.round(p.at * 4)}`;
		const list = byAt.get(key);
		if (list) list.push(p);
		else byAt.set(key, [p]);
	}
	const stretches: Piece[][] = [];
	for (const list of byAt.values()) {
		if (list.length < 2) continue;
		list.sort((a, b) => a.lo - b.lo);
		let cur: Piece[] = [];
		let hi = -Infinity;
		for (const p of list) {
			if (p.lo > hi + EPS) {
				if (cur.length > 1) stretches.push(cur);
				[cur, hi] = [[], -Infinity];
			}
			cur.push(p);
			hi = Math.max(hi, p.hi);
		}
		if (cur.length > 1) stretches.push(cur);
	}
	if (!stretches.length) return result();

	const walls = wallsOf(boxes);
	const sorted = { x: sortedBy(pieces, 'x'), y: sortedBy(pieces, 'y') };
	for (const s of stretches) {
		const order = ordered(s, routes, lines);
		// Each piece in the lowest lane clear of the overlapping pieces before it.
		const lane = new Map<Piece, number>();
		for (const p of order) {
			let k = 0;
			for (const [q, kq] of lane) if (meet(p, q)) k = Math.max(k, kq + 1);
			lane.set(p, k);
		}
		const mid = (Math.max(...lane.values()) || 0) / 2;
		if (!mid) continue;
		const { room, shift } = roomOf(s, lane, mid, routes, lines, walls, sorted[s[0].axis]);
		for (const [p, k] of lane) {
			const n = k - mid + shift;
			lanes[p.line][p.i] = {
				nx: p.axis === 'x' ? n : 0,
				ny: p.axis === 'y' ? n : 0,
				step: LANE.least,
				room
			};
		}
	}
	return result();

	function result() {
		return new Map(lines.map((l, i) => [l.id, { points: routes[i], lanes: lanes[i] }]));
	}
}

/**
 * The pieces of a stretch in lane order, lowest first: by `side`, between pieces that overlap;
 * where that goes round in a circle, the piece first along the stretch next.
 */
function ordered(s: Piece[], routes: Point[][], lines: readonly LaneLine[]): Piece[] {
	const after = new Map<Piece, Set<Piece>>(s.map((p) => [p, new Set()]));
	for (let a = 0; a < s.length; a++)
		for (let b = a + 1; b < s.length; b++) {
			const [p, q] = [s[a], s[b]];
			if (!meet(p, q)) continue;
			let c = side(p, q, routes);
			if (!c) c = lines[p.line].id < lines[q.line].id || (p.line === q.line && p.i < q.i) ? -1 : 1;
			if (c < 0) after.get(q)!.add(p);
			else after.get(p)!.add(q);
		}
	const out: Piece[] = [];
	const left = [...s];
	while (left.length) {
		const k = Math.max(
			0,
			left.findIndex((p) => [...after.get(p)!].every((q) => !left.includes(q)))
		);
		out.push(...left.splice(k, 1));
	}
	return out;
}

/**
 * Which side of `q` the lane of `p` goes, across their stretch: 1 the far side (greater x or
 * y), -1 the near, 0 when nothing tells. Both lines are followed out of the stretch one way,
 * then the other, round any corners they turn together, to where they part (see `walk`).
 * Lines running side by side keep their order round a corner, left of the way they go or
 * right, so where they part tells their order in the stretch. Where one way would have them
 * cross and the other only touch, the crossing is the one kept off; where both would cross,
 * they must, and the first way wins.
 */
function side(p: Piece, q: Piece, routes: Point[][]): number {
	let weak = 0;
	for (const dir of [-1, 1] as const) {
		const w = walk(p, q, dir, routes);
		// Left of the way out of the stretch, as the near or far side across it.
		const c = w.side * (p.axis === 'y' ? dir : -dir);
		if (w.side && w.strong) return c;
		weak ||= c;
	}
	return weak;
}

/** The corners of `p`'s line beyond its piece's end towards `dir` along it, in that order. */
function beyond(p: Piece, dir: number, routes: Point[][]): Point[] {
	const pts = routes[p.line];
	const a = along(p.axis);
	const forward = (pts[p.i + 1][a] - pts[p.i][a]) * dir > 0;
	return forward ? pts.slice(p.i + 1) : pts.slice(0, p.i + 1).reverse();
}

/**
 * Where `p` parts from `q` going out of their stretch towards `dir`: `side` 1 to the left of
 * the way out, -1 the right, 0 if nothing tells. One that turns off first goes on the side it
 * turns to, else it would cross the other (`strong`); of two parting at one corner, the one
 * turning left goes left, and one that ends there would only touch the other (not `strong`).
 * One that ends first tells nothing.
 */
function walk(
	p: Piece,
	q: Piece,
	dir: number,
	routes: Point[][]
): { side: number; strong: boolean } {
	const a = along(p.axis);
	const [A, B] = [beyond(p, dir, routes), beyond(q, dir, routes)];
	const start = dir < 0 ? Math.max(p.lo, q.lo) : Math.min(p.hi, q.hi);
	let cur: Point = p.axis === 'y' ? { x: start, y: p.at } : { x: p.at, y: start };
	let u: Point = a === 'x' ? { x: dir, y: 0 } : { x: 0, y: dir };
	/** Which way a line turns after its corner `k`: 1 left, -1 right, 0 none (it ends). */
	const turn = (pts: Point[], k: number) => {
		if (k + 1 >= pts.length) return 0;
		const c = -u.y * (pts[k + 1].x - pts[k].x) + u.x * (pts[k + 1].y - pts[k].y);
		return Math.abs(c) < 1e-6 ? 0 : Math.sign(c);
	};
	for (let i = 0, j = 0; i < A.length && j < B.length; i++, j++) {
		const da = (A[i].x - cur.x) * u.x + (A[i].y - cur.y) * u.y;
		const db = (B[j].x - cur.x) * u.x + (B[j].y - cur.y) * u.y;
		const [ta, tb] = [turn(A, i), turn(B, j)];
		if (da < db - EPS) return { side: ta, strong: true };
		if (db < da - EPS) return { side: -tb, strong: true };
		if (ta !== tb) return { side: Math.sign(ta - tb), strong: !!ta && !!tb };
		if (!ta) return NOTHING;
		// They turn together: on round the corner.
		cur = A[i];
		const len = Math.hypot(A[i + 1].x - A[i].x, A[i + 1].y - A[i].y);
		u = { x: (A[i + 1].x - A[i].x) / len, y: (A[i + 1].y - A[i].y) / len };
	}
	return NOTHING;
}
const NOTHING = { side: 0, strong: false };

/** A side of a box: upright (in `x`) at an x, or level (in `y`) at a y. */
interface Wall {
	at: number;
	lo: number;
	hi: number;
}

function wallsOf(boxes: Iterable<Rect>): Record<Axis, Wall[]> {
	const out: Record<Axis, Wall[]> = { x: [], y: [] };
	for (const r of boxes) {
		out.x.push({ at: r.x0, lo: r.y0, hi: r.y1 }, { at: r.x1, lo: r.y0, hi: r.y1 });
		out.y.push({ at: r.y0, lo: r.x0, hi: r.x1 }, { at: r.y1, lo: r.x0, hi: r.x1 });
	}
	out.x.sort((a, b) => a.at - b.at);
	out.y.sort((a, b) => a.at - b.at);
	return out;
}

const sortedBy = (pieces: Piece[], axis: Axis) =>
	pieces.filter((p) => p.axis === axis).sort((a, b) => a.at - b.at);

/** The first index in `list` (sorted by `at`) at or past `at`. */
function search<T extends { at: number }>(list: T[], at: number) {
	let [lo, hi] = [0, list.length];
	while (lo < hi) {
		const m = (lo + hi) >> 1;
		if (list[m].at < at) lo = m + 1;
		else hi = m;
	}
	return lo;
}

/**
 * Where a stretch's lanes go: `shift` steps towards the far side (greater x or y) from centred
 * on the route, and `room`, canvas px between them at most. The lanes keep `LANE.standoff` off
 * the nearest box beside the stretch either side, and to their half of the way to the nearest
 * other line; they lean to the side with more room, so lines routed close beside a box spread
 * the other way. An end slides no further than its line allows along what it ends on, and no
 * lane moves a corner more than half way along the piece it bends into.
 */
function roomOf(
	s: Piece[],
	lane: Map<Piece, number>,
	mid: number,
	routes: Point[][],
	lines: readonly LaneLine[],
	walls: Record<Axis, Wall[]>,
	others: Piece[]
): { room: number; shift: number } {
	const { axis, at } = s[0];
	const span = { lo: Math.min(...s.map((p) => p.lo)), hi: Math.max(...s.map((p) => p.hi)) };
	const beside = (w: { lo: number; hi: number }) =>
		Math.min(w.hi, span.hi) - Math.max(w.lo, span.lo) > EPS;
	// Canvas px for the outer lane either side: to the nearest wall and other line beside the
	// stretch, going outwards.
	const free = (dir: number) => {
		let out = FREE;
		const list = walls[axis];
		for (let k = search(list, at) + (dir < 0 ? -1 : 0); k >= 0 && k < list.length; k += dir) {
			const d = Math.abs(list[k].at - at);
			if (d < EPS || !beside(list[k])) continue;
			out = Math.min(out, d - LANE.standoff);
			break;
		}
		for (let k = search(others, at) + (dir < 0 ? -1 : 0); k >= 0 && k < others.length; k += dir) {
			const d = Math.abs(others[k].at - at);
			if (d < EPS || !beside(others[k])) continue;
			out = Math.min(out, d / 2 - EPS);
			break;
		}
		return Math.max(0, out);
	};
	const [near, far] = [free(-1), free(1)];
	// The lanes from `mid - shift` steps on the near side to `mid + shift` on the far, as far
	// apart as both sides' room allows.
	const shift = near + far ? Math.max(-mid, Math.min(mid, (mid * (far - near)) / (near + far))) : 0;
	const within = (px: number, steps: number) => (steps > 1e-9 ? px / steps : FREE);
	let room = Math.min(within(near, mid - shift), within(far, mid + shift));
	for (const [p, k] of lane) {
		const across = k - mid + shift;
		const n = Math.abs(across);
		if (n < 1e-9) continue;
		const pts = routes[p.line];
		const ends = lines[p.line].ends ?? [LANE.end, LANE.end];
		if (p.i === 0) room = Math.min(room, ends[0] / n);
		if (p.i + 2 === pts.length) room = Math.min(room, ends[1] / n);
		// A corner moving along the piece it bends into, towards that piece's other end,
		// shortens it; moving away only lengthens it.
		for (const j of [p.i - 1, p.i + 1]) {
			if (j < 0 || j + 1 >= pts.length) continue;
			const [corner, other] = j < p.i ? [pts[p.i], pts[j]] : [pts[p.i + 1], pts[j + 1]];
			const toward = other[axis] - corner[axis];
			if (Math.sign(toward) !== Math.sign(across)) continue;
			room = Math.min(room, (Math.abs(toward) / 2 - EPS) / n);
		}
	}
	return { room: Math.max(0, room), shift };
}

/** Screen px between lanes `l` at `zoom`, as the lines' shader works it out. */
export const stepAt = (l: Lane, zoom: number) =>
	Math.min(Math.min(Math.max(LANE.pitch * zoom, l.step), LANE.most), l.room * zoom);

/**
 * The shift of each corner of a laned line, in screen px at `zoom`: its pieces' lanes added,
 * as the lines' shader adds them (a right-angled corner meets both pieces' lanes).
 */
export function laneShifts(lanes: readonly (Lane | undefined)[], zoom: number): Point[] {
	const off = (l: Lane | undefined) => {
		if (!l) return { x: 0, y: 0 };
		const s = stepAt(l, zoom);
		return { x: l.nx * s, y: l.ny * s };
	};
	const out: Point[] = [];
	for (let i = 0; i <= lanes.length; i++) {
		const [a, b] = [off(lanes[i - 1]), off(lanes[i])];
		out.push({ x: a.x + b.x, y: a.y + b.y });
	}
	return out;
}

/** A laned line's corners as drawn at `zoom`, in canvas px. */
export function lanePoints(l: Laned, zoom: number): Point[] {
	const shift = laneShifts(l.lanes, zoom);
	return l.points.map((p, i) => ({ x: p.x + shift[i].x / zoom, y: p.y + shift[i].y / zoom }));
}
