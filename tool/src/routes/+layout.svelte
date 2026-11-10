<script lang="ts">
	import '../app.css';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import { design } from '#lib/client/store.svelte.ts';
	import { theme } from '#lib/client/theme.svelte.ts';
	import { themeCss } from '#lib/theme/tokens.ts';
	import DiagnosticsPanel from '#lib/components/DiagnosticsPanel.svelte';
	import type { ChangedEvent } from '#lib/server/vite-plugin.ts';

	let { children } = $props();
	let showDiagnostics = $state(false);

	const errors = $derived(design.diagnostics.filter((d) => d.severity === 'error').length);
	const warnings = $derived(design.diagnostics.length - errors);

	onMount(() => {
		// Subscribe before loading; the store queues events behind the initial load.
		import.meta.hot?.on('sdv:changed', (ev: ChangedEvent) => design.onExternalChange(ev));
		design.load().then(() => theme.init(design.config.theme));
		if (import.meta.env.DEV) (window as unknown as { __sdv: typeof design }).__sdv = design;
	});
</script>

<svelte:head>
	<title>System Design Viewer</title>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- generated from static tokens -->
	{@html `<style>${themeCss()}</style>`}
</svelte:head>

<div class="app">
	<header class="topbar">
		<a class="brand" href={resolve('/')}>System Design Viewer</a>
		<span class="spacer"></span>
		<button
			class="diag"
			class:has-errors={errors > 0}
			aria-pressed={showDiagnostics}
			onclick={() => (showDiagnostics = !showDiagnostics)}
			title="Diagnostics"
			data-testid="diagnostics-toggle"
		>
			<span class="err">● {errors}</span>
			<span class="warn">▲ {warnings}</span>
		</button>
		<button
			class="icon"
			onclick={() => theme.toggle()}
			title="Toggle theme"
			aria-label="Toggle theme"
		>
			{theme.current === 'dark' ? '☀' : '☾'}
		</button>
	</header>
	<main>
		{#if design.loadError}
			<p class="load-error">Could not load the design: {design.loadError}</p>
		{:else if design.loaded}
			{@render children()}
		{:else}
			<p class="muted loading">Loading design…</p>
		{/if}
	</main>
	{#if showDiagnostics}
		<DiagnosticsPanel onclose={() => (showDiagnostics = false)} />
	{/if}
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	.topbar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 12px;
		border-bottom: 1px solid var(--ui-border);
		background: var(--ui-panel);
		min-height: 44px;
	}
	.brand {
		font-weight: 700;
		color: var(--ui-text);
		text-decoration: none;
	}
	.spacer {
		flex: 1;
	}
	.diag {
		display: flex;
		gap: 8px;
	}
	.diag .err {
		color: var(--ui-muted);
	}
	.diag.has-errors .err {
		color: var(--ui-danger);
		font-weight: 600;
	}
	.diag .warn {
		color: var(--ui-warn);
	}
	main {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.loading,
	.load-error {
		padding: 24px;
	}
	.load-error {
		color: var(--ui-danger);
	}
</style>
