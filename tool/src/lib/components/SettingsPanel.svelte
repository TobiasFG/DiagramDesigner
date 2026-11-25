<script lang="ts">
	import { X } from '@lucide/svelte';
	import { DEFAULT_REST_SHARE, settings } from '#lib/client/settings.svelte.ts';
	import { DEFAULT_LAYOUT, type LayoutOptions } from '#lib/landscape/layout.ts';

	let { onclose }: { onclose: () => void } = $props();

	const directions: { value: LayoutOptions['direction']; label: string }[] = [
		{ value: 'RIGHT', label: '→ Right' },
		{ value: 'DOWN', label: '↓ Down' },
		{ value: 'LEFT', label: '← Left' },
		{ value: 'UP', label: '↑ Up' }
	];
	const placements: { value: LayoutOptions['placement']; label: string }[] = [
		{ value: 'NETWORK_SIMPLEX', label: 'Balanced' },
		{ value: 'BRANDES_KOEPF', label: 'Straight lines' },
		{ value: 'LINEAR_SEGMENTS', label: 'Compact' },
		{ value: 'SIMPLE', label: 'Simple' }
	];
	const shapes: { value: number; label: string }[] = [
		{ value: 2.5, label: 'Wide' },
		{ value: 1.6, label: 'Landscape' },
		{ value: 1, label: 'Square' },
		{ value: 0.6, label: 'Tall' }
	];
	const isDefault = $derived(
		(Object.keys(DEFAULT_LAYOUT) as (keyof LayoutOptions)[]).every(
			(k) => settings.layout[k] === DEFAULT_LAYOUT[k]
		)
	);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<section class="settings" aria-label="Settings" data-testid="settings-panel">
	<header>
		<strong>Settings</strong>
		<button class="close" onclick={onclose} aria-label="Close" title="Close (Esc)"
			><X size={16} /></button
		>
	</header>
	<section class="layout" aria-label="Layout" data-testid="layout-settings">
		<div class="head">
			<span class="legend">LAYOUT</span>
			<button class="link" disabled={isDefault} onclick={() => settings.resetLayout()}
				>Reset to defaults</button
			>
		</div>
		<div class="fld">
			<span class="lbl" id="dir-label">Direction</span>
			<div class="seg" role="radiogroup" aria-labelledby="dir-label">
				{#each directions as d (d.value)}
					<label class:on={settings.layout.direction === d.value}>
						<input
							type="radio"
							name="direction"
							value={d.value}
							checked={settings.layout.direction === d.value}
							onchange={() => settings.setLayout({ direction: d.value })}
						/>{d.label}</label
					>
				{/each}
			</div>
			<span class="hint">What others depend on comes first.</span>
		</div>
		<div class="fld">
			<label class="lbl" for="spacing">Spacing</label>
			<div class="range">
				<input
					id="spacing"
					type="range"
					min="0.25"
					max="3"
					step="0.25"
					value={settings.layout.spacing}
					oninput={(e) => settings.setLayout({ spacing: Number(e.currentTarget.value) })}
				/>
				<output for="spacing">×{settings.layout.spacing}</output>
			</div>
			<span class="hint">Room between boxes, inside and out.</span>
		</div>
		<div class="fld">
			<label class="lbl" for="min-share">Smallest box</label>
			<div class="range">
				<input
					id="min-share"
					type="range"
					min="0"
					max="0.5"
					step="0.025"
					value={settings.layout.minShare}
					oninput={(e) => settings.setLayout({ minShare: Number(e.currentTarget.value) })}
				/>
				<output for="min-share"
					>{settings.layout.minShare
						? `${Math.round(settings.layout.minShare * 100)}%`
						: 'Off'}</output
				>
			</div>
			<span class="hint"
				>Systems and modules with little inside grow to this share of the largest beside them.</span
			>
		</div>
		<label class="fld">
			<span class="lbl">Placement</span>
			<select
				value={settings.layout.placement}
				onchange={(e) =>
					settings.setLayout({
						placement: e.currentTarget.value as LayoutOptions['placement']
					})}
			>
				{#each placements as p (p.value)}<option value={p.value}>{p.label}</option>{/each}
			</select>
			<span class="hint">Balanced keeps lines short; Straight lines lines up chains of boxes.</span>
		</label>
		<label class="fld">
			<span class="lbl">Unconnected groups</span>
			<select
				value={settings.layout.aspect}
				onchange={(e) => settings.setLayout({ aspect: Number(e.currentTarget.value) })}
			>
				{#each shapes as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
			</select>
			<span class="hint">Shape the packed groups fill.</span>
		</label>
	</section>
	<section class="layout" aria-label="Lines" data-testid="line-settings">
		<div class="head">
			<span class="legend">LINES</span>
			<button
				class="link"
				disabled={settings.restShare === DEFAULT_REST_SHARE}
				onclick={() => settings.setRestShare(DEFAULT_REST_SHARE)}>Reset to default</button
			>
		</div>
		<div class="fld">
			<label class="lbl" for="rest-share">Module dependency lines</label>
			<div class="range">
				<input
					id="rest-share"
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={settings.restShare}
					oninput={(e) => settings.setRestShare(Number(e.currentTarget.value))}
				/>
				<output for="rest-share"
					>{settings.restShare ? `${Math.round(settings.restShare * 100)}%` : 'All'}</output
				>
			</div>
			<span class="hint"
				>Lines inside a module show once it fills this share of the view. Lines between top-level
				modules always show.</span
			>
		</div>
	</section>
	<footer>Saved in this browser.</footer>
</section>

<style>
	.settings {
		position: absolute;
		right: 12px;
		top: 51px;
		width: 340px;
		z-index: 20;
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
		max-height: calc(100% - 63px);
		overflow-y: auto;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		border-bottom: 1px solid var(--ui-border);
	}
	.close {
		border: none;
		background: none;
		color: var(--ui-muted);
		display: flex;
		padding: 2px;
	}
	.layout + .layout {
		border-top: 1px solid var(--ui-border);
	}
	.layout {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
	}
	.legend {
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: var(--ui-muted);
	}
	.link {
		border: none;
		background: none;
		padding: 0;
		font: inherit;
		font-size: 12px;
		color: var(--ui-accent);
		cursor: pointer;
	}
	.link:disabled {
		color: var(--ui-muted);
		cursor: default;
	}
	.fld {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	label.fld {
		align-items: flex-start;
	}
	.lbl {
		font-size: 12px;
		font-weight: 600;
	}
	.hint {
		font-size: 12px;
		color: var(--ui-muted);
		line-height: 1.4;
	}
	.seg {
		display: flex;
		border: 1px solid var(--ui-border);
	}
	.layout .seg label {
		display: flex;
		cursor: pointer;
		flex: 1;
		justify-content: center;
		font-size: 12px;
		padding: 5px 0;
		border-right: 1px solid var(--ui-border);
	}
	.layout .seg label:last-child {
		border-right: none;
	}
	.layout .seg label.on {
		background: var(--ui-accent-bg);
		color: var(--ui-accent);
		font-weight: 600;
	}
	.seg input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	.range {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.range input {
		flex: 1;
		margin: 0;
		accent-color: var(--ui-accent);
	}
	output {
		width: 36px;
		text-align: right;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}
	select {
		font: inherit;
		font-size: 13px;
		color: var(--ui-text);
		background: var(--ui-panel);
		border: 1px solid var(--ui-border);
		padding: 5px 6px;
	}
	footer {
		padding: 10px 14px;
		border-top: 1px solid var(--ui-border);
		font-size: 12px;
		color: var(--ui-muted);
	}
</style>
