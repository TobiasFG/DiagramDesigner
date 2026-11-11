import type { Model } from '../model/model';
import type { Element, ModelField, ModelIndex } from '../model/schema';
import { textWidth } from '../render/text';

export interface LandscapeBox {
	/** Element id, or `<parent box id>>model id` for a reference to a model owned elsewhere. */
	id: string;
	/** The element drawn in the box. */
	elementId: string;
	ref: boolean;
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
	/** Field columns, for a model drawn as a table. */
	table?: TableColumn[];
}

interface Size {
	width: number;
	height: number;
}

interface Item {
	/** Box id. */
	id: string;
	/** Element drawn. */
	el: string;
	ref: boolean;
}

/** A box without children: its name at a fixed size, the box fitted round it. */
export const LEAF = { font: 15, padX: 18, height: 52, minWidth: 100 };
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

export type FieldColumn =
	'name' | 'type' | 'required' | 'nullable' | 'constraints' | 'ref' | 'from';

export interface TableColumn {
	key: FieldColumn;
	label: string;
	/** Hover text for a short label. */
	title?: string;
	width: number;
}

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

/** Where a field's value comes from: its source fields, then how it is derived. */
export const fromText = (f: ModelField, label: (id: string) => string | undefined) =>
	[(f.from ?? []).map((id) => label(id) ?? id).join(', '), f.derived].filter((s) => s).join(' · ');

/** An index's fields by name, in index order. */
export const indexFields = (ix: ModelIndex, fields: ModelField[]) =>
	ix.fields.map((id) => fields.find((f) => f.id === id)?.name ?? id).join(', ');

/** Line under a model's name: its kind, plus the owner for a reference. */
export const subtitle = (owner?: string) => (owner ? `Model · owned by ${owner}` : 'Model');

/** Vertical centre of field row `i`: below the border, the name bar and the header row. */
export const fieldRowY = (i: number) => 1 + TABLE.head + (i + 1.5) * TABLE.rowHeight;

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
	label: (id: string) => string | undefined
): TableColumn[] {
	const text = (s: string) => textWidth(s, TABLE.row);
	const defs: [FieldColumn, string, string | undefined, number[], boolean][] = [
		[
			'name',
			'Name',
			undefined,
			fields.map((f) => {
				const keys = keysOf(f);
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
		],
		[
			'ref',
			'References',
			undefined,
			fields.map((f) => text(f.ref ? (label(f.ref) ?? '') : '')),
			false
		],
		[
			'from',
			'Source',
			'Where the value comes from',
			fields.map((f) => text(fromText(f, label))),
			false
		]
	];
	return defs
		.filter(([, , , ws, always]) => always || ws.some((w) => w > 0))
		.map(([key, label, title, ws]) => ({
			key,
			label,
			title,
			width: Math.max(textWidth(label, TABLE.label, true), ...ws) + 2 * TABLE.pad
		}));
}

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
	owner: string | undefined,
	label: (id: string) => string | undefined
): { size: Size; cols: TableColumn[] } {
	const fields = def.fields ?? [];
	const indexes = def.indexes ?? [];
	const cols = fieldColumns(fields, label);
	// The 2px is the card's border, which sits inside the box.
	const width = Math.max(
		textWidth(name, TABLE.title, true) + 2 * TABLE.pad,
		textWidth(subtitle(owner), TABLE.note) + 2 * TABLE.pad,
		fields.length ? cols.reduce((w, c) => w + c.width, 0) : 0,
		...indexes.map((ix) => indexWidth(ix, fields))
	);
	const rows = (n: number) => (n ? n + 1 : 0);
	const height = TABLE.head + (rows(fields.length) + rows(indexes.length)) * TABLE.rowHeight;
	return { size: { width: Math.ceil(width) + 2, height: height + 2 }, cols };
}

const leafSize = (name: string): Size => ({
	width: Math.max(LEAF.minWidth, textWidth(name, LEAF.font, true) + 2 * LEAF.padX),
	height: LEAF.height
});

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
		const width = Math.max(...column.map((i) => sizes[i].width));
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
 */
export function layoutLandscape(model: Model): LandscapeBox[] {
	const out: LandscapeBox[] = [];
	const sizes = new Map<string, Size>();
	const tables = new Map<string, TableColumn[]>();
	// A reference is drawn as a closed box, so it never has boxes inside.
	const kidsOf = (item: Item): Item[] => {
		const info = model.elements.get(item.el);
		if (item.ref || !info) return [];
		return [
			...info.childIds.map((id) => ({ id, el: id, ref: false })),
			...info.refIds.map((id) => ({ id: `${item.id}>${id}`, el: id, ref: true }))
		];
	};
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
		} else if (info?.def.kind === 'model') {
			const owner = item.ref ? model.elements.get(info.parentId ?? '')?.name : undefined;
			const t = tableLayout(info.name, info.def, owner, (id) => refLabel(model, id));
			tables.set(item.id, t.cols);
			size = t.size;
		} else size = leafSize(info?.name ?? item.el);
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
				group: kids.length > 0,
				parentId: parent?.id,
				x: absX - (parent?.absX ?? 0),
				y: absY - (parent?.absY ?? 0),
				absX,
				absY,
				width: slot.width,
				height: slot.height,
				table: tables.get(item.id)
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
						width: slot.width - 2 * PAD,
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
 * A line from a field's row to another table: a foreign key (`ref`, arrow at the target) or
 * a held model (`model`, diamond at the holder, UML composition).
 */
export interface ModelLink {
	id: string;
	kind: 'ref' | 'model';
	source: string;
	target: string;
	/** `out:<field id>:l` or `:r`. */
	sourceHandle: string;
	/** `head:l` or `head:r` for a ref to a model; `in:<field id>:l` or `:r` for a field. */
	targetHandle: string;
	parentId?: string;
}

/**
 * Lines for field refs and held models whose target table sits in the same box, so they
 * never cross a boundary; others show only as text in the row. The ends face each other, and tables
 * stacked in one column (or a table referring to itself) are joined round the right side.
 */
export function modelLinks(model: Model, boxes: LandscapeBox[]): ModelLink[] {
	const out: ModelLink[] = [];
	for (const b of boxes) {
		if (!b.table) continue;
		for (const f of model.elements.get(b.elementId)?.def.fields ?? []) {
			const to = f.ref ?? f.model;
			if (!to) continue;
			const field = model.fields.get(to);
			const el = field?.modelId ?? to;
			const t = boxes.find((o) => o.table && o.parentId === b.parentId && o.elementId === el);
			if (!t) continue;
			const [from, side] =
				t.absX >= b.absX + b.width ? 'rl' : t.absX + t.width <= b.absX ? 'lr' : 'rr';
			out.push({
				id: `${b.id}.${f.id}`,
				kind: f.ref ? 'ref' : 'model',
				source: b.id,
				target: t.id,
				sourceHandle: `out:${f.id}:${from}`,
				targetHandle: field ? `in:${field.def.id}:${side}` : `head:${side}`,
				parentId: b.parentId
			});
		}
	}
	return out;
}
