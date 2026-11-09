import { isObjectLink, type Model, type ViewInfo } from '../model/model';
import { select } from '../model/select';
import { sizeObject } from '../render/shapes';
import { graphLayoutOptions, pairKeys } from './common';
import type { ObjectNode, RenderEdge, RenderGraph } from './types';

export function projectObject(model: Model, view: ViewInfo): RenderGraph {
	const def = view.def;
	const visible = select(model.objects, def.include, def.exclude, model.objects.keys()).ids;
	const nodes: ObjectNode[] = [];
	for (const obj of model.objects.values()) {
		if (!visible.has(obj.id)) continue;
		const cls = model.classes.get(obj.def.class);
		const slots = obj.def.slots ?? {};
		// Slots follow the class attribute order; unknown slots keep file order at the end.
		const order = (cls?.def.attributes ?? []).map((a) => a.name);
		const names = Object.keys(slots).sort((a, b) => {
			const ia = order.indexOf(a);
			const ib = order.indexOf(b);
			return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
		});
		const data: ObjectNode['data'] = {
			label: `${obj.name} : ${cls?.name ?? obj.def.class}`,
			rows: names.map((name) => ({ name, value: String(slots[name]) }))
		};
		nodes.push({
			id: obj.id,
			type: 'object',
			isGroup: false,
			...sizeObject(data),
			ref: { kind: 'object', file: obj.loc.file, path: obj.loc.path },
			data
		});
	}
	const edges: RenderEdge[] = [];
	const key = pairKeys();
	for (const obj of model.objects.values()) {
		obj.def.links?.forEach((link, i) => {
			if (!isObjectLink(link)) return;
			const id = key(obj.id, link.to);
			if (!visible.has(obj.id) || !visible.has(link.to)) return;
			edges.push({
				id,
				source: obj.id,
				target: link.to,
				type: 'link',
				ref: { kind: 'objectLink', file: obj.loc.file, path: [...obj.loc.path, 'links', i] },
				data: { label: link.label, dashed: false, markerStart: 'none', markerEnd: 'none' }
			});
		});
	}
	return {
		kind: 'graph',
		viewId: view.id,
		viewType: 'object',
		title: view.title,
		description: def.description,
		nodes,
		edges,
		diagnostics: [],
		layout: graphLayoutOptions(def, { direction: 'DOWN' })
	};
}
