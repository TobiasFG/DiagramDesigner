import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import type { ResolvedConfig, SdvConfig } from '../config';

const CONFIG_NAMES = ['sdv.config.ts', 'sdv.config.mjs', 'sdv.config.js'];

/** Walks up from `start` looking for an sdv config file. */
export function findConfigFile(start: string): string | undefined {
	let dir = path.resolve(start);
	for (;;) {
		for (const name of CONFIG_NAMES) {
			const candidate = path.join(dir, name);
			if (existsSync(candidate)) return candidate;
		}
		const parent = path.dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

export interface LoadConfigOptions {
	cwd?: string;
	/** Explicit config file; defaults to `SDV_CONFIG` or a search upwards from cwd. */
	configFile?: string;
	env?: Record<string, string | undefined>;
}

export async function loadConfig(opts: LoadConfigOptions = {}): Promise<ResolvedConfig> {
	const cwd = opts.cwd ?? process.cwd();
	const env = opts.env ?? process.env;
	const explicit = opts.configFile ?? env.SDV_CONFIG;
	const configFile = explicit ? path.resolve(cwd, explicit) : findConfigFile(cwd);
	let user: SdvConfig = {};
	if (configFile) {
		if (!existsSync(configFile)) throw new Error(`Config file not found: ${configFile}`);
		const mod = (await tsImport(pathToFileURL(configFile).href, import.meta.url)) as {
			default?: SdvConfig | { default?: SdvConfig };
		};
		// tsx may wrap the module namespace in an extra `default` layer.
		const exported = mod.default;
		user = ((exported && 'default' in exported ? exported.default : exported) as SdvConfig) ?? {};
	}
	const base = configFile ? path.dirname(configFile) : cwd;
	const root = env.SDV_ROOT
		? path.resolve(cwd, env.SDV_ROOT)
		: path.resolve(base, user.root ?? 'design');
	return {
		configFile,
		root,
		exportDir: path.resolve(base, user.exportDir ?? 'docs/diagrams'),
		formats: user.formats ?? ['mermaid', 'svg'],
		theme: user.theme ?? 'light'
	};
}
