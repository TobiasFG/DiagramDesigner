import type {
	ClassNode,
	Projection,
	RenderEdge,
	RenderGraph,
	RenderNode,
	SeqItem,
	SequenceGraph
} from '../projections/types';
import { classStereotype, elementMeta } from '../render/shapes';
import { THEMES } from '../theme/tokens';

export interface MermaidResult {
	text: string;
	/** Features that Mermaid cannot express and were dropped. */
	warnings: string[];
}

const RESERVED = new Set([
	'end',
	'graph',
	'flowchart',
	'subgraph',
	'style',
	'class',
	'classdef',
	'click',
	'default',
	'linkstyle',
	'direction',
	'participant',
	'actor',
	'note',
	'loop',
	'alt',
	'else',
	'opt',
	'par',
	'and',
	'critical',
	'option',
	'break',
	'rect',
	'activate',
	'deactivate',
	'create',
	'destroy',
	'box'
]);

/** Maps model ids to Mermaid-safe, unique identifiers. */
export function idSanitizer(): (id: string) => string {
	const map = new Map<string, string>();
	const used = new Set<string>();
	return (id) => {
		const known = map.get(id);
		if (known) return known;
		let safe = id.replace(/[^A-Za-z0-9_]/g, '_');
		if (/^[0-9]/.test(safe) || RESERVED.has(safe.toLowerCase())) safe = `n_${safe}`;
		let candidate = safe;
		for (let i = 2; used.has(candidate); i++) candidate = `${safe}_${i}`;
		used.add(candidate);
		map.set(id, candidate);
		return candidate;
	};
}

/** Text inside `"..."` labels. */
function q(text: string): string {
	return text.replace(/"/g, '#quot;').replace(/\n/g, '<br/>');
}

/** Free text after `:` in class and sequence diagrams. */
function freeText(text: string): string {
	return text.replace(/[#;\n]/g, (c) => (c === '#' ? '#35;' : c === ';' ? '#59;' : ' '));
}

/** Class members: Mermaid reads a leading + - # ~ as visibility, glued to the name. */
function memberText(text: string): string {
	return text.replace(/^([+\-#~]) /, '$1').replace(/[;\n]/g, ' ');
}

const FLOW_DIR: Record<string, string> = { DOWN: 'TD', UP: 'BT', RIGHT: 'LR', LEFT: 'RL' };

function edgeArrow(edge: RenderEdge): string {
	const dashed = edge.data.dashed || edge.data.back;
	if (edge.data.markerEnd === 'none') return dashed ? '-.-' : '---';
	return dashed ? '-.->' : '-->';
}

function edgeLine(edge: RenderEdge, id: (s: string) => string): string {
	const parts = [
		edge.data.label,
		edge.data.sublabel ? `[${edge.data.sublabel}]` : undefined
	].filter(Boolean);
	let label = parts.join('<br/>');
	if (edge.data.count && edge.data.count > 1)
		label = label ? `${label} (${edge.data.count})` : `${edge.data.count} relationships`;
	const arrow = edgeArrow(edge);
	return label
		? `  ${id(edge.source)} ${arrow}|"${q(label)}"| ${id(edge.target)}`
		: `  ${id(edge.source)} ${arrow} ${id(edge.target)}`;
}

function flowchartNode(node: RenderNode, id: (s: string) => string): string {
	const n = id(node.id);
	switch (node.type) {
		case 'element': {
			const label = q(`${node.data.label}\n${elementMeta(node.data.kind, node.data.technology)}`);
			if (node.data.kind === 'person') return `${n}(["${label}"])`;
			if (node.data.kind === 'datastore') return `${n}[("${label}")]`;
			if (node.data.kind === 'queue') return `${n}>"${label}"]`;
			return `${n}["${label}"]`;
		}
		case 'flow': {
			const label = q(node.data.label);
			switch (node.data.flowType) {
				case 'start':
				case 'end':
					return `${n}(["${label}"])`;
				case 'decision':
					return `${n}{"${label}"}`;
				case 'io':
					return `${n}[/"${label}"/]`;
				case 'subflow':
					return `${n}[["${label}"]]`;
				default:
					return `${n}("${label}")`;
			}
		}
		case 'job':
			return `${n}["${q(node.data.label)}"]`;
		case 'artifact':
			return `${n}>"${q(node.data.label)}"]`;
		default:
			return `${n}["${q('label' in node.data ? node.data.label : node.id)}"]`;
	}
}

function groupLabel(node: RenderNode): string {
	if (node.type === 'boundary')
		return `${node.data.label}\n${elementMeta(node.data.kind, node.data.technology)}`;
	return 'label' in node.data ? node.data.label : node.id;
}

function flowchart(graph: RenderGraph, warnings: string[]): string {
	const id = idSanitizer();
	const lines = [`flowchart ${FLOW_DIR[graph.layout.direction] ?? 'TD'}`];
	const children = new Map<string | undefined, RenderNode[]>();
	for (const n of graph.nodes) {
		if (!children.has(n.parentId)) children.set(n.parentId, []);
		children.get(n.parentId)!.push(n);
	}
	const emit = (parent: string | undefined, indent: string) => {
		for (const n of children.get(parent) ?? []) {
			if (n.isGroup) {
				lines.push(`${indent}subgraph ${id(n.id)}["${q(groupLabel(n))}"]`);
				emit(n.id, indent + '  ');
				lines.push(`${indent}end`);
			} else lines.push(indent + flowchartNode(n, id));
		}
	};
	emit(undefined, '  ');
	for (const e of graph.edges) lines.push(edgeLine(e, id));

	// Colours per kind / status, taken from the light theme tokens.
	const tokens = THEMES.light;
	const classes = new Map<string, string[]>();
	const assign = (cls: string, nodeId: string) => {
		if (!classes.has(cls)) classes.set(cls, []);
		classes.get(cls)!.push(id(nodeId));
	};
	for (const n of graph.nodes) {
		if (n.type === 'element') assign(n.data.kind, n.id);
		else if (n.type === 'boundary') assign('boundary', n.id);
		else if (n.type === 'job' && n.data.status)
			assign(`status_${n.data.status.toLowerCase().replace(/[^a-z0-9]/g, '_')}`, n.id);
		else if (n.type === 'flow' && (n.data.flowType === 'start' || n.data.flowType === 'end'))
			assign(`flow_${n.data.flowType}`, n.id);
	}
	const def = (cls: string): string | undefined => {
		// Mermaid separates style properties with commas, so no rgba() values here.
		if (cls === 'boundary')
			return `fill:none,stroke:${tokens['boundary-stroke']},stroke-dasharray:6 4,color:${tokens['boundary-text']}`;
		const t = tokens as Record<string, string>;
		if (`${cls}-fill` in t)
			return `fill:${t[`${cls}-fill`]},stroke:${t[`${cls}-stroke`]},color:${t[`${cls}-text`]}`;
		if (cls === 'flow_start')
			return `fill:${tokens['flow-terminal-fill']},stroke:none,color:${tokens['flow-terminal-text']}`;
		if (cls === 'flow_end')
			return `fill:${tokens['flow-end-fill']},stroke:none,color:${tokens['flow-terminal-text']}`;
		if (cls.startsWith('status_')) {
			const status = {
				success: 'status-success',
				passed: 'status-success',
				failed: 'status-failed',
				failure: 'status-failed',
				running: 'status-running',
				pending: 'status-pending',
				skipped: 'status-pending'
			}[cls.slice(7)];
			return status
				? `stroke:${tokens[status as keyof typeof tokens]},stroke-width:2px`
				: undefined;
		}
		return undefined;
	};
	for (const [cls, ids] of [...classes].sort(([a], [b]) => a.localeCompare(b))) {
		const style = def(cls);
		if (!style) continue;
		lines.push(`  classDef ${cls} ${style}`);
		lines.push(`  class ${ids.join(',')} ${cls}`);
	}
	if (graph.layout.lanes)
		warnings.push('swimlanes rendered as subgraphs; Mermaid cannot align lanes');
	if (graph.edges.some((e) => e.data.back)) warnings.push('back-edges rendered as dotted links');
	if (graph.edges.some((e) => e.type === 'aggregated' && (e.data.count ?? 0) > 1))
		warnings.push('aggregated edge counts rendered in the label');
	return lines.join('\n');
}

const CLASS_DIR: Record<string, string> = { DOWN: 'TB', UP: 'BT', RIGHT: 'LR', LEFT: 'RL' };

function classMembers(node: ClassNode): string[] {
	const out: string[] = [];
	const stereo =
		classStereotype(node.data) ?? (node.data.classKind === 'abstract' ? '«abstract»' : undefined);
	if (stereo) out.push(`<<${stereo.slice(1, -1)}>>`);
	const d = node.data;
	if (d.classKind === 'enum') out.push(...d.values);
	if (d.showAttributes) out.push(...d.attributes.map((a) => a.text + (a.static ? '$' : '')));
	if (d.showMethods) {
		// Mermaid reads the text after ")" as the return type, so drop the colon.
		out.push(
			...d.methods.map(
				(m) => m.text.replace(/\):\s*/, ') ') + (m.abstract ? '*' : m.static ? '$' : '')
			)
		);
	}
	return out;
}

const RELATION_ARROWS: Record<string, { arrow: string; reverse: boolean }> = {
	inheritance: { arrow: '<|--', reverse: true },
	realization: { arrow: '..|>', reverse: false },
	composition: { arrow: '*--', reverse: false },
	aggregation: { arrow: 'o--', reverse: false },
	association: { arrow: '--', reverse: false },
	dependency: { arrow: '..>', reverse: false }
};

function classDiagram(graph: RenderGraph, warnings: string[]): string {
	const id = idSanitizer();
	const lines = ['classDiagram', `  direction ${CLASS_DIR[graph.layout.direction] ?? 'TB'}`];
	for (const n of graph.nodes) {
		if (n.type === 'class') {
			const members = classMembers(n);
			lines.push(`  class ${id(n.id)}["${q(n.data.label)}"]${members.length ? ' {' : ''}`);
			if (members.length) {
				for (const m of members) lines.push(`    ${m.startsWith('<<') ? m : memberText(m)}`);
				lines.push('  }');
			}
			if (n.data.more.attributes || n.data.more.methods || n.data.more.values)
				warnings.push(`class "${n.id}" has truncated compartments`);
		} else if (n.type === 'object') {
			lines.push(`  class ${id(n.id)}["${q(n.data.label)}"]${n.data.rows.length ? ' {' : ''}`);
			if (n.data.rows.length) {
				for (const r of n.data.rows) lines.push(`    ${memberText(`${r.name} = ${r.value}`)}`);
				lines.push('  }');
			}
		}
	}
	for (const e of graph.edges) {
		const label = e.data.label ? ` : ${freeText(e.data.label)}` : '';
		if (e.type === 'link') {
			lines.push(`  ${id(e.source)} -- ${id(e.target)}${label}`);
			continue;
		}
		const spec = RELATION_ARROWS[e.data.relationType ?? 'association'];
		const [left, right] = spec.reverse ? [e.target, e.source] : [e.source, e.target];
		const [lm, rm] = spec.reverse
			? [e.data.endLabel, e.data.startLabel]
			: [e.data.startLabel, e.data.endLabel];
		lines.push(
			`  ${id(left)}${lm ? ` "${q(lm)}"` : ''} ${spec.arrow}${rm ? ` "${q(rm)}"` : ''} ${id(right)}${label}`
		);
	}
	return lines.join('\n');
}

function sequenceDiagram(graph: SequenceGraph, warnings: string[]): string {
	const id = idSanitizer();
	const lines = ['sequenceDiagram'];
	const created = new Set<string>();
	const firstKinds = new Map<string, string>();
	const scan = (items: SeqItem[]) => {
		for (const it of items) {
			if (it.type === 'message' && !firstKinds.has(it.to)) firstKinds.set(it.to, it.kind);
			if (it.type === 'group') it.branches.forEach((b) => scan(b.items));
		}
	};
	scan(graph.items);
	for (const p of graph.participants) {
		// Created participants are declared at their creating message.
		if (firstKinds.get(p.id) === 'create') continue;
		lines.push(
			`  ${p.kind === 'person' ? 'actor' : 'participant'} ${id(p.id)} as ${freeText(p.label)}`
		);
	}
	const active = new Map<string, string[]>();
	const ARROWS: Record<string, string> = {
		sync: '->>',
		self: '->>',
		async: '-)',
		return: '-->>',
		create: '->>',
		destroy: '->>'
	};
	const emit = (items: SeqItem[], indent: string) => {
		for (const it of items) {
			if (it.type === 'message') {
				if (it.kind === 'create' && !created.has(it.to)) {
					created.add(it.to);
					const p = graph.participants.find((x) => x.id === it.to)!;
					lines.push(
						`${indent}create ${p.kind === 'person' ? 'actor' : 'participant'} ${id(it.to)} as ${freeText(p.label)}`
					);
				}
				if (it.kind === 'destroy') lines.push(`${indent}destroy ${id(it.to)}`);
				lines.push(`${indent}${id(it.from)}${ARROWS[it.kind]}${id(it.to)}: ${freeText(it.label)}`);
				if (it.kind === 'return') {
					const stack = active.get(it.from);
					if (stack?.length && stack[stack.length - 1] === it.to) {
						stack.pop();
						lines.push(`${indent}deactivate ${id(it.from)}`);
					}
				}
				if (it.activate) {
					if (!active.has(it.to)) active.set(it.to, []);
					active.get(it.to)!.push(it.from);
					lines.push(`${indent}activate ${id(it.to)}`);
				}
			} else if (it.type === 'note') {
				lines.push(`${indent}Note over ${it.over.map(id).join(',')}: ${freeText(it.text)}`);
			} else {
				const branchWord: Record<string, string | undefined> = {
					alt: 'else',
					par: 'and',
					critical: 'option'
				};
				it.branches.forEach((b, i) => {
					if (i === 0) lines.push(`${indent}${it.kind}${b.label ? ` ${freeText(b.label)}` : ''}`);
					else if (branchWord[it.kind])
						lines.push(`${indent}${branchWord[it.kind]}${b.label ? ` ${freeText(b.label)}` : ''}`);
					else {
						warnings.push(
							`"${it.kind}" group cannot have else branches in Mermaid; branch ${i} dropped`
						);
						return;
					}
					emit(b.items, indent + '  ');
				});
				lines.push(`${indent}end`);
			}
		}
	};
	emit(graph.items, '  ');
	return lines.join('\n');
}

export function toMermaid(p: Projection): MermaidResult {
	const warnings: string[] = [];
	let body: string;
	if (p.kind === 'sequence') body = sequenceDiagram(p, warnings);
	else if (p.viewType === 'class' || p.viewType === 'object') body = classDiagram(p, warnings);
	else body = flowchart(p, warnings);
	const title = p.title.replace(/\n/g, ' ');
	return {
		text: `---\ntitle: ${JSON.stringify(title)}\n---\n${body}\n`,
		warnings: [...new Set(warnings)]
	};
}

export function mermaidFence(text: string): string {
	return '```mermaid\n' + text + '```\n';
}
