/** A field row in one card (box). */
export interface FieldRef {
	box: string;
	field: string;
}

/**
 * Per-page UI state shared by the canvas and its nodes. Nodes read it directly, so a hover
 * never rebuilds the node list (which would drop Svelte Flow's measurements mid-gesture).
 */
export class ViewState {
	selectedNodes = $state.raw<string[]>([]);
	/** The field row under the pointer, or the inspector entry under it. */
	hover = $state.raw<FieldRef | null>(null);
	/** The field row clicked; its links stay drawn and the inspector shows them. */
	field = $state.raw<FieldRef | null>(null);
	/** The api clicked on a rail; a card beside it shows it. */
	api = $state.raw<string | null>(null);
	/** A field of the picked api's own body shape under the pointer; its lineage is drawn. */
	apiField = $state.raw<string | null>(null);
	/** Boxes the picked api's bodies use, with the parts using them (request, 201...). */
	apiBoxes = $state.raw<Record<string, string[]>>({});
	/** Rows a lit card has that the picked api's body leaves out, by box. */
	apiDim = $state.raw<Record<string, Record<string, true>>>({});
	/** Rows followed to from the inspector, for Back. */
	trail = $state.raw<FieldRef[]>([]);
	/** A row flashed after flying to it. */
	flash = $state.raw<FieldRef | null>(null);
	/** Rows lit by the focused field, by box: the field itself, or the other end of a link. */
	hot = $state.raw<Record<string, Record<string, 'self' | 'peer'>>>({});
	/** Boxes holding the other end of a focused link, outlined so a closed box shows where. */
	peerBoxes = $state.raw<Record<string, true>>({});
}
