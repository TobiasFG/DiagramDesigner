import type { ExportFormat } from './model/schema';

export type ThemeName = 'light' | 'dark';

/** Shape of `sdv.config.ts`. Relative paths resolve against the config file's directory. */
export interface SdvConfig {
	/** Design root containing model/, views/ and layout/. `SDV_ROOT` overrides it. */
	root?: string;
	/** Where `sdv export` writes files. */
	exportDir?: string;
	/** Default export formats when a view does not list its own. */
	formats?: ExportFormat[];
	theme?: ThemeName;
}

export interface ResolvedConfig {
	/** Absolute path of the config file, if one was found. */
	configFile?: string;
	/** Absolute design root. */
	root: string;
	/** Absolute export directory. */
	exportDir: string;
	formats: ExportFormat[];
	theme: ThemeName;
}

/** Settings the browser needs; paths stay on the server. */
export interface ClientConfig {
	theme: ThemeName;
}

export function clientConfig(c: ResolvedConfig): ClientConfig {
	return { theme: c.theme };
}
