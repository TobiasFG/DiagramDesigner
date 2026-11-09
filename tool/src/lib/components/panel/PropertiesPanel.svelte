<script lang="ts">
	import { parse as parseYaml, stringify } from 'yaml';
	import { design } from '$lib/client/store.svelte';
	import type { ViewState } from '$lib/client/view-state.svelte';
	import { cleanValue, readAt } from '$lib/commands/core';
	import { unpinNode } from '$lib/commands/layout';
	import { setEntity } from '$lib/commands/model';
	import { ENTITY_SCHEMAS } from '$lib/model/schema';
	import { formatPath } from '$lib/model/diagnostics';
	import { zodIssues, issueMessage } from '$lib/model/validate-file';
	import type { EntityRef, Projection } from '$lib/projections/types';
	import SchemaField from './SchemaField.svelte';
	import { entitySchema } from './schema-form';

	let { view, projection }: { view: ViewState; projection: Projection } = $props();

	let tab = $state<'form' | 'yaml'>('form');
	let yamlText = $state('');
	let yamlError = $state('');

	interface Selected {
		ref?: EntityRef;
		title: string;
		subtitle: string;
		nodeId?: string;
		pinned?: boolean;
		note?: string;
	}

	const selected = $derived.by((): Selected | { multiple: number } | undefined => {
		if (projection.kind === 'sequence') {
			if (view.selectedSteps.length > 1) return { multiple: view.selectedSteps.length };
			if (view.selectedSteps.length === 1) {
				const path = JSON.parse(view.selectedSteps[0]);
				const loc = design.model.interactions.get(projection.interactionId)?.loc;
				if (!loc) return undefined;
				const data = readAt(design.data, loc.file, [...loc.path, ...path]) as
					Record<string, unknown> | undefined;
				const kind =
					data && 'group' in data ? 'group' : data && 'note' in data ? 'note' : 'message';
				return {
					ref: { kind, file: loc.file, path: [...loc.path, ...path] },
					title: kind,
					subtitle: formatPath(path)
				};
			}
			if (view.selectedParticipant) {
				const p = projection.participants.find((x) => x.id === view.selectedParticipant);
				if (!p) return undefined;
				return p.plain
					? {
							title: p.label,
							subtitle: 'participant',
							note: 'Not an element of the model; add an element with this id to describe it.'
						}
					: { ref: p.ref, title: p.label, subtitle: `participant · ${p.kind}` };
			}
			return { ref: projection.interactionRef, title: projection.title, subtitle: 'interaction' };
		}
		const count = view.selectedNodes.length + view.selectedEdges.length;
		if (count > 1) return { multiple: count };
		if (view.selectedNodes.length === 1) {
			const id = view.selectedNodes[0];
			const n = projection.nodes.find((x) => x.id === id);
			if (!n) return undefined;
			const pinned = view.positioned?.nodes.find((x) => x.node.id === id)?.pinned;
			if (!n.ref)
				return {
					title: 'label' in n.data ? n.data.label : id,
					subtitle: n.type,
					nodeId: id,
					pinned,
					note: 'Swimlanes follow the actor of their nodes.'
				};
			return {
				ref: n.ref,
				title: 'label' in n.data ? n.data.label : id,
				subtitle: `${n.ref.kind} · ${id}`,
				nodeId: id,
				pinned
			};
		}
		if (view.selectedEdges.length === 1) {
			const e = projection.edges.find((x) => x.id === view.selectedEdges[0]);
			if (!e) return undefined;
			if (e.type === 'aggregated')
				return {
					title: e.data.label ?? 'Aggregated',
					subtitle: `${e.data.count} relationships between hidden children`,
					note: 'Aggregated edges are derived; select the underlying elements to edit.'
				};
			return {
				ref: e.ref,
				title: e.data.label ?? `${e.source} → ${e.target}`,
				subtitle: `${e.ref?.kind ?? e.type} · ${e.id}`
			};
		}
		const v = design.model.views.get(projection.viewId);
		if (v?.loc)
			return {
				ref: { kind: 'view', file: v.loc.file, path: v.loc.path },
				title: v.title,
				subtitle: 'view'
			};
		return {
			title: v?.title ?? projection.viewId,
			subtitle: 'generated view',
			note: 'This default view is generated. It is written to the view file when you change it (e.g. remove something from it).'
		};
	});

	const single = $derived(selected && !('multiple' in selected) ? selected : undefined);
	const ref = $derived(single?.ref);
	const value = $derived(ref ? readAt(design.data, ref.file, ref.path) : undefined);
	const schema = $derived(ref && ref.kind in ENTITY_SCHEMAS ? entitySchema(ref.kind) : undefined);

	/** View fields that apply to the view's type; the rest stay reachable in the YAML tab. */
	const VIEW_FIELDS: Record<string, string[]> = {
		component: ['scope', 'include', 'exclude', 'depth', 'aggregateEdges'],
		class: ['include', 'exclude', 'show'],
		object: ['include', 'exclude'],
		flow: ['source'],
		pipeline: ['source'],
		sequence: ['source']
	};
	const COMMON_VIEW_FIELDS = ['id', 'type', 'title', 'description', 'layout', 'export'];
	const fields = $derived.by(() => {
		const all = Object.entries(schema?.properties ?? {});
		if (ref?.kind !== 'view') return all;
		const type = (value as { type?: string } | undefined)?.type ?? '';
		return all.filter(([k]) => COMMON_VIEW_FIELDS.includes(k) || VIEW_FIELDS[type]?.includes(k));
	});

	$effect(() => {
		yamlText = value === undefined ? '' : stringify(value, { lineWidth: 0 });
		yamlError = '';
	});

	function commit(next: unknown) {
		if (ref) design.execute(setEntity(ref, cleanValue(next)));
	}

	function applyYaml() {
		if (!ref) return;
		try {
			const parsed = parseYaml(yamlText);
			const res = ENTITY_SCHEMAS[ref.kind].safeParse(parsed);
			if (!res.success) {
				yamlError = zodIssues(res.error).map(issueMessage).join('; ');
				return;
			}
			yamlError = '';
			commit(parsed);
		} catch (e) {
			yamlError = (e as Error).message.split('\n')[0];
		}
	}
</script>

<aside class="panel" aria-label="Properties" data-testid="properties">
	{#if !selected}
		<p class="muted pad">Nothing selected.</p>
	{:else if 'multiple' in selected}
		<div class="pad">
			<strong>{selected.multiple} selected</strong>
			<div class="actions">
				{#if projection.kind === 'graph'}
					<button onclick={() => view.api?.removeFromView()} disabled={design.readOnly}
						>Remove from view</button
					>
				{/if}
				<button class="danger" onclick={() => view.api?.requestDelete()} disabled={design.readOnly}
					>Delete…</button
				>
			</div>
			{#if projection.kind === 'graph'}
				<p class="muted small">Align and distribute from the toolbar.</p>
			{/if}
		</div>
	{:else if single}
		<header class="pad">
			<div class="title">{single.title}</div>
			<div class="muted small">{single.subtitle}</div>
			{#if ref}<code class="muted small">{ref.file}</code>{/if}
			<div class="actions">
				{#if single.pinned && single.nodeId}
					<button
						onclick={() => design.execute(unpinNode(projection.viewId, single.nodeId!))}
						disabled={design.readOnly}>Unpin</button
					>
				{/if}
				{#if single.nodeId && ref && projection.kind === 'graph' && ['component', 'class', 'object'].includes(projection.viewType)}
					<button
						onclick={() => view.api?.removeFromView()}
						disabled={design.readOnly}
						data-testid="remove-from-view">Remove from view</button
					>
				{/if}
				{#if ref && ref.kind !== 'view' && ref.kind !== 'interaction' && (single.nodeId || projection.kind === 'sequence' || view.selectedEdges.length)}
					<button
						class="danger"
						onclick={() => view.api?.requestDelete()}
						disabled={design.readOnly}
						data-testid="delete-selected">Delete…</button
					>
				{/if}
			</div>
		</header>
		{#if single.note}<p class="muted small pad">{single.note}</p>{/if}
		{#if ref && schema && value !== undefined}
			<div class="tabs" role="tablist">
				<button role="tab" aria-selected={tab === 'form'} onclick={() => (tab = 'form')}
					>Form</button
				>
				<button
					role="tab"
					aria-selected={tab === 'yaml'}
					onclick={() => (tab = 'yaml')}
					data-testid="tab-yaml">YAML</button
				>
			</div>
			<div class="body">
				{#if tab === 'form'}
					{#key ref.file + JSON.stringify(ref.path)}
						{#each fields as [key, sub] (key)}
							<SchemaField
								schema={sub}
								value={(value as Record<string, unknown>)[key]}
								label={key}
								required={schema.required?.includes(key)}
								root={schema}
								disabled={design.readOnly}
								onchange={(v) => commit({ ...(value as Record<string, unknown>), [key]: v })}
							/>
						{/each}
					{/key}
				{:else}
					<textarea
						class="mono yaml"
						bind:value={yamlText}
						spellcheck="false"
						disabled={design.readOnly}
						aria-label="Entity YAML"
						data-testid="entity-yaml"></textarea>
					{#if yamlError}<p class="error small">{yamlError}</p>{/if}
					<button class="primary" onclick={applyYaml} disabled={design.readOnly}>Apply</button>
				{/if}
			</div>
		{/if}
	{/if}
</aside>

<style>
	.panel {
		width: 300px;
		flex-shrink: 0;
		border-left: 1px solid var(--ui-border);
		background: var(--ui-panel);
		overflow: auto;
		display: flex;
		flex-direction: column;
	}
	.pad {
		padding: 10px 12px;
		margin: 0;
	}
	header {
		border-bottom: 1px solid var(--ui-border);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.title {
		font-weight: 600;
		font-size: 15px;
		overflow-wrap: anywhere;
	}
	.small {
		font-size: 12px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}
	.tabs {
		display: flex;
		gap: 4px;
		padding: 8px 12px 0;
	}
	.body {
		padding: 4px 12px 16px;
	}
	.yaml {
		width: 100%;
		min-height: 260px;
		margin: 8px 0;
		white-space: pre;
	}
	.error {
		color: var(--ui-danger);
	}
</style>
