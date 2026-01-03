<script lang="ts">
  import type { ChemicalElement } from '$lib'
  import Icon from '$lib/Icon.svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  let { element, missing_msg = `No image for `, ...rest }:
    & HTMLAttributes<HTMLImageElement | HTMLDivElement>
    & { element: ChemicalElement; missing_msg?: string } = $props()

  let { name, number } = $derived(element ?? {})
  let file = $derived(`elements/${number}-${name?.toLowerCase()}.avif`)
  let hidden = $state(false)
  $effect.pre(() => {
    if (file) hidden = false
  }) // reset hidden to false when file changes
</script>

{#if name && number}
  {@const src = `https://github.com/janosh/matterviz/raw/main/static/${file}`}
  <img {src} alt={name} onerror={() => (hidden = true)} {hidden} {...rest} />
  {#if hidden && missing_msg}
    <div {...rest}>
      <span>
        <Icon icon="NoImage" />&nbsp;{missing_msg} {name}
      </span>
    </div>
  {/if}
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
    background-image: linear-gradient(
      to top left,
      rgba(0, 100, 0, 0.5),
      rgba(0, 0, 100, 0.3)
    );
    color: var(--text-color);
    border-radius: var(--element-photo-border-radius, var(--border-radius, 3pt));
    width: 100%;
    container-type: inline-size;
  }
  div > span {
    font-size: 15cqw;
  }
</style>
