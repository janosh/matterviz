<script lang="ts">
  import type { Snippet } from 'svelte'

  // Wrapping row of labeled inputs that drive a test page's bound state
  let { children }: { children?: Snippet<[]> } = $props()
</script>

<div>{@render children?.()}</div>

<style>
  div {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5em 1.5em;
    margin-block: 1em;
  }
  div :global(label) {
    display: inline-flex;
    align-items: center;
    gap: 0.4em;
  }
</style>
