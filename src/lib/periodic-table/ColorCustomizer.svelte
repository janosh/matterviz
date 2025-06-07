<script lang="ts">
  import type { Category } from '$lib'
  import { default_category_colors } from '$lib/colors'
  import { colors, selected } from '$lib/state.svelte'
  import type { Snippet } from 'svelte'
  import { fade } from 'svelte/transition'

  interface Props {
    open?: boolean
    collapsible?: boolean
    title?: Snippet
  }
  let { open = $bindable(false), collapsible = true, title }: Props = $props()

  $effect.pre(() => {
    if (typeof document !== `undefined`) {
      for (const [key, val] of Object.entries(colors.category)) {
        document.documentElement.style.setProperty(`--${key}-bg-color`, val)
      }
    }
  })
</script>

{#if title}{@render title()}{:else}
  <h2 transition:fade>
    <button
      onclick={() => (open = !open)}
      onkeyup={(e) => [`Enter`, ` `].includes(e.key) && (open = !open)}
      title={!open && collapsible ? `Click to open color picker` : null}
      style:cursor={collapsible ? `pointer` : `default`}
    >
      <svg><use href="#icon-color-palette" /></svg>
      Customize Colors
    </button>
  </h2>
{/if}
<div class="grid" transition:fade>
  {#if open || !collapsible}
    {#each Object.keys(colors.category) as category (category)}
      <label
        for="{category}-color"
        transition:fade={{ duration: 200 }}
        onmouseenter={() => (selected.category = category as Category)}
        onfocus={() => (selected.category = category as Category)}
        onmouseleave={() => (selected.category = null)}
        onblur={() => (selected.category = null)}
      >
        <input
          type="color"
          id="{category}-color"
          bind:value={colors.category[category]}
        />
        {category.replaceAll(`-`, ` `)}
        {#if colors.category[category] !== default_category_colors[category]}
          <button
            onclick={(event) => {
              event.preventDefault()
              colors.category[category] = default_category_colors[category]
            }}
          >
            reset
          </button>
        {/if}
      </label>
    {/each}
  {/if}
</div>

<style>
  div.grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12em, 1fr));
    place-content: center;
    gap: var(--color-grid-gap, 7pt);
    max-width: var(--color-grid-width, 70em);
    margin: var(--color-grid-margin, 2em auto);
    justify-self: center;
  }
  div.grid > label {
    padding: var(--color-label-pad, 1pt 6pt);
    display: flex;
    align-items: center;
    gap: var(--color-label-gap, 4pt);
    border-radius: var(--color-label-radius, 3pt);
    text-transform: capitalize;
    font-weight: lighter;
    cursor: pointer;
  }
  div.grid > label:hover {
    background-color: var(--color-label-hover-bg, rgba(255, 255, 255, 0.1));
  }
  div.grid > label > input {
    height: var(--color-input-size, 3em);
    width: var(--color-input-size, 3em);
    min-height: var(--color-input-min-size, 3em);
    min-width: var(--color-input-min-size, 3em);
    border: none;
    background-color: transparent;
    cursor: pointer;
    aspect-ratio: 1;
  }
  h2 {
    text-align: center;
  }
  h2 > button {
    background: none;
    font-size: var(--color-title-size, 1.2em);
  }
  label {
    max-width: var(--color-label-width, 16em);
  }
  label > button {
    background: none;
    color: var(--color-reset-color, var(--text-color));
    opacity: 0;
    transition: var(--color-reset-transition, 0.3s);
    border-radius: var(--color-reset-radius, 2pt);
    margin-left: auto;
  }
  label:hover > button {
    opacity: var(--color-reset-hover-opacity, 0.8);
  }
  label > button:hover {
    background-color: var(--color-reset-hover-bg, rgba(255, 255, 255, 0.2));
  }
</style>
