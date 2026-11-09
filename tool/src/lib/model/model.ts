import type {
	ClassDef,
	Element,
	Flow,
	GroupStep,
	Interaction,
	LayoutFile,
	MessageStep,
	ObjectDef,
	ObjectLink,
	Pipeline,
	Relationship,
	Step,
	View,
	ViewType
} from './schema';
import type { DataPath, Diagnostic, Severity } from './diagnostics';
import { fileKind } from './parse';
import {
	toDiagnostic,
	validateLayoutFile,
	validateModelFile,
	validateViewFile,
	type IndexedItem
} from './validate-file';
import { select, type Selectable } from './select';

/** Where an entity lives: design-root-relative file and data path inside it. */
export interface Loc {
	file: string;
	path: DataPath;
}

export interface ElementInfo extends Selectable {
	id: string;
	def: Element;
	name: string;
	parentId?: string;
	childIds: string[];
	/** 0 for top-level elements. */
	depth: number;
	loc: Loc;
}

export interface RelationshipInfo {
	def: Relationship;
	loc: Loc;
	/** `<from>-><to>#<index>`, index counts parallel relationships in model order. */
	key: string;
}

export interface EntityInfo<T> extends Selectable {
	id: string;
	def: T;
	name: string;
	loc: Loc;
}

export interface ViewInfo {
	id: string;
	def: View;
	/** Undefined for generated default views. */
	loc?: Loc;
	generated: boolean;
	title: string;
}

export interface LayoutInfo {
	file: string;
	data: LayoutFile;
}

export type GlobalKind = 'element' | 'class' | 'object' | 'flow' | 'pipeline' | 'interaction';

export interface Model {
	elements: Map<string, ElementInfo>;
	rootElementIds: string[];
	relationships: RelationshipInfo[];
	classes: Map<string, EntityInfo<ClassDef>>;
	objects: Map<string, EntityInfo<ObjectDef>>;
	flows: Map<string, EntityInfo<Flow>>;
	pipelines: Map<string, EntityInfo<Pipeline>>;
	interactions: Map<string, EntityInfo<Interaction>>;
	views: Map<string, ViewInfo>;
	layouts: Map<string, LayoutInfo>;
	/** Global id namespace (views have their own). */
	ids: Map<string, { kind: GlobalKind; loc: Loc }>;
	/** Every design file, sorted. */
	files: string[];
	diagnostics: Diagnostic[];
}

export type Locator = (
	file: string,
	path: DataPath,
	key?: string
) => { line: number; col: number } | undefined;

export function layoutFileFor(viewId: string): string {
	return `layout/${viewId}.layout.json`;
}

export function isObjectLink(link: unknown): link is ObjectLink {
	return typeof link === 'object' && link !== null && 'to' in link;
}

export function isGroupStep(step: Step): step is GroupStep {
	return 'group' in step;
}

export function isMessageStep(step: Step): step is MessageStep {
	return 'from' in step;
}

/** Visits every step (depth first, in order) with its data path relative to the interaction. */
export function walkSteps(
	steps: Step[],
	visit: (step: Step, path: DataPath) => void,
	base: DataPath = ['steps']
): void {
	steps.forEach((step, i) => {
		const path = [...base, i];
		visit(step, path);
		if (isGroupStep(step)) {
			walkSteps(step.steps, visit, [...path, 'steps']);
			step.else?.forEach((branch, j) =>
				walkSteps(branch.steps, visit, [...path, 'else', j, 'steps'])
			);
		}
	});
}

/**
 * Builds the resolved model from parsed file data (keyed by design-relative path) and runs
 * schema and reference validation. Never throws on invalid input.
 */
export function buildModel(files: Record<string, unknown>, locate?: Locator): Model {
	const model: Model = {
		elements: new Map(),
		rootElementIds: [],
		relationships: [],
		classes: new Map(),
		objects: new Map(),
		flows: new Map(),
		pipelines: new Map(),
		interactions: new Map(),
		views: new Map(),
		layouts: new Map(),
		ids: new Map(),
		files: Object.keys(files).sort(),
		diagnostics: []
	};
	const diag = (severity: Severity, code: string, message: string, loc?: Loc, key?: string) => {
		const pos = loc ? locate?.(loc.file, loc.path, key) : undefined;
		model.diagnostics.push({
			severity,
			code,
			message,
			file: loc?.file,
			line: pos?.line,
			col: pos?.col,
			path: loc?.path
		});
	};
	const at = (loc: Loc, ...rest: DataPath): Loc => ({
		file: loc.file,
		path: [...loc.path, ...rest]
	});
	const where = (loc: Loc) => {
		const pos = locate?.(loc.file, loc.path);
		return pos ? `${loc.file}:${pos.line}:${pos.col}` : loc.file;
	};

	const claim = (id: string, kind: GlobalKind, loc: Loc): boolean => {
		const prev = model.ids.get(id);
		if (prev) {
			diag(
				'error',
				'duplicate-id',
				`duplicate id "${id}" (also defined at ${where(prev.loc)})`,
				loc,
				'id'
			);
			return false;
		}
		model.ids.set(id, { kind, loc });
		return true;
	};

	const viewItems: { file: string; item: IndexedItem<View> }[] = [];

	for (const file of model.files) {
		const kind = fileKind(file);
		const data = files[file];
		if (!kind || data === undefined) continue; // syntax errors are reported by the parser
		const fileLocate = (path: DataPath, key?: string) => locate?.(file, path, key);
		if (kind === 'model') {
			const res = validateModelFile(data);
			for (const issue of res.issues) model.diagnostics.push(toDiagnostic(file, issue, fileLocate));
			const s = res.sections;
			const addElement = (
				def: Element,
				path: DataPath,
				parentId: string | undefined,
				depth: number
			) => {
				const loc = { file, path };
				if (!claim(def.id, 'element', loc)) return;
				const info: ElementInfo = {
					id: def.id,
					def,
					name: def.name ?? def.id,
					tags: def.tags,
					parentId,
					childIds: [],
					depth,
					loc
				};
				model.elements.set(def.id, info);
				if (parentId) model.elements.get(parentId)!.childIds.push(def.id);
				else model.rootElementIds.push(def.id);
				def.children?.forEach((child, i) =>
					addElement(child, [...path, 'children', i], def.id, depth + 1)
				);
			};
			for (const { index, value } of s.elements ?? [])
				addElement(value as Element, ['elements', index], undefined, 0);
			for (const { index, value } of s.relationships ?? []) {
				model.relationships.push({
					def: value as Relationship,
					loc: { file, path: ['relationships', index] },
					key: ''
				});
			}
			const addEntity = <T extends { id: string; name?: string; tags?: string[] }>(
				items: IndexedItem[] | undefined,
				section: string,
				kind: GlobalKind,
				map: Map<string, EntityInfo<T>>
			) => {
				for (const { index, value } of items ?? []) {
					const def = value as T;
					const loc = { file, path: [section, index] };
					if (!claim(def.id, kind, loc)) continue;
					map.set(def.id, { id: def.id, def, name: def.name ?? def.id, tags: def.tags, loc });
				}
			};
			addEntity(s.classes, 'classes', 'class', model.classes);
			addEntity(s.objects, 'objects', 'object', model.objects);
			addEntity(s.flows, 'flows', 'flow', model.flows);
			addEntity(s.pipelines, 'pipelines', 'pipeline', model.pipelines);
			addEntity(s.interactions, 'interactions', 'interaction', model.interactions);
		} else if (kind === 'view') {
			const res = validateViewFile(data);
			for (const issue of res.issues) model.diagnostics.push(toDiagnostic(file, issue, fileLocate));
			for (const item of res.views) viewItems.push({ file, item });
		} else {
			const res = validateLayoutFile(data);
			for (const issue of res.issues) model.diagnostics.push(toDiagnostic(file, issue, fileLocate));
			if (!res.value) continue;
			const expected = layoutFileFor(res.value.view);
			if (file !== expected) {
				diag(
					'warning',
					'layout-file-name',
					`layout for view "${res.value.view}" should be named ${expected}`,
					{ file, path: ['view'] }
				);
			}
			model.layouts.set(res.value.view, { file, data: res.value });
		}
	}

	// ------------------------------------------------------------ relationships
	const pairCount = new Map<string, number>();
	for (const rel of model.relationships) {
		const pair = `${rel.def.from}->${rel.def.to}`;
		const n = pairCount.get(pair) ?? 0;
		pairCount.set(pair, n + 1);
		rel.key = `${pair}#${n}`;
		for (const end of ['from', 'to'] as const) {
			if (!model.elements.has(rel.def[end])) {
				diag(
					'error',
					'dangling-ref',
					`relationship ${end} "${rel.def[end]}" is not an element`,
					at(rel.loc, end)
				);
			}
		}
	}

	// ------------------------------------------------------------ classes
	for (const cls of model.classes.values()) {
		cls.def.relations?.forEach((rel, i) => {
			if (!model.classes.has(rel.to)) {
				diag(
					'error',
					'dangling-ref',
					`class "${cls.id}" relation to "${rel.to}" is not a class`,
					at(cls.loc, 'relations', i, 'to')
				);
			}
		});
		if (cls.def.componentOf && !model.elements.has(cls.def.componentOf)) {
			diag(
				'error',
				'dangling-ref',
				`class "${cls.id}" componentOf "${cls.def.componentOf}" is not an element`,
				at(cls.loc, 'componentOf')
			);
		}
		if (cls.def.values?.length && cls.def.kind !== 'enum') {
			diag(
				'warning',
				'enum-values',
				`class "${cls.id}" has values but is not an enum`,
				at(cls.loc, 'values')
			);
		}
	}

	// ------------------------------------------------------------ objects
	for (const obj of model.objects.values()) {
		const cls = model.classes.get(obj.def.class);
		if (!cls) {
			diag(
				'error',
				'dangling-ref',
				`object "${obj.id}" class "${obj.def.class}" is not a class`,
				at(obj.loc, 'class')
			);
		} else if (obj.def.slots) {
			const attrs = new Set(allAttributes(model, cls.id).map((a) => a.name));
			for (const slot of Object.keys(obj.def.slots)) {
				if (!attrs.has(slot)) {
					diag(
						'warning',
						'unknown-slot',
						`object "${obj.id}" slot "${slot}" is not an attribute of class "${cls.id}"`,
						at(obj.loc, 'slots'),
						slot
					);
				}
			}
		}
		obj.def.links?.forEach((link, i) => {
			if (isObjectLink(link) && !model.objects.has(link.to)) {
				diag(
					'error',
					'dangling-ref',
					`object "${obj.id}" link to "${link.to}" is not an object`,
					at(obj.loc, 'links', i, 'to')
				);
			}
		});
	}

	// ------------------------------------------------------------ flows
	for (const flow of model.flows.values()) {
		const nodeIds = new Set<string>();
		flow.def.nodes.forEach((node, i) => {
			if (nodeIds.has(node.id))
				diag(
					'error',
					'duplicate-id',
					`duplicate node id "${node.id}" in flow "${flow.id}"`,
					at(flow.loc, 'nodes', i, 'id')
				);
			nodeIds.add(node.id);
			if (node.type === 'subflow') {
				if (!node.ref)
					diag(
						'warning',
						'subflow-ref',
						`subflow node "${node.id}" has no ref`,
						at(flow.loc, 'nodes', i)
					);
				else if (!model.flows.has(node.ref))
					diag(
						'error',
						'dangling-ref',
						`subflow "${node.id}" ref "${node.ref}" is not a flow`,
						at(flow.loc, 'nodes', i, 'ref')
					);
			}
			if (node.actor && !model.elements.has(node.actor)) {
				diag(
					'warning',
					'dangling-ref',
					`flow node "${node.id}" actor "${node.actor}" is not an element`,
					at(flow.loc, 'nodes', i, 'actor')
				);
			}
		});
		flow.def.transitions?.forEach((t, i) => {
			for (const end of ['from', 'to'] as const) {
				if (!nodeIds.has(t[end]))
					diag(
						'error',
						'dangling-ref',
						`transition ${end} "${t[end]}" is not a node of flow "${flow.id}"`,
						at(flow.loc, 'transitions', i, end)
					);
			}
		});
		if (!flow.def.nodes.some((n) => n.type === 'start'))
			diag('warning', 'flow-start', `flow "${flow.id}" has no start node`, at(flow.loc, 'nodes'));
		if (!flow.def.nodes.some((n) => n.type === 'end'))
			diag('warning', 'flow-end', `flow "${flow.id}" has no end node`, at(flow.loc, 'nodes'));
	}

	// ------------------------------------------------------------ pipelines
	for (const pipe of model.pipelines.values()) {
		const seen = new Map<string, string>();
		const jobs = new Map<string, { needs: string[]; loc: Loc }>();
		const stages = new Map<string, { needs: string[]; loc: Loc }>();
		const own = (id: string, what: string, loc: Loc) => {
			if (seen.has(id))
				diag(
					'error',
					'duplicate-id',
					`duplicate id "${id}" in pipeline "${pipe.id}" (${seen.get(id)} and ${what})`,
					loc,
					'id'
				);
			seen.set(id, what);
		};
		pipe.def.stages.forEach((stage, i) => {
			const sloc = at(pipe.loc, 'stages', i);
			own(stage.id, 'stage', sloc);
			stages.set(stage.id, { needs: stage.needs ?? [], loc: sloc });
			stage.jobs.forEach((job, j) => {
				const jloc = at(sloc, 'jobs', j);
				own(job.id, 'job', jloc);
				jobs.set(job.id, { needs: job.needs ?? [], loc: jloc });
			});
		});
		pipe.def.artifacts?.forEach((art, i) => {
			const aloc = at(pipe.loc, 'artifacts', i);
			own(art.id, 'artifact', aloc);
			if (art.producedBy && !jobs.has(art.producedBy))
				diag(
					'error',
					'dangling-ref',
					`artifact "${art.id}" producedBy "${art.producedBy}" is not a job`,
					at(aloc, 'producedBy')
				);
			art.consumedBy?.forEach((c, k) => {
				if (!jobs.has(c))
					diag(
						'error',
						'dangling-ref',
						`artifact "${art.id}" consumedBy "${c}" is not a job`,
						at(aloc, 'consumedBy', k)
					);
			});
		});
		for (const [label, graph] of [
			['stage', stages],
			['job', jobs]
		] as const) {
			for (const [id, node] of graph) {
				node.needs.forEach((n, k) => {
					if (!graph.has(n))
						diag(
							'error',
							'dangling-ref',
							`${label} "${id}" needs "${n}" which is not a ${label} of pipeline "${pipe.id}"`,
							at(node.loc, 'needs', k)
						);
				});
			}
			const cycle = findCycle(new Map([...graph].map(([id, n]) => [id, n.needs])));
			if (cycle)
				diag(
					'error',
					'needs-cycle',
					`cycle in ${label} needs: ${cycle.join(' -> ')}`,
					graph.get(cycle[0])!.loc
				);
		}
	}

	// ------------------------------------------------------------ interactions
	for (const inter of model.interactions.values()) {
		const parts = new Set<string>();
		inter.def.participants.forEach((p, i) => {
			if (parts.has(p))
				diag(
					'error',
					'duplicate-id',
					`participant "${p}" listed twice`,
					at(inter.loc, 'participants', i)
				);
			parts.add(p);
			if (!model.elements.has(p))
				diag(
					'warning',
					'plain-participant',
					`participant "${p}" is not an element; rendered as a plain box`,
					at(inter.loc, 'participants', i)
				);
		});
		const active = new Map<string, { from: string; loc: Loc }[]>();
		walkSteps(inter.def.steps, (step, path) => {
			const sloc = at(inter.loc, ...path);
			if (isMessageStep(step)) {
				for (const end of ['from', 'to'] as const) {
					if (!parts.has(step[end]))
						diag(
							'error',
							'dangling-ref',
							`message ${end} "${step[end]}" is not a participant of "${inter.id}"`,
							at(sloc, end)
						);
				}
				if (step.kind === 'return') {
					const stack = active.get(step.from);
					const top = stack?.[stack.length - 1];
					if (top && top.from === step.to) stack!.pop();
				}
				if (step.activate) {
					if (!active.has(step.to)) active.set(step.to, []);
					active.get(step.to)!.push({ from: step.from, loc: sloc });
				}
			} else if (!isGroupStep(step)) {
				const over = Array.isArray(step.over) ? step.over : [step.over];
				for (const p of over)
					if (!parts.has(p))
						diag(
							'error',
							'dangling-ref',
							`note over "${p}" is not a participant of "${inter.id}"`,
							at(sloc, 'over')
						);
			}
		});
		for (const [p, stack] of active) {
			for (const a of stack)
				diag(
					'warning',
					'unbalanced-activation',
					`activation of "${p}" has no matching return to "${a.from}"`,
					a.loc
				);
		}
	}

	// ------------------------------------------------------------ views
	for (const { file, item } of viewItems) {
		const def = item.value;
		const loc = { file, path: ['views', item.index] };
		const prev = model.views.get(def.id);
		if (prev) {
			diag(
				'error',
				'duplicate-id',
				`duplicate view id "${def.id}" (also defined at ${where(prev.loc!)})`,
				loc,
				'id'
			);
			continue;
		}
		model.views.set(def.id, { id: def.id, def, loc, generated: false, title: def.title ?? def.id });
		checkView(model, def, loc, diag);
	}
	const sourced: [ViewType, Map<string, EntityInfo<{ id: string }>>][] = [
		['flow', model.flows],
		['pipeline', model.pipelines],
		['sequence', model.interactions]
	];
	for (const [type, map] of sourced) {
		for (const entity of map.values()) {
			const covered = [...model.views.values()].some(
				(v) => v.def.type === type && v.def.source === entity.id
			);
			if (covered) continue;
			const id = model.views.has(entity.id) ? `${entity.id}-${type}` : entity.id;
			if (model.views.has(id)) continue;
			model.views.set(id, {
				id,
				def: { id, type, source: entity.id, title: entity.name },
				generated: true,
				title: entity.name
			});
		}
	}
	for (const [viewId, layout] of model.layouts) {
		if (!model.views.has(viewId))
			diag('warning', 'orphan-layout', `layout for unknown view "${viewId}"`, {
				file: layout.file,
				path: ['view']
			});
	}
	return model;
}

function checkView(
	model: Model,
	def: View,
	loc: Loc,
	diag: (s: Severity, code: string, msg: string, loc?: Loc, key?: string) => void
) {
	const at = (...rest: DataPath) => ({ file: loc.file, path: [...loc.path, ...rest] });
	const sources: Partial<Record<ViewType, Map<string, unknown>>> = {
		flow: model.flows,
		pipeline: model.pipelines,
		sequence: model.interactions
	};
	const sourceMap = sources[def.type];
	if (sourceMap) {
		if (!def.source)
			diag(
				'error',
				'view-source',
				`view "${def.id}" of type ${def.type} needs a source`,
				loc,
				'id'
			);
		else if (!sourceMap.has(def.source))
			diag(
				'error',
				'dangling-ref',
				`view "${def.id}" source "${def.source}" is not ${def.type === 'sequence' ? 'an interaction' : `a ${def.type}`}`,
				at('source')
			);
		return;
	}
	if (def.scope && !model.elements.has(def.scope))
		diag(
			'error',
			'dangling-ref',
			`view "${def.id}" scope "${def.scope}" is not an element`,
			at('scope')
		);
	const items: Map<string, Selectable> =
		def.type === 'component'
			? model.elements
			: def.type === 'class'
				? model.classes
				: model.objects;
	const sel = select(items, def.include, def.exclude, []);
	for (const p of sel.unmatched) {
		const inInclude = def.include?.includes(p);
		const idx = (inInclude ? def.include! : def.exclude!).indexOf(p);
		diag(
			'warning',
			'unmatched-pattern',
			`view "${def.id}" pattern "${p}" matches nothing`,
			at(inInclude ? 'include' : 'exclude', idx)
		);
	}
}

/** Returns one cycle in a dependency graph (id -> needs), or undefined. */
export function findCycle(graph: Map<string, string[]>): string[] | undefined {
	const state = new Map<string, 'visiting' | 'done'>();
	const stack: string[] = [];
	const visit = (id: string): string[] | undefined => {
		if (state.get(id) === 'done') return;
		if (state.get(id) === 'visiting') return [...stack.slice(stack.indexOf(id)), id];
		state.set(id, 'visiting');
		stack.push(id);
		for (const next of graph.get(id) ?? []) {
			if (!graph.has(next)) continue;
			const c = visit(next);
			if (c) return c;
		}
		stack.pop();
		state.set(id, 'done');
	};
	for (const id of [...graph.keys()].sort()) {
		const c = visit(id);
		if (c) return c;
	}
	return undefined;
}

/** Attributes of a class including inherited ones (inheritance/realization). */
export function allAttributes(
	model: Model,
	classId: string,
	seen = new Set<string>()
): { name: string }[] {
	if (seen.has(classId)) return [];
	seen.add(classId);
	const cls = model.classes.get(classId);
	if (!cls) return [];
	const own = cls.def.attributes ?? [];
	const inherited = (cls.def.relations ?? [])
		.filter((r) => r.type === 'inheritance' || r.type === 'realization')
		.flatMap((r) => allAttributes(model, r.to, seen));
	return [...own, ...inherited];
}

/** Id of the nearest ancestor-or-self of `id` contained in `visible`. */
export function visibleAncestor(
	model: Model,
	id: string,
	visible: Set<string>
): string | undefined {
	let cur: string | undefined = id;
	while (cur) {
		if (visible.has(cur)) return cur;
		cur = model.elements.get(cur)?.parentId;
	}
	return undefined;
}

export function isAncestor(model: Model, ancestor: string, id: string): boolean {
	let cur = model.elements.get(id)?.parentId;
	while (cur) {
		if (cur === ancestor) return true;
		cur = model.elements.get(cur)?.parentId;
	}
	return false;
}
