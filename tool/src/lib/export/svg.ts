import type { ThemeName } from '../config';
import { boxOf } from '../layout/layout';
import type { PositionedGraph } from '../layout/types';
import { drawEdgeLabels, drawEdgePath, edgeGeometry } from '../render/edges';
import { drawNode, markerDefs, nodeOutline } from '../render/shapes';
import { el, toSvgString, type SvgNode } from '../render/svg';
import { FONT_STACK } from '../render/text';
import { drawSequenceBody, drawSequenceHeaders } from '../sequence/draw';
import type { SequenceLayout } from '../sequence/layout';
import { literalResolver, type TokenResolver } from '../theme/tokens';

export const SVG_PADDING = 16;

const TYPE_NAMES: Record<string, string> = {
	component: 'Component diagram',
	class: 'Class diagram',
	object: 'Object diagram',
	flow: 'Flow diagram',
	pipeline: 'Pipeline diagram',
	sequence: 'Sequence diagram'
};

function wrapSvg(
	title: string,
	desc: string,
	box: { x: number; y: number; width: number; height: number },
	t: TokenResolver,
	content: (SvgNode | null)[]
): string {
	const x = Math.floor(box.x - SVG_PADDING);
	const y = Math.floor(box.y - SVG_PADDING);
	const w = Math.ceil(box.width + SVG_PADDING * 2);
	const h = Math.ceil(box.height + SVG_PADDING * 2);
	const svg = el(
		'svg',
		{
			xmlns: 'http://www.w3.org/2000/svg',
			viewBox: `${x} ${y} ${w} ${h}`,
			width: w,
			height: h,
			role: 'img',
			'aria-labelledby': 'sdv-title sdv-desc',
			'font-family': FONT_STACK
		},
		el('title', { id: 'sdv-title' }, title),
		el('desc', { id: 'sdv-desc' }, desc),
		el('rect', { x, y, width: w, height: h, fill: t('canvas-bg') }),
		markerDefs(t),
		...content
	);
	return toSvgString(svg, 1) + '\n';
}

/** Graph views: groups, then edges, then nodes, then edge labels, all in projection order. */
export function graphToSvg(pg: PositionedGraph, theme: ThemeName): string {
	const t = literalResolver(theme);
	const { graph } = pg;
	const byId = new Map(pg.nodes.map((n) => [n.node.id, n]));
	const drawAt = (n: (typeof pg.nodes)[number]) =>
		el(
			'g',
			{ transform: `translate(${n.absX} ${n.absY})`, 'data-id': n.node.id },
			drawNode(n.node, n.width, n.height, t)
		);
	const geometries = pg.edges.map((e) => {
		const s = byId.get(e.edge.source)!;
		const tg = byId.get(e.edge.target)!;
		return {
			e,
			g: edgeGeometry({
				source: { ...boxOf(s), outline: nodeOutline(s.node) },
				target: { ...boxOf(tg), outline: nodeOutline(tg.node) },
				route: e.route,
				routeBoxes: e.routeBoxes,
				points: e.points,
				labelPos: e.labelPos,
				parallel: e.parallel
			})
		};
	});
	const desc =
		graph.description ??
		`${TYPE_NAMES[graph.viewType]} with ${pg.nodes.length} nodes and ${pg.edges.length} connections.`;
	return wrapSvg(graph.title, desc, pg.bounds, t, [
		el('g', { class: 'sdv-groups' }, ...pg.nodes.filter((n) => n.node.isGroup).map(drawAt)),
		el(
			'g',
			{ class: 'sdv-edges' },
			...geometries.map(({ e, g }) => el('g', { 'data-id': e.edge.id }, drawEdgePath(e.edge, g, t)))
		),
		el('g', { class: 'sdv-nodes' }, ...pg.nodes.filter((n) => !n.node.isGroup).map(drawAt)),
		el(
			'g',
			{ class: 'sdv-edge-labels' },
			...geometries.flatMap(({ e, g }) => drawEdgeLabels(e.edge, g, t))
		)
	]);
}

export function sequenceToSvg(layout: SequenceLayout, theme: ThemeName): string {
	const t = literalResolver(theme);
	const g = layout.graph;
	const desc =
		g.description ??
		`${TYPE_NAMES.sequence} with ${layout.columns.length} participants and ${layout.messages.length} messages.`;
	return wrapSvg(g.title, desc, { x: 0, y: 0, width: layout.width, height: layout.height }, t, [
		el('g', { class: 'sdv-seq-body' }, ...drawSequenceBody(layout, t)),
		el('g', { class: 'sdv-seq-headers' }, ...drawSequenceHeaders(layout, t))
	]);
}
