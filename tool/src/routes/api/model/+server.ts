import { json } from '@sveltejs/kit';
import { building } from '$app/env';
import { clientConfig } from '#lib/config.ts';
import { serverConfig } from '#lib/server/context.ts';
import { readDesign } from '#lib/server/files.ts';
import type { RequestHandler } from './$types';

// The static build snapshots the design into a read-only JSON file.
export const prerender = true;

export const GET: RequestHandler = async () => {
	const config = await serverConfig();
	const files = await readDesign(config.root);
	return json({ files, readOnly: building, config: clientConfig(config) });
};
