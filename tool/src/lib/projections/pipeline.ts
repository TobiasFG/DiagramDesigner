import type { Model, ViewInfo } from '../model/model';
import { sizeArtifact, sizeFlowNode, sizeJob } from '../render/shapes';
import { graphLayoutOptions } from './common';
import type { RenderEdge, RenderGraph, RenderNode } from './types';

export const TRIGGER_NODE = 'trigger';

export function projectPipeline(model: Model, view: ViewInfo): RenderGraph {
	const pipe = view.def.source ? model.pipelines.get(view.def.source) : undefined;
	const base: RenderGraph = {
		kind: 'graph',
		viewId: view.id,
		viewType: 'pipeline',
		title: view.title,
		description: view.def.description ?? pipe?.def.description,
		nodes: [],
		edges: [],
		diagnostics: [],
		layout: graphLayoutOptions(view.def, { direction: 'RIGHT' })
	};
	if (!pipe) {
		base.diagnostics.push({
			severity: 'error',
			code: 'view-source',
			message: `pipeline "${view.def.source}" not found`
		});
		return base;
	}
	const { file, path } = pipe.loc;
	const nodes: RenderNode[] = [];
	const edges: RenderEdge[] = [];
	const owner = pipe.id;
	const needsEdge = (from: string, to: string, ref: RenderEdge['ref']): RenderEdge => ({
		id: `${from}->${to}#0`,
		source: from,
		target: to,
		type: 'needs',
		ref,
		data: { dashed: false, markerStart: 'none', markerEnd: 'arrow' }
	});

	if (pipe.def.trigger) {
		const data = { flowType: 'start' as const, label: pipe.def.trigger };
		nodes.push({
			id: TRIGGER_NODE,
			type: 'flow',
			isGroup: false,
			...sizeFlowNode(data),
			ref: { kind: 'pipeline', file, path },
			data
		});
	}
	const stageIds = new Set(pipe.def.stages.map((s) => s.id));
	const jobIds = new Set(pipe.def.stages.flatMap((s) => s.jobs.map((j) => j.id)));
	pipe.def.stages.forEach((stage, i) => {
		const sref = { kind: 'stage' as const, file, path: [...path, 'stages', i], owner };
		nodes.push({
			id: stage.id,
			type: 'stage',
			isGroup: true,
			width: 180,
			height: 100,
			ref: sref,
			data: { label: stage.name ?? stage.id }
		});
		if (pipe.def.trigger && !stage.needs?.length) {
			edges.push(needsEdge(TRIGGER_NODE, stage.id, sref));
		}
		for (const need of stage.needs ?? [])
			if (stageIds.has(need)) edges.push(needsEdge(need, stage.id, sref));
		stage.jobs.forEach((job, j) => {
			const label = job.name ?? job.id;
			const jref = { kind: 'job' as const, file, path: [...sref.path, 'jobs', j], owner };
			nodes.push({
				id: job.id,
				type: 'job',
				parentId: stage.id,
				isGroup: false,
				...sizeJob(label),
				ref: jref,
				data: { label, status: job.meta?.status }
			});
			for (const need of job.needs ?? [])
				if (jobIds.has(need)) edges.push(needsEdge(need, job.id, jref));
		});
	});
	pipe.def.artifacts?.forEach((art, i) => {
		const label = art.name ?? art.id;
		const aref = { kind: 'artifact' as const, file, path: [...path, 'artifacts', i], owner };
		nodes.push({
			id: art.id,
			type: 'artifact',
			isGroup: false,
			...sizeArtifact(label),
			ref: aref,
			data: { label }
		});
		const artifactEdge = (from: string, to: string): RenderEdge => ({
			id: `${from}->${to}#0`,
			source: from,
			target: to,
			type: 'artifact',
			ref: aref,
			data: { dashed: true, markerStart: 'none', markerEnd: 'arrow' }
		});
		if (art.producedBy && jobIds.has(art.producedBy))
			edges.push(artifactEdge(art.producedBy, art.id));
		for (const c of art.consumedBy ?? []) if (jobIds.has(c)) edges.push(artifactEdge(art.id, c));
	});
	return { ...base, nodes, edges };
}
