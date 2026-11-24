<script lang="ts" module>
	import type { Lane } from '#lib/landscape/lanes.ts';
	import type { Point } from '#lib/landscape/route.ts';
	import type { Token } from '#lib/theme/tokens.ts';

	/** A line drawn on the WebGL layer, in canvas px; widths, dashes and marks in screen px. */
	export interface GlLine {
		id: string;
		points: Point[];
		width: number;
		color: Token;
		/** A dot or diamond where it leaves; an arrow where it arrives. */
		start?: 'dot' | 'diamond';
		arrow?: boolean;
		/** Width of the halo in the canvas colour under it and round its marks. */
		halo?: number;
		dash?: readonly [number, number];
		/** Faded, as lines at rest are while something is looked at. */
		dim?: boolean;
		/** Each segment's lane beside lines sharing its stretch (see lanes.ts). */
		lanes?: (Lane | undefined)[];
		/** Hover text. */
		title?: string;
		/** Depth of the box the line is in, -1 for none; lit lines go over everything. */
		depth: number;
	}

	/** What is under the pointer. */
	/** A name drawn in front of everything, at canvas px `x`, `y`, at most `max` px tall. */
	export interface FrontName {
		id: string;
		b: import('#lib/landscape/layout.ts').LandscapeBox;
		name: string;
		glyph: string;
		x: number;
		y: number;
		max: number;
	}

	export type GlHit =
		| { part: 'row'; box: string; id: string }
		| { part: 'api'; box: string; id: string }
		| { part: 'fold'; box: string }
		/** A card's name bar, a closed box, or an open box's name tab. */
		| { part: 'head'; box: string; card: boolean }
		/** Inside an open box, not on its name tab. */
		| { part: 'body'; box: string }
		/** A rail not listing its endpoints. */
		| { part: 'rail'; box: string };
</script>

<script lang="ts">
	import type { Container, Graphics } from 'pixi.js';
	import { getCamera } from '#lib/client/camera.svelte.ts';
	import { changes } from '#lib/client/changes.svelte.ts';
	import { theme } from '#lib/client/theme.svelte.ts';
	import type { ViewState } from '#lib/client/view-state.svelte.ts';
	import { RAIL, railRowY, type Rail } from '#lib/landscape/apis.ts';
	import {
		cardRows,
		cellRoom,
		constraintBadges,
		constraintsOf,
		fieldRowY,
		FOLD,
		foldable,
		HEADER,
		incomingCount,
		indexFields,
		indexKind,
		keysOf,
		kindWord,
		channelNote,
		channelWord,
		LEAF,
		LINK,
		logicNote,
		logicRowY,
		nameText,
		ownerNote,
		refLabel,
		shownRows,
		slotCount,
		TABLE,
		triggersNote,
		typeCell,
		type LandscapeBox,
		type Relations
	} from '#lib/landscape/layout.ts';
	import { NAME_MIN } from '#lib/landscape/open.ts';
	import type { Model } from '#lib/model/model.ts';
	import { methodToken, tokenValues } from '#lib/theme/tokens.ts';
	import { LineLayer, lineShader, tokenRgba } from './gl/lines.ts';
	import { lanePoints } from '#lib/landscape/lanes.ts';
	import { GlTextLayer, leadEm, LINE, type GlLabel } from './gl/text.ts';

	/**
	 * The landscape's boxes, rows and lines drawn on one WebGL canvas (PixiJS), which keeps its
	 * frame rate however much is drawn. It sits under everything the canvas carries over the
	 * landscape (cards, peeks, the player, the key), moved by the canvas's camera (see
	 * CanvasCamera). Nothing it draws is an element of the page, so the browser has nothing to
	 * restyle, lay out or hit-test as the view moves.
	 *
	 * It reads the view state (lit rows, the pick, rails listed, cards expanded, change marks),
	 * and `hitAt` tells the canvas what is under the pointer, so the canvas handles hover and
	 * clicks.
	 *
	 * Draw order is layering: lines at rest among the roots, each depth's boxes then the lines
	 * at rest among their children, names, rows, lit lines, outlines.
	 */
	let {
		boxes,
		boxById,
		rails,
		model,
		rels,
		view,
		rest,
		lit,
		dim,
		front,
		pointer
	}: {
		boxes: LandscapeBox[];
		boxById: Map<string, LandscapeBox>;
		rails: Map<string, Rail>;
		model: Model;
		rels: Relations;
		view: ViewState;
		rest: GlLine[];
		lit: GlLine[];
		/** While something is looked at: the boxes kept bright; the rest are toned down. */
		dim: Set<string> | undefined;
		/**
		 * Zoomed far out, open boxes' and closed rails' names drawn in front of everything, each
		 * clear of the others (see `namesShown` in LandscapeCanvas); none when they fit their boxes.
		 */
		front: FrontName[];
		/** What the pointer is over now, for a row's hover tint. */
		pointer: GlHit | null;
	} = $props();

	const viewport = getCamera();
	const DIM_OPACITY = 0.2;
	/** How faded dead code (see reachOf) is drawn. */
	const DEAD_ALPHA = 0.5;
	/** Names drawn in front keep this size on screen. */
	const NAME_PX = 13;
	/** The dots' spacing in canvas px, and the size their tile is drawn at. */
	const DOT_GAP = 20;
	const DOT_TILE = 64;
	/** The names drawn in front take over from open boxes' own. */
	const namesInFront = $derived(front.length > 0);

	let host: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let pixi: typeof import('pixi.js') | undefined = $state();
	let app: import('pixi.js').Application | undefined;
	/** What is drawn in canvas px, moved and scaled by the camera; the dots stay in screen px. */
	let world: Container | undefined;
	let dots: import('pixi.js').TilingSprite | undefined;
	let text: GlTextLayer | undefined;
	let failed = $state<string>();

	// ------------------------------------------------------------ PixiJS
	$effect(() => {
		let gone = false;
		let made: import('pixi.js').Application | undefined;
		void (async () => {
			try {
				const P = await import('pixi.js');
				const a = new P.Application();
				await a.init({
					canvas,
					resizeTo: host,
					antialias: true,
					autoDensity: true,
					resolution: devicePixelRatio,
					autoStart: false,
					preference: 'webgl',
					backgroundAlpha: 0
				});
				if (gone) return a.destroy();
				made = a;
				a.renderer.on('resize', () => request());
				world = new P.Container();
				a.stage.addChild(world);
				text = new GlTextLayer(P, a.renderer);
				app = a;
				pixi = P;
			} catch (e) {
				failed = String(e);
			}
		})();
		return () => {
			gone = true;
			made?.destroy(false, { children: true });
			lineShading = undefined;
			text?.destroy();
			text = undefined;
			app = undefined;
		};
	});

	const values = $derived(tokenValues(theme.current));
	/** A token as PixiJS takes it: a number and an alpha. */
	const colour = (t: Token) => {
		const c = new pixi!.Color(values[t]);
		return { color: c.toNumber(), alpha: c.alpha };
	};

	interface TextOpts {
		bold?: boolean;
		/** On an opaque fill, where page text gets subpixel antialiasing. */
		lcd?: boolean;
		/** An entity glyph before it (see EntityGlyph); with no text, the glyph alone. */
		glyph?: string;
		/** A change mark before it, on its badge. */
		op?: string;
		/** Space after the glyph and the mark, in em. */
		gap?: number;
		/** As the cards' `ƒ` marks (see CardPeek): italic, in Georgia. */
		serif?: boolean;
		/** The glyph's colour, over its kind's (an event on a channel wears the channel's). */
		glyphToken?: Token;
	}
	const SERIF = 'Georgia, serif';
	/** A card kind's glyph wears that kind's icon colour; the others the name's, at 75%. */
	const GLYPH_ICON: Record<string, Token> = {
		class: 'kind-class-icon',
		table: 'kind-table-icon',
		logic: 'kind-logic-icon',
		triggers: 'kind-trigger-icon',
		trigger: 'kind-trigger-icon',
		message: 'kind-trigger-icon',
		file: 'kind-table-icon',
		channel: 'kind-channel-icon',
		topic: 'kind-channel-icon',
		received: 'kind-trigger-icon',
		'dead-lettered': 'kind-trigger-icon',
		created: 'kind-trigger-icon',
		updated: 'kind-trigger-icon',
		deleted: 'kind-trigger-icon'
	};

	/**
	 * Text `px` px tall in token `t`, drawn by the browser at its size on screen (see gl/text.ts),
	 * with its glyph and change mark coloured as CardPeek colours them.
	 */
	function textOf(s: string, t: Token, px: number, o: TextOpts = {}): GlLabel {
		const c = colour(t);
		const icon = o.glyph ? (o.glyphToken ?? GLYPH_ICON[o.glyph]) : undefined;
		const opFill = colour('op-fill');
		const label = text!.label(s, {
			px,
			color: c.color,
			weight: o.bold ? 600 : 400,
			lcd: o.lcd,
			glyph: o.glyph,
			glyphColor: icon ? colour(icon).color : c.color,
			glyphAlpha: icon ? 1 : 0.75,
			op: o.op
				? {
						text: o.op,
						color: colour('op-text').color,
						fill: opFill.color,
						fillAlpha: opFill.alpha
					}
				: undefined,
			gap: o.gap,
			...(o.serif ? { italic: true, family: SERIF } : {})
		});
		if (s || !o.glyph) label.alpha = c.alpha;
		return label;
	}

	// ------------------------------------------------------------ the scene
	interface Name {
		text: GlLabel;
		b: LandscapeBox;
		kind: 'group' | 'card' | 'leaf' | 'rail';
		/** Its width per px of font size. */
		w: number;
		/** Its alpha before toning down. */
		alpha: number;
		/** Where it was last drawn, in canvas px, for hit testing a name tab. */
		at?: { x0: number; y0: number; x1: number; y1: number };
	}
	/* eslint-disable svelte/prefer-svelte-reactivity -- the scene is drawn, not read: not state */
	let names: Name[] = [];
	let nameOf = new Map<string, Name>();
	let lineLayers = new Map<number, LineLayer>();
	let litLayer: LineLayer | undefined;
	/** The lines' shader, made once per renderer. */
	let lineShading: import('pixi.js').Shader | undefined;
	let rowLayer: Container | undefined;
	/**
	 * Rows' texts, over all rows' tints and rules, so they are drawn in one batch; expanded cards'
	 * rows and texts go over the rest, as they cover what is below them.
	 */
	let rowTextLayer: Container | undefined;
	let overLayer: Container | undefined;
	let overTextLayer: Container | undefined;
	let outlineLayer: Graphics | undefined;
	/** The row under the pointer, tinted over its card's rows. */
	let hoverLayer: Graphics | undefined;
	let badgeLayer: Container | undefined;
	/** Names drawn in front of everything while zoomed far out, by name id. */
	let frontLayer: Container | undefined;
	let frontOf = new Map<
		string,
		{
			m: FrontName;
			c: Container;
			bg: Graphics;
			text: GlLabel;
			rail: boolean;
			/** Its backing, in canvas px, for hit testing. */
			at?: { x: number; y: number; w: number; h: number };
		}
	>();
	/** Cards and rails drawing their rows, by box id (`rail:` for a rail), and what they drew. */
	let rowsOf = new Map<string, Rows & { sig: string; b: LandscapeBox }>();
	let depthCache = new Map<string, number>();
	/* eslint-enable svelte/prefer-svelte-reactivity */

	const depthOf = (b: LandscapeBox): number => {
		let d = depthCache.get(b.id);
		if (d !== undefined) return d;
		d = b.parentId ? depthOf(boxById.get(b.parentId)!) + 1 : 0;
		depthCache.set(b.id, d);
		return d;
	};
	const isCard = (b: LandscapeBox) => !!(b.table || b.logic || b.triggers || b.channel);
	type KindToken = 'kind-class' | 'kind-table' | 'kind-logic' | 'kind-trigger' | 'kind-channel';
	const kindToken = (b: LandscapeBox): KindToken =>
		b.logic
			? 'kind-logic'
			: b.triggers
				? 'kind-trigger'
				: b.channel
					? 'kind-channel'
					: b.view === 'table'
						? 'kind-table'
						: 'kind-class';
	const elOf = (b: LandscapeBox) => model.elements.get(b.elementId);
	const isSystem = (b: LandscapeBox) => {
		const el = elOf(b);
		return !b.boundary && el?.def.kind === 'module' && !el.parentId;
	};

	// Change marks while a scenario or commit is compared, as CardPeek draws them.
	const marks = $derived(changes.marks);
	const comparing = $derived(!!changes.comparison);
	const level = (id: string) => {
		const l = marks.level.get(id);
		return l === 'breaking' || l === 'check' ? l : undefined;
	};
	const marked = (id: string) =>
		marks.glyph.has(id) || (marks.level.has(id) && marks.level.get(id) !== 'stopped');
	/** How much of a box shows while a scenario or commit is compared: unchanged ones fade. */
	const fadedOf = (b: LandscapeBox) =>
		comparing && !b.group && !marks.rollup.get(b.elementId) ? 0.45 : 1;
	/**
	 * How much of a box shows while something is looked at: toned down when not related. Set
	 * on what is drawn (see `applyDim`), never drawn anew, so looking at something costs a loop.
	 */
	const dimOf = (id: string) => (dim && !dim.has(id) ? DIM_OPACITY : 1);
	/** Each box's own graphics, so it can be toned down alone. */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- the scene is drawn, not read
	let boxGfx = new Map<string, Graphics>();
	function applyDim() {
		for (const [id, g] of boxGfx) g.alpha = dimOf(id);
		for (const n of names) n.text.alpha = n.alpha * dimOf(n.b.id);
		for (const r of rowsOf.values()) r.c.alpha = r.t.alpha = fadedOf(r.b) * dimOf(r.b.id);
		for (const badge of badgeLayer?.children ?? []) badge.alpha = dimOf(badge.label);
	}

	/** Boxes, names and badges, layer by layer; lines are drawn as they change, rows and outlines per frame. */
	function build() {
		const P = pixi!;
		const stage = world!;
		for (const child of stage.removeChildren()) child.destroy({ children: true });
		// The canvas's dots, 20 canvas px apart and 1 across: one tile, repeated and scaled with
		// the zoom.
		dots?.destroy({ texture: true, textureSource: true });
		const tile = document.createElement('canvas');
		tile.width = tile.height = DOT_TILE;
		const ctx = tile.getContext('2d')!;
		ctx.fillStyle = values.grid;
		ctx.beginPath();
		ctx.arc(DOT_TILE / 2, DOT_TILE / 2, (DOT_TILE / DOT_GAP) * 0.5, 0, 2 * Math.PI);
		ctx.fill();
		dots = new P.TilingSprite({
			texture: P.Texture.from({ resource: tile, autoGenerateMipmaps: true }),
			width: app!.screen.width,
			height: app!.screen.height
		});
		app!.stage.addChildAt(dots, 0);
		for (const l of lineLayers.values()) l.destroy();
		litLayer?.destroy();
		const shading = (lineShading ??= lineShader(P, app!.renderer.resolution));
		names = [];
		nameOf = new Map();
		lineLayers = new Map();
		rowsOf = new Map();
		depthCache = new Map();
		boxGfx = new Map();
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and used here
		const byDepth = new Map<number, LandscapeBox[]>();
		for (const b of boxes) {
			const d = depthOf(b);
			byDepth.set(d, [...(byDepth.get(d) ?? []), b]);
		}
		const lineLayer = (d: number) => {
			const l = new LineLayer(P, shading);
			lineLayers.set(d, l);
			stage.addChild(l.mesh);
		};
		lineLayer(-1);
		const deepest = Math.max(-1, ...byDepth.keys());
		for (let d = 0; d <= deepest; d++) {
			const layer = new P.Container();
			stage.addChild(layer);
			for (const b of byDepth.get(d) ?? []) {
				const g = new P.Graphics();
				drawBox(g, b);
				layer.addChild(g);
				boxGfx.set(b.id, g);
			}
			lineLayer(d);
		}
		const nameLayer = new P.Container();
		stage.addChild(nameLayer);
		for (const b of boxes) {
			const el = elOf(b);
			const name = b.logic ? 'Logic' : b.triggers ? 'Triggers' : (el?.name ?? b.id);
			const op = marks.glyph.get(b.elementId);
			const tok: Token = isCard(b)
				? (`${kindToken(b)}-text` as Token)
				: b.boundary
					? 'boundary-text'
					: isSystem(b)
						? 'system-text'
						: 'module-text';
			const kind = b.group ? 'group' : isCard(b) ? 'card' : 'leaf';
			// The mark of what it is: a system, module, class (a boundary is the model it holds),
			// stored table or file, logic, triggers or channel card.
			const glyph = b.logic
				? 'logic'
				: b.triggers
					? 'triggers'
					: b.channel
						? el?.def.type === 'topic'
							? 'topic'
							: 'channel'
						: b.table
							? b.view === 'table'
								? b.files
									? 'file'
									: 'table'
								: 'class'
							: b.boundary
								? 'class'
								: isSystem(b)
									? 'system'
									: 'module';
			const text = textOf(name, tok, NAME_MIN, {
				bold: true,
				lcd: isCard(b) && fadedOf(b) === 1,
				glyph,
				op
			});
			text.alpha *= fadedOf(b);
			text.cullable = true;
			nameLayer.addChild(text);
			const n: Name = { text, b, kind, w: text.width / text.px, alpha: text.alpha };
			names.push(n);
			nameOf.set(b.id, n);
		}
		for (const [id] of rails) {
			const b = boxById.get(id)!;
			const text = textOf('APIs', 'api-text', NAME_MIN, {
				bold: true,
				lcd: fadedOf(b) === 1,
				glyph: 'api'
			});
			text.alpha *= fadedOf(b);
			nameLayer.addChild(text);
			const n: Name = { text, b, kind: 'rail', w: text.width / text.px, alpha: text.alpha };
			names.push(n);
			nameOf.set(`rail:${id}`, n);
		}
		rowLayer = new P.Container();
		rowTextLayer = new P.Container();
		overLayer = new P.Container();
		overTextLayer = new P.Container();
		stage.addChild(rowLayer, rowTextLayer, overLayer, overTextLayer);
		hoverLayer = new P.Graphics();
		stage.addChild(hoverLayer);
		litLayer = new LineLayer(P, shading);
		stage.addChild(litLayer.mesh);
		outlineLayer = new P.Graphics();
		stage.addChild(outlineLayer);
		badgeLayer = new P.Container();
		stage.addChild(badgeLayer);
		frontLayer = new P.Container();
		stage.addChild(frontLayer);
		frontOf = new Map();
		dimDirty = true;
		// One count per closed box: what changed or is affected inside, in the worst severity.
		for (const b of boxes) {
			const roll = marks.rollup.get(b.elementId);
			if (!roll || b.group) continue;
			const badge = new P.Container();
			badge.label = b.id;
			const g = new P.Graphics();
			const fill =
				roll.level === 'breaking' ? 'sev-break' : roll.level === 'check' ? 'sev-check' : 'op-fill';
			g.roundRect(-11, -11, Math.max(22, 10 + 7 * String(roll.count).length), 22, 11).fill(
				colour(fill)
			);
			const t = textOf(String(roll.count), 'op-text', 12, { bold: true, lcd: true });
			t.position.set(
				-t.width / 2 + (Math.max(22, 10 + 7 * String(roll.count).length) - 22) / 2,
				-7.5
			);
			badge.addChild(g, t);
			badgeLayer.addChild(badge);
		}
	}

	/** How far a file's corner is folded, in canvas px. */
	const FOLD_CORNER = 14;
	/**
	 * A card's outline as a path: rounded by `r`; a channel's 3 px where messages come in (left)
	 * and round where they leave (right), a pipe; a file's top right corner cut for its fold.
	 */
	function cardShape(g: Graphics, b: LandscapeBox, r: number): Graphics {
		const [x, y, w, h] = [b.absX, b.absY, b.width, b.height];
		if (b.channel) {
			const [l, rr] = [3, Math.min(18, h / 2)];
			return g
				.moveTo(x + l, y)
				.lineTo(x + w - rr, y)
				.arcTo(x + w, y, x + w, y + rr, rr)
				.lineTo(x + w, y + h - rr)
				.arcTo(x + w, y + h, x + w - rr, y + h, rr)
				.lineTo(x + l, y + h)
				.arcTo(x, y + h, x, y + h - l, l)
				.lineTo(x, y + l)
				.arcTo(x, y, x + l, y, l)
				.closePath();
		}
		if (b.files)
			return g
				.moveTo(x + r, y)
				.lineTo(x + w - FOLD_CORNER, y)
				.lineTo(x + w, y + FOLD_CORNER)
				.lineTo(x + w, y + h - r)
				.arcTo(x + w, y + h, x + w - r, y + h, r)
				.lineTo(x + r, y + h)
				.arcTo(x, y + h, x, y + h - r, r)
				.lineTo(x, y + r)
				.arcTo(x, y, x + r, y, r)
				.closePath();
		return g.roundRect(x, y, w, h, r);
	}

	function drawBox(g: Graphics, b: LandscapeBox) {
		const a = fadedOf(b);
		const fill = (t: Token) => {
			const c = colour(t);
			return { ...c, alpha: c.alpha * a };
		};
		const line = (t: Token, width = 1) => ({ ...fill(t), width, pixelLine: width === 1 });
		if (isCard(b)) {
			const k = kindToken(b);
			const r = b.logic ? 10 : b.triggers ? 6 : b.view === 'table' ? 3 : 8;
			// A logic card's ring, as CardPeek's box-shadow: 2 px of the card's fill outside
			// its line, then 1 px in its kind's colour.
			if (b.logic)
				g.roundRect(b.absX - 1, b.absY - 1, b.width + 2, b.height + 2, r + 1)
					.stroke({ ...fill('model-fill'), width: 2 })
					.roundRect(b.absX - 2.5, b.absY - 2.5, b.width + 5, b.height + 5, r + 2.5)
					.stroke({ ...fill(k), width: 1 });
			cardShape(g, b, r).fill(fill('model-fill')).stroke(line(k));
			// A file's folded corner, in its kind's soft colour under the line.
			if (b.files)
				g.moveTo(b.absX + b.width - FOLD_CORNER, b.absY)
					.lineTo(b.absX + b.width - FOLD_CORNER, b.absY + FOLD_CORNER)
					.lineTo(b.absX + b.width, b.absY + FOLD_CORNER)
					.closePath()
					.fill(fill(`${k}-soft` as Token))
					.stroke(line(k));
			if (b.triggers)
				g.rect(b.absX + 1, b.absY + 1, b.width - 2, TABLE.head - 1).fill(fill('kind-trigger-head'));
			g.moveTo(b.absX, b.absY + TABLE.head)
				.lineTo(b.absX + b.width, b.absY + TABLE.head)
				.stroke(line(b.view === 'table' || b.triggers ? k : (`${k}-soft` as Token)));
		} else if (b.boundary) {
			g.roundRect(b.absX, b.absY, b.width, b.height, 10).stroke(line('boundary-stroke'));
		} else {
			const pre = isSystem(b) ? 'system' : 'module';
			g.roundRect(b.absX, b.absY, b.width, b.height, isSystem(b) ? 14 : 10)
				.fill(fill(`${pre}-fill`))
				.stroke(line(`${pre}-stroke`));
		}
		const r = rails.get(b.id);
		if (r)
			g.roundRect(b.absX + b.width - r.width / 2, b.absY + r.top, r.width, r.height, 14)
				.fill(fill('api-fill'))
				.stroke(line('api-stroke'));
	}

	// ------------------------------------------------------------ lines
	/**
	 * Lines at rest into the layers between the boxes of their depth, lit lines into theirs.
	 * Widths, dashes and heads keep their size on screen in the lines' shader (see gl/lines.ts),
	 * so the camera moving redraws no line.
	 */
	function drawRest() {
		const rgba = tokenRgba(pixi!, values);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and used here
		const byLayer = new Map<number, GlLine[]>();
		for (const l of rest) {
			const d = lineLayers.has(l.depth) ? l.depth : -1;
			const list = byLayer.get(d);
			if (list) list.push(l);
			else byLayer.set(d, [l]);
		}
		for (const [d, layer] of lineLayers) layer.set(byLayer.get(d) ?? [], rgba);
	}
	function drawLit() {
		litLayer?.set(lit, tokenRgba(pixi!, values));
	}

	// ------------------------------------------------------------ names
	const clamp = (lo: number, v: number, hi: number) => Math.max(lo, Math.min(v, Math.max(lo, hi)));

	/**
	 * Names keep NAME_MIN px on screen as the view zooms out, never past what their box has room
	 * for; an open box's sits in its top-left corner (the canvas draws it in front while zoomed
	 * far out), a card's in its name bar while its rows show, else across it.
	 */
	function placeNames(z: number) {
		for (const n of names) {
			const { b, text } = n;
			const fit = (w: number, h: number) => Math.max(0, Math.min(w / n.w, h));
			let px: number;
			let x: number;
			let y: number;
			if (n.kind === 'rail') {
				const r = rails.get(b.id)!;
				const listed = rowsOf.has(`rail:${b.id}`);
				text.visible = !listed;
				if (listed) continue;
				const room = fit(r.width - 8, r.height * 0.6);
				px = clamp(Math.min(RAIL.font, room), NAME_MIN / z, room);
				x = b.absX + b.width - (n.w * px) / 2;
				y = b.absY + r.top + r.height / 2 - 0.6 * px;
			} else if (n.kind === 'group') {
				px = Math.min(13 / z, HEADER / 2, fit(b.width - 24, Infinity));
				x = b.absX + 0.6 * px;
				y = b.absY + 0.35 * px;
				text.visible = !namesInFront;
			} else if (n.kind === 'card' && rowsOf.has(b.id)) {
				px = clamp(
					TABLE.title,
					NAME_MIN / z,
					Math.min(fit(b.width - 2 * TABLE.pad - 60, 99), TABLE.head / 2.2)
				);
				x = b.absX + TABLE.pad;
				y = b.absY + TABLE.head * 0.36 - 0.6 * px;
			} else {
				const room = b.width - (rails.get(b.id)?.width ?? 0) / 2 - 16;
				px = clamp(n.kind === 'card' ? TABLE.title : 15, NAME_MIN / z, fit(room, b.height * 0.6));
				const w = n.w * px;
				x = b.absX + (room + 16 - w) / 2;
				y = b.absY + (b.height - LINE * px) / 2;
			}
			text.px = px;
			text.position.set(x, y);
			if (n.kind !== 'group' && n.kind !== 'rail') text.visible = px * z >= 2;
			// Below 9 px on screen a glyph cannot be read: a closed box's and an open box's glyph
			// fade out by their font's base size on screen.
			if (n.kind === 'leaf') text.glyphFade = clamp(0, LEAF.font * z - 8, 1);
			else if (n.kind === 'group') text.glyphFade = clamp(0, Math.min(13, (HEADER / 2) * z) - 8, 1);
			n.at = {
				x0: x - 4 / z,
				y0: y - 2 / z,
				x1: x + n.w * px + 4 / z,
				y1: y + 1.3 * px
			};
		}
		// Badges keep their size on screen, on the box's top-right corner.
		for (const badge of badgeLayer?.children ?? []) {
			const b = boxById.get(badge.label)!;
			badge.scale.set(1 / z);
			badge.position.set(b.absX + b.width - 2 / z, b.absY + 2 / z);
		}
	}

	/**
	 * Names in front (see LandscapeCanvas's `namesShown`): NAME_PX on screen (13), never past
	 * `max`, on a backing in the canvas colour in an open box's top-left corner, or a rail's,
	 * framed like a rail, on the rail's middle. Kept while shown, dropped when not.
	 */
	function placeFront(z: number) {
		const P = pixi!;
		const want = new Set(front.map((m) => m.id));
		for (const [id, f] of frontOf)
			if (!want.has(id)) {
				f.c.destroy({ children: true });
				frontOf.delete(id);
			}
		for (const m of front) {
			let f = frontOf.get(m.id);
			if (!f) {
				const rail = m.glyph === 'api';
				const c = new P.Container();
				const bg = new P.Graphics();
				const text = textOf(m.name, rail ? 'api-text' : 'system-text', NAME_PX, {
					bold: true,
					glyph: m.glyph
				});
				c.addChild(bg, text);
				frontLayer!.addChild(c);
				f = { m, c, bg, text, rail };
				frontOf.set(m.id, f);
			}
			f.m = m;
			const px = Math.min(NAME_PX / z, m.max);
			f.text.px = px;
			const w = f.text.width;
			const h = LINE * px;
			const padX = (f.rail ? 0.4 : 0.3) * px;
			const at = f.rail
				? { x: m.x - w / 2 - padX, y: m.y - h / 2, w: w + 2 * padX, h }
				: { x: m.x + 0.3 * px, y: m.y + 0.4 * px, w: w + 2 * padX, h };
			f.at = at;
			f.bg.clear();
			const back = colour(f.rail ? 'api-fill' : 'canvas-bg');
			f.bg.roundRect(at.x, at.y, at.w, at.h, 0.3 * px).fill({
				...back,
				alpha: back.alpha * (f.rail ? 1 : 0.85)
			});
			if (f.rail) f.bg.stroke({ ...colour('system-stroke'), width: 1, pixelLine: true });
			f.text.position.set(at.x + padX, at.y + 0.1 * px);
			f.c.alpha = dimOf(m.b.id);
		}
	}

	// ------------------------------------------------------------ rows
	/** A card's rows show while it reads near the screen, or is looked at; a rail's as well, or hovered. */
	const cardFull = (id: string) => !!view.near[id] || !!view.full[id];
	const railListed = (id: string) => view.railHover === id || cardFull(id);

	/**
	 * Rows' text is drawn once it is this many px tall on screen. A box drawn in full far out
	 * (looked at, or at the end of a lit line) keeps its rows' tints and marks, which show where
	 * lines end, without thousands of texts smaller than a pixel.
	 */
	const TEXT_MIN = 2;
	/** Whether the rows being built draw their text (see TEXT_MIN). */
	let readable = true;
	/** A text not drawn, sized as if it were, so what is placed after it lands where it would. */
	const stub = (x: number, s: string, px: number, o: TextOpts) => {
		const advance = text!.measure(s, o.bold ? 600 : 400, px);
		return { x, width: leadEm(o) * px + advance, advance, alpha: 1 } as unknown as GlLabel;
	};
	/** Badges, as CardPeek's `.badge`: 1.6 lines of TABLE.badge tall, 6 px each side. */
	const BADGE_H = 1.6 * TABLE.badge;
	/** A cell's items are this far apart (CardPeek's `.cell` gap), in em of a row's text. */
	const CELL_GAP = TABLE.badgeGap / TABLE.row;

	function placeRows(z: number) {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and used here
		const want = new Map<string, string>();
		for (const b of boxes)
			if (isCard(b) && cardFull(b.id))
				want.set(
					b.id,
					JSON.stringify([
						!!view.expanded[b.id],
						view.hot[b.id] ?? null,
						view.field?.box === b.id ? view.field.field : '',
						view.flash?.box === b.id ? view.flash.field : '',
						view.apiDim[b.id] ?? null,
						view.apiBoxes[b.id] ?? null,
						fadedOf(b),
						TABLE.row * z >= TEXT_MIN
					])
				);
		for (const [id] of rails)
			if (railListed(id)) {
				const apis = rails.get(id)!.groups.flatMap((g) => g.apis);
				want.set(
					`rail:${id}`,
					JSON.stringify([
						apis.filter((a) => view.hotApis[a]),
						apis.includes(view.api ?? '') ? view.api : '',
						fadedOf(boxById.get(id)!),
						RAIL.font * rails.get(id)!.scale * z >= TEXT_MIN
					])
				);
			}
		for (const [id, r] of rowsOf)
			if (want.get(id) !== r.sig) {
				r.c.destroy({ children: true });
				r.t.destroy({ children: true });
				rowsOf.delete(id);
			}
		for (const [id, sig] of want) {
			if (rowsOf.has(id)) continue;
			const b = boxById.get(id.startsWith('rail:') ? id.slice(5) : id)!;
			const rail = id.startsWith('rail:');
			readable = JSON.parse(sig).at(-1);
			const { c, t } = rail ? railRows(b) : cardRowsOf(b);
			c.alpha = t.alpha = fadedOf(b) * dimOf(b.id);
			const over = !rail && !!view.expanded[b.id];
			(over ? overLayer : rowLayer)!.addChild(c);
			(over ? overTextLayer : rowTextLayer)!.addChild(t);
			rowsOf.set(id, { c, t, sig, b });
		}
	}

	/**
	 * A row's tint by how it is lit, as CardPeek's rows: flash, self or picked, lit. The row
	 * under the pointer is tinted apart (see `drawHover`), so hovering rebuilds no rows.
	 */
	function rowState(box: string, id: string) {
		const hot = view.hot[box]?.[id];
		const picked = view.field?.box === box && view.field.field === id;
		const flash = view.flash?.box === box && view.flash.field === id;
		const bg: Token | undefined = flash
			? 'row-flash'
			: hot === 'self' || picked
				? 'row-self'
				: hot === 'peer'
					? 'row-peer'
					: undefined;
		const bar: Token | undefined =
			hot === 'self' || picked
				? 'selection'
				: hot === 'caller'
					? 'link-call'
					: level(id) === 'breaking'
						? 'sev-break'
						: level(id) === 'check'
							? 'sev-check'
							: undefined;
		return { bg, bar };
	}

	/**
	 * A row's ground, `w` × `h` at `x`, `y`, `k` canvas px to the row's px (a rail's rows are
	 * scaled): its tint by how it is lit, else as CardPeek's `.gone` (hatched) when dropped,
	 * else as `.sev-break` or `.sev-check` (its severity at 8 or 9%).
	 */
	function ground(
		g: Graphics,
		id: string,
		bg: Token | undefined,
		x: number,
		y: number,
		w: number,
		h: number,
		k = 1
	) {
		if (bg) g.rect(x, y, w, h).fill(colour(bg));
		else if (marks.dropped.has(id)) hatch(g, x, y, w, h, k);
		else if (level(id)) {
			const breaking = level(id) === 'breaking';
			const c = colour(breaking ? 'sev-break' : 'sev-check');
			g.rect(x, y, w, h).fill({ ...c, alpha: c.alpha * (breaking ? 0.08 : 0.09) });
		}
	}

	/**
	 * `.gone`'s hatching: 1 px lines 7 px apart across a 135° gradient from the top-left
	 * corner, in the lines' colour at 12%; `k` canvas px to the row's px.
	 */
	function hatch(g: Graphics, x: number, y: number, w: number, h: number, k = 1) {
		const c = colour('edge');
		// Along the gradient, a stripe from 6 to 7 px of every 7; its line is x + y = d.
		const step = 7 * k * Math.SQRT2;
		for (let d = 6.5 * k * Math.SQRT2; d < w + h; d += step) {
			const u0 = Math.max(0, d - h);
			const u1 = Math.min(w, d);
			g.moveTo(x + u0, y + d - u0).lineTo(x + u1, y + d - u1);
		}
		g.stroke({ ...c, alpha: c.alpha * 0.12, width: k });
	}

	/** A card's or rail's rows: tints and rules, and texts (see rowTextLayer). */
	interface Rows {
		c: Container;
		t: Container;
	}

	function cardRowsOf(b: LandscapeBox): Rows {
		const P = pixi!;
		const out = new P.Container();
		const words = new P.Container();
		const g = new P.Graphics();
		out.addChild(g);
		const lcd = fadedOf(b) === 1;
		const at = (s: string, x: number, y: number, px: number, t: Token, o: TextOpts = {}) => {
			if (!readable) return stub(x, s, px, o);
			const text = textOf(s, t, px, { lcd, ...o });
			text.position.set(x, y - (px * LINE) / 2);
			words.addChild(text);
			return text;
		};
		const k = kindToken(b);
		const rule = { ...colour(`${k}-soft`), width: 1, pixelLine: true };
		const sep = (y: number) =>
			g
				.moveTo(b.absX + 1, y)
				.lineTo(b.absX + b.width - 1, y)
				.stroke(rule);
		/** The rule between two columns, from `y0` to `y1`, as a cell's left border. */
		const divider = (x: number, y0: number, y1: number) =>
			g.moveTo(x, y0).lineTo(x, y1).stroke(rule);
		const tint = (y: number, h: number, t: Token) =>
			g.rect(b.absX + 1, y, b.width - 2, h).fill(colour(t));
		const bar = (y: number, h: number, t: Token) => g.rect(b.absX + 1, y, 3, h).fill(colour(t));
		/** A badge at `x` on line `y`: a key's, or `plain` (constraints, an index's kind); its width. */
		const badge = (s: string, x: number, y: number, plain: boolean, into?: GlLabel[]) => {
			const t = at(s, x + 6, y, TABLE.badge, plain ? 'text-muted' : 'model-key-text', {
				bold: true
			});
			g.rect(x, y - BADGE_H / 2, t.width + 12, BADGE_H).fill(
				colour(plain ? 'model-header' : 'model-key-fill')
			);
			into?.push(t);
			return t.width + 12;
		};
		/** A line through a gone row's name, not its glyph or mark. */
		const strike = (t: GlLabel, y: number) =>
			g
				.moveTo(t.x + t.width - t.advance, y)
				.lineTo(t.x + t.width, y)
				.stroke({ ...colour('text-muted'), width: 1, pixelLine: true });
		const rowsH = TABLE.rowHeight;
		const rows = cardRows(b);
		const el = elOf(b);
		// The name bar's kind word and note; the name is drawn with the others (see placeNames).
		if (b.table || b.channel) {
			// In the kind's name colour at 75%, as CardPeek's `.kind-word`.
			const word = at(
				b.channel ? channelWord(el?.def.type) : kindWord(b.view ?? 'class', b.files),
				0,
				b.absY + TABLE.head * 0.36,
				TABLE.label,
				`${k}-text` as Token,
				{ bold: true }
			);
			// Clear of a channel's round end and a file's fold.
			word.x =
				b.absX + b.width - TABLE.pad - word.width - (b.channel ? 6 : b.files ? FOLD_CORNER - 4 : 0);
			word.alpha *= 0.75;
		}
		const owner = b.ref ? model.elements.get(el?.parentId ?? '')?.name : undefined;
		const parts = view.apiBoxes[b.id];
		const note = rows
			? b.logic
				? logicNote(rows.length)
				: b.channel
					? channelNote(model, b.elementId)
					: triggersNote(rows.length)
			: [ownerNote(owner), parts?.join(', ')].filter(Boolean).join(' · ');
		if (note)
			at(
				note,
				b.absX + TABLE.pad,
				b.absY + TABLE.head * 0.74,
				TABLE.note,
				parts ? 'link-ref' : 'text-muted'
			);
		if (rows) {
			const nameW = (b.logic ?? b.triggers ?? b.channel)!.cols[0].width;
			const top0 = b.absY + 1 + TABLE.head;
			rows.forEach((r, i) => {
				if (changes.hidden.has(r.id)) return;
				const y = b.absY + logicRowY(i);
				const top = y - rowsH / 2;
				const s = rowState(b.id, r.id);
				ground(g, r.id, s.bg, b.absX + 1, top, b.width - 2, rowsH);
				if (s.bar) bar(top, rowsH, s.bar);
				if (i) sep(top);
				// A unit's ƒ (10 px wide), a trigger's clock, envelope or event, or a port's event,
				// then its mark and name. A port nothing listens to is muted.
				const x = b.absX + TABLE.pad;
				const mark = b.logic
					? at('ƒ', x, y, TABLE.row, 'kind-logic-icon', { serif: true })
					: at('', x, y, TABLE.row, 'model-text', {
							glyph: r.glyph ?? 'trigger',
							glyphToken: b.channel ? 'kind-channel-icon' : undefined
						});
				const name = at(
					r.name,
					x + (b.logic ? 10 : mark.width) + TABLE.badgeGap,
					y,
					TABLE.row,
					r.idle || r.dead ? 'text-muted' : 'model-text',
					{ op: marks.glyph.get(r.id), gap: CELL_GAP }
				);
				const sig = at(r.signature, b.absX + nameW + TABLE.pad, y, TABLE.signature, 'text-muted');
				if (r.idle) mark.alpha *= 0.6;
				// Dead code stays where it is, faded, so it is seen and not mistaken for live code.
				if (r.dead) for (const t of [mark, name, sig]) t.alpha *= DEAD_ALPHA;
				if (comparing && !marked(r.id)) for (const t of [mark, name, sig]) t.alpha *= 0.38;
				if (marks.dropped.has(r.id)) strike(name, y);
			});
			// The name column's rule, down every row.
			divider(b.absX + nameW, top0, top0 + rows.length * rowsH);
			return { c: out, t: words };
		}
		const fields = b.fields ?? [];
		const expanded = !!view.expanded[b.id];
		const foldAt = b.foldAt ?? FOLD;
		const n = shownRows(fields.length, expanded, foldAt);
		const cols = b.table ?? [];
		// Expanded, a card keeps its laid-out size and draws over whatever is below it.
		const bottom =
			b.absY +
			fieldRowY(n, fields.length, true, Number.MAX_SAFE_INTEGER) +
			(foldable(fields.length, foldAt) ? rowsH / 2 : -rowsH / 2) +
			2;
		if (expanded && bottom > b.absY + b.height)
			g.roundRect(b.absX, b.absY + TABLE.head, b.width, bottom - b.absY - TABLE.head, 3)
				.fill(colour('model-fill'))
				.stroke({ ...colour(k), width: 1, pixelLine: true });
		const xs: number[] = [];
		cols.reduce((x, c) => (xs.push(x), x + c.width), b.absX);
		const headY = b.absY + 1 + TABLE.head + rowsH / 2;
		// The column labels' row, on the header fill.
		tint(headY - rowsH / 2, rowsH, 'model-header');
		cols.forEach((c, ci) => {
			if (c.key !== 'links')
				at(c.label, xs[ci] + TABLE.pad, headY, TABLE.label, 'text-muted', { bold: true });
		});
		// The columns' rules, from the labels' row down the rows shown (the fold toggle spans).
		for (let ci = 1; ci < cols.length; ci++)
			divider(xs[ci], headY - rowsH / 2, headY + (n + 0.5) * rowsH);
		const dimRows = view.apiDim[b.id];
		const label = (id: string) => refLabel(model, id);
		fields.slice(0, n).forEach((f, i) => {
			const y = b.absY + fieldRowY(i, fields.length, expanded, foldAt);
			const top = y - rowsH / 2;
			const s = rowState(b.id, f.id);
			ground(g, f.id, s.bg, b.absX + 1, top, b.width - 2, rowsH);
			if (s.bar) bar(top, rowsH, s.bar);
			sep(top);
			const faded = (comparing && !marked(f.id)) || !!dimRows?.[f.id];
			const texts: GlLabel[] = [];
			cols.forEach((c, ci) => {
				const x = xs[ci] + TABLE.pad;
				if (c.key === 'name') {
					const name = at(
						nameText(f, b.view, cellRoom(c)),
						x,
						y,
						TABLE.row,
						marks.dropped.has(f.id) ? 'text-muted' : 'model-text',
						{ op: marks.glyph.get(f.id), gap: CELL_GAP }
					);
					texts.push(name);
					if (marks.dropped.has(f.id)) strike(name, y);
					let bx = name.x + name.width + TABLE.badgeGap;
					for (const key of b.view === 'table' ? keysOf(f) : [])
						bx += badge(key, bx, y, false, texts) + TABLE.badgeGap;
				} else if (c.key === 'type')
					texts.push(at(typeCell(f, label, cellRoom(c)), x, y, TABLE.row, 'text-muted'));
				else if (c.key === 'required' && f.required)
					texts.push(at(TABLE.check, x, y, TABLE.row, 'model-text'));
				else if (c.key === 'nullable' && f.nullable)
					texts.push(at(TABLE.check, x, y, TABLE.row, 'model-text'));
				else if (c.key === 'constraints' && constraintsOf(f).length) {
					const { shown, more } = constraintBadges(f, cellRoom(c));
					let bx = x;
					for (const k of shown) bx += badge(k, bx, y, true, texts) + TABLE.badgeGap;
					if (more) {
						// Outlined, not filled: it stands for badges, it is not one.
						const t = at(`+${more}`, bx + 6, y, TABLE.badge, 'text-muted', { bold: true });
						g.rect(bx + 0.5, y - BADGE_H / 2 + 0.5, t.width + 11, BADGE_H - 1).stroke({
							...colour('model-stroke'),
							width: 1,
							pixelLine: true
						});
						texts.push(t);
					}
				} else if (c.key === 'links') {
					let sx = xs[ci];
					for (const slot of c.slots ?? []) {
						const kind =
							slot === 'inRef'
								? 'ref'
								: slot === 'inFrom'
									? 'from'
									: slot === 'inApi'
										? 'api'
										: undefined;
						const count = kind ? incomingCount(rels, f.id, kind) : 0;
						if (slot === 'ref' && f.ref)
							texts.push(at('→', sx + 3, y, TABLE.row, 'link-ref', { bold: true }));
						else if (slot === 'from' && f.from?.length) {
							const arrow = at('⇢', sx + 3, y, TABLE.row, 'link-from', { bold: true });
							texts.push(arrow);
							// A derived field's ƒ, as `.slot i`: 11 px Georgia, italic.
							if (f.derived)
								texts.push(
									at('ƒ', arrow.x + arrow.width, y, 11, 'link-from', { bold: true, serif: true })
								);
						} else if (count) {
							const t = at(
								slotCount(slot as 'inRef' | 'inFrom' | 'inApi', count),
								sx + 5,
								y,
								LINK.count,
								'model-fill',
								{ bold: true }
							);
							g.roundRect(sx + 1, y - 8, t.width + 8, 16, 8).fill(
								colour(
									slot === 'inRef' ? 'link-ref' : slot === 'inFrom' ? 'link-from' : 'api-stroke'
								)
							);
							texts.push(t);
						}
						sx += 20;
					}
				}
			});
			if (faded) for (const t of texts) t.alpha = 0.38;
		});
		if (foldable(fields.length, foldAt)) {
			const y = b.absY + fieldRowY(n, fields.length, expanded, foldAt) + (expanded ? rowsH : 0);
			const hidden =
				!expanded &&
				fields
					.slice(foldAt)
					.some(
						(f) => view.hot[b.id]?.[f.id] || (view.field?.box === b.id && view.field.field === f.id)
					);
			tint(y - rowsH / 2, rowsH, hidden ? 'row-peer' : 'model-header');
			sep(y - rowsH / 2);
			at(
				expanded ? '⌃ Collapse' : `⌄ Show all ${fields.length} fields (${fields.length - n} more)`,
				b.absX + TABLE.pad,
				y,
				TABLE.label,
				'text-muted'
			);
		}
		const indexes = b.view === 'table' ? el?.def.indexes : undefined;
		if (indexes?.length) {
			let y =
				b.absY +
				fieldRowY(n, fields.length, true, Number.MAX_SAFE_INTEGER) +
				(foldable(fields.length, foldAt) ? rowsH : 0);
			tint(y - rowsH / 2, rowsH, 'model-header');
			sep(y - rowsH / 2);
			at('Indexes', b.absX + TABLE.pad, y, TABLE.label, 'text-muted', { bold: true });
			// One index per row: its mark, its kind's badge (a key's when unique), name and fields.
			for (const ix of indexes) {
				y += rowsH;
				if (ix.id && marks.dropped.has(ix.id))
					hatch(g, b.absX + 1, y - rowsH / 2, b.width - 2, rowsH);
				sep(y - rowsH / 2);
				const texts: GlLabel[] = [];
				let x = b.absX + TABLE.pad;
				const op = ix.id ? marks.glyph.get(ix.id) : undefined;
				if (op) {
					const t = at('', x, y, TABLE.row, 'model-text', { op, gap: CELL_GAP });
					texts.push(t);
					x += t.width;
				}
				x += badge(indexKind(ix), x, y, !ix.unique, texts) + TABLE.badgeGap;
				const name = at(ix.name, x, y, TABLE.row, 'model-text');
				x += name.width + TABLE.badgeGap + 4;
				texts.push(name, at(indexFields(ix, fields), x, y, TABLE.row, 'text-muted'));
				if (comparing && !(ix.id && marked(ix.id))) for (const t of texts) t.alpha = 0.38;
			}
		}
		return { c: out, t: words };
	}

	function railRows(b: LandscapeBox): Rows {
		const P = pixi!;
		const r = rails.get(b.id)!;
		const out = new P.Container();
		const words = new P.Container();
		const g = new P.Graphics();
		out.addChild(g);
		const x0 = b.absX + b.width - r.width / 2;
		const y0 = b.absY + r.top;
		const s = r.scale;
		const lcd = fadedOf(b) === 1;
		const at = (text: string, x: number, y: number, px: number, t: Token, o: TextOpts = {}) => {
			if (!readable) return stub(x, text, px * s, o);
			const l = textOf(text, t, px * s, { lcd, ...o });
			l.position.set(x, y - (px * s * LINE) / 2);
			words.addChild(l);
			return l;
		};
		const x1 = x0 + r.width;
		/** The rule under a header or row: 1 screen px, in the model stroke colour. */
		const rule = (y: number) =>
			g
				.moveTo(x0 + 1, y)
				.lineTo(x1 - 1, y)
				.stroke({ ...colour('model-stroke'), width: 1, pixelLine: true });
		const header = colour('model-header');
		// The APIs header, its top corners rounded as the rail's border clips it.
		const headH = RAIL.head * s;
		const R = Math.min(13, headH);
		g.moveTo(x0 + 1, y0 + headH)
			.lineTo(x0 + 1, y0 + 1 + R)
			.arcTo(x0 + 1, y0 + 1, x0 + 1 + R, y0 + 1, R)
			.lineTo(x1 - 1 - R, y0 + 1)
			.arcTo(x1 - 1, y0 + 1, x1 - 1, y0 + 1 + R, R)
			.lineTo(x1 - 1, y0 + headH)
			.closePath()
			.fill(header);
		rule(y0 + headH);
		at('APIs', x0 + RAIL.pad * s, y0 + (RAIL.head / 2) * s, RAIL.label, 'text-muted', {
			bold: true,
			glyph: 'api'
		});
		let y = RAIL.head;
		for (const grp of r.groups) {
			if (grp.title) {
				g.rect(x0 + 1, y0 + y * s, r.width - 2, RAIL.group * s).fill(header);
				rule(y0 + (y + RAIL.group) * s);
				at(grp.title, x0 + RAIL.pad * s, y0 + (y + RAIL.group / 2) * s, RAIL.label, 'text-muted', {
					bold: true
				});
				y += RAIL.group;
			}
			for (const a of grp.apis) {
				if (changes.hidden.has(a)) continue;
				const def = model.elements.get(a)?.def;
				const ry = y0 + (railRowY(r, a) ?? 0) * s;
				const top = ry - (RAIL.row / 2) * s;
				const picked = view.api === a;
				const bg: Token | undefined = picked
					? 'row-self'
					: view.hotApis[a]
						? 'row-peer'
						: undefined;
				ground(g, a, bg, x0 + 1, top, r.width - 2, RAIL.row * s, s);
				const bar: Token | undefined = picked
					? 'selection'
					: level(a) === 'breaking'
						? 'sev-break'
						: level(a) === 'check'
							? 'sev-check'
							: undefined;
				if (bar) g.rect(x0 + 1, top, 3 * s, RAIL.row * s).fill(colour(bar));
				rule(top + RAIL.row * s);
				// Its mark, the method in its column, then the path.
				const m = at(
					def?.method ?? '',
					x0 + RAIL.pad * s,
					ry,
					RAIL.font,
					methodToken(def?.method),
					{ bold: true, op: marks.glyph.get(a), gap: RAIL.gap / RAIL.font }
				);
				const p = at(
					def?.path ?? '',
					m.x + m.width - m.advance + (r.methodWidth + RAIL.gap) * s,
					ry,
					RAIL.font,
					'api-text'
				);
				if (comparing && !marked(a)) m.alpha = p.alpha = 0.38;
				if ((model.reach?.get(a)?.state ?? 'live') !== 'live') {
					m.alpha *= DEAD_ALPHA;
					p.alpha *= DEAD_ALPHA;
				}
				if (marks.dropped.has(a))
					g.moveTo(p.x, ry)
						.lineTo(p.x + p.width, ry)
						.stroke({ ...colour('text-muted'), width: 1, pixelLine: true });
			}
			y += grp.apis.length * RAIL.row;
		}
		return { c: out, t: words };
	}

	// ------------------------------------------------------------ outlines
	/** The selected box, and boxes the lit lines or the picked api's bodies end on, outlined. */
	function drawOutlines(z: number) {
		const g = outlineLayer;
		if (!g) return;
		g.clear();
		const ring = (id: string, t: Token, off: number) => {
			const b = boxById.get(id);
			if (!b) return;
			const o = off / z;
			g.roundRect(b.absX - o, b.absY - o, b.width + 2 * o, b.height + 2 * o, 10 + o).stroke({
				...colour(t),
				width: 2 / z
			});
		};
		for (const id of Object.keys(view.peerBoxes)) ring(id, 'link-ref', 3);
		for (const id of Object.keys(view.apiBoxes)) ring(id, 'link-ref', 3);
		for (const id of view.selectedNodes) ring(id, 'selection', 2);
	}

	/** Tints the row, api or fold toggle under the pointer, as `:hover` does a node's rows. */
	function drawHover() {
		const g = hoverLayer;
		if (!g) return;
		g.clear();
		const p = pointer;
		const b = p && boxById.get(p.box);
		if (!p || !b || !rowsOf.has(p.part === 'api' ? `rail:${b.id}` : b.id)) return;
		const h = TABLE.rowHeight;
		const tint = colour('row-hover');
		if (p.part === 'api') {
			const r = rails.get(b.id)!;
			const y = b.absY + r.top + ((railRowY(r, p.id) ?? 0) - RAIL.row / 2) * r.scale;
			g.rect(b.absX + b.width - r.width / 2 + 1, y, r.width - 2, RAIL.row * r.scale).fill(tint);
			return;
		}
		const fields = b.fields ?? [];
		const expanded = !!view.expanded[b.id];
		const foldAt = b.foldAt ?? FOLD;
		let y: number | undefined;
		if (p.part === 'row') {
			const rows = cardRows(b);
			const i = rows
				? rows.findIndex((r) => r.id === p.id)
				: fields.findIndex((f) => f.id === p.id);
			if (i >= 0) y = rows ? logicRowY(i) : fieldRowY(i, fields.length, expanded, foldAt);
		} else if (p.part === 'fold') {
			const n = shownRows(fields.length, expanded, foldAt);
			y = fieldRowY(n, fields.length, expanded, foldAt) + (expanded ? h : 0);
		}
		if (y !== undefined) g.rect(b.absX + 1, b.absY + y - h / 2, b.width - 2, h).fill(tint);
	}

	// ------------------------------------------------------------ drawing
	let frame = 0;
	let restDirty = true;
	let litDirty = true;
	let dimDirty = true;
	/** The camera last drawn, when it last moved, and the frame drawn once it rests. */
	let camera = '';
	let moved = 0;
	let restTimer: ReturnType<typeof setTimeout> | undefined;
	/** The camera rests once it has not moved for this long (ms); text is then drawn sharp. */
	const REST = 120;
	/** Draws the next frame. */
	function request() {
		if (frame || typeof requestAnimationFrame === 'undefined') return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			if (!app || !pixi) return;
			const { x, y, zoom } = viewport.current;
			const now = performance.now();
			const cam = `${x} ${y} ${zoom}`;
			if (cam !== camera) {
				camera = cam;
				moved = now;
				clearTimeout(restTimer);
				restTimer = setTimeout(request, REST + 10);
			}
			world!.position.set(x, y);
			world!.scale.set(zoom);
			if (dots) {
				const k = (DOT_GAP * zoom) / DOT_TILE;
				dots.width = app.screen.width;
				dots.height = app.screen.height;
				dots.tileScale.set(k);
				dots.tilePosition.set(x - (DOT_GAP / 2) * zoom, y - (DOT_GAP / 2) * zoom);
			}
			if (restDirty) drawRest();
			if (litDirty) drawLit();
			restDirty = litDirty = false;
			placeRows(zoom);
			placeNames(zoom);
			placeFront(zoom);
			if (dimDirty) {
				applyDim();
				dimDirty = false;
			}
			drawOutlines(zoom);
			drawHover();
			// Text first: a text given its first raster has bounds to cull by. Culled against the
			// screen in canvas px.
			const s = app.screen;
			const more = text?.update(s, now - moved < REST);
			pixi.Culler.shared.cull(world!, { x: 0, y: 0, width: s.width, height: s.height });
			app.render();
			if (more) request();
		});
	}
	$effect(() => () => {
		cancelAnimationFrame(frame);
		clearTimeout(restTimer);
	});

	// A new layout, theme, dimming or change marks draw the scene anew.
	$effect(() => {
		void [pixi, boxes, boxById, rails, model, values, marks, comparing, changes.hidden];
		if (!pixi || !app) return;
		build();
		restDirty = litDirty = true;
		request();
	});
	// Looking at something tones the rest down: alphas only.
	$effect(() => {
		void dim;
		dimDirty = true;
		request();
	});
	$effect(() => {
		void rest;
		restDirty = true;
		request();
	});
	$effect(() => {
		void lit;
		litDirty = true;
		request();
	});
	// The view moved, or what rows show and how they are lit changed.
	$effect(() => {
		void viewport.current;
		void [view.near, view.full, view.railHover, view.expanded, view.hot, view.field, view.flash];
		void [view.apiDim, view.apiBoxes, view.hotApis, view.api, view.peerBoxes, view.selectedNodes];
		void [pointer, front];
		request();
	});

	// ------------------------------------------------------------ hit testing
	/**
	 * What is at `px`, `py` on the canvas, in screen px from its top-left: a row, an api, a fold
	 * toggle, a name bar or tab, the inside of an open box, or a closed rail; the deepest drawn.
	 */
	export function hitAt(px: number, py: number): GlHit | null {
		const { x, y, zoom } = viewport.current;
		const wx = (px - x) / zoom;
		const wy = (py - y) / zoom;
		const inside = (x0: number, y0: number, w: number, h: number) =>
			wx >= x0 && wx <= x0 + w && wy >= y0 && wy <= y0 + h;
		// Names drawn in front take the pointer first, an open box's as its name bar; a rail's
		// takes none, so hovering it lists the rail's endpoints.
		for (const [, f] of frontOf)
			if (!f.rail && f.at && inside(f.at.x, f.at.y, f.at.w, f.at.h))
				return { part: 'head', box: f.m.b.id, card: false };
		// Rails straddle their box's right border, over it and what is beside it.
		for (const [id, r] of rails) {
			const b = boxById.get(id)!;
			const x0 = b.absX + b.width - r.width / 2;
			if (!inside(x0, b.absY + r.top, r.width, r.height)) continue;
			if (!rowsOf.has(`rail:${id}`)) return { part: 'rail', box: id };
			for (const a of r.groups.flatMap((g) => g.apis)) {
				const ry = b.absY + r.top + (railRowY(r, a) ?? 0) * r.scale;
				if (Math.abs(wy - ry) <= (RAIL.row / 2) * r.scale && !changes.hidden.has(a))
					return { part: 'api', box: id, id: a };
			}
			return { part: 'rail', box: id };
		}
		// Expanded cards draw over what is below them.
		for (const b of boxes) {
			if (!b.fields || !view.expanded[b.id] || !rowsOf.has(b.id)) continue;
			const n = b.fields.length;
			const h = fieldRowY(n, n, true, Number.MAX_SAFE_INTEGER) + TABLE.rowHeight;
			if (inside(b.absX, b.absY, b.width, h)) return cardHit(b, wy);
		}
		let best: LandscapeBox | undefined;
		for (const b of boxes)
			if (inside(b.absX, b.absY, b.width, b.height) && (!best || depthOf(b) > depthOf(best)))
				best = b;
		if (!best) return null;
		if (isCard(best)) return cardHit(best, wy);
		if (!best.group) return { part: 'head', box: best.id, card: false };
		const tab = nameOf.get(best.id)?.at;
		if (!namesInFront && tab && wx >= tab.x0 && wx <= tab.x1 && wy >= tab.y0 && wy <= tab.y1)
			return { part: 'head', box: best.id, card: false };
		return { part: 'body', box: best.id };
	}

	function cardHit(b: LandscapeBox, wy: number): GlHit {
		const head: GlHit = { part: 'head', box: b.id, card: true };
		if (!rowsOf.has(b.id) || wy < b.absY + TABLE.head) return head;
		const half = TABLE.rowHeight / 2;
		const rows = cardRows(b);
		if (rows) {
			const i = rows.findIndex((r, i) => Math.abs(wy - (b.absY + logicRowY(i))) <= half);
			return i >= 0 && !changes.hidden.has(rows[i].id)
				? { part: 'row', box: b.id, id: rows[i].id }
				: head;
		}
		const fields = b.fields ?? [];
		const expanded = !!view.expanded[b.id];
		const foldAt = b.foldAt ?? FOLD;
		const n = shownRows(fields.length, expanded, foldAt);
		for (let i = 0; i < n; i++)
			if (Math.abs(wy - (b.absY + fieldRowY(i, fields.length, expanded, foldAt))) <= half)
				return { part: 'row', box: b.id, id: fields[i].id };
		const foldY =
			b.absY + fieldRowY(n, fields.length, expanded, foldAt) + (expanded ? TABLE.rowHeight : 0);
		if (foldable(fields.length, foldAt) && Math.abs(wy - foldY) <= half)
			return { part: 'fold', box: b.id };
		return head;
	}

	/** The line at rest under `px`, `py`, for its hover text: within a few screen px of it. */
	export function restLineAt(px: number, py: number): GlLine | undefined {
		const { x, y, zoom } = viewport.current;
		const wx = (px - x) / zoom;
		const wy = (py - y) / zoom;
		const reach = 4 / zoom;
		for (const l of rest) {
			// Where it is drawn: in its lanes.
			const pts = l.lanes ? lanePoints({ points: l.points, lanes: l.lanes }, zoom) : l.points;
			for (let i = 1; i < pts.length; i++) {
				const [a, b] = [pts[i - 1], pts[i]];
				const t = Math.max(
					0,
					Math.min(
						1,
						((wx - a.x) * (b.x - a.x) + (wy - a.y) * (b.y - a.y)) /
							((b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1)
					)
				);
				if (Math.hypot(wx - (a.x + t * (b.x - a.x)), wy - (a.y + t * (b.y - a.y))) <= reach)
					return l;
			}
		}
	}
</script>

<div class="gl-layer" bind:this={host} aria-hidden="true">
	<canvas bind:this={canvas}></canvas>
	{#if failed}
		<p class="failed">
			WebGL could not start: {failed}. The canvas needs WebGL: turn on hardware acceleration in the
			browser, or use another browser.
		</p>
	{/if}
</div>

<style>
	.gl-layer {
		position: absolute;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		overflow: hidden;
	}
	canvas {
		position: absolute;
		inset: 0;
		display: block;
	}
	.failed {
		position: absolute;
		left: 60px;
		bottom: 8px;
		margin: 0;
		font-size: 12px;
		color: var(--ui-danger);
	}
</style>
