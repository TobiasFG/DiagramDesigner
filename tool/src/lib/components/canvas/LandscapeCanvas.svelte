<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		Controls,
		MarkerType,
		SvelteFlow,
		useSvelteFlow,
		useViewport,
		type Edge,
		type Node
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { design } from '#lib/client/store.svelte.ts';
	import { theme } from '#lib/client/theme.svelte.ts';
	import type { ViewState } from '#lib/client/view-state.svelte.ts';
	import { layoutLandscape, modelLinks, refLabel } from '#lib/landscape/layout.ts';
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
	let edges = $state.raw<Edge[]>([]);
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
			.filter((b) => b.group && fillOf(b, z) >= OPEN)
			.map((b) => b.id)
			.join(',');
	});
	const open = $derived(new Set(openKey.split(',').filter(Boolean)));

	$effect(() => {
		const sel = new Set(view.selectedNodes);
		nodes = boxes.map((b) => {
			const info = el(b.elementId)!;
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
					group: b.group,
					selected: sel.has(b.id),
					owner: b.ref ? el(info.parentId ?? '')?.name : undefined,
					fields: info.def.fields,
					indexes: info.def.indexes,
					table: b.table,
					refLabels: Object.fromEntries(
						(info.def.fields ?? []).flatMap((f) => {
							const label = f.ref && refLabel(design.model, f.ref);
							return label ? [[f.ref, label]] : [];
						})
					)
				} satisfies LandscapeNodeData
			};
		});
		// Lines fade with their box's children, through the same CSS variables as the nodes.
		edges = modelLinks(design.model, boxes).map((l) => {
			const parent = l.parentId ? boxes.find((p) => p.id === l.parentId) : undefined;
			return {
				...l,
				// Svelte Flow adds this to the higher level of the two tables, so the line sits
				// one level below them: under the tables, over their module.
				zIndex: -1,
				type: 'smoothstep',
				pathOptions: { borderRadius: 0 },
				class: 'model-link',
				markerEnd: {
					type: MarkerType.ArrowClosed,
					width: 14,
					height: 14,
					color: 'var(--sdv-edge)'
				},
				domAttributes: {
					style: `--pw:${parent?.width ?? 1e6};--ph:${parent?.height ?? 1e6}`
				}
			};
		});
		if (!fitted && boxes.length) {
			fitted = true;
			// Systems differ in size, so cap the zoom where the largest one would start to open:
			// the overview shows every system closed, none halfway through fading.
			const roots = boxes.filter((b) => !b.parentId);
			const maxZoom =
				Math.min(...roots.map((b) => 0.5 * Math.min(cw / b.width, ch / b.height))) * 0.98;
			requestAnimationFrame(() =>
				requestAnimationFrame(() => flow.fitView({ padding: 0.08, maxZoom }))
			);
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
		{edges}
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
	.canvas :global(.svelte-flow__edge.model-link) {
		--pf: max(calc(var(--pw) * var(--z) / var(--cw)), calc(var(--ph) * var(--z) / var(--ch)));
		opacity: clamp(0, calc((var(--pf) - 0.55) / 0.15), 1);
		pointer-events: none;
	}
	.canvas :global(.model-link .svelte-flow__edge-path) {
		stroke: var(--sdv-edge);
	}
	.canvas :global(.svelte-flow__node.ghost) {
		pointer-events: none;
	}
</style>
