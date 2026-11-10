import { parseArgs } from 'node:util';
import { loadConfig } from '../src/lib/server/config';
import { readDesign } from '../src/lib/server/files';
import { loadDesign } from '../src/lib/model/loader';
import { formatDiagnostic, hasErrors, sortDiagnostics } from '../src/lib/model/diagnostics';

const HELP = `sdv — System Design Viewer CLI

Usage:
  sdv validate                 schema + reference checks; exit 1 on errors
  sdv new <name.kind.yaml> [--parent id]
                               create an entity file with a generated id;
                               --parent is written as ownedBy for models
  sdv export [--view id]... [--format mermaid,svg,png] [--out dir] [--theme light|dark]
  sdv export --check           exit 1 if committed exports differ from fresh ones
  sdv md-sync <file.md>...     refresh <!-- sdv:view ... --> regions in Markdown
  sdv schema [--out dir]       write JSON Schemas for model and view files

Options:
  --config <file>              config file (default: search for sdv.config.ts)
  --root <dir>                 design root (overrides config; same as SDV_ROOT)
  -q, --quiet                  only print errors
`;

export interface CliIO {
	log(msg: string): void;
	error(msg: string): void;
}

const consoleIO: CliIO = { log: (m) => console.log(m), error: (m) => console.error(m) };

export async function main(
	argv: string[],
	io: CliIO = consoleIO,
	cwd = process.cwd()
): Promise<number> {
	const [command, ...rest] = argv;
	if (!command || command === 'help' || command === '--help' || command === '-h') {
		io.log(HELP);
		return command ? 0 : 1;
	}
	const { values, positionals } = parseArgs({
		args: rest,
		allowPositionals: true,
		options: {
			config: { type: 'string' },
			root: { type: 'string' },
			view: { type: 'string', multiple: true },
			format: { type: 'string' },
			out: { type: 'string' },
			theme: { type: 'string' },
			parent: { type: 'string' },
			check: { type: 'boolean' },
			quiet: { type: 'boolean', short: 'q' }
		}
	});
	const env = { ...process.env };
	if (values.root) env.SDV_ROOT = values.root;
	const config = await loadConfig({ cwd, configFile: values.config, env });

	switch (command) {
		case 'validate': {
			const design = loadDesign(await readDesign(config.root));
			const diags = sortDiagnostics(design.diagnostics);
			for (const d of diags) {
				if (d.severity === 'error') io.error(formatDiagnostic(d));
				else if (!values.quiet) io.log(formatDiagnostic(d));
			}
			const errors = diags.filter((d) => d.severity === 'error').length;
			const warnings = diags.length - errors;
			if (!values.quiet) {
				io.log(
					`${design.model.files.length} files, ${design.model.views.size} views: ${errors} error(s), ${warnings} warning(s)`
				);
			}
			return hasErrors(diags) ? 1 : 0;
		}
		case 'new': {
			const { runNew } = await import('./new');
			return runNew(positionals, values.parent, io, cwd);
		}
		case 'export': {
			const { runExport } = await import('./export');
			return runExport(config, values, io);
		}
		case 'md-sync': {
			const { runMdSync } = await import('./md-sync');
			return runMdSync(config, positionals, io, cwd);
		}
		case 'schema': {
			const { runSchema } = await import('./schema');
			return runSchema(values.out, io, cwd);
		}
		default:
			io.error(`Unknown command "${command}"\n\n${HELP}`);
			return 2;
	}
}
