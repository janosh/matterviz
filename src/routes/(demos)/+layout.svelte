<script lang="ts">
  import { name } from '$root/package.json'
  import type { Snippet } from 'svelte'

  interface Props {
    children?: Snippet
  }
  let { children }: Props = $props()
</script>

<h1>
  <img src="favicon.svg" alt={name} height="50" width="50" />&ensp;Examples
</h1>

<main>
  {@render children?.()}
</main>

<style>
  h1 {
    text-align: center;
    display: flex;
    place-content: center;
    place-items: center;
  }
  main :global(h2) {
    text-align: center;
  }
</style>
