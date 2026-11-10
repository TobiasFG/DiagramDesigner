import type { Model } from '../model/model';

export interface LandscapeBox {
	id: string;
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

const LEAF: Size = { width: 220, height: 130 };
const GAP = 32;
const SYSTEM_GAP = 120;
const PAD = 32;
/** Room above the children for the open box's header. */
const HEADER = 48;

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
	const kidsOf = (id: string) => model.elements.get(id)?.childIds ?? [];
	const colsFor = (n: number) => Math.ceil(Math.sqrt(n));

	const grid = (ids: string[], cols: number, gap: number) => {
		const cell = {
			width: Math.max(...ids.map((id) => measure(id).width)),
			height: Math.max(...ids.map((id) => measure(id).height))
		};
		const rows = Math.ceil(ids.length / cols);
		return {
			cell,
			width: cols * cell.width + (cols - 1) * gap,
			height: rows * cell.height + (rows - 1) * gap
		};
	};

	function measure(id: string): Size {
		let size = sizes.get(id);
		if (size) return size;
		const kids = kidsOf(id);
		if (!kids.length) size = LEAF;
		else {
			const g = grid(kids, colsFor(kids.length), GAP);
			size = { width: g.width + 2 * PAD, height: g.height + HEADER + PAD };
		}
		sizes.set(id, size);
		return size;
	}

	function place(
		ids: string[],
		cols: number,
		gap: number,
		area: Size & { x: number; y: number },
		parent?: LandscapeBox
	) {
		const g = grid(ids, cols, gap);
		const x0 = area.x + (area.width - g.width) / 2;
		const y0 = area.y + (area.height - g.height) / 2;
		const lastRow = ids.length - (ids.length % cols || cols);
		ids.forEach((id, i) => {
			// An incomplete last row is centred under the full rows.
			const shift = i >= lastRow ? ((cols - (ids.length - lastRow)) * (g.cell.width + gap)) / 2 : 0;
			const absX = x0 + shift + (i % cols) * (g.cell.width + gap);
			const absY = y0 + Math.floor(i / cols) * (g.cell.height + gap);
			const box: LandscapeBox = {
				id,
				parentId: parent?.id,
				x: absX - (parent?.absX ?? 0),
				y: absY - (parent?.absY ?? 0),
				absX,
				absY,
				...g.cell
			};
			out.push(box);
			const kids = kidsOf(id);
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

	const roots = model.rootElementIds;
	if (roots.length) {
		const g = grid(roots, roots.length, SYSTEM_GAP);
		place(roots, roots.length, SYSTEM_GAP, { x: 0, y: 0, ...g });
	}
	return out;
}
