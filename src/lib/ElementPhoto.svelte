<script lang="ts">
  import { active_element } from './stores'
  import type { ChemicalElement } from './types'

  export let style: string | null = null
  // element defaults to active_element store but can be pinned by passing it as prop
  export let element: ChemicalElement | undefined = undefined

  $: elem = element ?? $active_element

  $: src = `https://images-of-elements.com/s/${elem?.name?.toLowerCase()}.jpg`
  let hidden = false
  $: src, (hidden = false) // reset hidden to false when src changes
</script>

{#if elem}
  <img {src} alt={elem?.name} on:error={() => (hidden = true)} {style} {hidden} />
{/if}

<style>
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 1pt;
  }
</style>
