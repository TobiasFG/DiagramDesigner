import { LOGIC_KEYS, type Model } from '../model/model';
import type { Element, ModelField, ModelIndex } from '../model/schema';
import { GLYPH, textWidth, truncate, truncateStart } from '../render/text';
import { triggerGlyph, triggerWords } from '../model/message';
import { railGroups, railOf } from './apis';
import { edgeKey, edgesOf, moduleLines, type Edge } from './connections';
import type { ElkNode } from 'elkjs/lib/elk-api';
import { elkLayout } from './elk';
import { clearanceOf, ROUTE, type Point } from './route';

/** A model is drawn as a class where it is owned, as a table where it is stored. */
export type ModelView = 'class' | 'table';

export interface LandscapeBox {
	/**
	 * Element id; `<parent box id>>model id` for a model owned elsewhere (referenced or
	 * stored there); `<root model id>#parts` for a composition boundary.
	 */
	id: string;
	/** The element drawn in the box; a boundary's root model. */
	elementId: string;
	/** Drawn here but owned elsewhere. */
	ref: boolean;
	/** Boundary round a model and the models only it holds. */
	boundary: boolean;
	/** Has boxes inside. */
	group: boolean;
	parentId?: string;
	/** Absolute canvas coordinates. */
	absX: number;
	absY: number;
	width: number;
	height: number;
	/** Field columns, for a model card. */
	table?: TableColumn[];
	view?: ModelView;
	/** The model's fields that exist in this view. */
	fields?: ModelField[];
	/** How many field rows the card shows folded, when not `FOLD`. */
	foldAt?: number;
	/** Apis of the element, drawn on a rail across its right border (see `apiHosts`). */
	apis?: string[];
	/** A module's logic units, one row each; set when the box is its logic card. */
	logic?: { cols: TableColumn[]; rows: LogicRow[] };
	/** A module's triggers, one row each, its schedule in words; set when the box is its triggers card. */
	triggers?: { cols: TableColumn[]; rows: LogicRow[] };
	/** A channel's events (its ports), one row each with the triggers on it; set on a channel card. */
	channel?: { cols: TableColumn[]; rows: LogicRow[] };
	/** A table card of a model stored in a module that keeps files (`store: files`): a file. */
	files?: true;
	/**
	 * Room lines keep clear of the box, more the larger it is (see route.ts `clearanceOf`). The
	 * layout leaves that much more room round it, and inside it if it holds boxes.
	 */
	clear: number;
}

interface Size {
	width: number;
	height: number;
	/** Room kept clear right of the box, for the half of its api rail outside it. */
	right?: number;
}

interface Item {
	/** Box id. */
	id: string;
	/** Element drawn. */
	el: string;
	ref: boolean;
	boundary?: boolean;
	view?: ModelView;
	/** The logic or triggers card of module `el`, or the card of channel `el`. */
	card?: 'logic' | 'triggers' | 'channel';
}

/** A box without children: its name at a fixed size, the box fitted round it. */
export const LEAF = { font: 15, padX: 18, height: 52, minWidth: 100 };
/** A closed group's name scales with the box, so a system reads the same at any size. */
export const groupFont = (width: number, height: number) => Math.min(width * 0.085, height * 0.2);

/** The ELK options a viewer can change in Settings. */
export interface LayoutOptions {
	/** Which way connections run: what is depended on comes first. */
	direction: 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
	/**
	 * Scales the room between boxes: 160 px between systems, 48 inside a box at 1, before the
	 * room for the lines between them.
	 */
	spacing: number;
	placement: 'NETWORK_SIMPLEX' | 'BRANDES_KOEPF' | 'LINEAR_SEGMENTS' | 'SIMPLE';
	/** Width over height that unconnected groups are packed into. */
	aspect: number;
	/**
	 * The smallest a system or module is drawn, as a share of the largest box beside it: at
	 * least this much of the widest one's width and of the tallest one's height, so one with
	 * little inside still shows next to large ones. 0 fits every box to what it holds.
	 */
	minShare: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
	direction: 'RIGHT',
	spacing: 1,
	placement: 'NETWORK_SIMPLEX',
	minShare: 0.125,
	aspect: 1.6
};
const PAD = 32;
/** Room above the children for the open box's header. */
export const HEADER = 48;

/** Model tables: font sizes and spacing in px, shared with GlLayer and CardPeek. */
export const TABLE = {
	title: 14,
	note: 11,
	/** Column labels in a table's header row. */
	label: 11,
	row: 13,
	badge: 11,
	/** A logic unit's signature, after its name. */
	signature: 12,
	rowHeight: 26,
	/** Name bar above the tables. */
	head: 48,
	/** Side padding in every cell. */
	pad: 10,
	/** Least space between a card's name and its type word. */
	kindGap: 12,
	/** Space between two badges, or a name and its badges, in a cell. */
	badgeGap: 4,
	/** Mark in the required and nullable columns. */
	check: '✓'
};

export type FieldColumn = 'name' | 'type' | 'required' | 'nullable' | 'constraints' | 'links';
export type LogicColumn = 'name' | 'signature';

/**
 * Marks in a row's link strip: a foreign key (`ref`), lineage (`from`), and how many fields
 * refer to (`inRef`) or derive from (`inFrom`) this one, and how many api fields send into or
 * return it (`inApi`). Each kind has its own slot, so marks
 * line up down the card.
 */
export type LinkSlot = 'ref' | 'from' | 'inRef' | 'inFrom' | 'inApi';

/** Link strip sizes in px, shared with GlLayer and CardPeek. */
export const LINK = { icon: 14, slot: 20, count: 10 };

export interface TableColumn {
	key: FieldColumn | LogicColumn;
	label: string;
	/** Hover text for a short label. */
	title?: string;
	width: number;
	/** The link strip's slots, in order. */
	slots?: LinkSlot[];
}

/**
 * One edge of the field graph: field `field` refers to, derives from, or holds `to`; or logic
 * unit `field` handles an api, reads or writes a model or field, or calls a unit or api.
 */
export interface FieldLink {
	kind: 'ref' | 'from' | 'model' | (typeof LOGIC_KEYS)[number];
	/** The field or logic unit the link is written on. */
	field: string;
	/** A field id, or a model id for `ref` to a model and `model`; any target for a unit. */
	to: string;
}

export interface Relations {
	/** By the field the links are written on. */
	out: Map<string, FieldLink[]>;
	/** By the field or model they point at. */
	in: Map<string, FieldLink[]>;
	/** By model field: how many api fields send into it (`to`) or return it (`from`). */
	api: Map<string, number>;
}

/** Every field link in the design, both ways round. Links to unknown ids are left out. */
export function relationsOf(model: Model): Relations {
	const rels: Relations = { out: new Map(), in: new Map(), api: new Map() };
	const add = (m: Map<string, FieldLink[]>, k: string, l: FieldLink) =>
		m.set(k, [...(m.get(k) ?? []), l]);
	for (const [id, info] of model.fields) {
		const f = info.def;
		const links: FieldLink[] = [
			...(f.ref ? [{ kind: 'ref' as const, field: id, to: f.ref }] : []),
			...(f.model ? [{ kind: 'model' as const, field: id, to: f.model }] : []),
			...(f.from ?? []).map((to) => ({ kind: 'from' as const, field: id, to }))
		].filter((l) => model.fields.has(l.to) || model.elements.has(l.to));
		for (const l of links) {
			add(rels.out, id, l);
			add(rels.in, l.to, l);
		}
	}
	for (const [id, info] of model.elements)
		for (const kind of info.logic ? LOGIC_KEYS : [])
			for (const to of info.logic![kind])
				if (model.fields.has(to) || model.elements.has(to)) {
					const l = { kind, field: id, to };
					add(rels.out, id, l);
					add(rels.in, to, l);
				}
	for (const f of model.apiFields.values())
		for (const id of [...(f.def.to ?? []), ...(f.def.from ?? [])])
			if (model.fields.has(id)) rels.api.set(id, (rels.api.get(id) ?? 0) + 1);
	return rels;
}

/** Fields pointing at a field: foreign keys to it (`ref`) or fields derived from it (`from`). */
export const incomingCount = (rels: Relations, fieldId: string, kind: 'ref' | 'from' | 'api') =>
	kind === 'api'
		? (rels.api.get(fieldId) ?? 0)
		: (rels.in.get(fieldId)?.filter((l) => l.kind === kind).length ?? 0);

const IN_KIND = { inRef: 'ref', inFrom: 'from', inApi: 'api' } as const;

/** What an incoming slot's pill says. */
export const slotCount = (s: 'inRef' | 'inFrom' | 'inApi', n: number) =>
	s === 'inApi' ? `API ${n}` : String(n);

/** Badges after a field's name. */
export const keysOf = (f: ModelField) => [f.pk && 'PK', f.pi && 'PI'].filter((k) => k) as string[];

export const KEY_TITLES: Record<string, string> = { PK: 'Primary key', PI: 'Primary index' };

export const indexKind = (ix: ModelIndex) => (ix.unique ? 'Unique' : 'Index');

/** What a field ref shows: the model's name, or `Model.field` for a ref to a field. */
export function refLabel(model: Model, id: string): string | undefined {
	const field = model.fields.get(id);
	if (!field) return model.elements.get(id)?.name;
	return `${model.elements.get(field.modelId)?.name}.${field.def.name}`;
}

/**
 * A field's type, written as in TypeScript: its primitive or the held model's name, a generic
 * filled (`Page<Product>`), a union of models (`Card | Invoice`), a keyed map (`Map<string, decimal>`), and `[]` for a list.
 */
export const typeText = (
	f: Pick<ModelField, 'type' | 'model' | 'many' | 'oneOf' | 'map' | 'of'>,
	label: (id: string) => string | undefined
) => {
	const name = (id: string) => label(id) ?? id;
	let t = f.oneOf
		? f.oneOf.map(name).join(' | ')
		: f.model
			? name(f.model) + (f.of !== undefined ? `<${name(f.of)}>` : '')
			: (f.type ?? '');
	if (f.map !== undefined) t = `Map<${f.map}, ${t}>`;
	else if (f.many && f.oneOf) t = `(${t})`;
	return t + (f.many ? '[]' : '');
};

/** An index's fields by name, in index order. */
export const indexFields = (ix: ModelIndex, fields: ModelField[]) =>
	ix.fields.map((id) => fields.find((f) => f.id === id)?.name ?? id).join(', ');

/** A model card's type word, at the right of its name: CLASS, TABLE or FILE. */
export const kindWord = (view: ModelView, files?: boolean) =>
	view === 'table' ? (files ? 'FILE' : 'TABLE') : 'CLASS';
/** A channel card's type word: QUEUE or TOPIC. */
export const channelWord = (type: string | undefined) => (type ?? 'queue').toUpperCase();

/** Whether a model's stored form is a file: the module storing it keeps files. */
export const storedAsFile = (model: Model, modelId: string) =>
	model.elements.get(model.elements.get(modelId)?.storedIn ?? '')?.def.store === 'files';
/** Line under a model's name: its owner, when it is owned elsewhere. */
export const ownerNote = (owner?: string) => (owner ? `Owned by ${owner}` : '');

/** Every model holding each model through a `model` field, itself excluded. */
export function holdersOf(model: Model): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const [id, info] of model.elements)
		for (const f of info.def.fields ?? []) {
			if (!f.model || f.model === id || !model.elements.has(f.model)) continue;
			if (!out.has(f.model)) out.set(f.model, new Set());
			out.get(f.model)!.add(id);
		}
	return out;
}

/**
 * The model a model is a part of: the only model with the same owner that holds it. Parts
 * are drawn inside their root's boundary; a model held from several places stands alone.
 */
function partOf(model: Model, holders: Map<string, Set<string>>): Map<string, string> {
	const out = new Map<string, string>();
	for (const [id, hs] of holders) {
		const owner = model.elements.get(id)!.parentId;
		// A holder drawn as a table in the owner has no held models to show.
		const same = [...hs].filter((h) => {
			const holder = model.elements.get(h)!;
			return holder.parentId === owner && holder.storedIn !== owner;
		});
		if (owner && same.length === 1) out.set(id, same[0]);
	}
	// Models holding each other: the first one found is no part, so the rest have a root.
	for (const id of [...out.keys()]) {
		const seen = new Set([id]);
		let cur = out.get(id);
		while (cur && !seen.has(cur)) {
			seen.add(cur);
			cur = out.get(cur);
		}
		if (cur === id) out.delete(id);
	}
	return out;
}

/**
 * The fields that exist in a view. A table has no held models and no `stored: false`
 * fields; a class has no ref to a model holding it, as being held already links the two.
 */
export function viewFields(
	model: Model,
	holders: Map<string, Set<string>>,
	modelId: string,
	view: ModelView
): ModelField[] {
	const fields = model.elements.get(modelId)?.def.fields ?? [];
	if (view === 'table') return fields.filter((f) => !f.model && f.stored !== false);
	const hs = holders.get(modelId);
	return fields.filter((f) => {
		if (!f.ref || !hs) return true;
		return !hs.has(model.fields.get(f.ref)?.modelId ?? f.ref);
	});
}

/** A card with more fields than this shows only the first ones, and a row to show all. */
export const FOLD = 20;

/**
 * Whether a card of `count` fields is folded: its rows past `at` hide behind a toggle row.
 * `at` is `FOLD` but for a card that shows only some rows on purpose, as in a focus.
 */
export const foldable = (count: number, at = FOLD) => count > at;

/** How many field rows a card of `count` fields shows. */
export const shownRows = (count: number, expanded: boolean, at = FOLD) =>
	foldable(count, at) && !expanded ? at : count;

/**
 * Vertical centre of field row `i` of `count`: below the border, the name bar and the header
 * row. A row hidden in a folded card sits on the toggle row, so its lines end there.
 */
export const fieldRowY = (i: number, count: number, expanded: boolean, at = FOLD) =>
	1 + TABLE.head + (Math.min(i, shownRows(count, expanded, at)) + 1.5) * TABLE.rowHeight;

/** Vertical centre of unit row `i` of a logic card, which has no header row. */
export const logicRowY = (i: number) => 1 + TABLE.head + (i + 0.5) * TABLE.rowHeight;

/** A badge's width: its text and 6px padding each side (see GlLayer). */
export const badgeWidth = (label: string) => textWidth(label, TABLE.badge, true) + 12;

const badgesWidth = (labels: string[]) =>
	labels.reduce((w, k, i) => w + badgeWidth(k) + (i ? TABLE.badgeGap : 0), 0);

/**
 * Widest a field column may be, padding included. A longer cell is cut: a name at its end, a
 * type at its front, and constraints fold into `+n` (see `fitBadges`).
 */
export const COL_MAX: Partial<Record<FieldColumn, number>> = {
	name: 240,
	type: 200,
	constraints: 240
};

/** Room for a cell's content in column `c`. */
export const cellRoom = (c: TableColumn) => c.width - 2 * TABLE.pad;

/**
 * A field's constraints as cards show them: its `values` first, as an enum named after the
 * field, then the free-text ones.
 */
export const constraintsOf = (f: Pick<ModelField, 'name' | 'values' | 'constraints'>) => [
	...(f.values ? [`enum ${f.name}: ${f.values.join(', ')}`] : []),
	...(f.constraints ?? [])
];

/** A constraint written `enum Name: a, b, c`: the enum's name and its values. */
export function enumOf(constraint: string): { name: string; values: string[] } | undefined {
	const m = /^enum\s+([^:]+?)\s*:(.*)$/s.exec(constraint.trim());
	const values = m?.[2]
		.split(',')
		.map((v) => v.trim())
		.filter(Boolean);
	return m && values?.length ? { name: m[1], values } : undefined;
}

/** A constraint as a card shows it: an enum by its name and how many values it has. */
export function constraintLabel(constraint: string): string {
	const e = enumOf(constraint);
	return e ? `enum ${e.name} · ${e.values.length}` : constraint;
}

/**
 * The badges that fit in `max` px, left to right, and how many more fold into a `+n` badge
 * after them. A first badge too wide on its own is cut, so a cell never shows none.
 */
export function fitBadges(labels: string[], max: number): { shown: string[]; more: number } {
	const plus = (n: number) => (n ? TABLE.badgeGap + badgeWidth(`+${n}`) : 0);
	const shown: string[] = [];
	let w = 0;
	for (const [i, k] of labels.entries()) {
		const next = w + (i ? TABLE.badgeGap : 0) + badgeWidth(k);
		if (next + plus(labels.length - i - 1) > max) break;
		shown.push(k);
		w = next;
	}
	if (!shown.length && labels.length)
		shown.push(truncate(labels[0], max - plus(labels.length - 1) - 12, TABLE.badge, true));
	return { shown, more: labels.length - shown.length };
}

/** A field's constraint badges in `max` px. */
export const constraintBadges = (f: ModelField, max: number) =>
	fitBadges(constraintsOf(f).map(constraintLabel), max);

/** A field's name in `max` px, leaving room for its key badges in a table. */
export function nameText(f: ModelField, view: ModelView | undefined, max: number): string {
	const keys = view === 'table' ? keysOf(f) : [];
	const room = max - (keys.length ? TABLE.badgeGap + badgesWidth(keys) : 0);
	return truncate(f.name, room, TABLE.row);
}

/** A field's type in `max` px, cut at the front so a qualified name keeps its end. */
export const typeCell = (f: ModelField, label: (id: string) => string | undefined, max: number) =>
	truncateStart(typeText(f, label), max, TABLE.row);

/**
 * Field columns. Required and nullable are always shown, so a blank reads as "no"; the
 * others only when some row has something in them.
 */
function fieldColumns(
	fields: ModelField[],
	view: ModelView,
	label: (id: string) => string | undefined,
	rels: Relations
): TableColumn[] {
	const text = (s: string) => textWidth(s, TABLE.row);
	const defs: [FieldColumn, string, string | undefined, number[], boolean][] = [
		[
			'name',
			'Name',
			undefined,
			fields.map((f) => {
				const keys = view === 'table' ? keysOf(f) : [];
				return text(f.name) + (keys.length ? TABLE.badgeGap + badgesWidth(keys) : 0);
			}),
			true
		],
		['type', 'Type', undefined, fields.map((f) => text(typeText(f, label))), true],
		['required', 'Req', 'Required', [text(TABLE.check)], true],
		['nullable', 'Null', 'Nullable', [text(TABLE.check)], true],
		[
			'constraints',
			'Constraints',
			undefined,
			fields.map((f) => badgesWidth(constraintsOf(f).map(constraintLabel))),
			false
		]
	];
	const cols: TableColumn[] = defs
		.filter(([, , , ws, always]) => always || ws.some((w) => w > 0))
		.map(([key, label, title, ws]) => {
			const cap = (COL_MAX[key] ?? Infinity) - 2 * TABLE.pad;
			const widest = Math.min(cap, Math.max(...ws));
			return {
				key,
				label,
				title,
				width: Math.max(textWidth(label, TABLE.label, true), widest) + 2 * TABLE.pad
			};
		});
	const slots = linkSlots(fields, rels);
	if (slots.length)
		cols.push({
			key: 'links',
			label: '',
			title: 'References, sources and incoming links; hover or click a row',
			slots,
			width: slots.reduce((w, s) => w + slotWidth(s, fields, rels), 0) + TABLE.pad
		});
	return cols;
}

/** The slots a card's link strip needs: those some field fills. */
function linkSlots(fields: ModelField[], rels: Relations): LinkSlot[] {
	const has: Record<LinkSlot, boolean> = {
		ref: fields.some((f) => f.ref),
		from: fields.some((f) => f.from?.length),
		inRef: fields.some((f) => incomingCount(rels, f.id, 'ref') > 0),
		inFrom: fields.some((f) => incomingCount(rels, f.id, 'from') > 0),
		inApi: fields.some((f) => incomingCount(rels, f.id, 'api') > 0)
	};
	return (['ref', 'from', 'inRef', 'inFrom', 'inApi'] as const).filter((s) => has[s]);
}

/** An incoming slot holds a count pill, so it is as wide as the largest one. */
const slotWidth = (s: LinkSlot, fields: ModelField[], rels: Relations) =>
	s === 'inRef' || s === 'inFrom' || s === 'inApi'
		? 14 +
			Math.max(
				...fields.map((f) =>
					textWidth(slotCount(s, incomingCount(rels, f.id, IN_KIND[s])), LINK.count, true)
				)
			)
		: LINK.slot;

/** One index per row: its kind badge, its name, then its fields. */
const indexWidth = (ix: ModelIndex, fields: ModelField[]) =>
	badgesWidth([indexKind(ix)]) +
	2 * TABLE.badgeGap +
	textWidth(ix.name, TABLE.row) +
	textWidth(`  ${indexFields(ix, fields)}`, TABLE.row) +
	2 * TABLE.pad;

function tableLayout(
	name: string,
	def: Element,
	fields: ModelField[],
	view: ModelView,
	owner: string | undefined,
	label: (id: string) => string | undefined,
	rels: Relations,
	at: number
): { size: Size; cols: TableColumn[] } {
	const indexes = view === 'table' ? (def.indexes ?? []) : [];
	const cols = fieldColumns(fields, view, label, rels);
	// The 2px is the card's border, which sits inside the box.
	const width = Math.max(
		textWidth(name, TABLE.title, true) +
			GLYPH * TABLE.title +
			TABLE.kindGap +
			textWidth(kindWord(view), TABLE.label, true) * 1.1 +
			2 * TABLE.pad,
		textWidth(ownerNote(owner), TABLE.note) + 2 * TABLE.pad,
		fields.length ? cols.reduce((w, c) => w + c.width, 0) : 0,
		...indexes.map((ix) => indexWidth(ix, fields))
	);
	const rows = (n: number) => (n ? n + 1 : 0);
	// Laid out folded in every mode: an expanded card draws over what is below it rather than
	// moving it.
	const fieldRows =
		rows(shownRows(fields.length, false, at)) + (foldable(fields.length, at) ? 1 : 0);
	const height = TABLE.head + (fieldRows + rows(indexes.length)) * TABLE.rowHeight;
	return { size: { width: Math.ceil(width) + 2, height: height + 2 }, cols };
}

/** A row of a logic or triggers card: a unit's name and signature, or a trigger's name and schedule. */
export interface LogicRow {
	id: string;
	name: string;
	/**
	 * A unit's `(productId, quantity) → Cart Line`, an output that is a model by the model's
	 * name; a trigger's schedule or message in words.
	 */
	signature: string;
	/**
	 * The glyph before a trigger's or port's name: its event's (`received`, `updated`, …), a
	 * clock (`trigger`) for a schedule, an envelope (`message`) for an old message trigger.
	 */
	glyph?: string;
	/** A port nothing listens to: drawn muted. */
	idle?: true;
	/** A unit that is dead code (see `reachOf`): drawn faded. */
	dead?: true;
}

export function logicRow(model: Model, id: string): LogicRow {
	const def = model.elements.get(id)!.def;
	const outs = (def.outputs ?? []).map((o) =>
		o.model || o.oneOf ? typeText(o, (id) => model.elements.get(id)?.name) : o.name
	);
	return {
		id,
		name: model.elements.get(id)!.name,
		signature: `(${(def.inputs ?? []).map((f) => f.name).join(', ')})${outs.length ? ` → ${outs.join(', ')}` : ''}`,
		...((model.reach?.get(id)?.state ?? 'live') === 'live' ? {} : { dead: true as const })
	};
}

/** Room for the ƒ before a unit's name. */
const FN_GLYPH = 14;

export const triggerRow = (model: Model, id: string): LogicRow => {
	const el = model.elements.get(id)!;
	return {
		id,
		name: el.name,
		signature: triggerWords(el.def, model, el.name),
		glyph: triggerGlyph(el.def)
	};
};

/**
 * A channel's rows: one per port, its event (after its subscription, on a topic) and the
 * triggers listening to it, or `none`.
 */
export const channelRows = (model: Model, id: string): LogicRow[] =>
	[...model.ports.values()]
		.filter((p) => p.channel === id)
		.map((p) => ({
			id: p.id,
			name: p.subscription !== undefined ? `${p.subscription} · ${p.event}` : p.event,
			signature: p.triggers.length
				? p.triggers.map((t) => model.elements.get(t)?.name ?? t).join(', ')
				: 'none',
			glyph: p.event,
			...(p.triggers.length ? {} : { idle: true as const })
		}));

/** Line under a channel card's name: what it carries, its retries, else what it runs on. */
export function channelNote(model: Model, id: string): string {
	const def = model.elements.get(id)?.def;
	if (!def) return '';
	const carries = def.carries ? model.elements.get(def.carries)?.name : undefined;
	return [
		carries ? `carries ${carries}` : def.via,
		def.retries !== undefined ? `retries ${def.retries}` : '',
		def.external ? 'sent from outside' : ''
	]
		.filter(Boolean)
		.join(' · ');
}

/**
 * A module's logic or triggers card: a name bar, then one row per unit (its name and
 * signature) or trigger (its name and source).
 */
function rowsLayout(
	rows: LogicRow[],
	title: string,
	note: string,
	word = ''
): { size: Size; cols: TableColumn[] } {
	const col = (key: LogicColumn, ws: number[]) => ({
		key,
		label: '',
		width: Math.max(0, ...ws) + 2 * TABLE.pad
	});
	const cols = [
		col(
			'name',
			rows.map((r) => FN_GLYPH + textWidth(r.name, TABLE.row))
		),
		col(
			'signature',
			rows.map((r) => textWidth(r.signature, TABLE.signature))
		)
	];
	const width = Math.max(
		textWidth(title, TABLE.title, true) +
			GLYPH * TABLE.title +
			2 * TABLE.pad +
			(word ? textWidth(word, TABLE.label, true) * 1.1 + TABLE.kindGap : 0),
		textWidth(note, TABLE.note) + 2 * TABLE.pad,
		cols.reduce((w, c) => w + c.width, 0)
	);
	const height = TABLE.head + rows.length * TABLE.rowHeight;
	return { size: { width: Math.ceil(width) + 2, height: height + 2 }, cols };
}

/** Line under a logic card's name. */
export const logicNote = (n: number) => `${n} logic unit${n === 1 ? '' : 's'}`;
/** Line under a triggers card's name. */
export const triggersNote = (n: number) => `${n} trigger${n === 1 ? '' : 's'}`;

const leafWidth = (name: string) =>
	Math.max(LEAF.minWidth, textWidth(name, LEAF.font, true) + GLYPH * LEAF.font + 2 * LEAF.padX);

/** A block of siblings: where each goes, relative to the block, by box id. */
interface Block extends Size {
	at: Map<string, { x: number; y: number }>;
	/** The routes of the Module Dependency Lines among them, from the start's border. */
	routes: Map<string, Point[]>;
}

/**
 * Lines among siblings are this share of the largest one's shorter side apart, so they read
 * once the boxes they join do, at whatever zoom that is.
 */
const LINE_SHARE = 0.05;

/** A route's end `p`, next to `q`, on a box grown `m` all round about `c`, moved onto the box. */
function inward(p: Point, q: Point, m: number, c: Point) {
	if (p.y === q.y) p.x += p.x < c.x ? m : -m;
	else p.y += p.y < c.y ? m : -m;
}

/**
 * ELK's spacing at one level: `gap` between boxes, lines `pitch` apart and half a gap off the
 * boxes, so the room between two boxes grows by a pitch for each line routed through it.
 */
const spacing = (gap: number, pitch: number) => ({
	'elk.spacing.nodeNode': String(gap),
	'elk.spacing.componentComponent': String(gap),
	'elk.layered.spacing.nodeNodeBetweenLayers': String(gap),
	// No more than `gap` within a layer: ELK's compaction fails on lines kept further apart there
	// than boxes ("Invalid hitboxes for scanline constraint calculation").
	'elk.spacing.edgeEdge': String(Math.min(pitch, gap)),
	'elk.spacing.edgeNode': String(gap / 2),
	'elk.layered.spacing.edgeEdgeBetweenLayers': String(pitch),
	'elk.layered.spacing.edgeNodeBetweenLayers': String(gap / 2)
});

/** By id, so the order of the files changes nothing. */
const idOrder = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * A line between two sibling boxes standing for every connection between their insides: each
 * end of a connection lifted to the child of the box both ends share, the connections landing
 * on one pair, one way, merged. A line never crosses a border.
 */
export interface LaidLine {
	/** `<source>><target>`. */
	id: string;
	/** The box whose inside depends on the other's; the line starts here. */
	source: string;
	/** The box depended on; the arrow points here. */
	target: string;
	/** The box both sit in; none for two top-level boxes. */
	parentId?: string;
	/** The connections it merges, each once. */
	edges: Edge[];
}

/** The boxes, parents before their children, and the lines between them. */
export interface Landscape {
	boxes: LandscapeBox[];
	lines: LaidLine[];
	/**
	 * The Module Dependency Lines' routes by line id (see connections.ts `moduleLines`), as ELK
	 * routed them while placing the boxes: corners from the start's border to the end's.
	 */
	routes: Map<string, Point[]>;
}

/**
 * Lays out the element tree by ELK's layered algorithm, with every connection as a line between
 * siblings (see `LaidLine`): what is depended on before what depends on it (in
 * `opts.direction`), crossings few, the more connections a line merges the shorter and
 * straighter. ELK routes the Module Dependency Lines as it places the boxes, and the canvas
 * draws its routes (`routes`), so the room between boxes is the room their lines take; lit
 * lines are routed on the canvas (see route.ts). Siblings no line joins
 * are laid out apart and packed. Each box is laid out inside first, then among its siblings as
 * one box of its size. Leaves are fitted to their content, groups round their
 * children; each box keeps room right of it for its rail. Boxes are taken in id order, so the
 * order of the files changes nothing.
 *
 * A model is a class card in its owner, inside a boundary with the models only it holds, and
 * a table card in the entity storing it. A model stored where it is owned is one table card.
 * Cards over `FOLD` fields are laid out folded; `foldAt` folds a model's cards after that
 * many rows instead, by model id.
 */
export function layoutLandscape(
	model: Model,
	opts: LayoutOptions = DEFAULT_LAYOUT,
	foldAt = new Map<string, number>()
): Landscape {
	const gap = 48 * opts.spacing;
	const systemGap = 160 * opts.spacing;
	const out: LandscapeBox[] = [];
	const routes = new Map<string, Point[]>();
	const sizes = new Map<string, Size>();
	const cards = new Map<string, { cols: TableColumn[]; fields: ModelField[] }>();
	const logicCards = new Map<string, { cols: TableColumn[]; rows: LogicRow[] }>();
	const holders = holdersOf(model);
	const rels = relationsOf(model);
	const parts = partOf(model, holders);
	const rootOf = (id: string): string => (parts.has(id) ? rootOf(parts.get(id)!) : id);
	const hasParts = new Set([...parts.keys()].map(rootOf));
	const card = (id: string): Item => {
		const info = model.elements.get(id)!;
		return { id, el: id, ref: false, view: info.storedIn === info.parentId ? 'table' : 'class' };
	};
	const owned = (id: string): Item => {
		if (model.elements.get(id)!.def.kind !== 'model') return { id, el: id, ref: false };
		return hasParts.has(id) ? { id: `${id}#parts`, el: id, ref: false, boundary: true } : card(id);
	};
	// A model owned elsewhere is drawn as a closed card, so it never has boxes inside.
	const kidsOf = (item: Item): Item[] => {
		const info = model.elements.get(item.el);
		if (item.ref || item.view || item.card || !info) return [];
		if (item.boundary)
			return model.elements
				.get(info.parentId!)!
				.childIds.filter((id) => id === item.el || (parts.has(id) && rootOf(id) === item.el))
				.map(card);
		// A module's triggers share one card, drawn first, then its logic units share one.
		const rowCard = (card: 'logic' | 'triggers', has: boolean): Item[] =>
			has ? [{ id: `${item.id}#${card}`, el: item.el, ref: false, card }] : [];
		return [
			...rowCard('triggers', info.childIds.some(isTrigger)),
			...rowCard('logic', info.childIds.some(isUnit)),
			// Each channel is a card of its own, its events its rows.
			...info.childIds
				.filter(isChannel)
				.map((id) => ({ id, el: id, ref: false, card: 'channel' as const })),
			...info.childIds
				.filter(
					(id) => !parts.has(id) && !isApi(id) && !isUnit(id) && !isTrigger(id) && !isChannel(id)
				)
				.map(owned),
			...info.refIds.map((id) => ({
				id: `${item.id}>${id}`,
				el: id,
				ref: true,
				view: 'class' as const
			})),
			...info.storedIds.map((id) => ({
				id: `${item.id}>${id}`,
				el: id,
				ref: true,
				view: 'table' as const
			}))
		];
	};
	const isApi = (id: string) => model.elements.get(id)!.def.kind === 'api';
	const isUnit = (id: string) => model.elements.get(id)!.def.kind === 'logic-unit';
	const isTrigger = (id: string) => model.elements.get(id)!.def.kind === 'trigger';
	const isChannel = (id: string) => model.elements.get(id)!.def.kind === 'channel';
	const apisOf = (item: Item) =>
		item.ref || item.view || item.boundary || item.card
			? []
			: (model.elements.get(item.el)?.childIds.filter(isApi) ?? []);
	// Every api inside an element, which all move to its rail while it is closed.
	const deepApis = (id: string): string[] =>
		model.elements.get(id)!.childIds.flatMap((c) => (isApi(c) ? [c] : deepApis(c)));
	const railWidth = (el: string, apis: string[], height: number) =>
		apis.length ? railOf(model, railGroups(model, el, apis), height).width : 0;
	/** Half of the own rail, which sits inside the box, so children keep clear of it. */
	const inner = new Map<string, number>();
	/** Room lines keep clear of each box (see `LandscapeBox.clear`). */
	const clear = new Map<string, number>();
	/** What a box keeps clear beyond what every box does: the room the layout adds for it. */
	const extra = (id: string) => (clear.get(id) ?? ROUTE.buffer) - ROUTE.buffer;

	// The box tree, and the boxes each leaf (model, field, unit, api, api field) is drawn in.
	const kidsBy = new Map<string, Item[]>();
	const parentOf = new Map<string, string>();
	const homes = new Map<string, Item[]>();
	const leavesOf = (item: Item): string[] => {
		const apis = apisOf(item);
		return [
			...(item.view
				? [item.el, ...viewFields(model, holders, item.el, item.view).map((f) => f.id)]
				: []),
			...(item.card === 'channel'
				? [item.el, ...channelRows(model, item.el).map((r) => r.id)]
				: item.card
					? model.elements.get(item.el)!.childIds.filter(item.card === 'logic' ? isUnit : isTrigger)
					: []),
			...apis,
			...[...model.apiFields].filter(([, f]) => apis.includes(f.apiId)).map(([id]) => id)
		];
	};
	// A module's triggers card first, then its logic card, its channels, then the rest.
	const rank = (k: Item) =>
		k.card === 'triggers' ? 0 : k.card === 'logic' ? 1 : k.card === 'channel' ? 2 : 3;
	const walk = (item: Item, parent?: string) => {
		const kids = kidsOf(item).sort((a, b) => rank(a) - rank(b) || idOrder(a, b));
		kidsBy.set(item.id, kids);
		if (parent) parentOf.set(item.id, parent);
		for (const leaf of leavesOf(item)) homes.set(leaf, [...(homes.get(leaf) ?? []), item]);
		for (const k of kids) walk(k, item.id);
	};
	const roots: Item[] = model.rootElementIds
		.map((id) => ({ id, el: id, ref: false }))
		.sort(idOrder);
	for (const r of roots) walk(r);

	const chain = (id: string) => {
		const out = [id];
		for (let p = parentOf.get(id); p; p = parentOf.get(p)) out.push(p);
		return out;
	};
	// A leaf drawn in several boxes links to a sibling where it can, else to where it is owned
	// (see `linkTarget`).
	const nearest = (a: Item, to: string) =>
		(homes.get(to) ?? homes.get(modelOf(model, to)) ?? [])
			.map((c) => ({ c, score: (parentOf.get(c.id) === parentOf.get(a.id) ? 0 : 2) + +c.ref }))
			.sort((x, y) => x.score - y.score)[0]?.c;

	/** A box without children, fitted to its content. */
	function measure(item: Item): Size {
		const info = model.elements.get(item.el);
		let size: Size;
		if (info && item.view) {
			const owner = item.ref ? model.elements.get(info.parentId ?? '')?.name : undefined;
			const fields = viewFields(model, holders, info.id, item.view);
			const t = tableLayout(
				info.name,
				info.def,
				fields,
				item.view,
				owner,
				(id) => refLabel(model, id),
				rels,
				foldAt.get(info.id) ?? FOLD
			);
			cards.set(item.id, { cols: t.cols, fields });
			size = t.size;
		} else if (info && item.card === 'logic') {
			const rows = info.childIds.filter(isUnit).map((id) => logicRow(model, id));
			const l = rowsLayout(rows, 'Logic', logicNote(rows.length));
			logicCards.set(item.id, { cols: l.cols, rows });
			size = l.size;
		} else if (info && item.card === 'triggers') {
			const rows = info.childIds.filter(isTrigger).map((id) => triggerRow(model, id));
			const l = rowsLayout(rows, 'Triggers', triggersNote(rows.length));
			logicCards.set(item.id, { cols: l.cols, rows });
			size = l.size;
		} else if (info && item.card === 'channel') {
			const rows = channelRows(model, info.id);
			const l = rowsLayout(
				rows,
				info.name,
				channelNote(model, info.id),
				channelWord(info.def.type)
			);
			logicCards.set(item.id, { cols: l.cols, rows });
			size = l.size;
		} else size = { width: leafWidth(info?.name ?? item.el), height: LEAF.height };
		const own = railWidth(item.el, apisOf(item), size.height) / 2;
		if (own) {
			inner.set(item.id, own);
			size.width += own;
		}
		// Closed, the box carries the apis of everything inside it too.
		const deep = item.ref || item.view || item.boundary || item.card ? [] : deepApis(item.el);
		const right = Math.max(own, railWidth(item.el, deep, size.height) / 2);
		if (right) size.right = right;
		sizes.set(item.id, size);
		clear.set(item.id, clearanceOf(size.width, size.height));
		return size;
	}

	function place(items: Item[], area: Size & { x: number; y: number }, parent?: LandscapeBox) {
		const block = blocks.get(parent?.id ?? '')!;
		const x0 = area.x + (area.width - block.width) / 2;
		const y0 = area.y + (area.height - block.height) / 2;
		for (const [id, pts] of block.routes)
			routes.set(
				id,
				pts.map((p) => ({ x: x0 + p.x, y: y0 + p.y }))
			);
		for (const item of items) {
			const slot = { ...block.at.get(item.id)!, ...sizes.get(item.id)! };
			const absX = x0 + slot.x;
			const absY = y0 + slot.y;
			const kids = kidsBy.get(item.id)!;
			const box: LandscapeBox = {
				id: item.id,
				elementId: item.el,
				ref: item.ref,
				boundary: item.boundary ?? false,
				group: kids.length > 0,
				parentId: parent?.id,
				absX,
				absY,
				width: slot.width,
				height: slot.height,
				table: cards.get(item.id)?.cols,
				view: item.view,
				fields: cards.get(item.id)?.fields,
				foldAt: item.view ? foldAt.get(item.el) : undefined,
				apis: apisOf(item),
				logic: item.card === 'logic' ? logicCards.get(item.id) : undefined,
				triggers: item.card === 'triggers' ? logicCards.get(item.id) : undefined,
				channel: item.card === 'channel' ? logicCards.get(item.id) : undefined,
				...(item.view === 'table' && storedAsFile(model, item.el) ? { files: true as const } : {}),
				clear: clear.get(item.id) ?? ROUTE.buffer
			};
			out.push(box);
			const m = extra(item.id);
			if (kids.length)
				place(
					kids,
					{
						x: absX + PAD + m,
						y: absY + HEADER + m,
						width: slot.width - 2 * (PAD + m) - (inner.get(item.id) ?? 0),
						height: slot.height - HEADER - PAD - 2 * m
					},
					box
				);
		}
	}

	if (!roots.length) return { boxes: out, lines: [], routes: new Map() };
	const items = new Map<string, Item>();
	for (const kids of kidsBy.values()) for (const k of kids) items.set(k.id, k);
	for (const r of roots) items.set(r.id, r);
	for (const item of items.values()) if (!kidsBy.get(item.id)!.length) measure(item);

	// Every connection lifted to the two siblings holding its ends (see `LaidLine`). One between
	// a box and what is inside it, or inside one box, has no line.
	const laid = new Map<string, LaidLine>();
	const merged = new Set<string>();
	for (const e of edgesOf(model))
		for (const a of homes.get(e.from) ?? []) {
			const b = nearest(a, e.to);
			if (!b || b === a) continue;
			const ca = chain(a.id);
			const cb = chain(b.id);
			const shared = ca.find((id) => cb.includes(id));
			if (shared === a.id || shared === b.id) continue;
			const source = shared ? ca[ca.indexOf(shared) - 1] : ca.at(-1)!;
			const target = shared ? cb[cb.indexOf(shared) - 1] : cb.at(-1)!;
			const id = `${source}>${target}`;
			const l = laid.get(id) ?? { id, source, target, parentId: shared, edges: [] };
			laid.set(id, l);
			if (merged.has(`${id}|${edgeKey(e)}`)) continue;
			merged.add(`${id}|${edgeKey(e)}`);
			l.edges.push(e);
		}
	const lines = [...laid.values()].sort(idOrder);
	// The Module Dependency Lines, drawn at rest: ELK routes them as it places the boxes, among
	// the lines that place them, so the room between boxes is the room their lines take.
	const drawn = moduleLines(model, edgesOf(model), (id) => items.has(id));
	const drawnIds = new Set(drawn.map((l) => l.id));
	const ties = new Map<string, LaidLine & { weight: number }>(
		lines.map((l) => [l.id, { ...l, weight: l.edges.length }])
	);
	for (const l of drawn) {
		const tie = ties.get(l.id);
		if (tie) tie.weight = Math.max(tie.weight, l.count);
		else
			ties.set(l.id, {
				id: l.id,
				source: l.source,
				target: l.target,
				parentId: l.parentId,
				edges: [],
				weight: l.count
			});
	}
	const tied = [...ties.values()].sort(idOrder);

	/** Siblings in `parent` (none for the top level) in groups joined by lines. */
	const components = (parent: string | undefined, kids: Item[]) => {
		const up = new Map(kids.map((k) => [k.id, k.id]));
		const find = (id: string): string => (up.get(id) === id ? id : find(up.get(id)!));
		for (const l of tied) if (l.parentId === parent) up.set(find(l.source), find(l.target));
		const groups = new Map<string, Item[]>();
		for (const k of kids) groups.set(find(k.id), [...(groups.get(find(k.id)) ?? []), k]);
		return [...groups.values()];
	};

	/** Blocks in rows, in order, packed to about `opts.aspect`, `g` apart. */
	const pack = (parts: Block[], g: number): Block => {
		const area = parts.reduce((sum, b) => sum + (b.width + g) * (b.height + g), 0);
		const rowWidth = Math.max(...parts.map((b) => b.width), Math.sqrt(area * opts.aspect));
		const at = new Map<string, { x: number; y: number }>();
		const routes = new Map<string, Point[]>();
		let [x, y, rowHeight, width] = [0, 0, 0, 0];
		for (const b of parts) {
			if (x > 0 && x + b.width > rowWidth) [x, y, rowHeight] = [0, y + rowHeight + g, 0];
			for (const [id, p] of b.at) at.set(id, { x: x + p.x, y: y + p.y });
			for (const [id, pts] of b.routes)
				routes.set(
					id,
					pts.map((p) => ({ x: x + p.x, y: y + p.y }))
				);
			width = Math.max(width, x + b.width);
			x += b.width + g;
			rowHeight = Math.max(rowHeight, b.height);
		}
		return { width, height: y + rowHeight, at, routes };
	};

	// A group's rail scales with the group's height, so keep room for it at full size.
	const fullRail = (item: Item) => {
		const own = railWidth(item.el, apisOf(item), Infinity) / 2;
		if (own) inner.set(item.id, own);
		const deep = item.boundary ? [] : deepApis(item.el);
		return Math.max(own, railWidth(item.el, deep, Infinity) / 2);
	};

	/**
	 * Systems and modules among siblings `kids` grown to `opts.minShare` of the widest and of the
	 * tallest of them, so one with little or nothing inside is not lost beside large ones. What
	 * is inside a grown box stays centred in it (see `place`). A grown box keeps room for its
	 * rails at full size, as a group does, since they scale with the box's height.
	 */
	const atLeast = (kids: Item[]) => {
		if (!opts.minShare || kids.length < 2) return;
		const w = opts.minShare * Math.max(...kids.map((k) => sizes.get(k.id)!.width));
		const h = opts.minShare * Math.max(...kids.map((k) => sizes.get(k.id)!.height));
		for (const item of kids) {
			if (item.ref || item.view || item.card || item.boundary) continue;
			const size = sizes.get(item.id)!;
			if (size.width >= w && size.height >= h) continue;
			const was = inner.get(item.id) ?? 0;
			const right = fullRail(item);
			sizes.set(item.id, {
				width: Math.max(size.width - was + (inner.get(item.id) ?? 0), w),
				height: Math.max(size.height, h),
				right: right || undefined
			});
		}
	};

	// Each group's children, relative to the room inside it ('' for the top level).
	const blocks = new Map<string, Block>();
	/**
	 * Siblings `parent` holds (none for the top level), `g` apart: those lines join laid out
	 * together, the groups no line joins packed. Every group among them is laid out inside first
	 * and then stands as one box of its size, at least `opts.minShare` of the largest. Lines
	 * among them are `LINE_SHARE` of the largest one's shorter side apart, at least
	 * `ROUTE.spread`, so they read once the boxes they join do.
	 */
	const layout = (parent: string | undefined, kids: Item[], g: number): Block => {
		for (const item of kids) {
			const inside = kidsBy.get(item.id)!;
			if (!inside.length) continue;
			const right = fullRail(item);
			const block = layout(item.id, inside, gap);
			blocks.set(item.id, block);
			// Lines keep more room off a larger box, so it keeps that much more round its children.
			const width = block.width + 2 * PAD + (inner.get(item.id) ?? 0);
			const height = block.height + HEADER + PAD;
			clear.set(item.id, clearanceOf(width, height));
			const m = extra(item.id);
			sizes.set(item.id, {
				width: width + 2 * m,
				height: height + 2 * m,
				right: right || undefined
			});
		}
		atLeast(kids);
		const parts = components(parent, kids);
		const largest = Math.max(
			...kids.map((k) => Math.min(sizes.get(k.id)!.width, sizes.get(k.id)!.height))
		);
		const pitch = Math.max(ROUTE.spread, Math.round(LINE_SHARE * largest));
		return parts.length === 1
			? run(kids, g, pitch)
			: pack(
					parts.map((c) => run(c, g, pitch)),
					g
				);
	};
	/**
	 * Siblings `top`, `g` apart and further by what each keeps clear beyond `buffer` (see
	 * `extra`), lines among them `pitch` apart, as one ELK graph.
	 */
	const run = (top: Item[], g: number, pitch: number): Block => {
		const block = placed(top, g, pitch);
		const mid = new Map<string, Point>();
		for (const item of top) {
			const at = block.at.get(item.id)!;
			const size = sizes.get(item.id)!;
			const m = extra(item.id);
			mid.set(item.id, {
				x: at.x + m + (size.width + (size.right ?? 0)) / 2,
				y: at.y + m + size.height / 2
			});
			block.at.set(item.id, { x: at.x + m, y: at.y + m });
		}
		// ELK's routes end on the grown boxes: on to the boxes themselves.
		for (const [id, pts] of block.routes) {
			const { source, target } = ties.get(id)!;
			inward(pts[0], pts[1], extra(source), mid.get(source)!);
			inward(pts.at(-1)!, pts.at(-2)!, extra(target), mid.get(target)!);
		}
		return block;
	};
	/** Siblings `top` placed as `run` does, each grown by its `extra` all round. */
	const placed = (top: Item[], g: number, pitch: number): Block => {
		const ids = new Set(top.map((i) => i.id));
		const children = top.map((item) => {
			const size = sizes.get(item.id)!;
			const m = extra(item.id);
			return {
				id: item.id,
				width: size.width + (size.right ?? 0) + 2 * m,
				height: size.height + 2 * m
			};
		});
		const among = tied.filter((l) => ids.has(l.source));
		const graph = elkLayout({
			id: 'root',
			layoutOptions: {
				...spacing(g, pitch),
				'elk.algorithm': 'layered',
				'elk.direction': opts.direction,
				'elk.padding': '[top=0,left=0,bottom=0,right=0]',
				'elk.edgeRouting': 'ORTHOGONAL',
				'elk.layered.nodePlacement.strategy': opts.placement,
				// Pulls boxes in along the flow where the lines allow, to shorten them.
				'elk.layered.compaction.postCompaction.strategy': 'EDGE_LENGTH'
			},
			children,
			edges: among.map((l) => ({
				id: l.id,
				sources: [l.target],
				targets: [l.source],
				layoutOptions: {
					'elk.layered.priority.shortness': String(l.weight),
					'elk.layered.priority.straightness': String(l.weight)
				}
			}))
		});
		return blockOf(graph);
	};
	/** Where boxes went, relative to the block they make. */
	/**
	 * Where boxes went, and the Module Dependency Lines' routes, relative to the block they make.
	 * ELK runs each line from what is depended on, so its route is turned round.
	 */
	const blockOf = (graph: ElkNode): Block => {
		const kids = graph.children!;
		const x0 = Math.min(...kids.map((c) => c.x!));
		const y0 = Math.min(...kids.map((c) => c.y!));
		const routes = new Map<string, Point[]>();
		for (const e of graph.edges ?? []) {
			const s = e.sections?.[0];
			if (!s || !drawnIds.has(e.id)) continue;
			const pts = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint];
			routes.set(e.id, pts.map((p) => ({ x: p.x - x0, y: p.y - y0 })).reverse());
		}
		return {
			width: Math.max(...kids.map((c) => c.x! + c.width!)) - x0,
			height: Math.max(...kids.map((c) => c.y! + c.height!)) - y0,
			at: new Map(kids.map((c) => [c.id, { x: c.x! - x0, y: c.y! - y0 }])),
			routes
		};
	};
	blocks.set('', layout(undefined, roots, systemGap));

	place(roots, { x: 0, y: 0, ...blocks.get('')! });
	return { boxes: out, lines, routes };
}

const modelOf = (model: Model, id: string) => model.fields.get(id)?.modelId ?? id;
/** The rows of a logic, triggers or channel card. */
export const cardRows = (b: LandscapeBox) => b.logic?.rows ?? b.triggers?.rows ?? b.channel?.rows;

/** Whether a card has a row for a field, logic unit, trigger or port. */
const shows = (b: LandscapeBox, id: string) =>
	!!(b.fields?.some((f) => f.id === id) || cardRows(b)?.some((r) => r.id === id));

/**
 * The card a link from box `from` ends on, for the model or field `to`: a sibling if there
 * is one; else, of the cards showing the field, the nearest. A logic unit has one card, its
 * module's logic card, and a trigger its triggers card; an api has none.
 */
export function linkTarget(
	model: Model,
	boxes: LandscapeBox[],
	from: LandscapeBox,
	to: string
): LandscapeBox | undefined {
	const kind = model.elements.get(to)?.def.kind;
	if (kind === 'logic-unit' || kind === 'trigger' || model.ports.has(to))
		return boxes.find((o) => shows(o, to));
	if (kind === 'channel') return boxes.find((o) => o.channel && o.elementId === to);
	const el = modelOf(model, to);
	const cards = boxes.filter((o) => o.view && o.elementId === el);
	const dist = (o: LandscapeBox) =>
		Math.hypot(
			o.absX + o.width / 2 - (from.absX + from.width / 2),
			o.absY + o.height / 2 - (from.absY + from.height / 2)
		);
	const score = (o: LandscapeBox) =>
		(o.parentId === from.parentId ? 0 : 2e9) +
		(model.fields.has(to) && !shows(o, to) ? 1e9 : 0) +
		dist(o);
	return cards.sort((a, b) => score(a) - score(b))[0];
}
