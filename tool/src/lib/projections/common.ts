import type { LayoutOptions, View } from '../model/schema';
import type { GraphLayoutOptions } from './types';

export function graphLayoutOptions(
	view: View,
	defaults: Partial<GraphLayoutOptions> = {}
): GraphLayoutOptions {
	const l: LayoutOptions = view.layout ?? {};
	return {
		algorithm: l.algorithm ?? defaults.algorithm ?? 'layered',
		direction: l.direction ?? defaults.direction ?? 'DOWN',
		spacing: l.spacing ?? defaults.spacing ?? 60,
		lanes: defaults.lanes
	};
}

/** Assigns `<from>-><to>#<index>` keys, counting parallel links per pair in order. */
export function pairKeys(): (from: string, to: string) => string {
	const counts = new Map<string, number>();
	return (from, to) => {
		const pair = `${from}->${to}`;
		const n = counts.get(pair) ?? 0;
		counts.set(pair, n + 1);
		return `${pair}#${n}`;
	};
}
