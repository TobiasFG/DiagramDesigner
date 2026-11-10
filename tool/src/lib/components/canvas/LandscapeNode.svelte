<script lang="ts" module>
	export interface LandscapeNodeData extends Record<string, unknown> {
		name: string;
		kind: string;
		technology?: string;
		description?: string;
		group: boolean;
		selected: boolean;
	}
</script>

<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';

	let { data, width = 0, height = 0 }: NodeProps = $props();
	const d = $derived(data as LandscapeNodeData);
	// The closed face scales with the box, so a system reads the same at any size.
	const font = $derived(Math.min(width * 0.085, height * 0.2, d.group ? 999 : 15));
</script>

<!-- Opacity comes from CSS variables set on the canvas (--z, --cw, --ch) and on the node
     wrapper (--w, --h, --pw, --ph), so zooming never re-renders nodes. -->
<div
	class="node"
	class:group={d.group}
	class:selected={d.selected}
	style:--fill="var(--sdv-{d.kind}-fill, var(--sdv-container-fill))"
	style:--stroke="var(--sdv-{d.kind}-stroke, var(--sdv-container-stroke))"
	style:--text="var(--sdv-{d.kind}-text, var(--sdv-container-text))"
	style:--hdr="{Math.max(8, height * 0.06)}px"
>
	{#if d.group}
		<div class="header">{d.name}</div>
	{/if}
	<div class="face" style:font-size="{font}px">
		<div class="name">{d.name}</div>
		{#if d.technology}<div class="tech">[{d.technology}]</div>{/if}
		{#if d.description}<div class="desc">{d.description}</div>{/if}
	</div>
</div>

<style>
	.node {
		/* How much of the canvas the parent fills. The parent's face fades out between 0.5 and
		   0.6, then its children fade in between 0.55 and 0.7, so labels never overlap. */
		--pf: max(calc(var(--pw) * var(--z) / var(--cw)), calc(var(--ph) * var(--z) / var(--ch)));
		--vis: clamp(0, calc((var(--pf) - 0.55) / 0.15), 1);
		--open: 0;
		position: relative;
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		border-radius: 8px;
		opacity: var(--vis);
		cursor: pointer;
	}
	.node.group {
		--own: max(calc(var(--w) * var(--z) / var(--cw)), calc(var(--h) * var(--z) / var(--ch)));
		--open: clamp(0, calc((var(--own) - 0.5) / 0.1), 1);
		border: 1.5px dashed var(--sdv-boundary-stroke);
		background: var(--sdv-boundary-fill);
	}
	.node.selected {
		outline: 2px solid var(--sdv-selection);
		outline-offset: 2px;
	}
	.face {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.2em;
		padding: 0.4em;
		box-sizing: border-box;
		text-align: center;
		border-radius: inherit;
		background: var(--fill);
		border: 1px solid var(--stroke);
		color: var(--text);
		opacity: calc(1 - var(--open));
		pointer-events: none;
	}
	.name {
		font-weight: 600;
	}
	.tech,
	.desc {
		font-size: 0.7em;
		opacity: 0.85;
	}
	.header {
		position: absolute;
		left: 0.6em;
		top: 0.3em;
		font-size: min(calc(14px / var(--z)), var(--hdr));
		font-weight: 600;
		color: var(--sdv-boundary-text);
		opacity: var(--open);
		white-space: nowrap;
		pointer-events: none;
	}
</style>
