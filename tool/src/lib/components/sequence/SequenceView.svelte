<script lang="ts">
	import { onMount } from 'svelte';
	import { design } from '$lib/client/store.svelte';
	import type { ViewState } from '$lib/client/view-state.svelte';
	import { deleteMany } from '$lib/commands/delete';
	import { setColumnWidth } from '$lib/commands/layout';
	import { patchEntity, renameEntity } from '$lib/commands/model';
	import {
		addParticipant,
		insertStep,
		moveParticipant,
		moveStep,
		removeParticipant,
		wrapSteps
	} from '$lib/commands/sequence';
	import type { DataPath } from '$lib/model/diagnostics';
	import { GROUP_KINDS, MESSAGE_KINDS, type Step } from '$lib/model/schema';
	import type { EntityRef, SeqMessage, SequenceGraph } from '$lib/projections/types';
	import { toSvgString } from '$lib/render/svg';
	import { markerDefs } from '$lib/render/shapes';
	import { drawHeader, drawSequenceBody } from '$lib/sequence/draw';
	import { layoutSequence, SEQ, type SeqSlot } from '$lib/sequence/layout';
	import { cssVarResolver } from '$lib/theme/tokens';

	let { view, projection }: { view: ViewState; projection: SequenceGraph } = $props();

	const t = cssVarResolver;
	const layout = $derived(layoutSequence(projection));
	$effect(() => {
		view.seqLayout = layout;
	});

	const headerH = SEQ.margin + SEQ.headerHeight;
	const markers = toSvgString(markerDefs(t));
	const body = $derived(
		toSvgString({
			tag: 'g',
			children: [
				...drawSequenceBody(layout, t),
				...layout.columns
					.filter((c) => c.headerY !== SEQ.margin)
					.map((c) => drawHeader(c, c.headerY, t))
			]
		})
	);
	const headers = $derived(
		toSvgString({
			tag: 'g',
			children: layout.columns
				.filter((c) => c.headerY === SEQ.margin)
				.map((c) => drawHeader(c, SEQ.margin, t))
		})
	);
	const inter = $derived(design.model.interactions.get(projection.interactionId));
	const readOnly = $derived(design.readOnly || !inter);

	let zoom = $state(1);
	let bodySvg: SVGSVGElement | undefined = $state();
	let headerSvg: SVGSVGElement | undefined = $state();
	let scroller: HTMLDivElement | undefined = $state();
	const key = (p: DataPath) => JSON.stringify(p);
	const selected = $derived(new Set(view.selectedSteps));

	// ---------------------------------------------------------------- pointer helpers
	function toSvg(svg: SVGSVGElement, e: PointerEvent | MouseEvent): { x: number; y: number } {
		const m = svg.getScreenCTM()?.inverse();
		if (!m) return { x: 0, y: 0 };
		const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
		return { x: p.x, y: p.y };
	}

	function nearestSlot(y: number, exclude?: DataPath): SeqSlot | undefined {
		const ex = exclude ? key(exclude) : undefined;
		let best: SeqSlot | undefined;
		for (const s of layout.slots) {
			// A step cannot be dropped inside itself.
			if (ex && key([...s.list]).startsWith(ex.slice(0, -1))) continue;
			if (!best || Math.abs(s.y - y) < Math.abs(best.y - y)) best = s;
		}
		return best;
	}

	function columnAt(x: number): string | undefined {
		let best: { id: string; d: number } | undefined;
		for (const c of layout.columns) {
			const d = Math.abs(c.x - x);
			if (d < Math.max(40, c.width / 2) && (!best || d < best.d))
				best = { id: c.participant.id, d };
		}
		return best?.id;
	}

	// ---------------------------------------------------------------- draw a new message
	let drawing = $state<{ from: string; x1: number; x2: number; y: number; slot?: SeqSlot } | null>(
		null
	);

	function startDraw(e: PointerEvent, from: string, x: number) {
		if (readOnly || !bodySvg) return;
		e.preventDefault();
		const p = toSvg(bodySvg, e);
		drawing = { from, x1: x, x2: p.x, y: p.y, slot: nearestSlot(p.y) };
		const move = (ev: PointerEvent) => {
			const q = toSvg(bodySvg!, ev);
			drawing = { ...drawing!, x2: q.x, y: q.y, slot: nearestSlot(q.y) };
		};
		const up = async (ev: PointerEvent) => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			const d = drawing;
			drawing = null;
			const to = columnAt(toSvg(bodySvg!, ev).x);
			if (!d?.slot || !to) return;
			const step: Step = { from: d.from, to, msg: d.from === to ? 'process()' : 'request()' };
			if (
				await design.execute(insertStep(projection.interactionId, d.slot.list, d.slot.index, step))
			) {
				const path = [...d.slot.list, d.slot.index];
				view.selectedSteps = [key(path)];
				editingPath = key(path);
			}
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	// ---------------------------------------------------------------- drag messages to reorder
	let dragging = $state<{ path: DataPath; y: number; slot?: SeqSlot } | null>(null);

	function startMessageDrag(e: PointerEvent, m: SeqMessage) {
		e.stopPropagation();
		const k = key(m.path);
		if (e.shiftKey || e.metaKey) {
			view.selectedSteps = selected.has(k)
				? view.selectedSteps.filter((s) => s !== k)
				: [...view.selectedSteps, k];
			return;
		}
		view.selectedSteps = [k];
		view.selectedParticipant = null;
		if (readOnly || !bodySvg) return;
		const start = toSvg(bodySvg, e).y;
		let moved = false;
		const move = (ev: PointerEvent) => {
			const y = toSvg(bodySvg!, ev).y;
			if (!moved && Math.abs(y - start) < 5) return;
			moved = true;
			dragging = { path: m.path, y, slot: nearestSlot(y, m.path) };
		};
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			const d = dragging;
			dragging = null;
			if (!moved || !d?.slot) return;
			const from = d.path;
			const sameList = key(from.slice(0, -1)) === key(d.slot.list);
			const fromIndex = from[from.length - 1] as number;
			if (sameList && (d.slot.index === fromIndex || d.slot.index === fromIndex + 1)) return;
			design.execute(moveStep(projection.interactionId, from, d.slot.list, d.slot.index));
			view.selectedSteps = [];
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	// ---------------------------------------------------------------- headers: select, reorder, resize
	let headerDrag = $state<{ id: string; dx: number } | null>(null);

	function startHeaderDrag(e: PointerEvent, id: string) {
		view.selectedParticipant = id;
		view.selectedSteps = [];
		if (readOnly || !headerSvg) return;
		const x0 = toSvg(headerSvg, e).x;
		let moved = false;
		const move = (ev: PointerEvent) => {
			const dx = toSvg(headerSvg!, ev).x - x0;
			if (Math.abs(dx) > 5) moved = true;
			if (moved) headerDrag = { id, dx };
		};
		const up = (ev: PointerEvent) => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			headerDrag = null;
			if (!moved) return;
			const x = toSvg(headerSvg!, ev).x;
			const others = layout.columns.filter((c) => c.participant.id !== id);
			const index = others.filter((c) => c.x < x).length;
			const current = layout.columns.findIndex((c) => c.participant.id === id);
			if (index !== current) design.execute(moveParticipant(projection.interactionId, id, index));
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	function startResize(e: PointerEvent, id: string, width: number) {
		e.stopPropagation();
		if (readOnly || !headerSvg) return;
		const x0 = toSvg(headerSvg, e).x;
		let w = width;
		const move = (ev: PointerEvent) => (w = width + (toSvg(headerSvg!, ev).x - x0) * 2);
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			if (Math.abs(w - width) > 4) design.execute(setColumnWidth(projection.viewId, id, w));
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	// ---------------------------------------------------------------- inline label edit
	let editingPath = $state<string | null>(null);
	const editingMessage = $derived(
		editingPath ? layout.messages.find((m) => key(m.item.path) === editingPath) : undefined
	);

	function commitLabel(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (input.dataset.done || !editingMessage) return;
		input.dataset.done = '1';
		const m = editingMessage;
		editingPath = null;
		if (input.value !== m.item.label) design.execute(renameEntity(m.item.ref, input.value));
	}

	// ---------------------------------------------------------------- toolbar actions
	const selectedRefs = $derived.by((): EntityRef[] => {
		if (!inter) return [];
		return view.selectedSteps.map((s) => {
			const path = JSON.parse(s) as DataPath;
			return { kind: 'message', file: inter.loc.file, path: [...inter.loc.path, ...path] };
		});
	});
	const selectedMessage = $derived(
		view.selectedSteps.length === 1
			? layout.messages.find((m) => key(m.item.path) === view.selectedSteps[0])
			: undefined
	);

	/** Selected steps as one consecutive range of a single list, if they form one. */
	const range = $derived.by(() => {
		const paths = view.selectedSteps.map((s) => JSON.parse(s) as DataPath);
		if (!paths.length) return undefined;
		const list = key(paths[0].slice(0, -1));
		if (!paths.every((p) => key(p.slice(0, -1)) === list)) return undefined;
		const idx = paths.map((p) => p[p.length - 1] as number).sort((a, b) => a - b);
		if (idx.some((v, i) => i > 0 && v !== idx[i - 1] + 1)) return undefined;
		return { list: paths[0].slice(0, -1), start: idx[0], end: idx[idx.length - 1] + 1 };
	});

	let groupKind = $state<(typeof GROUP_KINDS)[number]>('opt');
	let newParticipant = $state('');
	const candidates = $derived(
		[...design.model.elements.values()].filter(
			(el) => !projection.participants.some((p) => p.id === el.id)
		)
	);

	function requestDelete() {
		if (readOnly) return;
		if (view.selectedParticipant && !view.selectedSteps.length) {
			const id = view.selectedParticipant;
			const cmd = removeParticipant(projection.interactionId, id);
			const preview = design.preview(cmd);
			view.pendingDelete = {
				title: `Remove participant "${id}" and its messages?`,
				command: cmd,
				files: preview.files
			};
			return;
		}
		if (!selectedRefs.length) return;
		const cmd = deleteMany(selectedRefs, []);
		view.pendingDelete = {
			title: `Delete ${selectedRefs.length} step(s)?`,
			command: cmd,
			files: design.preview(cmd).files
		};
	}

	function addNote() {
		const over =
			view.selectedParticipant ?? selectedMessage?.item.from ?? projection.participants[0]?.id;
		if (!over) return;
		const slot = range
			? { list: range.list, index: range.end }
			: { list: ['steps'], index: Infinity };
		design.execute(
			insertStep(projection.interactionId, slot.list, slot.index === Infinity ? 1e9 : slot.index, {
				note: 'Note',
				over
			})
		);
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.target as HTMLElement).closest('input, textarea, select')) return;
		if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			requestDelete();
		} else if (e.key === 'Escape') view.clearSelection();
		else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && selectedMessage) {
			e.preventDefault();
			const p = selectedMessage.item.path;
			const i = p[p.length - 1] as number;
			const list = p.slice(0, -1);
			const to = e.key === 'ArrowUp' ? i - 1 : i + 2;
			if (to < 0) return;
			design.execute(moveStep(projection.interactionId, p, list, to)).then((ok) => {
				if (ok) view.selectedSteps = [key([...list, e.key === 'ArrowUp' ? i - 1 : i + 1])];
			});
		}
	}

	onMount(() => {
		view.api = {
			fit: () => {
				if (scroller)
					zoom = Math.min(1.5, Math.max(0.3, (scroller.clientWidth - 16) / layout.width));
			},
			focus(id) {
				view.selectedParticipant = id;
				const c = layout.columns.find((x) => x.participant.id === id);
				if (c && scroller)
					scroller.scrollTo({ left: c.x * zoom - scroller.clientWidth / 2, behavior: 'smooth' });
			},
			align: () => {},
			addAtCenter: () => {},
			requestDelete,
			removeFromView: () => {}
		};
		return () => (view.api = null);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="seq" {onkeydown} tabindex="-1" data-testid="sequence">
	<div class="seq-tools" role="toolbar" aria-label="Sequence tools">
		<button class="icon" onclick={() => (zoom = Math.max(0.3, zoom - 0.1))} aria-label="Zoom out"
			>−</button
		>
		<span class="muted small">{Math.round(zoom * 100)}%</span>
		<button class="icon" onclick={() => (zoom = Math.min(2, zoom + 0.1))} aria-label="Zoom in"
			>+</button
		>
		<span class="sep"></span>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				if (newParticipant.trim())
					design.execute(addParticipant(projection.interactionId, newParticipant.trim()));
				newParticipant = '';
			}}
		>
			<input
				bind:value={newParticipant}
				list="seq-candidates"
				placeholder="Add participant"
				aria-label="Add participant"
				disabled={readOnly}
				data-testid="add-participant"
			/>
			<datalist id="seq-candidates">
				{#each candidates as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
			</datalist>
		</form>
		<button onclick={addNote} disabled={readOnly}>+ Note</button>
		<span class="sep"></span>
		{#if selectedMessage}
			<select
				aria-label="Message kind"
				value={selectedMessage.item.kind}
				disabled={readOnly}
				onchange={(e) =>
					design.execute(
						patchEntity(
							selectedMessage.item.ref,
							{ kind: e.currentTarget.value === 'sync' ? undefined : e.currentTarget.value },
							'Change kind'
						)
					)}
				data-testid="message-kind"
			>
				{#each MESSAGE_KINDS as k (k)}<option value={k}>{k}</option>{/each}
			</select>
			<button
				aria-pressed={selectedMessage.item.activate}
				disabled={readOnly}
				onclick={() =>
					design.execute(
						patchEntity(
							selectedMessage.item.ref,
							{ activate: selectedMessage.item.activate ? undefined : true },
							'Toggle activation'
						)
					)}
				title="Activate the receiver until the matching return">Activate</button
			>
		{/if}
		{#if range}
			<select bind:value={groupKind} aria-label="Group kind">
				{#each GROUP_KINDS as g (g)}<option value={g}>{g}</option>{/each}
			</select>
			<button
				disabled={readOnly}
				onclick={() =>
					range &&
					design
						.execute(
							wrapSteps(projection.interactionId, range.list, range.start, range.end, groupKind)
						)
						.then(() => (view.selectedSteps = []))}
				data-testid="wrap-group">Group</button
			>
		{/if}
		{#if view.selectedParticipant || view.selectedSteps.length}
			<button class="danger" disabled={readOnly} onclick={requestDelete}
				>{view.selectedParticipant && !view.selectedSteps.length
					? 'Remove participant'
					: 'Delete'}</button
			>
		{/if}
		<span class="spacer"></span>
		<span class="muted small hint"
			>Drag between lifelines to add a message · drag messages to reorder · ⌥↑/↓ moves</span
		>
	</div>

	<div class="scroller" bind:this={scroller}>
		<div class="headers" style:width="{layout.width * zoom}px">
			<svg
				bind:this={headerSvg}
				width={layout.width * zoom}
				height={headerH * zoom}
				viewBox="0 0 {layout.width} {headerH}"
				role="list"
				aria-label="Participants"
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- generated from escaped text -->
				{@html headers}
				{#each layout.columns.filter((c) => c.headerY === SEQ.margin) as c (c.participant.id)}
					<g
						transform={headerDrag?.id === c.participant.id
							? `translate(${headerDrag.dx} 0)`
							: undefined}
					>
						<rect
							class="hit header"
							class:sel={view.selectedParticipant === c.participant.id}
							x={c.x - c.headerWidth / 2}
							y={SEQ.margin}
							width={c.headerWidth}
							height={SEQ.headerHeight - 8}
							rx="4"
							role="listitem"
							aria-label={c.participant.label}
							onpointerdown={(e) => startHeaderDrag(e, c.participant.id)}
							data-testid="participant-{c.participant.id}"
						/>
						{#if !readOnly}
							<rect
								class="resize"
								x={c.x + c.width / 2 - 4}
								y={SEQ.margin}
								width="8"
								height={SEQ.headerHeight - 8}
								onpointerdown={(e) => startResize(e, c.participant.id, c.width)}
								role="separator"
								aria-label="Resize column"
							/>
						{/if}
					</g>
				{/each}
			</svg>
		</div>
		<svg
			bind:this={bodySvg}
			class="body"
			width={layout.width * zoom}
			height={(layout.height - headerH) * zoom}
			viewBox="0 {headerH} {layout.width} {layout.height - headerH}"
		>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- static marker definitions -->
			{@html markers}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- generated from escaped text -->
			{@html body}
			{#each layout.columns as c (c.participant.id)}
				<rect
					class="hit lifeline"
					x={c.x - 10}
					y={c.headerY + SEQ.headerHeight - 8}
					width="20"
					height={Math.max(0, c.lifelineEnd - c.headerY - SEQ.headerHeight + 8)}
					onpointerdown={(e) => startDraw(e, c.participant.id, c.x)}
					role="button"
					tabindex="-1"
					aria-label="Draw message from {c.participant.label}"
					data-testid="lifeline-{c.participant.id}"
				/>
			{/each}
			{#each layout.messages as m (key(m.item.path))}
				{@const x = Math.min(m.x1, m.x2)}
				{@const w = m.self ? 48 : Math.abs(m.x2 - m.x1)}
				<rect
					class="hit message"
					class:sel={selected.has(key(m.item.path))}
					x={x - 4}
					y={m.y - 20}
					width={w + 8}
					height={m.self ? SEQ.selfExtra + 30 : 28}
					rx="4"
					onpointerdown={(e) => startMessageDrag(e, m.item)}
					ondblclick={() => !readOnly && (editingPath = key(m.item.path))}
					role="button"
					tabindex="-1"
					aria-label="Message {m.item.label}"
					data-testid="message-{m.index}"
				/>
			{/each}
			{#each layout.fragments as f (key(f.item.path))}
				<rect
					class="hit fragment"
					class:sel={selected.has(key(f.item.path))}
					x={f.x}
					y={f.y}
					width="44"
					height="18"
					onpointerdown={(e) => {
						e.stopPropagation();
						view.selectedSteps = [key(f.item.path)];
						view.selectedParticipant = null;
					}}
					role="button"
					tabindex="-1"
					aria-label="{f.item.kind} fragment"
				/>
			{/each}
			{#each layout.notes as n (key(n.item.path))}
				<rect
					class="hit note"
					class:sel={selected.has(key(n.item.path))}
					x={n.x}
					y={n.y}
					width={n.width}
					height={n.height}
					onpointerdown={(e) => {
						e.stopPropagation();
						view.selectedSteps = [key(n.item.path)];
						view.selectedParticipant = null;
					}}
					role="button"
					tabindex="-1"
					aria-label="Note {n.item.text}"
				/>
			{/each}
			{#if drawing}
				<line
					class="preview"
					x1={drawing.x1}
					y1={drawing.slot?.y ?? drawing.y}
					x2={drawing.x2}
					y2={drawing.slot?.y ?? drawing.y}
				/>
			{/if}
			{#if drawing?.slot ?? dragging?.slot}
				{@const s = (drawing?.slot ?? dragging?.slot)!}
				<line
					class="slot"
					x1={SEQ.margin + s.depth * 8}
					x2={layout.width - SEQ.margin - s.depth * 8}
					y1={s.y}
					y2={s.y}
				/>
			{/if}
		</svg>
		{#if editingMessage}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="msg-edit"
				style:left="{((editingMessage.x1 + editingMessage.x2) / 2) * zoom - 90}px"
				style:top="{(editingMessage.y - 30) * zoom}px"
				value={editingMessage.item.label}
				autofocus
				onblur={commitLabel}
				onkeydown={(e) => {
					e.stopPropagation();
					if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
					if (e.key === 'Escape') {
						(e.currentTarget as HTMLInputElement).dataset.done = '1';
						editingPath = null;
					}
				}}
				aria-label="Message label"
				data-testid="message-edit"
			/>
		{/if}
	</div>
</div>

<style>
	.seq {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		background: var(--sdv-canvas-bg);
		outline: none;
	}
	.seq-tools {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-bottom: 1px solid var(--ui-border);
		background: var(--ui-panel);
		flex-wrap: wrap;
	}
	.sep {
		width: 1px;
		height: 22px;
		background: var(--ui-border);
	}
	.spacer {
		flex: 1;
	}
	.small {
		font-size: 12px;
	}
	.scroller {
		flex: 1;
		overflow: auto;
		position: relative;
	}
	.headers {
		position: sticky;
		top: 0;
		z-index: 2;
		background: var(--sdv-canvas-bg);
		box-shadow: 0 1px 0 var(--ui-border);
	}
	svg {
		display: block;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			Roboto,
			Helvetica,
			Arial,
			sans-serif;
		user-select: none;
	}
	.hit {
		fill: transparent;
		cursor: pointer;
	}
	.hit.header {
		cursor: grab;
	}
	.hit.lifeline {
		cursor: crosshair;
	}
	.hit.message:hover,
	.hit.lifeline:hover {
		fill: color-mix(in srgb, var(--sdv-selection) 8%, transparent);
	}
	.hit.sel {
		fill: color-mix(in srgb, var(--sdv-selection) 12%, transparent);
		stroke: var(--sdv-selection);
		stroke-width: 1.5;
	}
	.resize {
		fill: transparent;
		cursor: ew-resize;
	}
	.preview {
		stroke: var(--sdv-selection);
		stroke-width: 2;
		stroke-dasharray: 4 3;
	}
	.slot {
		stroke: var(--sdv-selection);
		stroke-width: 2;
	}
	.msg-edit {
		position: absolute;
		width: 180px;
		box-shadow: var(--ui-shadow);
		z-index: 3;
	}
</style>
