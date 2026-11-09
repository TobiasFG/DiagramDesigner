import type { TokenResolver } from '../theme/tokens';
import { markerId, svgText } from '../render/shapes';
import { el, pathD, type SvgNode } from '../render/svg';
import { textWidth, truncate } from '../render/text';
import { SEQ, type SeqColumn, type SequenceLayout } from './layout';

/** Small glyph for the participant's element kind, drawn in a 14x14 box at (x, y). */
function kindIcon(
	kind: string | undefined,
	x: number,
	y: number,
	t: TokenResolver
): SvgNode | null {
	const s = { fill: 'none', stroke: t('seq-header-stroke'), 'stroke-width': 1.3 };
	switch (kind) {
		case 'person':
			return el(
				'g',
				{},
				el('circle', { cx: x + 7, cy: y + 4, r: 3.5, ...s }),
				el('path', { d: pathD('M', x + 1, y + 14, 'Q', x + 7, y + 5, x + 13, y + 14), ...s })
			);
		case 'datastore':
			return el(
				'g',
				{},
				el('ellipse', { cx: x + 7, cy: y + 3, rx: 6, ry: 2.5, ...s }),
				el('path', {
					d: pathD(
						'M',
						x + 1,
						y + 3,
						'V',
						y + 12,
						'A',
						6,
						2.5,
						0,
						0,
						0,
						x + 13,
						y + 12,
						'V',
						y + 3
					),
					...s
				})
			);
		case 'queue':
			return el(
				'g',
				{},
				el('rect', { x: x, y: y + 3, width: 14, height: 8, rx: 4, ...s }),
				el('path', { d: pathD('M', x + 10, y + 3, 'V', y + 11), ...s })
			);
		case 'external':
			return el('rect', {
				x: x + 1,
				y: y + 1,
				width: 12,
				height: 12,
				rx: 2,
				...s,
				'stroke-dasharray': '2 2'
			});
		case undefined:
			return null;
		default:
			return el('rect', { x: x + 1, y: y + 2, width: 12, height: 10, rx: 2, ...s });
	}
}

export function drawHeader(c: SeqColumn, y: number, t: TokenResolver): SvgNode {
	const w = c.headerWidth;
	const x = c.x - w / 2;
	const hasIcon = !!c.participant.kind;
	const label = truncate(c.participant.label, w - (hasIcon ? 44 : 24), SEQ.headerSize, true);
	const lw = textWidth(label, SEQ.headerSize, true) + (hasIcon ? 20 : 0);
	const lx = c.x - lw / 2;
	return el(
		'g',
		{ class: 'sdv-seq-header' },
		el('rect', {
			x,
			y,
			width: w,
			height: SEQ.headerHeight - 8,
			rx: 4,
			fill: t('seq-header-fill'),
			stroke: t('seq-header-stroke'),
			'stroke-width': 1.5,
			'stroke-dasharray': c.participant.plain ? '4 3' : undefined
		}),
		hasIcon && kindIcon(c.participant.kind, lx, y + 11, t),
		svgText(hasIcon ? lx + 20 : c.x, y + 23, label, {
			size: SEQ.headerSize,
			bold: true,
			fill: t('text'),
			anchor: hasIcon ? 'start' : 'middle'
		})
	);
}

export function drawSequenceBody(layout: SequenceLayout, t: TokenResolver): SvgNode[] {
	const out: SvgNode[] = [];
	// Fragments first so everything else paints above them.
	for (const f of layout.fragments) {
		const kindW = textWidth(f.item.kind, 11, true) + 16;
		out.push(
			el(
				'g',
				{ class: 'sdv-seq-fragment' },
				el('rect', {
					x: f.x,
					y: f.y,
					width: f.width,
					height: f.height,
					fill: 'none',
					stroke: t('fragment-stroke'),
					'stroke-width': 1.2
				}),
				el('path', {
					d: pathD(
						'M',
						f.x,
						f.y,
						'H',
						f.x + kindW,
						'V',
						f.y + 12,
						'L',
						f.x + kindW - 6,
						f.y + 18,
						'H',
						f.x,
						'Z'
					),
					fill: t('fragment-label-fill'),
					stroke: t('fragment-stroke'),
					'stroke-width': 1.2
				}),
				svgText(f.x + 6, f.y + 13, f.item.kind, { size: 11, bold: true, fill: t('text') }),
				...f.branches.flatMap((b, i) => [
					i > 0 &&
						el('line', {
							x1: f.x,
							y1: b.y,
							x2: f.x + f.width,
							y2: b.y,
							stroke: t('fragment-stroke'),
							'stroke-width': 1,
							'stroke-dasharray': '5 4'
						}),
					b.label &&
						svgText(
							i === 0 ? f.x + kindW + 8 : f.x + 8,
							b.y + (i === 0 ? 13 : 16),
							`[${b.label}]`,
							{ size: 11, fill: t('text-muted') }
						)
				])
			)
		);
	}
	for (const c of layout.columns) {
		const top = c.headerY + SEQ.headerHeight - 8;
		out.push(
			el('line', {
				x1: c.x,
				y1: top,
				x2: c.x,
				y2: c.lifelineEnd,
				stroke: t('seq-lifeline'),
				'stroke-width': 1,
				'stroke-dasharray': '4 4',
				class: 'sdv-lifeline'
			})
		);
		if (c.destroyedAt !== undefined) {
			const d = 7;
			out.push(
				el('path', {
					d: pathD(
						'M',
						c.x - d,
						c.destroyedAt - d,
						'L',
						c.x + d,
						c.destroyedAt + d,
						'M',
						c.x + d,
						c.destroyedAt - d,
						'L',
						c.x - d,
						c.destroyedAt + d
					),
					stroke: t('text'),
					'stroke-width': 2
				})
			);
		}
	}
	for (const a of layout.activations) {
		out.push(
			el('rect', {
				x: a.x,
				y: a.y1,
				width: SEQ.activationWidth,
				height: Math.max(8, a.y2 - a.y1),
				fill: t('seq-activation-fill'),
				stroke: t('seq-header-stroke'),
				'stroke-width': 1,
				'stroke-dasharray': a.unbalanced ? '3 2' : undefined
			})
		);
	}
	for (const m of layout.messages) {
		const kind = m.item.kind;
		const dashed = kind === 'return' || kind === 'create';
		const marker =
			kind === 'async' || kind === 'return' || kind === 'create' ? 'open-arrow' : 'arrow';
		const attrs = {
			fill: 'none',
			stroke: t('edge'),
			'stroke-width': 1.5,
			'stroke-dasharray': dashed ? '6 4' : undefined,
			'marker-end': `url(#${markerId(marker)})`
		};
		if (m.self) {
			const x =
				m.x1 +
				(layout.activations.some((a) => a.participant === m.item.from && a.y1 <= m.y && a.y2 >= m.y)
					? SEQ.activationWidth / 2
					: 0);
			out.push(
				el('path', {
					d: pathD('M', x, m.y, 'H', x + 36, 'V', m.y + SEQ.selfExtra + 4, 'H', x + 2),
					...attrs
				})
			);
			out.push(svgText(x + 42, m.y + 4, m.item.label, { size: SEQ.labelSize, fill: t('text') }));
		} else {
			// Created participants: the arrow ends at their header box.
			const created =
				kind === 'create' ? layout.columns.find((c) => c.participant.id === m.item.to) : undefined;
			const x2 = created ? m.x2 - Math.sign(m.x2 - m.x1) * (created.headerWidth / 2) : m.x2;
			out.push(el('path', { d: pathD('M', m.x1, m.y, 'H', x2), ...attrs }));
			out.push(
				svgText((m.x1 + x2) / 2, m.y - 6, m.item.label, {
					size: SEQ.labelSize,
					fill: t('text'),
					anchor: 'middle'
				})
			);
		}
	}
	for (const n of layout.notes) {
		const f = 8;
		out.push(
			el(
				'g',
				{ class: 'sdv-seq-note' },
				el('path', {
					d: pathD(
						'M',
						n.x,
						n.y,
						'H',
						n.x + n.width - f,
						'L',
						n.x + n.width,
						n.y + f,
						'V',
						n.y + n.height,
						'H',
						n.x,
						'Z'
					),
					fill: t('note-fill'),
					stroke: t('note-stroke'),
					'stroke-width': 1.2
				}),
				...n.lines.map((line, i) =>
					svgText(n.x + n.width / 2, n.y + 18 + i * 15, line, {
						size: SEQ.labelSize,
						fill: t('note-text'),
						anchor: 'middle'
					})
				)
			)
		);
	}
	return out;
}

/** Headers of participants that exist from the start (created ones are drawn in the body). */
export function drawSequenceHeaders(
	layout: SequenceLayout,
	t: TokenResolver,
	y = SEQ.margin
): SvgNode[] {
	return layout.columns.map((c) => drawHeader(c, c.headerY === SEQ.margin ? y : c.headerY, t));
}
