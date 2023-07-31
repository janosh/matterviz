<script lang="ts">
  import { default_category_colors } from '$lib/colors'
  import { active_category, category_colors } from '$lib/stores'
  import { fade } from 'svelte/transition'
  import { Icon } from '..'

  export let open = false
  export let collapsible = true

  $: if (typeof document !== `undefined`) {
    for (const [key, val] of Object.entries($category_colors)) {
      document.documentElement.style.setProperty(`--${key}-bg-color`, val)
    }
  }
</script>

<slot name="title">
  <h2 transition:fade>
    <button
      on:click={() => (open = !open)}
      on:keyup={(e) => [`Enter`, ` `].includes(e.key) && (open = !open)}
      title={!open && collapsible ? `Click to open color picker` : null}
      style:cursor={collapsible ? `pointer` : `default`}
    >
      <Icon icon="ion:color-palette" />
      Customize Colors
    </button>
  </h2>
</slot>
<div class="grid" transition:fade>
  {#if open || !collapsible}
    {#each Object.keys($category_colors) as category}
      <label
        for="{category}-color"
        transition:fade={{ duration: 200 }}
        on:mouseenter={() => ($active_category = category)}
        on:focus={() => ($active_category = category)}
        on:mouseleave={() => ($active_category = null)}
        on:blur={() => ($active_category = null)}
      >
        <input
          type="color"
          id="{category}-color"
          bind:value={$category_colors[category]}
        />
        {category.replaceAll(`-`, ` `)}
        {#if $category_colors[category] !== default_category_colors[category]}
          <button
            on:click|preventDefault={() =>
              ($category_colors[category] = default_category_colors[category])}
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
    gap: var(--grid-gap, 7pt);
    max-width: var(--grid-max-width, 70em);
    margin: 2em auto;
    justify-self: center;
  }
  div.grid > label {
    padding: var(--label-padding, 1pt 6pt);
    display: flex;
    align-items: center;
    gap: var(--label-gap, 4pt);
    border-radius: 3pt;
    text-transform: capitalize;
    font-weight: lighter;
    cursor: pointer;
  }
  div.grid > label:hover {
    background-color: rgba(255, 255, 255, 0.1);
  }
  div.grid > label > input {
    height: var(--input-color-height, 3em);
    width: var(--input-color-width, 3em);
    min-height: var(--input-color-min-height, var(--input-color-height, 3em));
    min-width: var(--input-color-min-width, var(--input-color-width, 3em));
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
    font-size: 1.2em;
  }
  label {
    max-width: 16em;
  }
  label > button {
    background: none;
    color: var(--text-color);
    opacity: 0;
    transition: 0.3s;
    border-radius: 2pt;
    margin-left: auto;
  }
  label:hover > button {
    opacity: 0.8;
  }
  label > button:hover {
    background-color: rgba(255, 255, 255, 0.2);
  }
</style>
