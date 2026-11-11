import { z } from 'zod';

/**
 * Zod schema for entity files. It is the single source for the TypeScript types, validation
 * messages and the generated JSON Schema. Objects are strict so misspelled keys are reported.
 */

export const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

export const Id = z
	.string()
	.regex(ID_PATTERN, { message: 'must be kebab-case, matching ^[a-z][a-z0-9-]*$' })
	.describe('Kebab-case identifier');

export const DocLink = z
	.strictObject({ label: z.string(), url: z.string() })
	.describe('Documentation link');

/** Display text; YAML scalars like `402` or `1.5` are accepted and read as strings. */
export const Text = z.preprocess((v) => (typeof v === 'number' ? String(v) : v), z.string());

const Meta = z.record(z.string(), z.string()).describe('Free-form string metadata');

/** A resolved entity: its file data plus the kind taken from the file name. */
export interface Element {
	id: string;
	kind: EntityFileKind;
	name?: string;
	tags?: string[];
	links?: { label: string; url: string }[];
	meta?: Record<string, string>;
	fields?: ModelField[];
	indexes?: ModelIndex[];
}

/** Kinds an entity file can have; the file name `<name>.<kind>.yaml` gives it. */
export const ENTITY_KINDS = ['system', 'module', 'model', 'logic-unit', 'api'] as const;
export type EntityFileKind = (typeof ENTITY_KINDS)[number];

/** Kinds a parent must have, for kinds that may only sit under certain parents. */
export const PARENT_KINDS: Partial<Record<EntityFileKind, EntityFileKind[]>> = {
	'logic-unit': ['module'],
	api: ['system', 'module'],
	model: ['system', 'module']
};

/**
 * `required` and `nullable` are independent: a required field must be given on create but
 * may still be null when nullable; an optional field may be left out but, unless nullable,
 * never holds null (a default fills it).
 *
 * A field has either a primitive `type` or a `model` it holds (composition); `ref` holds a
 * key instead (foreign key), so it goes with `type`. `from` and `derived` record lineage:
 * which fields elsewhere this field's value comes from, for change impact.
 */
export const ModelField = z
	.strictObject({
		id: Id.describe('Unique across the whole model, like entity ids; generate with `sdv id`'),
		name: z.string(),
		type: z.string().optional().describe('Primitive type; give either type or model'),
		model: Id.optional().describe('Id of a model this field holds (composition)'),
		many: z.boolean().optional().describe('Holds a list of type or model'),
		pk: z.boolean().optional().describe('Part of the primary key'),
		pi: z.boolean().optional().describe('Part of the primary index'),
		required: z.boolean().optional().describe('Must be given a value on create; default false'),
		nullable: z.boolean().optional().describe('May hold null; default false'),
		constraints: z
			.array(Text)
			.optional()
			.describe('Free-text rules such as unique, positive, max 200'),
		ref: Id.optional().describe('Id of the model or field this field points at (foreign key)'),
		from: z
			.array(Id)
			.optional()
			.describe('Ids of the fields this value comes from; omit for a source field'),
		derived: Text.optional().describe('How the value is computed or changed from its from fields')
	})
	.describe('Model field: a table column or an object property');
export type ModelField = z.infer<typeof ModelField>;

export const ModelIndex = z
	.strictObject({
		name: z.string(),
		fields: z.array(Id).min(1).describe('Field ids, in index order'),
		unique: z.boolean().optional()
	})
	.describe('Secondary index over model fields');
export type ModelIndex = z.infer<typeof ModelIndex>;

/**
 * One entity per file, named `<name>.<kind>.yaml`. The id is generated once and never
 * edited, so renaming or moving the file changes nothing. Systems sit in their own folder
 * and have no parent; models name their single owner with `ownedBy` instead of a parent,
 * since they are used in many places; every other entity names its parent by id.
 */
export const EntityFile = z
	.strictObject({
		id: Id.describe('Generated with `sdv new`; never edited'),
		parent: Id.optional().describe('Id of the parent entity; omitted for systems and models'),
		ownedBy: Id.optional().describe('Models only: id of the one system or module owning it'),
		models: z
			.array(Id)
			.optional()
			.describe('Ids of models used here but owned elsewhere; drawn inside as references'),
		fields: z.array(ModelField).optional().describe('Models only'),
		indexes: z.array(ModelIndex).optional().describe('Models only'),
		name: Text.optional().describe('Display name; defaults to the file name'),
		tags: z.array(z.string()).optional(),
		links: z.array(DocLink).optional(),
		meta: Meta.optional()
	})
	.describe('System Design Viewer entity file (<name>.<kind>.yaml)');
export type EntityFile = z.infer<typeof EntityFile>;
