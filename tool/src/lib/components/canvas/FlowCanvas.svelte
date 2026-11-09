<script lang="ts">
	import {
		Background,
		BackgroundVariant,
		ConnectionMode,
		Controls,
		MiniMap,
		SvelteFlow,
		useSvelteFlow,
		type Connection,
		type Edge,
		type Node,
		type NodeTargetEventWithPointer
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount, untrack } from 'svelte';
	import {
		setCanvasContext,
		type CanvasContext,
		type InlineEdit
	} from '#lib/client/canvas-context.ts';
	import { design } from '#lib/client/store.svelte.ts';
	import { theme } from '#lib/client/theme.svelte.ts';
	import type { ViewState } from '#lib/client/view-state.svelte.ts';
	import { batch, type Command } from '#lib/commands/core.ts';
	import { deleteMany, type NodeTarget } from '#lib/commands/delete.ts';
	import {
		alignMoves,
		distributeMoves,
		moveNodes,
		resizeNode,
		setCollapsed,
		setEdgePoints,
		unpinNode,
		type AlignBox
	} from '#lib/commands/layout.ts';
	import {
		addClassRelation,
		addMember,
		addNeeds,
		addObjectLink,
		addRelationship,
		addTransition,
		moveJob,
		parseAttribute,
		parseMethod,
		patchEntity,
		removeFromView,
		removeMember,
		removeNeeds,
		renameEntity,
		reparentElement,
		setFlowNodeActor,
		setSlot,
		updateMember
	} from '#lib/commands/model.ts';
	import { browserElk } from '#lib/layout/elk-browser.ts';
	import { layoutGraph } from '#lib/layout/layout.ts';
	import type { Point } from '#lib/layout/types.ts';
	import { NO_LANE } from '#lib/projections/flow.ts';
	import { TRIGGER_NODE } from '#lib/projections/pipeline.ts';
	import type { RenderGraph, RenderNode } from '#lib/projections/types.ts';
	import { RELATION_TYPES, type ClassRelation } from '#lib/model/schema.ts';
	import { markerDefs } from '#lib/render/shapes.ts';
	import { toSvgString } from '#lib/render/svg.ts';
	import { cssVarResolver } from '#lib/theme/tokens.ts';
	import SdvEdge from './SdvEdge.svelte';
	import ShapeNode from './ShapeNode.svelte';

	let {
		view,
		projection
	}: {
		view: ViewState;
		projection: RenderGraph;
	} = $props();

	const flow = useSvelteFlow();
	const viewId = $derived(projection.viewId);
	const viewType = $derived(projection.viewType);
	const source = $derived(design.model.views.get(viewId)?.def.source ?? '');
	const layoutFile = $derived(design.model.layouts.get(viewId)?.data);
	const readOnly = $derived(design.readOnly);

	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let hovered = $state<string | null>(null);
	let editing = $state<InlineEdit | null>(null);
	let relationPicker = $state<{ from: string; to: string; x: number; y: number } | null>(null);
	let lastPointer = { x: 0, y: 0 };
	let fitted = false;
	let run = 0;

	const nodeTypes = { sdv: ShapeNode };
	const edgeTypes = { sdv: SdvEdge };
	const markers = toSvgString(markerDefs(cssVarResolver));

	// ---------------------------------------------------------------- layout
	$effect(() => {
		const graph = projection;
		const layout = layoutFile;
		const seq = ++run;
		const t0 = performance.now();
		layoutGraph(graph, layout, browserElk())
			.then((pg) => {
				if (seq !== run) return;
				view.layoutMs = Math.round(performance.now() - t0);
				view.positioned = pg;
				const { selNodes, selEdges, ro } = untrack(() => ({
					selNodes: new Set(view.selectedNodes),
					selEdges: new Set(view.selectedEdges),
					ro: readOnly
				}));
				nodes = pg.nodes.map((n) => ({
					id: n.node.id,
					type: 'sdv',
					position: { x: n.x, y: n.y },
					parentId: n.node.parentId,
					width: n.width,
					height: n.height,
					data: { node: n.node, pinned: n.pinned },
					selected: selNodes.has(n.node.id),
					draggable: !ro && n.node.id !== TRIGGER_NODE,
					zIndex: n.node.isGroup ? undefined : 1
				}));
				edges = pg.edges.map((e) => ({
					id: e.edge.id,
					source: e.edge.source,
					target: e.edge.target,
					type: 'sdv',
					data: { positioned: e },
					selected: selEdges.has(e.edge.id),
					zIndex: 2
				}));
				if (!fitted) {
					fitted = true;
					const vp = layout?.viewport;
					// Two frames: Svelte Flow measures the new nodes before fitting.
					requestAnimationFrame(() =>
						requestAnimationFrame(() =>
							vp
								? flow.setViewport({ x: vp.x, y: vp.y, zoom: vp.zoom })
								: flow.fitView({ padding: 0.12, maxZoom: 1.2 })
						)
					);
				}
			})
			.catch((err) => design.notify('error', `Layout failed: ${(err as Error).message}`));
	});

	// ---------------------------------------------------------------- helpers
	const nodeData = (id: string) =>
		nodes.find((n) => n.id === id)?.data.node as RenderNode | undefined;

	function absBox(id: string) {
		const n = flow.getInternalNode(id);
		if (!n) return undefined;
		return {
			x: n.internals.positionAbsolute.x,
			y: n.internals.positionAbsolute.y,
			width: n.measured.width ?? n.width ?? 0,
			height: n.measured.height ?? n.height ?? 0
		};
	}

	function isInside(id: string, ancestor: string): boolean {
		let cur = nodes.find((n) => n.id === id)?.parentId;
		while (cur) {
			if (cur === ancestor) return true;
			cur = nodes.find((n) => n.id === cur)?.parentId;
		}
		return false;
	}

	/** Innermost group containing the point, ignoring `exclude` and its descendants. */
	function groupAt(x: number, y: number, exclude?: string): string | undefined {
		let best: { id: string; area: number } | undefined;
		for (const n of nodes) {
			const rn = n.data.node as RenderNode;
			if (!rn.isGroup || n.id === exclude || (exclude && isInside(n.id, exclude))) continue;
			const b = absBox(n.id);
			if (!b || x < b.x || y < b.y || x > b.x + b.width || y > b.y + b.height) continue;
			const area = b.width * b.height;
			if (!best || area < best.area) best = { id: n.id, area };
		}
		return best?.id;
	}

	const exec = (cmd: Command) => design.execute(cmd);

	// ---------------------------------------------------------------- drag, resize, connect
	/** Drops that change the model: reparent elements, move jobs, change swimlane. */
	function handleDrop(node: Node): boolean {
		const rn = node.data.node as RenderNode;
		const b = absBox(node.id);
		if (!b) return false;
		const target = groupAt(b.x + b.width / 2, b.y + b.height / 2, node.id);
		if (target === node.parentId) return false;
		const tb = target ? absBox(target) : undefined;
		const rel = tb ? { x: b.x - tb.x, y: b.y - tb.y } : { x: b.x, y: b.y };
		const tn = target ? nodeData(target) : undefined;
		if (
			viewType === 'component' &&
			(rn.type === 'element' || rn.type === 'boundary') &&
			(!tn || tn.type === 'boundary')
		) {
			exec(reparentElement(node.id, target, viewId, rel));
			return true;
		}
		if (viewType === 'pipeline' && rn.type === 'job' && tn?.type === 'stage') {
			exec(moveJob(source, node.id, tn.id, viewId, rel));
			return true;
		}
		if (viewType === 'flow' && rn.type === 'flow' && tn?.type === 'lane') {
			exec(
				setFlowNodeActor(
					source,
					node.id,
					tn.id === NO_LANE ? undefined : tn.id.slice('lane:'.length),
					viewId,
					rel
				)
			);
			return true;
		}
		return false;
	}

	const onnodedragstop: NodeTargetEventWithPointer<MouseEvent | TouchEvent> = ({
		nodes: dragged
	}) => {
		if (readOnly || !dragged.length) return;
		if (dragged.length === 1 && handleDrop(dragged[0])) return;
		exec(
			moveNodes(
				viewId,
				dragged.map((n) => ({ id: n.id, x: n.position.x, y: n.position.y }))
			)
		);
	};

	function connect(from: string, to: string) {
		if (from === TRIGGER_NODE || to === TRIGGER_NODE) return;
		switch (viewType) {
			case 'component':
				return exec(addRelationship(from, to));
			case 'class':
				relationPicker = { from, to, ...lastPointer };
				return;
			case 'object':
				return exec(addObjectLink(from, to));
			case 'flow':
				return exec(addTransition(source, from, to));
			case 'pipeline':
				return exec(addNeeds(source, from, to));
		}
	}

	function onbeforeconnect(c: Connection) {
		if (!readOnly && c.source && c.target) connect(c.source, c.target);
		return null;
	}

	function pickRelation(type: ClassRelation['type']) {
		if (relationPicker) exec(addClassRelation(relationPicker.from, relationPicker.to, type));
		relationPicker = null;
	}

	// ---------------------------------------------------------------- selection actions
	/** Pipeline needs/artifact edges are fields of their endpoints; the rest are list items. */
	function selectionDeletes(): { command: Command; count: number; names: string[] } | undefined {
		const selected = view.selectedEdges
			.map((id) => projection.edges.find((e) => e.id === id))
			.filter((e) => !!e);
		const fieldEdges = selected.filter((e) => e.type === 'needs' || e.type === 'artifact');
		const edgeRefs = selected.filter((e) => !fieldEdges.includes(e) && e.ref).map((e) => e.ref!);
		const nodeTargets: NodeTarget[] = [];
		for (const id of view.selectedNodes) {
			const rn = projection.nodes.find((n) => n.id === id);
			if (!rn?.ref || rn.id === TRIGGER_NODE || rn.type === 'lane') continue;
			nodeTargets.push({ kind: rn.ref.kind, id, owner: rn.ref.owner });
		}
		const count = fieldEdges.length + edgeRefs.length + nodeTargets.length;
		if (!count) return undefined;
		const needs = fieldEdges
			.filter((e) => e.source !== TRIGGER_NODE)
			.map((e) => removeNeeds(source, e.source, e.target));
		return {
			command: batch(`Delete ${count} item(s)`, [...needs, deleteMany(edgeRefs, nodeTargets)]),
			count,
			names: nodeTargets.map((t) => t.id)
		};
	}

	function requestDelete() {
		if (readOnly) return;
		const del = selectionDeletes();
		if (!del) return;
		const preview = design.preview(del.command);
		if (preview.error) return design.notify('error', preview.error);
		const title =
			del.count === 1 && del.names.length === 1
				? `Delete "${del.names[0]}" from the model?`
				: `Delete ${del.count} items from the model?`;
		view.pendingDelete = { title, command: del.command, files: preview.files };
	}

	function removeSelectionFromView() {
		const ids = view.selectedNodes.filter((id) => projection.nodes.find((n) => n.id === id)?.ref);
		if (ids.length)
			exec(
				batch(
					`Remove ${ids.length} from view`,
					ids.map((id) => removeFromView(viewId, id))
				)
			);
	}

	function align(how: Parameters<NonNullable<ViewState['api']>['align']>[0]) {
		const boxes: AlignBox[] = view.selectedNodes.flatMap((id) => {
			const b = absBox(id);
			const parent = nodes.find((n) => n.id === id)?.parentId;
			const pb = parent ? absBox(parent) : undefined;
			return b
				? [
						{
							id,
							absX: b.x,
							absY: b.y,
							width: b.width,
							height: b.height,
							parentX: pb?.x ?? 0,
							parentY: pb?.y ?? 0
						}
					]
				: [];
		});
		if (boxes.length < 2) return;
		const moves =
			how === 'horizontal' || how === 'vertical'
				? distributeMoves(boxes, how)
				: alignMoves(boxes, how);
		exec(
			moveNodes(viewId, moves, how === 'horizontal' || how === 'vertical' ? 'Distribute' : 'Align')
		);
	}

	onMount(() => {
		view.api = {
			fit: () => flow.fitView({ padding: 0.12, duration: 200 }),
			focus(id) {
				nodes = nodes.map((n) => ({ ...n, selected: n.id === id }));
				view.selectedNodes = [id];
				flow.fitView({ nodes: [{ id }], duration: 300, maxZoom: 1.3, padding: 0.5 });
			},
			align,
			requestDelete,
			removeFromView: removeSelectionFromView
		};
		return () => (view.api = null);
	});

	// ---------------------------------------------------------------- inline edits
	function commitMember(
		node: RenderNode,
		list: string,
		index: number,
		text: string,
		isNew?: boolean
	) {
		const value = text.trim();
		try {
			if (node.type === 'object') {
				const m = /^([^=]+?)\s*=\s*(.*)$/.exec(value);
				const old = isNew ? undefined : node.data.rows[index]?.name;
				if (!value) return old && exec(setSlot(node.id, old, undefined));
				if (!m) return design.notify('error', 'Use "name = value"');
				const cmds = [setSlot(node.id, m[1].trim(), m[2].trim())];
				if (old && old !== m[1].trim()) cmds.unshift(setSlot(node.id, old, undefined));
				return exec(batch(`Set ${node.id}.${m[1].trim()}`, cmds));
			}
			if (node.type !== 'class') return;
			const l = list as 'attributes' | 'methods' | 'values';
			if (!value) return isNew ? undefined : exec(removeMember(node.id, l, index));
			const cls = design.model.classes.get(node.id)?.def;
			const parsed =
				l === 'values' ? value : l === 'methods' ? parseMethod(value) : parseAttribute(value);
			if (isNew) return exec(addMember(node.id, l, parsed));
			const old =
				l === 'values' ? undefined : (cls?.[l]?.[index] as Record<string, unknown> | undefined);
			// Keep fields the one-line syntax cannot express.
			const merged =
				typeof parsed === 'string'
					? parsed
					: {
							...parsed,
							...(old?.description ? { description: old.description } : {}),
							...(old?.static ? { static: true } : {}),
							...(old?.abstract ? { abstract: true } : {})
						};
			exec(updateMember(node.id, l, index, merged as never));
		} catch (e) {
			design.notify('error', (e as Error).message);
		}
	}

	const ctx: CanvasContext = {
		get viewId() {
			return viewId;
		},
		get readOnly() {
			return readOnly;
		},
		get hovered() {
			return hovered;
		},
		get editing() {
			return editing;
		},
		setHovered: (id) => (hovered = id),
		startEdit: (e) => (editing = e),
		commitLabel(node, text) {
			if (!node.ref) return;
			if (node.id === TRIGGER_NODE)
				exec(patchEntity(node.ref, { trigger: text.trim() || undefined }, 'Rename'));
			else exec(renameEntity(node.ref, text));
		},
		commitMember,
		addMember: (node, list) =>
			(editing = { kind: 'member', nodeId: node.id, list, index: -1, isNew: true }),
		commitEdgeLabel: (edge, text) => edge.ref && exec(renameEntity(edge.ref, text)),
		toggleCollapse: (id, collapsed) => exec(setCollapsed(viewId, id, collapsed)),
		unpin: (id) => exec(unpinNode(viewId, id)),
		resize: (id, box) => exec(resizeNode(viewId, id, box)),
		openSubflow(flowId) {
			const target = [...design.model.views.values()].find(
				(v) => v.def.type === 'flow' && v.def.source === flowId
			);
			if (target) goto(resolve('/view/[id]', { id: target.id }));
		},
		setEdgePoints: (edgeId, points?: Point[]) => exec(setEdgePoints(viewId, edgeId, points)),
		toFlow(x, y) {
			const p = flow.screenToFlowPosition({ x, y });
			return [p.x, p.y];
		},
		isCollapsed: (id) => !!layoutFile?.nodes?.[id]?.collapsed
	};
	setCanvasContext(ctx);

	function onkeydown(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		if (t.closest('input, textarea, select, [contenteditable]')) return;
		if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			requestDelete();
		} else if (e.key === 'Escape') {
			editing = null;
			relationPicker = null;
		} else if (e.key === 'F2' && view.selectedNodes.length === 1) {
			editing = { kind: 'label', nodeId: view.selectedNodes[0] };
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="canvas"
	{onkeydown}
	onpointermove={(e) => (lastPointer = { x: e.clientX, y: e.clientY })}
	data-testid="canvas"
>
	<svg class="marker-defs" aria-hidden="true">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- static marker definitions -->
		{@html markers}
	</svg>
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		{edgeTypes}
		colorMode={theme.current}
		connectionMode={ConnectionMode.Loose}
		snapGrid={view.snap && design.config.snapGrid > 0
			? [design.config.snapGrid, design.config.snapGrid]
			: undefined}
		deleteKey={null}
		minZoom={0.1}
		maxZoom={2.5}
		nodesConnectable={!readOnly}
		nodesDraggable={!readOnly}
		elevateNodesOnSelect={false}
		zoomOnDoubleClick={false}
		{onnodedragstop}
		{onbeforeconnect}
		onselectionchange={({ nodes: n, edges: e }) => {
			view.selectedNodes = n.map((x) => x.id);
			view.selectedEdges = e.map((x) => x.id);
		}}
		onpaneclick={() => {
			editing = null;
			relationPicker = null;
		}}
	>
		<Background
			variant={BackgroundVariant.Dots}
			gap={design.config.snapGrid * 2 || 20}
			patternColor="var(--sdv-grid)"
			bgColor="var(--sdv-canvas-bg)"
		/>
		<Controls showLock={false} />
		{#if view.minimap}
			<MiniMap
				width={150}
				height={100}
				pannable
				zoomable
				nodeColor={(n) => ((n.data.node as RenderNode).isGroup ? 'transparent' : 'var(--sdv-edge)')}
				nodeStrokeColor="var(--sdv-edge)"
			/>
		{/if}
	</SvelteFlow>
	{#if relationPicker}
		<div
			class="picker"
			style:left="{relationPicker.x}px"
			style:top="{relationPicker.y}px"
			role="menu"
			data-testid="relation-picker"
		>
			<div class="muted">{relationPicker.from} → {relationPicker.to}</div>
			{#each RELATION_TYPES as t (t)}
				<button role="menuitem" onclick={() => pickRelation(t)}>{t}</button>
			{/each}
			<button class="icon" onclick={() => (relationPicker = null)} aria-label="Cancel">×</button>
		</div>
	{/if}
</div>

<style>
	.canvas {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	.marker-defs {
		position: absolute;
		width: 0;
		height: 0;
	}
	.canvas :global(.svelte-flow) {
		--xy-background-color: var(--sdv-canvas-bg);
	}
	.canvas :global(.svelte-flow__node) {
		border: none;
		background: transparent;
		padding: 0;
		border-radius: 0;
		box-shadow: none;
	}
	.canvas :global(.svelte-flow__node.selected),
	.canvas :global(.svelte-flow__node:focus-visible) {
		outline: none;
	}
	.canvas :global(.svelte-flow__minimap) {
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
	}
	.picker {
		position: fixed;
		z-index: 20;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		border-radius: 8px;
		box-shadow: var(--ui-shadow);
		transform: translate(8px, 8px);
	}
	.picker button {
		text-align: left;
	}
	.picker div {
		font-size: 12px;
		padding: 0 4px 4px;
	}
</style>
