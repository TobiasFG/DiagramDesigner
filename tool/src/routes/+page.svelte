<script lang="ts">
	import { resolve } from '$app/paths';
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import { design } from '#lib/client/store.svelte.ts';
	import { ViewState } from '#lib/client/view-state.svelte.ts';
	import LandscapeCanvas from '#lib/components/canvas/LandscapeCanvas.svelte';
	import PropertiesPanel from '#lib/components/panel/PropertiesPanel.svelte';
	import { projectLandscape } from '#lib/projections/index.ts';

	const view = new ViewState();
	// Everything open: the layout is computed once for the full tree and zoom only fades.
	const projection = $derived(
		projectLandscape(
			design.model,
			new Set([...design.model.elements.values()].filter((e) => e.childIds.length).map((e) => e.id))
		)
	);
</script>

<div class="landscape">
	<div class="bar">
		<h1>Application landscape</h1>
		<span class="muted">Zoom in or click a box to open it; click a connection to follow it</span>
		<span class="spacer"></span>
		<a href={resolve('/views')}>All views</a>
	</div>
	<div class="workspace">
		<SvelteFlowProvider>
			<LandscapeCanvas {view} {projection} />
		</SvelteFlowProvider>
		<PropertiesPanel {view} {projection} />
	</div>
</div>

<style>
	.landscape {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 10px;
		border-bottom: 1px solid var(--ui-border);
		background: var(--ui-panel);
	}
	h1 {
		font-size: 15px;
		margin: 0;
	}
	.spacer {
		flex: 1;
	}
	.workspace {
		flex: 1;
		min-height: 0;
		display: flex;
	}
</style>
