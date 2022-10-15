<script lang="ts">
  import Icon from './Icon.svelte'

  export let element_name: string | null = null
  export let style: string | null = null
  export let missing_msg = ``

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
