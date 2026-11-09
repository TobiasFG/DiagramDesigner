<script lang="ts">
	import { resolve } from '$app/paths';
	import { SvelteFlowProvider } from '@xyflow/svelte';
	import { design } from '#lib/client/store.svelte.ts';
	import { ViewState } from '#lib/client/view-state.svelte.ts';
	import { resetLayout } from '#lib/commands/layout.ts';
	import { layoutFileFor } from '#lib/model/model.ts';
	import { project } from '#lib/projections/index.ts';
	import FlowCanvas from './canvas/FlowCanvas.svelte';
	import SequenceView from './sequence/SequenceView.svelte';
	import Palette from './Palette.svelte';
	import PropertiesPanel from './panel/PropertiesPanel.svelte';
	import ConfirmDelete from './ConfirmDelete.svelte';
	import ExportMenu from './ExportMenu.svelte';

	let { viewId }: { viewId: string } = $props();

	const view = new ViewState();
	const info = $derived(design.model.views.get(viewId));
	const projection = $derived(info ? project(design.model, viewId) : undefined);
	const hasLayout = $derived(!!design.data[layoutFileFor(viewId)]);
	const viewDiagnostics = $derived(projection?.diagnostics ?? []);
	let search = $state('');
	let searchInput: HTMLInputElement | undefined = $state();

	const searchable = $derived.by(() => {
		if (!projection) return [];
		if (projection.kind === 'sequence')
			return projection.participants.map((p) => ({ id: p.id, label: p.label }));
		return projection.nodes.map((n) => ({
			id: n.id,
			label: 'label' in n.data ? n.data.label : n.id
		}));
	});

	function runSearch() {
		const q = search.trim().toLowerCase();
		if (!q) return;
		const hit =
			searchable.find((s) => s.label.toLowerCase() === q || s.id === q) ??
			searchable.find((s) => s.label.toLowerCase().includes(q) || s.id.includes(q));
		if (!hit) return design.notify('info', `No match for "${search}"`);
		view.api?.focus(hit.id);
	}

	function onkeydown(e: KeyboardEvent) {
		const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
		const mod = e.metaKey || e.ctrlKey;
		if (mod && e.key.toLowerCase() === 'z' && !typing) {
			e.preventDefault();
			if (e.shiftKey) design.redo();
			else design.undo();
		} else if (mod && e.key.toLowerCase() === 'y' && !typing) {
			e.preventDefault();
			design.redo();
		} else if (!typing && !mod && e.key === '/') {
			e.preventDefault();
			searchInput?.focus();
		} else if (!typing && !mod && e.key === 'f') {
			view.api?.fit();
		}
	}

	const canAlign = $derived(projection?.kind === 'graph' && view.selectedNodes.length >= 2);
	const canDistribute = $derived(projection?.kind === 'graph' && view.selectedNodes.length >= 3);
</script>

<svelte:window {onkeydown} />

{#if !info || !projection}
	<p class="pad">
		Unknown view <code>{viewId}</code>. <a href={resolve('/')}>Back to all views</a>
	</p>
{:else}
	<div class="editor">
		<div class="toolbar" role="toolbar" aria-label="View tools">
			<a href={resolve('/')} class="back" aria-label="All views">←</a>
			<h1 title={info.id}>{info.title}</h1>
			<span class="muted small">{info.def.type}{info.generated ? ' · generated' : ''}</span>
			<span class="sep"></span>
			<button
				class="icon"
				title="Undo (⌘Z)"
				aria-label="Undo"
				disabled={!design.undoStack.length || design.readOnly}
				onclick={() => design.undo()}
				data-testid="undo">↶</button
			>
			<button
				class="icon"
				title="Redo (⇧⌘Z)"
				aria-label="Redo"
				disabled={!design.redoStack.length || design.readOnly}
				onclick={() => design.redo()}
				data-testid="redo">↷</button
			>
			<span class="sep"></span>
			{#if projection.kind === 'graph'}
				<button onclick={() => view.api?.fit()} title="Fit to view (F)">Fit</button>
				<button
					disabled={!hasLayout || design.readOnly}
					onclick={() => design.execute(resetLayout(viewId))}
					title="Clear all pinned positions"
					data-testid="reset-layout">Reset layout</button
				>
				<button
					aria-pressed={view.snap}
					onclick={() => (view.snap = !view.snap)}
					title="Snap to grid">Snap</button
				>
				<button
					aria-pressed={view.minimap}
					onclick={() => (view.minimap = !view.minimap)}
					title="Minimap">Map</button
				>
				<select
					aria-label="Align selection"
					disabled={!canAlign || design.readOnly}
					onchange={(e) => {
						view.api?.align(e.currentTarget.value as never);
						e.currentTarget.value = '';
					}}
				>
					<option value="">Align…</option>
					<option value="left">Align left</option>
					<option value="center">Align centre</option>
					<option value="right">Align right</option>
					<option value="top">Align top</option>
					<option value="middle">Align middle</option>
					<option value="bottom">Align bottom</option>
					<option value="horizontal" disabled={!canDistribute}>Distribute horizontally</option>
					<option value="vertical" disabled={!canDistribute}>Distribute vertically</option>
				</select>
			{/if}
			<span class="spacer"></span>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					runSearch();
				}}
			>
				<input
					bind:this={searchInput}
					bind:value={search}
					list="sdv-search"
					placeholder="Search (/)"
					aria-label="Search"
					class="search"
				/>
				<datalist id="sdv-search">
					{#each searchable as s (s.id)}<option value={s.label}>{s.id}</option>{/each}
				</datalist>
			</form>
			<ExportMenu {view} {projection} />
		</div>
		{#if viewDiagnostics.length}
			<div class="view-diags">
				{#each viewDiagnostics as d, i (i)}<div class={d.severity}>{d.message}</div>{/each}
			</div>
		{/if}
		<div class="workspace">
			{#if projection.kind === 'graph'}
				{#if !design.readOnly}<Palette {view} viewType={projection.viewType} />{/if}
				<SvelteFlowProvider>
					<FlowCanvas {view} {projection} />
				</SvelteFlowProvider>
			{:else}
				<SequenceView {view} {projection} />
			{/if}
			<PropertiesPanel {view} {projection} />
		</div>
		<ConfirmDelete {view} />
	</div>
{/if}

<style>
	.editor {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-bottom: 1px solid var(--ui-border);
		background: var(--ui-panel);
		flex-wrap: wrap;
	}
	.back {
		text-decoration: none;
		font-size: 18px;
		padding: 0 4px;
	}
	h1 {
		font-size: 15px;
		margin: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 320px;
	}
	.small {
		font-size: 12px;
	}
	.sep {
		width: 1px;
		height: 22px;
		background: var(--ui-border);
		margin: 0 4px;
	}
	.spacer {
		flex: 1;
	}
	.search {
		width: 180px;
	}
	.workspace {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.view-diags {
		padding: 4px 12px;
		font-size: 12px;
		background: var(--ui-panel);
		border-bottom: 1px solid var(--ui-border);
	}
	.view-diags .error {
		color: var(--ui-danger);
	}
	.pad {
		padding: 24px;
	}
</style>
