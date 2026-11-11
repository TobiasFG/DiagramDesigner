export type ThemeName = 'light' | 'dark';

/** Shape of `sdv.config.ts`. Relative paths resolve against the config file's directory. */
export interface SdvConfig {
	/** Design root holding the entity files. `SDV_ROOT` overrides it. */
	root?: string;
	theme?: ThemeName;
}

export interface ResolvedConfig {
	/** Absolute path of the config file, if one was found. */
	configFile?: string;
	/** Absolute design root. */
	root: string;
	theme: ThemeName;
}

/** Settings the browser needs; paths stay on the server. */
export interface ClientConfig {
	theme: ThemeName;
}

export function clientConfig(c: ResolvedConfig): ClientConfig {
	return { theme: c.theme };
}
