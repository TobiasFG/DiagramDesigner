import ELK from 'elkjs/lib/elk-api.js';
import workerUrl from 'elkjs/lib/elk-worker.min.js?url';
import type { ElkLike } from './types';

let elk: ElkLike | undefined;

/** ELK running in a Web Worker so layout never blocks the canvas. */
export function browserElk(): ElkLike {
	elk ??= new ELK({ workerUrl }) as unknown as ElkLike;
	return elk;
}
