import type { ThemeName } from '../config';

/**
 * Design tokens. The canvas references them as CSS custom properties (`var(--sdv-*)`) so the
 * theme switches without re-rendering; exporters inline the literal values.
 * Element colours follow the C4 model palette.
 */
const light = {
	'canvas-bg': '#ffffff',
	grid: '#e5e7eb',
	text: '#1f2328',
	'text-muted': '#59636e',
	'text-inverse': '#ffffff',
	edge: '#5b6470',
	'edge-label-bg': '#ffffff',
	'edge-highlight': '#d9480f',
	selection: '#2f81f7',
	'badge-fill': '#d9480f',
	'badge-text': '#ffffff',

	'person-fill': '#08427b',
	'person-stroke': '#052e56',
	'person-text': '#ffffff',
	'system-fill': '#1168bd',
	'system-stroke': '#0b4884',
	'system-text': '#ffffff',
	'container-fill': '#438dd5',
	'container-stroke': '#2e6295',
	'container-text': '#ffffff',
	'component-fill': '#85bbf0',
	'component-stroke': '#5d82a8',
	'component-text': '#0b2540',
	'external-fill': '#8a8a8a',
	'external-stroke': '#606060',
	'external-text': '#ffffff',
	'datastore-fill': '#438dd5',
	'datastore-stroke': '#2e6295',
	'datastore-text': '#ffffff',
	'queue-fill': '#438dd5',
	'queue-stroke': '#2e6295',
	'queue-text': '#ffffff',
	'boundary-fill': 'rgba(17, 104, 189, 0.04)',
	'boundary-stroke': '#8aa4bf',
	'boundary-text': '#34506b',

	'class-fill': '#fffdf5',
	'class-header': '#fbf1c7',
	'class-stroke': '#8a7a3c',
	'class-text': '#1f2328',
	'object-fill': '#f6fbff',
	'object-header': '#dcecfb',
	'object-stroke': '#4d7aa6',

	'flow-terminal-fill': '#2da44e',
	'flow-terminal-text': '#ffffff',
	'flow-end-fill': '#cf222e',
	'flow-action-fill': '#eef4ff',
	'flow-decision-fill': '#fff4d6',
	'flow-io-fill': '#eefbf3',
	'flow-subflow-fill': '#f3eefe',
	'flow-stroke': '#5b6470',
	'lane-fill': 'rgba(91, 100, 112, 0.04)',
	'lane-stroke': '#c9d1d9',
	'lane-header': '#eaeef2',

	'stage-fill': 'rgba(130, 80, 223, 0.05)',
	'stage-stroke': '#a78bdb',
	'stage-text': '#4a2a8a',
	'job-fill': '#ffffff',
	'job-stroke': '#8c959f',
	'artifact-fill': '#fff8e6',
	'artifact-stroke': '#b08800',
	'status-success': '#2da44e',
	'status-failed': '#cf222e',
	'status-running': '#bf8700',
	'status-pending': '#8c959f',

	'seq-header-fill': '#eef4ff',
	'seq-header-stroke': '#4d7aa6',
	'seq-lifeline': '#8c959f',
	'seq-activation-fill': '#dcecfb',
	'fragment-stroke': '#8c959f',
	'fragment-label-fill': '#eaeef2',
	'note-fill': '#fff8c5',
	'note-stroke': '#d4a72c',
	'note-text': '#3b2300'
};

export type Token = keyof typeof light;

const dark: Record<Token, string> = {
	'canvas-bg': '#0d1117',
	grid: '#21262d',
	text: '#e6edf3',
	'text-muted': '#9198a1',
	'text-inverse': '#0d1117',
	edge: '#8b949e',
	'edge-label-bg': '#0d1117',
	'edge-highlight': '#ff8a4c',
	selection: '#4493f8',
	'badge-fill': '#ff8a4c',
	'badge-text': '#0d1117',

	'person-fill': '#0b4a8b',
	'person-stroke': '#3d7fc4',
	'person-text': '#ffffff',
	'system-fill': '#155ea8',
	'system-stroke': '#4a8fd6',
	'system-text': '#ffffff',
	'container-fill': '#2f6fae',
	'container-stroke': '#5b9ad8',
	'container-text': '#ffffff',
	'component-fill': '#274b6d',
	'component-stroke': '#5b86b0',
	'component-text': '#e6edf3',
	'external-fill': '#4b5058',
	'external-stroke': '#7d838c',
	'external-text': '#ffffff',
	'datastore-fill': '#2f6fae',
	'datastore-stroke': '#5b9ad8',
	'datastore-text': '#ffffff',
	'queue-fill': '#2f6fae',
	'queue-stroke': '#5b9ad8',
	'queue-text': '#ffffff',
	'boundary-fill': 'rgba(88, 166, 255, 0.05)',
	'boundary-stroke': '#3d5a78',
	'boundary-text': '#9cc3eb',

	'class-fill': '#161b22',
	'class-header': '#2b2610',
	'class-stroke': '#8d7c3a',
	'class-text': '#e6edf3',
	'object-fill': '#161b22',
	'object-header': '#132a42',
	'object-stroke': '#3d6f9e',

	'flow-terminal-fill': '#238636',
	'flow-terminal-text': '#ffffff',
	'flow-end-fill': '#b62324',
	'flow-action-fill': '#132033',
	'flow-decision-fill': '#2b2610',
	'flow-io-fill': '#10261a',
	'flow-subflow-fill': '#221a33',
	'flow-stroke': '#8b949e',
	'lane-fill': 'rgba(139, 148, 158, 0.05)',
	'lane-stroke': '#30363d',
	'lane-header': '#161b22',

	'stage-fill': 'rgba(163, 113, 247, 0.07)',
	'stage-stroke': '#6e4fb0',
	'stage-text': '#d2bcff',
	'job-fill': '#161b22',
	'job-stroke': '#6e7681',
	'artifact-fill': '#2b2610',
	'artifact-stroke': '#bb8009',
	'status-success': '#3fb950',
	'status-failed': '#f85149',
	'status-running': '#d29922',
	'status-pending': '#6e7681',

	'seq-header-fill': '#132033',
	'seq-header-stroke': '#3d6f9e',
	'seq-lifeline': '#6e7681',
	'seq-activation-fill': '#1c3553',
	'fragment-stroke': '#6e7681',
	'fragment-label-fill': '#21262d',
	'note-fill': '#2e2a10',
	'note-stroke': '#9e6a03',
	'note-text': '#f0e6c0'
};

export const THEMES: Record<ThemeName, Record<Token, string>> = { light, dark };

export const TOKENS = Object.keys(light) as Token[];

/** Resolves a token to what ends up in the SVG `fill`/`stroke` attributes. */
export type TokenResolver = (token: Token) => string;

export const cssVarResolver: TokenResolver = (t) => `var(--sdv-${t})`;

export function literalResolver(theme: ThemeName): TokenResolver {
	const values = THEMES[theme];
	return (t) => values[t];
}

/** CSS declaring every token for both themes; `data-theme` on an ancestor selects one. */
export function themeCss(): string {
	const block = (values: Record<Token, string>) =>
		TOKENS.map((t) => `  --sdv-${t}: ${values[t]};`).join('\n');
	return `:root, [data-theme='light'] {\n${block(light)}\n  color-scheme: light;\n}\n[data-theme='dark'] {\n${block(dark)}\n  color-scheme: dark;\n}\n`;
}
