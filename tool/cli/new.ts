import { randomInt } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { entityKind } from '../src/lib/model/parse';
import { ENTITY_KINDS } from '../src/lib/model/schema';
import type { CliIO } from './sdv';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const CHARS = LETTERS + '0123456789';

/** 10 characters, starting with a letter so it is also a valid kebab-case id. */
function generateId(): string {
	let id = LETTERS[randomInt(LETTERS.length)];
	while (id.length < 10) id += CHARS[randomInt(CHARS.length)];
	return id;
}

export async function runNew(
	positionals: string[],
	parent: string | undefined,
	io: CliIO,
	cwd: string
): Promise<number> {
	const [file] = positionals;
	const kind = file && entityKind(file);
	if (!kind || !(ENTITY_KINDS as readonly string[]).includes(kind)) {
		io.error(`usage: sdv new <name>.<kind>.yaml [--parent id]; kind is ${ENTITY_KINDS.join(', ')}`);
		return 2;
	}
	const abs = path.resolve(cwd, file);
	if (existsSync(abs)) {
		io.error(`${file} already exists`);
		return 1;
	}
	const lines = [`id: ${generateId()}`];
	if (parent) lines.push(`parent: ${parent}`);
	lines.push(`name: ${path.basename(file).split('.')[0]}`);
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, lines.join('\n') + '\n');
	io.log(`created ${path.relative(cwd, abs)}`);
	return 0;
}
