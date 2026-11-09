import type { z } from 'zod';
import {
	ClassDef,
	Element,
	Flow,
	Interaction,
	LayoutFile,
	MODEL_SECTIONS,
	ObjectDef,
	Pipeline,
	Relationship,
	View,
	type ModelFile,
	type ModelSection,
	type ViewFile
} from './schema';
import { formatPath, type DataPath, type Diagnostic } from './diagnostics';
import type { FileKind } from './parse';

/** Issue produced by validation, before it is mapped to a source position. */
export interface RawIssue {
	path: DataPath;
	message: string;
	/** Offending key when the issue is an unrecognized key. */
	key?: string;
}

const SECTION_SCHEMAS: Record<ModelSection, z.ZodType> = {
	elements: Element,
	relationships: Relationship,
	classes: ClassDef,
	objects: ObjectDef,
	flows: Flow,
	pipelines: Pipeline,
	interactions: Interaction
};

type ZodIssueLike = {
	code: string;
	path: PropertyKey[];
	message: string;
	keys?: string[];
	errors?: ZodIssueLike[][];
};

/** Flattens zod issues; for unions only the closest-matching branch is reported. */
export function zodIssues(error: z.ZodError, prefix: DataPath = []): RawIssue[] {
	const out: RawIssue[] = [];
	const visit = (issue: ZodIssueLike, base: DataPath) => {
		const path = [
			...base,
			...(issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p)) as DataPath)
		];
		if (issue.code === 'invalid_union' && issue.errors?.length) {
			const best = [...issue.errors].sort((a, b) => a.length - b.length)[0];
			for (const sub of best) visit(sub, path);
			return;
		}
		if (issue.code === 'unrecognized_keys' && issue.keys) {
			for (const key of issue.keys) out.push({ path, key, message: `unknown field "${key}"` });
			return;
		}
		out.push({ path, message: issue.message });
	};
	for (const issue of error.issues as unknown as ZodIssueLike[]) visit(issue, prefix);
	return out;
}

export function issueMessage(issue: RawIssue): string {
	const p = formatPath(issue.path);
	return p ? `${p}: ${issue.message}` : issue.message;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface ValidatedFile<T> {
	value: T;
	issues: RawIssue[];
}

/** A valid list item together with its index in the source list. */
export interface IndexedItem<T = unknown> {
	index: number;
	value: T;
}

export interface ValidatedModelFile extends ValidatedFile<ModelFile> {
	sections: Partial<Record<ModelSection, IndexedItem[]>>;
}

export interface ValidatedViewFile extends ValidatedFile<ViewFile> {
	views: IndexedItem<View>[];
}

/** Validates a model file, keeping every entity that is valid on its own. */
export function validateModelFile(data: unknown): ValidatedModelFile {
	const issues: RawIssue[] = [];
	const value: ModelFile = {};
	const sections: ValidatedModelFile['sections'] = {};
	if (data === null || data === undefined) return { value, issues, sections };
	if (!isRecord(data)) {
		issues.push({ path: [], message: 'model file must be a mapping of sections' });
		return { value, issues, sections };
	}
	for (const [key, section] of Object.entries(data)) {
		if (!(MODEL_SECTIONS as readonly string[]).includes(key)) {
			issues.push({ path: [], key, message: `unknown section "${key}"` });
			continue;
		}
		const name = key as ModelSection;
		if (section === null || section === undefined) continue;
		if (!Array.isArray(section)) {
			issues.push({ path: [name], message: 'must be a list' });
			continue;
		}
		const schema = SECTION_SCHEMAS[name];
		const kept: IndexedItem[] = [];
		section.forEach((item, i) => {
			const res = schema.safeParse(item);
			if (res.success) kept.push({ index: i, value: res.data });
			else issues.push(...zodIssues(res.error, [name, i]));
		});
		sections[name] = kept;
		(value as Record<string, unknown[]>)[name] = kept.map((k) => k.value);
	}
	return { value, issues, sections };
}

export function validateViewFile(data: unknown): ValidatedViewFile {
	const issues: RawIssue[] = [];
	const value: ViewFile = { views: [] };
	const indexed: IndexedItem<View>[] = [];
	if (data === null || data === undefined) return { value, issues, views: indexed };
	if (!isRecord(data)) {
		issues.push({ path: [], message: 'view file must be a mapping with a "views" list' });
		return { value, issues, views: indexed };
	}
	for (const key of Object.keys(data)) {
		if (key !== 'views') issues.push({ path: [], key, message: `unknown section "${key}"` });
	}
	const views = data.views;
	if (views === undefined || views === null) return { value, issues, views: indexed };
	if (!Array.isArray(views)) {
		issues.push({ path: ['views'], message: 'must be a list' });
		return { value, issues, views: indexed };
	}
	views.forEach((item, i) => {
		const res = View.safeParse(item);
		if (res.success) {
			value.views!.push(res.data);
			indexed.push({ index: i, value: res.data });
		} else issues.push(...zodIssues(res.error, ['views', i]));
	});
	return { value, issues, views: indexed };
}

export function validateLayoutFile(data: unknown): ValidatedFile<LayoutFile | undefined> {
	const res = LayoutFile.safeParse(data);
	if (res.success) return { value: res.data, issues: [] };
	return { value: undefined, issues: zodIssues(res.error) };
}

export function validateFile(kind: FileKind, data: unknown): ValidatedFile<unknown> {
	if (kind === 'model') return validateModelFile(data);
	if (kind === 'view') return validateViewFile(data);
	return validateLayoutFile(data);
}

export function toDiagnostic(
	file: string,
	issue: RawIssue,
	locate?: (path: DataPath, key?: string) => { line: number; col: number } | undefined
): Diagnostic {
	const pos = locate?.(issue.path, issue.key);
	return {
		severity: 'error',
		code: 'schema',
		message: issueMessage(issue),
		file,
		line: pos?.line,
		col: pos?.col,
		path: issue.path
	};
}
