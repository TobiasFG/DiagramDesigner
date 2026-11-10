<script lang="ts">
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
	.workspace {
		flex: 1;
		min-height: 0;
		display: flex;
	}
</style>
