export type Severity = 'error' | 'warning';

export type DataPath = (string | number)[];

export interface Diagnostic {
	severity: Severity;
	code: string;
	message: string;
	/** Path relative to the design root. */
	file?: string;
	/** 1-based line and column. */
	line?: number;
	col?: number;
	/** Data path inside the file. */
	path?: DataPath;
}

export function formatPath(path: DataPath): string {
	let out = '';
	for (const seg of path) {
		if (typeof seg === 'number') out += `[${seg}]`;
		else out += out ? `.${seg}` : seg;
	}
	return out;
}

export function formatLocation(d: Pick<Diagnostic, 'file' | 'line' | 'col'>): string {
	if (!d.file) return '';
	if (d.line === undefined) return d.file;
	return `${d.file}:${d.line}:${d.col ?? 1}`;
}

export function formatDiagnostic(d: Diagnostic): string {
	const loc = formatLocation(d);
	return `${loc ? loc + ': ' : ''}${d.severity} ${d.message} [${d.code}]`;
}

export function hasErrors(diagnostics: Diagnostic[]): boolean {
	return diagnostics.some((d) => d.severity === 'error');
}

export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
	return [...diagnostics].sort(
		(a, b) =>
			(a.file ?? '').localeCompare(b.file ?? '') ||
			(a.line ?? 0) - (b.line ?? 0) ||
			(a.col ?? 0) - (b.col ?? 0) ||
			a.message.localeCompare(b.message)
	);
}
