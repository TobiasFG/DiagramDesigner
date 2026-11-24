/**
 * Connection lines for the WebGL renderer, drawn by a shader so that zooming rebuilds nothing.
 *
 * A layer of lines is one PixiJS Mesh. Its vertices sit on the lines' points in canvas px and
 * carry, beside them, everything that keeps its size on screen in screen px: how far the vertex
 * moves out to the line's edge (miter joins, butt caps), how far a line's end draws back under
 * its mark, so a faded line is not darker there, and the marks' corners. The vertex shader
 * takes the zoom from the mesh's world transform and divides those screen px by it, so the
 * camera moving changes a matrix and no vertex. The fragment shader draws dashes in screen px
 * from the distance along the line, and smooths each line's sides from its distance to the
 * centre in device px.
 *
 * A line leaving something starts in a dot (or, holding it, a diamond) and ends in an arrow on
 * what it reaches, so a line going out of a box reads apart from one coming in.
 *
 * Each segment is its own quad, cut on the miter at either end, so the distance along it is
 * exact across its width and dashes end square. Per line, in order: its halo (the same path
 * wider, in the canvas colour) and the halos round its marks, its body, its marks; the mesh
 * draws them in that order, so a later line's halo cuts through an earlier line where they
 * cross, and marks side by side stay apart, as each line drawn on its own would.
 *
 * A segment sharing a stretch with other lines is drawn in its lane beside them (see
 * landscape/lanes.ts): its vertices carry its lane and that of the segment it bends into, and
 * the shader moves them by both, in screen px, so the corners of lanes meet square too.
 */
import type { Buffer, Geometry, Mesh, Shader } from 'pixi.js';
import { LANE, type Lane } from '#lib/landscape/lanes.ts';
import type { Point } from '#lib/landscape/route.ts';
import type { Token } from '#lib/theme/tokens.ts';

type Pixi = typeof import('pixi.js');

/** What a line looks like; widths, dashes and marks in screen px, points in canvas px. */
export interface LineSpec {
	points: readonly Point[];
	width: number;
	color: Token;
	/** A dot or a diamond on the line's start, where it leaves what it starts on. */
	start?: 'dot' | 'diamond';
	/** An arrow on the line's end, where it reaches what it ends on. */
	arrow?: boolean;
	/** Width of the halo in the canvas colour under the line and round its marks. */
	halo?: number;
	/** Dash and gap. */
	dash?: readonly [number, number];
	/** Faded, as lines at rest are while something is looked at. */
	dim?: boolean;
	/**
	 * The lane of each segment, `points[i]` to `points[i + 1]`, none for one on its route (see
	 * landscape/lanes.ts); `points` then has no repeated point, so the two match.
	 */
	lanes?: readonly (Lane | undefined)[];
}

/**
 * Marks in screen px: an arrow's and a diamond's length along the line and width across it; a
 * dot's diameter, and on lines `wide` or wider, `wideDot`.
 */
export const MARKS = {
	arrow: { length: 12, width: 10 },
	diamond: { length: 16, width: 10 },
	dot: 7,
	wideDot: 9,
	wide: 2.5
} as const;
const DIM_ALPHA = 0.25;
/** Room beyond a line's edge for its smoothed edge, in screen px (at least half a device px). */
const FRINGE = 1;
/** A miter longer than this many half widths (a near reversal) is cut short. */
const MITER_LIMIT = 4;
/** Corners of a dot. */
const DOT_SIDES = 16;

/**
 * A vertex, in floats: position (canvas px), offset (screen px), shift (unit direction, the
 * canvas px it may move, screen px it moves, signed as it moves the distance along), edge
 * (distance from the centre and half width, screen px), along (distance along the line in
 * canvas px, plus screen px), dash (dash, gap, phase), colour (four bytes), lane (its segment's:
 * steps across, screen px a step at least, canvas px a step at most), bend (the lane of the
 * segment it bends into at this corner, likewise).
 */
const F = {
	offset: 2,
	shift: 4,
	edge: 8,
	along: 10,
	dash: 12,
	colour: 15,
	lane: 16,
	bend: 20
} as const;
export const STRIDE = 24;

/** A layer's vertices and indices, kept and grown across builds. */
export class LineBuffers {
	vertices = new Float32Array(0);
	/** The vertices' bytes as 32-bit words, for the packed colours. */
	words = new Uint32Array(0);
	indices = new Uint32Array(0);
	vertexCount = 0;
	indexCount = 0;

	/** Makes room for `v` vertices and `i` indices; true if the arrays were replaced. */
	reserve(v: number, i: number): boolean {
		let grew = false;
		if (this.vertices.length < v * STRIDE) {
			this.vertices = new Float32Array(grow(v) * STRIDE);
			this.words = new Uint32Array(this.vertices.buffer);
			grew = true;
		}
		if (this.indices.length < i) {
			this.indices = new Uint32Array(grow(i));
			grew = true;
		}
		return grew;
	}
}
const grow = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(n, 256)));

// A line's points with repeats dropped, the distance along it to each in canvas px, and the
// miter at each, in half widths.
let xs = new Float64Array(64);
let ys = new Float64Array(64);
let ds = new Float64Array(64);
let mxs = new Float64Array(64);
let mys = new Float64Array(64);

function clean(points: readonly Point[]): number {
	if (xs.length < points.length) {
		const n = grow(points.length);
		[xs, ys, ds, mxs, mys] = [1, 2, 3, 4, 5].map(() => new Float64Array(n));
	}
	let n = 0;
	for (const p of points) {
		if (n && p.x === xs[n - 1] && p.y === ys[n - 1]) continue;
		xs[n] = p.x;
		ys[n] = p.y;
		ds[n] = n ? ds[n - 1] + Math.hypot(p.x - xs[n - 1], p.y - ys[n - 1]) : 0;
		n++;
	}
	for (let i = 0; i < n; i++) {
		// Unit directions of the segments before (a) and after (b) point i; one at either end.
		const i0 = i > 0 ? i - 1 : 0;
		const i1 = i < n - 1 ? i + 1 : n - 1;
		let ax = (xs[i] - xs[i0]) / (ds[i] - ds[i0] || 1);
		let ay = (ys[i] - ys[i0]) / (ds[i] - ds[i0] || 1);
		let bx = (xs[i1] - xs[i]) / (ds[i1] - ds[i] || 1);
		let by = (ys[i1] - ys[i]) / (ds[i1] - ds[i] || 1);
		if (i === 0) [ax, ay] = [bx, by];
		else if (i === n - 1) [bx, by] = [ax, ay];
		// Between the normals (left of travel), as long as reaches both edges.
		let mx = -ay - by;
		let my = ax + bx;
		const ml = Math.hypot(mx, my);
		if (ml < 1e-9) [mx, my] = [-ay, ax];
		else {
			const scale = Math.min(MITER_LIMIT, ml / (my * ax - mx * ay)) / ml;
			mx *= scale;
			my *= scale;
		}
		mxs[i] = mx;
		mys[i] = my;
	}
	return n;
}

/** The colour `rgba` with its alpha scaled by `a`, as four bytes (r first). */
function fade(rgba: number, a: number): number {
	if (a === 1) return rgba;
	return ((rgba & 0xffffff) | (Math.round((rgba >>> 24) * a) << 24)) >>> 0;
}

type Shape = readonly (readonly [number, number])[];

/**
 * A mark's outline, as screen px back from where it sits along the line and aside from it, and
 * how far the line's body draws back under it, so a faded line is not darker there. Each is
 * convex, its first corner on the line's end.
 */
function markOf(kind: 'arrow' | 'diamond' | 'dot', width: number): { shape: Shape; pull: number } {
	const hw = width / 2;
	if (kind === 'arrow') {
		const { length: l, width: w } = MARKS.arrow;
		return {
			shape: [
				[0, 0],
				[l, w / 2],
				[l, -w / 2]
			],
			pull: l - 0.5
		};
	}
	if (kind === 'diamond') {
		const { length: l, width: w } = MARKS.diamond;
		return {
			shape: [
				[0, 0],
				[l / 2, w / 2],
				[l, 0],
				[l / 2, -w / 2]
			],
			pull: l - (l / 2) * (hw / (w / 2))
		};
	}
	const r = (width >= MARKS.wide ? MARKS.wideDot : MARKS.dot) / 2;
	return {
		shape: Array.from({ length: DOT_SIDES }, (_, i) => {
			const a = (2 * Math.PI * i) / DOT_SIDES;
			return [r * Math.cos(a), r * Math.sin(a)] as const;
		}),
		pull: Math.sqrt(r * r - hw * hw)
	};
}

/** A convex outline grown `m` px all round, its corners kept sharp. */
function grown(shape: Shape, m: number): Shape {
	const n = shape.length;
	let area = 0;
	for (let i = 0; i < n; i++) {
		const [a, b] = [shape[i], shape[(i + 1) % n]];
		area += a[0] * b[1] - b[0] * a[1];
	}
	const turn = area > 0 ? 1 : -1;
	/** The outward normal of the edge from corner `i` to the next. */
	const normal = (i: number) => {
		const [a, b] = [shape[i], shape[(i + 1) % n]];
		const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
		const l = Math.hypot(dx, dy);
		return [(turn * dy) / l, (-turn * dx) / l] as const;
	};
	return shape.map((p, i) => {
		const [n1, n2] = [normal((i + n - 1) % n), normal(i)];
		const d = 1 + n1[0] * n2[0] + n1[1] * n2[1];
		return [p[0] + (m * (n1[0] + n2[0])) / d, p[1] + (m * (n1[1] + n2[1])) / d] as const;
	});
}

/**
 * Fills `out` with the triangles of `lines`, in order; true if its arrays were replaced. `rgba`
 * gives a token's colour as four bytes, red in the lowest (see `tokenRgba`).
 */
export function buildLines(
	lines: readonly LineSpec[],
	rgba: (t: Token) => number,
	out: LineBuffers
): boolean {
	let nv = 0;
	let ni = 0;
	for (const l of lines) {
		const n = l.points.length;
		if (n < 2) continue;
		const strips = l.halo ? 2 : 1;
		nv += strips * 4 * (n - 1);
		ni += strips * 6 * (n - 1);
		const corners = (l.start === 'dot' ? DOT_SIDES : l.start ? 4 : 0) + (l.arrow ? 3 : 0);
		const marks = (l.start ? 1 : 0) + (l.arrow ? 1 : 0);
		nv += strips * corners;
		ni += strips * 3 * (corners - 2 * marks);
	}
	const grew = out.reserve(nv, ni);
	const v = out.vertices;
	const w = out.words;
	const ix = out.indices;
	let vc = 0;
	let ic = 0;

	/** Writes one vertex at (x, y), moved `ox`, `oy` screen px, and returns its index. */
	const vertex = (
		x: number,
		y: number,
		ox: number,
		oy: number,
		side: number,
		half: number,
		colour: number
	) => {
		const k = vc * STRIDE;
		v.fill(0, k, k + STRIDE);
		v[k] = x;
		v[k + 1] = y;
		v[k + F.offset] = ox;
		v[k + F.offset + 1] = oy;
		v[k + F.edge] = side;
		v[k + F.edge + 1] = half;
		w[k + F.colour] = colour;
		return vc++;
	};

	/** The line's lanes by segment, when they match its cleaned points. */
	let lanes: LineSpec['lanes'];
	/** Puts the lane of segment `s` (none past either end) into vertex word `k`'s field `f`. */
	const lane = (k: number, f: number, s: number) => {
		const l = lanes?.[s];
		if (!l) return;
		v[k + f] = l.nx;
		v[k + f + 1] = l.ny;
		v[k + f + 2] = l.step;
		v[k + f + 3] = l.room;
	};

	/**
	 * Quads along the cleaned points, `hw` screen px either side of them, mitered; for a line's
	 * body, drawn back `pulls` screen px from its start and end under its marks, and its dash.
	 */
	const strip = (
		n: number,
		hw: number,
		colour: number,
		pulls: readonly [number, number],
		dash: LineSpec['dash']
	) => {
		const e = hw + FRINGE;
		const total = ds[n - 1];
		for (let s = 0; s < n - 1; s++) {
			const len = ds[s + 1] - ds[s];
			const ux = (xs[s + 1] - xs[s]) / len;
			const uy = (ys[s + 1] - ys[s]) / len;
			const first = vc;
			for (let i = s; i <= s + 1; i++) {
				// A route may double back on itself; there the miter is the incoming normal, which
				// for the segment going back lies on its other side.
				const flip = mys[i] * ux - mxs[i] * uy < 0 ? -e : e;
				const ox = mxs[i] * flip;
				const oy = mys[i] * flip;
				// How far the miter moves the edge along this segment, in screen px.
				const along = ox * ux + oy * uy;
				for (const sign of SIDES) {
					const k = vertex(xs[i], ys[i], sign * ox, sign * oy, sign * e, hw, colour) * STRIDE;
					lane(k, F.lane, s);
					lane(k, F.bend, i === s ? s - 1 : s + 1);
					// An end under a mark draws back, never past its segment's other end.
					const pull = i === 0 ? pulls[0] : i === n - 1 ? -pulls[1] : 0;
					if (pull) {
						const toward = Math.sign(pull);
						v[k + F.shift] = toward * ux;
						v[k + F.shift + 1] = toward * uy;
						v[k + F.shift + 2] = i === 0 ? ds[1] : total - ds[n - 2];
						v[k + F.shift + 3] = pull;
					}
					if (!dash) continue;
					v[k + F.along] = ds[i];
					v[k + F.along + 1] = sign * along;
					v[k + F.dash] = dash[0];
					v[k + F.dash + 1] = dash[1];
					// Dashes start where the line shows from under its start mark.
					v[k + F.dash + 2] = -pulls[0];
				}
			}
			ix[ic++] = first;
			ix[ic++] = first + 1;
			ix[ic++] = first + 2;
			ix[ic++] = first + 1;
			ix[ic++] = first + 3;
			ix[ic++] = first + 2;
		}
	};

	/**
	 * A mark `shape` on the end of the line at cleaned point `end`, along the segment from point
	 * `from`, as a fan of triangles from its first corner.
	 */
	const mark = (shape: Shape, end: number, from: number, colour: number) => {
		const len = Math.abs(ds[end] - ds[from]);
		const ux = (xs[end] - xs[from]) / len;
		const uy = (ys[end] - ys[from]) / len;
		const first = vc;
		for (const [along, side] of shape) {
			const k = vertex(
				xs[end],
				ys[end],
				-ux * along - uy * side,
				-uy * along + ux * side,
				0,
				1e4,
				colour
			);
			lane(k * STRIDE, F.lane, Math.min(end, from));
		}
		for (let i = 1; i < shape.length - 1; i++) {
			ix[ic++] = first;
			ix[ic++] = first + i;
			ix[ic++] = first + i + 1;
		}
	};

	for (const l of lines) {
		if (l.points.length < 2) continue;
		const n = clean(l.points);
		if (n < 2) continue;
		lanes = l.lanes?.length === n - 1 ? l.lanes : undefined;
		const a = l.dim ? DIM_ALPHA : 1;
		const start = l.start && markOf(l.start, l.width);
		const arrow = l.arrow ? markOf('arrow', l.width) : undefined;
		const colour = fade(rgba(l.color), a);
		if (l.halo) {
			const bg = fade(rgba('canvas-bg'), a);
			const m = Math.max(0, (l.halo - l.width) / 2);
			strip(n, l.halo / 2, bg, [0, 0], undefined);
			if (start) mark(grown(start.shape, m), 0, 1, bg);
			if (arrow) mark(grown(arrow.shape, m), n - 1, n - 2, bg);
		}
		strip(n, l.width / 2, colour, [start?.pull ?? 0, arrow?.pull ?? 0], l.dash);
		if (start) mark(start.shape, 0, 1, colour);
		if (arrow) mark(arrow.shape, n - 1, n - 2, colour);
	}
	out.vertexCount = vc;
	out.indexCount = ic;
	return grew;
}
const SIDES = [1, -1] as const;

// ------------------------------------------------------------ colours
const rgbaCache = new WeakMap<object, Map<Token, number>>();

/** A token's colour as four bytes, red lowest, as the lines' vertices carry it; cached per theme. */
export function tokenRgba(P: Pixi, values: Record<Token, string>): (t: Token) => number {
	let m = rgbaCache.get(values);
	if (!m) rgbaCache.set(values, (m = new Map()));
	const cache = m;
	return (t) => {
		let c = cache.get(t);
		if (c === undefined) {
			const [r, g, b, a] = new P.Color(values[t]).toArray();
			const byte = (f: number) => Math.round(f * 255);
			c = (byte(r) | (byte(g) << 8) | (byte(b) << 16) | (byte(a) << 24)) >>> 0;
			cache.set(t, c);
		}
		return c;
	};
}

// ------------------------------------------------------------ the shader
const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aOffset;
in vec4 aShift;
in vec2 aEdge;
in vec2 aAlong;
in vec3 aDash;
in vec4 aColor;
in vec4 aLane;
in vec4 aBend;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform mat3 uTransformMatrix;
uniform vec4 uColor;

out vec4 vColor;
out vec2 vEdge;
out vec3 vDash;

float laneStep(vec4 l, float zoom) {
	return min(clamp(${LANE.pitch.toFixed(1)} * zoom, l.z, ${LANE.most.toFixed(1)}), l.w * zoom);
}

void main() {
	mat3 model = uWorldTransformMatrix * uTransformMatrix;
	// Canvas px to screen px: the camera's scale.
	float zoom = length(model[0].xy);
	// An end under a mark draws back its screen px, never past its segment's other end.
	float pull = min(abs(aShift.w), aShift.z * zoom);
	// Lanes: steps across, each ${LANE.pitch} canvas px kept between its least screen px and
	// ${LANE.most}, but no more than its canvas px allow.
	vec2 lane = aLane.xy * laneStep(aLane, zoom) + aBend.xy * laneStep(aBend, zoom);
	vec2 p = aPosition + (aOffset + aShift.xy * pull + lane) / zoom;
	gl_Position = vec4((uProjectionMatrix * model * vec3(p, 1.0)).xy, 0.0, 1.0);
	vColor = vec4(aColor.rgb * aColor.a, aColor.a) * uColor * uWorldColorAlpha;
	vEdge = aEdge;
	// Screen px along the line.
	float s = aAlong.x * zoom + aAlong.y + sign(aShift.w) * pull;
	vDash = vec3(s + aDash.z, aDash.xy);
}
`;

const fragment = /* glsl */ `
in vec4 vColor;
in vec2 vEdge;
in vec3 vDash;

uniform float uPixel;

out vec4 finalColor;

// How much of a device pixel lies inside an edge d screen px away (inside positive).
float cover(float d) {
	return clamp(d * uPixel + 0.5, 0.0, 1.0);
}

void main() {
	float a = cover(vEdge.y - abs(vEdge.x));
	if (vDash.y > 0.0) {
		float period = vDash.y + vDash.z;
		float t = mod(vDash.x, period);
		a *= cover(t < vDash.y ? min(t, vDash.y - t) : -min(t - vDash.y, period - t));
	}
	finalColor = vColor * a;
}
`;

/** The lines' shader, shared by every layer of one renderer; `resolution` is device px per screen px. */
export function lineShader(P: Pixi, resolution: number): Shader {
	return new P.Shader({
		glProgram: new P.GlProgram({
			name: 'sdv-lines',
			vertex,
			fragment,
			preferredVertexPrecision: 'highp',
			preferredFragmentPrecision: 'highp'
		}),
		resources: {
			lineUniforms: new P.UniformGroup({ uPixel: { value: resolution, type: 'f32' } })
		}
	});
}

/** One layer of lines: a mesh to put in the scene, refilled when its lines change. */
export class LineLayer {
	readonly mesh: Mesh<Geometry, Shader>;
	readonly #buffers = new LineBuffers();
	readonly #geometry: Geometry;
	readonly #vb: Buffer;
	readonly #ib: Buffer;

	constructor(P: Pixi, shader: Shader) {
		this.#buffers.reserve(1, 1);
		this.#vb = new P.Buffer({
			data: this.#buffers.vertices,
			usage: P.BufferUsage.VERTEX | P.BufferUsage.COPY_DST
		});
		this.#ib = new P.Buffer({
			data: this.#buffers.indices,
			usage: P.BufferUsage.INDEX | P.BufferUsage.COPY_DST
		});
		const at = (offset: number, format: 'float32x2' | 'float32x3' | 'float32x4' | 'unorm8x4') => ({
			buffer: this.#vb,
			format,
			stride: STRIDE * 4,
			offset: offset * 4
		});
		this.#geometry = new P.Geometry({
			attributes: {
				aPosition: at(0, 'float32x2'),
				aOffset: at(F.offset, 'float32x2'),
				aShift: at(F.shift, 'float32x4'),
				aEdge: at(F.edge, 'float32x2'),
				aAlong: at(F.along, 'float32x2'),
				aDash: at(F.dash, 'float32x3'),
				aColor: at(F.colour, 'unorm8x4'),
				aLane: at(F.lane, 'float32x4'),
				aBend: at(F.bend, 'float32x4')
			},
			indexBuffer: this.#ib
		});
		this.mesh = new P.Mesh({ geometry: this.#geometry, shader });
		this.mesh.visible = false;
	}

	/** Draws `lines`, in order, instead of what the layer drew. */
	set(lines: readonly LineSpec[], rgba: (t: Token) => number) {
		const b = this.#buffers;
		if (buildLines(lines, rgba, b)) {
			this.#vb.data = b.vertices;
			this.#ib.data = b.indices;
		}
		// Upload only what was written.
		this.#vb.setDataWithSize(b.vertices, b.vertexCount * STRIDE, true);
		this.#ib.setDataWithSize(b.indices, b.indexCount, true);
		this.#geometry.indexCount = b.indexCount;
		this.mesh.visible = b.indexCount > 0;
	}

	/** Frees the layer's buffers; the mesh is destroyed with the scene. */
	destroy() {
		this.#geometry.destroy(true);
	}
}
