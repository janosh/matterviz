<script lang="ts">
  import EmptyState from '$lib/EmptyState.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let { ...rest }: HTMLAttributes<HTMLDivElement> = $props()
</script>

<EmptyState role="status" {...rest}>
  <h3>Missing convex hull data</h3>
  <p>Provide convex hull data through the <code>entries</code> prop.</p>
</EmptyState>
