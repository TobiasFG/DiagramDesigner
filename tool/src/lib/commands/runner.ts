import { enablePatches, produceWithPatches, type Patch } from 'immer';
import { fileKind } from '../model/parse';
import { issueMessage, validateFile } from '../model/validate-file';
import { CommandError, type Command, type CommandContext, type DesignData } from './core';

enablePatches();

export interface Applied {
	next: DesignData;
	patches: Patch[];
	inverse: Patch[];
}

/**
 * Runs a command against the data and validates every touched file after application:
 * a command may not introduce schema errors (the message names the field).
 */
export function applyCommand(data: DesignData, cmd: Command, ctx: CommandContext): Applied {
	const [next, patches, inverse] = produceWithPatches(data, (draft) => {
		cmd.run(draft, ctx);
	});
	for (const file of touchedFiles(patches)) {
		const kind = fileKind(file);
		if (!kind || next[file] === undefined) continue;
		const known = new Set(validateFile(kind, data[file]).issues.map(issueMessage));
		const introduced = validateFile(kind, next[file])
			.issues.map(issueMessage)
			.filter((m) => !known.has(m));
		if (introduced.length) throw new CommandError(`${file}: ${introduced.join('; ')}`);
	}
	return { next, patches, inverse };
}

export function touchedFiles(patches: Patch[]): string[] {
	return [...new Set(patches.map((p) => String(p.path[0])))].sort();
}

/** Splits design-level patches into per-file patches with file-relative paths. */
export function patchesByFile(patches: Patch[]): Map<string, Patch[]> {
	const out = new Map<string, Patch[]>();
	for (const p of patches) {
		const file = String(p.path[0]);
		if (!out.has(file)) out.set(file, []);
		out.get(file)!.push({ ...p, path: p.path.slice(1) });
	}
	return out;
}
