<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends HTMLAttributes<HTMLElementTagNameMap[`aside`]> {
    as?: keyof HTMLElementTagNameMap
    children?: Snippet
  }
  let { as = `aside`, children, ...rest }: Props = $props()
</script>

<svelte:element this={as} {...rest} class="table-inset {rest.class ?? ``}">
  {@render children?.()}
</svelte:element>

<style>
  .table-inset {
    display: grid;
    box-sizing: border-box;
    grid-row: var(--ptable-inset-row, 1 / span 3);
    grid-column: var(--ptable-inset-col, 3 / span 10);
    container-type: inline-size;
    container-name: table-inset;
  }
</style>
