import type { DataPath, Diagnostic } from '../model/diagnostics';
import type {
	CLASS_KINDS,
	Element,
	EntityKind,
	FLOW_NODE_TYPES,
	GROUP_KINDS,
	LayoutOptions,
	MESSAGE_KINDS,
	RELATION_TYPES,
	ViewType
} from '../model/schema';

/** Points at the raw data of an entity, for the properties panel and edit commands. */
export interface EntityRef {
	kind: EntityKind;
	file: string;
	path: DataPath;
	/** Owning entity for scoped items (flow id for flow nodes, pipeline id for jobs, ...). */
	owner?: string;
}

export type Marker = 'none' | 'arrow' | 'open-arrow' | 'triangle' | 'diamond' | 'diamond-filled';

export interface MemberRow {
	text: string;
	static?: boolean;
	abstract?: boolean;
	/** Index in the source attributes/methods list. */
	index: number;
}

interface NodeBase {
	id: string;
	parentId?: string;
	/** Size hint; the layout may enlarge groups to fit their children. */
	width: number;
	height: number;
	isGroup: boolean;
	ref?: EntityRef;
}

export interface ElementNode extends NodeBase {
	type: 'element';
	data: {
		kind: Element['kind'];
		label: string;
		/** Children hidden by depth or collapse. */
		hiddenChildren: number;
	};
}

export interface BoundaryNode extends NodeBase {
	type: 'boundary';
	data: { kind: Element['kind']; label: string };
}

export interface ClassNode extends NodeBase {
	type: 'class';
	data: {
		classKind: (typeof CLASS_KINDS)[number];
		label: string;
		stereotype?: string;
		attributes: MemberRow[];
		methods: MemberRow[];
		values: string[];
		/** Rows hidden by truncation, per compartment. */
		more: { attributes: number; methods: number; values: number };
		showAttributes: boolean;
		showMethods: boolean;
	};
}

export interface ObjectNode extends NodeBase {
	type: 'object';
	data: { label: string; rows: { name: string; value: string }[] };
}

export interface FlowNodeShape extends NodeBase {
	type: 'flow';
	data: { flowType: (typeof FLOW_NODE_TYPES)[number]; label: string; ref?: string };
}

export interface LaneNode extends NodeBase {
	type: 'lane';
	data: { label: string };
}

export interface StageNode extends NodeBase {
	type: 'stage';
	data: { label: string };
}

export interface JobNode extends NodeBase {
	type: 'job';
	data: { label: string; status?: string };
}

export interface ArtifactNode extends NodeBase {
	type: 'artifact';
	data: { label: string };
}

export type RenderNode =
	| ElementNode
	| BoundaryNode
	| ClassNode
	| ObjectNode
	| FlowNodeShape
	| LaneNode
	| StageNode
	| JobNode
	| ArtifactNode;

export type RenderNodeType = RenderNode['type'];

export type EdgeType =
	'relationship' | 'aggregated' | 'relation' | 'link' | 'transition' | 'needs' | 'artifact';

export interface RenderEdge {
	/** Stable key, also used in layout files: `<from>-><to>#<index>`. */
	id: string;
	source: string;
	target: string;
	type: EdgeType;
	ref?: EntityRef;
	data: {
		label?: string;
		/** Secondary label line. */
		sublabel?: string;
		dashed: boolean;
		markerStart: Marker;
		markerEnd: Marker;
		/** Aggregated edges: number of underlying relationships. */
		count?: number;
		/** Multiplicities near the ends. */
		startLabel?: string;
		endLabel?: string;
		relationType?: (typeof RELATION_TYPES)[number];
		/** Flow back-edge (target precedes source). */
		back?: boolean;
	};
}

export interface GraphLayoutOptions extends Required<
	Pick<LayoutOptions, 'algorithm' | 'direction' | 'spacing'>
> {
	/** Swimlanes: lane node ids in order; nodes are parented to lanes. */
	lanes?: string[];
}

export interface RenderGraph {
	kind: 'graph';
	viewId: string;
	viewType: Exclude<ViewType, 'sequence'>;
	title: string;
	description?: string;
	nodes: RenderNode[];
	edges: RenderEdge[];
	diagnostics: Diagnostic[];
	layout: GraphLayoutOptions;
}

// ---------------------------------------------------------------- sequence

export interface SeqParticipant {
	id: string;
	label: string;
	kind?: Element['kind'];
	/** Not an element of the model. */
	plain: boolean;
	ref?: EntityRef;
}

export type MessageKind = (typeof MESSAGE_KINDS)[number];

export interface SeqMessage {
	type: 'message';
	from: string;
	to: string;
	label: string;
	kind: MessageKind;
	activate: boolean;
	/** Path of the step inside the interaction data. */
	path: DataPath;
	ref: EntityRef;
}

export interface SeqNote {
	type: 'note';
	over: string[];
	text: string;
	path: DataPath;
	ref: EntityRef;
}

export interface SeqGroup {
	type: 'group';
	kind: (typeof GROUP_KINDS)[number];
	branches: { label?: string; items: SeqItem[] }[];
	path: DataPath;
	ref: EntityRef;
}

export type SeqItem = SeqMessage | SeqNote | SeqGroup;

export interface SequenceGraph {
	kind: 'sequence';
	viewId: string;
	viewType: 'sequence';
	title: string;
	description?: string;
	interactionId: string;
	interactionRef: EntityRef;
	participants: SeqParticipant[];
	items: SeqItem[];
	/** Column width overrides from the layout file. */
	columns: Record<string, number>;
	diagnostics: Diagnostic[];
}

export type Projection = RenderGraph | SequenceGraph;
