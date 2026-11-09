import { json } from '@sveltejs/kit';
import { building } from '$app/environment';
import { clientConfig } from '$lib/config';
import { serverConfig } from '$lib/server/context';
import { readDesign } from '$lib/server/files';
import type { RequestHandler } from './$types';

// The static build snapshots the design into a read-only JSON file.
export const prerender = true;

export const GET: RequestHandler = async () => {
	const config = await serverConfig();
	const files = await readDesign(config.root);
	return json({ files, readOnly: building, config: clientConfig(config) });
};
