<script lang="ts">
	import { parse as parseYaml, stringify } from 'yaml';
	import SchemaField from './SchemaField.svelte';
	import { resolveSchema, type JsonSchema } from './schema-form';

	let {
		schema,
		value,
		label,
		required = false,
		root,
		disabled = false,
		onchange
	}: {
		schema: JsonSchema;
		value: unknown;
		label: string;
		required?: boolean;
		root: JsonSchema;
		disabled?: boolean;
		onchange: (v: unknown) => void;
	} = $props();

	const s = $derived(resolveSchema(schema, root));
	const kind = $derived.by(() => {
		if (s.enum) return 'enum';
		if (s.anyOf || s.oneOf) return 'yaml';
		if (s.type === 'boolean') return 'boolean';
		if (s.type === 'number' || s.type === 'integer') return 'number';
		if (s.type === 'array') {
			const items = resolveSchema(s.items ?? {}, root);
			if (items.type === 'string' && !items.enum) return 'strings';
			if (items.type === 'object' && items.properties) return 'objects';
			return 'yaml';
		}
		if (s.type === 'object' && s.properties) return 'object';
		if (s.type === 'object') return 'record';
		return 'string';
	});
	const id = $props.id();

	function newItem(itemSchema: JsonSchema): Record<string, unknown> {
		const it = resolveSchema(itemSchema, root);
		const out: Record<string, unknown> = {};
		for (const key of it.required ?? []) {
			const p = resolveSchema(it.properties?.[key] ?? {}, root);
			out[key] = p.enum ? p.enum[0] : p.type === 'array' ? [] : p.type === 'boolean' ? false : '';
		}
		return out;
	}

	const list = $derived(Array.isArray(value) ? (value as unknown[]) : []);
	const record = $derived(
		value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {}
	);

	function setItem(i: number, v: unknown) {
		onchange(list.map((x, j) => (j === i ? v : x)));
	}
	function moveItem(i: number, d: number) {
		const next = [...list];
		const [it] = next.splice(i, 1);
		next.splice(i + d, 0, it);
		onchange(next);
	}
	let yamlError = $state('');
</script>

{#if kind === 'object'}
	<fieldset>
		<legend>{label}</legend>
		{#each Object.entries(s.properties ?? {}) as [key, sub] (key)}
			<SchemaField
				schema={sub}
				value={record[key]}
				label={key}
				required={s.required?.includes(key)}
				{root}
				{disabled}
				onchange={(v) => onchange({ ...record, [key]: v })}
			/>
		{/each}
	</fieldset>
{:else if kind === 'objects'}
	<fieldset class="list">
		<legend>{label} <span class="muted">({list.length})</span></legend>
		{#each list as item, i (i)}
			<div class="item">
				<div class="item-actions">
					<span class="muted">#{i + 1}</span>
					<button
						class="icon"
						disabled={disabled || i === 0}
						onclick={() => moveItem(i, -1)}
						aria-label="Move up">▲</button
					>
					<button
						class="icon"
						disabled={disabled || i === list.length - 1}
						onclick={() => moveItem(i, 1)}
						aria-label="Move down">▼</button
					>
					<button
						class="icon danger"
						{disabled}
						onclick={() => onchange(list.filter((_, j) => j !== i))}
						aria-label="Remove">×</button
					>
				</div>
				{#each Object.entries(resolveSchema(s.items ?? {}, root).properties ?? {}) as [key, sub] (key)}
					<SchemaField
						schema={sub}
						value={(item as Record<string, unknown>)?.[key]}
						label={key}
						required={resolveSchema(s.items ?? {}, root).required?.includes(key)}
						{root}
						{disabled}
						onchange={(v) => setItem(i, { ...(item as Record<string, unknown>), [key]: v })}
					/>
				{/each}
			</div>
		{/each}
		<button {disabled} onclick={() => onchange([...list, newItem(s.items ?? {})])}
			>+ Add {label.replace(/s$/, '')}</button
		>
	</fieldset>
{:else}
	<div class="field">
		<label for={id}>{label}{required ? ' *' : ''}</label>
		{#if kind === 'enum'}
			<select
				{id}
				{disabled}
				value={value ?? ''}
				onchange={(e) => onchange(e.currentTarget.value || undefined)}
			>
				{#if !required}<option value="">—</option>{/if}
				{#each s.enum ?? [] as opt (opt)}<option value={opt}>{opt}</option>{/each}
			</select>
		{:else if kind === 'boolean'}
			<select
				{id}
				{disabled}
				value={value === undefined ? '' : String(value)}
				onchange={(e) =>
					onchange(e.currentTarget.value === '' ? undefined : e.currentTarget.value === 'true')}
			>
				<option value="">—</option>
				<option value="true">true</option>
				<option value="false">false</option>
			</select>
		{:else if kind === 'number'}
			<input
				{id}
				{disabled}
				type="number"
				value={value ?? ''}
				onchange={(e) =>
					onchange(e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value))}
			/>
		{:else if kind === 'strings'}
			<input
				{id}
				{disabled}
				value={list.join(', ')}
				placeholder="comma separated"
				onchange={(e) =>
					onchange(
						e.currentTarget.value
							.split(',')
							.map((x) => x.trim())
							.filter(Boolean)
					)}
			/>
		{:else if kind === 'record'}
			<textarea
				{id}
				{disabled}
				rows={Math.max(2, Object.keys(record).length + 1)}
				value={Object.entries(record)
					.map(([k, v]) => `${k}: ${v}`)
					.join('\n')}
				placeholder="key: value"
				onchange={(e) => {
					const out: Record<string, string> = {};
					for (const line of e.currentTarget.value.split('\n')) {
						const m = /^\s*([^:]+?)\s*:\s*(.*)$/.exec(line);
						if (m) out[m[1]] = m[2];
					}
					onchange(Object.keys(out).length ? out : undefined);
				}}></textarea>
		{:else if kind === 'yaml'}
			<textarea
				{id}
				{disabled}
				class="mono"
				rows="3"
				value={value === undefined ? '' : stringify(value).trimEnd()}
				onchange={(e) => {
					try {
						yamlError = '';
						onchange(e.currentTarget.value.trim() ? parseYaml(e.currentTarget.value) : undefined);
					} catch (err) {
						yamlError = (err as Error).message.split('\n')[0];
					}
				}}></textarea>
			{#if yamlError}<span class="error">{yamlError}</span>{/if}
		{:else}
			<input
				{id}
				{disabled}
				value={value ?? ''}
				onchange={(e) => onchange(e.currentTarget.value === '' ? undefined : e.currentTarget.value)}
			/>
		{/if}
		{#if s.description}<span class="hint muted">{s.description}</span>{/if}
	</div>
{/if}

<style>
	fieldset {
		border: 1px solid var(--ui-border);
		border-radius: 6px;
		margin: 4px 0 8px;
		padding: 4px 8px 8px;
		min-width: 0;
	}
	legend {
		font-size: 12px;
		font-weight: 600;
		padding: 0 4px;
	}
	.item {
		border-bottom: 1px dashed var(--ui-border);
		padding: 4px 0 6px;
		margin-bottom: 4px;
	}
	.item-actions {
		display: flex;
		align-items: center;
		gap: 4px;
		justify-content: flex-end;
	}
	.item-actions span {
		margin-right: auto;
		font-size: 12px;
	}
	.item-actions button {
		padding: 0 6px;
		min-width: 0;
		font-size: 11px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 4px 0;
	}
	label {
		font-size: 12px;
		color: var(--ui-muted);
	}
	input,
	select,
	textarea {
		width: 100%;
		min-width: 0;
	}
	.hint {
		font-size: 11px;
	}
	.error {
		color: var(--ui-danger);
		font-size: 12px;
	}
</style>
