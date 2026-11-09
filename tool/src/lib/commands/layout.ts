import type { Point } from '../layout/types';
import { layoutFileFor } from '../model/model';
import { knownLayoutIds } from '../projections';
import { layoutDraft, snap, type Command } from './core';

export interface NodeMove {
	id: string;
	/** Position relative to the parent node. */
	x: number;
	y: number;
}

/** Drag / multi-select move / align: pins the nodes at their new positions. */
export function moveNodes(viewId: string, moves: NodeMove[], label = 'Move'): Command {
	return {
		label: moves.length > 1 ? `${label} ${moves.length} nodes` : `${label} ${moves[0]?.id}`,
		run(draft, ctx) {
			const layout = layoutDraft(draft, ctx, viewId, knownLayoutIds(ctx.model, viewId));
			for (const m of moves) {
				const entry = (layout.nodes![m.id] ??= {});
				entry.x = snap(m.x, ctx.config.snapGrid);
				entry.y = snap(m.y, ctx.config.snapGrid);
				entry.pinned = true;
			}
		}
	};
}

export function resizeNode(
	viewId: string,
	id: string,
	box: { x: number; y: number; width: number; height: number }
): Command {
	return {
		label: `Resize ${id}`,
		run(draft, ctx) {
			const layout = layoutDraft(draft, ctx, viewId, knownLayoutIds(ctx.model, viewId));
			const entry = (layout.nodes![id] ??= {});
			entry.x = snap(box.x, ctx.config.snapGrid);
			entry.y = snap(box.y, ctx.config.snapGrid);
			entry.w = snap(box.width, ctx.config.snapGrid);
			entry.h = snap(box.height, ctx.config.snapGrid);
			entry.pinned = true;
		}
	};
}

export function unpinNode(viewId: string, id: string): Command {
	return {
		label: `Unpin ${id}`,
		run(draft, ctx) {
			const layout = layoutDraft(draft, ctx, viewId, knownLayoutIds(ctx.model, viewId));
			const entry = layout.nodes![id];
			if (!entry) return;
			if (entry.collapsed) layout.nodes![id] = { collapsed: true };
			else delete layout.nodes![id];
		}
	};
}

export function setCollapsed(viewId: string, id: string, collapsed: boolean): Command {
	return {
		label: `${collapsed ? 'Collapse' : 'Expand'} ${id}`,
		run(draft, ctx) {
			const layout = layoutDraft(draft, ctx, viewId, knownLayoutIds(ctx.model, viewId));
			const entry = (layout.nodes![id] ??= {});
			if (collapsed) entry.collapsed = true;
			else delete entry.collapsed;
			// A collapsed group changes size, so its stored size no longer applies.
			delete entry.w;
			delete entry.h;
			if (!Object.keys(entry).length) delete layout.nodes![id];
		}
	};
}

export function resetLayout(viewId: string): Command {
	return {
		label: `Reset layout of ${viewId}`,
		run(draft) {
			delete draft[layoutFileFor(viewId)];
		}
	};
}

export function setEdgePoints(
	viewId: string,
	edgeKey: string,
	points: Point[] | undefined
): Command {
	return {
		label: points ? `Bend ${edgeKey}` : `Straighten ${edgeKey}`,
		run(draft, ctx) {
			const layout = layoutDraft(draft, ctx, viewId, knownLayoutIds(ctx.model, viewId));
			const entry = (layout.edges![edgeKey] ??= {});
			if (points?.length) entry.points = points.map(([x, y]) => [Math.round(x), Math.round(y)]);
			else delete entry.points;
			if (!Object.keys(entry).length) delete layout.edges![edgeKey];
		}
	};
}

export function setColumnWidth(
	viewId: string,
	participant: string,
	width: number | undefined
): Command {
	return {
		label: `Resize column ${participant}`,
		run(draft, ctx) {
			const layout = layoutDraft(draft, ctx, viewId, knownLayoutIds(ctx.model, viewId));
			layout.columns ??= {};
			if (width === undefined) delete layout.columns[participant];
			else layout.columns[participant] = Math.max(80, Math.round(width));
			if (!Object.keys(layout.columns).length) delete layout.columns;
		}
	};
}

export type Alignment = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export interface AlignBox {
	id: string;
	/** Absolute position and size. */
	absX: number;
	absY: number;
	width: number;
	height: number;
	/** Absolute position of the parent, to convert back to relative coordinates. */
	parentX: number;
	parentY: number;
}

export function alignMoves(boxes: AlignBox[], how: Alignment): NodeMove[] {
	const minX = Math.min(...boxes.map((b) => b.absX));
	const maxX = Math.max(...boxes.map((b) => b.absX + b.width));
	const minY = Math.min(...boxes.map((b) => b.absY));
	const maxY = Math.max(...boxes.map((b) => b.absY + b.height));
	return boxes.map((b) => {
		let x = b.absX;
		let y = b.absY;
		if (how === 'left') x = minX;
		if (how === 'right') x = maxX - b.width;
		if (how === 'center') x = (minX + maxX) / 2 - b.width / 2;
		if (how === 'top') y = minY;
		if (how === 'bottom') y = maxY - b.height;
		if (how === 'middle') y = (minY + maxY) / 2 - b.height / 2;
		return { id: b.id, x: x - b.parentX, y: y - b.parentY };
	});
}

/** Equal gaps between the boxes along one axis, keeping the outermost two in place. */
export function distributeMoves(boxes: AlignBox[], axis: 'horizontal' | 'vertical'): NodeMove[] {
	const h = axis === 'horizontal';
	const sorted = [...boxes].sort((a, b) => (h ? a.absX - b.absX : a.absY - b.absY));
	const start = h ? sorted[0].absX : sorted[0].absY;
	const last = sorted[sorted.length - 1];
	const end = h ? last.absX + last.width : last.absY + last.height;
	const total = sorted.reduce((s, b) => s + (h ? b.width : b.height), 0);
	const gap = (end - start - total) / Math.max(1, sorted.length - 1);
	let cursor = start;
	return sorted.map((b) => {
		const pos = cursor;
		cursor += (h ? b.width : b.height) + gap;
		return h
			? { id: b.id, x: pos - b.parentX, y: b.absY - b.parentY }
			: { id: b.id, x: b.absX - b.parentX, y: pos - b.parentY };
	});
}
