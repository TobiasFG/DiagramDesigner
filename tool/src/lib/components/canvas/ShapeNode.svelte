<script lang="ts">
	import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/svelte';
	import { getCanvasContext } from '$lib/client/canvas-context';
	import type { MemberList } from '$lib/commands/model';
	import type { RenderNode } from '$lib/projections/types';
	import { CLASS_ROW_HEIGHT, classMetrics, drawNode } from '$lib/render/shapes';
	import { toSvgString } from '$lib/render/svg';
	import { cssVarResolver } from '$lib/theme/tokens';

	let { id, data, selected, width, height }: NodeProps = $props();
	const ctx = getCanvasContext();

	const node = $derived(data.node as RenderNode);
	const pinned = $derived(data.pinned as boolean);
	const w = $derived(width ?? node.width);
	const h = $derived(height ?? node.height);
	const svg = $derived(toSvgString(drawNode(node, w, h, cssVarResolver)));
	const editing = $derived(
		ctx.editing && 'nodeId' in ctx.editing && ctx.editing.nodeId === id ? ctx.editing : null
	);
	const connectable = $derived(
		!ctx.readOnly &&
			node.type !== 'lane' &&
			!(node.type === 'flow' && node.ref?.kind === 'pipeline')
	);
	const collapsed = $derived(ctx.isCollapsed(id));

	interface RowHit {
		list: MemberList | 'slots';
		index: number;
		y: number;
		text: string;
	}

	/** Member rows (class compartments, object slots) with their local y, for hit testing. */
	const rows = $derived.by((): RowHit[] => {
		if (node.type === 'class') {
			const m = classMetrics(node.data);
			return m.compartments.flatMap((c) =>
				c.rows.map((text, i) => ({
					list: c.key,
					index: c.key === 'values' ? i : (node.data[c.key][i]?.index ?? i),
					y: c.y + 5 + i * CLASS_ROW_HEIGHT,
					text
				}))
			);
		}
		if (node.type === 'object')
			return node.data.rows.map((r, i) => ({
				list: 'slots',
				index: i,
				y: 35 + i * 18,
				text: `${r.name} = ${r.value}`
			}));
		return [];
	});

	/** Where the "add" affordance of each compartment goes. */
	const compartments = $derived.by(() => {
		if (node.type !== 'class') return [];
		return classMetrics(node.data).compartments.map((c) => ({
			list: c.key,
			y: c.y + c.height - CLASS_ROW_HEIGHT - 2,
			end: c.y + c.height
		}));
	});

	function localY(e: MouseEvent): number {
		const el = e.currentTarget as HTMLElement;
		const rect = el.getBoundingClientRect();
		return ((e.clientY - rect.top) / rect.height) * h;
	}

	function ondblclick(e: MouseEvent) {
		if (ctx.readOnly || !node.ref) return;
		e.stopPropagation();
		const y = localY(e);
		const row = rows.find((r) => y >= r.y && y < r.y + CLASS_ROW_HEIGHT);
		if (row) ctx.startEdit({ kind: 'member', nodeId: id, list: row.list, index: row.index });
		else if (!node.isGroup || y < 44) ctx.startEdit({ kind: 'label', nodeId: id });
	}

	function initialText(): string {
		if (!editing) return '';
		if (editing.kind === 'label')
			return node.type === 'object'
				? node.data.label.split(' : ')[0]
				: 'label' in node.data
					? node.data.label
					: '';
		if (editing.isNew)
			return editing.list === 'methods'
				? '+ method(): void'
				: editing.list === 'values'
					? 'VALUE'
					: editing.list === 'slots'
						? 'name = value'
						: '+ name: Type';
		return rows.find((r) => r.list === editing.list && r.index === editing.index)?.text ?? '';
	}

	const editTop = $derived.by(() => {
		if (!editing) return 0;
		if (editing.kind === 'label')
			return node.type === 'class' || node.type === 'object'
				? node.type === 'class' && classMetrics(node.data).headerHeight > 40
					? 20
					: 4
				: Math.max(0, h / 2 - 14);
		if (editing.isNew) return compartments.find((c) => c.list === editing.list)?.end ?? h;
		return rows.find((r) => r.list === editing.list && r.index === editing.index)?.y ?? 0;
	});

	const initial = $derived(initialText());

	function commit(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (!editing || input.dataset.done) return;
		input.dataset.done = '1';
		const edit = editing;
		ctx.startEdit(null);
		if (edit.kind === 'label') {
			if (input.value !== initial) ctx.commitLabel(node, input.value);
		} else if (edit.kind === 'member' && (edit.isNew || input.value !== initial)) {
			ctx.commitMember(node, edit.list, edit.index, input.value, edit.isNew);
		}
	}

	function onkeydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
		if (e.key === 'Escape') {
			(e.currentTarget as HTMLInputElement).dataset.done = '1';
			ctx.startEdit(null);
		}
	}

	function autofocus(el: HTMLInputElement) {
		el.focus();
		el.select();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="sdv-node-wrap"
	class:selected
	class:group={node.isGroup}
	class:hovered={ctx.hovered === id}
	style:width="{w}px"
	style:height="{h}px"
	{ondblclick}
	onmouseenter={() => ctx.setHovered(id)}
	onmouseleave={() => ctx.setHovered(null)}
	data-testid="node-{id}"
	data-pinned={pinned}
>
	<svg width={w} height={h} viewBox="0 0 {w} {h}" overflow="visible" aria-hidden="true">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- shape markup built from escaped text -->
		{@html svg}
	</svg>

	{#if !ctx.readOnly}
		<NodeResizer
			isVisible={selected}
			minWidth={60}
			minHeight={30}
			onResizeEnd={(_, p) => ctx.resize(id, p)}
		/>
	{/if}

	{#each [Position.Top, Position.Right, Position.Bottom, Position.Left] as pos (pos)}
		<Handle
			type="source"
			position={pos}
			id={pos}
			isConnectable={connectable}
			class="sdv-handle {connectable ? '' : 'hidden'}"
		/>
	{/each}

	{#if selected && !ctx.readOnly}
		{#if pinned}
			<button
				class="chip pin nodrag"
				title="Unpin (let auto layout place it)"
				onclick={() => ctx.unpin(id)}>📌</button
			>
		{/if}
		{#each compartments as c (c.list)}
			<button
				class="chip add nodrag"
				style:top="{c.y}px"
				title="Add {c.list === 'values' ? 'value' : c.list.slice(0, -1)}"
				onclick={() => ctx.addMember(node, c.list)}>+</button
			>
		{/each}
		{#if node.type === 'object'}
			<button
				class="chip add nodrag"
				style:top="{h - 18}px"
				title="Add slot"
				onclick={() => ctx.addMember(node, 'slots')}>+</button
			>
		{/if}
	{/if}

	{#if node.type === 'boundary' && !ctx.readOnly}
		<button
			class="chip collapse nodrag"
			title="Collapse"
			onclick={() => ctx.toggleCollapse(id, true)}
			data-testid="collapse-{id}">–</button
		>
	{:else if node.type === 'element' && collapsed}
		<button
			class="chip collapse nodrag"
			title="Expand"
			onclick={() => ctx.toggleCollapse(id, false)}
			data-testid="expand-{id}">+</button
		>
	{/if}

	{#if node.type === 'flow' && node.data.flowType === 'subflow' && node.data.ref}
		<button
			class="chip open nodrag"
			title="Open subflow {node.data.ref}"
			onclick={() => ctx.openSubflow(node.data.ref!)}>↗</button
		>
	{/if}

	{#if editing}
		<input
			class="inline-edit nodrag nopan"
			style:top="{editTop}px"
			value={initial}
			use:autofocus
			onblur={commit}
			{onkeydown}
			aria-label="Edit"
			data-testid="inline-edit"
		/>
	{/if}
</div>

<style>
	.sdv-node-wrap {
		position: relative;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			Helvetica,
			Arial,
			sans-serif;
	}
	svg {
		display: block;
		overflow: visible;
	}
	.sdv-node-wrap.selected:not(.group) svg {
		filter: drop-shadow(0 0 0.5px var(--sdv-selection)) drop-shadow(0 0 3px var(--sdv-selection));
	}
	.sdv-node-wrap.group.selected svg :global(rect:first-child) {
		stroke: var(--sdv-selection) !important;
	}
	:global(.sdv-handle) {
		width: 9px !important;
		height: 9px !important;
		background: var(--sdv-selection) !important;
		border: 2px solid var(--sdv-canvas-bg) !important;
		opacity: 0;
		transition: opacity 0.1s;
	}
	:global(.sdv-handle.hidden) {
		display: none;
	}
	.sdv-node-wrap.hovered :global(.sdv-handle),
	.sdv-node-wrap.selected :global(.sdv-handle),
	:global(.svelte-flow__connection) ~ * :global(.sdv-handle) {
		opacity: 1;
	}
	.chip {
		position: absolute;
		padding: 0 5px;
		min-width: 20px;
		height: 20px;
		line-height: 18px;
		font-size: 12px;
		border-radius: 10px;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		color: var(--ui-text);
		box-shadow: var(--ui-shadow);
	}
	.pin {
		top: -10px;
		left: -10px;
		font-size: 10px;
	}
	.add {
		right: -10px;
	}
	.collapse {
		top: 6px;
		right: 6px;
	}
	.open {
		bottom: -10px;
		right: -10px;
	}
	.inline-edit {
		position: absolute;
		left: 4px;
		right: 4px;
		height: 26px;
		padding: 2px 6px;
		font-size: 13px;
		z-index: 10;
		box-shadow: var(--ui-shadow);
	}
</style>
