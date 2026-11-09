import type { Attribute, ClassRelation, Method } from '../model/schema';
import type { Model, ViewInfo } from '../model/model';
import { select } from '../model/select';
import { classMetrics, truncateRows } from '../render/shapes';
import { graphLayoutOptions, pairKeys } from './common';
import type { ClassNode, Marker, MemberRow, RenderEdge, RenderGraph } from './types';

export function attributeText(a: Attribute): string {
	const type = a.type ? `: ${a.type}` : '';
	const def = a.default !== undefined ? ` = ${a.default}` : '';
	return `${a.visibility ?? ''}${a.visibility ? ' ' : ''}${a.name}${type}${def}`;
}

export function methodText(m: Method): string {
	const ret = m.returns ? `: ${m.returns}` : '';
	return `${m.visibility ?? ''}${m.visibility ? ' ' : ''}${m.name}(${m.params ?? ''})${ret}`;
}

export const RELATION_STYLE: Record<
	ClassRelation['type'],
	{ dashed: boolean; markerStart: Marker; markerEnd: Marker }
> = {
	inheritance: { dashed: false, markerStart: 'none', markerEnd: 'triangle' },
	realization: { dashed: true, markerStart: 'none', markerEnd: 'triangle' },
	composition: { dashed: false, markerStart: 'diamond-filled', markerEnd: 'none' },
	aggregation: { dashed: false, markerStart: 'diamond', markerEnd: 'none' },
	association: { dashed: false, markerStart: 'none', markerEnd: 'none' },
	dependency: { dashed: true, markerStart: 'none', markerEnd: 'open-arrow' }
};

const HIERARCHY = new Set(['inheritance', 'realization', 'composition', 'aggregation']);

export function projectClass(model: Model, view: ViewInfo): RenderGraph {
	const def = view.def;
	const visible = select(model.classes, def.include, def.exclude, model.classes.keys()).ids;
	const showAttributes = def.show?.attributes !== false;
	const showMethods = def.show?.methods !== false;

	const nodes: ClassNode[] = [];
	for (const cls of model.classes.values()) {
		if (!visible.has(cls.id)) continue;
		const c = cls.def;
		const rows = (items: MemberRow[]) => truncateRows(items);
		const attrs = rows(
			(c.attributes ?? []).map((a, index) => ({ text: attributeText(a), static: a.static, index }))
		);
		const methods = rows(
			(c.methods ?? []).map((m, index) => ({
				text: methodText(m),
				static: m.static,
				abstract: m.abstract,
				index
			}))
		);
		const values = truncateRows(c.values ?? []);
		const data: ClassNode['data'] = {
			classKind: c.kind ?? 'class',
			label: cls.name,
			stereotype: c.stereotype,
			attributes: attrs.rows,
			methods: methods.rows,
			values: values.rows,
			more: { attributes: attrs.more, methods: methods.more, values: values.more },
			showAttributes,
			showMethods
		};
		const m = classMetrics(data);
		nodes.push({
			id: cls.id,
			type: 'class',
			isGroup: false,
			width: m.width,
			height: m.height,
			ref: { kind: 'class', file: cls.loc.file, path: cls.loc.path },
			data
		});
	}

	const edges: RenderEdge[] = [];
	const key = pairKeys();
	let structured = false;
	for (const cls of model.classes.values()) {
		cls.def.relations?.forEach((rel, i) => {
			const id = key(cls.id, rel.to);
			if (!visible.has(cls.id) || !visible.has(rel.to)) return;
			if (HIERARCHY.has(rel.type)) structured = true;
			edges.push({
				id,
				source: cls.id,
				target: rel.to,
				type: 'relation',
				ref: { kind: 'relation', file: cls.loc.file, path: [...cls.loc.path, 'relations', i] },
				data: {
					label: rel.label,
					startLabel: rel.fromMult,
					endLabel: rel.toMult,
					relationType: rel.type,
					...RELATION_STYLE[rel.type]
				}
			});
		});
	}

	return {
		kind: 'graph',
		viewId: view.id,
		viewType: 'class',
		title: view.title,
		description: def.description,
		nodes,
		edges,
		diagnostics: [],
		layout: graphLayoutOptions(def, {
			algorithm: structured || !edges.length ? 'layered' : 'stress',
			direction: 'UP'
		})
	};
}
