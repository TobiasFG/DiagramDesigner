/**
 * Design tokens. The canvas references them as CSS custom properties (`var(--sdv-*)`) so the
 * theme switches without re-rendering.
 */
const light = {
	'canvas-bg': '#f7f6f3',
	grid: '#e4e1da',
	'text-muted': '#6e6c66',
	edge: '#8d8a83',
	selection: '#5468d4',

	'system-fill': '#2f3b56',
	'system-stroke': '#263048',
	'system-text': '#ffffff',
	'container-fill': '#e9ecf3',
	'container-stroke': '#bcc4d6',
	'container-text': '#24304a',
	'boundary-fill': 'rgba(47, 59, 86, 0.025)',
	'boundary-stroke': '#cfcbc2',
	'boundary-text': '#4a4842',

	'model-fill': '#ffffff',
	'model-header': '#f1efea',
	'model-class-head': '#e9ecf3',
	'model-stroke': '#d9d5cc',
	'model-text': '#1d1d1b',
	'model-key-fill': '#f4ead0',
	'model-key-text': '#73561a'
};

export type Token = keyof typeof light;

const dark: Record<Token, string> = {
	'canvas-bg': '#141518',
	grid: '#222328',
	'text-muted': '#9b9993',
	edge: '#76746f',
	selection: '#7b8cf0',

	'system-fill': '#3a4868',
	'system-stroke': '#52628a',
	'system-text': '#ffffff',
	'container-fill': '#1f2431',
	'container-stroke': '#384056',
	'container-text': '#dfe4ef',
	'boundary-fill': 'rgba(255, 255, 255, 0.02)',
	'boundary-stroke': '#35363c',
	'boundary-text': '#b6b4ae',

	'model-fill': '#1b1c20',
	'model-header': '#24252a',
	'model-class-head': '#1f2431',
	'model-stroke': '#36373d',
	'model-text': '#e9e7e3',
	'model-key-fill': '#3a3120',
	'model-key-text': '#e3c47c'
};

export const TOKENS = Object.keys(light) as Token[];

/** CSS declaring every token for both themes; `data-theme` on an ancestor selects one. */
export function themeCss(): string {
	const block = (values: Record<Token, string>) =>
		TOKENS.map((t) => `  --sdv-${t}: ${values[t]};`).join('\n');
	return `:root, [data-theme='light'] {\n${block(light)}\n  color-scheme: light;\n}\n[data-theme='dark'] {\n${block(dark)}\n  color-scheme: dark;\n}\n`;
}
