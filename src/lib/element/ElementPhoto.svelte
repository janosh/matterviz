<script lang="ts">
  import type { ChemicalElement } from '$lib/element'
  import { Icon } from 'svelte-widgets'
  import { NoImage } from 'svelte-widgets/icons'
  import type { HTMLAttributes } from 'svelte/elements'

  let {
    element,
    missing_msg = `No image for `,
    ...rest
  }: HTMLAttributes<HTMLImageElement | HTMLDivElement> & {
    element: ChemicalElement
    missing_msg?: string
  } = $props()

  const src = $derived(
    `https://github.com/janosh/matterviz/raw/main/static/elements/${element.number}-${element.name.toLowerCase()}.avif`,
  )
  // URL whose load failed; a new element (new URL) is shown again until it fails too
  let failed_src = $state<string | null>(null)
  const hidden = $derived(failed_src === src)
</script>

<img {src} alt={element.name} onerror={() => (failed_src = src)} {hidden} {...rest} />
{#if hidden && missing_msg}
  <div {...rest}>
    <span>
      <Icon icon={NoImage} />&nbsp;{missing_msg}
      {element.name}
    </span>
  </div>
{/if}

<style>
  img {
    width: 100%;
    object-fit: cover;
    margin: 0;
    border-radius: var(--element-photo-border-radius, var(--border-radius, 3pt));
  }
  div {
    aspect-ratio: 1;
    text-align: center;
    display: flex;
    padding: var(--element-photo-padding, 3pt);
    box-sizing: border-box;
    place-items: center;
    background-image: linear-gradient(to top left, rgba(0, 100, 0, 0.5), rgba(0, 0, 100, 0.3));
    color: var(--text-color);
    border-radius: var(--element-photo-border-radius, var(--border-radius, 3pt));
    width: 100%;
    container-type: inline-size;
  }
  div > span {
    font-size: 15cqw;
  }
</style>
