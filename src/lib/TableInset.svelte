<script lang="ts">
  export let style: string | null = null
  export let tag: string = `aside` // styles below don't apply if tag is not aside or div
</script>

<svelte:element this={tag} {style}>
  <slot />
</svelte:element>

<style>
  aside,
  div {
    display: grid;
    box-sizing: border-box;
    grid-row: 1 / span 3;
    grid-column: 3 / span 10;
  }
</style>
