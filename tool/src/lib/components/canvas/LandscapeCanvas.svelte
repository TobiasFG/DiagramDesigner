<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		Controls,
		SvelteFlow,
		ViewportPortal,
		useSvelteFlow,
		useViewport,
		type Node
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { design } from '$lib/client/store.svelte';
	import { theme } from '$lib/client/theme.svelte';
	import type { ViewState } from '$lib/client/view-state.svelte';
	import { contextFor, type ContextEdge } from '$lib/landscape/context';
	import { browserElk } from '$lib/layout/elk-browser';
	import { layoutGraph } from '$lib/layout/layout';
	import type { Box, PositionedGraph } from '$lib/layout/types';
	import type { RenderGraph } from '$lib/projections/types';
	import LandscapeNode, { type LandscapeNodeData } from './LandscapeNode.svelte';

	/** The whole model, fully expanded. It is laid out once; zooming only changes opacity. */
	let { view, projection }: { view: ViewState; projection: RenderGraph } = $props();

	const flow = useSvelteFlow();
	const viewport = useViewport();
	const nodeTypes = { landscape: LandscapeNode };
	const FLY = 700;
	// A box counts as open once it fills this share of the canvas, where its children start
	// to fade in (see LandscapeNode).
	const OPEN = 0.55;

	let cw = $state(1);
	let ch = $state(1);
	let placed = $state.raw<PositionedGraph | null>(null);
	let nodes = $state.raw<Node[]>([]);
	let run = 0;
	let fitted = false;

	$effect(() => {
		const seq = ++run;
		layoutGraph(projection, undefined, browserElk())
			.then((pg) => {
				if (seq !== run) return;
				placed = pg;
				view.positioned = pg;
				if (fitted) return;
				fitted = true;
				requestAnimationFrame(() => requestAnimationFrame(() => flow.fitView({ padding: 0.08 })));
			})
			.catch((err) => design.notify('error', `Layout failed: ${(err as Error).message}`));
	});

	const boxes = $derived(
		new Map<string, Box>(
			(placed?.nodes ?? []).map((n) => [
				n.node.id,
				{ x: n.absX, y: n.absY, width: n.width, height: n.height }
			])
		)
	);
	const el = (id: string) => design.model.elements.get(id);
	const fillOf = (b: Box, zoom: number) => Math.max((b.width * zoom) / cw, (b.height * zoom) / ch);

	// Discrete state derived from the camera. Joined into strings so a pan that changes
	// nothing stops here instead of rebuilding nodes and edges every frame.
	const openKey = $derived.by(() => {
		const z = viewport.current.zoom;
		return [...boxes]
			.filter(([id, b]) => el(id)?.childIds.length && fillOf(b, z) >= OPEN)
			.map(([id]) => id)
			.join(',');
	});
	const open = $derived(new Set(openKey.split(',').filter(Boolean)));
	const visible = $derived(
		new Set(
			[...design.model.elements.values()]
				.filter((e) => !e.parentId || open.has(e.parentId))
				.map((e) => e.id)
		)
	);
	/** Deepest open box under the centre of the canvas. */
	const focus = $derived.by(() => {
		const { x, y, zoom } = viewport.current;
		const cx = (cw / 2 - x) / zoom;
		const cy = (ch / 2 - y) / zoom;
		let best: string | undefined;
		for (const id of open) {
			const b = boxes.get(id)!;
			if (cx < b.x || cy < b.y || cx > b.x + b.width || cy > b.y + b.height) continue;
			if (!best || el(id)!.depth > el(best)!.depth) best = id;
		}
		return best;
	});
	const ctx = $derived(contextFor(design.model, focus, visible));

	$effect(() => {
		const sel = new Set(view.selectedNodes);
		nodes = (placed?.nodes ?? []).map((n) => {
			const info = el(n.node.id)!;
			const parent = n.node.parentId ? boxes.get(n.node.parentId) : undefined;
			const rel = ctx.relevant.has(n.node.id) ? 1 : ctx.framing.has(n.node.id) ? 0.4 : 0.12;
			const shown = visible.has(n.node.id) || ctx.forced.has(n.node.id);
			return {
				id: n.node.id,
				type: 'landscape',
				position: { x: n.x, y: n.y },
				parentId: n.node.parentId,
				width: n.width,
				height: n.height,
				draggable: false,
				connectable: false,
				class: shown ? undefined : 'ghost',
				style: [
					`--w:${n.width}`,
					`--h:${n.height}`,
					`--pw:${parent?.width ?? 1e6}`,
					`--ph:${parent?.height ?? 1e6}`,
					`--rel:${rel}`,
					`--force:${ctx.forced.has(n.node.id) ? 1 : 0}`
				].join(';'),
				data: {
					name: info.name,
					kind: info.def.kind,
					technology: info.def.technology,
					description: info.def.description,
					group: info.childIds.length > 0,
					selected: sel.has(n.node.id)
				} satisfies LandscapeNodeData
			};
		});
	});

	function flyTo(id: string) {
		const b = boxes.get(id);
		if (b) flow.fitBounds(b, { padding: 0.12, duration: FLY });
	}
	const flyHome = () => placed && flow.fitBounds(placed.bounds, { padding: 0.08, duration: FLY });

	const inFocus = (id: string) => {
		for (let cur: string | undefined = id; cur; cur = el(cur)?.parentId)
			if (cur === focus) return true;
		return false;
	};

	/** Flies to the far end of a connection; a single API opens as its parent. */
	function followEdge(e: ContextEdge) {
		const far =
			focus && !inFocus(e.target) ? e.target : focus && !inFocus(e.source) ? e.source : e.target;
		flyTo(el(far)!.childIds.length ? far : (el(far)!.parentId ?? far));
	}

	const trail = $derived.by(() => {
		const out: { id: string; name: string }[] = [];
		for (let cur = focus; cur; cur = el(cur)?.parentId)
			out.unshift({ id: cur, name: el(cur)!.name });
		return out;
	});

	// ---------------------------------------------------------------- edge geometry
	/** Where the line from the centre of `b` towards (tx, ty) leaves the box. */
	function exit(b: Box, tx: number, ty: number): [number, number] {
		const cx = b.x + b.width / 2;
		const cy = b.y + b.height / 2;
		const dx = tx - cx;
		const dy = ty - cy;
		const s = Math.min(b.width / 2 / (Math.abs(dx) || 1e-9), b.height / 2 / (Math.abs(dy) || 1e-9));
		return [cx + dx * s, cy + dy * s];
	}

	const lines = $derived(
		ctx.edges.flatMap((e) => {
			const a = boxes.get(e.source);
			const b = boxes.get(e.target);
			if (!a || !b) return [];
			const [x1, y1] = exit(a, b.x + b.width / 2, b.y + b.height / 2);
			const [x2, y2] = exit(b, a.x + a.width / 2, a.y + a.height / 2);
			return [{ e, x1, y1, x2, y2, angle: Math.atan2(y2 - y1, x2 - x1) }];
		})
	);
	const z = $derived(viewport.current.zoom);
	const arrow = (x: number, y: number, t: number) => {
		const s = 9 / z;
		const p = (a: number) => `${x - s * Math.cos(t + a)},${y - s * Math.sin(t + a)}`;
		return `${x},${y} ${p(0.45)} ${p(-0.45)}`;
	};
	/** A line crossing the focus boundary is labelled near its end inside the focus, on screen. */
	function labelAt(l: (typeof lines)[number]): [number, number] {
		const inside = [inFocus(l.e.source), inFocus(l.e.target)];
		const len = Math.hypot(l.x2 - l.x1, l.y2 - l.y1);
		const t = !focus || inside[0] === inside[1] ? 0.5 : Math.min(0.5, 120 / z / len);
		const k = inside[1] && !inside[0] ? 1 - t : t;
		return [l.x1 + (l.x2 - l.x1) * k, l.y1 + (l.y2 - l.y1) * k];
	}
</script>

<div
	class="canvas"
	bind:clientWidth={cw}
	bind:clientHeight={ch}
	style:--z={z}
	style:--cw={cw}
	style:--ch={ch}
	data-testid="canvas"
>
	<nav class="trail" aria-label="Zoom path">
		<button onclick={flyHome}>Landscape</button>
		{#each trail as t (t.id)}
			<span>›</span>
			<button onclick={() => flyTo(t.id)}>{t.name}</button>
		{/each}
	</nav>
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
		onnodeclick={({ node }) => {
			view.selectedNodes = [node.id];
			if (el(node.id)?.childIds.length) flyTo(node.id);
		}}
		onpaneclick={() => (view.selectedNodes = [])}
	>
		<Background
			variant={BackgroundVariant.Dots}
			gap={20}
			patternColor="var(--sdv-grid)"
			bgColor="var(--sdv-canvas-bg)"
		/>
		<Controls showLock={false} />
		<ViewportPortal target="front">
			<svg class="edges" aria-label="Connections">
				{#each lines as l (l.e.id)}
					<g class="edge">
						<line
							x1={l.x1}
							y1={l.y1}
							x2={l.x2}
							y2={l.y2}
							stroke-width={1.5 / z}
							stroke-dasharray={l.e.dashed ? `${6 / z} ${4 / z}` : undefined}
						/>
						<polygon points={arrow(l.x2, l.y2, l.angle)} />
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<line
							class="hit"
							role="button"
							tabindex="-1"
							aria-label={l.e.label ?? `${l.e.source} to ${l.e.target}`}
							x1={l.x1}
							y1={l.y1}
							x2={l.x2}
							y2={l.y2}
							stroke-width={14 / z}
							onclick={() => followEdge(l.e)}
						/>
						{#if l.e.label}
							<text x={labelAt(l)[0]} y={labelAt(l)[1]} font-size={12 / z} stroke-width={4 / z}
								>{l.e.label}</text
							>
						{/if}
					</g>
				{/each}
			</svg>
		</ViewportPortal>
	</SvelteFlow>
</div>

<style>
	@property --rel {
		syntax: '<number>';
		inherits: true;
		initial-value: 1;
	}
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
		transition: --rel 300ms ease;
	}
	.canvas :global(.svelte-flow__node.ghost) {
		pointer-events: none;
	}
	.trail {
		position: absolute;
		z-index: 10;
		top: 8px;
		left: 8px;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 6px;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		border-radius: 8px;
		box-shadow: var(--ui-shadow);
		font-size: 13px;
	}
	.trail button {
		border: none;
		background: none;
		padding: 2px 4px;
	}
	.trail button:last-child {
		font-weight: 600;
	}
	.edges {
		position: absolute;
		overflow: visible;
		width: 1px;
		height: 1px;
		pointer-events: none;
	}
	.edge {
		animation: appear 250ms ease;
		stroke: var(--sdv-edge);
		fill: var(--sdv-edge);
	}
	.edge:hover {
		stroke: var(--sdv-edge-highlight);
		fill: var(--sdv-edge-highlight);
	}
	.hit {
		stroke: transparent;
		pointer-events: stroke;
		cursor: pointer;
	}
	text {
		text-anchor: middle;
		dominant-baseline: middle;
		paint-order: stroke;
		stroke: var(--sdv-canvas-bg);
		stroke-linejoin: round;
		pointer-events: none;
	}
	@keyframes appear {
		from {
			opacity: 0;
		}
	}
</style>
