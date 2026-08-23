<script lang="ts">
  import EmptyState from '$lib/EmptyState.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  // `error` switches from the missing-entries hint to the message of an invalid entries prop
  // (e.g. a compound-like composition key rejected by the hull pipeline)
  let { error = null, ...rest }: { error?: string | null } & HTMLAttributes<HTMLDivElement> =
    $props()
</script>

<EmptyState role={error ? `alert` : `status`} {...rest}>
  {#if error}
    <h3>Invalid convex hull data</h3>
    <p>{error}</p>
  {:else}
    <h3>Missing convex hull data</h3>
    <p>Provide convex hull data through the <code>entries</code> prop.</p>
  {/if}
</EmptyState>
