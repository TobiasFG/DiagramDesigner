import type { Draft } from 'immer';
import type { DataPath } from '../model/diagnostics';
import { isGroupStep, isMessageStep } from '../model/model';
import type { GroupStep, Interaction, Step } from '../model/schema';
import { fail, getAt, type Command, type CommandContext, type DesignData } from './core';

function interactionDraft(
	draft: Draft<DesignData>,
	ctx: CommandContext,
	id: string
): { inter: Draft<Interaction>; file: string; base: DataPath } {
	const info = ctx.model.interactions.get(id) ?? fail(`unknown interaction "${id}"`);
	return {
		inter: getAt<Draft<Interaction>>(draft, info.loc.file, info.loc.path),
		file: info.loc.file,
		base: info.loc.path
	};
}

/** Steps list at a path relative to the interaction (e.g. ['steps'] or ['steps', 4, 'else', 0, 'steps']). */
function stepList(
	draft: Draft<DesignData>,
	file: string,
	base: DataPath,
	list: DataPath
): Draft<Step>[] {
	const arr = getAt<Draft<Step>[]>(draft, file, [...base, ...list]);
	if (!Array.isArray(arr)) fail('not a list of steps');
	return arr;
}

export function addParticipant(
	interactionId: string,
	participant: string,
	index?: number
): Command {
	return {
		label: `Add participant ${participant}`,
		run(draft, ctx) {
			const { inter } = interactionDraft(draft, ctx, interactionId);
			if (inter.participants.includes(participant))
				fail(`"${participant}" is already a participant`);
			inter.participants.splice(index ?? inter.participants.length, 0, participant);
		}
	};
}

export function moveParticipant(interactionId: string, participant: string, to: number): Command {
	return {
		label: `Move participant ${participant}`,
		run(draft, ctx) {
			const { inter } = interactionDraft(draft, ctx, interactionId);
			const from = inter.participants.indexOf(participant);
			if (from < 0) fail(`unknown participant "${participant}"`);
			inter.participants.splice(from, 1);
			inter.participants.splice(
				Math.max(0, Math.min(to, inter.participants.length)),
				0,
				participant
			);
		}
	};
}

/** Removes steps (recursively) that involve `participant`; notes lose it from `over`. */
export function pruneSteps(steps: Draft<Step>[], participant: string) {
	for (let i = steps.length - 1; i >= 0; i--) {
		const s = steps[i];
		if (isMessageStep(s)) {
			if (s.from === participant || s.to === participant) steps.splice(i, 1);
		} else if (isGroupStep(s)) {
			pruneSteps(s.steps, participant);
			s.else?.forEach((b) => pruneSteps(b.steps, participant));
			// A fragment left without any steps says nothing.
			if (!s.steps.length && !s.else?.some((b) => b.steps.length)) steps.splice(i, 1);
		} else {
			const over = Array.isArray(s.over)
				? s.over.filter((p) => p !== participant)
				: s.over === participant
					? []
					: [s.over];
			if (!over.length) steps.splice(i, 1);
			else s.over = over.length === 1 ? over[0] : over;
		}
	}
}

export function removeParticipant(interactionId: string, participant: string): Command {
	return {
		label: `Remove participant ${participant}`,
		run(draft, ctx) {
			const { inter } = interactionDraft(draft, ctx, interactionId);
			const i = inter.participants.indexOf(participant);
			if (i < 0) fail(`unknown participant "${participant}"`);
			inter.participants.splice(i, 1);
			pruneSteps(inter.steps, participant);
		}
	};
}

export function insertStep(
	interactionId: string,
	list: DataPath,
	index: number,
	step: Step
): Command {
	return {
		label: 'from' in step ? 'Insert message' : 'note' in step ? 'Add note' : 'Insert step',
		run(draft, ctx) {
			const { file, base } = interactionDraft(draft, ctx, interactionId);
			const steps = stepList(draft, file, base, list);
			steps.splice(Math.min(index, steps.length), 0, step as Draft<Step>);
		}
	};
}

export function removeStep(interactionId: string, path: DataPath): Command {
	return {
		label: 'Remove step',
		run(draft, ctx) {
			const { file, base } = interactionDraft(draft, ctx, interactionId);
			const steps = stepList(draft, file, base, path.slice(0, -1));
			steps.splice(path[path.length - 1] as number, 1);
		}
	};
}

/** Drag-reorder: moves the step at `from` to position `index` of the list `toList`. */
export function moveStep(
	interactionId: string,
	from: DataPath,
	toList: DataPath,
	index: number
): Command {
	return {
		label: 'Reorder step',
		run(draft, ctx) {
			const { file, base } = interactionDraft(draft, ctx, interactionId);
			const src = stepList(draft, file, base, from.slice(0, -1));
			const dst = stepList(draft, file, base, toList);
			const fromIndex = from[from.length - 1] as number;
			const moving = src[fromIndex];
			if (!moving) fail('no step to move');
			// A group cannot be moved into itself.
			const fromKey = JSON.stringify(from);
			if (JSON.stringify(toList.slice(0, from.length)) === fromKey)
				fail('cannot move a group into itself');
			src.splice(fromIndex, 1);
			const adjusted = src === dst && fromIndex < index ? index - 1 : index;
			dst.splice(Math.min(adjusted, dst.length), 0, moving);
		}
	};
}

/** Wraps steps [start, end) of one list in a combined fragment. */
export function wrapSteps(
	interactionId: string,
	list: DataPath,
	start: number,
	end: number,
	group: GroupStep['group'],
	label?: string
): Command {
	return {
		label: `Wrap in ${group}`,
		run(draft, ctx) {
			const { file, base } = interactionDraft(draft, ctx, interactionId);
			const steps = stepList(draft, file, base, list);
			if (start < 0 || end > steps.length || start >= end)
				fail('select consecutive steps to group');
			const inner = steps.splice(start, end - start);
			const g: Draft<GroupStep> = { group, steps: inner };
			if (label) g.label = label;
			steps.splice(start, 0, g);
		}
	};
}
