import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { LayoutFile, ModelFile, Text, ViewFile } from '../src/lib/model/schema';
import type { CliIO } from './sdv';

export function jsonSchemas(): Record<string, unknown> {
	const gen = (schema: z.ZodType, title: string) => ({
		...z.toJSONSchema(schema, {
			target: 'draft-2020-12',
			unrepresentable: 'any',
			// Text fields accept YAML numbers (msg: 402) and read them as strings.
			override: ({ zodSchema, jsonSchema }) => {
				if (zodSchema === Text) jsonSchema.type = ['string', 'number'];
			}
		}),
		title
	});
	return {
		'model.schema.json': gen(ModelFile, 'System Design Viewer model file'),
		'view.schema.json': gen(ViewFile, 'System Design Viewer view file'),
		'layout.schema.json': gen(LayoutFile, 'System Design Viewer layout file')
	};
}

export async function runSchema(out: string | undefined, io: CliIO, cwd: string): Promise<number> {
	const dir = out
		? path.resolve(cwd, out)
		: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../schema');
	await fs.mkdir(dir, { recursive: true });
	for (const [name, schema] of Object.entries(jsonSchemas())) {
		await fs.writeFile(path.join(dir, name), JSON.stringify(schema, null, 2) + '\n');
		io.log(`wrote ${path.relative(cwd, path.join(dir, name))}`);
	}
	return 0;
}
