import type { z } from 'zod';
import { EntityFile } from './schema';
import { formatPath, type DataPath, type Diagnostic } from './diagnostics';

/** Issue produced by validation, before it is mapped to a source position. */
export interface RawIssue {
	path: DataPath;
	message: string;
	/** Offending key when the issue is an unrecognized key. */
	key?: string;
}

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

export interface ValidatedFile<T> {
	value: T;
	issues: RawIssue[];
}

export function validateEntityFile(data: unknown): ValidatedFile<EntityFile | undefined> {
	const res = EntityFile.safeParse(data);
	if (res.success) return { value: res.data, issues: [] };
	return { value: undefined, issues: zodIssues(res.error) };
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
