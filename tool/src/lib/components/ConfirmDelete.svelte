<script lang="ts">
	import { design } from '$lib/client/store.svelte';
	import type { ViewState } from '$lib/client/view-state.svelte';

	let { view }: { view: ViewState } = $props();
	let dialog: HTMLDialogElement | undefined = $state();

	$effect(() => {
		if (view.pendingDelete && dialog && !dialog.open) dialog.showModal();
		if (!view.pendingDelete && dialog?.open) dialog.close();
	});

	async function confirm() {
		const pending = view.pendingDelete;
		view.pendingDelete = null;
		if (pending && (await design.execute(pending.command))) view.clearSelection();
	}
</script>

<dialog bind:this={dialog} onclose={() => (view.pendingDelete = null)} data-testid="confirm-delete">
	{#if view.pendingDelete}
		<h2>{view.pendingDelete.title}</h2>
		<p>This removes the entity and every reference to it. Affected files:</p>
		<ul>
			{#each view.pendingDelete.files as f (f)}<li><code>{f}</code></li>{/each}
		</ul>
		<p class="muted">
			Use “Remove from view” to hide it in this diagram only. Delete can be undone.
		</p>
		<div class="actions">
			<button onclick={() => (view.pendingDelete = null)}>Cancel</button>
			<button class="primary danger-bg" onclick={confirm} data-testid="confirm-delete-ok"
				>Delete</button
			>
		</div>
	{/if}
</dialog>

<style>
	dialog {
		border: 1px solid var(--ui-border);
		border-radius: 10px;
		background: var(--ui-panel);
		color: var(--ui-text);
		box-shadow: var(--ui-shadow);
		max-width: 480px;
		padding: 16px 20px;
	}
	dialog::backdrop {
		background: rgba(0, 0, 0, 0.3);
	}
	h2 {
		font-size: 16px;
		margin: 0 0 8px;
	}
	ul {
		margin: 4px 0 12px;
		padding-left: 20px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.danger-bg {
		background: var(--ui-danger);
		border-color: var(--ui-danger);
	}
</style>
