import type { LayoutFile } from './schema';

/**
 * Stable layout JSON: fixed key order, entries sorted by id, one line per node/edge entry,
 * integer coordinates. Keeps diffs to the lines of the nodes that actually moved.
 */

const NODE_KEYS = ['x', 'y', 'w', 'h', 'pinned', 'collapsed'] as const;
const EDGE_KEYS = ['points', 'labelPos'] as const;

const inline = (v: unknown): string => {
	if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
	if (typeof v === 'object' && v !== null) {
		const parts = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`);
		return parts.length ? `{ ${parts.join(', ')} }` : '{}';
	}
	return JSON.stringify(v);
};

function ordered<T extends object>(entry: T, keys: readonly string[]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of keys) {
		const v = (entry as Record<string, unknown>)[k];
		if (v !== undefined) out[k] = v;
	}
	for (const [k, v] of Object.entries(entry)) if (!(k in out) && v !== undefined) out[k] = v;
	return out;
}

function block(entries: Record<string, object> | undefined, keys: readonly string[]): string {
	const ids = Object.keys(entries ?? {}).sort();
	if (!ids.length) return '{}';
	return `{\n${ids.map((id) => `    ${JSON.stringify(id)}: ${inline(ordered(entries![id], keys))}`).join(',\n')}\n  }`;
}

export function formatLayout(layout: LayoutFile): string {
	const lines = [`  "version": ${layout.version}`, `  "view": ${JSON.stringify(layout.view)}`];
	lines.push(`  "nodes": ${block(layout.nodes, NODE_KEYS)}`);
	lines.push(`  "edges": ${block(layout.edges, EDGE_KEYS)}`);
	if (layout.columns && Object.keys(layout.columns).length) {
		const ids = Object.keys(layout.columns).sort();
		lines.push(
			`  "columns": { ${ids.map((id) => `${JSON.stringify(id)}: ${layout.columns![id]}`).join(', ')} }`
		);
	}
	if (layout.viewport)
		lines.push(`  "viewport": ${inline(ordered(layout.viewport, ['x', 'y', 'zoom']))}`);
	return `{\n${lines.join(',\n')}\n}\n`;
}
