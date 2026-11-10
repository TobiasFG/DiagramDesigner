/** Per-page UI state shared by the canvas. */
export class ViewState {
	selectedNodes = $state.raw<string[]>([]);
}
