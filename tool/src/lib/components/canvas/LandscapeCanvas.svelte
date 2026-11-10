<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		Controls,
		SvelteFlow,
		useSvelteFlow,
		useViewport,
		type Node
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { design } from '#lib/client/store.svelte.ts';
	import { theme } from '#lib/client/theme.svelte.ts';
	import type { ViewState } from '#lib/client/view-state.svelte.ts';
	import { layoutLandscape } from '#lib/landscape/layout.ts';
	import LandscapeNode, { type LandscapeNodeData } from './LandscapeNode.svelte';

	/** The whole model, fully expanded. It is laid out once; zooming only changes opacity. */
	let { view }: { view: ViewState } = $props();

	const flow = useSvelteFlow();
	const viewport = useViewport();
	const nodeTypes = { landscape: LandscapeNode };
	// A box counts as open once it fills this share of the canvas, where its children start
	// to fade in (see LandscapeNode).
	const OPEN = 0.55;

	let cw = $state(1);
	let ch = $state(1);
	let nodes = $state.raw<Node[]>([]);
	let fitted = false;

	const boxes = $derived(layoutLandscape(design.model));
	const el = (id: string) => design.model.elements.get(id);
	const fillOf = (b: { width: number; height: number }, zoom: number) =>
		Math.max((b.width * zoom) / cw, (b.height * zoom) / ch);

	// Discrete state derived from the camera. Joined into a string so a pan that changes
	// nothing stops here instead of rebuilding nodes every frame.
	const openKey = $derived.by(() => {
		const z = viewport.current.zoom;
		return boxes
			.filter((b) => el(b.id)?.childIds.length && fillOf(b, z) >= OPEN)
			.map((b) => b.id)
			.join(',');
	});
	const open = $derived(new Set(openKey.split(',').filter(Boolean)));

	$effect(() => {
		const sel = new Set(view.selectedNodes);
		nodes = boxes.map((b) => {
			const info = el(b.id)!;
			const parent = b.parentId ? boxes.find((p) => p.id === b.parentId) : undefined;
			return {
				id: b.id,
				type: 'landscape',
				position: { x: b.x, y: b.y },
				parentId: b.parentId,
				width: b.width,
				height: b.height,
				draggable: false,
				connectable: false,
				class: !b.parentId || open.has(b.parentId) ? undefined : 'ghost',
				style: [
					`--w:${b.width}`,
					`--h:${b.height}`,
					`--pw:${parent?.width ?? 1e6}`,
					`--ph:${parent?.height ?? 1e6}`
				].join(';'),
				data: {
					name: info.name,
					kind: info.def.kind,
					technology: info.def.technology,
					description: info.def.description,
					group: info.childIds.length > 0,
					selected: sel.has(b.id)
				} satisfies LandscapeNodeData
			};
		});
		if (!fitted && boxes.length) {
			fitted = true;
			requestAnimationFrame(() => requestAnimationFrame(() => flow.fitView({ padding: 0.08 })));
		}
	});
</script>

<div
	class="canvas"
	bind:clientWidth={cw}
	bind:clientHeight={ch}
	style:--z={viewport.current.zoom}
	style:--cw={cw}
	style:--ch={ch}
	data-testid="canvas"
>
	<SvelteFlow
		bind:nodes
		{nodeTypes}
		colorMode={theme.current}
		minZoom={0.05}
		maxZoom={4}
		nodesDraggable={false}
		nodesConnectable={false}
		elementsSelectable={false}
		zoomOnDoubleClick={false}
		onnodeclick={({ node }) => (view.selectedNodes = [node.id])}
		onpaneclick={() => (view.selectedNodes = [])}
	>
		<Background
			variant={BackgroundVariant.Dots}
			gap={20}
			patternColor="var(--sdv-grid)"
			bgColor="var(--sdv-canvas-bg)"
		/>
		<Controls showLock={false} />
	</SvelteFlow>
</div>

<style>
	.canvas {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	.canvas :global(.svelte-flow__node) {
		border: none;
		background: transparent;
		padding: 0;
		border-radius: 0;
		box-shadow: none;
	}
	.canvas :global(.svelte-flow__node.ghost) {
		pointer-events: none;
	}
</style>
