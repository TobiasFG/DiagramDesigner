import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import type { ResolvedConfig } from '../src/lib/config';
import { loadDesign } from '../src/lib/model/loader';
import { readDesign } from '../src/lib/server/files';
import { createNodeElk } from '../src/lib/layout/elk-node';
import { exportBaseName, renderedToMermaid, renderView } from '../src/lib/export/render';
import { mermaidFence } from '../src/lib/export/mermaid';
import type { Model } from '../src/lib/model/model';
import type { CliIO } from './sdv';

/** `<!-- sdv:view <id> [format=mermaid|svg|png] -->` ... `<!-- /sdv:view -->` */
const REGION =
	/(<!--\s*sdv:view\s+([a-z][a-z0-9-]*)((?:\s+[a-z]+=[^\s>]+)*)\s*-->)([\s\S]*?)(<!--\s*\/sdv:view\s*-->)/g;

export interface MdRegionRenderer {
	(viewId: string, format: string, mdFile: string): Promise<string>;
}

/** Replaces every marked region; text outside markers is left untouched. */
export async function syncMarkdown(
	text: string,
	render: MdRegionRenderer,
	mdFile: string
): Promise<string> {
	const parts: (string | Promise<string>)[] = [];
	let last = 0;
	for (const m of text.matchAll(REGION)) {
		const [, open, viewId, attrs, , close] = m;
		const format = /format=([a-z]+)/.exec(attrs)?.[1] ?? 'mermaid';
		parts.push(text.slice(last, m.index));
		parts.push(render(viewId, format, mdFile).then((body) => `${open}\n${body}${close}`));
		last = m.index! + m[0].length;
	}
	parts.push(text.slice(last));
	return (await Promise.all(parts)).join('');
}

export function regionRenderer(model: Model, config: ResolvedConfig, io: CliIO): MdRegionRenderer {
	const elk = createNodeElk();
	return async (viewId, format, mdFile) => {
		const view = model.views.get(viewId);
		if (!view) throw new Error(`${mdFile}: unknown view "${viewId}"`);
		if (format === 'mermaid') {
			const rendered = (await renderView(model, viewId, elk))!;
			return mermaidFence(renderedToMermaid(rendered).text);
		}
		if (format !== 'svg' && format !== 'png')
			throw new Error(`${mdFile}: unknown format "${format}" for view "${viewId}"`);
		const image = path.join(config.exportDir, `${exportBaseName(model, viewId)}.${format}`);
		if (!existsSync(image))
			io.log(
				`warning ${mdFile}: ${path.relative(process.cwd(), image)} does not exist yet; run "sdv export --format ${format}"`
			);
		const rel = path
			.relative(path.dirname(path.resolve(mdFile)), image)
			.split(path.sep)
			.join('/');
		return `![${view.title}](${rel})\n`;
	};
}

export async function runMdSync(
	config: ResolvedConfig,
	files: string[],
	io: CliIO,
	cwd: string
): Promise<number> {
	if (!files.length) {
		io.error('usage: sdv md-sync <file.md>...');
		return 2;
	}
	const design = loadDesign(await readDesign(config.root));
	const render = regionRenderer(design.model, config, io);
	let failed = 0;
	for (const file of files) {
		const abs = path.resolve(cwd, file);
		try {
			const text = await fs.readFile(abs, 'utf8');
			const next = await syncMarkdown(text, render, file);
			if (next !== text) {
				await fs.writeFile(abs, next);
				io.log(`updated ${file}`);
			}
		} catch (e) {
			io.error((e as Error).message);
			failed++;
		}
	}
	return failed ? 1 : 0;
}
