<script lang="ts">
	import { design } from '$lib/client/store.svelte';
	import { formatLocation, sortDiagnostics } from '$lib/model/diagnostics';

	let { onclose }: { onclose: () => void } = $props();
	let filter = $state<'all' | 'error' | 'warning'>('all');

	const items = $derived(
		sortDiagnostics(design.diagnostics).filter((d) => filter === 'all' || d.severity === filter)
	);
</script>

<section class="diagnostics" aria-label="Diagnostics" data-testid="diagnostics-panel">
	<header>
		<strong>Diagnostics</strong>
		<select bind:value={filter} aria-label="Filter">
			<option value="all">All</option>
			<option value="error">Errors</option>
			<option value="warning">Warnings</option>
		</select>
		<span class="spacer"></span>
		<button class="icon" onclick={onclose} aria-label="Close diagnostics">×</button>
	</header>
	{#if items.length}
		<ul>
			{#each items as d, i (i)}
				<li class={d.severity}>
					<span class="sev">{d.severity === 'error' ? '●' : '▲'}</span>
					<code class="loc">{formatLocation(d) || '—'}</code>
					<span class="msg">{d.message}</span>
					<span class="code muted">{d.code}</span>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted empty">No problems found.</p>
	{/if}
</section>

<style>
	.diagnostics {
		max-height: 32vh;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--ui-border);
		background: var(--ui-panel);
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		border-bottom: 1px solid var(--ui-border);
	}
	.spacer {
		flex: 1;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 4px 0;
		overflow: auto;
	}
	li {
		display: grid;
		grid-template-columns: 16px minmax(160px, auto) 1fr auto;
		gap: 8px;
		padding: 3px 12px;
		align-items: baseline;
	}
	li:hover {
		background: var(--ui-hover);
	}
	.error .sev {
		color: var(--ui-danger);
	}
	.warning .sev {
		color: var(--ui-warn);
	}
	.loc {
		color: var(--ui-muted);
		white-space: nowrap;
	}
	.msg {
		overflow-wrap: anywhere;
	}
	.empty {
		padding: 8px 12px;
		margin: 0;
	}
</style>
