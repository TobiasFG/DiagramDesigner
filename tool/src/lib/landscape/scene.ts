import type { Model } from '#lib/model/model.ts';
import { railGroups, railOf, type Rail } from './apis.ts';
import type { RestLine } from './connections.ts';
import { cardRows, TABLE, type LandscapeBox } from './layout.ts';
import { apiHosts } from './open.ts';
import { keyedGroup, type KeyedGroup } from './route-client.ts';
import { ROUTE, type Rect, type RouteGroup } from './route.ts';

/**
 * What the canvas draws, worked out from a layout: rails, line ends and the groups lines at
 * rest are routed in.
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

/**
 * The lines at rest (Module Dependency Lines) as the router takes them, one group per module
 * holding them. A line at rest joins two child modules of one module (or two top-level modules)
 * and never leaves it, so each box routes its children's lines
 * with only its children, rails and all, in the way. Each end leaves by the side facing the
 * other box, so lines leaving a box one way share an exit and never set off the wrong way round
 * it. Lines are spaced as the layout left room for them (`pitch`, the top level's; see
 * route.ts `pitchOf`). Each group is kept by its own boxes and lines, so a change routes only
 * the groups it touched.
 */
export function restGroups(
	boxes: LandscapeBox[],
	boxById: Map<string, LandscapeBox>,
	rails: Map<string, Rail>,
	rest: RestLine[],
	pitch = ROUTE.spread
): KeyedGroup[] {
	const groups = new Map<string, RouteGroup>();
	const group = (parent: string | undefined) => {
		let g = groups.get(parent ?? '');
		if (g) return g;
		const kids = new Map<string, Rect>();
		for (const b of boxes)
			if (b.parentId === parent) {
				const r = rails.get(b.id);
				kids.set(b.id, {
					x0: b.absX,
					y0: b.absY,
					x1: b.absX + b.width + (r ? r.width / 2 : 0),
					y1: b.absY + b.height,
					clear: b.clear
				});
			}
		const spread = parent === undefined ? pitch : (boxById.get(parent)!.pitch ?? ROUTE.spread);
		g = { boxes: kids, lines: [], spread };
		groups.set(parent ?? '', g);
		return g;
	};
	for (const l of rest) {
		const [a, b] = [headEnd(boxById.get(l.source)!), headEnd(boxById.get(l.target)!)];
		const [sa, sb] = sides(a, b);
		group(l.parentId).lines.push({
			id: l.id,
			s: { on: l.source, x0: a.x0, x1: a.x1, y: a.y, sides: [sa] },
			t: { on: l.target, x0: b.x0, x1: b.x1, y: b.y, sides: [sb] }
		});
	}
	// Lines at rest leaving a box together share one exit (see the design's Routing rule).
	return [...groups].map(([parent, g]) => keyedGroup(g, true, parent));
}
