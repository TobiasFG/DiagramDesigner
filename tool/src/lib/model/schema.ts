import { z } from 'zod';

/**
 * Zod schemas for model, view and layout files. They are the single source for the
 * TypeScript types, validation messages, the generated JSON Schema and the
 * properties-panel forms. Objects are strict so misspelled keys are reported.
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

const common = {
	id: Id,
	name: Text.optional().describe('Display name; defaults to id'),
	description: Text.optional(),
	tags: z.array(z.string()).optional(),
	links: z.array(DocLink).optional(),
	meta: Meta.optional()
};

// ---------------------------------------------------------------- elements

export const ELEMENT_KINDS = [
	'person',
	'system',
	'container',
	'component',
	'external',
	'datastore',
	'queue'
] as const;
export const ElementKind = z.enum(ELEMENT_KINDS);

export interface Element {
	id: string;
	kind: (typeof ELEMENT_KINDS)[number] | EntityFileKind;
	name?: string;
	tags?: string[];
	links?: { label: string; url: string }[];
	meta?: Record<string, string>;
	children?: Element[];
	fields?: ModelField[];
	indexes?: ModelIndex[];
}

export const Element: z.ZodType<Element> = z
	.strictObject({
		id: common.id,
		name: common.name,
		tags: common.tags,
		links: common.links,
		meta: common.meta,
		kind: ElementKind,
		get children() {
			return z.array(Element).optional();
		}
	})
	.meta({ id: 'Element' });

export const Relationship = z.strictObject({
	id: Id.optional(),
	from: Id,
	to: Id,
	label: Text.optional(),
	description: Text.optional(),
	sync: z.boolean().optional().describe('false renders dashed (async); default true'),
	tags: z.array(z.string()).optional(),
	meta: Meta.optional()
});
export type Relationship = z.infer<typeof Relationship>;

/** Kinds an entity file can have; the file name `<name>.<kind>.yaml` gives it. */
export const ENTITY_KINDS = ['system', 'module', 'model', 'logic-unit', 'api'] as const;
export type EntityFileKind = (typeof ENTITY_KINDS)[number];

/** Kinds a parent must have, for kinds that may only sit under certain parents. */
export const PARENT_KINDS: Partial<Record<EntityFileKind, EntityFileKind[]>> = {
	'logic-unit': ['module'],
	api: ['system', 'module'],
	model: ['system', 'module']
};

export const ModelField = z
	.strictObject({
		name: z.string(),
		type: z.string(),
		pk: z.boolean().optional().describe('Part of the primary key'),
		pi: z.boolean().optional().describe('Part of the primary index'),
		required: z.boolean().optional().describe('Must have a value; default optional'),
		ref: Id.optional().describe('Id of the model this field points at (foreign key)')
	})
	.describe('Model field (table column)');
export type ModelField = z.infer<typeof ModelField>;

export const ModelIndex = z
	.strictObject({
		name: z.string(),
		fields: z.array(z.string()).min(1),
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

// ---------------------------------------------------------------- classes

export const Visibility = z.enum(['+', '-', '#', '~']);

export const Attribute = z.strictObject({
	name: z.string(),
	type: z.string().optional(),
	visibility: Visibility.optional(),
	static: z.boolean().optional(),
	default: z.string().optional(),
	description: Text.optional()
});
export type Attribute = z.infer<typeof Attribute>;

export const Method = z.strictObject({
	name: z.string(),
	params: z.string().optional(),
	returns: z.string().optional(),
	visibility: Visibility.optional(),
	static: z.boolean().optional(),
	abstract: z.boolean().optional(),
	description: Text.optional()
});
export type Method = z.infer<typeof Method>;

export const RELATION_TYPES = [
	'inheritance',
	'realization',
	'composition',
	'aggregation',
	'association',
	'dependency'
] as const;
export const RelationType = z.enum(RELATION_TYPES);

export const ClassRelation = z.strictObject({
	type: RelationType,
	to: Id,
	fromMult: z.string().optional(),
	toMult: z.string().optional(),
	label: Text.optional()
});
export type ClassRelation = z.infer<typeof ClassRelation>;

export const CLASS_KINDS = ['class', 'interface', 'abstract', 'enum'] as const;

export const ClassDef = z.strictObject({
	...common,
	kind: z.enum(CLASS_KINDS).optional().describe('Defaults to class'),
	stereotype: z.string().optional().describe('Free text, rendered as <<stereotype>>'),
	attributes: z.array(Attribute).optional(),
	methods: z.array(Method).optional(),
	values: z.array(Text).optional().describe('Enum literals when kind is enum'),
	relations: z.array(ClassRelation).optional(),
	componentOf: Id.optional().describe('Element this class belongs to')
});
export type ClassDef = z.infer<typeof ClassDef>;

// ---------------------------------------------------------------- objects

export const ObjectLink = z.strictObject({ to: Id, label: Text.optional() });
export type ObjectLink = z.infer<typeof ObjectLink>;

export const ObjectDef = z.strictObject({
	...common,
	class: Id,
	slots: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
	// `links` doubles as object links ({to}) and documentation links ({label, url}).
	links: z.array(z.union([ObjectLink, DocLink])).optional()
});
export type ObjectDef = z.infer<typeof ObjectDef>;

// ---------------------------------------------------------------- flows

export const FLOW_NODE_TYPES = ['start', 'end', 'action', 'decision', 'io', 'subflow'] as const;
export const FlowNodeType = z.enum(FLOW_NODE_TYPES);

export const FlowNode = z.strictObject({
	id: Id,
	type: FlowNodeType,
	name: Text.optional(),
	description: Text.optional(),
	actor: Id.optional().describe('Element performing the step; used for swimlanes'),
	ref: Id.optional().describe('Flow id opened by a subflow node'),
	tags: z.array(z.string()).optional(),
	meta: Meta.optional()
});
export type FlowNode = z.infer<typeof FlowNode>;

export const Transition = z.strictObject({
	from: Id,
	to: Id,
	label: Text.optional()
});
export type Transition = z.infer<typeof Transition>;

export const Flow = z.strictObject({
	...common,
	nodes: z.array(FlowNode),
	transitions: z.array(Transition).optional(),
	lanes: z.enum(['none', 'by-actor']).optional()
});
export type Flow = z.infer<typeof Flow>;

// ---------------------------------------------------------------- pipelines

export const Job = z.strictObject({
	id: Id,
	name: Text.optional(),
	description: Text.optional(),
	needs: z.array(Id).optional(),
	meta: Meta.optional()
});
export type Job = z.infer<typeof Job>;

export const Stage = z.strictObject({
	id: Id,
	name: Text.optional(),
	description: Text.optional(),
	needs: z.array(Id).optional(),
	jobs: z.array(Job),
	meta: Meta.optional()
});
export type Stage = z.infer<typeof Stage>;

export const PipelineArtifact = z.strictObject({
	id: Id,
	name: Text.optional(),
	producedBy: Id.optional(),
	consumedBy: z.array(Id).optional()
});
export type PipelineArtifact = z.infer<typeof PipelineArtifact>;

export const Pipeline = z.strictObject({
	...common,
	trigger: z.string().optional(),
	stages: z.array(Stage),
	artifacts: z.array(PipelineArtifact).optional()
});
export type Pipeline = z.infer<typeof Pipeline>;

// ---------------------------------------------------------------- interactions

export const MESSAGE_KINDS = ['sync', 'async', 'return', 'create', 'destroy', 'self'] as const;
export const GROUP_KINDS = ['alt', 'opt', 'loop', 'par', 'critical'] as const;

export const MessageStep = z.strictObject({
	from: Id,
	to: Id,
	msg: Text.optional(),
	kind: z.enum(MESSAGE_KINDS).optional().describe('Defaults to sync; self when from = to'),
	activate: z.boolean().optional().describe('Activates the receiver until the matching return')
});
export type MessageStep = z.infer<typeof MessageStep>;

export const NoteStep = z.strictObject({
	note: Text,
	over: z.union([Id, z.array(Id).min(1).max(2)])
});
export type NoteStep = z.infer<typeof NoteStep>;

export interface GroupStep {
	group: (typeof GROUP_KINDS)[number];
	label?: string;
	steps: Step[];
	else?: { label?: string; steps: Step[] }[];
}
export type Step = MessageStep | NoteStep | GroupStep;

export const GroupStep: z.ZodType<GroupStep> = z
	.strictObject({
		group: z.enum(GROUP_KINDS),
		label: Text.optional(),
		get steps() {
			return z.array(Step);
		},
		get else() {
			return z.array(z.strictObject({ label: Text.optional(), steps: z.array(Step) })).optional();
		}
	})
	.meta({ id: 'GroupStep' });

export const Step: z.ZodType<Step> = z
	.union([MessageStep, NoteStep, GroupStep])
	.meta({ id: 'Step' });

export const Interaction = z.strictObject({
	...common,
	participants: z.array(Id).describe('Element ids; order is column order'),
	steps: z.array(Step)
});
export type Interaction = z.infer<typeof Interaction>;

// ---------------------------------------------------------------- files

export const VIEW_TYPES = ['component', 'class', 'object', 'flow', 'pipeline', 'sequence'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const LayoutOptions = z.strictObject({
	algorithm: z.enum(['layered', 'stress', 'mrtree', 'force']).optional(),
	direction: z.enum(['RIGHT', 'LEFT', 'DOWN', 'UP']).optional(),
	spacing: z.number().positive().optional()
});
export type LayoutOptions = z.infer<typeof LayoutOptions>;

export const EXPORT_FORMATS = ['mermaid', 'svg', 'png'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const View = z.strictObject({
	id: Id,
	type: z.enum(VIEW_TYPES),
	title: z.string().optional(),
	description: Text.optional(),
	scope: Id.optional().describe('Root element; omit for the whole model'),
	include: z
		.array(z.string())
		.optional()
		.describe('Ids or globs: "a.*" direct children, "a.**" descendants, "tag:x", "order-*"'),
	exclude: z.array(z.string()).optional(),
	depth: z.int().min(0).optional().describe('Levels below scope to expand'),
	aggregateEdges: z
		.boolean()
		.optional()
		.describe('Lift hidden children relationships; default true'),
	source: Id.optional().describe('Flow, pipeline or interaction id'),
	show: z
		.strictObject({ attributes: z.boolean().optional(), methods: z.boolean().optional() })
		.optional()
		.describe('Class views: toggle compartments'),
	layout: LayoutOptions.optional(),
	export: z
		.strictObject({
			formats: z.array(z.enum(EXPORT_FORMATS)).optional(),
			file: z.string().optional()
		})
		.optional()
});
export type View = z.infer<typeof View>;

export const ViewFile = z
	.strictObject({ views: z.array(View).optional() })
	.describe('System Design Viewer view file (*.view.yaml)');
export type ViewFile = z.infer<typeof ViewFile>;

const Point = z.tuple([z.number(), z.number()]);

export const LayoutNode = z.strictObject({
	x: z.number().optional(),
	y: z.number().optional(),
	w: z.number().optional(),
	h: z.number().optional(),
	pinned: z.boolean().optional(),
	collapsed: z.boolean().optional()
});
export type LayoutNode = z.infer<typeof LayoutNode>;

export const LayoutEdge = z.strictObject({
	points: z.array(Point).optional(),
	labelPos: z.number().min(0).max(1).optional()
});
export type LayoutEdge = z.infer<typeof LayoutEdge>;

export const LayoutFile = z.strictObject({
	version: z.literal(1),
	view: Id,
	nodes: z.record(z.string(), LayoutNode).optional(),
	edges: z.record(z.string(), LayoutEdge).optional(),
	columns: z.record(z.string(), z.number()).optional().describe('Sequence column widths'),
	viewport: z.strictObject({ x: z.number(), y: z.number(), zoom: z.number() }).optional()
});
export type LayoutFile = z.infer<typeof LayoutFile>;

/** Schemas addressable by the properties panel, keyed by entity kind. */
export const ENTITY_SCHEMAS = {
	element: Element,
	relationship: Relationship,
	class: ClassDef,
	relation: ClassRelation,
	attribute: Attribute,
	method: Method,
	object: ObjectDef,
	objectLink: ObjectLink,
	flow: Flow,
	flowNode: FlowNode,
	transition: Transition,
	pipeline: Pipeline,
	stage: Stage,
	job: Job,
	artifact: PipelineArtifact,
	interaction: Interaction,
	message: MessageStep,
	note: NoteStep,
	group: GroupStep,
	view: View
} as const;
export type EntityKind = keyof typeof ENTITY_SCHEMAS;
