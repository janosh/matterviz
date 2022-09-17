<script lang="ts">
  import { active_element } from './stores'
  import type { ChemicalElement } from './types'

  export let style: string | null = null
  // element defaults to active_element store but can be pinned by passing it as prop
  export let element: ChemicalElement | undefined = undefined
  export let missing_msg = ``

  $: elem = element ?? $active_element

  $: src = `https://images-of-elements.com/s/${elem?.name?.toLowerCase()}.jpg`
  let hidden = false
  $: src, (hidden = false) // reset hidden to false when src changes
</script>

{#if elem}
  <img {src} alt={elem?.name} on:error={() => (hidden = true)} {style} {hidden} />
  {#if hidden && missing_msg}
    <div {style}>
      <span>{missing_msg} {elem.name}</span>
    </div>
  {/if}
{/if}

<style>
  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  div {
    aspect-ratio: 1;
    display: flex;
    place-content: center;
    place-items: center;
    background-image: linear-gradient(
      to top left,
      rgba(0, 100, 0, 0.5),
      rgba(0, 0, 100, 0.3)
    );
    border-radius: 4pt;
    overflow: hidden;
    width: 100%;
  }
  div > span {
    background-color: rgba(255, 255, 255, 0.1);
    padding: 1ex 1em;
    border-radius: 1em;
    margin: 1em;
  }
</style>
