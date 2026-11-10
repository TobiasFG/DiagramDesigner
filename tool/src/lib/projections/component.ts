import type { LayoutFile } from '../model/schema';
import { isAncestor, visibleAncestor, type Model, type ViewInfo } from '../model/model';
import { select } from '../model/select';
import { sizeBoundary, sizeElement } from '../render/shapes';
import { graphLayoutOptions } from './common';
import type { RenderEdge, RenderGraph, RenderNode } from './types';

/**
 * Component / system views. Visible elements come from include/exclude (or the scope's
 * subtree), limited by depth and collapsed groups. Elements with visible children become
 * boundary groups. Relationships of hidden elements are lifted to their nearest visible
 * ancestor and merged into aggregated edges.
 */
export function projectComponent(model: Model, view: ViewInfo, layout?: LayoutFile): RenderGraph {
	const def = view.def;
	const scope = def.scope ? model.elements.get(def.scope) : undefined;
	const defaults = scope ? [scope.id, ...descendantsOf(model, scope.id)] : model.elements.keys();
	const visible = select(model.elements, def.include, def.exclude, defaults).ids;

	if (def.depth !== undefined) {
		const limit = (scope?.depth ?? 0) + def.depth;
		for (const id of [...visible]) if (model.elements.get(id)!.depth > limit) visible.delete(id);
	}
	if (scope && [...visible].some((id) => id !== scope.id && isAncestor(model, scope.id, id)))
		visible.add(scope.id);
	for (const [id, entry] of Object.entries(layout?.nodes ?? {})) {
		if (entry.collapsed && visible.has(id))
			for (const d of descendantsOf(model, id)) visible.delete(d);
	}

	const viewParent = (id: string) => {
		const parent = model.elements.get(id)!.parentId;
		return parent ? visibleAncestor(model, parent, visible) : undefined;
	};
	const children = new Map<string | undefined, string[]>();
	for (const id of model.elements.keys()) {
		if (!visible.has(id)) continue;
		const p = viewParent(id);
		if (!children.has(p)) children.set(p, []);
		children.get(p)!.push(id);
	}

	const nodes: RenderNode[] = [];
	const addTree = (parentId: string | undefined) => {
		for (const id of children.get(parentId) ?? []) {
			const info = model.elements.get(id)!;
			const ref = { kind: 'element' as const, file: info.loc.file, path: info.loc.path };
			if (children.has(id)) {
				const size = sizeBoundary(info.name);
				nodes.push({
					id,
					type: 'boundary',
					parentId,
					isGroup: true,
					...size,
					ref,
					data: { kind: info.def.kind, label: info.name }
				});
				addTree(id);
			} else {
				const hiddenChildren = info.childIds.length;
				const size = sizeElement({
					kind: info.def.kind,
					label: info.name,
					hiddenChildren
				});
				nodes.push({
					id,
					type: 'element',
					parentId,
					isGroup: false,
					width: size.width,
					height: size.height,
					ref,
					data: {
						kind: info.def.kind,
						label: info.name,
						hiddenChildren
					}
				});
			}
		}
	};
	addTree(undefined);

	const edges: RenderEdge[] = [];
	const direct = new Set<string>();
	const aggregated = new Map<
		string,
		{ source: string; target: string; labels: string[]; count: number; async: number }
	>();
	for (const rel of model.relationships) {
		const { from, to } = rel.def;
		if (!model.elements.has(from) || !model.elements.has(to)) continue;
		const a = visibleAncestor(model, from, visible);
		const b = visibleAncestor(model, to, visible);
		if (!a || !b || a === b) continue;
		if (a === from && b === to) {
			direct.add(`${a}->${b}`);
			edges.push({
				id: rel.key,
				source: a,
				target: b,
				type: 'relationship',
				ref: { kind: 'relationship', file: rel.loc.file, path: rel.loc.path },
				data: {
					label: rel.def.label,
					dashed: rel.def.sync === false,
					markerStart: 'none',
					markerEnd: 'arrow'
				}
			});
		} else if (def.aggregateEdges !== false) {
			const key = `${a}->${b}`;
			const agg = aggregated.get(key) ?? { source: a, target: b, labels: [], count: 0, async: 0 };
			agg.count++;
			if (rel.def.sync === false) agg.async++;
			if (rel.def.label && !agg.labels.includes(rel.def.label)) agg.labels.push(rel.def.label);
			aggregated.set(key, agg);
		}
	}
	for (const [key, agg] of aggregated) {
		if (direct.has(key)) continue;
		const label =
			agg.labels.length > 2 ? `${agg.labels.slice(0, 2).join(', ')}, …` : agg.labels.join(', ');
		edges.push({
			id: `${key}#agg`,
			source: agg.source,
			target: agg.target,
			type: 'aggregated',
			data: {
				label: label || undefined,
				dashed: agg.async === agg.count,
				markerStart: 'none',
				markerEnd: 'arrow',
				count: agg.count
			}
		});
	}

	return {
		kind: 'graph',
		viewId: view.id,
		viewType: 'component',
		title: view.title,
		description: def.description,
		nodes,
		edges,
		diagnostics: [],
		layout: graphLayoutOptions(def, { direction: 'DOWN' })
	};
}

function descendantsOf(model: Model, id: string): string[] {
	const out: string[] = [];
	const walk = (cur: string) => {
		for (const c of model.elements.get(cur)?.childIds ?? []) {
			out.push(c);
			walk(c);
		}
	};
	walk(id);
	return out;
}
