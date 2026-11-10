import type {
	ArtifactNode,
	BoundaryNode,
	ClassNode,
	ElementNode,
	FlowNodeShape,
	JobNode,
	LaneNode,
	Marker,
	MemberRow,
	ObjectNode,
	RenderNode,
	StageNode
} from '../projections/types';
import type { Token, TokenResolver } from '../theme/tokens';
import { el, pathD, type SvgNode } from './svg';
import { textWidth, truncate, wrapText } from './text';

/**
 * Node geometry: sizing (used by projections, so every consumer gets the same size hints)
 * and drawing (used by canvas nodes and the SVG exporter). Shapes draw in local coordinates
 * with the origin at the node's top-left corner.
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------------ text helpers

interface TextOpts {
	size: number;
	fill: string;
	anchor?: 'start' | 'middle' | 'end';
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	cls?: string;
}

/** Text positioned by its baseline. */
export function svgText(x: number, y: number, text: string, o: TextOpts): SvgNode {
	return el(
		'text',
		{
			x,
			y,
			'font-size': o.size,
			'font-weight': o.bold ? 700 : undefined,
			'font-style': o.italic ? 'italic' : undefined,
			'text-decoration': o.underline ? 'underline' : undefined,
			'text-anchor': o.anchor && o.anchor !== 'start' ? o.anchor : undefined,
			fill: o.fill,
			class: o.cls
		},
		text
	);
}

/** Baseline for text of `size` whose line box starts at `top`. */
const baseline = (top: number, size: number) => top + Math.round(size * 0.82);

// ------------------------------------------------------------------ elements

const KIND_LABEL: Record<ElementNode['data']['kind'], string> = {
	person: 'Person',
	system: 'Software System',
	container: 'Container',
	component: 'Component',
	external: 'External System',
	datastore: 'Database',
	queue: 'Queue',
	module: 'Module',
	model: 'Model',
	'logic-unit': 'Logic Unit',
	api: 'API'
};

export function elementMeta(kind: ElementNode['data']['kind']): string {
	return `[${KIND_LABEL[kind]}]`;
}

const EL = { minW: 160, maxW: 240, padX: 12, label: 14, meta: 11 };
const PERSON_HEAD = 28;
const CYL_RY = 8;

function elementBodyTop(kind: string): number {
	return kind === 'person' ? PERSON_HEAD : kind === 'datastore' ? CYL_RY * 2 : 0;
}

export function sizeElement(d: {
	kind: ElementNode['data']['kind'];
	label: string;
	hiddenChildren: number;
}): { width: number; height: number } {
	const meta = elementMeta(d.kind);
	const extraX = d.kind === 'queue' ? CYL_RY * 2 : 0;
	const width = clamp(
		Math.max(textWidth(d.label, EL.label, true), textWidth(meta, EL.meta)) + EL.padX * 2 + extraX,
		EL.minW,
		EL.maxW
	);
	let height = elementBodyTop(d.kind) + 12 + 18 + 16;
	if (d.hiddenChildren) height += 16;
	height += 12;
	return { width, height };
}

function kindColors(kind: string, t: TokenResolver) {
	return {
		fill: t(`${kind}-fill` as Token),
		stroke: t(`${kind}-stroke` as Token),
		text: t(`${kind}-text` as Token)
	};
}

function drawElement(n: ElementNode, w: number, h: number, t: TokenResolver): SvgNode {
	const { kind } = n.data;
	const c = kindColors(kind, t);
	const shapes: SvgNode[] = [];
	const base = { fill: c.fill, stroke: c.stroke, 'stroke-width': 1.5 };
	if (kind === 'person') {
		const r = 16;
		shapes.push(
			el('rect', {
				x: 0,
				y: PERSON_HEAD - 4,
				width: w,
				height: h - PERSON_HEAD + 4,
				rx: 16,
				...base
			})
		);
		shapes.push(el('circle', { cx: w / 2, cy: r, r, ...base }));
	} else if (kind === 'datastore') {
		const ry = CYL_RY;
		shapes.push(
			el('path', {
				d: pathD(
					'M',
					0,
					ry,
					'A',
					w / 2,
					ry,
					0,
					0,
					1,
					w,
					ry,
					'V',
					h - ry,
					'A',
					w / 2,
					ry,
					0,
					0,
					1,
					0,
					h - ry,
					'Z'
				),
				...base
			})
		);
		shapes.push(
			el('path', {
				d: pathD('M', 0, ry, 'A', w / 2, ry, 0, 0, 0, w, ry),
				fill: 'none',
				stroke: c.stroke,
				'stroke-width': 1.5
			})
		);
	} else if (kind === 'queue') {
		const rx = CYL_RY;
		shapes.push(
			el('path', {
				d: pathD(
					'M',
					rx,
					0,
					'H',
					w - rx,
					'A',
					rx,
					h / 2,
					0,
					0,
					1,
					w - rx,
					h,
					'H',
					rx,
					'A',
					rx,
					h / 2,
					0,
					0,
					1,
					rx,
					0,
					'Z'
				),
				...base
			})
		);
		shapes.push(
			el('path', {
				d: pathD('M', w - rx, 0, 'A', rx, h / 2, 0, 0, 0, w - rx, h),
				fill: 'none',
				stroke: c.stroke,
				'stroke-width': 1.5
			})
		);
	} else {
		shapes.push(el('rect', { x: 0, y: 0, width: w, height: h, rx: 6, ...base }));
	}
	const cx = w / 2 - (kind === 'queue' ? CYL_RY / 2 : 0);
	const innerW = w - EL.padX * 2 - (kind === 'queue' ? CYL_RY * 2 : 0);
	let y = elementBodyTop(kind) + 12;
	const texts: SvgNode[] = [];
	texts.push(
		svgText(cx, baseline(y, EL.label), truncate(n.data.label, innerW, EL.label, true), {
			size: EL.label,
			bold: true,
			fill: c.text,
			anchor: 'middle',
			cls: 'sdv-label'
		})
	);
	y += 18;
	texts.push(
		svgText(
			cx,
			baseline(y, EL.meta),
			truncate(elementMeta(kind), innerW, EL.meta),
			{ size: EL.meta, fill: c.text, anchor: 'middle' }
		)
	);
	y += 16;
	if (n.data.hiddenChildren) {
		const s = `+${n.data.hiddenChildren} inside`;
		texts.push(
			svgText(cx, baseline(y, 11), s, { size: 11, fill: c.text, anchor: 'middle', italic: true })
		);
	}
	return el('g', { class: `sdv-node sdv-${kind}` }, ...shapes, ...texts);
}

export const BOUNDARY_PADDING = { top: 48, left: 20, bottom: 20, right: 20 };

export function sizeBoundary(label: string): { width: number; height: number } {
	return { width: Math.max(200, textWidth(label, 13, true) + 40), height: 120 };
}

function drawBoundary(n: BoundaryNode, w: number, h: number, t: TokenResolver): SvgNode {
	return el(
		'g',
		{ class: 'sdv-node sdv-boundary' },
		el('rect', {
			x: 0,
			y: 0,
			width: w,
			height: h,
			rx: 8,
			fill: t('boundary-fill'),
			stroke: t('boundary-stroke'),
			'stroke-width': 1.5,
			'stroke-dasharray': '6 4'
		}),
		svgText(12, baseline(10, 13), truncate(n.data.label, w - 24, 13, true), {
			size: 13,
			bold: true,
			fill: t('boundary-text'),
			cls: 'sdv-label'
		}),
		svgText(12, baseline(27, 11), elementMeta(n.data.kind), {
			size: 11,
			fill: t('boundary-text')
		})
	);
}

// ------------------------------------------------------------------ classes

const CLS = { row: 18, font: 12, pad: 5, minW: 150, maxRows: 12 };

export function classStereotype(d: ClassNode['data']): string | undefined {
	if (d.stereotype) return `«${d.stereotype}»`;
	if (d.classKind === 'interface') return '«interface»';
	if (d.classKind === 'enum') return '«enumeration»';
	return undefined;
}

export interface ClassMetrics {
	width: number;
	height: number;
	headerHeight: number;
	/** Compartments in draw order with their top y and rows. */
	compartments: {
		key: 'attributes' | 'methods' | 'values';
		y: number;
		height: number;
		rows: string[];
		more: number;
	}[];
}

export function classMetrics(d: ClassNode['data']): ClassMetrics {
	const stereo = classStereotype(d);
	const headerHeight = 8 + (stereo ? 14 : 0) + 18 + 8;
	const lists: ClassMetrics['compartments'] = [];
	const pushComp = (key: 'attributes' | 'methods' | 'values', rows: string[], more: number) =>
		lists.push({ key, y: 0, height: 0, rows, more });
	if (d.classKind === 'enum') pushComp('values', d.values, d.more.values);
	if (d.showAttributes && (d.classKind !== 'enum' || d.attributes.length)) {
		pushComp(
			'attributes',
			d.attributes.map((r) => r.text),
			d.more.attributes
		);
	}
	if (d.showMethods && (d.classKind !== 'enum' || d.methods.length)) {
		pushComp(
			'methods',
			d.methods.map((r) => r.text),
			d.more.methods
		);
	}
	let y = headerHeight;
	let width = Math.max(
		CLS.minW,
		textWidth(d.label, 14, true) + 28,
		stereo ? textWidth(stereo, 11) + 28 : 0
	);
	for (const c of lists) {
		const rows = c.rows.length + (c.more ? 1 : 0);
		c.y = y;
		c.height = Math.max(12, rows * CLS.row + CLS.pad * 2);
		y += c.height;
		for (const r of c.rows) width = Math.max(width, textWidth(r, CLS.font) + 20);
	}
	return { width: Math.min(width, 360), height: y, headerHeight, compartments: lists };
}

/** Truncates a compartment to `CLS.maxRows`, returning kept rows and the hidden count. */
export function truncateRows<T>(rows: T[]): { rows: T[]; more: number } {
	if (rows.length <= CLS.maxRows) return { rows, more: 0 };
	return { rows: rows.slice(0, CLS.maxRows - 1), more: rows.length - (CLS.maxRows - 1) };
}

export function memberRowY(m: ClassMetrics, key: string, index: number): number | undefined {
	const c = m.compartments.find((c) => c.key === key);
	return c ? c.y + CLS.pad + index * CLS.row : undefined;
}

export const CLASS_ROW_HEIGHT = CLS.row;

function drawClass(n: ClassNode, w: number, h: number, t: TokenResolver): SvgNode {
	const d = n.data;
	const m = classMetrics(d);
	const stereo = classStereotype(d);
	const parts: SvgNode[] = [
		el('rect', {
			x: 0,
			y: 0,
			width: w,
			height: h,
			rx: 3,
			fill: t('class-fill'),
			stroke: t('class-stroke'),
			'stroke-width': 1.5
		}),
		el('path', {
			d: pathD(
				'M',
				0.75,
				m.headerHeight,
				'V',
				3,
				'Q',
				0.75,
				0.75,
				3,
				0.75,
				'H',
				w - 3,
				'Q',
				w - 0.75,
				0.75,
				w - 0.75,
				3,
				'V',
				m.headerHeight,
				'Z'
			),
			fill: t('class-header')
		})
	];
	let y = 8;
	if (stereo) {
		parts.push(
			svgText(w / 2, baseline(y, 11), stereo, { size: 11, fill: t('text-muted'), anchor: 'middle' })
		);
		y += 14;
	}
	const italic = d.classKind === 'abstract' || d.classKind === 'interface';
	parts.push(
		svgText(w / 2, baseline(y, 14), truncate(d.label, w - 16, 14, true), {
			size: 14,
			bold: true,
			italic,
			fill: t('class-text'),
			anchor: 'middle',
			cls: 'sdv-label'
		})
	);
	const rowsFor = (key: string): MemberRow[] | undefined =>
		key === 'attributes' ? d.attributes : key === 'methods' ? d.methods : undefined;
	for (const c of m.compartments) {
		parts.push(
			el('line', { x1: 0, y1: c.y, x2: w, y2: c.y, stroke: t('class-stroke'), 'stroke-width': 1 })
		);
		const members = rowsFor(c.key);
		c.rows.forEach((text, i) => {
			const member = members?.[i];
			parts.push(
				svgText(
					10,
					baseline(c.y + CLS.pad + i * CLS.row + 2, CLS.font),
					truncate(text, w - 16, CLS.font),
					{
						size: CLS.font,
						fill: t('class-text'),
						underline: member?.static,
						italic: member?.abstract
					}
				)
			);
		});
		if (c.more) {
			const ry = c.y + CLS.pad + c.rows.length * CLS.row + 2;
			parts.push(
				svgText(10, baseline(ry, 11), `+${c.more} more`, {
					size: 11,
					fill: t('text-muted'),
					italic: true
				})
			);
		}
	}
	return el('g', { class: 'sdv-node sdv-class' }, ...parts);
}

// ------------------------------------------------------------------ objects

export function sizeObject(d: ObjectNode['data']): { width: number; height: number } {
	let width = Math.max(140, textWidth(d.label, 13, true) + 28);
	for (const r of d.rows) width = Math.max(width, textWidth(`${r.name} = ${r.value}`, 12) + 20);
	return {
		width: Math.min(width, 340),
		height: 30 + (d.rows.length ? d.rows.length * 18 + 10 : 0)
	};
}

function drawObject(n: ObjectNode, w: number, h: number, t: TokenResolver): SvgNode {
	const parts: SvgNode[] = [
		el('rect', {
			x: 0,
			y: 0,
			width: w,
			height: h,
			rx: 3,
			fill: t('object-fill'),
			stroke: t('object-stroke'),
			'stroke-width': 1.5
		}),
		el('path', {
			d: pathD(
				'M',
				0.75,
				30,
				'V',
				3,
				'Q',
				0.75,
				0.75,
				3,
				0.75,
				'H',
				w - 3,
				'Q',
				w - 0.75,
				0.75,
				w - 0.75,
				3,
				'V',
				30,
				'Z'
			),
			fill: t('object-header')
		}),
		svgText(w / 2, baseline(8, 13), truncate(n.data.label, w - 16, 13, true), {
			size: 13,
			bold: true,
			underline: true,
			fill: t('text'),
			anchor: 'middle',
			cls: 'sdv-label'
		})
	];
	if (n.data.rows.length) {
		parts.push(
			el('line', { x1: 0, y1: 30, x2: w, y2: 30, stroke: t('object-stroke'), 'stroke-width': 1 })
		);
		n.data.rows.forEach((r, i) => {
			parts.push(
				svgText(10, baseline(35 + i * 18 + 2, 12), truncate(`${r.name} = ${r.value}`, w - 16, 12), {
					size: 12,
					fill: t('text')
				})
			);
		});
	}
	return el('g', { class: 'sdv-node sdv-object' }, ...parts);
}

// ------------------------------------------------------------------ flows

const FLOW_FONT = 13;
const IO_SKEW = 14;

export function flowLabelLines(d: FlowNodeShape['data'], width: number): string[] {
	const inner =
		d.flowType === 'decision'
			? width * 0.62
			: d.flowType === 'io'
				? width - IO_SKEW * 2 - 12
				: width - 24;
	return wrapText(d.label, inner, FLOW_FONT, 3);
}

export function sizeFlowNode(d: FlowNodeShape['data']): { width: number; height: number } {
	const tw = textWidth(d.label, FLOW_FONT);
	switch (d.flowType) {
		case 'start':
		case 'end':
			return { width: Math.max(90, Math.min(tw + 36, 200)), height: 36 };
		case 'decision': {
			const width = clamp(tw * 1.5 + 40, 120, 240);
			const lines = flowLabelLines(d, width).length;
			return { width, height: Math.max(70, lines * 16 + 44) };
		}
		case 'io': {
			const width = clamp(tw + IO_SKEW * 2 + 28, 130, 240);
			return { width, height: Math.max(44, flowLabelLines(d, width).length * 16 + 22) };
		}
		default: {
			const width = clamp(tw + 36, 130, 230);
			return { width, height: Math.max(44, flowLabelLines(d, width).length * 16 + 22) };
		}
	}
}

function drawFlowNode(n: FlowNodeShape, w: number, h: number, t: TokenResolver): SvgNode {
	const d = n.data;
	const stroke = { stroke: t('flow-stroke'), 'stroke-width': 1.5 };
	let shape: SvgNode;
	let textFill = t('text');
	switch (d.flowType) {
		case 'start':
		case 'end':
			shape = el('rect', {
				x: 0,
				y: 0,
				width: w,
				height: h,
				rx: h / 2,
				fill: t(d.flowType === 'start' ? 'flow-terminal-fill' : 'flow-end-fill'),
				stroke: 'none'
			});
			textFill = t('flow-terminal-text');
			break;
		case 'decision':
			shape = el('path', {
				d: pathD('M', w / 2, 0, 'L', w, h / 2, 'L', w / 2, h, 'L', 0, h / 2, 'Z'),
				fill: t('flow-decision-fill'),
				...stroke
			});
			break;
		case 'io':
			shape = el('path', {
				d: pathD('M', IO_SKEW, 0, 'H', w, 'L', w - IO_SKEW, h, 'H', 0, 'Z'),
				fill: t('flow-io-fill'),
				...stroke
			});
			break;
		case 'subflow':
			shape = el(
				'g',
				{},
				el('rect', {
					x: 0,
					y: 0,
					width: w,
					height: h,
					rx: 3,
					fill: t('flow-subflow-fill'),
					...stroke
				}),
				el('path', { d: pathD('M', 8, 0, 'V', h, 'M', w - 8, 0, 'V', h), fill: 'none', ...stroke })
			);
			break;
		default:
			shape = el('rect', {
				x: 0,
				y: 0,
				width: w,
				height: h,
				rx: 10,
				fill: t('flow-action-fill'),
				...stroke
			});
	}
	const lines = flowLabelLines(d, w);
	const top = h / 2 - (lines.length * 16) / 2;
	const texts = lines.map((line, i) =>
		svgText(w / 2, baseline(top + i * 16 + 1, FLOW_FONT), line, {
			size: FLOW_FONT,
			fill: textFill,
			anchor: 'middle',
			bold: d.flowType === 'start' || d.flowType === 'end',
			cls: i === 0 ? 'sdv-label' : undefined
		})
	);
	return el('g', { class: `sdv-node sdv-flow-${d.flowType}` }, shape, ...texts);
}

export const LANE_HEADER = 34;

function drawLane(n: LaneNode, w: number, h: number, t: TokenResolver): SvgNode {
	return el(
		'g',
		{ class: 'sdv-node sdv-lane' },
		el('rect', {
			x: 0,
			y: 0,
			width: w,
			height: h,
			fill: t('lane-fill'),
			stroke: t('lane-stroke'),
			'stroke-width': 1
		}),
		el('rect', {
			x: 0,
			y: 0,
			width: w,
			height: LANE_HEADER,
			fill: t('lane-header'),
			stroke: t('lane-stroke'),
			'stroke-width': 1
		}),
		svgText(w / 2, baseline(10, 13), truncate(n.data.label, w - 16, 13, true), {
			size: 13,
			bold: true,
			fill: t('text'),
			anchor: 'middle',
			cls: 'sdv-label'
		})
	);
}

// ------------------------------------------------------------------ pipelines

export const STAGE_PADDING = { top: 40, left: 16, bottom: 16, right: 16 };

export function sizeJob(label: string): { width: number; height: number } {
	return { width: clamp(textWidth(label, 12) + 36, 120, 220), height: 40 };
}

export function sizeArtifact(label: string): { width: number; height: number } {
	return { width: clamp(textWidth(label, 12) + 30, 100, 200), height: 46 };
}

const STATUS_TOKEN: Record<string, Token> = {
	success: 'status-success',
	passed: 'status-success',
	failed: 'status-failed',
	failure: 'status-failed',
	running: 'status-running',
	pending: 'status-pending',
	skipped: 'status-pending'
};

function drawStage(n: StageNode, w: number, h: number, t: TokenResolver): SvgNode {
	return el(
		'g',
		{ class: 'sdv-node sdv-stage' },
		el('rect', {
			x: 0,
			y: 0,
			width: w,
			height: h,
			rx: 8,
			fill: t('stage-fill'),
			stroke: t('stage-stroke'),
			'stroke-width': 1.5
		}),
		svgText(12, baseline(12, 13), truncate(n.data.label, w - 24, 13, true), {
			size: 13,
			bold: true,
			fill: t('stage-text'),
			cls: 'sdv-label'
		})
	);
}

function drawJob(n: JobNode, w: number, h: number, t: TokenResolver): SvgNode {
	const status = n.data.status ? STATUS_TOKEN[n.data.status.toLowerCase()] : undefined;
	return el(
		'g',
		{ class: 'sdv-node sdv-job' },
		el('rect', {
			x: 0,
			y: 0,
			width: w,
			height: h,
			rx: 6,
			fill: t('job-fill'),
			stroke: status ? t(status) : t('job-stroke'),
			'stroke-width': status ? 2 : 1.5
		}),
		status && el('rect', { x: 0, y: 0, width: 6, height: h, rx: 3, fill: t(status) }),
		svgText(w / 2 + (status ? 3 : 0), baseline(h / 2 - 7, 12), truncate(n.data.label, w - 20, 12), {
			size: 12,
			fill: t('text'),
			anchor: 'middle',
			cls: 'sdv-label'
		})
	);
}

function drawArtifact(n: ArtifactNode, w: number, h: number, t: TokenResolver): SvgNode {
	const f = 10;
	return el(
		'g',
		{ class: 'sdv-node sdv-artifact' },
		el('path', {
			d: pathD('M', 0, 0, 'H', w - f, 'L', w, f, 'V', h, 'H', 0, 'Z'),
			fill: t('artifact-fill'),
			stroke: t('artifact-stroke'),
			'stroke-width': 1.5
		}),
		el('path', {
			d: pathD('M', w - f, 0, 'V', f, 'H', w),
			fill: 'none',
			stroke: t('artifact-stroke'),
			'stroke-width': 1.5
		}),
		svgText(w / 2, baseline(h / 2 - 7, 12), truncate(n.data.label, w - 16, 12), {
			size: 12,
			fill: t('text'),
			anchor: 'middle',
			cls: 'sdv-label'
		})
	);
}

// ------------------------------------------------------------------ dispatch

export function drawNode(n: RenderNode, w: number, h: number, t: TokenResolver): SvgNode {
	switch (n.type) {
		case 'element':
			return drawElement(n, w, h, t);
		case 'boundary':
			return drawBoundary(n, w, h, t);
		case 'class':
			return drawClass(n, w, h, t);
		case 'object':
			return drawObject(n, w, h, t);
		case 'flow':
			return drawFlowNode(n, w, h, t);
		case 'lane':
			return drawLane(n, w, h, t);
		case 'stage':
			return drawStage(n, w, h, t);
		case 'job':
			return drawJob(n, w, h, t);
		case 'artifact':
			return drawArtifact(n, w, h, t);
	}
}

/** Outline used for edge clipping. */
export function nodeOutline(n: RenderNode): 'rect' | 'diamond' | 'ellipse' {
	if (n.type === 'flow' && n.data.flowType === 'decision') return 'diamond';
	return 'rect';
}

// ------------------------------------------------------------------ edges

export const EDGE_LABEL = { size: 11, subSize: 10, padX: 4, padY: 2 };

export function edgeLabelSize(
	label?: string,
	sublabel?: string
): { width: number; height: number } {
	if (!label && !sublabel) return { width: 0, height: 0 };
	const w = Math.max(
		label ? textWidth(label, EDGE_LABEL.size) : 0,
		sublabel ? textWidth(`[${sublabel}]`, EDGE_LABEL.subSize) : 0
	);
	return {
		width: w + EDGE_LABEL.padX * 2,
		height: (label ? 14 : 0) + (sublabel ? 13 : 0) + EDGE_LABEL.padY * 2
	};
}

export function markerId(m: Marker): string {
	return `sdv-m-${m}`;
}

export function markerDefs(t: TokenResolver): SvgNode {
	const edge = t('edge');
	const bg = t('canvas-bg');
	const marker = (id: Marker, w: number, h: number, refX: number, shape: SvgNode) =>
		el(
			'marker',
			{
				id: markerId(id),
				viewBox: `0 0 ${w} ${h}`,
				refX,
				refY: h / 2,
				markerWidth: w,
				markerHeight: h,
				markerUnits: 'userSpaceOnUse',
				orient: 'auto-start-reverse'
			},
			shape
		);
	return el(
		'defs',
		{},
		marker('arrow', 10, 10, 10, el('path', { d: 'M 0 0 L 10 5 L 0 10 Z', fill: edge })),
		marker(
			'open-arrow',
			11,
			12,
			10,
			el('path', { d: 'M 1 1 L 10 6 L 1 11', fill: 'none', stroke: edge, 'stroke-width': 1.5 })
		),
		marker(
			'triangle',
			15,
			14,
			14,
			el('path', { d: 'M 1 1 L 14 7 L 1 13 Z', fill: bg, stroke: edge, 'stroke-width': 1.5 })
		),
		marker(
			'diamond',
			18,
			12,
			17,
			el('path', { d: 'M 1 6 L 9 1 L 17 6 L 9 11 Z', fill: bg, stroke: edge, 'stroke-width': 1.5 })
		),
		marker(
			'diamond-filled',
			18,
			12,
			17,
			el('path', {
				d: 'M 1 6 L 9 1 L 17 6 L 9 11 Z',
				fill: edge,
				stroke: edge,
				'stroke-width': 1.5
			})
		)
	);
}
