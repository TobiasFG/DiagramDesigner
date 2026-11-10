import type { Model } from '../model/model';
import type { Element } from '../model/schema';
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

const LEAF: Size = { width: 220, height: 130 };
const GAP = 32;
const SYSTEM_GAP = 120;
const PAD = 32;
/** Room above the children for the open box's header. */
const HEADER = 48;

/** Model tables: font sizes, row height and padding, shared with LandscapeNode. */
export const TABLE = { title: 15, note: 11, row: 13, rowHeight: 20, head: 46, pad: 10, gap: 8 };

/** Text of a field row, without the key column. */
export const fieldText = (f: NonNullable<Element['fields']>[number]) =>
	`${f.name}: ${f.type}${f.required || f.pk ? '' : ' [0..1]'}`;

export const indexText = (ix: NonNullable<Element['indexes']>[number]) =>
	`${ix.unique ? 'UX' : 'IX'} ${ix.name} (${ix.fields.join(', ')})`;

/** Width of the PK/PI key column. */
export const KEY_COL = 44;

/** Line above a model's name: its stereotype, plus the owner for a reference. */
export const stereotype = (owner?: string) => (owner ? `«model» owned by ${owner}` : '«model»');

function tableSize(name: string, def: Element, owner?: string): Size {
	const fields = def.fields ?? [];
	const indexes = def.indexes ?? [];
	const width = Math.max(
		LEAF.width,
		textWidth(name, TABLE.title, true) + 2 * TABLE.pad,
		textWidth(stereotype(owner), TABLE.note) + 2 * TABLE.pad,
		...fields.map(
			(f) => KEY_COL + textWidth(fieldText(f), TABLE.row, f.required || f.pk) + 2 * TABLE.pad
		),
		...indexes.map((ix) => textWidth(indexText(ix), TABLE.row) + 2 * TABLE.pad)
	);
	const sections = (fields.length ? 1 : 0) + (indexes.length ? 1 : 0);
	const height =
		TABLE.head + (fields.length + indexes.length) * TABLE.rowHeight + sections * (TABLE.gap + 1);
	return { width: Math.ceil(width), height: Math.max(LEAF.height, height) };
}

/**
 * Lays out the whole element tree: top-level elements in one row (file order, so upstream
 * systems come first), children in a near-square grid. Siblings share one cell size so boxes
 * on a level line up; a grid smaller than its box is centred in it, and so is an incomplete
 * last row. Parents precede their
 * children in the result, as Svelte Flow requires.
 */
export function layoutLandscape(model: Model): LandscapeBox[] {
	const out: LandscapeBox[] = [];
	const sizes = new Map<string, Size>();
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

	const grid = (items: Item[], cols: number, gap: number) => {
		const cell = {
			width: Math.max(...items.map((it) => measure(it).width)),
			height: Math.max(...items.map((it) => measure(it).height))
		};
		const rows = Math.ceil(items.length / cols);
		return {
			cell,
			width: cols * cell.width + (cols - 1) * gap,
			height: rows * cell.height + (rows - 1) * gap
		};
	};

	function measure(item: Item): Size {
		let size = sizes.get(item.id);
		if (size) return size;
		const kids = kidsOf(item);
		const info = model.elements.get(item.el);
		if (kids.length) {
			const g = grid(kids, colsFor(kids.length), GAP);
			size = { width: g.width + 2 * PAD, height: g.height + HEADER + PAD };
		} else if (info?.def.kind === 'model') {
			const owner = item.ref ? model.elements.get(info.parentId ?? '')?.name : undefined;
			size = tableSize(info.name, info.def, owner);
		} else size = LEAF;
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
		const g = grid(items, cols, gap);
		const x0 = area.x + (area.width - g.width) / 2;
		const y0 = area.y + (area.height - g.height) / 2;
		const lastRow = items.length - (items.length % cols || cols);
		items.forEach((item, i) => {
			// An incomplete last row is centred under the full rows.
			const shift =
				i >= lastRow ? ((cols - (items.length - lastRow)) * (g.cell.width + gap)) / 2 : 0;
			const absX = x0 + shift + (i % cols) * (g.cell.width + gap);
			const absY = y0 + Math.floor(i / cols) * (g.cell.height + gap);
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
				...g.cell
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
						width: g.cell.width - 2 * PAD,
						height: g.cell.height - HEADER - PAD
					},
					box
				);
		});
	}

	const roots = model.rootElementIds.map((id) => ({ id, el: id, ref: false }));
	if (roots.length) {
		const g = grid(roots, roots.length, SYSTEM_GAP);
		place(roots, roots.length, SYSTEM_GAP, { x: 0, y: 0, ...g });
	}
	return out;
}
