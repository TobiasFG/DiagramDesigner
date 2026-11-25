import type { Model } from '#lib/model/model.ts';
import { railGroups, railOf, type Rail } from './apis.ts';
import { cardRows, TABLE, type LandscapeBox } from './layout.ts';
import { apiHosts } from './open.ts';

/**
 * What the canvas draws, worked out from a layout: rails and line ends.
 */

/** The rail on each box that has one, by box id: its apis, and those of hidden boxes inside. */
export function railsOf(
	model: Model,
	boxes: LandscapeBox[],
	boxById: Map<string, LandscapeBox>,
	open: Set<string>
): Map<string, Rail> {
	const out = new Map<string, Rail>();
	for (const [id, apis] of apiHosts(boxes, open)) {
		const b = boxById.get(id)!;
		out.set(id, railOf(model, railGroups(model, b.elementId, apis), b.height));
	}
	return out;
}

/** The sides two ends leave and enter by: facing each other, or both right when stacked. */
export const sides = (a: { x0: number; x1: number }, b: { x0: number; x1: number }) =>
	b.x0 >= a.x1
		? (['r', 'l'] as const)
		: b.x1 <= a.x0
			? (['l', 'r'] as const)
			: (['r', 'r'] as const);

/** A box's name bar as a line end: a card's bar, or the middle of any other box. */
export const headEnd = (b: LandscapeBox) => ({
	node: b,
	anchor: 'head',
	x0: b.absX,
	x1: b.absX + b.width,
	y: b.absY + (b.view || cardRows(b) ? TABLE.head / 2 : b.height / 2)
});
