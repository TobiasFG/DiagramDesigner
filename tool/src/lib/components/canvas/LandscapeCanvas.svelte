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
		shownRows,
		TABLE,
		typeText,
		type FieldLink,
		type LandscapeBox,
		type ModelLink
	} from '#lib/landscape/layout.ts';
	import { apiHosts, openBoxes, railOpen, READABLE } from '#lib/landscape/open.ts';
	import {
		apiUses,
		bodyModels,
		partLabel,
		RAIL,
		railGroups,
		railOf,
		railRowY,
		type ApiUse,
		type Rail
	} from '#lib/landscape/apis.ts';
	import { apiBodies } from '#lib/model/model.ts';
	import { untrack } from 'svelte';
	import LandscapeNode, { type LandscapeNodeData } from './LandscapeNode.svelte';

	/**
	 * The whole model, laid out once. Only boxes inside open boxes are mounted; which boxes are
	 * open follows whether their contents would be readable on screen (see open.ts), and opening
	 * fades over a fixed time.
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
	/** Where row `i` of a card sits, folded or expanded as it is now. */
	const rowY = (b: LandscapeBox, i: number) =>
		fieldRowY(i, b.fields?.length ?? 0, !!view.expanded[b.id]);
	const el = (id: string) => design.model.elements.get(id);

	// State, not derived, so a pan that changes nothing stops here instead of rebuilding nodes
	// every frame, and the boxes that just closed are known.
	let open = $state.raw(new Set<string>());
	// Boxes that just closed; their children stay mounted until they have faded out.
	let closing = $state.raw(new Set<string>());
	// Hosts whose rail rows read at READABLE px, so the rail lists them.
	let openRails = $state.raw(new Set<string>());
	const sameSet = (a: Set<string>, b: Set<string>) =>
		a.size === b.size && [...a].every((id) => b.has(id));
	$effect(() => {
		const { x, y, zoom } = viewport.current;
		if (!ready) return;
		const was = untrack(() => open);
		const next = openBoxes(boxes, { x, y, zoom, width: cw, height: ch });
		const listed = new Set(
			[...railsFor(next)].filter(([, r]) => railOpen(r, zoom)).map(([id]) => id)
		);
		if (
			!sameSet(
				listed,
				untrack(() => openRails)
			)
		)
			openRails = listed;
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

	// Apis sit on a rail across the right border of their parent's box, or of the nearest shown
	// box round it, one rail per box.
	function railsFor(openSet: Set<string>): Map<string, Rail> {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and returned whole
		const out = new Map<string, Rail>();
		for (const [id, apis] of apiHosts(boxes, openSet)) {
			const b = boxById.get(id)!;
			out.set(id, railOf(design.model, railGroups(design.model, b.elementId, apis), b.height));
		}
		return out;
	}
	const rails = $derived(railsFor(open));
	const uses = $derived(apiUses(design.model));
	const hostOf = (api: string) => {
		for (const [id, r] of rails)
			if (r.groups.some((g) => g.apis.includes(api))) return boxById.get(id);
	};
	/** The box drawn for `b`: itself, or the nearest shown box round it while it is hidden. */
	const shownBox = (b: LandscapeBox) => {
		let s = b;
		while (s.parentId && !open.has(s.parentId)) s = boxById.get(s.parentId)!;
		return s;
	};

	function onfield(box: string, field: string, ev: 'enter' | 'leave' | 'click') {
		if (ev === 'enter') view.hover = { box, field };
		else if (ev === 'leave') view.hover = null;
		else {
			const same = view.field?.box === box && view.field.field === field;
			view.field = same ? null : { box, field };
			view.api = null;
			view.apiField = null;
			view.selectedNodes = [];
		}
	}

	function railView(id: string) {
		const r = rails.get(id);
		if (!r) return undefined;
		return {
			top: r.top,
			width: r.width,
			height: r.height,
			scale: r.scale,
			methodWidth: r.methodWidth,
			open: openRails.has(id),
			groups: r.groups.map((g) => ({
				title: g.title,
				apis: g.apis.map((a) => {
					const def = el(a)!.def;
					return { id: a, name: el(a)!.name, method: def.method ?? '', path: def.path ?? '' };
				})
			}))
		};
	}

	/** Zooms in on a closed rail until its rows read, centred on it. */
	function openRail(id: string) {
		const b = boxById.get(id);
		const r = rails.get(id);
		if (!b || !r) return;
		const zoom = Math.max(viewport.current.zoom, (READABLE / (RAIL.font * r.scale)) * 1.05);
		flow.setCenter(b.absX + b.width, b.absY + r.top + r.height / 2, { zoom, duration: 600 });
	}

	/** The rows a field of the picked api's own shape sends into or comes from. */
	function apiFieldTargets(id: string | null) {
		const f = id ? design.model.apiFields.get(id) : undefined;
		const host = f && hostOf(f.apiId);
		if (!f || !host) return [];
		return (f.def.to ?? f.def.from ?? []).flatMap((field) => {
			const box = linkTarget(design.model, boxes, host, field);
			return box ? [{ box, field }] : [];
		});
	}

	// Boxes the picked api's bodies use, outlined with the parts using them, and the rows a
	// trimmed body leaves out, dimmed. A model in a hidden box outlines the box that shows.
	$effect(() => {
		const host = view.api ? hostOf(view.api) : undefined;
		const parts: Record<string, string[]> = {};
		const kept: Record<string, Set<string> | 'all'> = {};
		if (view.api && host)
			for (const u of bodyModels(design.model, view.api)) {
				const t = linkTarget(design.model, boxes, host, u.model);
				if (!t) continue;
				const s = shownBox(t);
				const label = partLabel(u.part);
				if (!(parts[s.id] ??= []).includes(label)) parts[s.id].push(label);
				const k = kept[s.id];
				if (!u.fields || u.fields.length === (s.fields?.length ?? 0) || k === 'all')
					kept[s.id] = 'all';
				else kept[s.id] = new Set([...(k ?? []), ...u.fields]);
			}
		const dim: Record<string, Record<string, true>> = {};
		for (const [id, k] of Object.entries(kept)) {
			if (k === 'all') continue;
			for (const f of boxById.get(id)?.fields ?? [])
				if (!k.has(f.id)) (dim[id] ??= {})[f.id] = true;
		}
		view.apiBoxes = parts;
		view.apiDim = dim;
	});

	function onapi(api: string) {
		view.api = view.api === api ? null : api;
		view.apiField = null;
		view.field = null;
		view.trail = [];
		view.selectedNodes = [];
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
		for (const t of apiFieldTargets(view.apiField)) lit(t.box.id, t.field, 'peer');
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
				{
					ref: incomingCount(rels, id, 'ref'),
					from: incomingCount(rels, id, 'from'),
					api: incomingCount(rels, id, 'api')
				}
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
						onfield: (field, ev) => onfield(b.id, field, ev),
						rail: railView(b.id),
						onapi,
						onrail: () => openRail(b.id)
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
		/** An api using the field; clicking it picks the api. */
		api?: string;
	}

	/** An element's enclosing entities and itself, outermost first. */
	function pathOf(id: string | undefined): string {
		const names: string[] = [];
		for (let e = id ? el(id) : undefined; e; e = e.parentId ? el(e.parentId) : undefined)
			names.unshift(e.name);
		return names.join(' › ');
	}

	const apiEntry = (u: ApiUse): Entry => {
		const a = el(u.api)!;
		const via = u.via ? design.model.apiFields.get(u.via)?.def.name : undefined;
		return {
			text: `${a.def.method} ${a.def.path} · ${partLabel(u.part)}${via ? `.${via}` : ''}`,
			where: `${a.name} · ${via ? 'own shape, keeps its own name' : 'the model itself, so a rename changes it'}`,
			api: u.api
		};
	};

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
				{ label: 'Feeds', kind: 'from', glyph: '⇢', entries: inOf('from') },
				{
					label: 'Fed by apis',
					kind: 'from',
					glyph: '⇠',
					entries: (uses.fedBy.get(f.field) ?? []).map(apiEntry)
				},
				{
					label: 'Returned by apis',
					kind: 'from',
					glyph: '⇢',
					entries: (uses.returnedBy.get(f.field) ?? []).map(apiEntry)
				}
			].filter((s) => s.entries.length)
		};
	});

	const statusClass = (s: number) => (s < 300 ? 'ok' : s < 400 ? '' : s < 500 ? 'warn' : 'bad');

	/** The picked api, for the card beside its rail row. */
	const apiCard = $derived.by(() => {
		const a = view.api ? el(view.api) : undefined;
		const host = view.api ? hostOf(view.api) : undefined;
		if (!a || !host) return undefined;
		const names = (ids: string[]) =>
			ids.map((id) => design.model.fields.get(id)?.def.name ?? id).join(', ');
		const d = a.def;
		const bodies = apiBodies(d).map(({ part, body }) => {
			const t = body.model ? linkTarget(design.model, boxes, host, body.model) : undefined;
			return {
				part,
				status: typeof part === 'number' ? part : undefined,
				description: 'description' in body ? (body.description as string | undefined) : undefined,
				model: body.model && {
					text: label(body.model) + (body.many ? '[]' : ''),
					note: body.omit
						? `without ${names(body.omit)}`
						: body.pick
							? `only ${names(body.pick)}`
							: t
								? whereOf(t)
								: 'not drawn',
					target: t && { box: t }
				},
				many: !!body.many && !!body.fields,
				fields: (body.fields ?? []).map((f) => {
					const links = (part === 'request' ? f.to : f.from) ?? [];
					return {
						id: f.id,
						name: f.name + (f.required ? '' : '?'),
						type: typeText(f, (id) => refLabel(design.model, id)),
						traced: links.length > 0 || !!f.model,
						title: links.length
							? `${part === 'request' ? 'Goes into' : 'Comes from'} ${links.map(label).join(', ')}${f.derived ? ` · ${f.derived}` : ''}`
							: f.model
								? undefined
								: part === 'request'
									? 'Goes into no model field: add to'
									: 'Comes from no field: add from'
					};
				})
			};
		});
		return {
			method: d.method ?? '',
			path: d.path ?? '',
			sub: [a.name, pathOf(a.parentId), d.auth && `auth: ${d.auth}`].filter(Boolean).join(' · '),
			params: d.params ?? [],
			request: bodies.find((b) => b.part === 'request'),
			responses: bodies.filter((b) => b.part !== 'request')
		};
	});

	/** Where the picked api's row is on screen: the rail's edges and the row's middle. */
	const apiAnchor = $derived.by(() => {
		const host = view.api ? hostOf(view.api) : undefined;
		const r = host && rails.get(host.id);
		if (!view.api || !host || !r) return undefined;
		const { x: vx, y: vy, zoom } = viewport.current;
		const left = host.absX + host.width - r.width / 2;
		const row = openRails.has(host.id) ? railRowY(r, view.api) : undefined;
		const y = host.absY + r.top + (row !== undefined ? row * r.scale : r.height / 2);
		return { left: left * zoom + vx, right: (left + r.width) * zoom + vx, y: y * zoom + vy };
	});

	const CARD_W = 320;
	const cardPos = $derived.by(() => {
		if (!apiAnchor) return undefined;
		const right = apiAnchor.right + 14;
		const left = right + CARD_W <= cw - 8 ? right : Math.max(8, apiAnchor.left - 14 - CARD_W);
		return { left, top: Math.min(Math.max(8, apiAnchor.y - 24), Math.max(8, ch - 160)) };
	});

	/**
	 * Lines from the picked api's row, in screen px: solid to each model its bodies use, and
	 * dashed to the fields a hovered field of its own shape sends into or comes from.
	 */
	const apiLines = $derived.by(() => {
		const host = view.api ? hostOf(view.api) : undefined;
		if (!view.api || !host || !apiAnchor) return [];
		const { x: vx, y: vy, zoom } = viewport.current;
		const out: { d: string; arrow: string; kind: 'ref' | 'from' }[] = [];
		const draw = (t: LandscapeBox, y: number, kind: 'ref' | 'from', arrowAtRail = false) => {
			const tl = t.absX * zoom + vx;
			const tr = (t.absX + t.width) * zoom + vx;
			const ty = y * zoom + vy;
			const leftward = tr <= apiAnchor.left;
			const x0 = leftward ? apiAnchor.left : apiAnchor.right;
			const x1 = x0 + (leftward ? -12 : 12);
			const tx = leftward ? tr : tl;
			const head = (x: number, y: number, dir: number) =>
				`M${x} ${y} L${x - dir * 9} ${y - 4.5} L${x - dir * 9} ${y + 4.5} Z`;
			out.push({
				d: `M${x0} ${apiAnchor.y} H${x1} V${ty} H${tx}`,
				arrow: arrowAtRail
					? head(x0, apiAnchor.y, leftward ? 1 : -1)
					: head(tx, ty, tx < x1 ? -1 : 1),
				kind
			});
		};
		for (const u of bodyModels(design.model, view.api)) {
			const t = linkTarget(design.model, boxes, host, u.model);
			if (!t) continue;
			const s = shownBox(t);
			draw(s, s === t && t.view ? t.absY + TABLE.head / 2 : s.absY + s.height / 2, 'ref');
		}
		const f = view.apiField ? design.model.apiFields.get(view.apiField) : undefined;
		for (const t of apiFieldTargets(view.apiField)) {
			const s = shownBox(t.box);
			const i = t.box.fields?.findIndex((x) => x.id === t.field) ?? -1;
			draw(
				s,
				s === t.box && i >= 0 ? t.box.absY + rowY(t.box, i) : s.absY + s.height / 2,
				'from',
				f?.part !== 'request'
			);
		}
		return out;
	});

	/** Picks an api from the inspector and centres on the box owning it. */
	function showApi(id: string) {
		const owner = el(id)?.parentId;
		const box = boxes.find((b) => b.elementId === owner && !b.ref);
		view.field = null;
		view.trail = [];
		view.apiField = null;
		view.api = id;
		if (box) flyTo({ box });
	}

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
		// A row hidden in a folded card is shown by expanding the card.
		if (row >= shownRows(t.fields?.length ?? 0, !!view.expanded[t.id]))
			view.expanded = { ...view.expanded, [t.id]: true };
		// Keep [start, start + size] on a canvas side of `side` pixels, if it fits.
		const keep = (c: number, start: number, size: number, side: number) => {
			const half = side / 2 / zoom;
			return size <= 2 * half ? Math.min(Math.max(c, start + size - half), start + half) : c;
		};
		flow.setCenter(
			keep(t.absX + t.width / 2, area.absX, area.width, cw),
			keep(t.absY + (row >= 0 ? rowY(t, row) : t.height / 2), area.absY, area.height, ch),
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
		view.api = null;
		view.apiField = null;
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
		maxZoom={64}
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
							disabled={!e.target && !e.api}
							onclick={() => (e.api ? showApi(e.api) : e.target && flyTo(e.target))}
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
	{:else if apiCard && cardPos}
		{@const api = apiCard}
		<svg class="api-lines" aria-hidden="true">
			{#each apiLines as l, i (i)}
				<path class="line {l.kind}" d={l.d} />
				<path class="head {l.kind}" d={l.arrow} />
			{/each}
		</svg>
		<!-- Beside the picked row, moving with the canvas, so the api and what it uses share a view. -->
		<aside
			class="inspector api-card"
			style:left="{cardPos.left}px"
			style:top="{cardPos.top}px"
			style:width="{CARD_W}px"
			data-testid="api-inspector"
		>
			<header>
				<div class="head">
					<div class="title">
						<span style:color="var(--sdv-method-{api.method.toLowerCase()}, var(--sdv-text-muted))"
							>{api.method}</span
						>
						<span class="mono">{api.path}</span>
					</div>
					<div class="type">{api.sub}</div>
				</div>
				<button class="icon-btn" onclick={unpin} aria-label="Close" title="Close (Esc)">×</button>
			</header>
			{#if api.params.length}
				<section>
					<h4>Params</h4>
					{#each api.params as p (p.in + p.name)}
						<div class="entry">
							<span class="text">{p.name}{p.required || p.in === 'path' ? '' : '?'}</span>
							<span class="where"
								>{p.in} · {p.type}{p.description ? ` · ${p.description}` : ''}</span
							>
						</div>
					{/each}
				</section>
			{/if}
			{#each [api.request, ...api.responses].filter((b) => !!b) as b (b.part)}
				<section class="body">
					<h4>
						{#if b.status}<b class="status {statusClass(b.status)}">{b.status}</b
							>{:else}Request{/if}
						{#if b.fields.length}<span class="shape">own shape{b.many ? ', a list' : ''}</span>{/if}
						{#if b.description}<span class="shape">{b.description}</span>{/if}
					</h4>
					{#if b.model}
						{@const m = b.model}
						<button
							class="entry"
							disabled={!m.target}
							onclick={() => m.target && flyTo(m.target)}
							title={m.target ? 'Go to' : undefined}
						>
							<span class="text">{m.text}</span>
							<span class="where">{m.note}</span>
						</button>
					{/if}
					{#each b.fields as f (f.id)}
						<div
							class="api-field"
							class:hot={view.apiField === f.id}
							role="listitem"
							title={f.title}
							onmouseenter={() => (view.apiField = f.id)}
							onmouseleave={() => (view.apiField = null)}
						>
							<span class="name">{f.name}</span>
							<span class="where">{f.type}</span>
							{#if !f.traced}<span class="untraced">▲</span>{:else if f.title}<span class="traced"
									>{b.part === 'request' ? '→' : '←'}</span
								>{/if}
						</div>
					{/each}
					{#if !b.model && !b.fields.length && !b.description}<p class="empty">No body.</p>{/if}
				</section>
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
	.inspector .status {
		font-variant-numeric: tabular-nums;
		margin-right: 6px;
	}
	.inspector div.entry {
		cursor: default;
	}
	.inspector .note,
	.inspector .empty {
		margin: 4px 12px;
	}
	.api-card {
		right: auto;
		max-height: none;
	}
	.inspector .mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 13px;
	}
	.inspector .body h4 {
		display: flex;
		gap: 6px;
		align-items: baseline;
	}
	.inspector .shape {
		font-weight: 400;
		letter-spacing: 0;
	}
	.status.ok {
		color: var(--sdv-method-get);
	}
	.status.warn {
		color: var(--sdv-method-put);
	}
	.status.bad {
		color: var(--sdv-method-delete);
	}
	.api-field {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 8px;
		align-items: baseline;
		padding: 3px 12px 3px 10px;
		border-left: 2px solid transparent;
		cursor: default;
	}
	.api-field.hot {
		background: var(--sdv-row-hover);
		border-left-color: var(--sdv-link-from);
	}
	.api-field .name {
		font-weight: 500;
	}
	.api-field .traced {
		color: var(--sdv-link-from);
	}
	.api-field .untraced {
		color: var(--sdv-method-put);
		font-size: 11px;
	}
	.api-lines {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 9;
		pointer-events: none;
		overflow: visible;
	}
	.api-lines .line {
		fill: none;
		stroke-width: 2;
	}
	.api-lines .line.ref {
		stroke: var(--sdv-link-ref);
	}
	.api-lines .line.from {
		stroke: var(--sdv-link-from);
		stroke-dasharray: 5 4;
	}
	.api-lines .head.ref {
		fill: var(--sdv-link-ref);
	}
	.api-lines .head.from {
		fill: var(--sdv-link-from);
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
