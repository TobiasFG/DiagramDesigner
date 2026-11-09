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
	/** Design-relative file receiving new top-level model entities. */
	defaultModelFile?: string;
	/** Design-relative file receiving new views. */
	defaultViewFile?: string;
	/** Grid size in px for snap-to-grid; 0 disables snapping by default. */
	snapGrid?: number;
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
	defaultModelFile: string;
	defaultViewFile: string;
	snapGrid: number;
}

/** Settings the browser needs; paths stay on the server. */
export interface ClientConfig {
	theme: ThemeName;
	snapGrid: number;
	defaultModelFile: string;
	defaultViewFile: string;
	formats: ExportFormat[];
}

export function clientConfig(c: ResolvedConfig): ClientConfig {
	return {
		theme: c.theme,
		snapGrid: c.snapGrid,
		defaultModelFile: c.defaultModelFile,
		defaultViewFile: c.defaultViewFile,
		formats: c.formats
	};
}
