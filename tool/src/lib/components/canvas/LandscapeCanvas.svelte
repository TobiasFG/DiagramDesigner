<script lang="ts">
	import {
		ChevronDown,
		ChevronLeft,
		ChevronUp,
		LocateFixed,
		Play,
		TriangleAlert,
		X
	} from '@lucide/svelte';
	import { changes } from '#lib/client/changes.svelte.ts';
	import { CanvasCamera, setCamera } from '#lib/client/camera.svelte.ts';
	import { methodColor } from '#lib/theme/tokens.ts';
	import { flagAsk, goAsk, scenarioAsk, search } from '#lib/client/search.svelte.ts';
	import { changeLabel } from '#lib/scenario/labels.ts';
	import { changedOf } from '#lib/scenario/front.ts';
	import SearchPalette from '#lib/components/SearchPalette.svelte';
	import type { Hit } from '#lib/landscape/search.ts';
	import {
		cutLike,
		focusOn,
		focusOnChange,
		focusOnFlag,
		focusOnRun,
		focusOf,
		flagRoles,
		type Focus,
		type FocusMode
	} from '#lib/landscape/focus.ts';
	import { flagKeys } from '#lib/model/flags.ts';
	import FocusBar from './FocusBar.svelte';
	import Minimap from './Minimap.svelte';
	import { settings } from '#lib/client/settings.svelte.ts';
	import {
		HOVER_DELAY,
		type FieldRef,
		type Hot,
		type ViewState
	} from '#lib/client/view-state.svelte.ts';
	import {
		cardRows,
		fieldRowY,
		HEADER,
		incomingCount,
		layoutLandscape,
		linkTarget,
		logicRowY,
		enumOf,
		refLabel,
		channelNote,
		channelWord,
		storedAsFile,
		relationsOf,
		shownRows,
		TABLE,
		typeText,
		constraintsOf,
		constraintLabel,
		type FieldLink,
		type Landscape,
		type LandscapeBox
	} from '#lib/landscape/layout.ts';
	import type { LayoutInput } from '#lib/landscape/layout-worker.ts';
	import LayoutWorker from '#lib/landscape/layout-worker.ts?worker';
	import { OffThread, type OffThreadPort } from '#lib/client/off-thread.ts';
	import {
		apiOf,
		edgeKey,
		edgesOf,
		homeOf,
		leavesOf,
		moduleLines,
		moduleLook,
		type DependencyKind,
		type RestLine,
		within,
		type LinkKind
	} from '#lib/landscape/connections.ts';
	import { drawnInFull, READABLE, restShownIn } from '#lib/landscape/open.ts';
	import { GLYPH, textWidth } from '#lib/render/text.ts';
	import { sequenceCol, sequenceOf, sequenceWidth } from '#lib/landscape/sequence.ts';
	import Ident from '#lib/components/Ident.svelte';
	import SequenceDiagram from './SequenceDiagram.svelte';
	import PlayerBar from './PlayerBar.svelte';
	import { callOf, forwardGoesInto, runOf, stepOutOf, type PlayStep } from '#lib/landscape/play.ts';
	import type { LogicField } from '#lib/model/schema.ts';
	import {
		apiUses,
		bodyModels,
		partLabel,
		RAIL,
		railGroups,
		railOf,
		railRowY,
		type ApiUse
	} from '#lib/landscape/apis.ts';
	import { apiBodies, type Model } from '#lib/model/model.ts';
	import { durationWords, nextRuns, scheduleWords } from '#lib/model/schedule.ts';
	import { BY_WORDS, byOf, onWords } from '#lib/model/message.ts';
	import {
		routeKey,
		type Point,
		type Rect,
		type RouteEnd,
		type RouteLine,
		type Side
	} from '#lib/landscape/route.ts';
	import { RouteClient, type RouteAhead, type RoutePort } from '#lib/landscape/route-client.ts';
	import { routeStore } from '#lib/landscape/route-store.ts';
	import { LANE, laneLines } from '#lib/landscape/lanes.ts';
	import { RoutingClock, type RoutingRun } from '#lib/landscape/routing-clock.ts';
	import { headEnd, railsOf, restGroups, sides } from '#lib/landscape/scene.ts';
	import { design } from '#lib/client/store.svelte.ts';
	import RoutingProgress from './RoutingProgress.svelte';
	import RouteWorker from '#lib/landscape/route-worker.ts?worker';
	import wasmUrl from 'libavoid-js/dist/libavoid.wasm?url';
	import { untrack } from 'svelte';
	import CardPeek, { type CardData } from './CardPeek.svelte';
	import GlLayer, { type GlHit, type GlLine } from './GlLayer.svelte';
	import EntityGlyph, { type GlyphKind } from './EntityGlyph.svelte';
	import ChangeSection from '#lib/components/ChangeSection.svelte';
	import ChangesPanel from '#lib/components/ChangesPanel.svelte';
	import EditMenu from '#lib/components/EditMenu.svelte';

	/**
	 * The whole model, laid out once, every box mounted and open. Zoomed out, cards and rails draw
	 * only their frames unless they are looked at (see open.ts).
	 */
	let { view }: { view: ViewState } = $props();

	const MIN_ZOOM = 0.05;
	const MAX_ZOOM = 64;
	/** The canvas's camera (see CanvasCamera); the cards, minimap and player move it too. */
	const camera = new CanvasCamera();
	setCamera(camera);

	let cw = $state(1);
	let ch = $state(1);
	/** The layout the view was last fitted to: a new one is fitted again. */
	let fittedTo: unknown;
	let fittedFocus: unknown;
	/** Where the view was before the focus, to go back to on leaving it. */
	let beforeFocus: { x: number; y: number; zoom: number } | undefined;
	/** Where the view was before playing, to go back to on stopping. */
	let beforePlay: { x: number; y: number; zoom: number } | undefined;
	/** The next new focus keeps the camera where it was put, instead of fitting. */
	let keepCamera = false;
	/** A new focus is being fitted; the camera is left to it. */
	let fitting = false;
	// Set once the first fit has landed; before it the camera is a placeholder.
	let ready = $state(false);
	/** The key explaining the canvas's marks is shown. */
	let keyOpen = $state(false);

	// The design, or the state of a scenario or commit being compared (see changes.svelte.ts);
	// in a focus, cut down to the subject and what connects to it, drawn the same. Playing, to
	// what the run can touch, whatever focus it started in.
	const playing = $derived(view.play?.unit);
	// The change the canvas is focused on, for the front (see changes.svelte.ts): only what
	// names it, so switching Direct and All doesn't work it out again.
	$effect(() => {
		const f = playing ? null : view.focused;
		const next =
			f?.flag || f?.scenario
				? { id: f.id, flag: f.flag, scenario: f.scenario, change: f.change }
				: null;
		if (JSON.stringify(next) !== JSON.stringify(untrack(() => changes.subject)))
			changes.subject = next;
	});
	/**
	 * A focus on a change, cut from a design holding both its states, so moving between them
	 * moves no box: a flag key's from the design laid out (every branch and gated item in), a
	 * scenario's from its Diff state (what is dropped put back).
	 */
	const changeFocus = $derived.by(() => {
		const f = playing ? undefined : view.focused;
		if (f?.flag) return focusOnFlag(changes.layoutModel, f, changes.front);
		const c = changes.comparison;
		if (!f?.scenario || !c || !changes.focusComparison) return undefined;
		const ids =
			f.reach === 'chain' && changes.front
				? changes.front.keep
				: changedOf(changes.focusComparison);
		return focusOnChange(c.union, f, ids);
	});
	const flagFocus = $derived(view.focused?.flag ? changeFocus : undefined);
	/** The focus wanted now; what is drawn catches up with it once it is laid out. */
	const wantFocused = $derived(
		playing
			? focusOnRun(changes.shown, playing)
			: changeFocus
				? cutLike(changeFocus, changes.shown)
				: view.focused && !view.focused.scenario
					? focusOn(changes.shown, view.focused)
					: undefined
	);
	const wantFocusKey = $derived(playing ? `run:${playing}` : view.focused);
	// Laid out with every flag branch and gated item in, so setting a flag moves nothing; a flag
	// focus too, drawing the state shown in the layout of both.
	const wantLayout = $derived<LayoutInput>(
		wantFocused
			? {
					model: (changeFocus ?? wantFocused).model,
					opts: settings.layout,
					foldAt: (changeFocus ?? wantFocused).foldAt
				}
			: { model: changes.layoutModel, opts: settings.layout }
	);
	const sameLayout = (a: LayoutInput, b: LayoutInput) =>
		a.model === b.model && a.opts === b.opts && a.foldAt === b.foldAt;

	/**
	 * Laying out a large landscape takes seconds, so it is laid out in a worker
	 * (layout-worker.ts), and the canvas draws the last layout that came in, with the model and
	 * focus it was laid out for, until the one wanted comes in. The last few are kept, so going
	 * back to one, as on leaving a focus, draws it at once.
	 */
	const layouts = new OffThread<LayoutInput, Landscape>(
		({ model, opts, foldAt }) => layoutLandscape(model, opts, foldAt),
		typeof Worker === 'undefined'
			? undefined
			: () => new LayoutWorker() as unknown as OffThreadPort<LayoutInput, Landscape>
	);
	$effect(() => () => layouts.destroy());
	const keptLayouts: { input: LayoutInput; laid: Landscape }[] = [];
	interface Shown {
		input: LayoutInput;
		laid: Landscape;
		focused: typeof wantFocused;
		focusKey: typeof wantFocusKey;
		/** The model drawn with it: the focus's, or the design shown when it was wanted. */
		model: Model;
	}
	/** The layout drawn, with what it was laid out for; none until the first comes in. */
	let shown = $state.raw<Shown>();
	$effect(() => {
		const input = wantLayout;
		const [focus, key] = [wantFocused, wantFocusKey];
		if (untrack(() => shown && sameLayout(shown.input, input) && shown.focusKey === key)) return;
		const show = (laid: Landscape) => {
			shown = {
				input,
				laid,
				focused: focus,
				focusKey: key,
				model: untrack(() => focus?.model ?? changes.shown)
			};
		};
		const kept = keptLayouts.find((k) => sameLayout(k.input, input));
		if (kept) return show(kept.laid);
		// The options are state, which a worker cannot be sent: a copy of them.
		layouts.run({ ...input, opts: $state.snapshot(input.opts) }, (laid) => {
			keptLayouts.unshift({ input, laid });
			keptLayouts.length = Math.min(keptLayouts.length, 4);
			show(laid);
		});
	});
	/** The layout drawn is the one wanted: the model and focus wanted now are drawn. */
	const fresh = $derived(!!shown && sameLayout(shown.input, wantLayout));
	const focused = $derived(fresh ? wantFocused : shown?.focused);
	const focusKey = $derived(fresh ? wantFocusKey : shown?.focusKey);
	const model = $derived(
		fresh ? (wantFocused?.model ?? changes.shown) : (shown?.model ?? changes.shown)
	);
	const laid = $derived<Landscape>(shown?.laid ?? { boxes: [], lines: [] });
	const boxes = $derived(laid.boxes);
	// However large the landscape, it can be zoomed out until all of it is in view, with room
	// to spare.
	const minZoom = $derived.by(() => {
		if (!boxes.length) return MIN_ZOOM;
		const w =
			Math.max(...boxes.map((b) => b.absX + b.width)) - Math.min(...boxes.map((b) => b.absX));
		const h =
			Math.max(...boxes.map((b) => b.absY + b.height)) - Math.min(...boxes.map((b) => b.absY));
		return Math.min(MIN_ZOOM, Math.min(cw / w, ch / h) / 2);
	});
	$effect(() => {
		camera.minZoom = minZoom;
		camera.maxZoom = MAX_ZOOM;
		camera.width = cw;
		camera.height = ch;
	});
	const rels = $derived(relationsOf(model));
	// The minimap draws the root boxes, named, and the modules directly in them.
	const mapBoxes = $derived(
		boxes.flatMap((b) => {
			const box = { id: b.id, x: b.absX, y: b.absY, width: b.width, height: b.height };
			if (!b.parentId) return [{ ...box, name: el(b.elementId)?.name ?? b.id }];
			const top = !boxById.get(b.parentId)?.parentId;
			return top && el(b.elementId)?.def.kind === 'module' ? [box] : [];
		})
	);
	const boxById = $derived(new Map(boxes.map((b) => [b.id, b])));
	// Gated off in the shown flag state: drawn hidden, so neither end of a line.
	const hiddenLeaf = (id: string) =>
		changes.hidden.has(id) || changes.hidden.has(apiOf(model, id) ?? '');
	// Every connection, less the kinds the key hides.
	const allEdges = $derived(edgesOf(model).filter((e) => !hiddenLeaf(e.from) && !hiddenLeaf(e.to)));
	const shownEdges = $derived(allEdges.filter((e) => !view.hidden[KEY_OF[e.kind]]));
	const leavesBy = $derived(new Map(boxes.map((b) => [b.id, new Set(leavesOf(model, b))])));
	const label = (id: string) => refLabel(model, id) ?? id;
	/**
	 * Where row `i` of a card sits, folded or expanded as it is now; logic and triggers cards
	 * never fold.
	 */
	const rowY = (b: LandscapeBox, i: number) =>
		cardRows(b)
			? logicRowY(i)
			: fieldRowY(i, b.fields?.length ?? 0, !!view.expanded[b.id], b.foldAt);
	/** The row of a field, logic unit or trigger in a card, or -1. */
	const rowOf = (b: LandscapeBox, id: string | undefined) =>
		cardRows(b)?.findIndex((r) => r.id === id) ?? b.fields?.findIndex((f) => f.id === id) ?? -1;
	const el = (id: string) => model.elements.get(id);
	const focusedEl = $derived(view.focused && changes.shown.elements.get(view.focused.id));
	/** The focused flag key: its definitions, how many are on now, and their defaults. */
	const focusFlag = $derived.by(() => {
		if (!view.focused?.flag) return undefined;
		const defs = flagKeys(design.model).get(view.focused.id) ?? [];
		const on = defs.filter((d) => changes.flagState.get(d)).length;
		const dflt = new Set(defs.map((d) => !!changes.flagDefaults.get(d)));
		return {
			defs,
			on: on === defs.length ? true : on ? ('mixed' as const) : false,
			dflt: dflt.size > 1 ? ('split' as const) : dflt.has(true),
			set: (value: boolean) => changes.setFlags(defs, value)
		};
	});
	/** A scenario focus's subject: the scenario, or one change of it with its number. */
	const scenarioFocusName = $derived.by(() => {
		const f = view.focused;
		const s = changes.scenario;
		const c = changes.comparison;
		if (!f?.scenario || !s) return '';
		const ch = f.change === undefined ? undefined : s.changes[f.change];
		return ch && c ? `${f.change! + 1}. ${changeLabel(c.before, c.after, ch)}` : s.name;
	});
	/** What depends on the focused flag key, by the part each plays (see `flagRoles`). */
	const focusRoles = $derived(
		view.focused?.flag && !playing ? flagRoles(design.model, view.focused.id) : undefined
	);
	const isUnit = (id: string) => el(id)?.def.kind === 'logic-unit';
	const isApiEl = (id: string) => el(id)?.def.kind === 'api';
	const isTrigger = (id: string) => el(id)?.def.kind === 'trigger';
	const isChannel = (id: string) => el(id)?.def.kind === 'channel';
	/**
	 * A module's own box, not one of its row cards (whose element is the module too); a top-level
	 * module is a module like any other.
	 */
	const isModuleBox = (b: LandscapeBox) =>
		b.id === b.elementId && el(b.elementId)?.def.kind === 'module';

	// Every system and module is drawn open at any zoom. Zoomed out, what thins out is the rows of
	// cards and rails (see open.ts), which are most of what a large landscape draws.
	const open = $derived(new Set(boxes.filter((b) => b.group).map((b) => b.id)));
	// Cards and rails drawing their rows: where they read and are on or near the screen (see
	// open.ts), or all of them at any zoom in a focus, which is small. GlLayer reads it from the
	// view state, and it is only replaced when it changes, so a pan rebuilds nothing and redraws
	// only the boxes coming into or leaving view.
	$effect(() => {
		const { x, y, zoom } = camera.current;
		const next = focused
			? [...boxes.map((b) => b.id), ...rails.keys()]
			: [...drawnInFull(boxes, rails, { x, y, zoom, width: cw, height: ch })];
		const was = untrack(() => view.near);
		if (next.length === Object.keys(was).length && next.every((id) => was[id])) return;
		view.near = Object.fromEntries(next.map((id) => [id, true as const]));
	});
	// The zoom alone, so what reads it is left alone while the view pans.
	const zoom = $derived(camera.current.zoom);
	/** The rail on box `id` lists its endpoints: they read near the screen, or are looked at. */
	const listed = (id: string) => !!view.near[id] || !!view.full[id];

	// Apis sit on a rail across the right border of their parent's box, or of the nearest shown
	// box round it, one rail per box.
	const rails = $derived(railsOf(model, boxes, boxById, open));
	const uses = $derived(apiUses(model));
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

	/**
	 * An open module's name keeps NAME_PX on screen as the canvas zooms out, and so does a
	 * closed rail's. Past where a module's fits the room above its children (half of HEADER),
	 * both are drawn here, in front of everything, never wider than their box nor taller than
	 * half of it; until then the box draws them (see GlLayer).
	 * A module's sits in its top-left corner, a rail's on the rail's middle. `em` is the name's
	 * width in ems: the text, its glyph and its backing's padding and margin (1.2em); it is
	 * 1.6em tall with its margin. `max` is the cap, in canvas px.
	 */
	const NAME_PX = 13;
	const namesInFront = $derived(zoom < NAME_PX / (HEADER / 2));
	const fitIn = (b: LandscapeBox, em: number) => Math.min(b.width / em, b.height / 2 / 1.6);
	const frontNames = $derived([
		...boxes.flatMap((b) => {
			const info = el(b.elementId)!;
			if (!b.group) return [];
			const system = !b.boundary && info.def.kind === 'module' && !info.parentId;
			const em = textWidth(info.name, 100, true) / 100 + GLYPH + 1.2;
			const glyph = system
				? ('system' as const)
				: b.boundary
					? ('class' as const)
					: ('module' as const);
			return [{ id: b.id, b, name: info.name, glyph, em, max: fitIn(b, em), x: b.absX, y: b.absY }];
		}),
		...[...rails].map(([id, r]) => {
			const b = boxById.get(id)!;
			const em = textWidth('APIs', 100, true) / 100 + GLYPH + 1.2;
			const y = b.absY + r.top + r.height / 2;
			return {
				id: `rail:${id}`,
				b,
				name: 'APIs',
				glyph: 'api' as const,
				em,
				max: fitIn(b, em),
				x: b.absX + b.width,
				y
			};
		})
	]);
	/**
	 * The names drawn in front, the larger box's first (a box's own before its rail's), then each
	 * one clear of those drawn. A rail's goes while the rail lists its endpoints.
	 */
	const namesShown = $derived.by(() => {
		if (!namesInFront) return [];
		const z = zoom;
		const placed: { x: number; y: number; w: number; h: number }[] = [];
		return [...frontNames]
			.sort((a, b) => b.b.width * b.b.height - a.b.width * a.b.height)
			.filter((m) => {
				const rail = m.id.startsWith('rail:');
				if (rail && (listed(m.b.id) || view.railHover === m.b.id)) return false;
				const f = Math.min(NAME_PX / z, m.max);
				// What is drawn: without the margin and spare width `em` keeps, 1.2em tall.
				const w = f * (m.em - 0.6);
				const r = rail
					? { x: m.x - w / 2, y: m.y - 0.6 * f, w, h: 1.2 * f }
					: { x: m.x + 0.3 * f, y: m.y + 0.4 * f, w, h: 1.2 * f };
				const hit = placed.some(
					(p) => r.x < p.x + p.w && p.x < r.x + r.w && r.y < p.y + p.h && p.y < r.y + r.h
				);
				if (!hit) placed.push(r);
				return !hit;
			});
	});
	// ------------------------------------------------------------ connections
	/** The key entry each kind of connection is listed and hidden under. */
	const KEY_OF: Record<LinkKind, string> = {
		ref: 'ref',
		body: 'ref',
		model: 'model',
		from: 'from',
		reads: 'reads',
		writes: 'writes',
		calls: 'calls',
		handles: 'calls',
		sends: 'sends',
		on: 'on'
	};
	/** The colour token of each kind of line. */
	const LINK_TOKEN: Record<LinkKind, string> = {
		ref: 'ref',
		body: 'ref',
		model: 'ref',
		from: 'from',
		reads: 'ref',
		writes: 'write',
		calls: 'call',
		handles: 'call',
		sends: 'call',
		on: 'event'
	};

	/** A box looked at, or a row or api in it. */
	type Look = { box: string; leaf?: string } | null;
	/** The row or api under the pointer. */
	const hoveredRow = $derived<Look>(
		view.hover ? { box: view.hover.box, leaf: view.hover.field } : null
	);
	/** The card or name bar under the pointer, also while a row of it is. */
	const hoveredBox = $derived<Look>(view.hoverBox ? { box: view.hoverBox } : null);
	/** What is clicked. */
	const picked = $derived.by((): Look => {
		const host = view.api ? hostOf(view.api) : undefined;
		if (view.api && host) return { box: host.id, leaf: view.api };
		if (view.field) return { box: view.field.box, leaf: view.field.field };
		if (view.selectedNodes[0]) return { box: view.selectedNodes[0] };
		return null;
	});
	/**
	 * What is looked at: a row or api under the pointer, else a card or name bar, else what is
	 * clicked. A row or api focuses its own connections (with the hovered field of a picked
	 * api's shape); a box those of everything in it.
	 */
	const focus = $derived(hoveredRow ?? hoveredBox ?? picked);

	/** One end of a lit line: the node and handle it ends on, and where that is. */
	interface End {
		leaf: string;
		/** The box the leaf is drawn in; `node` unless that is hidden. */
		home: LandscapeBox;
		node: LandscapeBox;
		/** `row:<id>`, `api:<id>` or `head`. */
		anchor: string;
		/** The node's left and right edges and the anchor's height, in canvas px. */
		x0: number;
		x1: number;
		y: number;
		/** Ends on the box round the leaf, so that is outlined. */
		peer: boolean;
	}

	/** Where a leaf drawn in box `home` ends a line: its row, its rail row, or a shown box. */
	function endOf(leaf: string, home: LandscapeBox): End | undefined {
		const api = apiOf(model, leaf);
		if (api) {
			const host = hostOf(api);
			const r = host && rails.get(host.id);
			if (!host || !r) return undefined;
			const left = host.absX + host.width - r.width / 2;
			// A lit api's rail is listed at any zoom (see `view.full`), so the line ends on its row.
			return {
				leaf: api,
				home,
				node: host,
				anchor: `api:${api}`,
				x0: left,
				x1: left + r.width,
				y: host.absY + r.top + (railRowY(r, api) ?? 0) * r.scale,
				peer: false
			};
		}
		const node = shownBox(home);
		const row = node === home ? rowOf(home, leaf) : -1;
		return {
			leaf,
			home,
			node,
			anchor: row >= 0 ? `row:${leaf}` : 'head',
			x0: node.absX,
			x1: node.absX + node.width,
			y:
				node.absY +
				(row >= 0
					? rowY(home, row)
					: node.view || cardRows(node)
						? TABLE.head / 2
						: node.height / 2),
			peer: node !== home
		};
	}

	// ------------------------------------------------------------ routing
	// In workers, one for what is wanted now and one routing ahead, so routing never holds up
	// input or frames (see route-client.ts).
	// The lines at rest are kept in the browser too, so opening the landscape again draws them
	// at once.
	const router = new RouteClient(
		new RouteWorker() as unknown as RoutePort,
		new RouteWorker() as unknown as RoutePort,
		wasmUrl,
		// Lines at rest are kept by group, a few landscapes' worth.
		typeof localStorage === 'undefined' ? undefined : routeStore(localStorage, 512)
	);
	/** Routing failed: lines run straight between their ends instead. */
	let unrouted = $state(false);
	router.onfail = (error) => {
		console.error('Routing failed:', error);
		unrouted = true;
	};
	$effect(() => () => router.destroy());
	/** Counts routes wanted now coming in, for what reads them to look again. Told from
	 * inside the effects that want them, so not read there. */
	let routedIn = $state(0);
	const routeCame = () => untrack(() => routedIn++);

	/**
	 * Boxes lines go round: every shown box but an open one, with its rail; open boxes' rails.
	 * Open boxes are frames, which lines cross but keep off the edges of. Lines keep each box's
	 * `clear` off it.
	 */
	const obstacles = $derived.by(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and returned whole
		const out = new Map<string, Rect>();
		for (const b of boxes) {
			if (b.parentId && !open.has(b.parentId)) continue;
			const [x0, y0, clear] = [b.absX, b.absY, b.clear];
			if (open.has(b.id)) {
				out.set(`frame:${b.id}`, {
					x0,
					y0,
					x1: x0 + b.width,
					y1: y0 + b.height,
					clear,
					frame: true
				});
				continue;
			}
			const r = rails.get(b.id);
			out.set(b.id, {
				x0,
				y0,
				x1: x0 + b.width + (r ? r.width / 2 : 0),
				y1: y0 + b.height,
				clear
			});
		}
		for (const [id, r] of rails) {
			if (!open.has(id)) continue;
			const b = boxById.get(id)!;
			const x0 = b.absX + b.width - r.width / 2;
			const y0 = b.absY + r.top;
			out.set(`rail:${id}`, { x0, y0, x1: x0 + r.width, y1: y0 + r.height });
		}
		return out;
	});

	/**
	 * Where a line ends for the router: on the box or rail it sits on, by whichever side routes
	 * best (`only` if given; an api on a closed box's rail its outer side), or on side `side` of
	 * an open box.
	 */
	function routeEnd(
		e: { node: LandscapeBox; anchor: string; x0: number; x1: number; y: number },
		side: Side,
		only?: Side
	): RouteEnd {
		const end = { x0: e.x0, x1: e.x1, y: e.y };
		const rail = `rail:${e.node.id}`;
		const api = e.anchor.startsWith('api:');
		const on = api && obstacles.has(rail) ? rail : e.node.id;
		if (!obstacles.has(on)) return { ...end, sides: [side] };
		return { ...end, on, sides: only ? [only] : api && on === e.node.id ? ['r'] : ['l', 'r'] };
	}

	interface LitLine {
		id: string;
		kind: LinkKind;
		/** The end that depends on the other. */
		s: End;
		t: End;
		sides: readonly ['l' | 'r', 'l' | 'r'];
	}

	/**
	 * The focused connections, one hop each way, each to wherever its other end is: its row if
	 * that shows, else the shown box round it. For a box, those with an end outside it; a card
	 * keeps lineage between its own rows, drawn round its right side.
	 */
	function linesOf(focus: Look): LitLine[] {
		const f = focus && boxById.get(focus.box);
		// A module lights its Module Dependency Lines instead (see `modLook`).
		if (!focus || !f || (!focus.leaf && isModuleBox(f))) return [];
		// A trigger on a channel's port lights the sends into the channel too, so the whole way a
		// message comes (sender, channel, event, trigger, unit) lights at once.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and used here
		const via = new Set<string>();
		if (focus.leaf)
			for (const id of el(focus.leaf)?.listens ?? []) {
				const port = model.ports.get(id);
				if (port) via.add(port.channel);
			}
		const leaves = focus.leaf
			? new Set([
					focus.leaf,
					...(focus.leaf === view.api && view.apiField ? [view.apiField] : []),
					...via
				])
			: new Set(within(boxes, f.id).flatMap((b) => [...(leavesBy.get(b.id) ?? [])]));
		const inside = within(boxes, f.id);
		const homeIn = (leaf: string) =>
			apiOf(model, leaf) || via.has(leaf)
				? homeOf(model, boxes, f, leaf)
				: inside.find((b) => leavesBy.get(b.id)?.has(leaf));
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and returned whole
		const out = new Map<string, LitLine>();
		for (const e of shownEdges) {
			const fromIn = leaves.has(e.from);
			const toIn = leaves.has(e.to);
			if ((!fromIn && !toIn) || (!focus.leaf && f.group && fromIn && toIn)) continue;
			const [mine, theirs] = fromIn ? [e.from, e.to] : [e.to, e.from];
			const mineHome = homeIn(mine);
			const theirHome = mineHome && homeOf(model, boxes, mineHome, theirs);
			const a = mineHome && endOf(mine, mineHome);
			const b = theirHome && endOf(theirs, theirHome);
			if (!a || !b) continue;
			const [s, t] = fromIn ? [a, b] : [b, a];
			const sameCard = s.node === t.node;
			// One box: only two of a card's rows are joined.
			if (
				sameCard &&
				(s.anchor === t.anchor || !s.anchor.startsWith('row:') || !t.anchor.startsWith('row:'))
			)
				continue;
			const id = `${e.kind}|${s.node.id}|${s.anchor}|${t.node.id}|${t.anchor}`;
			if (!out.has(id))
				out.set(id, { id, kind: e.kind, s, t, sides: sameCard ? ['r', 'r'] : sides(s, t) });
		}
		return [...out.values()];
	}
	// Each look's lines, so moving between the rows of a card reroutes only the row's.
	const rowLines = $derived(linesOf(hoveredRow));
	const boxLines = $derived(linesOf(hoveredBox));
	const pickedLines = $derived(linesOf(picked));
	const lit = $derived(hoveredRow ? rowLines : hoveredBox ? boxLines : pickedLines);

	/**
	 * While something is looked at, the boxes it relates to: itself and everything in it, the
	 * boxes its lit lines end on, and every box round those; for a module, the modules it depends
	 * on or that depend on it (see `moduleLook`). The rest is toned down, so the lines that
	 * matter stand out.
	 */
	const related = $derived.by(() => {
		if (!focus) return undefined;
		if (modLook) return modLook.bright;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and returned whole
		const ids = new Set(within(boxes, focus.box).map((b) => b.id));
		for (const id of [focus.box, ...lit.flatMap((l) => [l.s.node.id, l.t.node.id])])
			for (let b = boxById.get(id); b; b = b.parentId ? boxById.get(b.parentId) : undefined)
				ids.add(b.id);
		return ids;
	});
	/**
	 * Toning down waits until something has been looked at for this long, so passing over the
	 * canvas leaves it as it is; looking from one thing to the next keeps it toned down.
	 */
	const DIM_AFTER = 3000;
	const looking = $derived(!!focus);
	let dimming = $state(false);
	$effect(() => {
		if (!looking) return void (dimming = false);
		const t = setTimeout(() => (dimming = true), DIM_AFTER);
		return () => clearTimeout(t);
	});

	// ------------------------------------------------------------ hover
	// What the pointer is over, as enter and leave events tell: a row or api, and a card or name
	// bar. The view state gets it once the pointer has rested on it for HOVER_DELAY, so sweeping
	// across the canvas lights nothing on the way, and leaving one row for the next is one change,
	// never a moment on the card between them that lights (and routes) all of the card's lines.
	// Going off everything shows at once, the next frame. Nor while the view pans or zooms, when
	// everything slides under the pointer: then it gets what the pointer is over once the view
	// rests.
	let overRow: FieldRef | null = null;
	let overBox: string | null = null;
	let moving = false;
	let hoverFrame = 0;
	let hoverTimer: ReturnType<typeof setTimeout> | undefined;
	function hoverLater() {
		cancelAnimationFrame(hoverFrame);
		clearTimeout(hoverTimer);
		if (overRow || overBox) hoverTimer = setTimeout(hoverNow, HOVER_DELAY);
		else hoverFrame = requestAnimationFrame(hoverNow);
	}
	$effect(() => () => {
		cancelAnimationFrame(hoverFrame);
		clearTimeout(hoverTimer);
	});
	function hoverNow() {
		hoverFrame = 0;
		if (moving) return;
		if (overRow?.box !== view.hover?.box || overRow?.field !== view.hover?.field)
			view.hover = overRow;
		if (overBox !== view.hoverBox) view.hoverBox = overBox;
	}
	/** The pointer went onto row `ref` (a row, an api, or an inspector entry), or off it. */
	function hoverRow(ref: FieldRef, on: boolean) {
		if (on) overRow = ref;
		else if (overRow?.box === ref.box && overRow.field === ref.field) overRow = null;
		hoverLater();
	}

	function onfield(box: string, field: string, ev: 'enter' | 'leave' | 'click') {
		if (ev !== 'click') hoverRow({ box, field }, ev === 'enter');
		else {
			const same = view.field?.box === box && view.field.field === field;
			view.field = same ? null : { box, field };
			view.api = null;
			view.apiField = null;
			view.selectedNodes = [];
		}
	}

	// Boxes the picked api's bodies use, outlined with the parts using them, and the rows a
	// trimmed body leaves out, dimmed. A model in a hidden box outlines the box that shows.
	$effect(() => {
		const host = view.api ? hostOf(view.api) : undefined;
		const parts: Record<string, string[]> = {};
		const kept: Record<string, Set<string> | 'all'> = {};
		if (view.api && host)
			for (const u of bodyModels(model, view.api)) {
				const t = linkTarget(model, boxes, host, u.model);
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

	// Rows to light, by box: the focused row, and the rows at the ends of its lines; apis on
	// rails likewise. GlLayer reads them from the view state, as the peek's card does.
	// An end on a box round its leaf outlines that box. Every box looked at, picked or played,
	// and every box its lines end on, is drawn in full at any zoom. That holds for the hovered
	// card and the pick while a row's lines are lit too, so hovering the rows of a card never
	// closes the boxes the card or the pick reach.
	$effect(() => {
		const out: Record<string, Record<string, Hot>> = {};
		const apis: Record<string, true> = {};
		const peers: Record<string, true> = {};
		const full: Record<string, true> = {};
		const draw = (box: string | undefined) => box && (full[box] = true);
		const RANK: Record<Hot, number> = { self: 3, peer: 2, caller: 1 };
		const mark = (box: string, field: string, how: Hot) => {
			const rows = (out[box] ??= {});
			if (!rows[field] || RANK[how] > RANK[rows[field]]) rows[field] = how;
		};
		draw(focus?.box);
		draw(hoveredBox?.box);
		draw(view.field?.box);
		draw(view.api ? hostOf(view.api)?.id : undefined);
		view.selectedNodes.forEach(draw);
		for (const l of [...boxLines, ...pickedLines]) for (const end of [l.s, l.t]) draw(end.node.id);
		if (focus?.leaf) mark(focus.box, focus.leaf, 'self');
		if (focusRoles && fresh && focused) {
			const on = focusFlag?.on;
			for (const b of boxes)
				for (const r of cardRows(b) ?? []) {
					const taken =
						(on !== false && focusRoles.on.has(r.id)) || (on !== true && focusRoles.off.has(r.id));
					if (focusRoles.checks.has(r.id)) mark(b.id, r.id, 'self');
					else if (taken) mark(b.id, r.id, 'peer');
				}
		}
		for (const l of lit)
			for (const end of [l.s, l.t]) {
				draw(end.node.id);
				if (end.peer) peers[end.node.id] = true;
				if (end.anchor.startsWith('api:')) apis[end.leaf] = true;
				else if (end.anchor.startsWith('row:')) mark(end.node.id, end.leaf, 'peer');
			}
		// The current step of a run: the unit taking it, and the other end.
		if (step) {
			const ends = endsOf(step);
			for (const [id, e, how] of [
				[step.from, ends.from, 'self'],
				[step.to, ends.to, 'peer']
			] as const) {
				if (!e) continue;
				const shown = shownBox(e.box);
				if (e.api) {
					apis[e.api] = true;
					draw(hostOf(e.api)?.id);
				} else {
					draw(shown.id);
					if (shown !== e.box || e.row === undefined) peers[shown.id] = true;
					else mark(e.box.id, id, how);
				}
			}
			// The units stepped into calls from keep an edge on their rows, to show where Out goes.
			for (const id of step.frame.slice(0, -1)) {
				const e = playEndOf(id, undefined);
				if (e?.row !== undefined) mark(e.box.id, id, 'caller');
			}
		}
		view.hot = out;
		view.hotApis = apis;
		view.peerBoxes = peers;
		view.full = full;
	});

	$effect(() => {
		// A new layout or focus is fitted; leaving a focus or stopping goes back to where the view
		// was.
		if ((fittedTo !== settings.layout || fittedFocus !== focusKey) && boxes.length) {
			const keep = keepCamera;
			keepCamera = false;
			fittedTo = settings.layout;
			fittedFocus = focusKey;
			if (!keep) {
				fitting = true;
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						if (playing) fitRun();
						else
							void fitAll().then(() => {
								ready = true;
								// A hit picked before there was a layout to go to.
								const hit = pickLater;
								pickLater = undefined;
								if (hit) pick(hit);
							});
						fitting = false;
					})
				);
			}
		}
	});
	/** Fits the whole of what is drawn, every box and rail, right of the Changes panel. */
	function fitAll(duration?: number) {
		const x = Math.min(...boxes.map((b) => b.absX));
		const y = Math.min(...boxes.map((b) => b.absY));
		const right = Math.max(
			...boxes.map((b) => b.absX + b.width + (rails.get(b.id)?.width ?? 0) / 2)
		);
		const bottom = Math.max(...boxes.map((b) => b.absY + b.height));
		const [width, height] = [right - x, bottom - y];
		const zoom = Math.min(
			camera.maxZoom,
			Math.max(camera.minZoom, Math.min((cw - panelW) / (width * 1.08), ch / (height * 1.08)))
		);
		return camera.setCenter(x + width / 2 - panelW / 2 / zoom, y + height / 2, {
			duration,
			zoom
		});
	}
	/** A model, logic, triggers or channel card as the peek draws it; none for any other box. */
	function cardOf(b: LandscapeBox, onfield: CardData['onfield']): CardData | undefined {
		if (!b.table && !b.logic && !b.triggers && !b.channel) return undefined;
		const info = el(b.elementId)!;
		return {
			name: info.name,
			element: b.elementId,
			owner: b.ref ? el(info.parentId ?? '')?.name : undefined,
			fields: b.fields,
			foldAt: b.foldAt,
			indexes: b.view === 'table' ? info.def.indexes : undefined,
			table: b.table,
			logic: b.logic,
			triggers: b.triggers,
			channel: b.channel,
			...(b.channel
				? {
						channelWord: channelWord(info.def.type),
						channelNote: channelNote(model, info.id),
						topic: info.def.type === 'topic'
					}
				: {}),
			files: b.files,
			view: b.view,
			labels: Object.fromEntries(
				(b.fields ?? [])
					.flatMap((f) => [f.ref, f.model, ...(f.from ?? [])])
					.flatMap((id) => {
						const label = id && refLabel(model, id);
						return label ? [[id, label]] : [];
					})
			),
			incoming: Object.fromEntries(
				(b.fields ?? []).map((f) => [
					f.id,
					{
						ref: incomingCount(rels, f.id, 'ref'),
						from: incomingCount(rels, f.id, 'from'),
						api: incomingCount(rels, f.id, 'api')
					}
				])
			),
			state: view,
			onfield
		};
	}

	// Module Dependency Lines, the lines at rest: which module depends on which, from every kind
	// of connection shown, by where its ends are owned (see `moduleLines`).
	const restOwn = $derived(moduleLines(model, shownEdges, (id) => boxById.has(id)));
	/**
	 * In a flag focus, the connections only the key's other state makes, so both branches show:
	 * the cut was laid out with both in (see `focusOnFlag`).
	 */
	const branchEdges = $derived.by(() => {
		if (!fresh || !flagFocus) return [];
		const have = new Set(allEdges.map(edgeKey));
		return edgesOf(flagFocus.model).filter(
			(e) =>
				!have.has(edgeKey(e)) &&
				!hiddenLeaf(e.from) &&
				!hiddenLeaf(e.to) &&
				!view.hidden[KEY_OF[e.kind]]
		);
	});
	const rest = $derived(
		branchEdges.length
			? moduleLines(model, [...shownEdges, ...branchEdges], (id) => boxById.has(id))
			: restOwn
	);
	/** Lines at rest only the focused key's other state draws: dashed and toned down. */
	const otherBranch = $derived.by(() => {
		const own = new Set(restOwn.map((l) => l.id));
		return new Set(rest.filter((l) => !own.has(l.id)).map((l) => l.id));
	});
	/** Looking at a module lights its Module Dependency Lines, not the flows inside it. */
	const lookedModule = $derived.by(() => {
		const b = focus && !focus.leaf ? boxById.get(focus.box) : undefined;
		return b && isModuleBox(b) ? b.id : undefined;
	});
	const modLook = $derived(
		lookedModule ? moduleLook(boxes, boxById, rest, lookedModule) : undefined
	);

	// Lines at rest and lit lines are routed apart, so a hover never moves the lines at rest.
	// Each is drawn once routed, never first along a makeshift path.
	const restWant = $derived(restGroups(boxes, boxById, rails, rest, laid.pitch));
	/** The lines at rest routed so far, drawn as their groups come in. */
	const restRoutes = $derived.by(() => {
		void routedIn;
		return router.groupRoutes(restWant);
	});
	$effect(() => router.wantGroups(restWant, true, routeCame));

	// While the lines at rest are routed, a bar says how long is left, judged by how long they
	// took last time for this landscape and focus (see RoutingProgress, routing-clock.ts). The
	// effect only starts and stops the clock; the bar ticks on its own.
	const routing = $derived(!restRoutes.done && !unrouted);
	const tookKey = $derived(
		JSON.stringify([design.landscape?.path ?? design.landscape?.name ?? '', focusKey ?? ''])
	);
	const clock = new RoutingClock(typeof localStorage === 'undefined' ? undefined : localStorage);
	/** The routing of the lines at rest going on, if any. */
	let routingRun = $state.raw<RoutingRun>();
	$effect(() => {
		if (!routing) return;
		routingRun = clock.start(
			untrack(() => tookKey),
			performance.now()
		);
		return () => {
			// Only a routing that came to an end is a measure, not one cut short by leaving.
			clock.stop(
				performance.now(),
				untrack(() => !unrouted && restRoutes.done)
			);
			routingRun = undefined;
		};
	});
	/** Lines at rest not routed yet. */
	const unroutedCount = $derived(rest.filter((l) => !restRoutes.routes.has(l.id)).length);

	/**
	 * Flow Lines (lit lines) as the router takes them: each its own route, row to row. A flow is
	 * not a module dependency, so it never runs along a Module Dependency Line.
	 */
	const routeLinesOf = (lines: LitLine[]): RouteLine[] =>
		lines.map((l) => {
			const sameCard = l.s.node === l.t.node;
			return {
				id: l.id,
				s: routeEnd(l.s, l.sides[0], sameCard ? 'r' : undefined),
				t: routeEnd(l.t, l.sides[1], sameCard ? 'r' : undefined)
			};
		});
	/** A lit line's corners, once routed. */
	const litPoints = (l: LitLine): Point[] | undefined => litRoutes?.get(l.id);
	// Lit lines are mostly routed ahead (below). Those that are not are routed before anything
	// else and drawn when they come, a moment after the rows they join light up.
	const litWant = $derived.by(() => {
		const lines = routeLinesOf(lit);
		return { lines, key: routeKey(lines) };
	});
	const litRoutes = $derived.by(() => {
		void routedIn;
		return router.get(obstacles, litWant.key);
	});
	$effect(() => {
		const { key, lines } = litWant;
		router.want(obstacles, key, lines, false, 'lit', routeCame);
	});

	/** The view's centre on the canvas. */
	function viewCentre() {
		const { x, y, zoom } = camera.current;
		return { x: (cw / 2 - x) / zoom, y: (ch / 2 - y) / zoom };
	}
	/** Everything that can be looked at, with its lit lines: every box, row and api. */
	function looksAhead(): RouteAhead[] {
		const out: RouteAhead[] = [];
		const add = (look: Look, x: number, y: number) =>
			out.push({ x, y, lines: () => routeLinesOf(linesOf(look)) });
		for (const b of boxes) {
			const x = b.absX + b.width / 2;
			add({ box: b.id }, x, b.absY + b.height / 2);
			const n = b.fields?.length ?? 0;
			const rows = cardRows(b) ?? b.fields?.slice(0, shownRows(n, !!view.expanded[b.id], b.foldAt));
			rows?.forEach((r, i) => add({ box: b.id, leaf: r.id }, x, b.absY + rowY(b, i)));
		}
		for (const [id, r] of rails) {
			const b = boxById.get(id)!;
			const x = b.absX + b.width;
			for (const a of r.groups.flatMap((g) => g.apis))
				add({ box: id, leaf: a }, x, b.absY + r.top + (railRowY(r, a) ?? 0) * r.scale);
		}
		return out;
	}
	// After each layout, and whenever the lines lit by looking at something may end elsewhere
	// (a card folded or expanded, a kind of line hidden, an api picked), the lit lines of
	// everything that can be looked at are routed ahead, those nearest the view first. What is
	// routed already is not routed again.
	$effect(() => {
		void shownEdges;
		void view.expanded;
		void view.api;
		void view.apiField;
		const among = obstacles;
		untrack(() => router.ahead(among, looksAhead(), viewCentre()));
	});

	// ------------------------------------------------------------ drawing
	let glLayer: ReturnType<typeof GlLayer> | undefined = $state();
	/** Depth of a box: 0 for a root, -1 for none. */
	const depthOf = (id: string | undefined) => {
		let d = -1;
		for (
			let b = id ? boxById.get(id) : undefined;
			b;
			b = b.parentId ? boxById.get(b.parentId) : undefined
		)
			d++;
		return d;
	};
	/** Where a line runs while it is not routed: out of one end, across, into the other. */
	function straight(
		s: { x0: number; x1: number; y: number },
		t: { x0: number; x1: number; y: number },
		[ss, ts]: readonly ['l' | 'r', 'l' | 'r']
	): Point[] {
		const a = { x: ss === 'r' ? s.x1 : s.x0, y: s.y };
		const b = { x: ts === 'r' ? t.x1 : t.x0, y: t.y };
		const mx = ss === ts ? Math.max(a.x, b.x) + 24 : (a.x + b.x) / 2;
		return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
	}
	/**
	 * How far a line's end may slide along a box's side to its lane, in canvas px: within a
	 * card's name bar, or the side of any other box (where lines at rest end), clear of its
	 * corners.
	 */
	const headRoom = (b: LandscapeBox) =>
		(b.view || cardRows(b) ? TABLE.head / 2 : b.height / 2) - LANE.standoff;
	/**
	 * The modules whose inside lines at rest are drawn: those covering the share of the view set
	 * in the settings, or all of them in a focus, which is small. Kept as a key, so a pan or zoom
	 * redraws the lines only when a module crosses the share.
	 */
	const restInside = $derived(new Set(rest.flatMap((l) => (l.parentId ? [l.parentId] : []))));
	const restShownKey = $derived.by(() => {
		const inside = restInside;
		if (focused) return [...inside].join('\n');
		const { x, y, zoom } = camera.current;
		const cam = { x, y, zoom, width: cw, height: ch };
		return [...restShownIn(boxById, inside, cam, settings.restShare)].join('\n');
	});
	const restShown = $derived(new Set(restShownKey.split('\n')));
	/** Each line at rest once routed, never first along a makeshift path, before its lanes. */
	const restOf = (l: RestLine) => {
		const [s, t] = [boxById.get(l.source)!, boxById.get(l.target)!];
		const [a, b] = [headEnd(s), headEnd(t)];
		return {
			l,
			id: l.id,
			points: restRoutes.routes.get(l.id) ?? straight(a, b, sides(a, b)),
			ends: [headRoom(s), headRoom(t)] as const
		};
	};
	const routedRest = (l: RestLine) => unrouted || restRoutes.routes.has(l.id);
	/**
	 * Lines at rest drawn: between top-level modules always, inside a module once it fills
	 * enough of the view (see `restShown`); in their lanes where they share a stretch (see
	 * lanes.ts), so those leaving a box together run beside each other.
	 */
	const restLaid = $derived.by(() => {
		const lines = rest
			.filter((l) => routedRest(l) && (!l.parentId || restShown.has(l.parentId)))
			.map(restOf);
		const laned = laneLines(lines, obstacles.values());
		return lines.map((x) => ({ ...x, ...laned.get(x.id)! }));
	});
	/**
	 * A looked at module's lines the share hides, shown while it is looked at, laned among
	 * those drawn, which keep their own lanes, so a hover moves no line at rest.
	 */
	const restRevealed = $derived.by(() => {
		if (!modLook) return [];
		const drawn = new Set(restLaid.map((x) => x.id));
		const extra = rest.filter((l) => modLook.lit.has(l.id) && !drawn.has(l.id) && routedRest(l));
		if (!extra.length) return [];
		const lines = extra.map(restOf);
		const laned = laneLines([...restLaid, ...lines], obstacles.values());
		return lines.map((x) => ({ ...x, ...laned.get(x.id)! }));
	});
	/**
	 * Module Dependency Lines: grey at rest, one width, on the two modules' name bars, from a dot
	 * on the module that depends to an arrow on the one it depends on, under the boxes they leave
	 * and over the box they share. Looking at a module lights its lines in the selection colour,
	 * leaves those inside it as they are and tones down the rest; looking at anything else tones
	 * them all down.
	 */
	const glRest = $derived.by((): GlLine[] =>
		[...restLaid, ...restRevealed].map(({ l, points, lanes }) => {
			const on = !!modLook?.lit.has(l.id);
			const other = otherBranch.has(l.id);
			return {
				id: `rest:${l.id}`,
				points,
				lanes,
				width: on ? 2.5 : 1.5,
				halo: 5.5,
				color: on ? 'selection' : 'edge-rest',
				start: 'dot',
				arrow: true,
				...(other && { dash: [5, 4] as const }),
				dim: other || (!!focus && !on && !modLook?.inside.has(l.id)),
				title: `${other ? "In the flag's other state only. " : ''}${l.count} connection${l.count > 1 ? 's' : ''}: ${l.kinds.map((k) => KIND_NAME[k]).join(', ')}`,
				depth: depthOf(l.parentId)
			};
		})
	);
	/**
	 * Flow Lines (lit lines): in their kind's colour, over the cards, from row to row where they
	 * show, in their lanes where they share a stretch, so those from one row leave it side by
	 * side.
	 */
	const glLit = $derived.by((): GlLine[] => {
		if (!(litRoutes || unrouted)) return [];
		const laned = laneLines(
			lit.map((l) => ({ id: l.id, points: litPoints(l) ?? straight(l.s, l.t, l.sides) })),
			obstacles.values()
		);
		return lit.map((l) => ({
			id: `lit:${l.id}`,
			...laned.get(l.id)!,
			width: 2,
			color: `link-${LINK_TOKEN[l.kind]}` as GlLine['color'],
			start: l.kind === 'model' ? 'diamond' : 'dot',
			arrow: true,
			dash:
				l.kind === 'from'
					? ([5, 4] as const)
					: l.kind === 'on'
						? ([5, 3] as const)
						: l.kind === 'calls' || l.kind === 'handles'
							? ([2, 3] as const)
							: undefined,
			depth: Infinity
		}));
	});
	/** A move of the view ended: what the pointer rests on is looked at, and routed ahead. */
	function movedEnd() {
		moving = false;
		hoverLater();
		router.aheadFrom(viewCentre());
	}
	camera.onmovestart = () => (moving = true);
	camera.onmoveend = movedEnd;
	let stageEl: HTMLDivElement | undefined = $state();
	$effect(() => (stageEl ? camera.attach(stageEl) : undefined));

	/** What the pointer is over on the canvas, as GlLayer's hit testing finds it. */
	let glPointer = $state.raw<GlHit | null>(null);
	let railTimer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => () => clearTimeout(railTimer));
	const leafOf = (h: GlHit | null) => (h && (h.part === 'row' || h.part === 'api') ? h : undefined);
	/** The card face or name bar a hit is on. */
	const boxIn = (h: GlHit | null) =>
		h && (h.part === 'head' || h.part === 'row' || h.part === 'fold') ? h.box : undefined;
	const railIn = (h: GlHit | null) =>
		h && (h.part === 'api' || h.part === 'rail') ? h.box : undefined;
	function glHover(next: GlHit | null) {
		const was = glPointer;
		if (JSON.stringify(was) === JSON.stringify(next)) return;
		const [a, b] = [leafOf(was), leafOf(next)];
		const same = !!a && !!b && a.box === b.box && a.id === b.id;
		if (a && !same) onfield(a.box, a.id, 'leave');
		if (b && !same) onfield(b.box, b.id, 'enter');
		if (boxIn(was) !== boxIn(next)) {
			if (boxIn(next)) overBox = boxIn(next)!;
			else if (overBox === boxIn(was)) overBox = null;
			hoverLater();
		}
		// A rail lists its endpoints once the pointer rests on it; leaving is instant.
		if (railIn(was) !== railIn(next)) {
			clearTimeout(railTimer);
			if (view.railHover === railIn(was)) view.railHover = null;
			const r = railIn(next);
			if (r) railTimer = setTimeout(() => (view.railHover = r), HOVER_DELAY);
		}
		glPointer = next;
	}
	function glAt(e: MouseEvent) {
		const r = stageEl!.getBoundingClientRect();
		return glLayer?.hitAt(e.clientX - r.left, e.clientY - r.top) ?? null;
	}
	function glMove(e: PointerEvent) {
		// While the view is dragged nothing is hovered: everything slides under the pointer.
		if (e.buttons || moving) return glHover(null);
		const hit = glAt(e);
		glHover(hit);
		const pane = stageEl!;
		const r = stageEl!.getBoundingClientRect();
		pane.title = hit
			? ''
			: (glLayer?.restLineAt(e.clientX - r.left, e.clientY - r.top)?.title ?? '');
	}
	/** A click on what the canvas draws: a row, an api, a fold, a box; else on the empty canvas. */
	function glClick(e: MouseEvent) {
		// The end of a drag is not a click.
		if (camera.dragged) return;
		const hit = glAt(e);
		if (!hit || hit.part === 'body') {
			// With something picked, a click beside it only lets go of it: picking the group
			// round it instead would light every line of what may be a large module.
			if (picked && hit?.box !== view.selectedNodes[0]) view.selectedNodes = [];
			else view.selectedNodes = hit ? [hit.box] : [];
			unpin();
			return;
		}
		if (hit.part === 'row') onfield(hit.box, hit.id, 'click');
		else if (hit.part === 'api') onapi(hit.id);
		else if (hit.part === 'fold') {
			const next = { ...view.expanded };
			if (next[hit.box]) delete next[hit.box];
			else next[hit.box] = true;
			view.expanded = next;
		} else {
			view.selectedNodes = [hit.box];
			unpin();
		}
	}
	/** While a scenario is edited: a field row or a class card's name bar opens the edit menu. */
	function glMenu(e: MouseEvent) {
		if (!editing) return;
		const hit = glAt(e);
		const b = hit && boxById.get(hit.box);
		const target =
			hit?.part === 'row' && b?.fields
				? hit.id
				: hit?.part === 'head' && b?.table && b.view === 'class'
					? b.elementId
					: undefined;
		if (!target) return;
		e.preventDefault();
		e.stopPropagation();
		menu = { target, x: e.clientX, y: e.clientY };
	}

	/** The key's line entries; each hides its kinds when clicked (see `KEY_OF`). */
	const KEY_LINES: {
		id: string;
		label: string;
		token: string;
		dash?: string;
		diamond?: boolean;
	}[] = [
		{ id: 'ref', label: 'Refers to, api body uses', token: 'ref' },
		{ id: 'model', label: 'Holds', token: 'ref', diamond: true },
		{ id: 'from', label: 'Derives from', token: 'from', dash: '4 3' },
		{ id: 'reads', label: 'Reads', token: 'ref' },
		{ id: 'writes', label: 'Writes', token: 'write' },
		{ id: 'calls', label: 'Calls, renders, handled by', token: 'call', dash: '1.5 2.5' },
		{ id: 'sends', label: 'Sends on', token: 'call' },
		{ id: 'on', label: 'Listens to', token: 'event', dash: '4 2.5' }
	];

	/** What an end shows: an api by method and path, else its name. */
	function endName(end: End) {
		const def = el(end.leaf)?.def;
		if (def?.kind === 'api') return `${def.method} ${def.path}`;
		return refLabel(model, end.leaf) ?? el(end.leaf)?.name ?? end.leaf;
	}

	/**
	 * Lit lines' ends off the canvas: a wedge on its edge, on the way from the centre to the
	 * end and pointing at it. Clicking it flies there.
	 */
	const wedges = $derived.by(() => {
		const { x: vx, y: vy, zoom } = camera.current;
		const cx = cw / 2;
		const cy = ch / 2;
		const inset = 16;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and returned whole
		const out = new Map<
			string,
			{ key: string; x: number; y: number; angle: number; kind: LinkKind; end: End; name: string }
		>();
		for (const l of lit) {
			const route = litPoints(l);
			for (const [end, side, at] of [
				[l.s, l.sides[0], route?.[0]],
				[l.t, l.sides[1], route?.at(-1)]
			] as const) {
				// Where the line ends: as routed, or on the side it would leave by.
				const px = (at?.x ?? (side === 'l' ? end.x0 : end.x1)) * zoom + vx;
				const py = end.y * zoom + vy;
				const key = `${end.node.id}|${end.anchor}`;
				if ((px >= 0 && px <= cw && py >= 0 && py <= ch) || out.has(key)) continue;
				const dx = px - cx;
				const dy = py - cy;
				const k = Math.min(Math.abs((cx - inset) / dx), Math.abs((cy - inset) / dy));
				out.set(key, {
					key,
					x: cx + dx * k,
					y: cy + dy * k,
					angle: (Math.atan2(dy, dx) * 180) / Math.PI,
					kind: l.kind,
					end,
					name: endName(end)
				});
			}
		}
		return [...out.values()];
	});

	/** Flies to a line's end: its row, or the box it ends on. */
	function goEnd(end: End) {
		if (end.anchor.startsWith('row:')) flyTo({ box: end.home, field: end.leaf });
		else flyTo({ box: end.node });
	}

	/** What each kind is called in the key and a line's hover text. */
	const KIND_NAME: Record<DependencyKind, string> = {
		ref: 'refers to',
		body: 'api body uses',
		model: 'holds',
		from: 'derives from',
		reads: 'reads',
		writes: 'writes',
		calls: 'calls',
		handles: 'handled by',
		sends: 'sends on',
		on: 'listens to',
		stores: 'stores'
	};

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
		const via = u.via ? model.apiFields.get(u.via)?.def.name : undefined;
		return {
			text: `${a.def.method} ${a.def.path} · ${partLabel(u.part)}${via ? `.${via}` : ''}`,
			where: `${a.name} · ${via ? 'own shape, keeps its own name' : 'the model itself, so a rename changes it'}`,
			api: u.api
		};
	};

	/** An api a unit handles or calls; clicking it picks the api. */
	const routeEntry = (id: string): Entry => {
		const a = el(id)!;
		return {
			text: `${a.def.method} ${a.def.path}`,
			where: `${a.name} · ${pathOf(a.parentId)}`,
			api: id
		};
	};

	interface Section {
		label: string;
		/** Colours the glyphs and hover: ref, from, writes or calls. */
		kind: string;
		glyph: string;
		entries: Entry[];
		note?: string;
	}

	/** A field's card: what it refers to, holds, comes from, and what uses it. */
	function fieldCardOf(f: FieldRef | null):
		| {
				title: string;
				type: string;
				description?: string;
				constraints: string[];
				sections: Section[];
		  }
		| undefined {
		const b = f && boxById.get(f.box);
		const info = f && model.fields.get(f.field);
		if (!f || !b || !info) return undefined;
		const entry = (to: string): Entry => {
			if (isApiEl(to)) return routeEntry(to);
			const t = linkTarget(model, boxes, b, to);
			return {
				text: isUnit(to) ? el(to)!.name : label(to),
				where: t ? whereOf(t) : 'not drawn',
				target: t && { box: t, field: rowOf(t, to) >= 0 ? to : undefined }
			};
		};
		const outOf = (kind: FieldLink['kind']) =>
			(rels.out.get(f.field) ?? []).filter((l) => l.kind === kind).map((l) => entry(l.to));
		const inOf = (kind: FieldLink['kind']) =>
			(rels.in.get(f.field) ?? []).filter((l) => l.kind === kind).map((l) => entry(l.field));
		// Units touching the field: by naming it, or its whole model.
		const touchedBy = (kind: 'reads' | 'writes') => [
			...inOf(kind),
			...(rels.in.get(info.modelId) ?? [])
				.filter((l) => l.kind === kind)
				.map((l) => ({ ...entry(l.field), where: `${entry(l.field).where} · whole model` }))
		];
		const def = info.def;
		return {
			title: `${el(info.modelId)?.name}.${def.name}`,
			type: typeText(def, (id) => refLabel(model, id)),
			// In full: the card cuts them to its column.
			constraints: constraintsOf(def),
			description: def.description,
			// Glyphs point at what depends on what: → this field on the entry, ← the entry on
			// this field; dashed for lineage.
			sections: [
				{ label: 'References', kind: 'ref', glyph: '→', entries: outOf('ref') },
				{ label: 'Holds', kind: 'model', glyph: '◆', entries: outOf('model') },
				{
					label: 'Source',
					kind: 'from',
					glyph: '⇢',
					entries: outOf('from'),
					note: def.derived
				},
				{ label: 'Referenced by', kind: 'ref', glyph: '←', entries: inOf('ref') },
				{ label: 'Feeds', kind: 'from', glyph: '⇠', entries: inOf('from') },
				{
					label: 'Fed by apis',
					kind: 'from',
					glyph: '⇢',
					entries: (uses.fedBy.get(f.field) ?? []).map(apiEntry)
				},
				{
					label: 'Returned by apis',
					kind: 'from',
					glyph: '⇠',
					entries: (uses.returnedBy.get(f.field) ?? []).map(apiEntry)
				},
				{ label: 'Read by logic', kind: 'ref', glyph: '←', entries: touchedBy('reads') },
				{ label: 'Written by logic', kind: 'writes', glyph: '←', entries: touchedBy('writes') }
			].filter((s) => s.entries.length)
		};
	}
	const inspector = $derived(fieldCardOf(view.field));

	/**
	 * The clicked logic unit: its inputs, outputs and fails, and its steps as a sequence. What
	 * it handles, reads, writes and calls is all in the sequence, so it is not listed again.
	 */
	function unitCardOf(id: string | undefined) {
		const u = id && isUnit(id) ? el(id) : undefined;
		if (!u) return undefined;
		// An input not required is marked `name?`, as an api's params are; `[]` marks many.
		const row = (x: LogicField, input: boolean) => ({
			name: x.name + (input && !x.required ? '?' : ''),
			type: typeText(x, (id) => refLabel(model, id)) + (x.nullable ? ' · nullable' : ''),
			note: [x.description, ...constraintsOf(x).map(constraintLabel)].filter(Boolean).join(' · ')
		});
		const groups = [
			{ label: 'Inputs', fails: false, rows: (u.def.inputs ?? []).map((x) => row(x, true)) },
			{ label: 'Returns', fails: false, rows: (u.def.outputs ?? []).map((x) => row(x, false)) },
			{
				label: 'Fails',
				fails: true,
				rows: (u.def.fails ?? []).map((x) => ({ name: x.name, type: '', note: x.description }))
			},
			{ label: 'Emits', fails: false, rows: (u.def.emits ?? []).map((x) => row(x, false)) },
			{ label: 'Dead code', fails: false, rows: deadRows(u.id) }
		].filter((g) => g.rows.length);
		return {
			title: u.name,
			sub: `Logic unit · ${pathOf(u.parentId)}`,
			groups,
			// The whole design shown: a focus may leave out what the unit's steps touch.
			seq: u.def.steps?.length ? sequenceOf(changes.shown, u.id) : undefined
		};
	}
	const unitCard = $derived(unitCardOf(view.field?.field));

	/** Why a unit or api is dead code, as card rows; none when it runs. */
	function deadRows(id: string) {
		const r = model.reach?.get(id);
		if (!r || r.state === 'live') return [];
		const names = r.callers.map((c) => el(c)?.name ?? c).join(', ');
		return [
			{
				name:
					r.why ??
					(r.state === 'unreached' ? 'Nothing starts or calls it' : `Only dead code uses it`),
				type: '',
				note: names ? `Used by ${names}` : undefined
			}
		];
	}

	/** A pane entry: a unit or trigger, where it lives, and where clicking it goes. */
	interface PaneEntry {
		id: string;
		text: string;
		where: string;
		/** The glyph before it; a unit's ƒ when unset. */
		glyph?: GlyphKind;
		target?: { box: LandscapeBox; field: string };
	}
	interface PaneFact {
		label: string;
		text: string;
		mono: boolean;
		ident: boolean;
	}
	/** A pane section listing entries, with facts above them, and what it says when it has none. */
	interface PaneGroup {
		label: string;
		facts?: PaneFact[];
		units: PaneEntry[];
		empty?: string;
	}
	interface TriggerPane {
		title: string;
		sub: string;
		glyph: GlyphKind;
		source: { label: string; rows: PaneFact[] };
		run: PaneFact[];
		groups: PaneGroup[];
	}

	/** `ident`: a name that sets the card's width rather than wrapping in it. */
	const fact = (label: string, text: string | undefined, mono = false, ident = mono): PaneFact[] =>
		text === undefined ? [] : [{ label, text, mono, ident }];

	/** An entry for a unit, trigger, channel or model, seen from box `near`. */
	function paneEntry(
		near: LandscapeBox,
		leaf: string,
		glyph?: GlyphKind,
		where?: string
	): PaneEntry {
		const b = linkTarget(model, boxes, near, leaf);
		return {
			id: leaf,
			text: el(leaf)!.name,
			where: where ?? pathOf(el(leaf)!.parentId),
			glyph,
			target: b && { box: b, field: leaf }
		};
	}

	/**
	 * The clicked trigger: its schedule in words and as written, with its next runs; or the event
	 * it listens to, its source, the units sending or writing it and what happens when a run
	 * fails; or the queue or topic of its old message. Then how a run behaves and the units it
	 * starts. A channel's row (a port) shows the channel's card instead (see `channelCardOf`).
	 */
	function triggerCardOf(
		id: string | undefined,
		near: LandscapeBox | undefined
	): TriggerPane | undefined {
		if (!id || !near) return undefined;
		const port = model.ports.get(id);
		if (port) return channelCardOf(port.channel, near);
		if (el(id)?.def.kind === 'channel') return channelCardOf(id, near);
		const t = isTrigger(id) ? el(id) : undefined;
		if (!t) return undefined;
		const d = t.def;
		const units = (kind: 'handles' | 'calls') =>
			(rels.in.get(t.id) ?? []).filter((l) => l.kind === kind).map((l) => paneEntry(near, l.field));
		const gate = d.when && el(d.when.flag);
		const shared = [
			...fact('Timeout', d.timeout && durationWords(d.timeout)),
			...(d.on?.channel ? [] : fact('Retries', d.retries?.toString())),
			...fact('With', d.with, false, true),
			...fact('Exists when', gate ? `${gate.name} is ${d.when!.is}` : undefined)
		];
		const handled: PaneGroup = {
			label: 'Handled by',
			units: units('handles'),
			empty: 'No logic unit handles it, so it starts nothing.'
		};
		if (d.on) {
			const on = d.on;
			const src = el(on.channel ?? on.model ?? '');
			const file = !!src && !on.channel && storedAsFile(model, src.id);
			const kind = on.channel
				? src?.def.type === 'topic'
					? 'Topic'
					: 'Queue'
				: file
					? 'File'
					: 'Table';
			const groups: PaneGroup[] = [];
			if (src)
				groups.push({
					label: 'Listens to',
					units: [
						paneEntry(
							near,
							src.id,
							on.channel
								? src.def.type === 'topic'
									? 'topic'
									: 'channel'
								: file
									? 'file'
									: 'table'
						)
					]
				});
			if (on.channel && src) {
				groups.push({
					label: 'Sent by',
					units: (rels.in.get(src.id) ?? [])
						.filter((l) => l.kind === 'sends')
						.map((l) => paneEntry(near, l.field)),
					empty: src.def.external
						? 'Sent from outside the design.'
						: 'No logic unit here sends on it; it comes from outside.'
				});
				// What happens when a run fails: the retries, then the message is dead-lettered,
				// and whatever handles that.
				const sub = src.def.type === 'topic' ? (on.subscription ?? t.name) : undefined;
				const dead = [...model.ports.values()].find(
					(p) => p.channel === src.id && p.event === 'dead-lettered' && p.subscription === sub
				);
				const retries = d.retries ?? src.def.retries;
				if (on.event === 'received')
					groups.push({
						label: 'On failure',
						facts: fact(
							'Retries',
							retries === undefined ? 'not stated' : `${retries}, then dead-lettered`
						),
						units: (dead?.triggers ?? []).map((x) => paneEntry(near, x, 'dead-lettered')),
						empty: 'Dead-lettered: nothing handles it.'
					});
			} else if (src) {
				// A stored model's event: the units writing the model or any of its fields.
				// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and used here
				const writers = new Set<string>();
				for (const [to, ls] of rels.in)
					if (to === src.id || model.fields.get(to)?.modelId === src.id)
						for (const l of ls) if (l.kind === 'writes') writers.add(l.field);
				groups.push({
					label: 'Written by',
					units: [...writers].map((u) => paneEntry(near, u)),
					empty: 'No logic unit here writes it; it is written from outside.'
				});
			}
			return {
				title: t.name,
				sub: `Trigger · ${pathOf(t.parentId)}`,
				glyph: on.event as GlyphKind,
				source: {
					label: 'Source',
					rows: [
						...fact('Event', onWords(model, on, t.name), false, true),
						...fact('Kind', kind + (src?.def.via ? `, via ${src.def.via}` : '')),
						...fact('Carries', src?.def.carries ? el(src.def.carries)?.name : undefined),
						...fact('Path', on.path, true),
						...fact('Filter', on.filter)
					]
				},
				run: shared,
				groups: [...groups, handled]
			};
		}
		const by = byOf(d.by);
		if (by)
			return {
				title: t.name,
				sub: `Trigger · ${pathOf(t.parentId)}`,
				glyph: by.who,
				source: {
					label: 'Started by',
					rows: [...fact('Who', BY_WORDS[by.who]), ...fact('How', by.how)]
				},
				run: shared,
				groups: [handled]
			};
		if (d.message) {
			const m = d.message;
			return {
				title: t.name,
				sub: `Message trigger · ${pathOf(t.parentId)}`,
				glyph: 'message',
				source: {
					label: 'Message',
					rows: [
						...fact('Kind', m.queue !== undefined ? 'Queue' : 'Topic'),
						...fact('Queue', m.queue, true),
						...fact('Topic', m.topic, true),
						...fact('Subscription', m.subscription, true),
						...fact('Via', m.via)
					]
				},
				run: shared,
				groups: [
					{
						label: 'Sent by',
						units: units('calls'),
						empty: 'No logic unit here sends it; it comes from outside.'
					},
					handled
				]
			};
		}
		const sch = d.schedule ?? {};
		const zone = sch.cron !== undefined || sch.at !== undefined ? `, ${sch.tz ?? 'UTC'}` : '';
		const written = sch.cron ?? (sch.every !== undefined ? `every ${sch.every}` : `at ${sch.at}`);
		const next = nextRuns(sch, 3);
		const OVERLAP = {
			skip: 'skip a run due while one is going',
			queue: 'queue a run due while one is going',
			allow: 'let runs overlap'
		};
		return {
			title: t.name,
			sub: `Trigger · ${pathOf(t.parentId)}`,
			glyph: 'trigger',
			source: {
				label: 'Schedule',
				rows: [
					...fact('When', scheduleWords(sch) + zone),
					...fact('As written', sch.cron !== undefined ? `cron ${written}` : written, true),
					...fact('Next', next.length ? next.join(' · ') : undefined)
				]
			},
			run: [...fact('Overlap', OVERLAP[d.overlap ?? 'skip']), ...shared],
			groups: [handled]
		};
	}

	/**
	 * A channel's card: what it is and carries, the units sending on it, and each of its events
	 * (its ports) with the triggers listening and the units those start.
	 */
	function channelCardOf(id: string, near: LandscapeBox): TriggerPane | undefined {
		const c = el(id);
		if (!c) return undefined;
		const d = c.def;
		const gate = d.when && el(d.when.flag);
		const events: PaneGroup[] = [...model.ports.values()]
			.filter((p) => p.channel === id)
			.map((p) => ({
				label: p.subscription !== undefined ? `${p.subscription} · ${p.event}` : p.event,
				units: p.triggers.map((x) => {
					const starts = (rels.in.get(x) ?? [])
						.filter((l) => l.kind === 'handles')
						.map((l) => el(l.field)!.name);
					return paneEntry(
						near,
						x,
						p.event as GlyphKind,
						starts.length ? `starts ${starts.join(', ')}` : 'starts nothing'
					);
				}),
				empty:
					p.event === 'dead-lettered'
						? 'Nothing handles a message given up on.'
						: 'No trigger listens to it.'
			}));
		return {
			title: c.name,
			sub: `Channel · ${d.type === 'topic' ? 'Topic' : 'Queue'} · ${pathOf(c.parentId)}`,
			glyph: d.type === 'topic' ? 'topic' : 'channel',
			source: {
				label: 'Channel',
				rows: [
					...fact('Carries', d.carries ? el(d.carries)?.name : undefined),
					...fact('Via', d.via),
					...fact(
						'Retries',
						d.retries === undefined ? 'not stated' : `${d.retries}, then dead-lettered`
					),
					...fact('Exists when', gate ? `${gate.name} is ${d.when!.is}` : undefined)
				]
			},
			run: [],
			groups: [
				{
					label: 'Sent by',
					units: (rels.in.get(id) ?? [])
						.filter((l) => l.kind === 'sends')
						.map((l) => paneEntry(near, l.field)),
					empty: d.external
						? 'Sent from outside the design.'
						: 'No logic unit here sends on it; it comes from outside.'
				},
				...events
			]
		};
	}
	const triggerCard = $derived(
		triggerCardOf(view.field?.field, view.field ? boxById.get(view.field.box) : undefined)
	);

	/** What a sequence drawn in a card on `from` names: an api, a unit's row or a model. */
	function seqAt(id: string, from: LandscapeBox | undefined): PeekAt | undefined {
		if (isApiEl(id)) return { api: id };
		const t = from && linkTarget(model, boxes, from, id);
		return t && { target: { box: t, field: rowOf(t, id) >= 0 ? id : undefined } };
	}

	const statusClass = (s: number) => (s < 300 ? 'ok' : s < 400 ? '' : s < 500 ? 'warn' : 'bad');

	/** The picked api, for the card beside its rail row. */
	function apiCardOf(id: string | null) {
		const a = id ? el(id) : undefined;
		const host = id ? hostOf(id) : undefined;
		if (!a || !host) return undefined;
		const names = (ids: string[]) =>
			ids.map((id) => model.fields.get(id)?.def.name ?? id).join(', ');
		const d = a.def;
		const bodies = apiBodies(d).map(({ part, body }) => {
			const t = body.model ? linkTarget(model, boxes, host, body.model) : undefined;
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
					// A response field computed where the api answers: `derived` with no source field.
					const computed = part !== 'request' && !links.length && !f.model && !!f.derived;
					return {
						id: f.id,
						name: f.name + (f.required ? '' : '?'),
						type: typeText(f, (id) => refLabel(model, id)),
						computed,
						traced: links.length > 0 || !!f.model || computed,
						title: links.length
							? `${part === 'request' ? 'Goes into' : 'Comes from'} ${links.map(label).join(', ')}${f.derived ? ` · ${f.derived}` : ''}`
							: f.model
								? undefined
								: part === 'request'
									? 'Goes into no model field: add to'
									: computed
										? `Computed here · ${f.derived}`
										: 'Comes from no field: add from, or derived when computed here'
					};
				})
			};
		});
		const units = (kind: 'handles' | 'calls') =>
			(rels.in.get(a.id) ?? [])
				.filter((l) => l.kind === kind)
				.map((l) => {
					const t = linkTarget(model, boxes, host, l.field);
					return {
						id: l.field,
						text: el(l.field)!.name,
						where: pathOf(el(l.field)!.parentId),
						target: t && { box: t, field: l.field }
					};
				});
		return {
			method: d.method ?? '',
			path: d.path ?? '',
			logic: [
				{ label: 'Handled by', entries: units('handles') },
				{ label: 'Called by', entries: units('calls') }
			].filter((s) => s.entries.length),
			sub: [a.name, pathOf(a.parentId), d.auth && `auth: ${d.auth}`].filter(Boolean).join(' · '),
			dead: deadRows(a.id)[0],
			params: d.params ?? [],
			request: bodies.find((b) => b.part === 'request'),
			responses: bodies.filter((b) => b.part !== 'request')
		};
	}
	const apiCard = $derived(apiCardOf(view.api));

	/** Where the picked api's row is on screen: the rail's edges and the row's middle. */
	const apiAnchor = $derived.by(() => {
		const host = view.api ? hostOf(view.api) : undefined;
		const r = host && rails.get(host.id);
		if (!view.api || !host || !r) return undefined;
		const { x: vx, y: vy, zoom } = camera.current;
		const left = host.absX + host.width - r.width / 2;
		const row = listed(host.id) ? railRowY(r, view.api) : undefined;
		const y = host.absY + r.top + (row !== undefined ? row * r.scale : r.height / 2);
		return { left: left * zoom + vx, right: (left + r.width) * zoom + vx, y: y * zoom + vy };
	});

	/** Where the clicked row is on screen, or the shown box round it while it is hidden. */
	const fieldAnchor = $derived.by(() => {
		const f = view.field;
		const b = f && boxById.get(f.box);
		if (!f || !b) return undefined;
		const s = shownBox(b);
		const row = s === b ? rowOf(b, f.field) : -1;
		const { x: vx, y: vy, zoom } = camera.current;
		const y = row >= 0 ? b.absY + rowY(b, row) : s.absY + s.height / 2;
		return { left: s.absX * zoom + vx, right: (s.absX + s.width) * zoom + vx, y: y * zoom + vy };
	});

	/**
	 * A card is as wide as its names (a name, type, value or path), from PANE_MIN to 560 px;
	 * a unit's is as wide as its sequence or signature, up to the canvas. Prose wraps inside
	 * that width and never widens it. A card is at most the canvas tall; its body scrolls.
	 */
	const PANE_MIN = 300;
	const UNIT_MIN = 420;
	/** A unit card's least width: its sequence at full spacing, or its widest signature group. */
	function unitWidth(u: NonNullable<ReturnType<typeof unitCardOf>>) {
		const group = (g: (typeof u.groups)[number]) =>
			24 +
			Math.max(...g.rows.map((r) => textWidth(r.name, 13, true))) +
			(g.fails ? 0 : 14 + Math.max(...g.rows.map((r) => textWidth(r.type, 12))));
		return Math.min(
			paneRoom,
			Math.max(UNIT_MIN, u.seq ? sequenceWidth(u.seq) + 2 : 0, ...u.groups.map(group))
		);
	}
	// The shown card's size, so it is placed beside its row and kept inside the canvas.
	let cardH = $state(0);
	let cardW = $state(0);
	// The card folded to its header, so the lines it covers show; the pick stays.
	let cardMin = $state(false);
	/** An enum shows its first values; Show more shows all of the one keyed here. */
	const VALUES_SHOWN = 12;
	let shownValues = $state<string | null>(null);
	$effect(() => {
		void view.field;
		void view.api;
		cardMin = false;
		peek = null;
	});
	/** A card `w` wide right of the anchor, or left of it if it does not fit, level with its row. */
	function beside(a: { left: number; right: number; y: number } | undefined, w: number) {
		if (!a) return undefined;
		const right = a.right + 14;
		// Room on neither side (a wide sequence): over the canvas, centred.
		const left =
			right + w <= cw - 8
				? right
				: a.left - 14 - w >= 8 + panelW
					? a.left - 14 - w
					: Math.max(8 + panelW, (cw + panelW - w) / 2);
		return { left, top: Math.min(Math.max(8, a.y - 24), Math.max(8, ch - cardH - 8)) };
	}
	const cardPos = $derived(beside(apiAnchor, cardW || PANE_MIN));
	const fieldPos = $derived(beside(fieldAnchor, cardW || PANE_MIN));
	const unitW = $derived(unitCard ? unitWidth(unitCard) : UNIT_MIN);
	const unitPos = $derived(beside(fieldAnchor, cardW || unitW));

	// ------------------------------------------------------------ peek
	/** What a card's entry names: an api, a field's or unit's row, or a whole card. */
	interface PeekAt {
		api?: string;
		target?: { box: LandscapeBox; field?: string };
	}
	/**
	 * An entry clicked in the card, shown beside it without moving the camera. `from`: the
	 * entry, marked while its peek is open; `dy`: the entry's height in the card, so the peek
	 * stays level with it as the card moves; `trail`: what the peek showed before, for Back.
	 */
	let peek = $state<{ at: PeekAt; from: string; dy: number; trail: PeekAt[] } | null>(null);
	let peekH = $state(0);
	let peekW = $state(0);
	/** The part of a card under `target` that scrolls, if any: its body, or a wide sequence. */
	function scroller(card: HTMLElement, target: EventTarget | null) {
		for (let e = target as HTMLElement | null; e && e !== card; e = e.parentElement)
			if (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1) return e;
		return undefined;
	}
	/**
	 * A wheel over a card that scrolls scrolls it; over one that does not, it zooms the canvas
	 * under it, as it would off the card. Ctrl+wheel zooms the canvas anywhere. A drag on a card
	 * pans the canvas, except one on a scrollbar.
	 */
	function toCanvas(card: HTMLElement) {
		const wheel = (e: WheelEvent) => {
			if (!e.ctrlKey && scroller(card, e.target)) return;
			e.preventDefault();
			// Over the header of a card whose body scrolls: scroll the body.
			const body = card.querySelector<HTMLElement>(':scope > .pane-body');
			if (!e.ctrlKey && body && body.scrollHeight > body.clientHeight + 1)
				body.scrollBy(e.deltaX, e.deltaY);
			else stageEl?.dispatchEvent(new WheelEvent(e.type, e));
		};
		const down = (e: PointerEvent) => {
			const s = scroller(card, e.target);
			const r = s?.getBoundingClientRect();
			const onBar =
				!!s && !!r && (e.clientX >= r.left + s.clientWidth || e.clientY >= r.top + s.clientHeight);
			if (!e.button && !onBar) stageEl?.dispatchEvent(new PointerEvent(e.type, e));
		};
		card.addEventListener('wheel', wheel, { passive: false });
		card.addEventListener('pointerdown', down);
		return () => {
			card.removeEventListener('wheel', wheel);
			card.removeEventListener('pointerdown', down);
		};
	}
	/** Where in the card the last press was. */
	let pressDy = 0;
	const keyOf = (at: PeekAt) => at.api ?? `${at.target?.box.id}|${at.target?.field ?? ''}`;

	function press(e: PointerEvent) {
		pressDy = e.clientY - (e.currentTarget as HTMLElement).getBoundingClientRect().top;
	}
	/** Shows what an entry of the card names in the peek, or closes it if it shows that. */
	function openPeek(at: PeekAt) {
		const from = keyOf(at);
		peek = peek?.from === from ? null : { at, from, dy: pressDy - 18, trail: [] };
	}
	/** Shows what an entry in the peek names in its place. */
	function peekTo(at: PeekAt) {
		if (peek) peek = { ...peek, at, trail: [...peek.trail, peek.at] };
	}
	function peekBack() {
		const prev = peek?.trail.at(-1);
		if (peek && prev) peek = { ...peek, at: prev, trail: peek.trail.slice(0, -1) };
	}
	/** Flies to what the peek shows and picks it, as a click on the entry did before peeks. */
	function goToPeek() {
		const at = peek?.at;
		peek = null;
		if (at?.api) return showApi(at.api);
		const t = at?.target;
		if (!t) return;
		if (!t.field) {
			unpin();
			view.selectedNodes = [t.box.id];
		}
		view.api = null;
		view.apiField = null;
		flyTo(t);
	}

	/** The card shown: its place on screen and width. */
	const shownCard = $derived(
		(inspector || triggerCard) && fieldPos
			? { ...fieldPos, w: cardW || PANE_MIN }
			: unitCard && unitPos
				? { ...unitPos, w: cardW || unitW }
				: apiCard && cardPos
					? { ...cardPos, w: cardW || PANE_MIN }
					: undefined
	);

	/** What the peek shows, drawn as that kind is drawn everywhere else. */
	const peekCard = $derived.by(() => {
		const at = peek?.at;
		if (at?.api) {
			const api = apiCardOf(at.api);
			return api && { kind: 'api' as const, api, w: PANE_MIN };
		}
		const t = at?.target;
		if (!t) return undefined;
		if (t.field && isUnit(t.field)) {
			const unit = unitCardOf(t.field);
			return (
				unit && {
					kind: 'unit' as const,
					unit,
					from: t.box,
					w: unitWidth(unit)
				}
			);
		}
		if (t.field && (isTrigger(t.field) || model.ports.has(t.field) || isChannel(t.field))) {
			const trigger = triggerCardOf(t.field, t.box);
			return trigger && { kind: 'trigger' as const, trigger, w: PANE_MIN };
		}
		if (t.field) {
			const field = fieldCardOf({ box: t.box.id, field: t.field });
			return field && { kind: 'field' as const, field, id: t.field, w: PANE_MIN };
		}
		// A model or logic card, drawn as on the canvas, its rows peeking in turn.
		const data = cardOf(t.box, (field, ev) =>
			ev === 'click'
				? peekTo({ target: { box: t.box, field } })
				: hoverRow({ box: t.box.id, field }, ev === 'enter')
		);
		return data && { kind: 'box' as const, box: t.box, data, w: t.box.width };
	});

	/** Beside the card, right of it, else left of it, else over the canvas's right. */
	const peekPos = $derived.by(() => {
		const c = shownCard;
		const w = peekCard && (peekCard.kind === 'box' ? peekCard.w : peekW || peekCard.w);
		if (!c || !w || !peek) return undefined;
		const right = c.left + c.w + 8;
		const left =
			right + w <= cw - 8
				? right
				: c.left - 8 - w >= 8 + panelW
					? c.left - 8 - w
					: Math.max(8 + panelW, cw - w - 8);
		return { left, top: Math.min(Math.max(8, c.top + peek.dy), Math.max(8, ch - peekH - 8)) };
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
	 * area round the target would be too small to read, or the card too big for the canvas. The
	 * centre is nudged so the box round the target stays in view.
	 */
	function flyTo(target: { box: LandscapeBox; field?: string }, back = false) {
		const t = target.box;
		const area = (t.parentId && boxById.get(t.parentId)) || t;
		const fill = (b: LandscapeBox) => Math.max(b.width / cw, b.height / ch);
		const zoom = Math.min(Math.max(camera.current.zoom, 0.8 / fill(area)), 0.92 / fill(t));
		const row = rowOf(t, target.field);
		// A row hidden in a folded card is shown by expanding the card.
		if (t.fields && row >= shownRows(t.fields.length, !!view.expanded[t.id], t.foldAt))
			view.expanded = { ...view.expanded, [t.id]: true };
		// Keep [start, start + size] on a canvas side of `side` pixels, if it fits.
		const keep = (c: number, start: number, size: number, side: number) => {
			const half = side / 2 / zoom;
			return size <= 2 * half ? Math.min(Math.max(c, start + size - half), start + half) : c;
		};
		camera.setCenter(
			keep(t.absX + t.width / 2, area.absX, area.width, cw - panelW) - panelW / 2 / zoom,
			keep(t.absY + (row >= 0 ? rowY(t, row) : t.height / 2), area.absY, area.height, ch),
			{ zoom, duration: 700 }
		);
		overRow = null;
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

	/** Goes to a search hit: frames a system or module, flies to a model or row, picks an api. */
	/** A hit picked before the first layout came in, gone to once it has. */
	let pickLater: Pick<Hit, 'kind' | 'id'> | undefined;
	function pick(hit: Pick<Hit, 'kind' | 'id'>) {
		search.open = false;
		// A flag is never a box: going to one focuses on what it reaches.
		if (hit.kind === 'flag') return setFocus(focusOf(hit.id, { flag: true }));
		if (!ready) return void (pickLater = hit);
		const outside = () => !model.elements.has(hit.id) && !model.fields.has(hit.id);
		if (view.play && outside()) stopPlay();
		if (view.focused && outside()) leaveFocus();
		if (hit.kind === 'api') return showApi(hit.id);
		view.api = null;
		view.apiField = null;
		if (hit.kind === 'system' || hit.kind === 'module') {
			view.field = null;
			view.trail = [];
			const own = boxes.filter((b) => b.elementId === hit.id && !b.ref && !b.boundary);
			const t = own.find((b) => !cardRows(b)) ?? own[0];
			if (!t) return;
			// Half its api rail sits outside its right border.
			const rail = t.apis?.length
				? railOf(model, railGroups(model, t.elementId, t.apis), t.height).width / 2
				: 0;
			const w = t.width + rail;
			const zoom = 0.9 / Math.max(w / cw, t.height / ch);
			camera.setCenter(t.absX + w / 2 - panelW / 2 / zoom, t.absY + t.height / 2, {
				zoom,
				duration: 700
			});
			return;
		}
		const modelId = hit.kind === 'field' ? model.fields.get(hit.id)?.modelId : hit.id;
		const field = hit.kind === 'model' ? undefined : hit.id;
		const fits = (b: LandscapeBox) =>
			hit.kind === 'logic-unit' || hit.kind === 'trigger'
				? !!cardRows(b) && rowOf(b, field) >= 0
				: hit.kind === 'channel'
					? !!b.channel && b.elementId === hit.id
					: !!b.view && b.elementId === modelId && (!field || rowOf(b, field) >= 0);
		const box = boxes.find((b) => fits(b) && !b.ref) ?? boxes.find(fits);
		if (box) flyTo({ box, field });
	}

	/**
	 * Shows only a hit and what connects to it. A new focus replaces the current one; the
	 * subject is picked, so its connections are drawn.
	 */
	function focusHit(hit: Hit, mode: FocusMode) {
		search.open = false;
		setFocus(focusOf(hit.id, { mode, ...(hit.kind === 'flag' && { flag: true as const }) }));
	}

	function setFocus(next: Focus) {
		if (!view.focused) beforeFocus = view.play ? beforePlay : { ...camera.current };
		unpin();
		view.play = null;
		beforePlay = undefined;
		view.selectedNodes = [];
		view.expanded = {};
		view.focused = next;
		if (next.flag || next.scenario) return;
		const id = next.id;
		const field = model.fields.get(id);
		const kind = model.elements.get(id)?.def.kind;
		if (field) {
			const box = boxes.find((b) => b.view && b.elementId === field.modelId && rowOf(b, id) >= 0);
			if (box) view.field = { box: box.id, field: id };
		} else if (kind === 'logic-unit' || kind === 'trigger') {
			const box = boxes.find((b) => rowOf(b, id) >= 0);
			if (box) view.field = { box: box.id, field: id };
		} else if (kind === 'api') view.api = id;
		else {
			const box = boxes.find((b) => b.elementId === id && !b.ref && !b.boundary && !b.logic);
			if (box) view.selectedNodes = [box.id];
		}
	}

	// The Flags menu asks for a flag focus; it is taken once.
	$effect(() => {
		const key = flagAsk.key;
		if (!key) return;
		untrack(() => {
			flagAsk.key = null;
			setFocus(focusOf(key, { flag: true }));
		});
	});

	// The Changes panel asks for a focus on the shown scenario, or one change of it.
	$effect(() => {
		const ask = scenarioAsk.change;
		const path = changes.scenario?.path;
		if (ask === null) return;
		untrack(() => {
			scenarioAsk.change = null;
			if (path) setFocus(focusOf(path, { scenario: true, ...(ask !== 'all' && { change: ask }) }));
		});
	});
	// A pane beside the canvas asks to go to something.
	$effect(() => {
		const id = goAsk.id;
		if (!id) return;
		untrack(() => {
			goAsk.id = null;
			goTo(id);
		});
	});
	// A scenario focus ends with its scenario shown.
	$effect(() => {
		const f = view.focused;
		if (f?.scenario && changes.scenario?.path !== f.id) untrack(leaveFocus);
	});

	function leaveFocus() {
		unpin();
		view.selectedNodes = [];
		view.expanded = {};
		view.focused = null;
		keepCamera = true;
		if (beforeFocus) camera.setViewport(beforeFocus);
		beforeFocus = undefined;
	}

	/** Goes to anything with an id, as a search hit would: a scenario's change or impact. */
	function goTo(id: string) {
		const kind = el(id)?.def.kind;
		const apiField = model.apiFields.get(id);
		if (apiField) return showApi(apiField.apiId);
		if (kind === 'flag') return;
		if (kind) return pick({ kind, id });
		if (model.fields.has(id)) return pick({ kind: 'field', id });
		const owner = [...model.elements.values()].find((e) =>
			[
				...(e.def.inputs ?? []),
				...(e.def.outputs ?? []),
				...(e.def.params ?? []),
				...(e.def.indexes ?? [])
			].some((x) => x.id === id)
		);
		if (owner && owner.def.kind !== 'flag') pick({ kind: owner.def.kind, id: owner.id });
	}

	// ------------------------------------------------------------ editing a scenario
	/** Right-clicking a field or a model's name bar opens its menu while a scenario is shown. */
	const editing = $derived(changes.editable && changes.mode !== 'before');
	let menu = $state<{ target: string; x: number; y: number } | null>(null);

	/** The Changes or History panel covers the canvas's left; flying centres right of it. */
	const panelW = $derived(changes.panel ? 340 : 0);
	/** Room for a card across the canvas, and down it: 8 px clear on each side. */
	const paneRoom = $derived(Math.max(PANE_MIN, cw - panelW - 16));
	const paneTall = $derived(Math.max(120, ch - 16));

	function goBack() {
		const prev = view.trail.at(-1);
		const box = prev && boxById.get(prev.box);
		if (!prev || !box) return;
		view.trail = view.trail.slice(0, -1);
		flyTo({ box, field: prev.field }, true);
	}

	function unpin() {
		peek = null;
		view.api = null;
		view.apiField = null;
		view.field = null;
		view.trail = [];
	}

	// ------------------------------------------------------------ play
	// A unit played step by step: each step moves the camera to where it happens on the board
	// and draws it there as a line between the real elements. Nothing moves on its own.

	/** Kept clear for the player at the bottom of the canvas, in screen px. */
	const PLAYER = 104;
	const run = $derived(
		view.play
			? runOf(changes.shown, view.play.unit, view.play.choices, new Set(view.play.into))
			: undefined
	);
	const playAt = $derived(run && view.play ? Math.min(view.play.at, run.steps.length - 1) : 0);
	const step = $derived(run?.steps[playAt]);
	/** At a call with steps inside not stepped into: what Into goes into, named on the board. */
	const inside = $derived.by(() => {
		if (!step?.into || step.entered) return undefined;
		const n = `${step.intoSteps} step${step.intoSteps === 1 ? '' : 's'} inside`;
		// A called api names the unit handling it.
		return isApiEl(step.to) ? `${el(step.into)!.name} · ${n}` : n;
	});

	/** Where an element a step names is drawn: a card and its row, or an api on a box's rail. */
	interface PlayEnd {
		box: LandscapeBox;
		row?: number;
		api?: string;
	}
	function playEndOf(id: string, near: LandscapeBox | undefined): PlayEnd | undefined {
		if (isApiEl(id)) {
			const owner = boxes.find((b) => b.apis?.includes(id) && !b.ref);
			return owner && { box: owner, api: id };
		}
		const fits = (b: LandscapeBox) => !!b.logic && rowOf(b, id) >= 0;
		const b = isUnit(id)
			? (boxes.find((o) => fits(o) && !o.ref) ?? boxes.find(fits))
			: near && linkTarget(model, boxes, near, id);
		if (!b) return undefined;
		const row = rowOf(b, id);
		return { box: b, row: row >= 0 ? row : undefined };
	}
	/** Both ends of a step; a model is looked for near the unit taking the step. */
	function endsOf(s: PlayStep) {
		const unitBox = playEndOf(s.frame.at(-1)!, undefined)?.box;
		return { from: playEndOf(s.from, unitBox), to: playEndOf(s.to, unitBox) };
	}
	/** An api's rail on its owner's box, as it is drawn once the box shows. */
	const ownRail = (b: LandscapeBox) =>
		railOf(model, railGroups(model, b.elementId, b.apis ?? []), b.height);

	/** An end in canvas px, and the least zoom drawing it readably. */
	function placeOf(e: PlayEnd) {
		const b = e.box;
		if (e.api) {
			const r = ownRail(b);
			const y = b.absY + r.top + (railRowY(r, e.api) ?? r.height / 2) * r.scale;
			return {
				x: b.absX + b.width - r.width / 2,
				w: r.width,
				y,
				zoom: READABLE / (RAIL.font * r.scale)
			};
		}
		const y = e.row !== undefined ? b.absY + rowY(b, e.row) : b.absY + TABLE.head / 2;
		return { x: b.absX, w: b.width, y, zoom: READABLE / TABLE.row };
	}

	/** Kept clear round what the camera brings into view, in screen px. */
	const MARGIN = 56;

	/** Fits the whole run's focus above the player, no further in than 100%. */
	function fitRun() {
		const left = Math.min(...boxes.map((b) => b.absX));
		const top = Math.min(...boxes.map((b) => b.absY));
		// Half an api rail sits outside its box's right border.
		const right = Math.max(
			...boxes.map((b) => b.absX + b.width + (rails.get(b.id)?.width ?? 0) / 2)
		);
		const bottom = Math.max(...boxes.map((b) => b.absY + b.height));
		const zoom = Math.max(
			minZoom,
			Math.min(1, (cw - 2 * MARGIN) / (right - left), (ch - PLAYER - 2 * MARGIN) / (bottom - top))
		);
		void camera
			.setViewport({
				x: cw / 2 - ((left + right) / 2) * zoom,
				y: (ch - PLAYER) / 2 - ((top + bottom) / 2) * zoom,
				zoom
			})
			.then(() => {
				ready = true;
				if (step) keepInView(step);
			});
	}

	/**
	 * Brings both ends of a step into view above the player, if they are not: the least pan,
	 * and a zoom out only when they do not fit at this zoom. It never zooms in. When both do not
	 * fit where their rows are drawn, the receiver.
	 */
	function keepInView(s: PlayStep) {
		const { from, to } = endsOf(s);
		const ends = [from, to].filter((e) => !!e);
		if (!ends.length) return;
		// A row hidden in a folded card is shown by expanding the card.
		for (const e of ends)
			if (
				e.box.fields &&
				e.row !== undefined &&
				e.row >= shownRows(e.box.fields.length, !!view.expanded[e.box.id], e.box.foldAt)
			)
				view.expanded = { ...view.expanded, [e.box.id]: true };
		const v = camera.getViewport();
		const h = ch - PLAYER;
		const span = (list: ReturnType<typeof placeOf>[]) => {
			const f = {
				left: Math.min(...list.map((p) => p.x)),
				right: Math.max(...list.map((p) => p.x + p.w)),
				top: Math.min(...list.map((p) => p.y)) - TABLE.rowHeight,
				bottom: Math.max(...list.map((p) => p.y)) + TABLE.rowHeight,
				least: Math.max(...list.map((p) => p.zoom))
			};
			const most = Math.min(
				(cw - 2 * MARGIN) / (f.right - f.left),
				(h - 2 * MARGIN) / (f.bottom - f.top)
			);
			return { ...f, zoom: Math.max(minZoom, Math.min(v.zoom, most)) };
		};
		let f = span(ends.map(placeOf));
		if (f.zoom < f.least && to) f = span([placeOf(to)]);
		const z = f.zoom;
		// The least move along one axis that brings [lo, hi] into [MARGIN, size - MARGIN].
		const shift = (lo: number, hi: number, at: number, size: number) =>
			lo * z + at < MARGIN
				? MARGIN - lo * z
				: hi * z + at > size - MARGIN
					? size - MARGIN - hi * z
					: at;
		const next =
			z < v.zoom
				? {
						x: cw / 2 - ((f.left + f.right) / 2) * z,
						y: h / 2 - ((f.top + f.bottom) / 2) * z,
						zoom: z
					}
				: { x: shift(f.left, f.right, v.x, cw), y: shift(f.top, f.bottom, v.y, h), zoom: z };
		if (next.x !== v.x || next.y !== v.y || next.zoom !== v.zoom)
			void camera.setViewport(next, { duration: 400 });
	}
	// Each new step brings its ends into view; panning between steps is free.
	$effect(() => {
		const s = step;
		const at = playAt;
		if (!s || !ready || fitting) return;
		untrack(() => keepInView(s));
		void at;
	});

	/** An end on screen: the edges of what is drawn for it and the height of its row. */
	function screenOf(e: PlayEnd) {
		const { x: vx, y: vy, zoom } = camera.current;
		const host = e.api ? hostOf(e.api) : undefined;
		const r = host && rails.get(host.id);
		if (e.api && host && r) {
			const left = host.absX + host.width - r.width / 2;
			const row = listed(host.id) ? railRowY(r, e.api) : undefined;
			const y = host.absY + r.top + (row !== undefined ? row * r.scale : r.height / 2);
			return { left: left * zoom + vx, right: (left + r.width) * zoom + vx, y: y * zoom + vy };
		}
		const s = shownBox(e.box);
		const y =
			s !== e.box
				? s.absY + s.height / 2
				: e.row !== undefined
					? e.box.absY + rowY(e.box, e.row)
					: e.box.absY + TABLE.head / 2;
		return { left: s.absX * zoom + vx, right: (s.absX + s.width) * zoom + vx, y: y * zoom + vy };
	}
	const nameOf = (id: string) =>
		isApiEl(id)
			? `${el(id)!.def.method} ${el(id)!.def.path}`
			: isUnit(id)
				? el(id)!.name
				: label(id);

	/** A step's line between its ends, in screen px, with its arrow and where its number goes. */
	function lineOf(s: PlayStep) {
		const ends = endsOf(s);
		if (!ends.from || !ends.to) return undefined;
		const a = screenOf(ends.from);
		const b = screenOf(ends.to);
		let x0, x1, xm;
		if (b.left >= a.right) [x0, x1, xm] = [a.right, b.left, (a.right + b.left) / 2];
		else if (b.right <= a.left) [x0, x1, xm] = [a.left, b.right, (a.left + b.right) / 2];
		else [x0, x1, xm] = [a.right, b.right, Math.max(a.right, b.right) + 28];
		const dir = Math.sign(x1 - xm) || 1;
		const out = Math.sign(xm - x0) || 1;
		return {
			a,
			b,
			x0,
			x1,
			xm,
			d: `M${x0} ${a.y} H${xm} V${b.y} H${x1}`,
			// At the receiver: what the sender depends on, as with every connection.
			arrow: `M${x1} ${b.y} L${x1 - dir * 9} ${b.y - 4.5} L${x1 - dir * 9} ${b.y + 4.5} Z`,
			// Where a past step's number goes, and the current one's, where its line starts.
			num: { x: xm, y: (a.y + b.y) / 2 },
			start: { x: x0 + out * 16, y: a.y }
		};
	}

	/** The current step as drawn on the board, in screen px. */
	const playDraw = $derived.by(() => {
		if (!step) return undefined;
		const line = lineOf(step);
		if (!line) return undefined;
		const { a, b, x0, x1, xm, d, arrow, start } = line;
		// A step the unit takes alone is written beside its row.
		if (step.from === step.to) return { beside: { x: a.right + 12, y: a.y } };
		// When the camera framed only the receiver, the label goes beside the receiver, and the
		// sender is named where its line leaves the screen.
		const h = ch - PLAYER;
		const outX = (x: number) => x < 0 || x > cw;
		const outY = (y: number) => y < 0 || y > h;
		const off = outX(x0) || outY(a.y);
		const away = Math.sign(xm - x1) || 1;
		const clampX = (x: number) => Math.min(Math.max(x, 8), cw - 8);
		const clampY = (y: number) => Math.min(Math.max(y, 16), h - 16);
		// Where the line, followed back from the receiver, leaves the screen.
		const exit = outX(xm)
			? { x: clampX(xm), y: b.y, align: xm > cw ? 'end' : 'start' }
			: outY(a.y)
				? { x: xm, y: clampY(a.y), align: 'center' }
				: { x: clampX(x0), y: a.y, align: x0 > cw ? 'end' : 'start' };
		return {
			d,
			arrow,
			start,
			label: off
				? { x: x1 + away * 14, y: b.y, align: away > 0 ? 'start' : 'end' }
				: Math.abs(x1 - xm) > 60
					? { x: (xm + x1) / 2, y: b.y, align: 'center' }
					: { x: (x0 + xm) / 2, y: a.y, align: 'center' },
			edge: off && { ...exit, text: nameOf(step.from) },
			// Beside the receiver, on the side the line does not come in by.
			into:
				x1 === b.left
					? { x: b.right + 12, y: b.y, align: 'start' }
					: { x: b.left - 12, y: b.y, align: 'end' }
		};
	});

	/** How far a label is moved left to sit at its anchor: by its start, middle or end. */
	const SHIFT: Record<string, string> = { start: '0%', center: '-50%', end: '-100%' };

	/**
	 * The steps before the current one, as a faint trail of numbered lines. Steps inside a unit
	 * come back out of fold into the line of the call into it, numbered as a range; a line taken
	 * more than once, or back the other way (what a call gets), carries every number. Steps the
	 * unit takes alone are not drawn.
	 */
	const trail = $derived.by(() => {
		if (!run || !step) return [];
		const cur = step.frame;
		const onPath = (f: string[]) => f.length <= cur.length && f.every((u, k) => cur[k] === u);
		// The steps folded into each step drawn: the last of them, by the step drawn.
		const last: Record<number, number> = {};
		for (let i = 0; i < playAt; i++) {
			let j = i;
			while (!onPath(run.steps[j].frame)) j = callOf(run, j);
			last[j] = i;
		}
		const lines: Record<string, { at: number; s: PlayStep; nums: string[]; texts: string[] }> = {};
		for (const [k0, end] of Object.entries(last)) {
			const at = Number(k0);
			const s = run.steps[at];
			if (s.from === s.to) continue;
			const num = end > at ? `${at + 1}–${end + 1}` : `${at + 1}`;
			const l = (lines[[s.from, s.to].sort().join(' ')] ??= { at, s, nums: [], texts: [] });
			l.nums.push(num);
			l.texts.push(`${num} · ${s.text}`);
		}
		return Object.values(lines).flatMap((l) => {
			const line = lineOf(l.s);
			return line ? [{ ...l, line }] : [];
		});
	});

	function startPlay(unit: string) {
		if (!view.play) beforePlay = camera.getViewport();
		unpin();
		view.expanded = {};
		view.play = { unit, choices: {}, into: [], over: [], at: 0 };
	}
	/** Stops playing: the run's focus closes and the view goes back to where it was. */
	function stopPlay() {
		view.play = null;
		view.expanded = {};
		keepCamera = true;
		if (beforePlay) void camera.setViewport(beforePlay);
		beforePlay = undefined;
	}
	function jump(at: number) {
		if (view.play && run)
			view.play = { ...view.play, at: Math.min(Math.max(at, 0), run.steps.length - 1) };
	}
	function pickBranch(option: number) {
		if (!view.play || !step?.choice) return;
		view.play = {
			...view.play,
			choices: { ...view.play.choices, [step.key]: option },
			at: playAt + 1
		};
	}
	function forward() {
		if (step?.choice && step.choice.picked === undefined) return;
		if (view.play && step && forwardGoesInto(step, view.play.over, settings.followCalls))
			stepInto();
		else jump(playAt + 1);
	}
	/** Answers the call at step `i`: into its unit, or over it on purpose; then steps on. */
	function answer(into: boolean, i = playAt) {
		const call = run?.steps[i];
		if (!view.play || !call?.into) return;
		const key = call.key;
		const drop = (list: string[]) => list.filter((k) => k !== key);
		view.play = {
			...view.play,
			into: into ? [...drop(view.play.into), key] : drop(view.play.into),
			over: into ? drop(view.play.over) : [...drop(view.play.over), key],
			at: i + 1
		};
	}
	const stepInto = () => answer(true);
	const stepOver = () => answer(false);
	function stepOut() {
		if (!run || !step || step.frame.length < 2) return;
		const j = stepOutOf(run, playAt);
		if (run.steps[j].frame.length < step.frame.length) jump(j);
		// A choice inside not made yet stops the run before it comes back: leave by stepping over
		// the call instead.
		else answer(false, callOf(run, playAt));
	}
	/** Keys while playing; returns whether the key was one. */
	function playKey(e: KeyboardEvent) {
		if (!view.play || search.open || e.metaKey || e.ctrlKey || e.altKey) return false;
		const n = Number(e.key);
		if (e.key === 'Escape') stopPlay();
		else if (e.key === 'ArrowRight') forward();
		else if (e.key === 'ArrowLeft') jump(playAt - 1);
		else if (e.key === 'Home') jump(0);
		else if (e.key === 'i') stepInto();
		else if (e.key === 's') stepOver();
		else if (e.key === 'o') stepOut();
		else if (e.key === 'f') settings.setFollowCalls(!settings.followCalls);
		else if (step?.choice && n >= 1 && n <= step.choice.options.length) pickBranch(n - 1);
		else return false;
		e.preventDefault();
		return true;
	}
</script>

<svelte:window
	onkeydown={(e) => {
		if (playKey(e)) return;
		const typing = (e.target as HTMLElement | null)?.closest('input, textarea, select');
		if (
			editing &&
			!typing &&
			e.key.toLowerCase() === 'z' &&
			(e.metaKey || e.ctrlKey) &&
			!e.shiftKey
		) {
			e.preventDefault();
			void changes.remove();
			return;
		}
		if (e.key === 'Escape' && peek) {
			peek = null;
			return;
		}
		if (e.key === 'Escape') {
			// In a focus, Esc unpins first, then leaves the focus.
			const pinned = view.field || view.api || view.selectedNodes.length;
			if (view.focused && !pinned && !keyOpen) leaveFocus();
			unpin();
			view.selectedNodes = [];
			keyOpen = false;
		}
	}}
/>

<div
	class="canvas"
	bind:clientWidth={cw}
	bind:clientHeight={ch}
	style:--pane-room="{paneRoom}px"
	style:--pane-tall="{paneTall}px"
	data-testid="canvas"
>
	<!-- The landscape on one WebGL canvas, moved by its camera (see CanvasCamera); what
	     it draws takes the pointer through hit testing (see GlLayer.hitAt). -->
	<div
		class="stage"
		class:pointing={!!glPointer}
		bind:this={stageEl}
		role="presentation"
		onpointermove={glMove}
		onpointerleave={() => glHover(null)}
		onclick={glClick}
		oncontextmenu={glMenu}
	>
		<GlLayer
			bind:this={glLayer}
			{boxes}
			{boxById}
			{rails}
			{model}
			{rels}
			{view}
			rest={glRest}
			lit={glLit}
			dim={dimming ? related : undefined}
			front={namesInFront ? namesShown : []}
			pointer={glPointer}
		/>
	</div>
	<div class="controls" role="toolbar" aria-label="Canvas controls">
		<button
			title="Zoom in"
			aria-label="Zoom in"
			onclick={() => void camera.zoomBy(1.2, { duration: 200 })}
			><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button
		>
		<button
			title="Zoom out"
			aria-label="Zoom out"
			onclick={() => void camera.zoomBy(1 / 1.2, { duration: 200 })}
			><svg viewBox="0 0 24 24"><path d="M5 12h14" /></svg></button
		>
		<button title="Fit view" aria-label="Fit view" onclick={() => void fitAll(200)}
			><svg viewBox="0 0 24 24"
				><path
					d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"
				/></svg
			></button
		>
		<button
			class:on={settings.minimap}
			title="Map"
			aria-label="Map"
			aria-pressed={settings.minimap}
			onclick={() => settings.setMinimap(!settings.minimap)}
			><svg viewBox="0 0 24 24"
				><path
					d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"
				/><path d="M15 5.764v15" /><path d="M9 3.236v15" /></svg
			></button
		>
		<button
			class:on={keyOpen}
			title="Key"
			aria-label="Key"
			aria-pressed={keyOpen}
			onclick={() => (keyOpen = !keyOpen)}
			><svg viewBox="0 0 13 13" stroke-width="1.4"
				><rect x="1" y="1.5" width="3" height="3" /><rect x="1" y="8.5" width="3" height="3" /><path
					d="M6.5 3h5.5M6.5 10h5.5"
				/></svg
			></button
		>
	</div>
	{#if settings.minimap}
		<Minimap boxes={mapBoxes} {cw} {ch} {minZoom} maxZoom={MAX_ZOOM} />
	{/if}
	{#each wedges as w (w.key)}
		<button
			class="wedge"
			style:left="{w.x}px"
			style:top="{w.y}px"
			style:transform="rotate({w.angle}deg)"
			style:--c="var(--sdv-link-{LINK_TOKEN[w.kind]})"
			title="Go to {w.name}"
			aria-label="Go to {w.name}"
			onclick={() => goEnd(w.end)}
		>
			<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M20 10 1 4.5v11Z" /></svg>
		</button>
	{/each}
	{#if keyOpen}
		<!-- What is drawn, beside the button that opened it. Lines and marks: the Atoms board. -->
		<aside class="key" aria-label="Key">
			<h4>Key</h4>
			<div class="k"><EntityGlyph kind="system" />System<span class="sw system"></span></div>
			<div class="k"><EntityGlyph kind="module" />Module<span class="sw module"></span></div>
			<div class="k">
				<EntityGlyph kind="class" />Model, where owned<span class="sw class"></span>
			</div>
			<div class="k"><EntityGlyph kind="table" />Stored table<span class="sw table"></span></div>
			<div class="k"><EntityGlyph kind="file" />Stored file<span class="sw file"></span></div>
			<div class="k"><EntityGlyph kind="triggers" />Triggers<span class="sw triggers"></span></div>
			<div class="k">
				<EntityGlyph kind="channel" />Channel, its events<span class="sw channel"></span>
			</div>
			<div class="k"><EntityGlyph kind="logic" />Logic<span class="sw logic"></span></div>
			<div class="k"><EntityGlyph kind="api" />APIs<span class="sw api"></span></div>
			<hr />
			<div class="k"><span class="ex"><span class="dashed"></span></span>Owned elsewhere</div>
			<hr />
			<p class="hint">
				Grey lines at rest: which module depends on which; hover a module to light them blue. Hover
				anything else for its flows, in these colours. The arrow points at what the start depends
				on. Click to hide a kind.
			</p>
			{#each KEY_LINES as k (k.id)}
				<button
					class="k line"
					class:off={view.hidden[k.id]}
					aria-pressed={!view.hidden[k.id]}
					title={view.hidden[k.id] ? 'Show these lines' : 'Hide these lines'}
					onclick={() => {
						const next = { ...view.hidden };
						if (next[k.id]) delete next[k.id];
						else next[k.id] = true;
						view.hidden = next;
					}}
				>
					<svg class="ex" viewBox="0 0 30 10" style:--c="var(--sdv-link-{k.token})"
						><path
							d={k.diamond ? 'M10 5h12' : 'M4 5h18'}
							stroke="var(--c)"
							stroke-width="1.6"
							stroke-dasharray={k.dash}
						/><path
							d={k.diamond
								? 'M1 5 5.5 2 10 5 5.5 8Z'
								: 'M1 5a2.6 2.6 0 1 0 5.2 0a2.6 2.6 0 1 0-5.2 0Z'}
							fill="var(--c)"
						/><path d="M29 5 22 1.5v7Z" fill="var(--c)" /></svg
					>{k.label}
				</button>
			{/each}
		</aside>
	{/if}
	<!-- A card's body, drawn the same in the card and in the peek; `pick` shows an entry. -->
	{#snippet fieldBody(
		card: NonNullable<ReturnType<typeof fieldCardOf>>,
		pick: (at: PeekAt) => void,
		open?: string
	)}
		{#if card.description}
			<p class="description">{card.description}</p>
		{/if}
		{#if card.constraints.length}
			<section class="constraints">
				<h4>Constraints</h4>
				{#each card.constraints as c, i (i)}
					{@const e = enumOf(c)}
					{#if e}
						{@const key = `${card.title}|${i}`}
						{@const all = shownValues === key || e.values.length <= VALUES_SHOWN + 1}
						<div class="constraint">
							<span class="badge">enum {e.name}</span><span class="count"
								>{e.values.length} values</span
							>
						</div>
						<ul class="values">
							{#each all ? e.values : e.values.slice(0, VALUES_SHOWN) as v, j (j)}<li>
									<Ident text={v} />
								</li>{/each}
						</ul>
						<!-- The longest value sets the width, shown or not, so Show more does not widen it. -->
						<div class="values-sizer" aria-hidden="true">
							{e.values.reduce((a, b) => (b.length > a.length ? b : a), '')}
						</div>
						{#if !all}
							<button class="more" onclick={() => (shownValues = key)}
								>Show {e.values.length - VALUES_SHOWN} more</button
							>
						{/if}
					{:else}
						<div class="constraint"><span class="badge">{c}</span></div>
					{/if}
				{/each}
			</section>
		{/if}
		{#each card.sections as s (s.label)}
			<section class={s.kind}>
				<h4>{s.label}</h4>
				{#each s.entries as e, i (i)}
					<button
						class="entry"
						class:open={!!open && open === keyOf(e)}
						disabled={!e.target && !e.api}
						onclick={() => pick(e)}
						onmouseenter={() =>
							e.target?.field && hoverRow({ box: e.target.box.id, field: e.target.field }, true)}
						onmouseleave={() =>
							e.target?.field && hoverRow({ box: e.target.box.id, field: e.target.field }, false)}
						title={e.target || e.api ? 'Show here' : undefined}
					>
						<span class="text" data-glyph={s.glyph}><Ident text={e.text} /></span>
						<span class="where">{e.where}</span>
					</button>
				{/each}
				{#if s.note}<p class="note">ƒ {s.note}</p>{/if}
			</section>
		{:else}
			<p class="empty">No references, sources or incoming links.</p>
		{/each}
	{/snippet}
	{#snippet unitBody(
		u: NonNullable<ReturnType<typeof unitCardOf>>,
		pick: (at: PeekAt) => void,
		from: LandscapeBox | undefined,
		id: string,
		w: number
	)}
		<!-- Inputs, Returns and Fails side by side when they fit the card's width, else stacked. -->
		{#if u.groups.length}
			<div class="signature">
				{#each u.groups as g (g.label)}
					<section class="sig-group" class:fails={g.fails}>
						<h4>{g.label}</h4>
						<div class="sig-rows">
							{#each g.rows as x (x.name)}
								<span class="name"><Ident text={x.name} /></span><span class="where"
									><Ident text={x.type} /></span
								>
								{#if x.note}<span class="sig-note">{x.note}</span>{/if}
							{/each}
						</div>
					</section>
				{/each}
			</div>
		{/if}
		{#if u.seq}
			{@const col = sequenceCol(u.seq, w - 2)}
			<section class="seq-section" class:wide={sequenceWidth(u.seq, col) > w - 2}>
				<h4 class="seq-head">
					Sequence
					<button class="play" onclick={() => startPlay(id)} title="Walk the board step by step"
						><Play size={12} fill="currentColor" />Play</button
					>
				</h4>
				<SequenceDiagram
					seq={u.seq}
					{col}
					onpick={(to) => {
						const at = seqAt(to, from);
						if (at) pick(at);
					}}
				/>
			</section>
		{/if}
	{/snippet}
	{#snippet apiBody(
		api: NonNullable<ReturnType<typeof apiCardOf>>,
		pick: (at: PeekAt) => void,
		open?: string
	)}
		{#if api.params.length}
			<section>
				<h4>Params</h4>
				{#each api.params as p (p.in + p.name)}
					<div class="entry">
						<span class="text"
							><Ident text={p.name} />{p.required || p.in === 'path' ? '' : '?'}</span
						>
						<span class="where">{p.in} · {p.type}{p.description ? ` · ${p.description}` : ''}</span>
					</div>
				{/each}
			</section>
		{/if}
		{#each [api.request, ...api.responses].filter((b) => !!b) as b (b.part)}
			<section class="body">
				<h4>
					{#if b.status}<b class="status {statusClass(b.status)}">{b.status}</b>{:else}Request{/if}
					{#if b.fields.length}<span class="shape">own shape{b.many ? ', a list' : ''}</span>{/if}
					{#if b.description}<span class="shape">{b.description}</span>{/if}
				</h4>
				{#if b.model}
					{@const m = b.model}
					<button
						class="entry"
						class:open={!!open && !!m.target && open === keyOf({ target: m.target })}
						disabled={!m.target}
						onclick={() => m.target && pick({ target: m.target })}
						title={m.target ? 'Show here' : undefined}
					>
						<span class="text"><Ident text={m.text} /></span>
						<span class="where">{m.note}</span>
					</button>
				{/if}
				<!-- Names, types and marks in shared columns, so they line up. -->
				{#if b.fields.length}
					<div class="api-fields">
						{#each b.fields as f (f.id)}
							<div
								class="api-field"
								class:hot={view.apiField === f.id}
								role="listitem"
								title={f.title}
								onmouseenter={() => (view.apiField = f.id)}
								onmouseleave={() => (view.apiField = null)}
							>
								<span class="name"><Ident text={f.name} /></span>
								<span class="where"><Ident text={f.type} /></span>
								{#if !f.traced}<span class="untraced"><TriangleAlert size={12} /></span
									>{:else if f.computed}<span class="traced computed">ƒ</span
									>{:else if f.title}<span class="traced">{b.part === 'request' ? '⇠' : '⇢'}</span
									>{:else}<span></span>{/if}
							</div>
						{/each}
					</div>
				{/if}
				{#if !b.model && !b.fields.length && !b.description}<p class="empty">No body.</p>{/if}
			</section>
		{/each}
		{#each api.logic as s (s.label)}
			<section class="calls">
				<h4>{s.label}</h4>
				{#each s.entries as e (e.id)}
					<button
						class="entry"
						class:open={!!open && !!e.target && open === keyOf({ target: e.target })}
						disabled={!e.target}
						onclick={() => e.target && pick({ target: e.target })}
						title={e.target ? 'Show here' : undefined}
					>
						<span class="text" data-glyph="ƒ"><Ident text={e.text} /></span>
						<span class="where">{e.where}</span>
					</button>
				{/each}
			</section>
		{/each}
	{/snippet}
	{#snippet triggerBody(t: TriggerPane, pick: (at: PeekAt) => void, open?: string)}
		{#each [t.source, { label: 'Run', rows: t.run }] as s (s.label)}
			{#if s.rows.length}
				<section>
					<h4>{s.label}</h4>
					<!-- One label column for every section, so the values line up. -->
					<div class="facts">
						{#each s.rows as r (r.label)}
							<span class="where">{r.label}</span><span class:mono={r.mono} class:prose={!r.ident}
								>{#if r.ident}<Ident text={r.text} />{:else}{r.text}{/if}</span
							>
						{/each}
					</div>
				</section>
			{/if}
		{/each}
		{#each t.groups as g (g.label)}
			{#if g.units.length || g.facts?.length || g.empty}
				<section class="calls">
					<h4>{g.label}</h4>
					{#if g.facts?.length}
						<div class="facts">
							{#each g.facts as r (r.label)}
								<span class="where">{r.label}</span><span class:prose={!r.ident}>{r.text}</span>
							{/each}
						</div>
					{/if}
					{#each g.units as e (e.id)}
						<button
							class="entry"
							class:open={!!open && !!e.target && open === keyOf({ target: e.target })}
							disabled={!e.target}
							onclick={() => e.target && pick({ target: e.target })}
							title={e.target ? 'Show here' : undefined}
						>
							{#if e.glyph}
								<span class="text"><EntityGlyph kind={e.glyph} /> <Ident text={e.text} /></span>
							{:else}
								<span class="text" data-glyph="ƒ"><Ident text={e.text} /></span>
							{/if}
							<span class="where">{e.where}</span>
						</button>
					{/each}
					{#if !g.units.length && g.empty}<p class="empty">{g.empty}</p>{/if}
				</section>
			{/if}
		{/each}
	{/snippet}
	{#snippet triggerTitle(t: TriggerPane)}
		<div class="head">
			<div class="title"><EntityGlyph kind={t.glyph} /> <Ident text={t.title} /></div>
			<div class="type">{t.sub}</div>
		</div>
	{/snippet}
	{#snippet apiTitle(api: NonNullable<ReturnType<typeof apiCardOf>>)}
		<div class="head">
			<div class="title">
				<span style:color={methodColor(api.method)}>{api.method}</span>
				<span class="mono"><Ident text={api.path} /></span>
			</div>
			<div class="type">{api.sub}</div>
			{#if api.dead}
				<div class="dead-note">
					Dead code · {api.dead.name}{api.dead.note ? ` · ${api.dead.note}` : ''}
				</div>
			{/if}
		</div>
	{/snippet}
	{#snippet fieldTitle(f: NonNullable<ReturnType<typeof fieldCardOf>>)}
		<div class="head">
			<div class="title"><Ident text={f.title} /></div>
			<div class="type">{f.type}</div>
		</div>
	{/snippet}
	{#snippet unitTitle(u: NonNullable<ReturnType<typeof unitCardOf>>)}
		<div class="head">
			<div class="title"><i class="fn">ƒ</i> <Ident text={u.title} /></div>
			<div class="type">{u.sub}</div>
		</div>
	{/snippet}
	{#snippet minButton()}
		<button
			class="icon-btn"
			onclick={() => (cardMin = !cardMin)}
			aria-label={cardMin ? 'Expand' : 'Minimize'}
			title={cardMin ? 'Expand' : 'Minimize, keeping the selection'}
			data-testid="card-min"
			>{#if cardMin}<ChevronDown size={16} />{:else}<ChevronUp size={16} />{/if}</button
		>
		<button class="icon-btn" onclick={unpin} aria-label="Close" title="Close (Esc)"
			><X size={16} /></button
		>
	{/snippet}
	{#snippet peekButtons()}
		<button class="goto" onclick={goToPeek} title="Fly there and pick it"
			><LocateFixed size={13} />Go to</button
		>
		<button class="icon-btn" onclick={() => (peek = null)} aria-label="Close" title="Close (Esc)"
			><X size={16} /></button
		>
	{/snippet}
	{#snippet peekBackButton()}
		{#if peek?.trail.length}
			<button class="icon-btn" onclick={peekBack} title="Back to what this showed before"
				><ChevronLeft size={16} /></button
			>
		{/if}
	{/snippet}
	<!--
		Beside the clicked row, moving with the canvas, so it reads next to what it describes. The
		header stays; the body under it scrolls once the card reaches the canvas's height.
	-->
	{#if inspector && fieldPos}
		<aside
			class="inspector"
			class:min={cardMin}
			style:left="{fieldPos.left}px"
			style:top="{fieldPos.top}px"
			bind:clientHeight={cardH}
			bind:clientWidth={cardW}
			onpointerdowncapture={press}
			{@attach toCanvas}
			data-testid="field-inspector"
		>
			<header>
				{#if view.trail.length}
					<button class="icon-btn" onclick={goBack} title="Back to the previous field"
						><ChevronLeft size={16} /></button
					>
				{/if}
				{@render fieldTitle(inspector)}
				{@render minButton()}
			</header>
			<div class="pane-body">
				<ChangeSection id={view.field!.field} go={goTo} />
				{@render fieldBody(inspector, openPeek, peek?.from)}
			</div>
		</aside>
	{:else if triggerCard && fieldPos}
		<aside
			class="inspector trigger"
			class:min={cardMin}
			style:left="{fieldPos.left}px"
			style:top="{fieldPos.top}px"
			bind:clientHeight={cardH}
			bind:clientWidth={cardW}
			onpointerdowncapture={press}
			{@attach toCanvas}
			data-testid="trigger-card"
		>
			<header>
				{#if view.trail.length}
					<button class="icon-btn" onclick={goBack} title="Back to the previous row"
						><ChevronLeft size={16} /></button
					>
				{/if}
				{@render triggerTitle(triggerCard)}
				{@render minButton()}
			</header>
			<div class="pane-body">
				<ChangeSection id={view.field!.field} go={goTo} />
				{@render triggerBody(triggerCard, openPeek, peek?.from)}
			</div>
		</aside>
	{:else if unitCard && unitPos}
		{@const u = unitCard}
		<aside
			class="inspector unit"
			class:min={cardMin}
			style:left="{unitPos.left}px"
			style:top="{unitPos.top}px"
			style:min-width={cardMin ? undefined : `${unitW}px`}
			bind:clientHeight={cardH}
			bind:clientWidth={cardW}
			onpointerdowncapture={press}
			{@attach toCanvas}
			data-testid="unit-card"
		>
			<header>
				{#if view.trail.length}
					<button class="icon-btn" onclick={goBack} title="Back to the previous row"
						><ChevronLeft size={16} /></button
					>
				{/if}
				{@render unitTitle(u)}
				{@render minButton()}
			</header>
			<div class="pane-body">
				<ChangeSection id={view.field!.field} go={goTo} />
				{@render unitBody(u, openPeek, boxById.get(view.field!.box), view.field!.field, unitW)}
			</div>
		</aside>
	{:else if apiCard && cardPos}
		<!-- Beside the picked row, moving with the canvas, so the api and what it uses share a view. -->
		<aside
			class="inspector"
			class:min={cardMin}
			style:left="{cardPos.left}px"
			style:top="{cardPos.top}px"
			bind:clientHeight={cardH}
			bind:clientWidth={cardW}
			onpointerdowncapture={press}
			{@attach toCanvas}
			data-testid="api-inspector"
		>
			<header>
				{@render apiTitle(apiCard)}
				{@render minButton()}
			</header>
			<div class="pane-body">
				<ChangeSection id={view.api!} go={goTo} />
				{@render apiBody(apiCard, openPeek, peek?.from)}
			</div>
		</aside>
	{/if}
	<!-- What an entry of the card names, beside the card; the camera stays where it is. -->
	{#if peekCard && peekPos}
		{@const p = peekCard}
		{#if p.kind === 'box'}
			<aside
				class="peek-card"
				style:left="{peekPos.left}px"
				style:top="{peekPos.top}px"
				style:width="{p.w}px"
				style:--h="{p.box.height}px"
				bind:clientHeight={peekH}
				{@attach toCanvas}
				data-testid="peek"
			>
				{#key p.box.id}
					<CardPeek id={p.box.id} data={p.data} />
				{/key}
				<div class="peek-head" style:height="{TABLE.head}px">
					{@render peekBackButton()}{@render peekButtons()}
				</div>
			</aside>
		{:else}
			<aside
				class="inspector peek"
				class:unit={p.kind === 'unit'}
				style:left="{peekPos.left}px"
				style:top="{peekPos.top}px"
				style:min-width={p.kind === 'unit' ? `${p.w}px` : undefined}
				bind:clientHeight={peekH}
				bind:clientWidth={peekW}
				{@attach toCanvas}
				data-testid="peek"
			>
				<header>
					{@render peekBackButton()}
					{#if p.kind === 'api'}
						{@render apiTitle(p.api)}
					{:else if p.kind === 'unit'}
						{@render unitTitle(p.unit)}
					{:else if p.kind === 'trigger'}
						{@render triggerTitle(p.trigger)}
					{:else}
						{@render fieldTitle(p.field)}
					{/if}
					{@render peekButtons()}
				</header>
				<div class="pane-body">
					{#if p.kind === 'api'}
						{@render apiBody(p.api, peekTo)}
					{:else if p.kind === 'unit'}
						{@render unitBody(p.unit, peekTo, p.from, peek!.at.target!.field!, p.w)}
					{:else if p.kind === 'trigger'}
						{@render triggerBody(p.trigger, peekTo)}
					{:else}
						{@render fieldBody(p.field, peekTo)}
					{/if}
				</div>
			</aside>
		{/if}
	{/if}
	{#if run && step}
		<svg class="play-lines trail" aria-hidden="true">
			{#each trail as t (t.at)}
				<path class="line {t.s.kind}" d={t.line.d} />
				<path class="head {t.s.kind}" d={t.line.arrow} />
			{/each}
		</svg>
		{#each trail as t (t.at)}
			<button
				class="play-num {t.s.kind}"
				style:left="{t.line.num.x}px"
				style:top="{t.line.num.y}px"
				title={t.texts.join('\n')}
				aria-label="Step {t.nums.join(', ')}: {t.s.text}. Jump there"
				onclick={() => jump(t.at)}>{t.nums.join(', ')}</button
			>
		{/each}
		{#if playDraw?.d}
			<svg class="play-lines" aria-hidden="true">
				<path class="line {step.kind}" d={playDraw.d} />
				<path class="head {step.kind}" d={playDraw.arrow} />
			</svg>
			<div
				class="play-num now {step.kind}"
				style:left="{playDraw.start.x}px"
				style:top="{playDraw.start.y}px"
			>
				{playAt + 1}
			</div>
			<div
				class="play-label {step.kind}"
				style:left="{playDraw.label.x}px"
				style:top="{playDraw.label.y}px"
				style:--ax={SHIFT[playDraw.label.align]}
			>
				{#if step.method}<b style:color={methodColor(step.method)}>{step.method}</b
					>{step.text.slice(step.method.length)}{:else}{step.text}{/if}
			</div>
			{#if playDraw.edge}
				<div
					class="play-edge"
					style:left="{playDraw.edge.x}px"
					style:top="{playDraw.edge.y}px"
					style:--ax={SHIFT[playDraw.edge.align]}
				>
					{playDraw.edge.text}
				</div>
			{/if}
			{#if inside}
				<div
					class="play-into"
					style:left="{playDraw.into.x}px"
					style:top="{playDraw.into.y}px"
					style:--ax={SHIFT[playDraw.into.align]}
				>
					<i>ƒ</i>{inside}<kbd>{settings.followCalls ? '→' : 'I'}</kbd>
				</div>
			{/if}
		{:else if playDraw?.beside}
			<div
				class="play-beside {step.kind}"
				style:left="{playDraw.beside.x}px"
				style:top="{playDraw.beside.y}px"
			>
				{#if step.choice}<i>{step.choice.label}</i>{/if}{step.text}
			</div>
		{/if}
		<PlayerBar
			{run}
			at={playAt}
			names={(id) => el(id)?.name ?? id}
			onjump={jump}
			onpick={pickBranch}
			over={view.play?.over ?? []}
			follow={settings.followCalls}
			onforward={forward}
			oninto={stepInto}
			onover={stepOver}
			onout={stepOut}
			onfollow={() => settings.setFollowCalls(!settings.followCalls)}
			onstop={stopPlay}
		/>
	{/if}
	{#if view.focused && !view.play}
		<FocusBar
			focus={view.focused}
			name={focusFlag
				? (design.model.elements.get(focusFlag.defs[0])?.name ?? view.focused.id)
				: view.focused.scenario
					? scenarioFocusName
					: (refLabel(changes.shown, view.focused.id) ?? '')}
			kind={focusFlag
				? 'flag'
				: view.focused.scenario
					? 'scenario'
					: changes.shown.fields.has(view.focused.id)
						? 'field'
						: focusedEl?.def.kind === 'module' && !focusedEl.parentId
							? 'system'
							: (focusedEl?.def.kind ?? 'model')}
			flag={focusFlag}
			onchange={setFocus}
			onleave={leaveFocus}
		/>
	{/if}
	{#if !shown}
		<p class="laying" role="status">Laying out the landscape…</p>
	{/if}
	{#if routingRun}
		<RoutingProgress
			count={unroutedCount}
			since={routingRun.since}
			expected={routingRun.expected}
		/>
	{/if}
	{#if search.open}
		<SearchPalette onpick={pick} onfocus={focusHit} onclose={() => (search.open = false)} />
	{/if}
	<ChangesPanel go={goTo} />
	{#if menu && editing}
		<EditMenu {...menu} onclose={() => (menu = null)} />
	{/if}
</div>

<style>
	.stage {
		position: absolute;
		inset: 0;
		background: var(--sdv-canvas-bg);
		cursor: grab;
		touch-action: none;
		user-select: none;
	}
	.stage.pointing {
		cursor: pointer;
	}
	/* Before the first layout comes in from the worker. */
	.laying {
		position: absolute;
		top: 50%;
		left: 50%;
		margin: 0;
		transform: translate(-50%, -50%);
		color: var(--ui-muted);
		font-size: 13px;
		pointer-events: none;
	}
	.stage:active {
		cursor: grabbing;
	}
	.controls {
		position: absolute;
		left: 15px;
		bottom: 15px;
		z-index: 5;
		display: flex;
		flex-direction: column;
		box-shadow: var(--ui-shadow);
	}
	.controls button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		padding: 5px;
		border: none;
		border-bottom: 1px solid var(--ui-border);
		background: var(--ui-panel, var(--ui-bg));
		color: var(--ui-text);
		cursor: pointer;
	}
	.controls button:hover {
		background: var(--ui-hover);
	}
	.controls button.on {
		color: var(--ui-accent);
	}
	.controls svg {
		width: 100%;
		height: 100%;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.canvas {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	.wedge {
		position: absolute;
		z-index: 9;
		width: 22px;
		height: 22px;
		margin: -11px 0 0 -11px;
		padding: 0;
		border: none;
		background: none;
		cursor: pointer;
	}
	.wedge svg {
		display: block;
		width: 100%;
		height: 100%;
		fill: var(--c);
		filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25));
	}
	.key .line {
		width: 100%;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.key .line:hover {
		background: color-mix(in srgb, var(--sdv-selection) 8%, transparent);
	}
	.key .line.off {
		color: var(--sdv-text-muted);
		text-decoration: line-through;
	}
	.key .line.off .ex {
		opacity: 0.35;
	}
	.key .hint {
		margin: 2px 12px 4px;
		font-size: 11px;
		line-height: 1.35;
		color: var(--sdv-text-muted);
	}
	.key {
		position: absolute;
		left: 52px;
		bottom: 15px;
		width: 236px;
		z-index: 10;
		box-sizing: border-box;
		padding-bottom: 4px;
		background: var(--sdv-model-fill);
		border: 1px solid var(--sdv-model-stroke);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
		color: var(--sdv-model-text);
		font-size: 12px;
	}
	.key h4 {
		margin: 0 0 4px;
		padding: 8px 12px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--sdv-text-muted);
		border-bottom: 1px solid var(--sdv-model-stroke);
	}
	.key .k {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 22px;
		padding: 2px 12px;
		/* Glyphs at their 12px size, centred in the 30px example column. */
		--glyph-opacity: 0.75;
	}
	.key .k > :global(.glyph) {
		width: 12px;
		height: 12px;
		margin: 0 9px;
		text-align: center;
	}
	.key .ex {
		width: 30px;
		height: 10px;
		flex: none;
		display: flex;
		justify-content: center;
	}
	.key .dashed {
		width: 24px;
		height: 12px;
		box-sizing: border-box;
		border: 1.5px dashed var(--sdv-kind-class);
		border-radius: 3px;
	}
	.key .sw {
		width: 22px;
		height: 14px;
		margin-left: auto;
		box-sizing: border-box;
		border: 1px solid var(--sdv-model-stroke);
	}
	/* Each kind's line and corner, as drawn on the canvas. */
	.key .sw.system {
		border: 1.5px solid var(--sdv-system-stroke);
		border-radius: 5px;
	}
	.key .sw.module {
		background: var(--sdv-module-fill);
		border-color: var(--sdv-module-stroke);
		border-radius: 4px;
	}
	.key .sw.class {
		border: 1.5px solid var(--sdv-kind-class);
		border-radius: 3px;
	}
	.key .sw.table {
		border: 1.5px solid var(--sdv-kind-table);
		border-radius: 1px;
		background: linear-gradient(
			to bottom,
			transparent 3px,
			var(--sdv-kind-table) 3px 4.5px,
			transparent 4.5px
		);
	}
	.key .sw.logic {
		width: 18px;
		height: 10px;
		margin-right: 2px;
		border-color: var(--sdv-kind-logic);
		border-radius: 4px;
		box-shadow:
			0 0 0 1.5px var(--sdv-model-fill),
			0 0 0 2.5px var(--sdv-kind-logic);
	}
	.key .sw.triggers {
		border: 1.5px solid var(--sdv-kind-trigger);
		border-radius: 2px;
		background: linear-gradient(
			to bottom,
			var(--sdv-kind-trigger-head) 3px,
			var(--sdv-kind-trigger) 3px 4.5px,
			transparent 4.5px
		);
	}
	.key .sw.file {
		border: 1.5px solid var(--sdv-kind-table);
		border-radius: 1px;
		background: linear-gradient(
			225deg,
			var(--sdv-model-fill) 4px,
			var(--sdv-kind-table) 4px 5.5px,
			transparent 5.5px
		);
	}
	.key .sw.channel {
		border: 1.5px solid var(--sdv-kind-channel);
		border-radius: 1px 7px 7px 1px;
	}
	.key .sw.api {
		border-color: var(--sdv-system-stroke);
		border-radius: 4px;
	}
	.key hr {
		border: none;
		border-top: 1px solid var(--sdv-model-stroke);
		margin: 4px 0;
	}
	/*
	 * As wide as its names, from 300 to 560 px (a unit's: its sequence, up to the canvas); prose
	 * wraps inside that width. At most the canvas tall: the header stays, the body scrolls.
	 */
	.inspector {
		position: absolute;
		z-index: 10;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		width: max-content;
		min-width: 300px;
		max-width: min(560px, var(--pane-room));
		max-height: var(--pane-tall);
		background: var(--sdv-model-fill);
		border: 1px solid var(--sdv-model-stroke);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
		color: var(--sdv-model-text);
		font-size: 13px;
	}
	.inspector.unit {
		max-width: var(--pane-room);
	}
	.inspector .pane-body {
		flex: 1;
		min-height: 0;
		overflow: auto;
		overscroll-behavior: contain;
	}
	.inspector.min > :not(header) {
		display: none;
	}
	/* Prose: never widens the card; wraps inside the width its names set. */
	.inspector .type,
	.inspector .entry .where,
	.inspector .note,
	.inspector .empty,
	.inspector .sig-note,
	.inspector .prose {
		contain: inline-size;
		overflow-wrap: anywhere;
	}
	.inspector .entry .where {
		align-self: stretch;
	}
	.inspector.min header {
		border-bottom: none;
	}
	.inspector header {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		padding: 10px 12px 8px;
		border-bottom: 1px solid var(--sdv-model-stroke);
		background: var(--sdv-model-fill);
	}
	.inspector .title {
		font-weight: 600;
		font-size: 14px;
		line-height: 20px;
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
		min-width: 0;
	}
	.inspector .constraint {
		display: flex;
		align-items: baseline;
		gap: 6px;
		padding: 2px 12px;
	}
	.inspector .constraint .badge {
		padding: 0 6px;
		line-height: 1.6;
		font-size: 11px;
		font-weight: 600;
		overflow-wrap: anywhere;
		background: var(--sdv-model-header);
		color: var(--sdv-text-muted);
	}
	/* An enum's values, one a line; the first 12, then Show more. */
	.inspector .values {
		list-style: none;
		margin: 2px 12px 4px 14px;
		padding: 2px 0 2px 8px;
		border-left: 2px solid var(--sdv-model-stroke);
		font-size: 12px;
		line-height: 1.55;
	}
	.inspector .values-sizer {
		height: 0;
		overflow: hidden;
		visibility: hidden;
		padding: 0 12px 0 24px;
		font-size: 12px;
	}
	.inspector .count {
		color: var(--sdv-text-muted);
		font-size: 12px;
		white-space: nowrap;
	}
	.inspector .more {
		margin: 0 12px 4px 24px;
		padding: 0;
		border: none;
		background: none;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: var(--sdv-selection);
		cursor: pointer;
	}
	.inspector .more:hover {
		text-decoration: underline;
	}
	.inspector .icon-btn {
		border: none;
		background: none;
		color: var(--sdv-text-muted);
		display: flex;
		cursor: pointer;
		/* 20px, the title's line, so the icon centres on it. */
		padding: 2px;
	}
	.inspector section {
		padding: 6px 0;
		border-top: 1px solid var(--sdv-model-stroke);
	}
	.inspector .pane-body > :global(:first-child) {
		border-top: none;
	}
	.inspector .dead-note {
		font-size: 11px;
		color: var(--sdv-text-muted);
	}
	.inspector .description {
		margin: 8px 12px;
		font-size: 12px;
		max-width: 360px;
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
	.inspector .writes .entry .text::before {
		color: var(--sdv-link-write);
	}
	.inspector .writes .entry:hover:not(:disabled) {
		border-left-color: var(--sdv-link-write);
	}
	.inspector .calls .entry .text::before {
		color: var(--sdv-link-call);
	}
	.inspector .calls .entry:hover:not(:disabled) {
		border-left-color: var(--sdv-link-call);
	}
	.inspector .fn {
		font-family: Georgia, serif;
		color: var(--sdv-kind-logic-icon);
	}
	/*
	 * A unit's Inputs, Returns and Fails: side by side when each fits in 220 px or more of the
	 * card's width, else stacked. They never widen the card: unitWidth makes room for the
	 * widest group.
	 */
	.inspector .signature {
		display: flex;
		flex-wrap: wrap;
		contain: inline-size;
		overflow: hidden;
	}
	.inspector .sig-group {
		flex: 1 0 auto;
		min-width: 220px;
		border-top: none;
		box-shadow: -1px 0 0 var(--sdv-model-stroke);
	}
	.inspector .sig-group.fails h4 {
		color: var(--sdv-method-put);
	}
	/* The type column takes the rest, so a description under a row spans the whole group. */
	.inspector .sig-rows {
		display: grid;
		grid-template-columns: max-content 1fr;
		column-gap: 14px;
		row-gap: 2px;
		padding: 0 12px 2px;
		line-height: 18px;
		align-items: baseline;
	}
	.inspector .sig-rows .name {
		font-weight: 500;
	}
	.inspector .sig-note {
		grid-column: 1 / -1;
		color: var(--sdv-text-muted);
		font-size: 12px;
		line-height: 16px;
		margin: -2px 0 3px;
	}
	.inspector .seq-section {
		border-top: 1px solid var(--sdv-model-stroke);
	}
	/* Closed up to 120 px a lane and still wider than the card: it scrolls sideways. */
	.inspector .seq-section.wide {
		overflow-x: auto;
	}
	/* A trigger's facts: one label column across its sections. */
	.inspector .facts {
		display: grid;
		/* Names set the width (max-content); prose fills what the pane has. */
		grid-template-columns: 80px minmax(max-content, 1fr);
		column-gap: 10px;
		row-gap: 2px;
		padding: 3px 12px 3px;
		line-height: 18px;
		align-items: baseline;
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
	/* The entry whose peek is open. */
	.inspector .entry.open {
		background: var(--sdv-row-self);
		border-left-color: var(--sdv-selection);
	}
	.inspector.peek {
		z-index: 11;
		box-shadow: 0 10px 32px rgba(0, 0, 0, 0.22);
	}
	.goto {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 0 8px;
		font: inherit;
		font-size: 12px;
		line-height: 20px;
		white-space: nowrap;
		color: var(--sdv-model-text);
		background: var(--sdv-model-fill);
		border: 1px solid var(--sdv-model-stroke);
		cursor: pointer;
	}
	.goto:hover {
		border-color: var(--sdv-selection);
	}
	/* A model or logic card in the peek: the canvas's card at full size, the peek's buttons
	   in its name bar. */
	.peek-card {
		position: absolute;
		height: var(--h);
		z-index: 11;
		box-shadow: 0 10px 32px rgba(0, 0, 0, 0.22);
	}
	.peek-card:has(> :global(.node.expanded)) {
		height: auto;
	}
	.peek-head {
		position: absolute;
		top: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0 6px;
	}
	.peek-head .icon-btn {
		border: none;
		background: none;
		color: var(--sdv-text-muted);
		display: flex;
		cursor: pointer;
		padding: 2px;
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
	/* An api body's fields: names, types and marks in columns shared by its rows. */
	.api-fields {
		display: grid;
		grid-template-columns: max-content max-content 1fr;
	}
	.api-field {
		display: grid;
		grid-column: 1 / -1;
		grid-template-columns: subgrid;
		gap: 8px;
		align-items: baseline;
		line-height: 18px;
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
		justify-self: end;
		color: var(--sdv-link-from);
	}
	.api-field .computed {
		font-style: italic;
	}
	/* One line tall and centred in it: an icon has no baseline to align by. */
	.api-field .untraced {
		justify-self: end;
		align-self: start;
		display: flex;
		align-items: center;
		height: 18px;
		color: var(--sdv-method-put);
	}
	.inspector .seq-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.inspector .play {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 1px 8px 1px 6px;
		border: 1px solid var(--sdv-model-stroke);
		background: var(--sdv-model-fill);
		color: var(--sdv-model-text);
		font: inherit;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0;
		cursor: pointer;
	}
	.inspector .play:hover {
		border-color: var(--sdv-selection);
		color: var(--sdv-selection);
	}
	.play-lines {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 9;
		pointer-events: none;
		overflow: visible;
	}
	.play-lines .line {
		fill: none;
		stroke-width: 2.5;
		stroke: var(--sdv-model-text);
	}
	.play-lines .head {
		fill: var(--sdv-model-text);
	}
	.play-lines .line.call {
		stroke: var(--sdv-link-call);
		stroke-dasharray: 2 4;
		stroke-linecap: round;
	}
	.play-lines .head.call {
		fill: var(--sdv-link-call);
	}
	.play-lines .line.read {
		stroke: var(--sdv-link-ref);
	}
	.play-lines .head.read {
		fill: var(--sdv-link-ref);
	}
	.play-lines .line.write {
		stroke: var(--sdv-link-write);
	}
	.play-lines .head.write {
		fill: var(--sdv-link-write);
	}
	.play-lines .line.gets,
	.play-lines .line.return,
	.play-lines .line.fail {
		stroke-dasharray: 6 4;
	}
	.play-lines .line.gets {
		stroke: var(--sdv-text-muted);
	}
	.play-lines .head.gets {
		fill: var(--sdv-text-muted);
	}
	.play-lines .line.fail {
		stroke: var(--sdv-method-put);
	}
	.play-lines .head.fail {
		fill: var(--sdv-method-put);
	}
	.play-lines.trail {
		opacity: 0.4;
	}
	.play-lines.trail .line {
		stroke-width: 1.5;
	}
	.play-num {
		position: absolute;
		z-index: 9;
		transform: translate(-50%, -50%);
		min-width: 20px;
		height: 20px;
		box-sizing: border-box;
		padding: 0 5px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font: inherit;
		font-size: 11px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		background: var(--sdv-canvas-bg);
		border: 1.5px solid var(--c);
		border-radius: 10px;
		color: var(--c);
		--c: var(--sdv-model-text);
		cursor: pointer;
	}
	button.play-num {
		opacity: 0.6;
	}
	button.play-num:hover {
		opacity: 1;
	}
	.play-num.now {
		pointer-events: none;
		background: var(--c);
		color: var(--sdv-canvas-bg);
	}
	.play-num.call {
		--c: var(--sdv-link-call);
	}
	.play-num.read {
		--c: var(--sdv-link-ref);
	}
	.play-num.write {
		--c: var(--sdv-link-write);
	}
	.play-num.gets {
		--c: var(--sdv-text-muted);
	}
	.play-num.fail {
		--c: var(--sdv-method-put);
	}
	.play-label,
	.play-edge,
	.play-beside {
		position: absolute;
		z-index: 9;
		pointer-events: none;
		white-space: nowrap;
		font-size: 12px;
		padding: 2px 8px;
		background: var(--sdv-canvas-bg);
		border: 1px solid currentColor;
		color: var(--sdv-model-text);
	}
	.play-label {
		transform: translate(var(--ax), calc(-100% - 6px));
	}
	.play-label b {
		margin-right: 0.3em;
	}
	.play-label.call {
		color: var(--sdv-link-call);
	}
	.play-label.read {
		color: var(--sdv-link-ref);
	}
	.play-label.write {
		color: var(--sdv-link-write);
	}
	.play-label.gets {
		color: var(--sdv-text-muted);
	}
	.play-label.fail {
		color: var(--sdv-method-put);
	}
	.play-edge {
		transform: translate(var(--ax), -50%);
		color: var(--sdv-text-muted);
		border-style: dashed;
	}
	.play-into {
		position: absolute;
		z-index: 9;
		pointer-events: none;
		white-space: nowrap;
		font-size: 12px;
		padding: 2px 8px;
		background: var(--sdv-canvas-bg);
		border: 1px dashed currentColor;
		color: var(--sdv-link-call);
		transform: translate(var(--ax), -50%);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.play-into i {
		font-family: Georgia, serif;
	}
	.play-into kbd {
		font: inherit;
		font-size: 11px;
		line-height: 16px;
		padding: 0 5px;
		border: 1px solid var(--ui-border);
		background: var(--ui-panel);
		color: var(--ui-muted);
	}
	.play-beside {
		transform: translateY(-50%);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.play-beside.choice {
		border-color: var(--sdv-selection);
	}
	.play-beside.note {
		font-style: italic;
		border-color: var(--sdv-model-stroke);
	}
	.play-beside i {
		font-style: normal;
		font-size: 11px;
		font-weight: 700;
		color: var(--sdv-selection);
	}
</style>
