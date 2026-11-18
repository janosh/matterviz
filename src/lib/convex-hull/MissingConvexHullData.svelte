<script lang="ts">
  import EmptyState from 'svelte-widgets/EmptyState.svelte'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  // `error` switches from the missing-entries hint to the message of an invalid entries prop
  // (e.g. a compound-like composition key rejected by the hull pipeline). `children` holds
  // controls that can fix it (the temperature slider when a T drops a reference).
  let {
    error = null,
    children,
    ...rest
  }: { error?: string | null; children?: Snippet } & HTMLAttributes<HTMLDivElement> = $props()
</script>

<EmptyState role={error ? `alert` : undefined} {...rest}>
  {#if error}
    <h3>Invalid convex hull data</h3>
    <p>{error}</p>
    {@render children?.()}
  {:else}
    <h3>Missing convex hull data</h3>
    <p>Provide convex hull data through the <code>entries</code> prop.</p>
  {/if}
</EmptyState>
