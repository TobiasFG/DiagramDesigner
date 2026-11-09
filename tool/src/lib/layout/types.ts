import type { RenderEdge, RenderGraph, RenderNode } from '../projections/types';

export type Point = [number, number];

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface PositionedNode {
	node: RenderNode;
	/** Relative to the parent node (Svelte Flow convention). */
	x: number;
	y: number;
	/** Absolute canvas coordinates. */
	absX: number;
	absY: number;
	width: number;
	height: number;
	pinned: boolean;
}

export interface PositionedEdge {
	edge: RenderEdge;
	/** Automatic route from ELK in absolute coordinates, valid only while both ends stay put. */
	route?: Point[];
	/** Absolute boxes of the ends when `route` was computed. */
	routeBoxes?: { source: Box; target: Box };
	/** Manual bend points from the layout file. */
	points?: Point[];
	labelPos?: number;
	/** Index among edges connecting the same two nodes, for spreading parallel edges. */
	parallel: { index: number; count: number };
}

export interface PositionedGraph {
	graph: RenderGraph;
	nodes: PositionedNode[];
	edges: PositionedEdge[];
	bounds: Box;
}

/** The subset of the elkjs API used here, so the browser worker and Node can both supply it. */
export interface ElkLike {
	layout(graph: ElkGraphNode): Promise<ElkGraphNode>;
}

export interface ElkGraphNode {
	id: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	layoutOptions?: Record<string, string>;
	children?: ElkGraphNode[];
	edges?: ElkGraphEdge[];
	labels?: { text: string; width: number; height: number; x?: number; y?: number }[];
}

export interface ElkGraphEdge {
	id: string;
	sources: string[];
	targets: string[];
	labels?: { text: string; width: number; height: number; x?: number; y?: number }[];
	sections?: {
		startPoint: { x: number; y: number };
		endPoint: { x: number; y: number };
		bendPoints?: { x: number; y: number }[];
	}[];
}
