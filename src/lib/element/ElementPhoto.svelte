<script lang="ts">
  import type { ChemicalElement } from '$lib'

  interface Props {
    element: ChemicalElement
    // style applies to both img and missing_msg div
    style?: string | null
    missing_msg?: string
  }
  let { element, style = null, missing_msg = `No image for ` }: Props = $props()

  let { name, number } = $derived(element ?? {})

  let file = $derived(`elements/${number}-${name?.toLowerCase()}.avif`)
  let hidden = $state(false)
  $effect.pre(() => {
    if (file) hidden = false
  }) // reset hidden to false when file changes
</script>

{#if name && number}
  <img
    src="https://github.com/janosh/elementari/raw/main/static/{file}"
    alt={name}
    onerror={() => (hidden = true)}
    {style}
    {hidden}
  />
  {#if hidden && missing_msg}
    <div {style}>
      <span>
        <svg><use href="#icon-no-image" /></svg>&nbsp;{missing_msg}
        {name}
      </span>
    </div>
  {/if}
{/if}

<style>
  img {
    width: 100%;
    object-fit: cover;
    margin: 0;
    border-radius: 4pt;
  }
  div {
    aspect-ratio: 1;
    text-align: center;
    display: flex;
    padding: 3pt;
    box-sizing: border-box;
    place-items: center;
    background-image: linear-gradient(
      to top left,
      rgba(0, 100, 0, 0.5),
      rgba(0, 0, 100, 0.3)
    );
    color: var(--text-color);
    border-radius: 4pt;
    width: 100%;
    container-type: inline-size;
  }
  div > span {
    font-size: 15cqw;
  }
</style>
