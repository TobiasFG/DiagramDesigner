import type { Model } from '../model/model';
import type { Element, ModelField, ModelIndex } from '../model/schema';
import { textWidth } from '../render/text';
import { railGroups, railOf } from './apis';

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
	/** Relative to the parent box (Svelte Flow convention). */
	x: number;
	y: number;
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
	/** Apis of the element, drawn on a rail across its right border (see `apiHosts`). */
	apis?: string[];
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
}

/** A box without children: its name at a fixed size, the box fitted round it. */
export const LEAF = { font: 15, padX: 18, height: 52, minWidth: 100 };
/** A closed group's name scales with the box, so a system reads the same at any size. */
export const groupFont = (width: number, height: number) => Math.min(width * 0.085, height * 0.2);
const GAP = 32;
const SYSTEM_GAP = 120;
const PAD = 32;
/** Room above the children for the open box's header. */
const HEADER = 48;

/** Model tables: font sizes and spacing in px, shared with LandscapeNode. */
export const TABLE = {
	title: 14,
	note: 11,
	/** Column labels in a table's header row. */
	label: 11,
	row: 13,
	badge: 11,
	rowHeight: 26,
	/** Name bar above the tables. */
	head: 48,
	/** Side padding in every cell. */
	pad: 10,
	/** Space between two badges, or a name and its badges, in a cell. */
	badgeGap: 4,
	/** Mark in the required and nullable columns. */
	check: '✓'
};

export type FieldColumn = 'name' | 'type' | 'required' | 'nullable' | 'constraints' | 'links';

/**
 * Marks in a row's link strip: a foreign key (`ref`), lineage (`from`), and how many fields
 * refer to (`inRef`) or derive from (`inFrom`) this one, and how many api fields send into or
 * return it (`inApi`). Each kind has its own slot, so marks
 * line up down the card.
 */
export type LinkSlot = 'ref' | 'from' | 'inRef' | 'inFrom' | 'inApi';

/** Link strip sizes in px, shared with LandscapeNode. */
export const LINK = { icon: 14, slot: 20, count: 10 };

export interface TableColumn {
	key: FieldColumn;
	label: string;
	/** Hover text for a short label. */
	title?: string;
	width: number;
	/** The link strip's slots, in order. */
	slots?: LinkSlot[];
}

/** One edge of the field graph: field `field` refers to, derives from, or holds `to`. */
export interface FieldLink {
	kind: 'ref' | 'from' | 'model';
	/** The field the link is written on. */
	field: string;
	/** A field id, or a model id for `ref` to a model and `model`. */
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

/** A field's type: its primitive or the held model's name, with `[]` for a list. */
export const typeText = (f: ModelField, label: (id: string) => string | undefined) =>
	(f.model ? (label(f.model) ?? f.model) : (f.type ?? '')) + (f.many ? '[]' : '');

/** An index's fields by name, in index order. */
export const indexFields = (ix: ModelIndex, fields: ModelField[]) =>
	ix.fields.map((id) => fields.find((f) => f.id === id)?.name ?? id).join(', ');

/** Line under a model's name: its view, plus the owner when it is owned elsewhere. */
export const subtitle = (view: ModelView, owner?: string) =>
	(view === 'table' ? 'Stored' : 'Model') + (owner ? ` · owned by ${owner}` : '');

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

/** Whether a card of `count` fields is folded: its later rows hide behind a toggle row. */
export const foldable = (count: number) => count > FOLD;

/** How many field rows a card of `count` fields shows. */
export const shownRows = (count: number, expanded: boolean) =>
	foldable(count) && !expanded ? FOLD : count;

/**
 * Vertical centre of field row `i` of `count`: below the border, the name bar and the header
 * row. A row hidden in a folded card sits on the toggle row, so its lines end there.
 */
export const fieldRowY = (i: number, count: number, expanded: boolean) =>
	1 + TABLE.head + (Math.min(i, shownRows(count, expanded)) + 1.5) * TABLE.rowHeight;

/** Badges have 6px side padding (see LandscapeNode). */
const badgesWidth = (labels: string[]) =>
	labels.reduce(
		(w, k, i) => w + textWidth(k, TABLE.badge, true) + 12 + (i ? TABLE.badgeGap : 0),
		0
	);

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
			fields.map((f) => badgesWidth(f.constraints ?? [])),
			false
		]
	];
	const cols: TableColumn[] = defs
		.filter(([, , , ws, always]) => always || ws.some((w) => w > 0))
		.map(([key, label, title, ws]) => ({
			key,
			label,
			title,
			width: Math.max(textWidth(label, TABLE.label, true), ...ws) + 2 * TABLE.pad
		}));
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
	rels: Relations
): { size: Size; cols: TableColumn[] } {
	const indexes = view === 'table' ? (def.indexes ?? []) : [];
	const cols = fieldColumns(fields, view, label, rels);
	// The 2px is the card's border, which sits inside the box.
	const width = Math.max(
		textWidth(name, TABLE.title, true) + 2 * TABLE.pad,
		textWidth(subtitle(view, owner), TABLE.note) + 2 * TABLE.pad,
		fields.length ? cols.reduce((w, c) => w + c.width, 0) : 0,
		...indexes.map((ix) => indexWidth(ix, fields))
	);
	const rows = (n: number) => (n ? n + 1 : 0);
	// Laid out folded: an expanded card draws over what is below it rather than moving it.
	const fieldRows = rows(shownRows(fields.length, false)) + (foldable(fields.length) ? 1 : 0);
	const height = TABLE.head + (fieldRows + rows(indexes.length)) * TABLE.rowHeight;
	return { size: { width: Math.ceil(width) + 2, height: height + 2 }, cols };
}

const leafWidth = (name: string) =>
	Math.max(LEAF.minWidth, textWidth(name, LEAF.font, true) + 2 * LEAF.padX);

/** Where a box goes within a block of siblings, relative to the block. */
interface Slot {
	x: number;
	y: number;
	width: number;
	height: number;
}

interface Block extends Size {
	slots: Slot[];
}

/**
 * Masonry: each box goes to the shortest column, in order, and keeps its own size. A column
 * is as wide as its widest box; boxes are left-aligned in it.
 */
function masonry(sizes: Size[], cols: number, gap: number): Block {
	const columns: number[][] = Array.from({ length: cols }, () => []);
	const heights: number[] = Array(cols).fill(-gap);
	sizes.forEach((s, i) => {
		const c = heights.indexOf(Math.min(...heights));
		columns[c].push(i);
		heights[c] += gap + s.height;
	});
	const slots: Slot[] = [];
	let x = 0;
	for (const column of columns) {
		const width = Math.max(...column.map((i) => sizes[i].width + (sizes[i].right ?? 0)));
		let y = 0;
		for (const i of column) {
			slots[i] = { x, y, ...sizes[i] };
			y += sizes[i].height + gap;
		}
		x += width + gap;
	}
	return { width: x - gap, height: Math.max(...heights), slots };
}

/**
 * Lays out the whole element tree: top-level elements in one row (file order, so upstream
 * systems come first), children in a near-square masonry. Every box is fitted to its content.
 * Parents precede their children in the result, as Svelte Flow requires.
 *
 * A model is a class card in its owner, inside a boundary with the models only it holds, and
 * a table card in the entity storing it. A model stored where it is owned is one table card.
 */
export function layoutLandscape(model: Model): LandscapeBox[] {
	const out: LandscapeBox[] = [];
	const sizes = new Map<string, Size>();
	const cards = new Map<string, { cols: TableColumn[]; fields: ModelField[] }>();
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
		if (item.ref || item.view || !info) return [];
		if (item.boundary)
			return model.elements
				.get(info.parentId!)!
				.childIds.filter((id) => id === item.el || (parts.has(id) && rootOf(id) === item.el))
				.map(card);
		return [
			...info.childIds.filter((id) => !parts.has(id) && !isApi(id)).map(owned),
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
	const apisOf = (item: Item) =>
		item.ref || item.view || item.boundary
			? []
			: (model.elements.get(item.el)?.childIds.filter(isApi) ?? []);
	// Every api inside an element, which all move to its rail while it is closed.
	const deepApis = (id: string): string[] =>
		model.elements.get(id)!.childIds.flatMap((c) => (isApi(c) ? [c] : deepApis(c)));
	const railWidth = (el: string, apis: string[], height: number) =>
		apis.length ? railOf(model, railGroups(model, el, apis), height).width : 0;
	/** Half of the own rail, which sits inside the box, so children keep clear of it. */
	const inner = new Map<string, number>();
	const colsFor = (n: number) => Math.ceil(Math.sqrt(n));
	const arrange = (items: Item[], cols: number, gap: number) =>
		masonry(items.map(measure), cols, gap);

	function measure(item: Item): Size {
		let size = sizes.get(item.id);
		if (size) return size;
		const kids = kidsOf(item);
		const info = model.elements.get(item.el);
		if (kids.length) {
			const b = arrange(kids, colsFor(kids.length), GAP);
			size = { width: b.width + 2 * PAD, height: b.height + HEADER + PAD };
		} else if (info && item.view) {
			const owner = item.ref ? model.elements.get(info.parentId ?? '')?.name : undefined;
			const fields = viewFields(model, holders, info.id, item.view);
			const t = tableLayout(
				info.name,
				info.def,
				fields,
				item.view,
				owner,
				(id) => refLabel(model, id),
				rels
			);
			cards.set(item.id, { cols: t.cols, fields });
			size = t.size;
		} else size = { width: leafWidth(info?.name ?? item.el), height: LEAF.height };
		const own = railWidth(item.el, apisOf(item), size.height) / 2;
		if (own) {
			inner.set(item.id, own);
			size.width += own;
		}
		// Closed, the box carries the apis of everything inside it too.
		const deep = item.ref || item.view || item.boundary ? [] : deepApis(item.el);
		const right = Math.max(own, railWidth(item.el, deep, size.height) / 2);
		if (right) size.right = right;
		sizes.set(item.id, size);
		return size;
	}

	function place(
		items: Item[],
		cols: number,
		gap: number,
		area: Size & { x: number; y: number },
		parent?: LandscapeBox
	) {
		const block = arrange(items, cols, gap);
		const x0 = area.x + (area.width - block.width) / 2;
		const y0 = area.y + (area.height - block.height) / 2;
		items.forEach((item, i) => {
			const slot = block.slots[i];
			const absX = x0 + slot.x;
			const absY = y0 + slot.y;
			const kids = kidsOf(item);
			const box: LandscapeBox = {
				id: item.id,
				elementId: item.el,
				ref: item.ref,
				boundary: item.boundary ?? false,
				group: kids.length > 0,
				parentId: parent?.id,
				x: absX - (parent?.absX ?? 0),
				y: absY - (parent?.absY ?? 0),
				absX,
				absY,
				width: slot.width,
				height: slot.height,
				table: cards.get(item.id)?.cols,
				view: item.view,
				fields: cards.get(item.id)?.fields,
				apis: apisOf(item)
			};
			out.push(box);
			if (kids.length)
				place(
					kids,
					colsFor(kids.length),
					GAP,
					{
						x: absX + PAD,
						y: absY + HEADER,
						width: slot.width - 2 * PAD - (inner.get(item.id) ?? 0),
						height: slot.height - HEADER - PAD
					},
					box
				);
		});
	}

	const roots = model.rootElementIds.map((id) => ({ id, el: id, ref: false }));
	if (roots.length) {
		const b = arrange(roots, roots.length, SYSTEM_GAP);
		place(roots, roots.length, SYSTEM_GAP, { x: 0, y: 0, ...b });
	}
	return out;
}

/**
 * A line from a field's row to another table: a foreign key (`ref`, arrow at the target), a
 * held model (`model`, diamond at the holder, UML composition) or lineage (`from`, dashed,
 * arrow at the derived field).
 */
export interface ModelLink {
	id: string;
	kind: FieldLink['kind'];
	source: string;
	target: string;
	/** `out:<field id>:l` or `:r`. */
	sourceHandle: string;
	/** `head:l` or `head:r` for a model, or a field its card does not show; else `in:<field id>:l` or `:r`. */
	targetHandle: string;
	/** The field the link is written on. */
	sourceField: string;
	/** The field pointed at, when its card shows it. */
	targetField?: string;
	parentId?: string;
}

const modelOf = (model: Model, id: string) => model.fields.get(id)?.modelId ?? id;
const shows = (b: LandscapeBox, fieldId: string) => b.fields?.some((f) => f.id === fieldId);

/**
 * The card a link from box `from` ends on, for the model or field `to`: a sibling if there
 * is one; else, of the cards showing the field, the nearest.
 */
export function linkTarget(
	model: Model,
	boxes: LandscapeBox[],
	from: LandscapeBox,
	to: string
): LandscapeBox | undefined {
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

/** A line from field `link.field` in card `b` to card `t`, the ends facing each other. */
function line(model: Model, b: LandscapeBox, t: LandscapeBox, link: FieldLink): ModelLink {
	const [from, side] = t.absX >= b.absX + b.width ? 'rl' : t.absX + t.width <= b.absX ? 'lr' : 'rr';
	const shown = model.fields.has(link.to) && shows(t, link.to);
	return {
		id: `${b.id}.${link.field}` + (link.kind === 'from' ? `.${link.to}` : ''),
		kind: link.kind,
		source: b.id,
		target: t.id,
		sourceHandle: `out:${link.field}:${from}`,
		targetHandle: shown ? `in:${link.to}:${side}` : `head:${side}`,
		sourceField: link.field,
		targetField: shown ? link.to : undefined,
		parentId: b.parentId
	};
}

/** A field's links, in field order: `ref` or `model`, then each `from`. */
const fieldLinks = (f: ModelField): FieldLink[] => [
	...(f.ref || f.model
		? [
				{
					kind: f.ref ? ('ref' as const) : ('model' as const),
					field: f.id,
					to: (f.ref ?? f.model)!
				}
			]
		: []),
	...(f.from ?? []).map((to) => ({ kind: 'from' as const, field: f.id, to }))
];

/**
 * Lines for links whose target card sits in the same box, so they never cross a boundary;
 * others show on hover (see `focusLinks`). Cards stacked in one column (or a card referring to
 * itself) are joined round the right side. Lineage inside one card is not drawn.
 */
export function modelLinks(model: Model, boxes: LandscapeBox[]): ModelLink[] {
	const out: ModelLink[] = [];
	for (const b of boxes)
		for (const f of b.fields ?? [])
			for (const link of fieldLinks(f)) {
				const el = modelOf(model, link.to);
				const t = boxes.find((o) => o.view && o.parentId === b.parentId && o.elementId === el);
				if (!t || (link.kind === 'from' && t === b)) continue;
				out.push(line(model, b, t, link));
			}
	return out;
}

/**
 * Every line for one field in one card, wherever the other end is: its own links, and the
 * fields linking to it. The other end is the nearest card showing it (see `linkTarget`).
 * Lineage inside one card is left out.
 */
export function focusLinks(
	model: Model,
	rels: Relations,
	boxes: LandscapeBox[],
	boxId: string,
	fieldId: string
): ModelLink[] {
	const b = boxes.find((o) => o.id === boxId);
	if (!b) return [];
	const out: ModelLink[] = [];
	for (const link of rels.out.get(fieldId) ?? []) {
		const t = linkTarget(model, boxes, b, link.to);
		if (t && !(link.kind === 'from' && t === b)) out.push(line(model, b, t, link));
	}
	for (const link of rels.in.get(fieldId) ?? []) {
		const s = linkTarget(model, boxes, b, link.field);
		if (s && shows(s, link.field) && !(link.kind === 'from' && s === b))
			out.push(line(model, s, b, link));
	}
	return out;
}
