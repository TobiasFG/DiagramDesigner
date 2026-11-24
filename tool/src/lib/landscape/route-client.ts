import {
	ROUTE,
	routeKey,
	type Point,
	type Rect,
	type RouteEnd,
	type RouteGroup,
	type RouteLine
} from './route.ts';
import type { FromRouter, ToRouter } from './route-service.ts';

/**
 * Lines routed in workers, so routing never holds up input or frames, and routed ahead of time,
 * so looking at something finds its lines ready.
 *
 * One worker routes what is wanted now: the lit lines of what is looked at, the newest only,
 * and the groups of lines at rest. The other routes ahead: the largest group of lines at rest,
 * then, after each layout, the lit lines of everything that can be looked at, those near the
 * view first. Both keep to one set of lines at a time, so the page can still reorder what waits.
 * Routes are kept by their lines (`routeKey`) and the boxes they were routed among: those of
 * the last few layouts are kept, so going back to one, as on leaving a focus, finds its lines
 * ready. Lines at rest are kept by group (`wantGroups`), here and across visits (`RouteStore`),
 * so opening a landscape again, or changing part of it, draws them at once.
 */

export type Routes = Map<string, Point[]>;

/** A worker running route-worker.ts, or anything answering like one. */
export interface RoutePort {
	postMessage(m: ToRouter): void;
	onmessage: ((e: { data: FromRouter }) => void) | null;
	onerror: ((e: { message?: string }) => void) | null;
	terminate(): void;
}

/**
 * Something that can be looked at, to route its lit lines ahead of time: where it is, so those
 * near the view go first, and its lines, worked out when its turn comes.
 */
export interface RouteAhead {
	x: number;
	y: number;
	lines: () => RouteLine[];
}

/**
 * Somewhere routes outlive the page, by a key standing for the lines and the boxes they were
 * routed among (see route-store.ts).
 */
export interface RouteStore {
	load(key: string): Routes | undefined;
	save(key: string, routes: Routes): void;
}

/** What was routed among one layout's boxes. */
interface Layout {
	/** `boxesKey` of the boxes. */
	id: string;
	/** Told the workers with the boxes, so routes come back to the layout they were routed for. */
	ver: number;
	/** Routes by key, least lately used first. */
	kept: Map<string, Routes>;
	/** The lines at rest, kept apart so routing ahead never pushes them out. */
	rest?: { key: string; routes: Routes };
}

/** Layouts looked at before whose routes are kept besides the current one's. */
const EARLIER = 4;

/** The boxes as one string, alike for boxes alike. */
export const boxesKey = (boxes: Map<string, Rect>) => {
	let out = '';
	for (const [id, r] of boxes)
		out += `${id}:${r.x0},${r.y0},${r.x1},${r.y1},${r.clear ?? ''}${r.frame ? 'f' : ''};`;
	return out;
};

/**
 * A group of lines at rest (see `RouteGroup`) and what its routes are kept by: its own boxes and
 * lines, measured from its top-left corner (`x`, `y`), so they hold whatever else the layout
 * changes, and wherever the group is moved to.
 */
export interface KeyedGroup extends RouteGroup {
	key: string;
	x: number;
	y: number;
	/**
	 * What the group stands for across layouts (the box its lines run in): a group changed
	 * since it was last routed keeps the routes of the lines the change left alone (see
	 * `rerouted`). Without it every change routes the whole group again.
	 */
	id?: string;
}

/** `group` with its key; `shareEnds` as it is routed; `id` what it stands for, if anything. */
export function keyedGroup(group: RouteGroup, shareEnds: boolean, id?: string): KeyedGroup {
	let [x, y] = [Infinity, Infinity];
	for (const r of group.boxes.values()) [x, y] = [Math.min(x, r.x0), Math.min(y, r.y0)];
	if (!group.boxes.size) [x, y] = [0, 0];
	const boxes = new Map<string, Rect>();
	for (const [id, r] of group.boxes)
		boxes.set(id, { ...r, x0: r.x0 - x, y0: r.y0 - y, x1: r.x1 - x, y1: r.y1 - y });
	const end = (e: RouteEnd): RouteEnd => ({ ...e, x0: e.x0 - x, x1: e.x1 - x, y: e.y - y });
	const lines = group.lines.map((l) => ({ ...l, s: end(l.s), t: end(l.t) }));
	const key = `${boxesKey(boxes)}|${group.spread ?? ''}|${routeKey(lines, shareEnds)}`;
	return { ...group, x, y, id, key };
}

/** `routes` moved by `dx`, `dy`. */
const moved = (routes: Routes, dx: number, dy: number): Routes =>
	new Map([...routes].map(([id, pts]) => [id, pts.map((p) => ({ x: p.x + dx, y: p.y + dy }))]));

/** Whether a route comes nearer to `r` than lines keep off it. */
function nears(pts: Point[], r: Rect) {
	const g = Math.max(ROUTE.buffer, r.clear ?? 0) - 0.5;
	for (let i = 0; i + 1 < pts.length; i++) {
		const [p, q] = [pts[i], pts[i + 1]];
		if (
			Math.max(p.x, q.x) > r.x0 - g &&
			Math.min(p.x, q.x) < r.x1 + g &&
			Math.max(p.y, q.y) > r.y0 - g &&
			Math.min(p.y, q.y) < r.y1 + g
		)
			return true;
	}
	return false;
}

/**
 * What of a group changed since it was routed must be routed again: its new lines, those whose
 * ends moved or changed, those ending on a box that moved or changed size, and those whose route
 * now comes near a box that did, or one added. The others keep their routes (`keep`, from the
 * group's top-left corner, as kept). `was` is the group as it was routed, `routes` its routes
 * then, from its top-left corner. The group is matched as it lies on the canvas and as it lies
 * within itself, whichever keeps more, so a group moved whole and changed inside keeps what the
 * change left alone. Kept routes are not spread apart from the new ones as routing them all
 * together would; a page opened anew routes the group whole (see `keptRoutes`).
 */
export function rerouted(
	group: KeyedGroup,
	was: KeyedGroup,
	routes: Routes
): { keep: Routes; lines: RouteLine[] } {
	let best: { keep: Routes; lines: RouteLine[] } = { keep: new Map(), lines: group.lines };
	const old = new Map(was.lines.map((l) => [l.id, l]));
	for (const [dx, dy] of [
		[0, 0],
		[group.x - was.x, group.y - was.y]
	]) {
		const same = new Set<string>();
		const changed: Rect[] = [];
		for (const [id, r] of group.boxes) {
			const o = was.boxes.get(id);
			if (
				o &&
				o.x0 + dx === r.x0 &&
				o.y0 + dy === r.y0 &&
				o.x1 + dx === r.x1 &&
				o.y1 + dy === r.y1 &&
				(o.clear ?? 0) === (r.clear ?? 0) &&
				!!o.frame === !!r.frame
			)
				same.add(id);
			else changed.push(r);
		}
		const sameEnd = (e: RouteEnd, o: RouteEnd) =>
			e.on === o.on &&
			!!e.point === !!o.point &&
			e.x0 === o.x0 + dx &&
			e.x1 === o.x1 + dx &&
			e.y === o.y + dy &&
			e.sides.join() === o.sides.join() &&
			(e.on === undefined || same.has(e.on));
		const keep: Routes = new Map();
		const lines: RouteLine[] = [];
		for (const l of group.lines) {
			const o = old.get(l.id);
			const pts = o && sameEnd(l.s, o.s) && sameEnd(l.t, o.t) ? routes.get(l.id) : undefined;
			// On the canvas now, to test against the boxes that changed.
			const at = pts?.map((p) => ({ x: p.x + was.x + dx, y: p.y + was.y + dy }));
			if (at && !changed.some((r) => nears(at, r)))
				keep.set(
					l.id,
					at.map((p) => ({ x: p.x - group.x, y: p.y - group.y }))
				);
			else lines.push(l);
		}
		if (keep.size > best.keep.size) best = { keep, lines };
	}
	return best;
}

/** Groups of lines at rest of more lines than this are routed only ahead (see `nextGroup`). */
const LARGE = 64;

/** What is wanted now, by priority: lines at rest before lit ones. */
const SLOTS = ['rest', 'lit'] as const;
type Slot = (typeof SLOTS)[number];

interface Job {
	key: string;
	lines: RouteLine[];
	shareEnds: boolean;
	/** A group of lines at rest, routed among its own boxes, not `lines` among all the boxes. */
	group?: KeyedGroup;
	/**
	 * The group `group` is part of, when only some of its lines are routed again (see
	 * `rerouted`), and the routes the others keep.
	 */
	whole?: { group: KeyedGroup; keep: Routes };
	slot?: Slot;
	done?: () => void;
}

interface Lane {
	port: RoutePort;
	busy?: Job & { id: number; ver: number };
}

const NONE: Routes = new Map();

export class RouteClient {
	/** Settles once both workers have loaded libavoid. */
	readonly ready: Promise<void>;
	/** Routing has stopped: libavoid did not load or broke, or the client was destroyed. */
	failed = false;
	/** Told once when routing fails. */
	onfail?: (error: string) => void;

	private boxes?: Map<string, Rect>;
	/** What was routed among `boxes`. */
	private cur: Layout = { id: '', ver: 0, kept: new Map() };
	/** What was routed among the boxes of earlier layouts, by `boxesKey`, least lately used first. */
	private readonly earlier = new Map<string, Layout>();
	private vers = 0;
	private keep = 256;
	private readonly now: Lane;
	private readonly later: Lane;
	private readonly waiting = new Map<Slot, Job>();
	/** What to route ahead, nearest last. */
	private queue: RouteAhead[] = [];
	/** Routes of groups of lines at rest by `KeyedGroup.key`, least lately used first. */
	private readonly grouped = new Map<string, Routes>();
	private keepGroups = 256;
	/** Groups of lines at rest to route, smallest first. */
	private groupQueue: Job[] = [];
	private ids = 0;
	private timer?: ReturnType<typeof setTimeout>;

	constructor(
		now: RoutePort,
		later: RoutePort,
		wasmUrl?: string,
		private readonly store?: RouteStore
	) {
		this.now = { port: now };
		this.later = { port: later };
		this.ready = Promise.all([this.now, this.later].map((lane) => this.open(lane, wasmUrl))).then(
			() => undefined
		);
		this.ready.catch((e) => this.fail(String(e)));
	}

	private open(lane: Lane, wasmUrl?: string) {
		return new Promise<void>((resolve, reject) => {
			lane.port.onerror = (e) => {
				const error = e.message ?? 'route worker failed';
				reject(new Error(error));
				this.fail(error);
			};
			lane.port.onmessage = ({ data: m }) => {
				if (m.type === 'loaded') resolve();
				else if (m.type === 'failed') reject(new Error(m.error));
				else this.routed(lane, m);
			};
			lane.port.postMessage({ type: 'load', wasmUrl });
		});
	}

	/** The routes kept for `key` among `boxes` (no lines need none), or undefined. */
	get(boxes: Map<string, Rect>, key: string): Routes | undefined {
		if (!key) return NONE;
		if (!this.same(boxes)) return undefined;
		if (this.cur.rest?.key === key) return this.cur.rest.routes;
		const r = this.cur.kept.get(key);
		if (r) {
			this.cur.kept.delete(key);
			this.cur.kept.set(key, r);
		}
		return r;
	}

	/**
	 * Routes `lines` (known by `key`, see `routeKey`) among `boxes` before anything routed ahead,
	 * unless they are kept, and tells `done` once `get` has them, at once if it has. What waits
	 * in `slot` is dropped: only the newest is wanted. Lines at rest kept in the store are taken
	 * from there.
	 */
	want(
		boxes: Map<string, Rect>,
		key: string,
		lines: RouteLine[],
		shareEnds: boolean,
		slot: Slot,
		done: () => void
	) {
		this.use(boxes);
		this.waiting.delete(slot);
		if (this.get(boxes, key)) return done();
		if (slot === 'rest' && this.store) {
			const routes = this.stored(key);
			if (routes) {
				this.cur.rest = { key, routes };
				return done();
			}
		}
		for (const lane of [this.now, this.later])
			if (lane.busy?.key === key && lane.busy.ver === this.cur.ver) {
				lane.busy.done = done;
				return;
			}
		this.waiting.set(slot, { key, lines, shareEnds, slot, done });
		this.sendWaiting();
	}

	/**
	 * Routes the lines at rest group by group, each among its own boxes, and tells `done` as
	 * each group's come in, and at once if all are kept. A group is kept by its own boxes and
	 * lines, in the store too, so a change elsewhere in the layout routes only the groups it
	 * touched. Smaller groups go first, on both workers, so most lines are drawn soon; large
	 * ones only on the worker routing ahead, so lit lines never wait for them. Replaces the
	 * groups wanted before.
	 */
	wantGroups(groups: KeyedGroup[], shareEnds: boolean, done: () => void) {
		this.keepGroups = Math.max(256, 4 * groups.length);
		const jobs: Job[] = [];
		this.partly.clear();
		for (const g of groups) {
			if (!g.lines.length) continue;
			const kept = this.keptGroup(g.key);
			if (kept) {
				this.routedLast(g, kept);
				continue;
			}
			const busy = [this.now, this.later].find((lane) => lane.busy?.key === g.key)?.busy;
			if (busy) {
				busy.done = done;
				if (busy.whole) this.partly.set(g.key, busy.whole.keep);
				continue;
			}
			// Changed since it was routed: only what the change touched is routed again.
			const last = g.id === undefined ? undefined : this.last.get(g.id);
			const again = last && rerouted(g, last.group, last.routes);
			if (again?.keep.size && !again.lines.length) {
				this.keptRoutes(g, again.keep, false);
				continue;
			}
			if (again?.keep.size) {
				this.partly.set(g.key, again.keep);
				const part = { ...g, lines: again.lines };
				const whole = { group: g, keep: again.keep };
				jobs.push({ key: g.key, lines: again.lines, shareEnds, group: part, whole, done });
			} else jobs.push({ key: g.key, lines: g.lines, shareEnds, group: g, done });
		}
		this.groupQueue = jobs.sort((a, b) => a.lines.length - b.lines.length);
		if (!jobs.length) done();
		this.sendWaiting();
		this.pump();
	}

	/**
	 * The routes of `groups` kept so far, all by line id, and whether every group's are. The
	 * same object while no group of them came in since, so what is worked out from it (lines
	 * lit along the lines at rest) is not worked out, and routed, anew each time anything does.
	 */
	groupRoutes(groups: KeyedGroup[]): { routes: Routes; done: boolean } {
		const kept = groups.map((g) => (g.lines.length ? this.keptGroup(g.key) : undefined));
		// A group routed again in part shows the routes its other lines keep meanwhile.
		const part = groups.map((g, i) => (kept[i] ? undefined : this.partly.get(g.key)));
		const have = kept.map((r, i) => (r || !groups[i].lines.length ? 1 : part[i] ? 2 : 0)).join('');
		if (this.lastGroups?.groups === groups && this.lastGroups.have === have)
			return this.lastGroups.out;
		const routes: Routes = new Map();
		let done = true;
		groups.forEach((g, i) => {
			if (!g.lines.length) return;
			const r = kept[i] ?? part[i];
			if (!kept[i]) done = false;
			if (r) for (const [id, pts] of moved(r, g.x, g.y)) routes.set(id, pts);
		});
		const out = { routes, done };
		this.lastGroups = { groups, have, out };
		return out;
	}
	private lastGroups?: {
		groups: KeyedGroup[];
		have: string;
		out: { routes: Routes; done: boolean };
	};

	/** A group's routes from its top-left corner, kept here or in the store. */
	private keptGroup(key: string): Routes | undefined {
		let r = this.grouped.get(key);
		if (!r && this.store) {
			try {
				r = this.store.load(`group|${key}`);
			} catch {
				// Not kept; routed again.
			}
		}
		if (r) this.keepGroup(key, r);
		return r;
	}

	/**
	 * The routes of each group last routed, by its id, from its top-left corner, so a change to
	 * it routes again only what the change touched (see `rerouted`).
	 */
	private readonly last = new Map<string, { group: KeyedGroup; routes: Routes }>();
	/** The routes kept by the lines of a group routed again in part, by its key, meanwhile. */
	private readonly partly = new Map<string, Routes>();

	private routedLast(g: KeyedGroup, routes: Routes) {
		if (g.id !== undefined) this.last.set(g.id, { group: g, routes });
	}

	/**
	 * A group's routes come in, from its top-left corner: kept here, and in the store when the
	 * group was routed whole, so a page opened anew routes whole a group routed again in part.
	 */
	private keptRoutes(g: KeyedGroup, routes: Routes, whole: boolean) {
		this.partly.delete(g.key);
		this.keepGroup(g.key, routes);
		this.routedLast(g, routes);
		if (whole)
			try {
				this.store?.save(`group|${g.key}`, routes);
			} catch {
				// Not kept for next time; routed again then.
			}
	}

	private keepGroup(key: string, routes: Routes) {
		this.grouped.delete(key);
		this.grouped.set(key, routes);
		for (const k of this.grouped.keys()) {
			if (this.grouped.size <= this.keepGroups) break;
			this.grouped.delete(k);
		}
	}

	/**
	 * Routes the lit lines of each of `looks` among `boxes` when nothing is wanted now, those
	 * nearest `from` first, and keeps them; replaces what was left to route ahead.
	 */
	ahead(boxes: Map<string, Rect>, looks: RouteAhead[], from: { x: number; y: number }) {
		this.use(boxes);
		// Room for every look's routes, and for those of looks folded or expanded since.
		this.keep = Math.max(256, 2 * looks.length);
		this.queue = [...looks];
		this.aheadFrom(from);
	}

	/** Routes ahead what is nearest `from` first, as when the view has moved there. */
	aheadFrom(from: { x: number; y: number }) {
		const d = (a: RouteAhead) => (a.x - from.x) ** 2 + (a.y - from.y) ** 2;
		this.queue.sort((a, b) => d(b) - d(a));
		this.pump();
	}

	destroy() {
		this.failed = true;
		clearTimeout(this.timer);
		this.now.port.terminate();
		this.later.port.terminate();
	}

	/** The lines at rest by `key` among the current boxes, from the store. */
	private stored(key: string) {
		try {
			return this.store!.load(`${this.cur.id}|${key}`);
		} catch {
			return undefined;
		}
	}

	/**
	 * Whether `boxes` are those routed among, as they are or rebuilt alike (taken on then), as
	 * when what the boxes are worked out from changed but they did not.
	 */
	private same(boxes: Map<string, Rect>) {
		const was = this.boxes;
		if (boxes === was) return true;
		if (!was || boxes.size !== was.size) return false;
		for (const [id, r] of boxes) {
			const o = was.get(id);
			if (!o || o.x0 !== r.x0 || o.y0 !== r.y0 || o.x1 !== r.x1 || o.y1 !== r.y1) return false;
		}
		this.boxes = boxes;
		return true;
	}

	/**
	 * New boxes: what waits among the old ones is dropped, and what was routed among them put
	 * by, for if they come back; what was routed among the new ones before is taken up again.
	 */
	private use(boxes: Map<string, Rect>) {
		if (this.same(boxes)) return;
		if (this.boxes) this.earlier.set(this.cur.id, this.cur);
		this.boxes = boxes;
		const id = boxesKey(boxes);
		this.cur = this.earlier.get(id) ?? { id, ver: ++this.vers, kept: new Map() };
		this.earlier.delete(id);
		for (const k of this.earlier.keys()) {
			if (this.earlier.size <= EARLIER) break;
			this.earlier.delete(k);
		}
		this.waiting.clear();
		this.queue = [];
		for (const lane of [this.now, this.later])
			lane.port.postMessage({ type: 'boxes', ver: this.cur.ver, boxes });
	}

	private send(lane: Lane, job: Job) {
		lane.busy = { ...job, id: ++this.ids, ver: this.cur.ver };
		lane.port.postMessage({
			type: 'route',
			id: lane.busy.id,
			ver: this.cur.ver,
			lines: job.lines,
			shareEnds: job.shareEnds,
			groups: job.group && [
				{ boxes: job.group.boxes, lines: job.group.lines, spread: job.group.spread }
			]
		});
	}

	/**
	 * The next group of lines at rest to route, the smallest; `large` lets a group of over
	 * LARGE lines go, which only the worker routing ahead takes: libavoid takes far longer the
	 * more lines a group has (up to a minute), and lit lines must not wait for it.
	 */
	private nextGroup(large: boolean): Job | undefined {
		while (this.groupQueue.length) {
			const job = this.groupQueue[0];
			if (!large && job.lines.length > LARGE) return undefined;
			this.groupQueue.shift();
			if (!this.grouped.has(job.key)) return job;
			job.done?.();
		}
	}

	private sendWaiting() {
		if (this.failed || this.now.busy) return;
		for (const slot of SLOTS) {
			const job = this.waiting.get(slot);
			if (!job) continue;
			this.waiting.delete(slot);
			if (this.cur.rest?.key === job.key || this.cur.kept.has(job.key)) job.done?.();
			else return this.send(this.now, job);
		}
		const group = this.nextGroup(false);
		if (group) this.send(this.now, group);
	}

	/**
	 * Sends the next group of lines at rest, else the nearest look whose lines are not routed
	 * yet, a few ms of looking at a time.
	 */
	private pump() {
		if (this.failed || this.later.busy || this.timer) return;
		const group = this.nextGroup(true);
		if (group) return this.send(this.later, group);
		const t0 = performance.now();
		for (let a = this.queue.pop(); a; a = this.queue.pop()) {
			let lines: RouteLine[] = [];
			try {
				lines = a.lines();
			} catch {
				// Gone since it was listed; the next layout lists what is there.
			}
			const key = routeKey(lines);
			if (key && !this.cur.kept.has(key) && this.now.busy?.key !== key)
				return this.send(this.later, { key, lines, shareEnds: false });
			if (performance.now() - t0 > 4) {
				this.timer = setTimeout(() => {
					this.timer = undefined;
					this.pump();
				});
				return;
			}
		}
	}

	private routed(lane: Lane, m: Extract<FromRouter, { type: 'routed' }>) {
		const job = lane.busy?.id === m.id ? lane.busy : undefined;
		lane.busy = undefined;
		if (m.error) return this.fail(m.error);
		// Routed for the boxes of this layout or of one left meanwhile, kept for going back.
		const at = [this.cur, ...this.earlier.values()].find((l) => l.ver === m.ver);
		if (job?.group && m.routes) {
			// A group's routes hold for whatever layout it is in, wherever it is.
			const routes = moved(m.routes, -job.group.x, -job.group.y);
			if (job.whole) for (const [id, pts] of job.whole.keep) routes.set(id, pts);
			this.keptRoutes(job.whole?.group ?? job.group, routes, !job.whole);
			job.done?.();
		} else if (job && m.routes && at) {
			if (job.slot === 'rest') {
				at.rest = { key: job.key, routes: m.routes };
				try {
					this.store?.save(`${at.id}|${job.key}`, m.routes);
				} catch {
					// Not kept for next time; routed again then.
				}
			} else {
				at.kept.delete(job.key);
				at.kept.set(job.key, m.routes);
				for (const k of at.kept.keys()) {
					if (at.kept.size <= this.keep) break;
					at.kept.delete(k);
				}
			}
			if (at === this.cur) job.done?.();
		}
		if (lane === this.now) this.sendWaiting();
		else this.pump();
	}

	private fail(error: string) {
		if (this.failed) return;
		this.failed = true;
		clearTimeout(this.timer);
		this.onfail?.(error);
	}
}
