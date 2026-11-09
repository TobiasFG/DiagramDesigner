import { getContext, setContext } from 'svelte';
import type { Point } from '../layout/types';
import type { RenderEdge, RenderNode } from '../projections/types';
import type { MemberList } from '../commands/model';

/** What is being edited inline: a node label, a class/object row, or an edge label. */
export type InlineEdit =
	| { kind: 'label'; nodeId: string }
	| { kind: 'member'; nodeId: string; list: MemberList | 'slots'; index: number; isNew?: boolean }
	| { kind: 'edge'; edgeId: string };

export interface CanvasContext {
	readonly viewId: string;
	readonly readOnly: boolean;
	readonly hovered: string | null;
	readonly editing: InlineEdit | null;
	setHovered(id: string | null): void;
	startEdit(edit: InlineEdit | null): void;
	commitLabel(node: RenderNode, text: string): void;
	commitMember(
		node: RenderNode,
		list: MemberList | 'slots',
		index: number,
		text: string,
		isNew?: boolean
	): void;
	addMember(node: RenderNode, list: MemberList | 'slots'): void;
	commitEdgeLabel(edge: RenderEdge, text: string): void;
	toggleCollapse(nodeId: string, collapsed: boolean): void;
	unpin(nodeId: string): void;
	resize(nodeId: string, box: { x: number; y: number; width: number; height: number }): void;
	openSubflow(flowId: string): void;
	setEdgePoints(edgeId: string, points: Point[] | undefined): void;
	/** Converts screen coordinates to canvas coordinates. */
	toFlow(clientX: number, clientY: number): Point;
	isCollapsed(nodeId: string): boolean;
}

const KEY = Symbol('sdv-canvas');

export function setCanvasContext(ctx: CanvasContext) {
	setContext(KEY, ctx);
}

export function getCanvasContext(): CanvasContext {
	return getContext(KEY);
}
