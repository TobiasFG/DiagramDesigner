import type { Model, ViewInfo } from '../model/model';
import { projectClass } from './class';
import { projectComponent } from './component';
import { laneId, projectFlow } from './flow';
import { projectObject } from './object';
import { projectPipeline, TRIGGER_NODE } from './pipeline';
import { projectSequence } from './sequence';
import type { Projection } from './types';

/** Projects a view of the model into its render graph. Pure; undefined for unknown views. */
export function project(model: Model, viewId: string): Projection | undefined {
	const view = model.views.get(viewId);
	if (!view) return undefined;
	const layout = model.layouts.get(viewId)?.data;
	switch (view.def.type) {
		case 'component':
			return projectComponent(model, view, layout);
		case 'class':
			return projectClass(model, view);
		case 'object':
			return projectObject(model, view);
		case 'flow':
			return projectFlow(model, view);
		case 'pipeline':
			return projectPipeline(model, view);
		case 'sequence':
			return projectSequence(model, view, layout);
	}
}

const LANDSCAPE: ViewInfo = {
	id: 'landscape',
	def: { id: 'landscape', type: 'component', layout: { direction: 'RIGHT' } },
	generated: true,
	title: 'Application landscape'
};

/** The whole model as one canvas; `expanded` lists the elements opened by zooming in. */
export function projectLandscape(model: Model, expanded: ReadonlySet<string>) {
	return projectComponent(model, LANDSCAPE, undefined, expanded);
}

export type * from './types';

/** Ids a view's layout file may legitimately reference; everything else is stale. */
export function knownLayoutIds(model: Model, viewId: string): Set<string> {
	const view = model.views.get(viewId);
	const ids = new Set<string>();
	if (!view) return ids;
	const src = view.def.source;
	switch (view.def.type) {
		case 'component':
			for (const id of model.elements.keys()) ids.add(id);
			break;
		case 'class':
			for (const id of model.classes.keys()) ids.add(id);
			break;
		case 'object':
			for (const id of model.objects.keys()) ids.add(id);
			break;
		case 'flow':
			for (const n of model.flows.get(src ?? '')?.def.nodes ?? []) {
				ids.add(n.id);
				ids.add(laneId(n.actor));
			}
			break;
		case 'pipeline': {
			const p = model.pipelines.get(src ?? '')?.def;
			ids.add(TRIGGER_NODE);
			for (const s of p?.stages ?? []) {
				ids.add(s.id);
				for (const j of s.jobs) ids.add(j.id);
			}
			for (const a of p?.artifacts ?? []) ids.add(a.id);
			break;
		}
		case 'sequence':
			for (const p of model.interactions.get(src ?? '')?.def.participants ?? []) ids.add(p);
			break;
	}
	return ids;
}
