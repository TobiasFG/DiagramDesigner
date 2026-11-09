<script lang="ts">
	import { design } from '$lib/client/store.svelte';
	import { theme } from '$lib/client/theme.svelte';
	import type { ViewState } from '$lib/client/view-state.svelte';
	import {
		exportBaseName,
		renderedToMermaid,
		renderedToSvg,
		type Rendered
	} from '$lib/export/render';
	import type { Projection } from '$lib/projections/types';

	let { view, projection }: { view: ViewState; projection: Projection } = $props();

	const rendered = $derived.by((): Rendered | undefined => {
		if (projection.kind === 'sequence')
			return view.seqLayout ? { kind: 'sequence', projection, layout: view.seqLayout } : undefined;
		return view.positioned ? { kind: 'graph', projection, positioned: view.positioned } : undefined;
	});
	const base = $derived(exportBaseName(design.model, projection.viewId));

	function download(blob: Blob, name: string) {
		const url = URL.createObjectURL(blob);
		const a = Object.assign(document.createElement('a'), { href: url, download: name });
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	function mermaid(): string {
		const m = renderedToMermaid(rendered!);
		if (m.warnings.length) design.notify('info', `Mermaid export: ${m.warnings.join('; ')}`);
		return m.text;
	}

	async function copyMermaid() {
		await navigator.clipboard.writeText('```mermaid\n' + mermaid() + '```\n');
		design.notify('info', 'Mermaid block copied to the clipboard');
	}

	async function png() {
		const svg = renderedToSvg(rendered!, theme.current);
		const [, , w, h] = (/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg) ?? [])
			.slice(1)
			.map(Number);
		const img = new Image();
		img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
		await img.decode();
		const canvas = Object.assign(document.createElement('canvas'), { width: w * 2, height: h * 2 });
		const c2d = canvas.getContext('2d')!;
		c2d.scale(2, 2);
		c2d.drawImage(img, 0, 0, w, h);
		URL.revokeObjectURL(img.src);
		canvas.toBlob((b) => b && download(b, `${base}.png`), 'image/png');
	}
</script>

<details class="menu">
	<summary>Export</summary>
	<div class="items">
		<button disabled={!rendered} onclick={copyMermaid}>Copy Mermaid block</button>
		<button
			disabled={!rendered}
			onclick={() => download(new Blob([mermaid()], { type: 'text/plain' }), `${base}.mmd`)}
			>Mermaid (.mmd)</button
		>
		<button
			disabled={!rendered}
			onclick={() =>
				download(
					new Blob([renderedToSvg(rendered!, theme.current)], { type: 'image/svg+xml' }),
					`${base}.svg`
				)}
			data-testid="export-svg">SVG ({theme.current})</button
		>
		<button disabled={!rendered} onclick={png}>PNG 2x ({theme.current})</button>
		<p class="muted">For CI, use <code>sdv export</code>.</p>
	</div>
</details>

<style>
	.menu {
		position: relative;
	}
	summary {
		list-style: none;
		cursor: pointer;
		padding: 4px 10px;
		border: 1px solid var(--ui-border);
		border-radius: 6px;
		background: var(--ui-panel);
		line-height: 20px;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.items {
		position: absolute;
		right: 0;
		top: calc(100% + 4px);
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 200px;
		padding: 6px;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		border-radius: 8px;
		box-shadow: var(--ui-shadow);
	}
	.items button {
		text-align: left;
		border: none;
	}
	p {
		margin: 4px 8px 2px;
		font-size: 12px;
	}
</style>
