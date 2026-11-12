<script lang="ts" module>
	import type { ModelField, ModelIndex } from '#lib/model/schema.ts';
	import type { ModelView, TableColumn } from '#lib/landscape/layout.ts';
	import type { ViewState } from '#lib/client/view-state.svelte.ts';

	export interface LandscapeNodeData extends Record<string, unknown> {
		name: string;
		kind: string;
		group: boolean;
		/** Owner's name when the model is owned elsewhere. */
		owner?: string;
		/** The fields that exist in this view. */
		fields?: ModelField[];
		indexes?: ModelIndex[];
		/** Field columns; set when the box is a model card. */
		table?: TableColumn[];
		view?: ModelView;
		/** Names of the models and fields the fields point at (ref, model, from), by id. */
		labels?: Record<string, string>;
		/** How many fields refer to and derive from each field, by field id. */
		incoming?: Record<string, { ref: number; from: number }>;
		/** Selection, focus and flash; read here so they never rebuild the nodes. */
		state: ViewState;
		onfield?: (field: string, ev: 'enter' | 'leave' | 'click') => void;
	}
</script>

<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import {
		fieldRowY,
		indexFields,
		indexKind,
		KEY_TITLES,
		keysOf,
		LEAF,
		LINK,
		subtitle,
		TABLE,
		typeText
	} from '#lib/landscape/layout.ts';

	let { id, data, width = 0, height = 0 }: NodeProps = $props();
	const d = $derived(data as LandscapeNodeData);
	const hot = $derived(d.state.hot[id]);
	const picked = $derived(d.state.field?.box === id ? d.state.field.field : undefined);
	const flash = $derived(d.state.flash?.box === id ? d.state.flash.field : undefined);
	const plural = (n: number, one: string, many: string) =>
		`${n} field${n > 1 ? 's' : ''} ${n > 1 ? many : one}`;
	// A closed group's name scales with the box, so a system reads the same at any size. A
	// leaf is fitted round its name, so the name keeps one size.
	const font = $derived(d.group ? Math.min(width * 0.085, height * 0.2) : LEAF.font);
	const label = (id: string) => d.labels?.[id];
	const names = (ids: string[]) => ids.map((id) => label(id) ?? id).join(', ');
	// The last column takes any width the card has to spare.
	const template = (cols: TableColumn[]) =>
		cols
			.map((c, i) => (i < cols.length - 1 ? `${c.width}px` : `minmax(${c.width}px, 1fr)`))
			.join(' ');
</script>

<!-- Open/closed comes from the wrapper's `open` class (set by the canvas), so it never
     re-renders nodes. -->
<div
	class="node"
	class:group={d.group}
	class:selected={d.state.selectedNodes.includes(id)}
	class:peer-box={d.state.peerBoxes[id]}
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
			class:class={d.view === 'class'}
			class:ref={d.owner && d.view === 'class'}
			style:--pad="{TABLE.pad}px"
			style:--row="{TABLE.rowHeight}px"
		>
			<div class="thead" style:height="{TABLE.head}px">
				<div class="name" style:font-size="{TABLE.title}px">{d.name}</div>
				<div class="note" style:font-size="{TABLE.note}px">
					{subtitle(d.view ?? 'class', d.owner)}
				</div>
			</div>
			{#if d.fields?.length}
				<div
					class="grid"
					style:font-size="{TABLE.row}px"
					style:grid-template-columns={template(cols)}
				>
					{#each cols as c, ci (c.key)}
						<div
							class="cell th"
							class:first={ci === 0}
							class:mark={c.key === 'required' || c.key === 'nullable'}
							style:font-size="{TABLE.label}px"
							title={c.title}
						>
							{c.label}
						</div>
					{/each}
					{#each d.fields as f (f.id)}
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<div
							class="row"
							class:hot={hot?.[f.id] === 'peer'}
							class:self={hot?.[f.id] === 'self'}
							class:picked={picked === f.id}
							class:flash={flash === f.id}
							role="button"
							tabindex="-1"
							onmouseenter={() => d.onfield?.(f.id, 'enter')}
							onmouseleave={() => d.onfield?.(f.id, 'leave')}
							onclick={(e) => {
								e.stopPropagation();
								d.onfield?.(f.id, 'click');
							}}
						>
							{#each cols as c, ci (c.key)}
								<div
									class="cell"
									class:first={ci === 0}
									class:muted={c.key === 'type'}
									class:mark={c.key === 'required' || c.key === 'nullable'}
									class:links={c.key === 'links'}
								>
									{#if c.key === 'name'}{f.name}{#each d.view === 'table' ? keysOf(f) : [] as k (k)}<span
												class="badge"
												style:font-size="{TABLE.badge}px"
												title={KEY_TITLES[k]}>{k}</span
											>{/each}
									{:else if c.key === 'type'}{typeText(f, label)}
									{:else if c.key === 'required'}{f.required ? TABLE.check : ''}
									{:else if c.key === 'nullable'}{f.nullable ? TABLE.check : ''}
									{:else if c.key === 'constraints'}
										{#each f.constraints ?? [] as k (k)}<span
												class="badge plain"
												style:font-size="{TABLE.badge}px">{k}</span
											>{/each}
									{:else}
										{#each c.slots ?? [] as s (s)}
											{@const n =
												s === 'inRef'
													? (d.incoming?.[f.id]?.ref ?? 0)
													: (d.incoming?.[f.id]?.from ?? 0)}
											<span
												class="slot {s}"
												style:min-width="{LINK.slot}px"
												style:font-size="{LINK.count}px"
												title={s === 'ref' && f.ref
													? `References ${names([f.ref])}`
													: s === 'from' && f.from?.length
														? `From ${names(f.from)}${f.derived ? ` · ${f.derived}` : ''}`
														: s === 'inRef' && n
															? plural(n, 'refers here', 'refer here')
															: s === 'inFrom' && n
																? plural(n, 'derives from this', 'derive from this')
																: undefined}
											>
												{#if s === 'ref' && f.ref}
													<svg width={LINK.icon} height={LINK.icon} viewBox="0 0 14 14">
														<path d="M1 7h8" /><path class="fill" d="M8 3.5 13 7 8 10.5Z" />
													</svg>
												{:else if s === 'from' && f.from?.length}
													<svg width={LINK.icon} height={LINK.icon} viewBox="0 0 14 14">
														<path d="M13 7H5" stroke-dasharray="2 1.6" /><path
															class="fill"
															d="M6 3.5 1 7l5 3.5Z"
														/>
													</svg>{#if f.derived}<i>ƒ</i>{/if}
												{:else if (s === 'inRef' || s === 'inFrom') && n}
													<span class="count">{n}</span>
												{/if}
											</span>
										{/each}
									{/if}
								</div>
							{/each}
						</div>
					{/each}
				</div>
			{/if}
			{#if d.indexes?.length}
				<div class="list" style:font-size="{TABLE.row}px">
					<div class="cell th" style:font-size="{TABLE.label}px">Indexes</div>
					{#each d.indexes as ix (ix.name)}
						<div class="cell">
							<span class="badge" class:plain={!ix.unique} style:font-size="{TABLE.badge}px"
								>{indexKind(ix)}</span
							>{ix.name}<span class="muted ix-fields">{indexFields(ix, d.fields ?? [])}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
		<!-- Invisible line ends: one each side of the header, and of every row with a link. -->
		<Handle type="target" id="head:l" position={Position.Left} style="top:{TABLE.head / 2}px" />
		<Handle type="target" id="head:r" position={Position.Right} style="top:{TABLE.head / 2}px" />
		{#each d.fields ?? [] as f, i (f.id)}
			{#if f.ref || f.model || f.from?.length}
				<Handle
					type="source"
					id="out:{f.id}:l"
					position={Position.Left}
					style="top:{fieldRowY(i)}px"
				/>
				<Handle
					type="source"
					id="out:{f.id}:r"
					position={Position.Right}
					style="top:{fieldRowY(i)}px"
				/>
			{/if}
			<Handle
				type="target"
				id="in:{f.id}:l"
				position={Position.Left}
				style="top:{fieldRowY(i)}px"
			/>
			<Handle
				type="target"
				id="in:{f.id}:r"
				position={Position.Right}
				style="top:{fieldRowY(i)}px"
			/>
		{/each}
	{:else}
		<div class="face" style:font-size="{font}px">
			<div class="name">{d.name}</div>
		</div>
	{/if}
</div>

<style>
	.node {
		position: relative;
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		cursor: pointer;
	}
	.node.group {
		border: 1.5px dashed var(--sdv-boundary-stroke);
		background: var(--sdv-boundary-fill);
	}
	/* Opening: the face goes at once, the header and children come in after (see the canvas).
	   Closing: the children go at once, the face comes back after. */
	.node.group > .face,
	.node.group > .header {
		transition: opacity 0.15s ease-out 0.1s;
	}
	.node.group > .header,
	:global(.svelte-flow__node.open) > .node.group > .face {
		opacity: 0;
		transition-delay: 0s;
	}
	:global(.svelte-flow__node.open) > .node.group > .header {
		opacity: 1;
		transition-delay: 0.1s;
	}
	.node.peer-box {
		outline: 2px solid var(--sdv-link-ref);
		outline-offset: 3px;
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
	/* Rows take the pointer, unless the node is a ghost (closed parent). */
	.face.table {
		pointer-events: inherit;
	}
	.face.table.ref {
		border-style: dashed;
	}
	/* A class has a tinted name bar; a table a plain one. */
	.face.table.class .thead {
		background: var(--sdv-model-class-head);
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
	/* A field row: one subgrid line, so it can be hovered, lit and clicked as a whole. */
	.row {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: subgrid;
		outline: none;
	}
	.row:hover {
		background: var(--sdv-row-hover);
	}
	.row.hot {
		background: var(--sdv-row-peer);
	}
	.row.self,
	.row.picked {
		background: var(--sdv-row-self);
		box-shadow: inset 3px 0 0 var(--sdv-selection);
	}
	.row.flash {
		animation: flash 1.4s ease-out;
	}
	@keyframes flash {
		0%,
		35% {
			background: var(--sdv-row-flash);
		}
	}
	.cell.links {
		gap: 0;
		padding-left: 4px;
		padding-right: 6px;
	}
	.slot {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 1px;
		height: 100%;
		color: var(--sdv-text-muted);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.slot.ref {
		color: var(--sdv-link-ref);
	}
	.slot.from {
		color: var(--sdv-link-from);
	}
	/* Incoming links: a count in a pill, like a badge, so it reads as "used by n". */
	.slot .count {
		min-width: 8px;
		padding: 0 4px;
		line-height: 15px;
		border-radius: 8px;
		text-align: center;
		color: var(--sdv-model-fill);
	}
	.slot.inRef .count {
		background: var(--sdv-link-ref);
	}
	.slot.inFrom .count {
		background: var(--sdv-link-from);
	}
	.slot i {
		font-family: Georgia, serif;
		font-size: 11px;
		margin-left: -1px;
	}
	.slot svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
	}
	.slot svg .fill {
		fill: currentColor;
		stroke: none;
	}
	.list {
		display: grid;
		grid-auto-rows: var(--row);
	}
	.list .cell {
		border-left: none;
	}
	.ix-fields {
		margin-left: 4px;
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
	.cell.mark {
		justify-content: center;
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
		white-space: nowrap;
		pointer-events: none;
	}
</style>
