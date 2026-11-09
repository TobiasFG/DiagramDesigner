import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ResolvedConfig, ThemeName } from '../src/lib/config';
import { EXPORT_FORMATS, type ExportFormat } from '../src/lib/model/schema';
import { loadDesign } from '../src/lib/model/loader';
import { formatDiagnostic } from '../src/lib/model/diagnostics';
import { readDesign } from '../src/lib/server/files';
import { createNodeElk } from '../src/lib/layout/elk-node';
import {
	exportBaseName,
	renderedToMermaid,
	renderedToSvg,
	renderView
} from '../src/lib/export/render';
import { svgToPngs } from '../src/lib/export/png';
import type { CliIO } from './sdv';

const EXT: Record<ExportFormat, string> = { mermaid: 'mmd', svg: 'svg', png: 'png' };

interface ExportOptions {
	view?: string[];
	format?: string;
	out?: string;
	theme?: string;
	check?: boolean;
	quiet?: boolean;
}

interface Planned {
	viewId: string;
	format: ExportFormat;
	file: string;
	content?: string | Buffer;
}

export async function runExport(
	config: ResolvedConfig,
	opts: ExportOptions,
	io: CliIO
): Promise<number> {
	const design = loadDesign(await readDesign(config.root));
	const errors = design.diagnostics.filter((d) => d.severity === 'error');
	if (errors.length) {
		for (const d of errors) io.error(formatDiagnostic(d));
		io.error(`export blocked by ${errors.length} error(s); run "sdv validate"`);
		return 1;
	}
	const model = design.model;
	const theme = (opts.theme ?? config.theme) as ThemeName;
	if (theme !== 'light' && theme !== 'dark') {
		io.error(`--theme must be light or dark`);
		return 2;
	}
	const cliFormats = opts.format?.split(',').map((f) => f.trim()) as ExportFormat[] | undefined;
	for (const f of cliFormats ?? []) {
		if (!EXPORT_FORMATS.includes(f)) {
			io.error(`unknown format "${f}" (expected ${EXPORT_FORMATS.join(', ')})`);
			return 2;
		}
	}
	const viewIds = opts.view?.length
		? opts.view
		: [...model.views.values()].filter((v) => !v.generated).map((v) => v.id);
	for (const id of viewIds) {
		if (!model.views.has(id)) {
			io.error(`unknown view "${id}"`);
			return 2;
		}
	}
	const outDir = opts.out ? path.resolve(opts.out) : config.exportDir;
	const elk = createNodeElk();

	const planned: Planned[] = [];
	const pngJobs: { plan: Planned; svg: string }[] = [];
	for (const viewId of viewIds.sort()) {
		const rendered = (await renderView(model, viewId, elk))!;
		const formats = cliFormats ?? model.views.get(viewId)!.def.export?.formats ?? config.formats;
		const base = exportBaseName(model, viewId);
		for (const format of [...formats].sort()) {
			const plan: Planned = { viewId, format, file: path.join(outDir, `${base}.${EXT[format]}`) };
			if (format === 'mermaid') {
				const m = renderedToMermaid(rendered);
				plan.content = m.text;
				if (!opts.quiet) for (const w of m.warnings) io.log(`warning ${viewId}: ${w}`);
			} else if (format === 'svg') plan.content = renderedToSvg(rendered, theme);
			else pngJobs.push({ plan, svg: renderedToSvg(rendered, theme) });
			planned.push(plan);
		}
	}

	if (opts.check) {
		// PNG pixels depend on the machine's fonts, so they are only checked for presence.
		let stale = 0;
		for (const p of planned) {
			const rel = path.relative(process.cwd(), p.file);
			let current: string | undefined;
			try {
				current = await fs.readFile(p.file, 'utf8');
			} catch {
				io.error(`missing: ${rel}`);
				stale++;
				continue;
			}
			if (p.format !== 'png' && current !== p.content) {
				io.error(`out of date: ${rel}`);
				stale++;
			}
		}
		if (stale) {
			io.error(`${stale} export(s) out of date; run "sdv export"`);
			return 1;
		}
		if (!opts.quiet) io.log(`${planned.length} export(s) up to date`);
		return 0;
	}

	if (pngJobs.length) {
		const pngs = await svgToPngs(pngJobs.map((j) => j.svg));
		pngJobs.forEach((j, i) => (j.plan.content = pngs[i]));
	}
	await fs.mkdir(outDir, { recursive: true });
	let written = 0;
	for (const p of planned) {
		const existing = await fs.readFile(p.file).catch(() => undefined);
		const next = typeof p.content === 'string' ? Buffer.from(p.content) : p.content!;
		if (existing && existing.equals(next)) continue;
		await fs.writeFile(p.file, next);
		written++;
		if (!opts.quiet) io.log(`wrote ${path.relative(process.cwd(), p.file)}`);
	}
	if (!opts.quiet) io.log(`${planned.length} export(s), ${written} changed`);
	return 0;
}
