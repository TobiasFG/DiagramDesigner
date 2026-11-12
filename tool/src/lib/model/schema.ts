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
	method?: HttpMethod;
	path?: string;
	auth?: string;
	params?: ApiParam[];
	request?: ApiBody;
	responses?: ApiResponse[];
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
 *
 * A model is drawn as a class where it is owned and as a stored table where it is stored
 * (`storedIn`). Held models and `stored: false` fields exist only in the class; a ref to the
 * model that holds this one exists only in the table.
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
		derived: Text.optional().describe('How the value is computed or changed from its from fields'),
		stored: z
			.boolean()
			.optional()
			.describe('false: exists in the class only, never stored (e.g. computed); default true')
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

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export const ApiParam = z
	.strictObject({
		name: z.string(),
		in: z.enum(['path', 'query', 'header']),
		type: z.string(),
		required: z.boolean().optional().describe('Path params are always required'),
		description: Text.optional()
	})
	.describe('Endpoint parameter, outside the body');
export type ApiParam = z.infer<typeof ApiParam>;

/**
 * A field of a body shape written on the api itself. Request fields say which model fields
 * their value goes into (`to`); response fields which fields it comes from (`from`), so a
 * change on either side can be traced.
 */
export const ApiField = z
	.strictObject({
		id: Id.describe('Unique across the whole design, like model field ids'),
		name: z.string(),
		type: z.string().optional().describe('Primitive type; give either type or model'),
		model: Id.optional().describe('Id of a model this field holds'),
		many: z.boolean().optional().describe('Holds a list of type or model'),
		required: z.boolean().optional(),
		nullable: z.boolean().optional(),
		description: Text.optional(),
		to: z
			.array(Id)
			.optional()
			.describe('Request fields: ids of the model fields its value goes into'),
		from: z
			.array(Id)
			.optional()
			.describe('Response fields: ids of the fields its value comes from'),
		derived: Text.optional().describe('How the value is changed on the way')
	})
	.describe('Field of a body shape written on the api');
export type ApiField = z.infer<typeof ApiField>;

/** A body is a model as is, a model trimmed with omit or pick, or a shape of its own. */
const bodyKeys = {
	model: Id.optional().describe('Id of the model sent or returned'),
	omit: z.array(Id).optional().describe('With model: ids of its fields left out'),
	pick: z.array(Id).optional().describe('With model: ids of the only fields sent'),
	fields: z.array(ApiField).optional().describe('A shape of its own, instead of a model'),
	many: z.boolean().optional().describe('A list of the model or shape'),
	contentType: z.string().optional().describe('Default application/json')
};

export const ApiBody = z.strictObject(bodyKeys).describe('Request body');
export type ApiBody = z.infer<typeof ApiBody>;

export const ApiResponse = z
	.strictObject({
		status: z.number().int().min(100).max(599),
		...bodyKeys,
		description: Text.optional()
	})
	.describe('One possible response; no model or fields: no body');
export type ApiResponse = z.infer<typeof ApiResponse>;

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
		storedIn: Id.optional().describe(
			'Models only: id of the system or module storing its data (e.g. a database module)'
		),
		models: z
			.array(Id)
			.optional()
			.describe('Ids of models used here but owned elsewhere; drawn inside as references'),
		fields: z.array(ModelField).optional().describe('Models only'),
		indexes: z.array(ModelIndex).optional().describe('Models only'),
		method: z.enum(HTTP_METHODS).optional().describe('Apis only: HTTP method; required'),
		path: z.string().optional().describe('Apis only: route, e.g. /orders/{id}; required'),
		auth: z.string().optional().describe('Apis only: how callers authenticate, e.g. bearer'),
		params: z.array(ApiParam).optional().describe('Apis only: path, query and header params'),
		request: ApiBody.optional().describe('Apis only: what it takes in the body'),
		responses: z.array(ApiResponse).optional().describe('Apis only: what it returns, by status'),
		name: Text.optional().describe('Display name; defaults to the file name'),
		tags: z.array(z.string()).optional(),
		links: z.array(DocLink).optional(),
		meta: Meta.optional()
	})
	.describe('System Design Viewer entity file (<name>.<kind>.yaml)');
export type EntityFile = z.infer<typeof EntityFile>;
