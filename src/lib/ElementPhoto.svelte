<script lang="ts">
  import { Icon, type ChemicalElement } from '.'

  export let element: ChemicalElement
  // style applies to both img and missing_msg div
  export let style: string | null = null
  export let missing_msg = `No image for `

  $: ({ name, number } = element ?? {})

  $: src = `/elements/${number}-${name?.toLowerCase()}.jpg`
  let hidden = false
  $: src, (hidden = false) // reset hidden to false when src changes
</script>

{#if name && number}
  <img {src} alt={name} on:error={() => (hidden = true)} {style} {hidden} />
  {#if hidden && missing_msg}
    <div {style}>
      <span>
        <Icon icon="ic:outline-image-not-supported" />{missing_msg}
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
    color: white;
    border-radius: 4pt;
    width: 100%;
    container-type: inline-size;
  }
  div > span {
    font-size: 15cqw;
  }
</style>
