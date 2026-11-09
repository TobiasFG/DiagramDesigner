import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkLike } from './types';

/** In-process ELK for Node (CLI, tests). The browser uses the Web Worker build instead. */
export function createNodeElk(): ElkLike {
	return new ELK() as unknown as ElkLike;
}
