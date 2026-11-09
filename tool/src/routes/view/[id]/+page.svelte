<script lang="ts">
	import { page } from '$app/state';
	import ViewEditor from '$lib/components/ViewEditor.svelte';
</script>

<!-- Fresh editor state (selection, canvas) per view. -->
{#key page.params.id}
	<ViewEditor viewId={page.params.id!} />
{/key}
