<script lang="ts">
  import Icon from './Icon.svelte'

  export let element_name: string | null = null
  // style applies to img and missing_msg div
  export let style: string | null = null
  export let missing_msg = `No image for `

  $: src = `https://images-of-elements.com/s/${element_name?.toLowerCase()}.jpg`
  let hidden = false
  $: src, (hidden = false) // reset hidden to false when src changes
</script>

{#if element_name}
  <img {src} alt={element_name} on:error={() => (hidden = true)} {style} {hidden} />
  {#if hidden && missing_msg}
    <div {style}>
      <span>
        <Icon icon="ic:outline-image-not-supported" />{missing_msg}
        {element_name}
      </span>
    </div>
  {/if}
{/if}

<style>
  img {
    width: 100%;
    object-fit: cover;
    margin: 0;
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
    color: white;
    border-radius: 4pt;
    overflow: hidden;
    width: 100%;
    container-type: inline-size;
  }
  div > span {
    font-size: 15cqw;
  }
</style>
