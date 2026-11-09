import type { Box, Point } from '../layout/types';
import type { RenderEdge } from '../projections/types';
import type { TokenResolver } from '../theme/tokens';
import { EDGE_LABEL, edgeLabelSize, markerId, svgText } from './shapes';
import { el, pathD, type SvgNode } from './svg';
import { textWidth } from './text';

export type Outline = 'rect' | 'diamond' | 'ellipse';

export interface EdgeEnd extends Box {
	outline?: Outline;
}

export interface EdgeGeometryInput {
	source: EdgeEnd;
	target: EdgeEnd;
	route?: Point[];
	routeBoxes?: { source: Box; target: Box };
	points?: Point[];
	labelPos?: number;
	parallel?: { index: number; count: number };
}

export interface EdgeGeometry {
	d: string;
	/** Polyline approximating the path (for hit testing and label placement). */
	points: Point[];
	label: Point;
	startLabel: Point;
	endLabel: Point;
	/** Where to place a draggable handle for adding a bend point. */
	mid: Point;
}

const center = (b: Box): Point => [b.x + b.width / 2, b.y + b.height / 2];
const same = (a: Box, b: Box) =>
	Math.round(a.x) === Math.round(b.x) &&
	Math.round(a.y) === Math.round(b.y) &&
	Math.round(a.width) === Math.round(b.width) &&
	Math.round(a.height) === Math.round(b.height);

/** Point where the ray from the box centre towards `toward` leaves the outline. */
export function clip(box: EdgeEnd, toward: Point): Point {
	const [cx, cy] = center(box);
	const dx = toward[0] - cx;
	const dy = toward[1] - cy;
	if (dx === 0 && dy === 0) return [cx, cy];
	const hw = box.width / 2;
	const hh = box.height / 2;
	let t: number;
	if (box.outline === 'diamond') t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
	else if (box.outline === 'ellipse') t = 1 / Math.sqrt((dx / hw) ** 2 + (dy / hh) ** 2);
	else t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
	return [cx + dx * t, cy + dy * t];
}

function length(points: Point[]): number {
	let l = 0;
	for (let i = 1; i < points.length; i++)
		l += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
	return l;
}

export function pointAlong(points: Point[], fraction: number): Point {
	const total = length(points);
	let remaining = total * fraction;
	for (let i = 1; i < points.length; i++) {
		const [x1, y1] = points[i - 1];
		const [x2, y2] = points[i];
		const seg = Math.hypot(x2 - x1, y2 - y1);
		if (remaining <= seg && seg > 0) {
			const f = remaining / seg;
			return [x1 + (x2 - x1) * f, y1 + (y2 - y1) * f];
		}
		remaining -= seg;
	}
	return points[points.length - 1];
}

/** Polyline path with small rounded corners. */
function roundedPath(points: Point[], radius = 6): string {
	if (points.length < 3)
		return pathD('M', ...points[0], ...points.slice(1).flatMap((p) => ['L', ...p]));
	const parts: (string | number)[] = ['M', ...points[0]];
	for (let i = 1; i < points.length - 1; i++) {
		const [px, py] = points[i - 1];
		const [x, y] = points[i];
		const [nx, ny] = points[i + 1];
		const l1 = Math.hypot(x - px, y - py);
		const l2 = Math.hypot(nx - x, ny - y);
		const r = Math.min(radius, l1 / 2, l2 / 2);
		if (r < 1) {
			parts.push('L', x, y);
			continue;
		}
		parts.push('L', x - ((x - px) / l1) * r, y - ((y - py) / l1) * r);
		parts.push('Q', x, y, x + ((nx - x) / l2) * r, y + ((ny - y) / l2) * r);
	}
	parts.push('L', ...points[points.length - 1]);
	return pathD(...parts);
}

function endLabels(points: Point[]): { startLabel: Point; endLabel: Point } {
	const offset = (a: Point, b: Point): Point => {
		const dx = b[0] - a[0];
		const dy = b[1] - a[1];
		const l = Math.hypot(dx, dy) || 1;
		const along = Math.min(18, l / 3);
		return [a[0] + (dx / l) * along - (dy / l) * 10, a[1] + (dy / l) * along + (dx / l) * 10];
	};
	return {
		startLabel: offset(points[0], points[1]),
		endLabel: offset(points[points.length - 1], points[points.length - 2])
	};
}

export function edgeGeometry(input: EdgeGeometryInput): EdgeGeometry {
	const { source, target } = input;
	const fraction = input.labelPos ?? 0.5;

	if (same(source, target)) {
		const s: Point = [source.x + source.width - 24, source.y];
		const e: Point = [source.x + source.width, source.y + 24];
		const c1: Point = [s[0], s[1] - 44];
		const c2: Point = [e[0] + 44, e[1]];
		const points: Point[] = [s, [source.x + source.width + 16, source.y - 16], e];
		return {
			d: pathD('M', ...s, 'C', ...c1, ...c2, ...e),
			points,
			label: [source.x + source.width + 22, source.y - 22],
			mid: points[1],
			...endLabels(points)
		};
	}

	let points: Point[];
	if (input.points?.length) {
		const bends = input.points;
		points = [clip(source, bends[0]), ...bends, clip(target, bends[bends.length - 1])];
	} else if (
		input.route &&
		input.routeBoxes &&
		same(input.routeBoxes.source, source) &&
		same(input.routeBoxes.target, target)
	) {
		points = input.route;
	} else {
		const par = input.parallel;
		const offset = par && par.count > 1 ? (par.index - (par.count - 1) / 2) * 28 : 0;
		if (offset) {
			const [sx, sy] = center(source);
			const [tx, ty] = center(target);
			const l = Math.hypot(tx - sx, ty - sy) || 1;
			const ctrl: Point = [
				(sx + tx) / 2 - ((ty - sy) / l) * offset * 2,
				(sy + ty) / 2 + ((tx - sx) / l) * offset * 2
			];
			const s = clip(source, ctrl);
			const e = clip(target, ctrl);
			// Sample the quadratic so labels and hit tests follow the curve.
			const sample: Point[] = [];
			for (let i = 0; i <= 16; i++) {
				const t = i / 16;
				const u = 1 - t;
				sample.push([
					u * u * s[0] + 2 * u * t * ctrl[0] + t * t * e[0],
					u * u * s[1] + 2 * u * t * ctrl[1] + t * t * e[1]
				]);
			}
			return {
				d: pathD('M', ...s, 'Q', ...ctrl, ...e),
				points: sample,
				label: pointAlong(sample, fraction),
				mid: sample[8],
				...endLabels(sample)
			};
		}
		points = [clip(source, center(target)), clip(target, center(source))];
	}
	return {
		d: roundedPath(points),
		points,
		label: pointAlong(points, fraction),
		mid: pointAlong(points, 0.5),
		...endLabels(points)
	};
}

// ------------------------------------------------------------------ SVG drawing

export function edgeStrokeDash(edge: RenderEdge): string | undefined {
	if (edge.data.dashed) return '6 4';
	if (edge.data.back) return '2 4';
	return undefined;
}

export function drawEdgePath(edge: RenderEdge, g: EdgeGeometry, t: TokenResolver): SvgNode {
	return el('path', {
		d: g.d,
		fill: 'none',
		stroke: edge.data.back ? t('text-muted') : t('edge'),
		'stroke-width': 1.5,
		'stroke-dasharray': edgeStrokeDash(edge),
		'marker-start':
			edge.data.markerStart !== 'none' ? `url(#${markerId(edge.data.markerStart)})` : undefined,
		'marker-end':
			edge.data.markerEnd !== 'none' ? `url(#${markerId(edge.data.markerEnd)})` : undefined
	});
}

/** Label box, multiplicities and aggregation badge. */
export function drawEdgeLabels(edge: RenderEdge, g: EdgeGeometry, t: TokenResolver): SvgNode[] {
	const out: SvgNode[] = [];
	const { label, sublabel, count, startLabel, endLabel } = edge.data;
	const size = edgeLabelSize(label, sublabel);
	const [lx, ly] = g.label;
	if (size.width) {
		const x = lx - size.width / 2;
		const y = ly - size.height / 2;
		out.push(
			el('rect', {
				x,
				y,
				width: size.width,
				height: size.height,
				rx: 3,
				fill: t('edge-label-bg'),
				opacity: 0.9
			})
		);
		let ty = y + EDGE_LABEL.padY;
		if (label) {
			out.push(
				svgText(lx, ty + 11, label, { size: EDGE_LABEL.size, fill: t('text'), anchor: 'middle' })
			);
			ty += 14;
		}
		if (sublabel)
			out.push(
				svgText(lx, ty + 10, `[${sublabel}]`, {
					size: EDGE_LABEL.subSize,
					fill: t('text-muted'),
					anchor: 'middle'
				})
			);
	}
	if (count && count > 1) {
		const bx = size.width ? lx + size.width / 2 + 2 : lx;
		const by = size.width ? ly - size.height / 2 : ly;
		const r = Math.max(8, textWidth(String(count), 10, true) / 2 + 4);
		out.push(el('circle', { cx: bx, cy: by, r, fill: t('badge-fill') }));
		out.push(
			svgText(bx, by + 3.5, String(count), {
				size: 10,
				bold: true,
				fill: t('badge-text'),
				anchor: 'middle'
			})
		);
	}
	for (const [text, [x, y]] of [
		[startLabel, g.startLabel],
		[endLabel, g.endLabel]
	] as const) {
		if (text) out.push(svgText(x, y + 4, text, { size: 11, fill: t('text'), anchor: 'middle' }));
	}
	return out;
}
