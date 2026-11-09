import { isAncestor, visibleAncestor, type Model } from '../model/model';

/** A connection drawn on the landscape canvas, possibly standing for several relationships. */
export interface ContextEdge {
	id: string;
	source: string;
	target: string;
	label?: string;
	dashed: boolean;
	/** Relationship keys this edge stands for. */
	keys: string[];
}

export interface Context {
	edges: ContextEdge[];
	/** Elements shown at full strength: the focus subtree and the far ends of its connections. */
	relevant: Set<string>;
	/** Elements drawn even when their parent is not open, because a connection ends there. */
	forced: Set<string>;
	/** Ancestors of relevant elements, kept faintly visible as a frame. */
	framing: Set<string>;
}

const topOf = (model: Model, id: string) => {
	let cur = id;
	for (let p = model.elements.get(cur)?.parentId; p; p = model.elements.get(p)?.parentId) cur = p;
	return cur;
};

/**
 * Which connections to draw for the element in focus. Relationships point from consumer to
 * provider. Inside the focus, ends roll up to the visible level. Outside it, the provider end
 * stays at the specific API and the consumer end rolls up to its top-level system. Without a
 * focus, everything rolls up to top-level systems.
 */
export function contextFor(model: Model, focus: string | undefined, visible: Set<string>): Context {
	const inFocus = (id: string) => !!focus && (id === focus || isAncestor(model, focus, id));
	const shown = (id: string) => visibleAncestor(model, id, visible) ?? topOf(model, id);
	const merged = new Map<string, ContextEdge & { async: number }>();

	for (const rel of model.relationships) {
		const { from, to } = rel.def;
		if (!model.elements.has(from) || !model.elements.has(to)) continue;
		let a: string, b: string;
		if (!focus) [a, b] = [topOf(model, from), topOf(model, to)];
		else if (inFocus(from) && inFocus(to)) [a, b] = [shown(from), shown(to)];
		else if (inFocus(from)) [a, b] = [shown(from), to];
		else if (inFocus(to)) [a, b] = [topOf(model, from), to];
		else continue;
		if (a === b || isAncestor(model, a, b) || isAncestor(model, b, a)) continue;

		const id = `${a}->${b}`;
		const e = merged.get(id) ?? { id, source: a, target: b, dashed: false, keys: [], async: 0 };
		e.keys.push(rel.key);
		if (rel.def.sync === false) e.async++;
		if (rel.def.label) e.label = e.label ? `${e.label}, ${rel.def.label}` : rel.def.label;
		merged.set(id, e);
	}

	const edges = [...merged.values()].map(({ async, ...e }) => ({
		...e,
		dashed: async === e.keys.length
	}));
	const forced = new Set(edges.flatMap((e) => [e.source, e.target]));
	const relevant = new Set(
		focus ? [...model.elements.keys()].filter(inFocus) : model.elements.keys()
	);
	for (const id of forced) relevant.add(id);
	const framing = new Set<string>();
	for (const id of relevant)
		for (let p = model.elements.get(id)?.parentId; p; p = model.elements.get(p)?.parentId)
			framing.add(p);
	return { edges, relevant, forced, framing };
}
