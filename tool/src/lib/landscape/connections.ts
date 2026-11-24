import { LOGIC_KEYS, type Model } from '../model/model';
import { bodyModels } from './apis';
import { cardRows, linkTarget, type LandscapeBox } from './layout';

/**
 * Every kind of connection. A field refers to a key (`ref`), holds a model (`model`) or
 * derives from a source (`from`); a unit reads, writes or calls; an api is handled by a unit
 * and its bodies use models (`body`); a trigger is handled by the units it starts. A unit
 * sends on a channel (`sends`); a trigger listens to a channel's port, a stored model or
 * fields of one (`on`).
 */
export type LinkKind =
	'ref' | 'model' | 'from' | 'reads' | 'writes' | 'calls' | 'sends' | 'handles' | 'on' | 'body';

/**
 * One connection between two leaves: a field, model, logic unit, api or api field. `from`
 * depends on `to`, so the arrow points at `to`, and change impact follows edges backwards.
 */
export interface Edge {
	kind: LinkKind;
	from: string;
	to: string;
}

export const edgeKey = (e: Edge) => `${e.kind}:${e.from}>${e.to}`;

/** Every connection in the design, each once. Ends that name nothing known are left out. */
export function edgesOf(model: Model): Edge[] {
	const out = new Map<string, Edge>();
	const known = (id: string) =>
		model.fields.has(id) ||
		model.elements.has(id) ||
		model.apiFields.has(id) ||
		model.ports.has(id);
	const add = (kind: LinkKind, from: string, to: string) => {
		const e = { kind, from, to };
		if (known(from) && known(to) && from !== to) out.set(edgeKey(e), e);
	};
	for (const [id, { def: f }] of model.fields) {
		if (f.ref) add('ref', id, f.ref);
		if (f.model) add('model', id, f.model);
		for (const to of f.from ?? []) add('from', id, to);
	}
	for (const [id, info] of model.elements) {
		// An api or trigger depends on the unit handling it, as a caller on its callee.
		for (const kind of info.logic ? LOGIC_KEYS : [])
			for (const to of info.logic![kind])
				if (kind === 'handles') add(kind, to, id);
				else add(kind, id, to);
		if (info.def.kind === 'api') for (const u of bodyModels(model, id)) add('body', id, u.model);
		// A trigger depends on what it listens to.
		for (const to of info.listens ?? []) add('on', id, to);
	}
	// A response field derives from model fields; a request field is the source of the
	// model fields it goes into.
	for (const [id, { def: f }] of model.apiFields) {
		for (const to of f.from ?? []) add('from', id, to);
		for (const from of f.to ?? []) add('from', from, id);
	}
	return [...out.values()];
}

/** The api an api, or a field of an api's own shape, belongs to. */
export const apiOf = (model: Model, leaf: string) =>
	model.apiFields.get(leaf)?.apiId ??
	(model.elements.get(leaf)?.def.kind === 'api' ? leaf : undefined);

/**
 * The box a leaf is drawn in, seen from box `near`: a field or model on the nearest card
 * showing it (see `linkTarget`), a unit or trigger on its card, an api or api field on the box of
 * the element owning the api.
 */
export function homeOf(
	model: Model,
	boxes: LandscapeBox[],
	near: LandscapeBox,
	leaf: string
): LandscapeBox | undefined {
	const api = apiOf(model, leaf);
	if (!api) return linkTarget(model, boxes, near, leaf);
	const owner = model.elements.get(api)?.parentId;
	return boxes.find((b) => b.id === owner);
}

/** The leaves drawn in a box itself: its rows, its model, its own apis and their fields. */
export function leavesOf(model: Model, b: LandscapeBox): string[] {
	const apis = b.apis ?? [];
	return [
		...(b.view || b.channel ? [b.elementId] : []),
		...(b.fields ?? []).map((f) => f.id),
		...(cardRows(b) ?? []).map((r) => r.id),
		...apis,
		...[...model.apiFields].filter(([, f]) => apis.includes(f.apiId)).map(([id]) => id)
	];
}

/** A box and every box inside it. */
export function within(boxes: LandscapeBox[], id: string): LandscapeBox[] {
	const ids = new Set([id]);
	// Parents precede their children (see `layoutLandscape`).
	for (const b of boxes) if (b.parentId && ids.has(b.parentId)) ids.add(b.id);
	return boxes.filter((b) => ids.has(b.id));
}

/** What makes a module depend on another: a connection, or storing a model it owns. */
export type DependencyKind = LinkKind | 'stores';

/**
 * A Module Dependency Line, drawn at rest: module `source` depends on module `target`. The two
 * are siblings, the children of the deepest module both sit in, so the line never crosses a
 * border. One line per pair and direction: it is the dependency itself, which every
 * connection from anything owned inside the one to anything owned inside the other makes.
 */
export interface RestLine {
	/** `<source>><target>`. */
	id: string;
	source: string;
	target: string;
	/** The module both sit in; none for two top-level modules. */
	parentId?: string;
	/** The kinds of the connections that make it, each once. */
	kinds: DependencyKind[];
	/** How many connections make it. */
	count: number;
	/**
	 * The innermost modules owning the two ends of each connection that makes it, each pair once:
	 * which modules inside `source` depend on which inside `target`.
	 */
	pairs: { from: string; to: string }[];
}

/** The element a leaf belongs to: a field's model, an api field's api, a port's channel. */
export const elementOf = (model: Model, leaf: string) =>
	model.fields.get(leaf)?.modelId ??
	model.apiFields.get(leaf)?.apiId ??
	model.ports.get(leaf)?.channel ??
	leaf;

/** The modules round element `id` that `drawn` holds, innermost first, `id` too if a module. */
export function modulesOf(model: Model, id: string, drawn: (id: string) => boolean): string[] {
	const out: string[] = [];
	for (
		let e = model.elements.get(id);
		e;
		e = e.parentId ? model.elements.get(e.parentId) : undefined
	)
		if (e.def.kind === 'module' && drawn(e.id)) out.push(e.id);
	return out;
}

/**
 * The Module Dependency Lines: every connection in `edges` whose two ends are owned by
 * different modules, and every model stored in a module other than its owner's (the store
 * depends on the owner), lifted to the two sibling modules holding the ends. Where a leaf is
 * owned decides, never where it is drawn. A connection inside one module, or between a module
 * and one inside it, makes no line. `drawn` tells the modules that have a box.
 */
export function moduleLines(
	model: Model,
	edges: Edge[],
	drawn: (id: string) => boolean
): RestLine[] {
	const lines = new Map<string, RestLine>();
	const seen = new Set<string>();
	const add = (kind: DependencyKind, key: string, from: string, to: string) => {
		const [ca, cb] = [modulesOf(model, from, drawn), modulesOf(model, to, drawn)];
		if (!ca.length || !cb.length) return;
		const shared = ca.find((id) => cb.includes(id));
		if (shared === ca[0] || shared === cb[0]) return;
		const source = shared ? ca[ca.indexOf(shared) - 1] : ca.at(-1)!;
		const target = shared ? cb[cb.indexOf(shared) - 1] : cb.at(-1)!;
		const id = `${source}>${target}`;
		if (seen.has(`${id}|${key}`)) return;
		seen.add(`${id}|${key}`);
		let l = lines.get(id);
		if (!l)
			lines.set(id, (l = { id, source, target, parentId: shared, kinds: [], count: 0, pairs: [] }));
		l.count++;
		if (!l.kinds.includes(kind)) l.kinds.push(kind);
		if (!l.pairs.some((p) => p.from === ca[0] && p.to === cb[0]))
			l.pairs.push({ from: ca[0], to: cb[0] });
	};
	for (const e of edges) add(e.kind, edgeKey(e), elementOf(model, e.from), elementOf(model, e.to));
	for (const [id, info] of model.elements)
		if (info.def.kind === 'model' && info.storedIn && info.storedIn !== info.parentId)
			add('stores', `stores:${id}`, info.storedIn, id);
	return [...lines.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** A box and every box round it, innermost first. */
export function chainOf(boxById: Map<string, LandscapeBox>, id: string): LandscapeBox[] {
	const out: LandscapeBox[] = [];
	for (let b = boxById.get(id); b; b = b.parentId ? boxById.get(b.parentId) : undefined)
		out.push(b);
	return out;
}

/** What hovering or picking module `m` lights: see `moduleLook`. */
export interface ModuleLook {
	/** Lines carrying a dependency of `m` or of something inside it, lit. */
	lit: Set<string>;
	/** Lines inside `m`, left as they are at rest. */
	inside: Set<string>;
	/**
	 * The boxes kept bright: `m` and everything in it and round it, and for every module it
	 * depends on or that depends on it, that module, everything in it and round it.
	 */
	bright: Set<string>;
}

/**
 * Looking at module `m`: the lines carrying its dependencies (its own lines, and the lines of
 * the modules round it that carry them) light up, and so do the modules at their far ends,
 * the very modules depended on, not the whole box the line ends on. Lines inside `m` are left
 * at rest.
 */
export function moduleLook(
	boxes: LandscapeBox[],
	boxById: Map<string, LandscapeBox>,
	lines: RestLine[],
	m: string
): ModuleLook {
	const inM = (id: string | undefined) => !!id && chainOf(boxById, id).some((b) => b.id === m);
	const lit = new Set<string>();
	const inside = new Set<string>();
	const bright = new Set<string>();
	const keep = (id: string) => {
		for (const b of within(boxes, id)) bright.add(b.id);
		for (const b of chainOf(boxById, id)) bright.add(b.id);
	};
	keep(m);
	for (const l of lines) {
		if (inM(l.parentId)) {
			inside.add(l.id);
			continue;
		}
		for (const p of l.pairs) {
			const [a, b] = [inM(p.from), inM(p.to)];
			if (a === b) continue;
			lit.add(l.id);
			keep(a ? p.to : p.from);
		}
	}
	return { lit, inside, bright };
}
