import type { Command } from '../commands/core';
import type { Alignment } from '../commands/layout';
import type { PositionedGraph } from '../layout/types';
import type { SequenceLayout } from '../sequence/layout';

export interface PendingDelete {
	title: string;
	command: Command;
	files: string[];
}

/** Functions the active canvas exposes to the toolbar and search. */
export interface CanvasApi {
	fit(): void;
	focus(id: string): void;
	align(how: Alignment | 'horizontal' | 'vertical'): void;
	requestDelete(): void;
	removeFromView(): void;
}

/** Per-page UI state shared by the canvas, panels and toolbar. */
export class ViewState {
	selectedNodes = $state.raw<string[]>([]);
	selectedEdges = $state.raw<string[]>([]);
	/** Sequence views: selected steps as JSON-encoded data paths. */
	selectedSteps = $state.raw<string[]>([]);
	selectedParticipant = $state<string | null>(null);
	snap = $state(true);
	minimap = $state(true);
	positioned = $state.raw<PositionedGraph | null>(null);
	seqLayout = $state.raw<SequenceLayout | null>(null);
	layoutMs = $state(0);
	pendingDelete = $state.raw<PendingDelete | null>(null);
	api = $state.raw<CanvasApi | null>(null);

	clearSelection() {
		this.selectedNodes = [];
		this.selectedEdges = [];
		this.selectedSteps = [];
		this.selectedParticipant = null;
	}
}
