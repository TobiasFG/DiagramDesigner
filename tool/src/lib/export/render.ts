import type { ThemeName } from '../config';
import { layoutGraph } from '../layout/layout';
import type { ElkLike, PositionedGraph } from '../layout/types';
import type { Model } from '../model/model';
import { project } from '../projections';
import type { RenderGraph, SequenceGraph } from '../projections/types';
import { layoutSequence, type SequenceLayout } from '../sequence/layout';
import { toMermaid, type MermaidResult } from './mermaid';
import { graphToSvg, sequenceToSvg } from './svg';

export type Rendered =
	| { kind: 'graph'; projection: RenderGraph; positioned: PositionedGraph }
	| { kind: 'sequence'; projection: SequenceGraph; layout: SequenceLayout };

/** Projection plus layout for one view — the same pipeline the canvas runs. */
export async function renderView(
	model: Model,
	viewId: string,
	elk: ElkLike
): Promise<Rendered | undefined> {
	const projection = project(model, viewId);
	if (!projection) return undefined;
	if (projection.kind === 'sequence')
		return { kind: 'sequence', projection, layout: layoutSequence(projection) };
	const positioned = await layoutGraph(projection, model.layouts.get(viewId)?.data, elk);
	return { kind: 'graph', projection, positioned };
}

export function renderedToSvg(r: Rendered, theme: ThemeName): string {
	return r.kind === 'graph' ? graphToSvg(r.positioned, theme) : sequenceToSvg(r.layout, theme);
}

export function renderedToMermaid(r: Rendered): MermaidResult {
	return toMermaid(r.projection);
}

export function exportBaseName(model: Model, viewId: string): string {
	return model.views.get(viewId)?.def.export?.file ?? viewId;
}
