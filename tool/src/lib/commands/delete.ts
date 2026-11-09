import { current, type Draft } from 'immer';
import type { DataPath } from '../model/diagnostics';
import { buildModel, isObjectLink, layoutFileFor, type Loc, type Model } from '../model/model';
import type { Flow, Interaction, Pipeline, View } from '../model/schema';
import type { EntityRef } from '../projections/types';
import { fail, getAt, type Command, type DesignData } from './core';
import { pruneSteps } from './sequence';

type Obj = Record<string, unknown>;

/** Lexicographic comparison of data paths, numeric segments compared as numbers. */
function comparePaths(a: DataPath, b: DataPath): number {
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		if (a[i] === b[i]) continue;
		if (typeof a[i] === 'number' && typeof b[i] === 'number')
			return (a[i] as number) - (b[i] as number);
		return String(a[i]).localeCompare(String(b[i]));
	}
	return a.length - b.length;
}

const isPrefix = (p: DataPath, of: DataPath) =>
	p.length < of.length && p.every((s, i) => s === of[i]);

/**
 * Removes list items at the given locations. Later indices go first so earlier ones stay
 * valid, and items nested in another removed item are skipped.
 */
function removeAll(draft: Draft<DesignData>, locs: Loc[]) {
	const unique = locs.filter(
		(l, i) => locs.findIndex((o) => o.file === l.file && comparePaths(o.path, l.path) === 0) === i
	);
	const kept = unique.filter(
		(l) => !unique.some((o) => o.file === l.file && isPrefix(o.path, l.path))
	);
	kept.sort((a, b) => a.file.localeCompare(b.file) || comparePaths(b.path, a.path));
	for (const l of kept) {
		const list = getAt<unknown[]>(draft, l.file, l.path.slice(0, -1));
		list.splice(l.path[l.path.length - 1] as number, 1);
	}
}

/** Drops references to removed ids from view definitions (scope, include, exclude). */
function cleanViews(draft: Draft<DesignData>, model: Model, ids: Set<string>) {
	for (const view of model.views.values()) {
		if (!view.loc) continue;
		const def = getAt<Draft<View>>(draft, view.loc.file, view.loc.path);
		const refersTo = (p: string) => ids.has(p.replace(/\.\*\*?$/, ''));
		if (def.scope && ids.has(def.scope)) delete def.scope;
		if (def.include) def.include = def.include.filter((p) => !refersTo(p));
		if (def.exclude) {
			def.exclude = def.exclude.filter((p) => !refersTo(p));
			if (!def.exclude.length) delete def.exclude;
		}
	}
}

function deleteElement(draft: Draft<DesignData>, m: Model, id: string) {
	const ids = new Set<string>();
	const collect = (cur: string) => {
		ids.add(cur);
		m.elements.get(cur)?.childIds.forEach(collect);
	};
	collect(id);
	const el = m.elements.get(id)!;
	const locs: Loc[] = [
		el.loc,
		...m.relationships.filter((r) => ids.has(r.def.from) || ids.has(r.def.to)).map((r) => r.loc)
	];
	for (const cls of m.classes.values()) {
		if (cls.def.componentOf && ids.has(cls.def.componentOf))
			delete getAt<Obj>(draft, cls.loc.file, cls.loc.path).componentOf;
	}
	for (const flow of m.flows.values()) {
		const f = getAt<Draft<Flow>>(draft, flow.loc.file, flow.loc.path);
		for (const n of f.nodes) if (n.actor && ids.has(n.actor)) delete n.actor;
	}
	for (const inter of m.interactions.values()) {
		const it = getAt<Draft<Interaction>>(draft, inter.loc.file, inter.loc.path);
		for (const p of [...it.participants]) {
			if (!ids.has(p)) continue;
			it.participants.splice(it.participants.indexOf(p), 1);
			pruneSteps(it.steps, p);
		}
	}
	cleanViews(draft, m, ids);
	const parent = el.parentId ? m.elements.get(el.parentId) : undefined;
	removeAll(draft, locs);
	if (parent) {
		const p = getAt<Obj>(draft, parent.loc.file, parent.loc.path);
		if (Array.isArray(p.children) && !p.children.length) delete p.children;
	}
}

function deleteClass(draft: Draft<DesignData>, m: Model, id: string) {
	const cls = m.classes.get(id)!;
	const objects = [...m.objects.values()].filter((o) => o.def.class === id);
	const removed = new Set([id, ...objects.map((o) => o.id)]);
	const locs: Loc[] = [cls.loc, ...objects.map((o) => o.loc)];
	for (const other of m.classes.values()) {
		other.def.relations?.forEach(
			(r, i) =>
				r.to === id &&
				locs.push({ file: other.loc.file, path: [...other.loc.path, 'relations', i] })
		);
	}
	for (const obj of m.objects.values()) {
		obj.def.links?.forEach(
			(l, i) =>
				isObjectLink(l) &&
				removed.has(l.to) &&
				locs.push({ file: obj.loc.file, path: [...obj.loc.path, 'links', i] })
		);
	}
	cleanViews(draft, m, removed);
	removeAll(draft, locs);
}

function deleteObject(draft: Draft<DesignData>, m: Model, id: string) {
	const locs: Loc[] = [m.objects.get(id)!.loc];
	for (const obj of m.objects.values()) {
		obj.def.links?.forEach(
			(l, i) =>
				isObjectLink(l) &&
				l.to === id &&
				locs.push({ file: obj.loc.file, path: [...obj.loc.path, 'links', i] })
		);
	}
	cleanViews(draft, m, new Set([id]));
	removeAll(draft, locs);
}

/** Flows, pipelines and interactions take their explicit views (and layouts) with them. */
function deleteSourced(
	draft: Draft<DesignData>,
	m: Model,
	id: string,
	loc: Loc,
	type: View['type']
) {
	const locs: Loc[] = [loc];
	for (const v of m.views.values()) {
		if (v.def.type !== type || v.def.source !== id) continue;
		if (v.loc) locs.push(v.loc);
		delete draft[layoutFileFor(v.id)];
	}
	if (type === 'flow') {
		for (const flow of m.flows.values()) {
			const f = getAt<Draft<Flow>>(draft, flow.loc.file, flow.loc.path);
			for (const n of f.nodes) if (n.ref === id) delete n.ref;
		}
	}
	removeAll(draft, locs);
}

function deleteFlowNode(draft: Draft<DesignData>, ref: EntityRef) {
	const flowPath = ref.path.slice(0, -2);
	const flow = getAt<Draft<Flow>>(draft, ref.file, flowPath);
	const nodeId = getAt<Obj>(draft, ref.file, ref.path).id;
	const locs: Loc[] = [{ file: ref.file, path: ref.path }];
	flow.transitions?.forEach(
		(t, i) =>
			(t.from === nodeId || t.to === nodeId) &&
			locs.push({ file: ref.file, path: [...flowPath, 'transitions', i] })
	);
	removeAll(draft, locs);
}

function deletePipelineItem(draft: Draft<DesignData>, ref: EntityRef) {
	const pipePath = ref.kind === 'job' ? ref.path.slice(0, -4) : ref.path.slice(0, -2);
	const pipe = getAt<Draft<Pipeline>>(draft, ref.file, pipePath);
	const target = getAt<Obj>(draft, ref.file, ref.path);
	const ids = new Set<string>([target.id as string]);
	if (ref.kind === 'stage') for (const j of (target.jobs as { id: string }[]) ?? []) ids.add(j.id);
	for (const s of pipe.stages) {
		if (s.needs) s.needs = s.needs.filter((n) => !ids.has(n));
		for (const j of s.jobs) if (j.needs) j.needs = j.needs.filter((n) => !ids.has(n));
	}
	for (const a of pipe.artifacts ?? []) {
		if (a.producedBy && ids.has(a.producedBy)) delete a.producedBy;
		if (a.consumedBy) a.consumedBy = a.consumedBy.filter((c) => !ids.has(c));
	}
	removeAll(draft, [{ file: ref.file, path: ref.path }]);
}

/**
 * "Delete": removes the entity and every reference to it from the model. Preview it with a
 * dry run to list the affected files before confirming.
 */
export function deleteEntity(ref: EntityRef, id?: string): Command {
	return {
		label: `Delete ${ref.kind}${id ? ` ${id}` : ''}`,
		run(draft, ctx) {
			const m = ctx.model;
			const target = getAt<Obj>(draft, ref.file, ref.path);
			const entityId = (id ?? target.id) as string;
			switch (ref.kind) {
				case 'element':
					return deleteElement(draft, m, entityId);
				case 'class':
					return deleteClass(draft, m, entityId);
				case 'object':
					return deleteObject(draft, m, entityId);
				case 'flow':
					return deleteSourced(draft, m, entityId, { file: ref.file, path: ref.path }, 'flow');
				case 'pipeline':
					return deleteSourced(draft, m, entityId, { file: ref.file, path: ref.path }, 'pipeline');
				case 'interaction':
					return deleteSourced(draft, m, entityId, { file: ref.file, path: ref.path }, 'sequence');
				case 'flowNode':
					return deleteFlowNode(draft, ref);
				case 'stage':
				case 'job':
				case 'artifact':
					return deletePipelineItem(draft, ref);
				case 'view':
					delete draft[layoutFileFor(entityId)];
					return removeAll(draft, [{ file: ref.file, path: ref.path }]);
				case 'relationship':
				case 'relation':
				case 'objectLink':
				case 'transition':
				case 'message':
				case 'note':
				case 'group':
				case 'attribute':
				case 'method':
					return removeAll(draft, [{ file: ref.file, path: ref.path }]);
				default:
					fail(`cannot delete ${ref.kind}`);
			}
		}
	};
}

/** A node to delete, identified by id so it can be found again after earlier deletions. */
export interface NodeTarget {
	kind: EntityRef['kind'];
	id: string;
	/** Flow or pipeline id for scoped items. */
	owner?: string;
}

function resolveNode(m: Model, t: NodeTarget): EntityRef | undefined {
	const at = (loc: Loc | undefined): EntityRef | undefined =>
		loc ? { kind: t.kind, file: loc.file, path: loc.path, owner: t.owner } : undefined;
	switch (t.kind) {
		case 'element':
			return at(m.elements.get(t.id)?.loc);
		case 'class':
			return at(m.classes.get(t.id)?.loc);
		case 'object':
			return at(m.objects.get(t.id)?.loc);
		case 'flowNode': {
			const flow = m.flows.get(t.owner ?? '');
			const i = flow?.def.nodes.findIndex((n) => n.id === t.id) ?? -1;
			return flow && i >= 0
				? at({ file: flow.loc.file, path: [...flow.loc.path, 'nodes', i] })
				: undefined;
		}
		case 'stage':
		case 'job':
		case 'artifact': {
			const p = m.pipelines.get(t.owner ?? '');
			if (!p) return undefined;
			const base = p.loc.path;
			if (t.kind === 'artifact') {
				const i = p.def.artifacts?.findIndex((a) => a.id === t.id) ?? -1;
				return i >= 0 ? at({ file: p.loc.file, path: [...base, 'artifacts', i] }) : undefined;
			}
			for (const [si, s] of p.def.stages.entries()) {
				if (t.kind === 'stage' && s.id === t.id)
					return at({ file: p.loc.file, path: [...base, 'stages', si] });
				const ji = s.jobs.findIndex((j) => j.id === t.id);
				if (t.kind === 'job' && ji >= 0)
					return at({ file: p.loc.file, path: [...base, 'stages', si, 'jobs', ji] });
			}
			return undefined;
		}
		default:
			return undefined;
	}
}

/**
 * Deletes a selection: edges (plain list items) first, latest path first so indices stay
 * valid, then nodes by id against a model rebuilt from the current draft, since cascades of
 * earlier deletions may have moved or removed them.
 */
export function deleteMany(edges: EntityRef[], nodes: NodeTarget[]): Command {
	return {
		label: `Delete ${edges.length + nodes.length} item(s)`,
		run(draft, ctx) {
			removeAll(
				draft,
				edges.map((r) => ({ file: r.file, path: r.path }))
			);
			for (const n of nodes) {
				const model = buildModel(current(draft) as DesignData);
				const ref = resolveNode(model, n);
				if (ref) deleteEntity(ref, n.id).run(draft, { ...ctx, model });
			}
		}
	};
}
