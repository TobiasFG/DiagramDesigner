<script lang="ts">
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import { ViewState } from '#lib/client/view-state.svelte.ts';
	import LandscapeCanvas from '#lib/components/canvas/LandscapeCanvas.svelte';

	const view = new ViewState();
</script>

<div class="landscape">
	<div class="workspace">
		<SvelteFlowProvider>
			<LandscapeCanvas {view} />
		</SvelteFlowProvider>
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
