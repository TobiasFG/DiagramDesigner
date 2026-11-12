import { RAIL, type Rail } from './apis.ts';
import { groupFont, LEAF, TABLE, type LandscapeBox } from './layout.ts';

/**
 * Which group boxes are open, decided by whether what is inside them could be read: a box is
 * open while any of it is on screen and the smallest text of its children (a model's rows, a
 * module's name) would be drawn at READABLE px or more. Below that its children are only
 * noise, so it closes to its name. The same size opens and closes it.
 */
export const READABLE = 12;

export interface Camera {
	x: number;
	y: number;
	zoom: number;
	/** Canvas size in pixels. */
	width: number;
	height: number;
}

/** Font size of the text a box shows, in canvas px (on screen it is scaled by the zoom). */
export const faceFont = (b: LandscapeBox) =>
	b.table ? TABLE.row : b.group ? groupFont(b.width, b.height) : LEAF.font;

export function inView(b: LandscapeBox, cam: Camera) {
	const left = b.absX * cam.zoom + cam.x;
	const top = b.absY * cam.zoom + cam.y;
	return (
		left < cam.width &&
		top < cam.height &&
		left + b.width * cam.zoom > 0 &&
		top + b.height * cam.zoom > 0
	);
}

export function openBoxes(boxes: LandscapeBox[], cam: Camera): Set<string> {
	const byId = new Map(boxes.map((b) => [b.id, b]));
	// Smallest text among each box's children, in canvas px.
	const inner = new Map<string, number>();
	for (const b of boxes)
		if (b.parentId) inner.set(b.parentId, Math.min(inner.get(b.parentId) ?? Infinity, faceFont(b)));
	const open = new Set<string>();
	for (const b of boxes) {
		if (!b.group || (inner.get(b.id) ?? 0) * cam.zoom < READABLE || !inView(b, cam)) continue;
		// A box can only be seen open inside open boxes.
		for (let p: LandscapeBox | undefined = b; p; p = p.parentId ? byId.get(p.parentId) : undefined)
			open.add(p.id);
	}
	return open;
}

/**
 * Which box each api is drawn on, by box id: its parent's box when that is shown, else the
 * nearest shown box round it, so the api of a module inside a closed system sits on the
 * system. Host boxes come first in each list, then the boxes inside them, in layout order.
 */
export function apiHosts(boxes: LandscapeBox[], open: Set<string>): Map<string, string[]> {
	const byId = new Map(boxes.map((b) => [b.id, b]));
	const out = new Map<string, string[]>();
	for (const b of boxes) {
		if (!b.apis?.length) continue;
		let host = b;
		while (host.parentId && !open.has(host.parentId)) host = byId.get(host.parentId)!;
		out.set(host.id, [...(out.get(host.id) ?? []), ...b.apis]);
	}
	return out;
}

/** A rail lists its endpoints once its rows would read at READABLE px; until then it shows its name. */
export const railOpen = (rail: Rail, zoom: number) => RAIL.font * rail.scale * zoom >= READABLE;
