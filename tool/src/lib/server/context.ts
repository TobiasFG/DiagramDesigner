import type { ResolvedConfig } from '../config';
import { loadConfig } from './config';

let config: Promise<ResolvedConfig> | undefined;

/** Config for the dev server, loaded once per process. */
export function serverConfig(): Promise<ResolvedConfig> {
	config ??= loadConfig();
	return config;
}
