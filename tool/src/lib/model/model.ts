import type { Element, EntityFile, EntityFileKind, ModelField } from './schema';
import { ENTITY_KINDS, PARENT_KINDS } from './schema';
import type { DataPath, Diagnostic, Severity } from './diagnostics';
import { entityKind, fileKind } from './parse';
import { toDiagnostic, validateEntityFile } from './validate-file';

/** Where an entity lives: design-root-relative file and data path inside it. */
export interface Loc {
	file: string;
	path: DataPath;
}

export interface ElementInfo {
	id: string;
	def: Element;
	name: string;
	parentId?: string;
	childIds: string[];
	/** Models owned elsewhere that are drawn inside this entity as references. */
	refIds: string[];
	/** Models only: the system or module storing it. */
	storedIn?: string;
	/** Models stored here (their `storedIn`), drawn inside as tables. */
	storedIds: string[];
	tags?: string[];
	/** 0 for top-level elements. */
	depth: number;
	loc: Loc;
}

/** A model field, found by its id. */
export interface FieldInfo {
	def: ModelField;
	/** Id of the model the field belongs to. */
	modelId: string;
	loc: Loc;
}

export type GlobalKind = 'element' | 'field';

export interface Model {
	elements: Map<string, ElementInfo>;
	fields: Map<string, FieldInfo>;
	rootElementIds: string[];
	/** Global id namespace. */
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

/**
 * Builds the resolved model from parsed file data (keyed by design-relative path) and runs
 * schema and reference validation. Never throws on invalid input.
 */
export function buildModel(files: Record<string, unknown>, locate?: Locator): Model {
	const model: Model = {
		elements: new Map(),
		fields: new Map(),
		rootElementIds: [],
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

	const entityFiles: { file: string; value: EntityFile }[] = [];

	for (const file of model.files) {
		const kind = fileKind(file);
		const data = files[file];
		if (!kind || data === undefined) continue; // syntax errors are reported by the parser
		const fileLocate = (path: DataPath, key?: string) => locate?.(file, path, key);
		const res = validateEntityFile(data);
		for (const issue of res.issues) model.diagnostics.push(toDiagnostic(file, issue, fileLocate));
		if (res.value) entityFiles.push({ file, value: res.value });
	}

	// ------------------------------------------------------------ entity files
	// Parents are linked after every file is read, since files load in path order.
	const entities: ElementInfo[] = [];
	for (const { file, value } of entityFiles) {
		const loc = { file, path: [] };
		const kind = entityKind(file) as EntityFileKind;
		if (!ENTITY_KINDS.includes(kind)) {
			diag(
				'error',
				'unknown-kind',
				`unknown kind "${kind}"; expected ${ENTITY_KINDS.join(', ')}`,
				loc
			);
			continue;
		}
		if (!claim(value.id, 'element', loc)) continue;
		const { parent, ownedBy, storedIn, models, ...rest } = value;
		const base = file.slice(file.lastIndexOf('/') + 1).split('.')[0];
		const info: ElementInfo = {
			id: value.id,
			def: { ...rest, kind },
			name: value.name ?? base,
			tags: value.tags,
			parentId: kind === 'model' ? ownedBy : parent,
			childIds: [],
			refIds: models ?? [],
			storedIn,
			storedIds: [],
			depth: 0,
			loc
		};
		model.elements.set(value.id, info);
		entities.push(info);
		if (kind === 'system' && parent)
			diag('error', 'system-parent', `system "${info.name}" cannot have a parent`, loc, 'parent');
		if (kind === 'model' && parent)
			diag('error', 'model-parent', `model "${info.name}" uses ownedBy, not parent`, loc, 'parent');
		if (kind !== 'model' && ownedBy)
			diag('error', 'owned-by', `only models have ownedBy`, loc, 'ownedBy');
		if (kind !== 'model' && storedIn)
			diag('error', 'model-only', `only models have storedIn`, loc, 'storedIn');
		if (kind === 'model' && !ownedBy)
			diag('error', 'missing-owner', `model "${info.name}" needs ownedBy`, loc, 'id');
		if (kind !== 'system' && kind !== 'model' && !parent)
			diag('error', 'missing-parent', `${kind} "${info.name}" needs a parent`, loc, 'id');
		if (kind === 'model') {
			if (models) diag('error', 'model-only', `a model cannot list models`, loc, 'models');
			const names = new Set<string>();
			value.fields?.forEach((f, i) => {
				const fieldLoc = at(loc, 'fields', i);
				if (claim(f.id, 'field', fieldLoc))
					model.fields.set(f.id, { def: f, modelId: value.id, loc: fieldLoc });
				if (names.has(f.name))
					diag('error', 'duplicate-field', `field "${f.name}" is defined twice`, fieldLoc, 'name');
				names.add(f.name);
				if (!f.type === !f.model)
					diag(
						'error',
						'field-type',
						`field "${f.name}" needs exactly one of type and model`,
						fieldLoc,
						f.type ? 'model' : 'name'
					);
				if (f.model && f.ref)
					diag(
						'error',
						'field-type',
						`field "${f.name}" holds a model, so it cannot also ref a key`,
						fieldLoc,
						'ref'
					);
				if (f.pk && f.nullable)
					diag(
						'error',
						'nullable-key',
						`key field "${f.name}" cannot be nullable`,
						fieldLoc,
						'nullable'
					);
				if (f.pk && (f.model || f.stored === false))
					diag(
						'error',
						'unstored-key',
						`key field "${f.name}" must be stored, so it cannot hold a model or be stored: false`,
						fieldLoc,
						'pk'
					);
			});
			const own = new Set(
				value.fields?.filter((f) => !f.model && f.stored !== false).map((f) => f.id)
			);
			value.indexes?.forEach((ix, i) =>
				ix.fields.forEach((f, j) => {
					if (!own.has(f))
						diag(
							'error',
							'unknown-field',
							`index "${ix.name}" uses "${f}", which is not a stored field of this model`,
							at(loc, 'indexes', i, 'fields', j)
						);
				})
			);
		} else {
			for (const key of ['fields', 'indexes'] as const)
				if (value[key]) diag('error', 'model-only', `only models have ${key}`, loc, key);
		}
	}
	for (const info of entities) {
		info.def.fields?.forEach((f, i) => {
			const fieldLoc = at(info.loc, 'fields', i);
			if (f.model) {
				const target = model.elements.get(f.model);
				if (!target)
					diag(
						'error',
						'dangling-ref',
						`field "${f.name}" holds unknown model "${f.model}"`,
						fieldLoc,
						'model'
					);
				else if (target.def.kind !== 'model')
					diag(
						'error',
						'not-a-model',
						`field "${f.name}" holds ${target.def.kind} "${target.name}", not a model`,
						fieldLoc,
						'model'
					);
			}
			f.from?.forEach((src, j) => {
				const srcLoc = at(fieldLoc, 'from', j);
				if (src === f.id)
					diag('error', 'lineage-cycle', `field "${f.name}" comes from itself`, srcLoc);
				else if (!model.fields.has(src))
					diag(
						'error',
						'dangling-ref',
						`field "${f.name}" comes from "${src}", which is not a field`,
						srcLoc
					);
			});
		});
	}
	const lineage = new Map(
		[...model.fields].map(([id, f]) => [id, (f.def.from ?? []).filter((s) => s !== id)])
	);
	const cycle = findCycle(lineage);
	if (cycle)
		diag(
			'error',
			'lineage-cycle',
			`fields come from each other: ${cycle.map((id) => model.fields.get(id)!.def.name).join(' <- ')}`,
			at(model.fields.get(cycle[0])!.loc, 'from')
		);
	for (const info of entities) {
		info.def.fields?.forEach((f, i) => {
			if (!f.ref) return;
			if (model.fields.has(f.ref)) return;
			const target = model.elements.get(f.ref);
			const refLoc = at(info.loc, 'fields', i);
			if (!target)
				diag(
					'error',
					'dangling-ref',
					`field "${f.name}" refers to unknown "${f.ref}"`,
					refLoc,
					'ref'
				);
			else if (target.def.kind !== 'model')
				diag(
					'error',
					'not-a-model',
					`field "${f.name}" refers to ${target.def.kind} "${target.name}", not a model or field`,
					refLoc,
					'ref'
				);
		});
		info.refIds = info.refIds.filter((ref, i) => {
			const target = model.elements.get(ref);
			const refLoc = at(info.loc, 'models', i);
			if (!target) diag('error', 'dangling-ref', `model "${ref}" is not an entity`, refLoc);
			else if (target.def.kind !== 'model')
				diag(
					'error',
					'not-a-model',
					`"${target.name}" is a ${target.def.kind}, not a model`,
					refLoc
				);
			else if (target.parentId === info.id)
				diag('warning', 'own-model-ref', `"${target.name}" is already owned here`, refLoc);
			else if (target.storedIn === info.id)
				diag('warning', 'own-model-ref', `"${target.name}" is already stored here`, refLoc);
			else return true;
			return false;
		});
		if (info.storedIn) {
			const store = model.elements.get(info.storedIn);
			if (!store)
				diag(
					'error',
					'dangling-ref',
					`storedIn "${info.storedIn}" is not an entity`,
					info.loc,
					'storedIn'
				);
			else if (store.def.kind !== 'system' && store.def.kind !== 'module')
				diag(
					'error',
					'parent-kind',
					`a model cannot be stored in a ${store.def.kind}; allowed: system, module`,
					info.loc,
					'storedIn'
				);
			// Stored where owned: drawn once, in the owner, as the table.
			else if (info.storedIn !== info.parentId) store.storedIds.push(info.id);
		}
		if (!info.parentId) continue;
		const field = info.def.kind === 'model' ? 'ownedBy' : 'parent';
		if (!model.elements.has(info.parentId)) {
			diag(
				'error',
				'dangling-ref',
				`${field} "${info.parentId}" is not an entity`,
				info.loc,
				field
			);
			info.parentId = undefined;
			continue;
		}
		const allowed = PARENT_KINDS[info.def.kind as EntityFileKind];
		const parentKind = model.elements.get(info.parentId)!.def.kind;
		if (allowed && !allowed.includes(parentKind as EntityFileKind))
			diag(
				'error',
				'parent-kind',
				`${info.def.kind} cannot have a ${parentKind} as ${field}; allowed: ${allowed.join(', ')}`,
				info.loc,
				field
			);
		const seen = new Set([info.id]);
		let cur: string | undefined = info.parentId;
		while (cur && !seen.has(cur)) {
			seen.add(cur);
			cur = model.elements.get(cur)?.parentId;
		}
		if (cur === info.id) {
			diag('error', 'parent-cycle', `parent chain of "${info.name}" loops`, info.loc, field);
			info.parentId = undefined;
		}
	}
	const folderOf = (file: string) => file.slice(0, file.lastIndexOf('/') + 1);
	const systemFolders = new Map<string, ElementInfo>();
	for (const info of entities) {
		if (info.parentId) model.elements.get(info.parentId)!.childIds.push(info.id);
		else model.rootElementIds.push(info.id);
		let top = info;
		while (top.parentId) {
			top = model.elements.get(top.parentId)!;
			info.depth++;
		}
		const folder = folderOf(top.loc.file);
		if (info === top && info.def.kind === 'system') {
			const other = systemFolders.get(folder);
			if (other)
				diag(
					'error',
					'shared-system-folder',
					`system "${info.name}" shares its folder with "${other.name}"; give each system its own folder`,
					info.loc
				);
			else systemFolders.set(folder, info);
		} else if (top.def.kind === 'system' && !info.loc.file.startsWith(folder)) {
			diag(
				'warning',
				'outside-system-folder',
				`"${info.name}" belongs to system "${top.name}" but is outside ${folder}`,
				info.loc
			);
		}
	}

	return model;
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
