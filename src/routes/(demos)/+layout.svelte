<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    children?: Snippet
  }
  let { children }: Props = $props()
</script>

<main>
  {@render children?.()}
</main>

<style>
  main :global(:is(h1, h2, h3)) {
    text-align: center;
  }
</style>
