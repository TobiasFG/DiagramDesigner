import { apiBodies, type ApiPart, type Model } from '../model/model';
import type { ApiBody } from '../model/schema';
import { textWidth } from '../render/text';

/**
 * Apis as data users: which model fields each body sends into or returns, and the rail of
 * endpoints drawn on a box's right border.
 */

export const partLabel = (part: ApiPart) => (part === 'request' ? 'request' : String(part));

/** The model fields a body that names a model carries: all, less `omit`, or only `pick`. */
export function bodyFields(model: Model, body: ApiBody): string[] {
	if (!body.model) return [];
	const all = [...model.fields].filter(([, f]) => f.modelId === body.model).map(([id]) => id);
	if (body.pick) return all.filter((id) => body.pick!.includes(id));
	return all.filter((id) => !body.omit?.includes(id));
}

/** One body using a model field. `via` is the api field when the body has its own shape. */
export interface ApiUse {
	api: string;
	part: ApiPart;
	via?: string;
}

export interface ApiUses {
	/** By model field: bodies sending data into it (requests). */
	fedBy: Map<string, ApiUse[]>;
	/** By model field: bodies returning it (responses). */
	returnedBy: Map<string, ApiUse[]>;
}

export function apiUses(model: Model): ApiUses {
	const uses: ApiUses = { fedBy: new Map(), returnedBy: new Map() };
	const add = (part: ApiPart, field: string, use: ApiUse) => {
		const m = part === 'request' ? uses.fedBy : uses.returnedBy;
		if (model.fields.has(field)) m.set(field, [...(m.get(field) ?? []), use]);
	};
	for (const [api, info] of model.elements) {
		if (info.def.kind !== 'api') continue;
		for (const { part, body } of apiBodies(info.def)) {
			for (const field of bodyFields(model, body)) add(part, field, { api, part });
			for (const f of body.fields ?? [])
				for (const field of (part === 'request' ? f.to : f.from) ?? [])
					add(part, field, { api, part, via: f.id });
		}
	}
	return uses;
}

/** The models an api's bodies carry, whole or trimmed, or held by a field of its own shape. */
export function bodyModels(
	model: Model,
	apiId: string
): { part: ApiPart; model: string; fields?: string[] }[] {
	const def = model.elements.get(apiId)?.def;
	if (!def) return [];
	return apiBodies(def).flatMap(({ part, body }) => [
		...(body.model ? [{ part, model: body.model, fields: bodyFields(model, body) }] : []),
		...(body.fields ?? []).flatMap((f) => (f.model ? [{ part, model: f.model }] : []))
	]);
}

/** Rail sizes in px at full size (scale 1), shared with LandscapeNode. */
export const RAIL = {
	/** Endpoint rows; the rail opens when they would read at READABLE px. */
	font: 12,
	row: 30,
	/** The APIs header and group headings. */
	head: 24,
	group: 22,
	label: 11,
	pad: 10,
	gap: 8,
	/** Space above and below the rail, as a share of the box's height. */
	inset: 0.08
};

/** Endpoints under one heading: the element owning them, when the rail holds several. */
export interface RailGroup {
	title?: string;
	apis: string[];
}

export interface Rail {
	groups: RailGroup[];
	/** How much the rows are shrunk to fit the rail's height; at most 1. */
	scale: number;
	/** In canvas px, relative to the host box. */
	top: number;
	width: number;
	height: number;
	/** Method column width at full size, so paths line up. */
	methodWidth: number;
}

/**
 * Groups a host's apis by the element owning them. Apis of the host itself come first and
 * need no heading unless apis moved up from hidden boxes inside are there too.
 */
export function railGroups(model: Model, hostElement: string, apis: string[]): RailGroup[] {
	const groups = new Map<string, string[]>();
	for (const id of apis) {
		const owner = model.elements.get(id)?.parentId ?? '';
		groups.set(owner, [...(groups.get(owner) ?? []), id]);
	}
	const owners = [...groups.keys()].sort((a, b) => +(b === hostElement) - +(a === hostElement));
	const titled = owners.length > 1 || owners[0] !== hostElement;
	return owners.map((o) => ({
		title: titled ? (model.elements.get(o)?.name ?? o) : undefined,
		apis: groups.get(o)!
	}));
}

/** Width of an endpoint row's method column, so paths line up. */
const methodWidth = (methods: string[]) =>
	Math.max(...methods.map((m) => textWidth(m, RAIL.font, true)));

/**
 * The rail on a box of `boxHeight`: it spans the box's height less the insets, and the rows
 * are laid out at full size, then shrunk to fit it however many there are.
 */
export function railOf(model: Model, groups: RailGroup[], boxHeight: number): Rail {
	const apis = groups.flatMap((g) => g.apis).map((id) => model.elements.get(id)!.def);
	const mw = methodWidth(apis.map((a) => a.method ?? ''));
	const naturalW = Math.max(
		textWidth('APIs', RAIL.label, true) + 2 * RAIL.pad,
		...groups.map((g) => (g.title ? textWidth(g.title, RAIL.label, true) + 2 * RAIL.pad : 0)),
		...apis.map((a) => mw + RAIL.gap + textWidth(a.path ?? '', RAIL.font) + 2 * RAIL.pad)
	);
	const naturalH =
		RAIL.head +
		groups.reduce((h, g) => h + (g.title ? RAIL.group : 0) + g.apis.length * RAIL.row, 0);
	const height = boxHeight * (1 - 2 * RAIL.inset);
	const scale = Math.min(1, height / naturalH);
	return {
		groups,
		scale,
		top: boxHeight * RAIL.inset,
		width: (naturalW + 2) * scale,
		height,
		methodWidth: mw
	};
}

/** Vertical centre of an api's row, in rail px at full size, or undefined if not on the rail. */
export function railRowY(rail: Rail, api: string): number | undefined {
	let y = RAIL.head;
	for (const g of rail.groups) {
		if (g.title) y += RAIL.group;
		const i = g.apis.indexOf(api);
		if (i >= 0) return y + (i + 0.5) * RAIL.row;
		y += g.apis.length * RAIL.row;
	}
	return undefined;
}
