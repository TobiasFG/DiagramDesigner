import { z } from 'zod';
import { ENTITY_SCHEMAS, type EntityKind } from '../../model/schema';

export interface JsonSchema {
	type?: string;
	enum?: string[];
	properties?: Record<string, JsonSchema>;
	required?: string[];
	items?: JsonSchema;
	anyOf?: JsonSchema[];
	oneOf?: JsonSchema[];
	additionalProperties?: JsonSchema | boolean;
	description?: string;
	$ref?: string;
	$defs?: Record<string, JsonSchema>;
	allOf?: JsonSchema[];
}

/** Fields edited on the canvas (or too nested for a form); they stay available in the YAML tab. */
const HIDDEN = new Set(['children', 'steps', 'else', 'nodes', 'transitions', 'stages', 'jobs']);

const cache = new Map<EntityKind, JsonSchema>();

/** JSON Schema of an entity kind, derived from its zod schema, without canvas-managed fields. */
export function entitySchema(kind: EntityKind): JsonSchema {
	let s = cache.get(kind);
	if (!s) {
		s = z.toJSONSchema(ENTITY_SCHEMAS[kind], { unrepresentable: 'any' }) as JsonSchema;
		const resolved = resolveSchema(s, s);
		if (resolved.properties) {
			resolved.properties = Object.fromEntries(
				Object.entries(resolved.properties).filter(([k]) => !HIDDEN.has(k))
			);
		}
		s = { ...resolved, $defs: s.$defs };
		cache.set(kind, s);
	}
	return s;
}

/** Follows `$ref` (including the recursive root reference `#`) and single-branch `allOf`. */
export function resolveSchema(schema: JsonSchema, root: JsonSchema): JsonSchema {
	let s = schema;
	for (let guard = 0; guard < 10; guard++) {
		if (s.$ref) {
			const target =
				s.$ref === '#' ? root : (root.$defs?.[s.$ref.replace(/^#\/\$defs\//, '')] ?? {});
			s = { ...target, description: s.description ?? target.description };
			continue;
		}
		if (s.allOf?.length === 1) {
			s = { ...s.allOf[0], description: s.description };
			continue;
		}
		break;
	}
	return s;
}
