import type { Draft } from 'immer';
import { isAncestor, type Loc } from '../model/model';
import { select, type Selectable } from '../model/select';
import type {
	Attribute,
	ClassDef,
	ClassRelation,
	Element,
	Flow,
	FlowNode,
	Job,
	Method,
	ObjectDef,
	Pipeline,
	Relationship,
	Stage,
	Transition,
	View
} from '../model/schema';
import type { EntityRef } from '../projections/types';
import {
	assertId,
	fail,
	fileRoot,
	getAt,
	layoutDraft,
	listIn,
	removeAt,
	snap,
	uniqueId,
	viewDraft,
	type Command,
	type CommandContext,
	type DesignData
} from './core';
import { knownLayoutIds } from '../projections';

type Obj = Record<string, unknown>;

// ------------------------------------------------------------------ generic entity edits

/** Sets (or, for undefined/empty values, removes) fields of the entity at `ref`. */
export function patchEntity(ref: EntityRef, fields: Obj, label = 'Edit'): Command {
	return {
		label: `${label} ${ref.kind}`,
		run(draft) {
			const obj = getAt<Obj>(draft, ref.file, ref.path);
			for (const [k, v] of Object.entries(fields)) {
				if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) delete obj[k];
				else obj[k] = v;
			}
		}
	};
}

/** Replaces the entity at `ref` (properties panel form or raw YAML). */
export function setEntity(ref: EntityRef, value: unknown): Command {
	return {
		label: `Edit ${ref.kind}`,
		run(draft) {
			const parent = getAt<Obj>(draft, ref.file, ref.path.slice(0, -1));
			parent[ref.path[ref.path.length - 1] as string] = value;
		}
	};
}

const LABEL_KEY: Partial<Record<EntityRef['kind'], string>> = {
	relationship: 'label',
	relation: 'label',
	objectLink: 'label',
	transition: 'label',
	message: 'msg',
	note: 'note',
	group: 'label'
};

/** Inline rename: `name` for entities, the label for links and messages. */
export function renameEntity(ref: EntityRef, text: string): Command {
	const key = LABEL_KEY[ref.kind] ?? 'name';
	return patchEntity(ref, { [key]: text.trim() || undefined }, 'Rename');
}

// ------------------------------------------------------------------ helpers

function pin(
	draft: Draft<DesignData>,
	ctx: CommandContext,
	viewId: string | undefined,
	id: string,
	pos?: { x: number; y: number }
) {
	if (!viewId || !pos) return;
	const layout = layoutDraft(draft, ctx, viewId, knownLayoutIds(ctx.model, viewId));
	layout.nodes![id] = {
		x: snap(pos.x, ctx.config.snapGrid),
		y: snap(pos.y, ctx.config.snapGrid),
		pinned: true
	};
}

/** Adds `id` to a view's include list when the list would not already select it. */
function ensureIncluded(
	draft: Draft<DesignData>,
	ctx: CommandContext,
	viewId: string | undefined,
	items: Map<string, Selectable>,
	id: string
) {
	const view = viewId ? ctx.model.views.get(viewId) : undefined;
	if (!view || !view.def.include) return;
	if (select(items, view.def.include, view.def.exclude, []).ids.has(id)) return;
	const def = viewDraft(draft, ctx, view.id);
	(def.include ??= []).push(id);
}

function firstFileOf(map: Map<string, { loc: Loc }>, fallback: string): string {
	return map.values().next().value?.loc.file ?? fallback;
}

// ------------------------------------------------------------------ elements

const KIND_NAMES: Record<Element['kind'], string> = {
	person: 'Person',
	system: 'System',
	container: 'Container',
	component: 'Component',
	external: 'External System',
	datastore: 'Database',
	queue: 'Queue'
};

export function addElement(opts: {
	kind: Element['kind'];
	parentId?: string;
	viewId?: string;
	position?: { x: number; y: number };
	name?: string;
	id?: string;
}): Command {
	return {
		label: `Add ${opts.kind}`,
		run(draft, ctx) {
			const m = ctx.model;
			const name = opts.name ?? `New ${KIND_NAMES[opts.kind]}`;
			const id = opts.id ?? uniqueId(name, (x) => m.ids.has(x));
			if (opts.id) {
				assertId(id);
				if (m.ids.has(id)) fail(`id "${id}" is already used`);
			}
			const element: Element = { id, kind: opts.kind, name };
			if (opts.parentId) {
				const parent = m.elements.get(opts.parentId) ?? fail(`unknown element "${opts.parentId}"`);
				listIn(getAt(draft, parent.loc.file, parent.loc.path), 'children').push(element);
			} else listIn(fileRoot(draft, ctx.config.defaultModelFile), 'elements').push(element);
			const items = new Map<string, Selectable>(m.elements);
			items.set(id, { id, parentId: opts.parentId, childIds: [] });
			if (opts.parentId)
				items.set(opts.parentId, {
					...m.elements.get(opts.parentId)!,
					childIds: [...m.elements.get(opts.parentId)!.childIds, id]
				});
			ensureIncluded(draft, ctx, opts.viewId, items, id);
			pin(draft, ctx, opts.viewId, id, opts.position);
		}
	};
}

export function addRelationship(
	from: string,
	to: string,
	fields: Partial<Relationship> = {}
): Command {
	return {
		label: `Connect ${from} → ${to}`,
		run(draft, ctx) {
			const src = ctx.model.elements.get(from) ?? fail(`unknown element "${from}"`);
			if (!ctx.model.elements.has(to)) fail(`unknown element "${to}"`);
			if (from === to) fail('a relationship needs two different elements');
			listIn(fileRoot(draft, src.loc.file), 'relationships').push({ from, to, ...fields });
		}
	};
}

/** Moves an element into another parent (or to the top level) and pins it at `position`. */
export function reparentElement(
	id: string,
	newParent: string | undefined,
	viewId?: string,
	position?: { x: number; y: number }
): Command {
	return {
		label: newParent ? `Move ${id} into ${newParent}` : `Move ${id} out of its group`,
		run(draft, ctx) {
			const m = ctx.model;
			const info = m.elements.get(id) ?? fail(`unknown element "${id}"`);
			if (newParent && (newParent === id || isAncestor(m, id, newParent)))
				fail(`cannot move "${id}" into itself`);
			// Resolve the target before removing: drafts keep identity while indices shift.
			const target = newParent
				? listIn<Draft<Element>>(
						getAt(draft, m.elements.get(newParent)!.loc.file, m.elements.get(newParent)!.loc.path),
						'children'
					)
				: listIn<Draft<Element>>(fileRoot(draft, info.loc.file), 'elements');
			const oldParentObj = info.parentId
				? getAt<Obj>(
						draft,
						m.elements.get(info.parentId)!.loc.file,
						m.elements.get(info.parentId)!.loc.path
					)
				: undefined;
			const el = removeAt(draft, info.loc.file, info.loc.path) as Draft<Element>;
			target.push(el);
			if (oldParentObj && Array.isArray(oldParentObj.children) && !oldParentObj.children.length)
				delete oldParentObj.children;
			const items = new Map<string, Selectable>(m.elements);
			items.set(id, { ...info, parentId: newParent });
			if (newParent)
				items.set(newParent, {
					...m.elements.get(newParent)!,
					childIds: [...m.elements.get(newParent)!.childIds, id]
				});
			ensureIncluded(draft, ctx, viewId, items, id);
			pin(draft, ctx, viewId, id, position);
		}
	};
}

// ------------------------------------------------------------------ classes

export function addClass(opts: {
	kind?: ClassDef['kind'];
	name?: string;
	viewId?: string;
	position?: { x: number; y: number };
}): Command {
	const kind = opts.kind ?? 'class';
	return {
		label: `Add ${kind}`,
		run(draft, ctx) {
			const m = ctx.model;
			const name =
				opts.name ??
				{
					class: 'NewClass',
					interface: 'NewInterface',
					abstract: 'NewAbstractClass',
					enum: 'NewEnum'
				}[kind];
			const id = uniqueId(name.replace(/([a-z])([A-Z])/g, '$1-$2'), (x) => m.ids.has(x));
			const cls: ClassDef = { id, name, ...(kind !== 'class' ? { kind } : {}) };
			listIn(fileRoot(draft, firstFileOf(m.classes, ctx.config.defaultModelFile)), 'classes').push(
				cls
			);
			const items = new Map<string, Selectable>(m.classes);
			items.set(id, { id });
			ensureIncluded(draft, ctx, opts.viewId, items, id);
			pin(draft, ctx, opts.viewId, id, opts.position);
		}
	};
}

export type MemberList = 'attributes' | 'methods' | 'values';

function classDraft(draft: Draft<DesignData>, ctx: CommandContext, classId: string): Obj {
	const cls = ctx.model.classes.get(classId) ?? fail(`unknown class "${classId}"`);
	return getAt<Obj>(draft, cls.loc.file, cls.loc.path);
}

export function addMember(
	classId: string,
	list: MemberList,
	item: Attribute | Method | string,
	index?: number
): Command {
	return {
		label: `Add ${list === 'values' ? 'value' : list.slice(0, -1)} to ${classId}`,
		run(draft, ctx) {
			const arr = listIn(classDraft(draft, ctx, classId), list);
			arr.splice(index ?? arr.length, 0, item);
		}
	};
}

export function updateMember(
	classId: string,
	list: MemberList,
	index: number,
	item: Attribute | Method | string
): Command {
	return {
		label: `Edit ${classId} ${list}`,
		run(draft, ctx) {
			const arr = listIn(classDraft(draft, ctx, classId), list);
			if (index < 0 || index >= arr.length) fail(`no ${list} row ${index}`);
			arr[index] = item;
		}
	};
}

export function removeMember(classId: string, list: MemberList, index: number): Command {
	return {
		label: `Remove from ${classId} ${list}`,
		run(draft, ctx) {
			const cls = classDraft(draft, ctx, classId);
			const arr = listIn(cls, list);
			arr.splice(index, 1);
			if (!arr.length) delete cls[list];
		}
	};
}

export function moveMember(classId: string, list: MemberList, from: number, to: number): Command {
	return {
		label: `Reorder ${classId} ${list}`,
		run(draft, ctx) {
			const arr = listIn(classDraft(draft, ctx, classId), list);
			if (to < 0 || to >= arr.length) fail('cannot move past the end');
			const [item] = arr.splice(from, 1);
			arr.splice(to, 0, item);
		}
	};
}

const VIS = '([+\\-#~])?\\s*';

/** Parses "+ name: Type = default" into an attribute. */
export function parseAttribute(text: string): Attribute {
	const m = new RegExp(`^${VIS}([^:=]+?)\\s*(?::\\s*([^=]+?))?\\s*(?:=\\s*(.+?))?\\s*$`).exec(
		text.trim()
	);
	if (!m || !m[2]) fail(`cannot read attribute "${text}"; use "+ name: Type"`);
	const a: Attribute = { name: m[2] };
	if (m[3]) a.type = m[3];
	if (m[1]) a.visibility = m[1] as Attribute['visibility'];
	if (m[4]) a.default = m[4];
	return a;
}

/** Parses "+ name(params): Returns" into a method. */
export function parseMethod(text: string): Method {
	const m = new RegExp(`^${VIS}([^(\\s]+)\\s*\\((.*)\\)\\s*(?::\\s*(.+?))?\\s*$`).exec(text.trim());
	if (!m) fail(`cannot read method "${text}"; use "+ name(params): Returns"`);
	const out: Method = { name: m[2] };
	if (m[3]) out.params = m[3];
	if (m[4]) out.returns = m[4];
	if (m[1]) out.visibility = m[1] as Method['visibility'];
	return out;
}

export function addClassRelation(from: string, to: string, type: ClassRelation['type']): Command {
	return {
		label: `Add ${type} ${from} → ${to}`,
		run(draft, ctx) {
			if (!ctx.model.classes.has(to)) fail(`unknown class "${to}"`);
			listIn(classDraft(draft, ctx, from), 'relations').push({ type, to });
		}
	};
}

// ------------------------------------------------------------------ objects

export function addObject(
	classId: string,
	viewId?: string,
	position?: { x: number; y: number }
): Command {
	return {
		label: `Add ${classId} object`,
		run(draft, ctx) {
			const m = ctx.model;
			if (!m.classes.has(classId)) fail(`unknown class "${classId}"`);
			const id = uniqueId(`${classId}-1`, (x) => m.ids.has(x));
			const obj: ObjectDef = { id, class: classId };
			listIn(
				fileRoot(
					draft,
					firstFileOf(m.objects, firstFileOf(m.classes, ctx.config.defaultModelFile))
				),
				'objects'
			).push(obj);
			const items = new Map<string, Selectable>(m.objects);
			items.set(id, { id });
			ensureIncluded(draft, ctx, viewId, items, id);
			pin(draft, ctx, viewId, id, position);
		}
	};
}

function objectDraft(draft: Draft<DesignData>, ctx: CommandContext, id: string): Obj {
	const obj = ctx.model.objects.get(id) ?? fail(`unknown object "${id}"`);
	return getAt<Obj>(draft, obj.loc.file, obj.loc.path);
}

export function setSlot(objectId: string, name: string, value: string | undefined): Command {
	return {
		label: `Set ${objectId}.${name}`,
		run(draft, ctx) {
			const obj = objectDraft(draft, ctx, objectId);
			const slots = (obj.slots ??= {}) as Obj;
			if (value === undefined) delete slots[name];
			else slots[name] = value;
			if (!Object.keys(slots).length) delete obj.slots;
		}
	};
}

export function addObjectLink(from: string, to: string, label?: string): Command {
	return {
		label: `Link ${from} → ${to}`,
		run(draft, ctx) {
			if (!ctx.model.objects.has(to)) fail(`unknown object "${to}"`);
			listIn(objectDraft(draft, ctx, from), 'links').push(label ? { to, label } : { to });
		}
	};
}

// ------------------------------------------------------------------ flows

function flowDraft(draft: Draft<DesignData>, ctx: CommandContext, flowId: string): Draft<Flow> {
	const flow = ctx.model.flows.get(flowId) ?? fail(`unknown flow "${flowId}"`);
	return getAt<Draft<Flow>>(draft, flow.loc.file, flow.loc.path);
}

const FLOW_NAMES: Partial<Record<FlowNode['type'], string>> = {
	action: 'New action',
	decision: 'Decision?',
	io: 'Input / output',
	subflow: 'Subflow'
};

export function addFlowNode(
	flowId: string,
	type: FlowNode['type'],
	opts: { viewId?: string; position?: { x: number; y: number }; actor?: string } = {}
): Command {
	return {
		label: `Add ${type} node`,
		run(draft, ctx) {
			const flow = flowDraft(draft, ctx, flowId);
			const id = uniqueId(type, (x) => flow.nodes.some((n) => n.id === x));
			const node: FlowNode = { id, type };
			if (FLOW_NAMES[type]) node.name = FLOW_NAMES[type];
			if (opts.actor) node.actor = opts.actor;
			flow.nodes.push(node);
			pin(draft, ctx, opts.viewId, id, opts.position);
		}
	};
}

export function addTransition(flowId: string, from: string, to: string, label?: string): Command {
	return {
		label: `Connect ${from} → ${to}`,
		run(draft, ctx) {
			const flow = flowDraft(draft, ctx, flowId);
			for (const id of [from, to])
				if (!flow.nodes.some((n) => n.id === id)) fail(`unknown node "${id}"`);
			const t: Transition = { from, to };
			if (label) t.label = label;
			(flow.transitions ??= []).push(t);
		}
	};
}

/** Dropping a node into another swimlane changes its actor. */
export function setFlowNodeActor(
	flowId: string,
	nodeId: string,
	actor: string | undefined,
	viewId?: string,
	position?: { x: number; y: number }
): Command {
	return {
		label: `Move ${nodeId} to lane ${actor ?? '(unassigned)'}`,
		run(draft, ctx) {
			const node =
				flowDraft(draft, ctx, flowId).nodes.find((n) => n.id === nodeId) ??
				fail(`unknown node "${nodeId}"`);
			if (actor) node.actor = actor;
			else delete node.actor;
			pin(draft, ctx, viewId, nodeId, position);
		}
	};
}

// ------------------------------------------------------------------ pipelines

function pipelineDraft(draft: Draft<DesignData>, ctx: CommandContext, id: string): Draft<Pipeline> {
	const p = ctx.model.pipelines.get(id) ?? fail(`unknown pipeline "${id}"`);
	return getAt<Draft<Pipeline>>(draft, p.loc.file, p.loc.path);
}

function pipelineIds(p: Draft<Pipeline>): Set<string> {
	return new Set([
		...p.stages.flatMap((s) => [s.id, ...s.jobs.map((j) => j.id)]),
		...(p.artifacts ?? []).map((a) => a.id)
	]);
}

export function addStage(
	pipelineId: string,
	opts: { viewId?: string; position?: { x: number; y: number } } = {}
): Command {
	return {
		label: 'Add stage',
		run(draft, ctx) {
			const p = pipelineDraft(draft, ctx, pipelineId);
			const taken = pipelineIds(p);
			const id = uniqueId('stage', (x) => taken.has(x));
			const last = p.stages[p.stages.length - 1];
			const stage: Stage = { id, jobs: [] };
			if (last) stage.needs = [last.id];
			p.stages.push(stage);
			pin(draft, ctx, opts.viewId, id, opts.position);
		}
	};
}

export function addJob(
	pipelineId: string,
	stageId: string,
	opts: { viewId?: string; position?: { x: number; y: number } } = {}
): Command {
	return {
		label: `Add job to ${stageId}`,
		run(draft, ctx) {
			const p = pipelineDraft(draft, ctx, pipelineId);
			const stage = p.stages.find((s) => s.id === stageId) ?? fail(`unknown stage "${stageId}"`);
			const taken = pipelineIds(p);
			const id = uniqueId('job', (x) => taken.has(x));
			stage.jobs.push({ id } satisfies Job);
			pin(draft, ctx, opts.viewId, id, opts.position);
		}
	};
}

export function moveJob(
	pipelineId: string,
	jobId: string,
	toStage: string,
	viewId?: string,
	position?: { x: number; y: number }
): Command {
	return {
		label: `Move ${jobId} to ${toStage}`,
		run(draft, ctx) {
			const p = pipelineDraft(draft, ctx, pipelineId);
			const from =
				p.stages.find((s) => s.jobs.some((j) => j.id === jobId)) ?? fail(`unknown job "${jobId}"`);
			const to = p.stages.find((s) => s.id === toStage) ?? fail(`unknown stage "${toStage}"`);
			if (from === to) return pin(draft, ctx, viewId, jobId, position);
			const [job] = from.jobs.splice(
				from.jobs.findIndex((j) => j.id === jobId),
				1
			);
			to.jobs.push(job);
			pin(draft, ctx, viewId, jobId, position);
		}
	};
}

/** Draws `needs` (stage→stage, job→job) or artifact production/consumption. */
export function addNeeds(pipelineId: string, from: string, to: string): Command {
	return {
		label: `Connect ${from} → ${to}`,
		run(draft, ctx) {
			const p = pipelineDraft(draft, ctx, pipelineId);
			const stage = (id: string) => p.stages.find((s) => s.id === id);
			const job = (id: string) => p.stages.flatMap((s) => s.jobs).find((j) => j.id === id);
			const artifact = (id: string) => p.artifacts?.find((a) => a.id === id);
			const target = (stage(from) && stage(to)) ?? (job(from) && job(to));
			if (target) {
				const needs = (target.needs ??= []);
				if (!needs.includes(from)) needs.push(from);
				return;
			}
			if (job(from) && artifact(to)) {
				artifact(to)!.producedBy = from;
				return;
			}
			if (artifact(from) && job(to)) {
				const consumed = (artifact(from)!.consumedBy ??= []);
				if (!consumed.includes(to)) consumed.push(to);
				return;
			}
			fail('connect two stages, two jobs, or a job and an artifact');
		}
	};
}

/** Removes a `needs` dependency or an artifact production/consumption edge. */
export function removeNeeds(pipelineId: string, from: string, to: string): Command {
	return {
		label: `Disconnect ${from} → ${to}`,
		run(draft, ctx) {
			const p = pipelineDraft(draft, ctx, pipelineId);
			for (const item of [...p.stages, ...p.stages.flatMap((s) => s.jobs)]) {
				if (item.id !== to || !item.needs) continue;
				item.needs = item.needs.filter((n) => n !== from);
				if (!item.needs.length) delete item.needs;
			}
			for (const a of p.artifacts ?? []) {
				if (a.id === to && a.producedBy === from) delete a.producedBy;
				if (a.id === from && a.consumedBy) {
					a.consumedBy = a.consumedBy.filter((c) => c !== to);
					if (!a.consumedBy.length) delete a.consumedBy;
				}
			}
		}
	};
}

// ------------------------------------------------------------------ views

/** "Remove from view": hides an entity by editing only the view (include/exclude). */
export function removeFromView(viewId: string, id: string): Command {
	return {
		label: `Remove ${id} from view`,
		run(draft, ctx) {
			const view = ctx.model.views.get(viewId) ?? fail(`unknown view "${viewId}"`);
			const type = view.def.type;
			if (type !== 'component' && type !== 'class' && type !== 'object')
				fail(
					'only component, class and object views select their content; delete the item instead'
				);
			const def: Draft<View> = viewDraft(draft, ctx, viewId);
			if (def.include?.includes(id)) def.include.splice(def.include.indexOf(id), 1);
			const items: Map<string, Selectable> =
				type === 'component'
					? ctx.model.elements
					: type === 'class'
						? ctx.model.classes
						: ctx.model.objects;
			const include = def.include ?? (def.scope ? [def.scope, `${def.scope}.**`] : ['**']);
			if (select(items, include, def.exclude, []).ids.has(id)) (def.exclude ??= []).push(id);
		}
	};
}
