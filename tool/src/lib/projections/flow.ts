import type { Model, ViewInfo } from '../model/model';
import type { Flow } from '../model/schema';
import { sizeFlowNode } from '../render/shapes';
import { graphLayoutOptions, pairKeys } from './common';
import type { FlowNodeShape, LaneNode, RenderEdge, RenderGraph, RenderNode } from './types';

export const NO_LANE = 'lane:unassigned';

export function laneId(actor: string | undefined): string {
	return actor ? `lane:${actor}` : NO_LANE;
}

export function flowNodeLabel(node: Flow['nodes'][number]): string {
	if (node.name) return node.name;
	if (node.type === 'start') return 'Start';
	if (node.type === 'end') return 'End';
	return node.id;
}

/** Transitions that close a cycle in a depth-first walk from the start nodes. */
export function backEdges(flow: Flow): Set<number> {
	const out = new Map<string, { to: string; index: number }[]>();
	(flow.transitions ?? []).forEach((t, index) => {
		if (!out.has(t.from)) out.set(t.from, []);
		out.get(t.from)!.push({ to: t.to, index });
	});
	const back = new Set<number>();
	const state = new Map<string, 'open' | 'done'>();
	const visit = (id: string) => {
		state.set(id, 'open');
		for (const e of out.get(id) ?? []) {
			const s = state.get(e.to);
			if (s === 'open') back.add(e.index);
			else if (!s) visit(e.to);
		}
		state.set(id, 'done');
	};
	const starts = flow.nodes.filter((n) => n.type === 'start').map((n) => n.id);
	for (const id of [...starts, ...flow.nodes.map((n) => n.id)]) if (!state.has(id)) visit(id);
	return back;
}

export function projectFlow(model: Model, view: ViewInfo): RenderGraph {
	const flow = view.def.source ? model.flows.get(view.def.source) : undefined;
	const base: RenderGraph = {
		kind: 'graph',
		viewId: view.id,
		viewType: 'flow',
		title: view.title,
		description: view.def.description ?? flow?.def.description,
		nodes: [],
		edges: [],
		diagnostics: [],
		layout: graphLayoutOptions(view.def, { direction: 'DOWN' })
	};
	if (!flow) {
		base.diagnostics.push({
			severity: 'error',
			code: 'view-source',
			message: `flow "${view.def.source}" not found`
		});
		return base;
	}
	const useLanes = flow.def.lanes === 'by-actor';
	const lanes: LaneNode[] = [];
	if (useLanes) {
		for (const node of flow.def.nodes) {
			const id = laneId(node.actor);
			if (lanes.some((l) => l.id === id)) continue;
			const label = node.actor
				? (model.elements.get(node.actor)?.name ?? node.actor)
				: '(unassigned)';
			lanes.push({ id, type: 'lane', isGroup: true, width: 200, height: 200, data: { label } });
		}
	}
	const flowNodes: FlowNodeShape[] = flow.def.nodes.map((node, i) => {
		const data: FlowNodeShape['data'] = {
			flowType: node.type,
			label: flowNodeLabel(node),
			ref: node.ref
		};
		return {
			id: node.id,
			type: 'flow',
			parentId: useLanes ? laneId(node.actor) : undefined,
			isGroup: false,
			...sizeFlowNode(data),
			ref: {
				kind: 'flowNode',
				file: flow.loc.file,
				path: [...flow.loc.path, 'nodes', i],
				owner: flow.id
			},
			data
		};
	});
	const ids = new Set(flow.def.nodes.map((n) => n.id));
	const back = backEdges(flow.def);
	const key = pairKeys();
	const edges: RenderEdge[] = [];
	(flow.def.transitions ?? []).forEach((t, i) => {
		const id = key(t.from, t.to);
		if (!ids.has(t.from) || !ids.has(t.to)) return;
		edges.push({
			id,
			source: t.from,
			target: t.to,
			type: 'transition',
			ref: {
				kind: 'transition',
				file: flow.loc.file,
				path: [...flow.loc.path, 'transitions', i],
				owner: flow.id
			},
			data: {
				label: t.label,
				dashed: false,
				markerStart: 'none',
				markerEnd: 'arrow',
				back: back.has(i)
			}
		});
	});
	const nodes: RenderNode[] = [...lanes, ...flowNodes];
	return {
		...base,
		nodes,
		edges,
		layout: graphLayoutOptions(view.def, {
			direction: 'DOWN',
			lanes: useLanes ? lanes.map((l) => l.id) : undefined
		})
	};
}
