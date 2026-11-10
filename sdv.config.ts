import type { SdvConfig } from './tool/src/lib/config';

export default {
	// Design content; override with SDV_ROOT to point at another repository.
	root: 'design',
	exportDir: 'docs/diagrams',
	formats: ['mermaid', 'svg'],
	theme: 'light'
} satisfies SdvConfig;
