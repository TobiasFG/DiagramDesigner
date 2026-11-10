<script lang="ts" module>
	import type { ModelField, ModelIndex } from '#lib/model/schema.ts';
	import type { TableCols } from '#lib/landscape/layout.ts';

	export interface LandscapeNodeData extends Record<string, unknown> {
		name: string;
		kind: string;
		group: boolean;
		selected: boolean;
		/** Owner's name when the box is a reference to a model owned elsewhere. */
		owner?: string;
		fields?: ModelField[];
		indexes?: ModelIndex[];
		/** Column widths; set when the model is drawn as a table. */
		table?: TableCols;
		/** Names of the models that fields refer to, by id. */
		refNames?: Record<string, string>;
	}
</script>

<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import {
		fieldRowY,
		indexKind,
		keysOf,
		LEAF,
		subtitle,
		TABLE,
		typeText,
		type TableColumn
	} from '#lib/landscape/layout.ts';

	let { data, width = 0, height = 0 }: NodeProps = $props();
	const d = $derived(data as LandscapeNodeData);
	// A closed group's name scales with the box, so a system reads the same at any size. A
	// leaf is fitted round its name, so the name keeps one size.
	const font = $derived(d.group ? Math.min(width * 0.085, height * 0.2) : LEAF.font);
	const refName = (f: ModelField) => (f.ref ? d.refNames?.[f.ref] : undefined);
	// The last column takes any width the card has to spare.
	const template = (cols: TableColumn<unknown>[]) =>
		cols
			.map((c, i) => (i < cols.length - 1 ? `${c.width}px` : `minmax(${c.width}px, 1fr)`))
			.join(' ');
</script>

<!-- Opacity comes from CSS variables set on the canvas (--z, --cw, --ch) and on the node
     wrapper (--w, --h, --pw, --ph), so zooming never re-renders nodes. -->
<div
	class="node"
	class:group={d.group}
	class:selected={d.selected}
	style:--fill="var(--sdv-{d.kind}-fill, var(--sdv-container-fill))"
	style:--stroke="var(--sdv-{d.kind}-stroke, var(--sdv-container-stroke))"
	style:--text="var(--sdv-{d.kind}-text, var(--sdv-container-text))"
	style:--hdr="{Math.max(8, height * 0.06)}px"
>
	{#if d.group}
		<div class="header">{d.name}</div>
	{/if}
	{#if d.table}
		{@const cols = d.table}
		<div
			class="face table"
			class:ref={d.owner}
			style:--pad="{TABLE.pad}px"
			style:--row="{TABLE.rowHeight}px"
		>
			<div class="thead" style:height="{TABLE.head}px">
				<div class="name" style:font-size="{TABLE.title}px">{d.name}</div>
				<div class="note" style:font-size="{TABLE.note}px">{subtitle(d.owner)}</div>
			</div>
			{#if d.fields?.length}
				<div
					class="grid"
					style:font-size="{TABLE.row}px"
					style:grid-template-columns={template(cols.fields)}
				>
					{#each cols.fields as c, ci (c.key)}
						<div class="cell th" class:first={ci === 0} style:font-size="{TABLE.label}px">
							{c.label}
						</div>
					{/each}
					{#each d.fields as f (f.name)}
						{#each cols.fields as c, ci (c.key)}
							<div class="cell" class:first={ci === 0} class:muted={c.key === 'type'}>
								{#if c.key === 'name'}{f.name}
								{:else if c.key === 'type'}{typeText(f)}
								{:else if c.key === 'keys'}
									{#each keysOf(f) as k (k)}<span class="badge" style:font-size="{TABLE.badge}px"
											>{k}</span
										>{/each}
								{:else}{refName(f) ?? ''}{/if}
							</div>
						{/each}
					{/each}
				</div>
			{/if}
			{#if d.indexes?.length}
				<div
					class="grid"
					style:font-size="{TABLE.row}px"
					style:grid-template-columns={template(cols.indexes)}
				>
					{#each cols.indexes as c, ci (c.key)}
						<div class="cell th" class:first={ci === 0} style:font-size="{TABLE.label}px">
							{c.label}
						</div>
					{/each}
					{#each d.indexes as ix (ix.name)}
						{#each cols.indexes as c, ci (c.key)}
							<div class="cell" class:first={ci === 0} class:muted={c.key === 'fields'}>
								{#if c.key === 'name'}{ix.name}
								{:else if c.key === 'fields'}{ix.fields.join(', ')}
								{:else}<span
										class="badge"
										class:plain={!ix.unique}
										style:font-size="{TABLE.badge}px">{indexKind(ix)}</span
									>{/if}
							</div>
						{/each}
					{/each}
				</div>
			{/if}
		</div>
		<!-- Invisible line ends: one each side of the header, and of every row with a ref. -->
		<Handle type="target" id="head:l" position={Position.Left} style="top:{TABLE.head / 2}px" />
		<Handle type="target" id="head:r" position={Position.Right} style="top:{TABLE.head / 2}px" />
		{#each d.fields ?? [] as f, i (f.name)}
			{#if f.ref}
				<Handle
					type="source"
					id="{f.name}:l"
					position={Position.Left}
					style="top:{fieldRowY(i)}px"
				/>
				<Handle
					type="source"
					id="{f.name}:r"
					position={Position.Right}
					style="top:{fieldRowY(i)}px"
				/>
			{/if}
		{/each}
	{:else}
		<div class="face" style:font-size="{font}px">
			<div class="name">{d.name}</div>
		</div>
	{/if}
</div>

<style>
	.node {
		/* How much of the canvas the parent fills. The parent's face fades out between 0.5 and
		   0.6, then its children fade in between 0.55 and 0.7, so labels never overlap. */
		--pf: max(calc(var(--pw) * var(--z) / var(--cw)), calc(var(--ph) * var(--z) / var(--ch)));
		--vis: clamp(0, calc((var(--pf) - 0.55) / 0.15), 1);
		--open: 0;
		position: relative;
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		opacity: var(--vis);
		cursor: pointer;
	}
	.node.group {
		--own: max(calc(var(--w) * var(--z) / var(--cw)), calc(var(--h) * var(--z) / var(--ch)));
		--open: clamp(0, calc((var(--own) - 0.5) / 0.1), 1);
		border: 1.5px dashed var(--sdv-boundary-stroke);
		background: var(--sdv-boundary-fill);
	}
	.node.selected {
		outline: 2px solid var(--sdv-selection);
		outline-offset: 2px;
	}
	.face {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.2em;
		padding: 0.4em;
		box-sizing: border-box;
		text-align: center;
		background: var(--fill);
		border: 1px solid var(--stroke);
		color: var(--text);
		opacity: calc(1 - var(--open));
		pointer-events: none;
	}
	.name {
		font-weight: 600;
	}
	/* Model as a table card: a name bar, then a fields table and an indexes table. */
	.face.table {
		justify-content: flex-start;
		align-items: stretch;
		gap: 0;
		padding: 0;
		text-align: left;
		white-space: nowrap;
		overflow: hidden;
		background: var(--sdv-model-fill);
		border-color: var(--sdv-model-stroke);
		color: var(--sdv-model-text);
	}
	.face.table.ref {
		border-style: dashed;
	}
	.thead {
		display: flex;
		flex-direction: column;
		justify-content: center;
		flex-shrink: 0;
		padding: 0 var(--pad);
		line-height: 1.35;
	}
	.note,
	.muted {
		color: var(--sdv-text-muted);
	}
	.grid {
		display: grid;
		grid-auto-rows: var(--row);
	}
	.cell {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 var(--pad);
		border-top: 1px solid var(--sdv-model-stroke);
		border-left: 1px solid var(--sdv-model-stroke);
	}
	.cell.first {
		border-left: none;
	}
	.th {
		background: var(--sdv-model-header);
		color: var(--sdv-text-muted);
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	.badge {
		padding: 0 6px;
		line-height: 1.6;
		font-weight: 600;
		background: var(--sdv-model-key-fill);
		color: var(--sdv-model-key-text);
	}
	.badge.plain {
		background: var(--sdv-model-header);
		color: var(--sdv-text-muted);
	}
	.node :global(.svelte-flow__handle) {
		opacity: 0;
		pointer-events: none;
	}
	.header {
		position: absolute;
		left: 0.6em;
		top: 0.3em;
		font-size: min(calc(14px / var(--z)), var(--hdr));
		font-weight: 600;
		color: var(--sdv-boundary-text);
		opacity: var(--open);
		white-space: nowrap;
		pointer-events: none;
	}
</style>
