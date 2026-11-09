import { error, json } from '@sveltejs/kit';
import { building } from '$app/environment';
import { serverConfig } from '$lib/server/context';
import { enqueueWrite, type WriteRequest } from '$lib/server/write';
import type { RequestHandler } from './$types';

export const prerender = false;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export const POST: RequestHandler = async ({ request, getClientAddress, url }) => {
	if (building) error(403, 'The static build is read-only');
	// Only the local browser may write: loopback client, same-origin JSON requests.
	if (!LOOPBACK.has(getClientAddress())) error(403, 'Writes are only accepted from localhost');
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) error(403, 'Cross-origin writes are not allowed');
	if (!request.headers.get('content-type')?.startsWith('application/json'))
		error(415, 'Expected application/json');
	const body = (await request.json()) as WriteRequest;
	const config = await serverConfig();
	const result = await enqueueWrite(config.root, body);
	return json(result, { status: result.status });
};
