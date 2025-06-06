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
  main :global(h2) {
    text-align: center;
  }
</style>
