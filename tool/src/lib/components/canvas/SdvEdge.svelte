<script lang="ts">
	import {
		BaseEdge,
		EdgeLabel,
		useInternalNode,
		type EdgeProps,
		type InternalNode
	} from '@xyflow/svelte';
	import { getCanvasContext } from '$lib/client/canvas-context';
	import type { Box, Point, PositionedEdge } from '$lib/layout/types';
	import type { RenderNode } from '$lib/projections/types';
	import { drawEdgeLabels, edgeGeometry, edgeStrokeDash } from '$lib/render/edges';
	import { markerId, nodeOutline } from '$lib/render/shapes';
	import { el, toSvgString } from '$lib/render/svg';
	import { cssVarResolver } from '$lib/theme/tokens';

	let { id, source, target, data, selected }: EdgeProps = $props();
	const ctx = getCanvasContext();
	// An edge id encodes its endpoints, so they never change for a mounted edge.
	// svelte-ignore state_referenced_locally
	const sourceNode = useInternalNode(source);
	// svelte-ignore state_referenced_locally
	const targetNode = useInternalNode(target);

	const pe = $derived(data!.positioned as PositionedEdge);
	const edge = $derived(pe.edge);

	function box(
		n: InternalNode | undefined
	): (Box & { outline: ReturnType<typeof nodeOutline> }) | undefined {
		if (!n) return undefined;
		return {
			x: n.internals.positionAbsolute.x,
			y: n.internals.positionAbsolute.y,
			width: n.measured.width ?? n.width ?? 0,
			height: n.measured.height ?? n.height ?? 0,
			outline: nodeOutline(n.data.node as RenderNode)
		};
	}

	/** Bend points being dragged; replaces the stored ones until the drag ends. */
	let dragPoints = $state<Point[] | null>(null);
	const points = $derived(dragPoints ?? pe.points);

	const geom = $derived.by(() => {
		const s = box(sourceNode.current);
		const t = box(targetNode.current);
		if (!s || !t) return null;
		return edgeGeometry({
			source: s,
			target: t,
			route: pe.route,
			routeBoxes: pe.routeBoxes,
			points,
			labelPos: pe.labelPos,
			parallel: pe.parallel
		});
	});
	const highlighted = $derived(ctx.hovered === source || ctx.hovered === target);
	const labels = $derived(
		geom ? toSvgString(el('g', {}, ...drawEdgeLabels(edge, geom, cssVarResolver))) : ''
	);
	const editing = $derived(ctx.editing?.kind === 'edge' && ctx.editing.edgeId === id);
	const editable = $derived(
		!ctx.readOnly &&
			!!edge.ref &&
			edge.type !== 'needs' &&
			edge.type !== 'artifact' &&
			edge.type !== 'aggregated'
	);
	const style = $derived(
		[
			`stroke: ${highlighted ? 'var(--sdv-edge-highlight)' : selected ? 'var(--sdv-selection)' : edge.data.back ? 'var(--sdv-text-muted)' : 'var(--sdv-edge)'}`,
			`stroke-width: ${highlighted || selected ? 2.25 : 1.5}`,
			edgeStrokeDash(edge) ? `stroke-dasharray: ${edgeStrokeDash(edge)}` : ''
		].join(';')
	);
	const marker = (m: string) => (m === 'none' ? undefined : `url(#${markerId(m as never)})`);

	function startDrag(e: PointerEvent, index: number, insert: boolean) {
		if (ctx.readOnly) return;
		e.stopPropagation();
		e.preventDefault();
		const base = [...(points ?? [])];
		let pts = base;
		if (insert) {
			const at: Point = ctx.toFlow(e.clientX, e.clientY);
			pts = [...base.slice(0, index), at, ...base.slice(index)];
		}
		dragPoints = pts;
		const move = (ev: PointerEvent) => {
			const p = ctx.toFlow(ev.clientX, ev.clientY);
			dragPoints = dragPoints!.map((q, i) => (i === index ? p : q));
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			const final = dragPoints;
			dragPoints = null;
			ctx.setEdgePoints(id, final ?? undefined);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	function removePoint(index: number) {
		const next = (points ?? []).filter((_, i) => i !== index);
		ctx.setEdgePoints(id, next.length ? next : undefined);
	}

	function commit(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (input.dataset.done) return;
		input.dataset.done = '1';
		ctx.startEdit(null);
		if (input.value !== (edge.data.label ?? '')) ctx.commitEdgeLabel(edge, input.value);
	}
</script>

{#if geom}
	<g
		class="sdv-edge"
		data-testid="edge-{id}"
		ondblclick={() => editable && ctx.startEdit({ kind: 'edge', edgeId: id })}
		role="presentation"
	>
		<BaseEdge
			{id}
			path={geom.d}
			{style}
			markerStart={marker(edge.data.markerStart)}
			markerEnd={marker(edge.data.markerEnd)}
			interactionWidth={16}
		/>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- label markup built from escaped text -->
		{@html labels}
		{#if selected && !ctx.readOnly && edge.type !== 'aggregated'}
			{#each points ?? [] as p, i (i)}
				<circle
					class="bend nodrag nopan"
					cx={p[0]}
					cy={p[1]}
					r="6"
					onpointerdown={(e) => startDrag(e, i, false)}
					ondblclick={(e) => {
						e.stopPropagation();
						removePoint(i);
					}}
					role="button"
					tabindex="-1"
					aria-label="Bend point (double-click to remove)"
				/>
			{/each}
			{#if !points?.length}
				<circle
					class="bend add nodrag nopan"
					cx={geom.mid[0]}
					cy={geom.mid[1]}
					r="5"
					onpointerdown={(e) => startDrag(e, 0, true)}
					role="button"
					tabindex="-1"
					aria-label="Drag to bend"
				/>
			{/if}
		{/if}
	</g>
	{#if editing}
		<EdgeLabel x={geom.label[0]} y={geom.label[1]}>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="edge-edit nodrag nopan"
				value={edge.data.label ?? ''}
				autofocus
				onblur={commit}
				onkeydown={(e) => {
					e.stopPropagation();
					if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
					if (e.key === 'Escape') {
						(e.currentTarget as HTMLInputElement).dataset.done = '1';
						ctx.startEdit(null);
					}
				}}
				aria-label="Edge label"
				data-testid="edge-edit"
			/>
		</EdgeLabel>
	{/if}
{/if}

<style>
	.bend {
		fill: var(--sdv-canvas-bg);
		stroke: var(--sdv-selection);
		stroke-width: 2;
		cursor: move;
		pointer-events: all;
	}
	.bend.add {
		fill: var(--sdv-selection);
		opacity: 0.7;
	}
	.edge-edit {
		width: 160px;
		pointer-events: all;
		box-shadow: var(--ui-shadow);
	}
</style>
