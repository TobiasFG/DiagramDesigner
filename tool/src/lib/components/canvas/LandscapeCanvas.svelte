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
	import {
		fieldRowY,
		focusLinks,
		incomingCount,
		layoutLandscape,
		linkTarget,
		modelLinks,
		refLabel,
		relationsOf,
		typeText,
		type FieldLink,
		type LandscapeBox,
		type ModelLink
	} from '#lib/landscape/layout.ts';
	import { openBoxes } from '#lib/landscape/open.ts';
	import { untrack } from 'svelte';
	import LandscapeNode, { type LandscapeNodeData } from './LandscapeNode.svelte';

	/**
	 * The whole model, laid out once. Only boxes inside open boxes are mounted; which boxes are
	 * open follows where they sit on screen (see open.ts), and opening fades over a fixed time.
	 */
	let { view }: { view: ViewState } = $props();

	const flow = useSvelteFlow();
	const viewport = useViewport();
	const nodeTypes = { landscape: LandscapeNode };
	// How long a closed box's children stay mounted while they fade out (the CSS transitions).
	const FADE_MS = 300;

	let cw = $state(1);
	let ch = $state(1);
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let fitted = false;
	// Set once the first fit has landed; before it the camera is a placeholder.
	let ready = $state(false);

	const boxes = $derived(layoutLandscape(design.model));
	const rels = $derived(relationsOf(design.model));
	const boxById = $derived(new Map(boxes.map((b) => [b.id, b])));
	// The row being looked at: under the pointer, else clicked. Its links are drawn wherever
	// the other end is, so a link across modules or systems shows too.
	const focus = $derived(view.hover ?? view.field);
	const focused = $derived(
		focus ? focusLinks(design.model, rels, boxes, focus.box, focus.field) : []
	);
	const label = (id: string) => refLabel(design.model, id) ?? id;
	const el = (id: string) => design.model.elements.get(id);

	// State, not derived, so a pan that changes nothing stops here instead of rebuilding nodes
	// every frame, and the boxes that just closed are known.
	let open = $state.raw(new Set<string>());
	// Boxes that just closed; their children stay mounted until they have faded out.
	let closing = $state.raw(new Set<string>());
	const sameSet = (a: Set<string>, b: Set<string>) =>
		a.size === b.size && [...a].every((id) => b.has(id));
	$effect(() => {
		const { x, y, zoom } = viewport.current;
		if (!ready) return;
		const was = untrack(() => open);
		const next = openBoxes(boxes, { x, y, zoom, width: cw, height: ch });
		if (sameSet(next, was)) return;
		const shut = [...was].filter((id) => !next.has(id));
		open = next;
		if (!shut.length) return;
		closing = new Set([...untrack(() => closing), ...shut]);
		setTimeout(() => {
			closing = new Set([...closing].filter((id) => !shut.includes(id) || open.has(id)));
		}, FADE_MS);
	});

	// Mounted: roots, children of open or closing boxes, and the far ends of focused lines
	// (with the boxes round them), so a line to a closed box still has an end.
	const mounted = $derived.by(() => {
		const out = boxes
			.filter((b) => !b.parentId || open.has(b.parentId) || closing.has(b.parentId))
			.map((b) => b.id);
		for (const l of focused)
			for (let id: string | undefined = l.source === focus?.box ? l.target : l.source; id;) {
				out.push(id);
				id = boxById.get(id)?.parentId;
			}
		return new Set(out);
	});

	function onfield(box: string, field: string, ev: 'enter' | 'leave' | 'click') {
		if (ev === 'enter') view.hover = { box, field };
		else if (ev === 'leave') view.hover = null;
		else {
			const same = view.field?.box === box && view.field.field === field;
			view.field = same ? null : { box, field };
			view.selectedNodes = [];
		}
	}

	// Rows to light, by box: the focused row, and the row at the far end of each of its lines.
	// Nodes read it from the view state, so focus changes never rebuild them.
	$effect(() => {
		const out: Record<string, Record<string, 'self' | 'peer'>> = {};
		const lit = (box: string, field: string | undefined, how: 'self' | 'peer') => {
			if (!field) return;
			const rows = (out[box] ??= {});
			if (rows[field] !== 'self') rows[field] = how;
		};
		if (focus) lit(focus.box, focus.field, 'self');
		for (const l of focused) {
			lit(l.source, l.sourceField, 'peer');
			lit(l.target, l.targetField, 'peer');
		}
		view.hot = out;
		// A far end inside a closed box is hidden; outline the closed box that shows instead.
		const far = focused.flatMap((l) => (l.source === focus?.box ? [l.target] : [l.source]));
		const peers: Record<string, true> = {};
		for (const id of far) {
			let shown = boxById.get(id);
			while (shown?.parentId && !open.has(shown.parentId)) shown = boxById.get(shown.parentId);
			if (shown && shown.id !== id) peers[shown.id] = true;
		}
		view.peerBoxes = peers;
	});

	$effect(() => {
		const counts = Object.fromEntries(
			[...design.model.fields.keys()].map((id) => [
				id,
				{ ref: incomingCount(rels, id, 'ref'), from: incomingCount(rels, id, 'from') }
			])
		);
		nodes = boxes
			.filter((b) => mounted.has(b.id))
			.map((b) => {
				const info = el(b.elementId)!;
				return {
					id: b.id,
					type: 'landscape',
					position: { x: b.x, y: b.y },
					parentId: b.parentId,
					width: b.width,
					height: b.height,
					draggable: false,
					connectable: false,
					class:
						[b.parentId && !open.has(b.parentId) && 'ghost', open.has(b.id) && 'open']
							.filter(Boolean)
							.join(' ') || undefined,
					data: {
						name: info.name,
						// A closed boundary reads as the model it is drawn round.
						kind: b.boundary ? 'model' : info.def.kind,
						group: b.group,
						owner: b.ref ? el(info.parentId ?? '')?.name : undefined,
						fields: b.fields,
						indexes: b.view === 'table' ? info.def.indexes : undefined,
						table: b.table,
						view: b.view,
						labels: Object.fromEntries(
							(b.fields ?? [])
								.flatMap((f) => [f.ref, f.model, ...(f.from ?? [])])
								.flatMap((id) => {
									const label = id && refLabel(design.model, id);
									return label ? [[id, label]] : [];
								})
						),
						incoming: counts,
						state: view,
						onfield: (field, ev) => onfield(b.id, field, ev)
					} satisfies LandscapeNodeData
				};
			});
		if (!fitted && boxes.length) {
			fitted = true;
			requestAnimationFrame(() =>
				requestAnimationFrame(() => flow.fitView({ padding: 0.08 }).then(() => (ready = true)))
			);
		}
	});

	$effect(() => {
		// Lines fade with their box's children, through the same CSS variables as the nodes.
		// While a row is focused its lines are lit, drawn over the cards so none reads as
		// another row's, and the rest dimmed. Lines to cards in other boxes are added and
		// always visible.
		const lit = new Set(focused.map((l) => l.id));
		const base = modelLinks(design.model, boxes).filter(
			(l) => mounted.has(l.source) && mounted.has(l.target)
		);
		const baseIds = new Set(base.map((l) => l.id));
		edges = [
			...base.map((l) => edge(l, focus ? (lit.has(l.id) ? 'hot' : 'dim') : '')),
			...focused.filter((l) => !baseIds.has(l.id)).map((l) => edge(l, 'hot cross'))
		];
	});

	function edge(l: ModelLink, state: string) {
		const parent = l.parentId ? boxById.get(l.parentId) : undefined;
		const hotLine = state.includes('hot');
		const color = hotLine
			? l.kind === 'from'
				? 'var(--sdv-link-from)'
				: 'var(--sdv-link-ref)'
			: 'var(--sdv-edge)';
		const arrow = { type: MarkerType.ArrowClosed, width: 14, height: 14, color };
		return {
			...l,
			// Svelte Flow adds this to the higher level of the two tables, so the line sits one
			// level below them: under the tables, over their module. A lit line goes on top.
			zIndex: hotLine ? 1000 : -1,
			type: 'smoothstep',
			pathOptions: { borderRadius: 0 },
			class: `model-link ${l.kind} ${state} ${parent && !open.has(parent.id) ? 'off' : ''}`,
			// A foreign key points at the key; a held model has a UML composition diamond at the
			// holder (defined below); lineage points at the derived field, the way data flows.
			...(l.kind === 'ref'
				? { markerEnd: arrow }
				: l.kind === 'from'
					? { markerStart: arrow }
					: { markerStart: hotLine ? 'sdv-composition-hot' : 'sdv-composition' })
		};
	}

	// ------------------------------------------------------------ inspector
	/** Where a card sits: its enclosing entities, outermost first, boundaries skipped. */
	function whereOf(b: LandscapeBox): string {
		const names: string[] = [];
		for (
			let p = b.parentId && boxById.get(b.parentId);
			p;
			p = p.parentId && boxById.get(p.parentId)
		)
			if (!p.boundary) names.unshift(el(p.elementId)?.name ?? p.elementId);
		return names.join(' › ') + (b.view === 'table' ? ' · stored' : '');
	}

	interface Entry {
		text: string;
		where: string;
		target?: { box: LandscapeBox; field?: string };
	}

	const inspector = $derived.by(() => {
		const f = view.field;
		const b = f && boxById.get(f.box);
		const info = f && design.model.fields.get(f.field);
		if (!f || !b || !info) return undefined;
		const entry = (to: string): Entry => {
			const t = linkTarget(design.model, boxes, b, to);
			return {
				text: label(to),
				where: t ? whereOf(t) : 'not drawn',
				target: t && { box: t, field: design.model.fields.has(to) ? to : undefined }
			};
		};
		const outOf = (kind: FieldLink['kind']) =>
			(rels.out.get(f.field) ?? []).filter((l) => l.kind === kind).map((l) => entry(l.to));
		const inOf = (kind: FieldLink['kind']) =>
			(rels.in.get(f.field) ?? []).filter((l) => l.kind === kind).map((l) => entry(l.field));
		const def = info.def;
		return {
			title: `${el(info.modelId)?.name}.${def.name}`,
			type: typeText(def, (id) => refLabel(design.model, id)),
			// Glyphs point the way the link goes: → this field to the entry, ← the entry to it.
			sections: [
				{ label: 'References', kind: 'ref', glyph: '→', entries: outOf('ref') },
				{ label: 'Holds', kind: 'model', glyph: '◆', entries: outOf('model') },
				{
					label: 'Source',
					kind: 'from',
					glyph: '⇠',
					entries: outOf('from'),
					note: def.derived
				},
				{ label: 'Referenced by', kind: 'ref', glyph: '←', entries: inOf('ref') },
				{ label: 'Feeds', kind: 'from', glyph: '⇢', entries: inOf('from') }
			].filter((s) => s.entries.length)
		};
	});

	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Centres the camera on the target row and picks it. The zoom stays where it is unless the
	 * target's box would be too closed to show it, or the card too big for the canvas. The
	 * centre is nudged so the box round the target stays in view, which is what opens it.
	 */
	function flyTo(target: { box: LandscapeBox; field?: string }, back = false) {
		const t = target.box;
		const area = (t.parentId && boxById.get(t.parentId)) || t;
		const fill = (b: LandscapeBox) => Math.max(b.width / cw, b.height / ch);
		const zoom = Math.min(Math.max(viewport.current.zoom, 0.8 / fill(area)), 0.92 / fill(t));
		const row = t.fields?.findIndex((f) => f.id === target.field) ?? -1;
		// Keep [start, start + size] on a canvas side of `side` pixels, if it fits.
		const keep = (c: number, start: number, size: number, side: number) => {
			const half = side / 2 / zoom;
			return size <= 2 * half ? Math.min(Math.max(c, start + size - half), start + half) : c;
		};
		flow.setCenter(
			keep(t.absX + t.width / 2, area.absX, area.width, cw),
			keep(t.absY + (row >= 0 ? fieldRowY(row) : t.height / 2), area.absY, area.height, ch),
			{ zoom, duration: 700 }
		);
		view.hover = null;
		if (!target.field) return;
		const ref = { box: t.id, field: target.field };
		if (!back && view.field) view.trail = [...view.trail, view.field];
		view.field = ref;
		clearTimeout(flashTimer);
		view.flash = null;
		flashTimer = setTimeout(() => {
			view.flash = ref;
			flashTimer = setTimeout(() => (view.flash = null), 1400);
		}, 700);
	}

	function goBack() {
		const prev = view.trail.at(-1);
		const box = prev && boxById.get(prev.box);
		if (!prev || !box) return;
		view.trail = view.trail.slice(0, -1);
		flyTo({ box, field: prev.field }, true);
	}

	function unpin() {
		view.field = null;
		view.trail = [];
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape') unpin();
	}}
/>

<div
	class="canvas"
	bind:clientWidth={cw}
	bind:clientHeight={ch}
	style:--z={viewport.current.zoom}
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
		onnodeclick={({ node }) => {
			view.selectedNodes = [node.id];
			unpin();
		}}
		onpaneclick={() => {
			view.selectedNodes = [];
			unpin();
		}}
	>
		<Background
			variant={BackgroundVariant.Dots}
			gap={20}
			patternColor="var(--sdv-grid)"
			bgColor="var(--sdv-canvas-bg)"
		/>
		<Controls showLock={false} />
	</SvelteFlow>
	<svg class="defs" aria-hidden="true">
		<defs>
			<marker
				id="sdv-composition"
				viewBox="0 0 16 10"
				refX="16"
				refY="5"
				markerWidth="16"
				markerHeight="10"
				markerUnits="userSpaceOnUse"
				orient="auto-start-reverse"
			>
				<path d="M0,5 L8,0 L16,5 L8,10 Z" fill="var(--sdv-edge)" />
			</marker>
			<marker
				id="sdv-composition-hot"
				viewBox="0 0 16 10"
				refX="16"
				refY="5"
				markerWidth="16"
				markerHeight="10"
				markerUnits="userSpaceOnUse"
				orient="auto-start-reverse"
			>
				<path d="M0,5 L8,0 L16,5 L8,10 Z" fill="var(--sdv-link-ref)" />
			</marker>
		</defs>
	</svg>
	<!-- Docked, so it never covers the lines and cards it describes. -->
	{#if inspector}
		<aside class="inspector" data-testid="field-inspector">
			<header>
				{#if view.trail.length}
					<button class="icon-btn" onclick={goBack} title="Back to the previous field">‹</button>
				{/if}
				<div class="head">
					<div class="title">{inspector.title}</div>
					<div class="type">{inspector.type}</div>
				</div>
				<button class="icon-btn" onclick={unpin} aria-label="Close" title="Close (Esc)">×</button>
			</header>
			{#each inspector.sections as s (s.label)}
				<section class={s.kind}>
					<h4>{s.label}</h4>
					{#each s.entries as e, i (i)}
						<button
							class="entry"
							disabled={!e.target}
							onclick={() => e.target && flyTo(e.target)}
							onmouseenter={() =>
								(view.hover = e.target?.field
									? { box: e.target.box.id, field: e.target.field }
									: null)}
							onmouseleave={() => (view.hover = null)}
							title={e.target ? 'Go to' : undefined}
						>
							<span class="text" data-glyph={s.glyph}>{e.text}</span>
							<span class="where">{e.where}</span>
						</button>
					{/each}
					{#if s.note}<p class="note">ƒ {s.note}</p>{/if}
				</section>
			{:else}
				<p class="empty">No references, sources or incoming links.</p>
			{/each}
		</aside>
	{/if}
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
	/* Boxes and lines fade in when mounted and out before they are unmounted (FADE_MS). Children
	   come in after their box's face has gone, and go before it returns, so labels never overlap. */
	.canvas :global(.svelte-flow__node),
	.canvas :global(.svelte-flow__edge.model-link) {
		transition: opacity 0.18s ease-out 0.1s;
		@starting-style {
			opacity: 0;
		}
	}
	.canvas :global(.svelte-flow__node.ghost),
	.canvas :global(.svelte-flow__edge.model-link.off) {
		opacity: 0;
		transition-delay: 0s;
	}
	.canvas :global(.svelte-flow__edge.model-link) {
		pointer-events: none;
	}
	.canvas :global(.model-link .svelte-flow__edge-path) {
		stroke: var(--sdv-edge);
		transition: opacity 0.12s;
	}
	.canvas :global(.model-link.from .svelte-flow__edge-path) {
		stroke-dasharray: 5 4;
	}
	.canvas :global(.model-link.dim .svelte-flow__edge-path) {
		opacity: 0.25;
	}
	/* A lit line keeps 2px on screen at any zoom, so it is found from far out too. */
	.canvas :global(.model-link.hot .svelte-flow__edge-path) {
		stroke: var(--sdv-link-ref);
		stroke-width: 2;
		vector-effect: non-scaling-stroke;
	}
	.canvas :global(.model-link.hot.from .svelte-flow__edge-path) {
		stroke: var(--sdv-link-from);
	}
	/* A line to another box is drawn whatever the zoom, so it shows where the other end is. */
	.canvas :global(.svelte-flow__edge.model-link.cross) {
		opacity: 1;
		transition: none;
	}
	.inspector {
		position: absolute;
		top: 12px;
		right: 12px;
		width: 300px;
		max-height: calc(100% - 24px);
		z-index: 10;
		box-sizing: border-box;
		background: var(--sdv-model-fill);
		border: 1px solid var(--sdv-model-stroke);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
		color: var(--sdv-model-text);
		font-size: 13px;
		overflow: auto;
	}
	.inspector header {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		padding: 10px 12px 8px;
		border-bottom: 1px solid var(--sdv-model-stroke);
		background: var(--sdv-model-class-head);
	}
	.inspector .title {
		font-weight: 600;
		font-size: 14px;
	}
	.inspector .type,
	.inspector .where,
	.inspector .empty,
	.inspector .note {
		color: var(--sdv-text-muted);
		font-size: 12px;
	}
	.inspector .head {
		flex: 1;
	}
	.inspector .icon-btn {
		border: none;
		background: none;
		color: var(--sdv-text-muted);
		font-size: 18px;
		line-height: 1;
		cursor: pointer;
		padding: 0 2px;
	}
	.inspector section {
		padding: 6px 0;
		border-top: 1px solid var(--sdv-model-stroke);
	}
	.inspector header + section {
		border-top: none;
	}
	.inspector h4 {
		margin: 2px 12px 4px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--sdv-text-muted);
	}
	.inspector .entry {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		width: 100%;
		padding: 4px 12px 4px 10px;
		border: none;
		border-left: 2px solid transparent;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.inspector .entry:hover:not(:disabled) {
		background: var(--sdv-row-hover);
		border-left-color: var(--sdv-link-ref);
	}
	.inspector .from .entry:hover:not(:disabled) {
		border-left-color: var(--sdv-link-from);
	}
	.inspector .entry:disabled {
		cursor: default;
	}
	.inspector .entry .text {
		font-weight: 500;
	}
	.inspector .entry .text::before {
		content: attr(data-glyph) ' ';
		color: var(--sdv-link-ref);
	}
	.inspector .from .entry .text::before {
		color: var(--sdv-link-from);
	}
	.inspector .note,
	.inspector .empty {
		margin: 4px 12px;
	}
	.defs {
		position: absolute;
		width: 0;
		height: 0;
	}
	.canvas :global(.svelte-flow__node.ghost) {
		pointer-events: none;
	}
</style>
