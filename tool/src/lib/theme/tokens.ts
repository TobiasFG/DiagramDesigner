import type { ThemeName } from '../config';

/**
 * Design tokens. The canvas references them as CSS custom properties (`var(--sdv-*)`) so the
 * theme switches without re-rendering; exporters inline the literal values.
 * Element colours follow the C4 model palette.
 */
const light = {
	'canvas-bg': '#f7f6f3',
	grid: '#e4e1da',
	text: '#1d1d1b',
	'text-muted': '#6e6c66',
	'text-inverse': '#ffffff',
	edge: '#8d8a83',
	'edge-label-bg': '#f7f6f3',
	'edge-highlight': '#d9480f',
	selection: '#5468d4',
	'badge-fill': '#d9480f',
	'badge-text': '#ffffff',

	'person-fill': '#08427b',
	'person-stroke': '#052e56',
	'person-text': '#ffffff',
	'system-fill': '#2f3b56',
	'system-stroke': '#263048',
	'system-text': '#ffffff',
	'container-fill': '#e9ecf3',
	'container-stroke': '#bcc4d6',
	'container-text': '#24304a',
	'component-fill': '#ffffff',
	'component-stroke': '#c9ccd3',
	'component-text': '#24304a',
	'external-fill': '#8a8a8a',
	'external-stroke': '#606060',
	'external-text': '#ffffff',
	'datastore-fill': '#438dd5',
	'datastore-stroke': '#2e6295',
	'datastore-text': '#ffffff',
	'queue-fill': '#438dd5',
	'queue-stroke': '#2e6295',
	'queue-text': '#ffffff',
	'boundary-fill': 'rgba(47, 59, 86, 0.025)',
	'boundary-stroke': '#cfcbc2',
	'boundary-text': '#4a4842',

	'class-fill': '#fffdf5',
	'class-header': '#fbf1c7',
	'class-stroke': '#8a7a3c',
	'class-text': '#1f2328',
	'object-fill': '#f6fbff',
	'object-header': '#dcecfb',
	'object-stroke': '#4d7aa6',
	'model-fill': '#ffffff',
	'model-header': '#f1efea',
	'model-stroke': '#d9d5cc',
	'model-text': '#1d1d1b',
	'model-key-fill': '#f4ead0',
	'model-key-text': '#73561a',

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
	'canvas-bg': '#141518',
	grid: '#222328',
	text: '#e9e7e3',
	'text-muted': '#9b9993',
	'text-inverse': '#0d1117',
	edge: '#76746f',
	'edge-label-bg': '#141518',
	'edge-highlight': '#ff8a4c',
	selection: '#7b8cf0',
	'badge-fill': '#ff8a4c',
	'badge-text': '#0d1117',

	'person-fill': '#0b4a8b',
	'person-stroke': '#3d7fc4',
	'person-text': '#ffffff',
	'system-fill': '#3a4868',
	'system-stroke': '#52628a',
	'system-text': '#ffffff',
	'container-fill': '#1f2431',
	'container-stroke': '#384056',
	'container-text': '#dfe4ef',
	'component-fill': '#1b1c20',
	'component-stroke': '#393a40',
	'component-text': '#dfe4ef',
	'external-fill': '#4b5058',
	'external-stroke': '#7d838c',
	'external-text': '#ffffff',
	'datastore-fill': '#2f6fae',
	'datastore-stroke': '#5b9ad8',
	'datastore-text': '#ffffff',
	'queue-fill': '#2f6fae',
	'queue-stroke': '#5b9ad8',
	'queue-text': '#ffffff',
	'boundary-fill': 'rgba(255, 255, 255, 0.02)',
	'boundary-stroke': '#35363c',
	'boundary-text': '#b6b4ae',

	'class-fill': '#161b22',
	'class-header': '#2b2610',
	'class-stroke': '#8d7c3a',
	'class-text': '#e6edf3',
	'object-fill': '#161b22',
	'object-header': '#132a42',
	'object-stroke': '#3d6f9e',
	'model-fill': '#1b1c20',
	'model-header': '#24252a',
	'model-stroke': '#36373d',
	'model-text': '#e9e7e3',
	'model-key-fill': '#3a3120',
	'model-key-text': '#e3c47c',

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
