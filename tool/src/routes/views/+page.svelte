<script lang="ts">
	import { resolve } from '$app/paths';
	import { design } from '$lib/client/store.svelte';
	import { VIEW_TYPES, type ViewType } from '$lib/model/schema';

	const LABELS: Record<ViewType, string> = {
		component: 'Component / system',
		class: 'Class',
		object: 'Object',
		flow: 'Flow',
		pipeline: 'Pipeline',
		sequence: 'Sequence'
	};

	const groups = $derived(
		VIEW_TYPES.map((type) => ({
			type,
			views: [...design.model.views.values()]
				.filter((v) => v.def.type === type)
				.sort((a, b) => a.title.localeCompare(b.title))
		})).filter((g) => g.views.length)
	);
	const m = $derived(design.model);
</script>

<div class="index">
	<section class="summary">
		<h1>Views</h1>
		<p class="muted">
			{m.elements.size} elements · {m.relationships.length} relationships · {m.classes.size} classes ·
			{m.objects.size} objects ·
			{m.flows.size} flows · {m.pipelines.size} pipelines · {m.interactions.size} interactions · {m
				.files.length} files
		</p>
	</section>
	{#each groups as g (g.type)}
		<section>
			<h2>{LABELS[g.type]}</h2>
			<ul class="cards">
				{#each g.views as v (v.id)}
					<li>
						<a href={resolve('/view/[id]', { id: v.id })} data-testid="view-link-{v.id}">
							<span class="title">{v.title}</span>
							<code class="muted">{v.id}</code>
							{#if v.generated}<span
									class="tag"
									title="No view file defines this; the app generated a default view"
									>generated</span
								>{/if}
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{:else}
		<p class="muted">
			No views yet. Add <code>*.view.yaml</code> files under <code>views/</code>, or define flows,
			pipelines or interactions to get generated views.
		</p>
	{/each}
</div>

<style>
	.index {
		overflow: auto;
		padding: 16px 24px 48px;
	}
	h1 {
		margin: 0 0 4px;
		font-size: 22px;
	}
	h2 {
		font-size: 15px;
		margin: 24px 0 8px;
		color: var(--ui-muted);
		font-weight: 600;
	}
	.cards {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 10px;
	}
	.cards a {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 14px;
		border: 1px solid var(--ui-border);
		border-radius: 8px;
		background: var(--ui-panel);
		text-decoration: none;
		color: var(--ui-text);
		height: 100%;
	}
	.cards a:hover {
		border-color: var(--ui-accent);
	}
	.title {
		font-weight: 600;
	}
	.tag {
		align-self: flex-start;
		font-size: 11px;
		padding: 0 6px;
		border-radius: 8px;
		background: var(--ui-hover);
		color: var(--ui-muted);
		margin-top: 4px;
	}
</style>
