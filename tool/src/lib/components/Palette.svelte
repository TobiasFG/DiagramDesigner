<script lang="ts">
	import { design } from '#lib/client/store.svelte.ts';
	import type { PaletteItem, ViewState } from '#lib/client/view-state.svelte.ts';
	import { ELEMENT_KINDS, FLOW_NODE_TYPES, type ViewType } from '#lib/model/schema.ts';

	let { view, viewType }: { view: ViewState; viewType: Exclude<ViewType, 'sequence'> } = $props();

	const ELEMENT_LABELS: Record<string, string> = {
		person: 'Person',
		system: 'System',
		container: 'Container',
		component: 'Component',
		external: 'External',
		datastore: 'Datastore',
		queue: 'Queue'
	};

	const items = $derived.by((): PaletteItem[] => {
		switch (viewType) {
			case 'component':
				return ELEMENT_KINDS.map((k) => ({ action: 'element', kind: k, label: ELEMENT_LABELS[k] }));
			case 'class':
				return [
					{ action: 'class', kind: 'class', label: 'Class' },
					{ action: 'class', kind: 'interface', label: 'Interface' },
					{ action: 'class', kind: 'abstract', label: 'Abstract class' },
					{ action: 'class', kind: 'enum', label: 'Enum' }
				];
			case 'object':
				// Only concrete classes can be instantiated.
				return [...design.model.classes.values()]
					.filter((c) => (c.def.kind ?? 'class') === 'class')
					.map((c) => ({
						action: 'object',
						kind: c.id,
						label: `${c.name} object`
					}));
			case 'flow':
				return FLOW_NODE_TYPES.map((t) => ({
					action: 'flowNode',
					kind: t,
					label: t === 'io' ? 'Input / output' : t[0].toUpperCase() + t.slice(1)
				}));
			case 'pipeline':
				return [
					{ action: 'stage', label: 'Stage' },
					{ action: 'job', label: 'Job' }
				];
		}
	});

	function ondragstart(e: DragEvent, item: PaletteItem) {
		e.dataTransfer?.setData('application/x-sdv', JSON.stringify(item));
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
	}
</script>

<aside class="palette" aria-label="Palette">
	<div class="head muted">Add</div>
	{#each items as item (item.action + item.kind)}
		<button
			draggable="true"
			ondragstart={(e) => ondragstart(e, item)}
			onclick={() => view.api?.addAtCenter(item)}
			title="Drag onto the canvas or click to add"
			data-testid="palette-{item.kind ?? item.action}"
			disabled={design.readOnly}
		>
			<span class="swatch {item.kind ?? item.action}"></span>{item.label}
		</button>
	{:else}
		<p class="muted small">Define a class first.</p>
	{/each}
	<p class="muted small hint">Drag between node handles to connect.</p>
</aside>

<style>
	.palette {
		width: 148px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px;
		border-right: 1px solid var(--ui-border);
		background: var(--ui-panel);
		overflow: auto;
	}
	.head {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding: 2px 2px 4px;
	}
	button {
		display: flex;
		align-items: center;
		gap: 8px;
		text-align: left;
		cursor: grab;
	}
	.swatch {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		flex-shrink: 0;
		background: var(--sdv-flow-action-fill);
		border: 1px solid var(--sdv-edge);
	}
	.swatch.person {
		background: var(--sdv-person-fill);
		border-radius: 6px;
	}
	.swatch.system {
		background: var(--sdv-system-fill);
	}
	.swatch.container,
	.swatch.datastore,
	.swatch.queue {
		background: var(--sdv-container-fill);
	}
	.swatch.component {
		background: var(--sdv-component-fill);
	}
	.swatch.external {
		background: var(--sdv-external-fill);
	}
	.swatch.class,
	.swatch.interface,
	.swatch.abstract,
	.swatch.enum {
		background: var(--sdv-class-header);
	}
	.swatch.start {
		background: var(--sdv-flow-terminal-fill);
		border-radius: 6px;
	}
	.swatch.end {
		background: var(--sdv-flow-end-fill);
		border-radius: 6px;
	}
	.swatch.decision {
		background: var(--sdv-flow-decision-fill);
		transform: rotate(45deg) scale(0.8);
	}
	.swatch.stage {
		background: var(--sdv-stage-fill);
		border-color: var(--sdv-stage-stroke);
	}
	.small {
		font-size: 12px;
		margin: 4px 2px;
	}
	.hint {
		margin-top: auto;
	}
</style>
