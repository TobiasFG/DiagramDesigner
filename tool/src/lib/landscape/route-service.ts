import { loadRouter, routeLines, type Point, type Rect, type RouteLine } from './route.ts';

/**
 * Routing in a worker (route-worker.ts), so it never holds up the page: what the page asks
 * (`ToRouter`) and what the worker answers (`FromRouter`). The page sends the boxes once per
 * layout, numbered, and then sets of lines to route among them.
 */
export type ToRouter =
	| { type: 'load'; wasmUrl?: string }
	| { type: 'boxes'; ver: number; boxes: Map<string, Rect> }
	| {
			type: 'route';
			id: number;
			ver: number;
			lines: RouteLine[];
	  };

export type FromRouter =
	| { type: 'loaded' }
	| { type: 'failed'; error: string }
	/** `routes` is missing when the lines were sent for boxes since replaced, or failed. */
	| {
			type: 'routed';
			id: number;
			ver: number;
			routes?: Map<string, Point[]>;
			ms: number;
			error?: string;
	  };

/**
 * The worker's side: answers each message with `reply`, in the order they came, so lines sent
 * while libavoid loads are routed once it has.
 */
export function routeService(reply: (m: FromRouter) => void) {
	let boxes = new Map<string, Rect>();
	let ver = -1;
	let chain = Promise.resolve();
	async function handle(m: ToRouter) {
		if (m.type === 'load') {
			try {
				await loadRouter(m.wasmUrl);
				reply({ type: 'loaded' });
			} catch (e) {
				reply({ type: 'failed', error: String(e) });
			}
		} else if (m.type === 'boxes') {
			boxes = m.boxes;
			ver = m.ver;
		} else {
			const t0 = performance.now();
			const out = { type: 'routed' as const, id: m.id, ver: m.ver };
			try {
				const routes = m.ver !== ver ? undefined : routeLines(boxes, m.lines);
				reply({ ...out, routes, ms: performance.now() - t0 });
			} catch (e) {
				reply({ ...out, ms: performance.now() - t0, error: String(e) });
			}
		}
	}
	return (m: ToRouter) => (chain = chain.then(() => handle(m)));
}
