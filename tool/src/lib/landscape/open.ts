import type { LandscapeBox } from './layout.ts';

/**
 * Which group boxes are open, decided from where each sits on screen rather than from the
 * zoom alone (semantic zoom with level of detail, as map and 3D-tile renderers do).
 *
 * - size: the box's larger side as a share of the canvas side (1 = spans the canvas).
 * - seen: share of the box that is on screen.
 * - cover: share of the canvas the box covers.
 *
 * A box is open while it is large and enough of it is in view; the same values open and close
 * it. Deep inside a box (it covers the canvas but only a sliver of it is seen) it is open too.
 */
export const OPEN = { size: 0.2, seen: 0.2, cover: 0.3 };

export interface Camera {
	x: number;
	y: number;
	zoom: number;
	/** Canvas size in pixels. */
	width: number;
	height: number;
}

export function onScreen(b: LandscapeBox, cam: Camera) {
	const left = b.absX * cam.zoom + cam.x;
	const top = b.absY * cam.zoom + cam.y;
	const w = b.width * cam.zoom;
	const h = b.height * cam.zoom;
	const vis =
		Math.max(0, Math.min(left + w, cam.width) - Math.max(left, 0)) *
		Math.max(0, Math.min(top + h, cam.height) - Math.max(top, 0));
	return {
		size: Math.max(w / cam.width, h / cam.height),
		seen: vis / (w * h),
		cover: vis / (cam.width * cam.height)
	};
}

export function openBoxes(boxes: LandscapeBox[], cam: Camera): Set<string> {
	const byId = new Map(boxes.map((b) => [b.id, b]));
	const open = new Set<string>();
	for (const b of boxes) {
		if (!b.group) continue;
		const s = onScreen(b, cam);
		if (s.size < OPEN.size || (s.seen < OPEN.seen && s.cover < OPEN.cover)) continue;
		// A box can only be seen open inside open boxes.
		for (let p: LandscapeBox | undefined = b; p; p = p.parentId ? byId.get(p.parentId) : undefined)
			open.add(p.id);
	}
	return open;
}
