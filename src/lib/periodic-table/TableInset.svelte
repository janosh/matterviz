<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<HTMLElementTagNameMap[`aside`]> {
    style?: string | null
    as?: string // styles below don't apply if tag is not aside or div
    children?: Snippet
  }
  let { style = null, as = `aside`, children }: Props = $props()
</script>

<svelte:element this={as} {style}>
  {@render children?.()}
</svelte:element>

<style>
  aside, div {
    display: grid;
    box-sizing: border-box;
    grid-row: var(--ptable-inset-row, 1 / span 3);
    grid-column: var(--ptable-inset-col, 3 / span 10);
    container-type: inline-size;
    container-name: table-inset;
  }
</style>
