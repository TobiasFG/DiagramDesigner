import { isGroupStep, isMessageStep, type Model, type ViewInfo } from '../model/model';
import type { LayoutFile, Step } from '../model/schema';
import type { DataPath } from '../model/diagnostics';
import type { SeqItem, SequenceGraph } from './types';

export function projectSequence(model: Model, view: ViewInfo, layout?: LayoutFile): SequenceGraph {
	const inter = view.def.source ? model.interactions.get(view.def.source) : undefined;
	const graph: SequenceGraph = {
		kind: 'sequence',
		viewId: view.id,
		viewType: 'sequence',
		title: view.title,
		description: view.def.description ?? inter?.def.description,
		interactionId: view.def.source ?? '',
		interactionRef: inter
			? { kind: 'interaction', file: inter.loc.file, path: inter.loc.path }
			: { kind: 'interaction', file: '', path: [] },
		participants: [],
		items: [],
		columns: layout?.columns ?? {},
		diagnostics: []
	};
	if (!inter) {
		graph.diagnostics.push({
			severity: 'error',
			code: 'view-source',
			message: `interaction "${view.def.source}" not found`
		});
		return graph;
	}
	const { file } = inter.loc;
	const owner = inter.id;
	graph.participants = inter.def.participants.map((id, i) => {
		const el = model.elements.get(id);
		return {
			id,
			label: el?.name ?? id,
			kind: el?.def.kind,
			plain: !el,
			ref: el
				? { kind: 'element', file: el.loc.file, path: el.loc.path }
				: { kind: 'interaction', file, path: [...inter.loc.path, 'participants', i] }
		};
	});
	const parts = new Set(inter.def.participants);
	const convert = (steps: Step[], base: DataPath): SeqItem[] =>
		steps.flatMap((step, i): SeqItem[] => {
			const path = [...base, i];
			const ref = { file, path: [...inter.loc.path, ...path], owner };
			if (isGroupStep(step)) {
				return [
					{
						type: 'group',
						kind: step.group,
						path,
						ref: { kind: 'group', ...ref },
						branches: [
							{ label: step.label, items: convert(step.steps, [...path, 'steps']) },
							...(step.else ?? []).map((b, j) => ({
								label: b.label,
								items: convert(b.steps, [...path, 'else', j, 'steps'])
							}))
						]
					}
				];
			}
			if (isMessageStep(step)) {
				if (!parts.has(step.from) || !parts.has(step.to)) return [];
				return [
					{
						type: 'message',
						from: step.from,
						to: step.to,
						label: step.msg ?? '',
						kind: step.kind ?? (step.from === step.to ? 'self' : 'sync'),
						activate: step.activate ?? false,
						path,
						ref: { kind: 'message', ...ref }
					}
				];
			}
			const over = (Array.isArray(step.over) ? step.over : [step.over]).filter((p) => parts.has(p));
			if (!over.length) return [];
			return [{ type: 'note', over, text: step.note, path, ref: { kind: 'note', ...ref } }];
		});
	graph.items = convert(inter.def.steps, ['steps']);
	return graph;
}
