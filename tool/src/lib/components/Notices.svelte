<script lang="ts">
	import { design } from '#lib/client/store.svelte.ts';
</script>

<div class="notices" aria-live="polite">
	{#each design.notices as n (n.id)}
		<div
			class="notice {n.kind}"
			role={n.kind === 'info' ? 'status' : 'alert'}
			data-testid="notice-{n.kind}"
		>
			<span>{n.text}</span>
			<button class="icon" aria-label="Dismiss" onclick={() => design.dismiss(n.id)}>×</button>
		</div>
	{/each}
</div>

<style>
	.notices {
		position: fixed;
		right: 16px;
		bottom: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		z-index: 100;
		max-width: min(440px, calc(100vw - 32px));
	}
	.notice {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 8px 8px 8px 12px;
		border-radius: 8px;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		border-left: 4px solid var(--ui-accent);
		box-shadow: var(--ui-shadow);
	}
	.notice span {
		flex: 1;
		padding-top: 3px;
		overflow-wrap: anywhere;
	}
	.notice.error {
		border-left-color: var(--ui-danger);
	}
	.notice.conflict {
		border-left-color: var(--ui-warn);
	}
	.notice button {
		border: none;
		padding: 0 6px;
	}
</style>
