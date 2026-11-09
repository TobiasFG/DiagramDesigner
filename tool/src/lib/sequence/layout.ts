import type { DataPath } from '../model/diagnostics';
import type {
	SeqGroup,
	SeqItem,
	SeqMessage,
	SeqNote,
	SeqParticipant,
	SequenceGraph
} from '../projections/types';
import { textWidth, wrapText } from '../render/text';

/**
 * Deterministic sequence layout: column x from cumulative widths (widened to fit message
 * labels), rows stacked top to bottom. Pure, shared by the canvas and the SVG exporter.
 */

export const SEQ = {
	rowHeight: 40,
	selfExtra: 18,
	headerHeight: 44,
	minColumn: 140,
	margin: 16,
	groupHeader: 30,
	groupFooter: 12,
	activationWidth: 10,
	labelSize: 12,
	headerSize: 13
};

export interface SeqColumn {
	participant: SeqParticipant;
	index: number;
	/** Lifeline x. */
	x: number;
	width: number;
	headerWidth: number;
	/** Top of the header box (lower than 0 for created participants). */
	headerY: number;
	lifelineEnd: number;
	destroyedAt?: number;
}

export interface SeqMessageLayout {
	item: SeqMessage;
	y: number;
	x1: number;
	x2: number;
	self: boolean;
	/** Order among all messages, for keyboard navigation and reordering. */
	index: number;
}

export interface SeqActivationLayout {
	participant: string;
	x: number;
	y1: number;
	y2: number;
	unbalanced: boolean;
}

export interface SeqFragmentLayout {
	item: SeqGroup;
	x: number;
	y: number;
	width: number;
	height: number;
	depth: number;
	branches: { label?: string; y: number }[];
}

export interface SeqNoteLayout {
	item: SeqNote;
	x: number;
	y: number;
	width: number;
	height: number;
	lines: string[];
}

/** An insertion point between steps, for "insert message at row". */
export interface SeqSlot {
	y: number;
	/** Path of the steps list, relative to the interaction. */
	list: DataPath;
	index: number;
	depth: number;
}

export interface SequenceLayout {
	graph: SequenceGraph;
	columns: SeqColumn[];
	messages: SeqMessageLayout[];
	activations: SeqActivationLayout[];
	fragments: SeqFragmentLayout[];
	notes: SeqNoteLayout[];
	slots: SeqSlot[];
	width: number;
	height: number;
}

function participantsIn(items: SeqItem[], out = new Set<string>()): Set<string> {
	for (const item of items) {
		if (item.type === 'message') {
			out.add(item.from);
			out.add(item.to);
		} else if (item.type === 'note') item.over.forEach((p) => out.add(p));
		else item.branches.forEach((b) => participantsIn(b.items, out));
	}
	return out;
}

function walkMessages(items: SeqItem[], visit: (m: SeqMessage) => void) {
	for (const item of items) {
		if (item.type === 'message') visit(item);
		else if (item.type === 'group') item.branches.forEach((b) => walkMessages(b.items, visit));
	}
}

export function layoutSequence(graph: SequenceGraph): SequenceLayout {
	const parts = graph.participants;
	const index = new Map(parts.map((p, i) => [p.id, i]));

	// ------------------------------------------------ columns
	const widths = parts.map((p) => {
		const headerWidth = Math.max(
			100,
			textWidth(p.label, SEQ.headerSize, true) + 28 + (p.kind ? 20 : 0)
		);
		return { headerWidth, width: graph.columns[p.id] ?? Math.max(SEQ.minColumn, headerWidth + 24) };
	});
	// gaps[i] = distance between lifeline i and i+1.
	const gaps = parts.slice(1).map((_, i) => (widths[i].width + widths[i + 1].width) / 2);
	let selfRight = 0;
	walkMessages(graph.items, (m) => {
		const a = index.get(m.from)!;
		const b = index.get(m.to)!;
		const need = textWidth(m.label, SEQ.labelSize) + 32;
		if (a === b) {
			if (a < gaps.length) gaps[a] = Math.max(gaps[a], need + 20);
			else selfRight = Math.max(selfRight, need);
			return;
		}
		const lo = Math.min(a, b);
		const hi = Math.max(a, b);
		const span = gaps.slice(lo, hi).reduce((s, g) => s + g, 0);
		if (span < need) gaps[hi - 1] += need - span;
	});
	const xs: number[] = [];
	let x = SEQ.margin + widths[0]?.width / 2 || SEQ.margin;
	parts.forEach((_, i) => {
		xs.push(Math.round(x));
		if (i < gaps.length) x += gaps[i];
	});

	// ------------------------------------------------ rows
	const messages: SeqMessageLayout[] = [];
	const fragments: SeqFragmentLayout[] = [];
	const notes: SeqNoteLayout[] = [];
	const slots: SeqSlot[] = [];
	const created = new Map<string, number>();
	const destroyed = new Map<string, number>();
	const fullLeft = parts.length ? xs[0] - widths[0].width / 2 + 4 : SEQ.margin;
	const fullRight = parts.length
		? xs[xs.length - 1] + widths[widths.length - 1].width / 2 - 4
		: SEQ.margin + 200;
	let y = SEQ.margin + SEQ.headerHeight + 16;
	let messageIndex = 0;

	const place = (items: SeqItem[], list: DataPath, depth: number) => {
		items.forEach((item, i) => {
			slots.push({ y, list, index: i, depth });
			if (item.type === 'message') {
				const a = index.get(item.from)!;
				const b = index.get(item.to)!;
				const self = a === b;
				const my = y + 18;
				messages.push({ item, y: my, x1: xs[a], x2: xs[b], self, index: messageIndex++ });
				if (item.kind === 'create' && !created.has(item.to)) created.set(item.to, my);
				if (item.kind === 'destroy' && !destroyed.has(item.to)) destroyed.set(item.to, my);
				y += SEQ.rowHeight + (self ? SEQ.selfExtra : 0);
			} else if (item.type === 'note') {
				const cols = item.over.map((p) => index.get(p)!).sort((p, q) => p - q);
				const lo = xs[cols[0]];
				const hi = xs[cols[cols.length - 1]];
				const width = Math.max(
					hi - lo + 80,
					Math.min(textWidth(item.text, SEQ.labelSize) + 20, 240),
					120
				);
				const lines = wrapText(item.text, width - 16, SEQ.labelSize);
				const height = lines.length * 15 + 12;
				notes.push({
					item,
					x: Math.round((lo + hi) / 2 - width / 2),
					y: y + 4,
					width: Math.round(width),
					height,
					lines
				});
				y += height + 16;
			} else {
				const involved = [...participantsIn([item])]
					.map((p) => index.get(p)!)
					.filter((n) => n !== undefined);
				const inset = depth * 8;
				let left = fullLeft + inset;
				let right = fullRight - inset;
				if (involved.length) {
					const lo = Math.min(...involved);
					const hi = Math.max(...involved);
					left = Math.max(fullLeft, xs[lo] - Math.min(widths[lo].width / 2 - 4, 60)) + inset;
					right = Math.min(fullRight, xs[hi] + Math.min(widths[hi].width / 2 - 4, 60)) - inset;
				}
				const top = y;
				const branches: SeqFragmentLayout['branches'] = [];
				item.branches.forEach((branch, bi) => {
					branches.push({ label: branch.label, y });
					y += SEQ.groupHeader;
					place(
						branch.items,
						bi === 0 ? [...item.path, 'steps'] : [...item.path, 'else', bi - 1, 'steps'],
						depth + 1
					);
				});
				y += SEQ.groupFooter;
				fragments.push({
					item,
					x: Math.round(left),
					y: top,
					width: Math.round(right - left),
					height: y - top,
					depth,
					branches
				});
				y += 8;
			}
		});
		slots.push({ y, list, index: items.length, depth });
	};
	place(graph.items, ['steps'], 0);
	const bottom = y + 8;

	const columns: SeqColumn[] = parts.map((participant, i) => ({
		participant,
		index: i,
		x: xs[i],
		width: widths[i].width,
		headerWidth: widths[i].headerWidth,
		headerY: created.has(participant.id)
			? created.get(participant.id)! - SEQ.headerHeight / 2
			: SEQ.margin,
		lifelineEnd: destroyed.get(participant.id) ?? bottom,
		destroyedAt: destroyed.get(participant.id)
	}));

	// ------------------------------------------------ activations
	const activations: SeqActivationLayout[] = [];
	const stacks = new Map<string, { from: string; y: number }[]>();
	const level = (p: string) => stacks.get(p)?.length ?? 0;
	const barX = (p: string, lvl: number) =>
		xs[index.get(p)!] - SEQ.activationWidth / 2 + (lvl - 1) * 5;
	for (const m of messages) {
		const { from, to, kind, activate } = m.item;
		// Attach arrows to the edge of active bars.
		const dir = Math.sign(m.x2 - m.x1) || 1;
		if (level(from)) m.x1 += dir * (SEQ.activationWidth / 2 + (level(from) - 1) * 5);
		if (kind === 'return') {
			const stack = stacks.get(from);
			const top = stack?.[stack.length - 1];
			if (top && top.from === to) {
				activations.push({
					participant: from,
					x: barX(from, stack!.length),
					y1: top.y,
					y2: m.y,
					unbalanced: false
				});
				stack!.pop();
			}
		}
		if (activate) {
			if (!stacks.has(to)) stacks.set(to, []);
			stacks.get(to)!.push({ from, y: m.y });
		}
		if (level(to) && !m.self) m.x2 -= dir * (SEQ.activationWidth / 2 + (level(to) - 1) * 5);
	}
	for (const [p, stack] of stacks) {
		stack.forEach((a, i) =>
			activations.push({
				participant: p,
				x: barX(p, i + 1),
				y1: a.y,
				y2: bottom - 8,
				unbalanced: true
			})
		);
	}
	activations.sort((a, b) => a.y1 - b.y1 || a.x - b.x);

	const width = Math.round(
		Math.max(fullRight + SEQ.margin + selfRight, ...notes.map((n) => n.x + n.width + SEQ.margin))
	);
	return {
		graph,
		columns,
		messages,
		activations,
		fragments,
		notes,
		slots,
		width,
		height: bottom + SEQ.margin
	};
}
