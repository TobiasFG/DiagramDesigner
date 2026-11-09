import type { LayoutFile } from '../model/schema';
import type { RenderEdge, RenderGraph, RenderNode } from '../projections/types';
import { BOUNDARY_PADDING, edgeLabelSize, LANE_HEADER, STAGE_PADDING } from '../render/shapes';
import type {
	Box,
	ElkGraphNode,
	ElkLike,
	Point,
	PositionedEdge,
	PositionedGraph,
	PositionedNode
} from './types';

/**
 * Runs ELK on a render graph and merges the result with the view's layout file:
 * - nodes without a layout entry take ELK's position;
 * - pinned nodes keep their stored position (relative to their parent); ELK sees them via
 *   semi-interactive crossing minimisation so neighbours keep a consistent order;
 * - groups grow to contain pinned children, and unpinned nodes are pushed off pinned ones.
 */

const ALGORITHMS: Record<string, string> = {
	layered: 'org.eclipse.elk.layered',
	stress: 'org.eclipse.elk.stress',
	mrtree: 'org.eclipse.elk.mrtree',
	force: 'org.eclipse.elk.force'
};

function padding(
	node: RenderNode
): { top: number; left: number; bottom: number; right: number } | undefined {
	if (node.type === 'boundary') return BOUNDARY_PADDING;
	if (node.type === 'stage') return STAGE_PADDING;
	if (node.type === 'lane') return { top: LANE_HEADER + 16, left: 16, bottom: 16, right: 16 };
	return undefined;
}

const padString = (p: { top: number; left: number; bottom: number; right: number }) =>
	`[top=${p.top},left=${p.left},bottom=${p.bottom},right=${p.right}]`;

/** Edges drawn from "whole" to "part" are laid out reversed so containers sit above parts. */
function layoutReversed(edge: RenderEdge): boolean {
	return edge.data.relationType === 'composition' || edge.data.relationType === 'aggregation';
}

export function toElkGraph(
	graph: RenderGraph,
	layout: LayoutFile | undefined,
	flat = false
): ElkGraphNode {
	const opts = graph.layout;
	const entries = layout?.nodes ?? {};
	const anyPinned = graph.nodes.some((n) => entries[n.id]?.pinned);
	const layered = opts.algorithm === 'layered';
	const rootOptions: Record<string, string> = {
		'elk.algorithm': ALGORITHMS[opts.algorithm] ?? ALGORITHMS.layered,
		'elk.direction': opts.direction,
		'elk.spacing.nodeNode': String(opts.spacing),
		'elk.spacing.edgeNode': String(Math.round(opts.spacing / 3)),
		'elk.spacing.edgeEdge': '12',
		'elk.spacing.edgeLabel': '4',
		'elk.edgeLabels.placement': 'CENTER',
		'elk.json.edgeCoords': 'ROOT',
		'elk.randomSeed': '1'
	};
	if (layered) {
		// Several options produce tidier diagrams but get slow on big graphs (see the perf
		// tests): hierarchy handling only with groups; model order, network simplex and full
		// crossing-minimisation thoroughness only up to 100 nodes.
		const compound = !flat && graph.nodes.some((n) => n.isGroup);
		const big = graph.nodes.length > 100;
		Object.assign(rootOptions, {
			...(compound ? { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' } : {}),
			...(big
				? { 'elk.layered.thoroughness': '2' }
				: { 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES' }),
			'elk.edgeRouting': 'ORTHOGONAL',
			'elk.layered.spacing.nodeNodeBetweenLayers': String(opts.spacing),
			'elk.layered.spacing.edgeNodeBetweenLayers': String(Math.round(opts.spacing / 3)),
			'elk.layered.nodePlacement.strategy': big ? 'BRANDES_KOEPF' : 'NETWORK_SIMPLEX',
			'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
			'elk.layered.crossingMinimization.semiInteractive': String(anyPinned)
		});
	} else if (opts.algorithm === 'stress') {
		rootOptions['elk.stress.desiredEdgeLength'] = String(opts.spacing * 3);
	}

	const byId = new Map<string, ElkGraphNode>();
	const root: ElkGraphNode = {
		id: '__root__',
		layoutOptions: rootOptions,
		children: [],
		edges: []
	};
	for (const node of graph.nodes) {
		if (flat && node.isGroup) continue;
		const entry = entries[node.id];
		const elk: ElkGraphNode = { id: node.id, width: node.width, height: node.height };
		const pad = padding(node);
		if (node.isGroup) {
			elk.layoutOptions = {
				'elk.padding': padString(pad ?? BOUNDARY_PADDING),
				'elk.nodeSize.constraints': 'MINIMUM_SIZE',
				'elk.nodeSize.minimum': `(${entry?.w ?? node.width}, ${entry?.h ?? node.height})`
			};
			elk.children = [];
			delete elk.width;
			delete elk.height;
		} else if (entry?.w && entry?.h) {
			elk.width = entry.w;
			elk.height = entry.h;
		}
		if (entry?.pinned && entry.x !== undefined && entry.y !== undefined) {
			elk.x = entry.x;
			elk.y = entry.y;
		}
		byId.set(node.id, elk);
		const parent = !flat && node.parentId ? byId.get(node.parentId) : undefined;
		(parent ?? root).children!.push(elk);
	}
	for (const edge of graph.edges) {
		if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
		const label = edgeLabelSize(edge.data.label, edge.data.sublabel);
		const reversed = layoutReversed(edge);
		root.edges!.push({
			id: edge.id,
			sources: [reversed ? edge.target : edge.source],
			targets: [reversed ? edge.source : edge.target],
			labels: label.width
				? [{ text: edge.data.label ?? '', width: label.width, height: label.height }]
				: undefined
		});
	}
	return root;
}

interface Placed {
	x: number;
	y: number;
	width: number;
	height: number;
}

function collect(elk: ElkGraphNode, out: Map<string, Placed>) {
	for (const c of elk.children ?? []) {
		out.set(c.id, { x: c.x ?? 0, y: c.y ?? 0, width: c.width ?? 0, height: c.height ?? 0 });
		collect(c, out);
	}
}

const overlaps = (a: Placed, b: Placed, gap: number) =>
	a.x < b.x + b.width + gap &&
	b.x < a.x + a.width + gap &&
	a.y < b.y + b.height + gap &&
	b.y < a.y + a.height + gap;

export async function layoutGraph(
	graph: RenderGraph,
	layout: LayoutFile | undefined,
	elk: ElkLike
): Promise<PositionedGraph> {
	const lanes = graph.layout.lanes;
	const elkGraph = toElkGraph(graph, layout, !!lanes);
	const result = graph.nodes.length ? await elk.layout(elkGraph) : elkGraph;
	const placed = new Map<string, Placed>();
	collect(result, placed);
	if (lanes) arrangeLanes(graph, lanes, placed);

	const entries = layout?.nodes ?? {};
	const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
	const elkAbs = absolutes(graph.nodes, placed);

	// Pinned positions and stored sizes win over ELK.
	const pinned = new Set<string>();
	for (const node of graph.nodes) {
		const entry = entries[node.id];
		const p = placed.get(node.id);
		if (!p || !entry) continue;
		if (entry.pinned && entry.x !== undefined && entry.y !== undefined) {
			p.x = entry.x;
			p.y = entry.y;
			pinned.add(node.id);
		}
		if (entry.w && entry.h) {
			p.width = node.isGroup ? Math.max(p.width, entry.w) : entry.w;
			p.height = node.isGroup ? Math.max(p.height, entry.h) : entry.h;
		}
	}

	if (pinned.size) {
		resolveOverlaps(graph.nodes, placed, pinned, graph.layout.direction);
		fitGroups(graph.nodes, nodeById, placed);
	}

	const abs = absolutes(graph.nodes, placed);
	const nodes: PositionedNode[] = graph.nodes.map((node) => {
		const p = placed.get(node.id) ?? { x: 0, y: 0, width: node.width, height: node.height };
		const a = abs.get(node.id) ?? { x: p.x, y: p.y };
		return {
			node,
			x: Math.round(p.x),
			y: Math.round(p.y),
			absX: Math.round(a.x),
			absY: Math.round(a.y),
			width: Math.round(p.width),
			height: Math.round(p.height),
			pinned: pinned.has(node.id)
		};
	});
	const posById = new Map(nodes.map((n) => [n.node.id, n]));

	const routes = new Map<string, Point[]>();
	const edgeById = new Map(graph.edges.map((e) => [e.id, e]));
	if (!lanes) {
		for (const e of result.edges ?? []) {
			const s = e.sections?.[0];
			if (!s) continue;
			const pts: Point[] = [
				[s.startPoint.x, s.startPoint.y],
				...(s.bendPoints ?? []).map((b): Point => [b.x, b.y]),
				[s.endPoint.x, s.endPoint.y]
			];
			const edge = edgeById.get(e.id);
			routes.set(
				e.id,
				(edge && layoutReversed(edge) ? pts.reverse() : pts).map(([x, y]): Point => [
					Math.round(x),
					Math.round(y)
				])
			);
		}
	}

	const pairCount = new Map<string, number>();
	const pairKey = (e: RenderEdge) => [e.source, e.target].sort().join('|');
	for (const e of graph.edges) pairCount.set(pairKey(e), (pairCount.get(pairKey(e)) ?? 0) + 1);
	const pairSeen = new Map<string, number>();
	const edges: PositionedEdge[] = [];
	for (const edge of graph.edges) {
		const s = posById.get(edge.source);
		const t = posById.get(edge.target);
		if (!s || !t) continue;
		const k = pairKey(edge);
		const index = pairSeen.get(k) ?? 0;
		pairSeen.set(k, index + 1);
		const stored = layout?.edges?.[edge.id];
		const positioned: PositionedEdge = {
			edge,
			points: stored?.points?.map(([x, y]): Point => [x, y]),
			labelPos: stored?.labelPos,
			parallel: { index, count: pairCount.get(k)! }
		};
		const route = routes.get(edge.id);
		const unmoved = (id: string) => {
			const before = elkAbs.get(id);
			const now = posById.get(id)!;
			return (
				before &&
				Math.round(before.x) === now.absX &&
				Math.round(before.y) === now.absY &&
				Math.round(placedSize(placed, id).w) === now.width
			);
		};
		if (route && unmoved(edge.source) && unmoved(edge.target)) {
			positioned.route = route;
			positioned.routeBoxes = { source: boxOf(s), target: boxOf(t) };
		}
		edges.push(positioned);
	}

	return { graph, nodes, edges, bounds: boundsOf(nodes, edges) };
}

function placedSize(placed: Map<string, Placed>, id: string) {
	const p = placed.get(id)!;
	return { w: p.width, h: p.height };
}

export function boxOf(n: PositionedNode): Box {
	return { x: n.absX, y: n.absY, width: n.width, height: n.height };
}

function absolutes(
	nodes: RenderNode[],
	placed: Map<string, Placed>
): Map<string, { x: number; y: number }> {
	const out = new Map<string, { x: number; y: number }>();
	for (const n of nodes) {
		const p = placed.get(n.id);
		if (!p) continue;
		const parent = n.parentId ? out.get(n.parentId) : undefined;
		out.set(n.id, { x: p.x + (parent?.x ?? 0), y: p.y + (parent?.y ?? 0) });
	}
	return out;
}

/** Pushes unpinned nodes off pinned (and already placed) siblings. */
function resolveOverlaps(
	nodes: RenderNode[],
	placed: Map<string, Placed>,
	pinned: Set<string>,
	direction: string
) {
	const gap = 20;
	const siblings = new Map<string | undefined, RenderNode[]>();
	for (const n of nodes) {
		if (!siblings.has(n.parentId)) siblings.set(n.parentId, []);
		siblings.get(n.parentId)!.push(n);
	}
	const horizontalFlow = direction === 'RIGHT' || direction === 'LEFT';
	for (const group of siblings.values()) {
		if (!group.some((n) => pinned.has(n.id))) continue;
		const fixed: Placed[] = group
			.filter((n) => pinned.has(n.id))
			.map((n) => placed.get(n.id)!)
			.filter(Boolean);
		const free = group
			.filter((n) => !pinned.has(n.id) && placed.has(n.id))
			.sort(
				(a, b) =>
					placed.get(a.id)!.y - placed.get(b.id)!.y || placed.get(a.id)!.x - placed.get(b.id)!.x
			);
		for (const n of free) {
			const p = placed.get(n.id)!;
			for (let guard = 0; guard < 500; guard++) {
				const hit = fixed.find((f) => overlaps(p, f, gap));
				if (!hit) break;
				// Move across the flow so layers stay aligned.
				if (horizontalFlow) p.y = hit.y + hit.height + gap;
				else p.x = hit.x + hit.width + gap;
			}
			fixed.push(p);
		}
	}
}

/** Grows groups (deepest first) so all children fit inside their padding. */
function fitGroups(
	nodes: RenderNode[],
	byId: Map<string, RenderNode>,
	placed: Map<string, Placed>
) {
	const depth = (n: RenderNode): number => (n.parentId ? 1 + depth(byId.get(n.parentId)!) : 0);
	const groups = nodes.filter((n) => n.isGroup).sort((a, b) => depth(b) - depth(a));
	for (const g of groups) {
		const gp = placed.get(g.id);
		const kids = nodes
			.filter((n) => n.parentId === g.id)
			.map((n) => placed.get(n.id)!)
			.filter(Boolean);
		if (!gp || !kids.length) continue;
		const pad = padding(g) ?? BOUNDARY_PADDING;
		const minX = Math.min(...kids.map((k) => k.x));
		const minY = Math.min(...kids.map((k) => k.y));
		const dx = minX < pad.left ? pad.left - minX : 0;
		const dy = minY < pad.top ? pad.top - minY : 0;
		if (dx || dy) {
			for (const k of kids) {
				k.x += dx;
				k.y += dy;
			}
			gp.x -= dx;
			gp.y -= dy;
		}
		gp.width = Math.max(gp.width, ...kids.map((k) => k.x + k.width + pad.right));
		gp.height = Math.max(gp.height, ...kids.map((k) => k.y + k.height + pad.bottom));
	}
}

/**
 * Swimlanes: ELK lays out the flat graph top-down; each lane becomes a column holding its
 * nodes at their ELK height, with nodes that share a row placed side by side.
 */
function arrangeLanes(graph: RenderGraph, lanes: string[], placed: Map<string, Placed>) {
	const gap = 24;
	const pad = 16;
	const top = LANE_HEADER + pad;
	const members = new Map<string, RenderNode[]>(lanes.map((l) => [l, []]));
	for (const n of graph.nodes)
		if (n.parentId && members.has(n.parentId)) members.get(n.parentId)!.push(n);
	const minY = Math.min(
		...graph.nodes.filter((n) => !n.isGroup).map((n) => placed.get(n.id)?.y ?? 0)
	);
	let laneX = 0;
	let maxBottom = 0;
	const laneBoxes: { id: string; x: number; width: number }[] = [];
	for (const lane of lanes) {
		const nodes = (members.get(lane) ?? [])
			.filter((n) => placed.has(n.id))
			.sort((a, b) => placed.get(a.id)!.x - placed.get(b.id)!.x);
		// Clusters of nodes whose vertical extents overlap share a row.
		const rows: RenderNode[][] = [];
		for (const n of [...nodes].sort((a, b) => placed.get(a.id)!.y - placed.get(b.id)!.y)) {
			const p = placed.get(n.id)!;
			const row = rows.find((r) =>
				r.some((m) => {
					const q = placed.get(m.id)!;
					return p.y < q.y + q.height && q.y < p.y + p.height;
				})
			);
			if (row) row.push(n);
			else rows.push([n]);
		}
		const rowWidth = (r: RenderNode[]) =>
			r.reduce((s, n) => s + placed.get(n.id)!.width, 0) + gap * (r.length - 1);
		const width = Math.max(180, ...rows.map(rowWidth)) + pad * 2;
		for (const r of rows) {
			r.sort((a, b) => placed.get(a.id)!.x - placed.get(b.id)!.x);
			let x = (width - rowWidth(r)) / 2;
			for (const n of r) {
				const p = placed.get(n.id)!;
				p.x = x;
				p.y = p.y - minY + top;
				x += p.width + gap;
				maxBottom = Math.max(maxBottom, p.y + p.height);
			}
		}
		laneBoxes.push({ id: lane, x: laneX, width });
		laneX += width;
	}
	for (const l of laneBoxes)
		placed.set(l.id, { x: l.x, y: 0, width: l.width, height: maxBottom + pad });
}

function boundsOf(nodes: PositionedNode[], edges: PositionedEdge[]): Box {
	if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
	let x1 = Infinity;
	let y1 = Infinity;
	let x2 = -Infinity;
	let y2 = -Infinity;
	for (const n of nodes) {
		x1 = Math.min(x1, n.absX);
		y1 = Math.min(y1, n.absY);
		x2 = Math.max(x2, n.absX + n.width);
		y2 = Math.max(y2, n.absY + n.height);
	}
	for (const e of edges) {
		for (const [x, y] of [...(e.route ?? []), ...(e.points ?? [])]) {
			x1 = Math.min(x1, x);
			y1 = Math.min(y1, y);
			x2 = Math.max(x2, x);
			y2 = Math.max(y2, y);
		}
	}
	return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
