<script lang="ts">
  import elements from './element-data.ts'
  import ElementPhoto from './ElementPhoto.svelte'
  import ElementTile from './ElementTile.svelte'
  import { active_category, active_element, color_scale, last_element } from './stores'
  import type { ChemicalElement } from './types'

  export let show_names = true
  export let show_numbers = true
  export let show_symbols = true
  export let show_photo = true
  export let heatmap: keyof ChemicalElement | null = null
  export let style = ``
  export let disabled = false

  $: set_active_element = (element: ChemicalElement | null) => () => {
    if (disabled) return
    $active_element = element
  }

  let window_width: number
</script>

<svelte:window bind:innerWidth={window_width} />

<div class="periodic-table" {style}>
  <slot name="inset" />

  {#each elements as element}
    {@const value = element[heatmap]}
    {@const heatmap_color = value ? $color_scale?.(value) : `transparent`}
    {@const bg_color = heatmap ? heatmap_color : null}
    {@const active =
      $active_category === element.category || $active_element?.name === element.name}
    <a
      href={element.name.toLowerCase()}
      data-sveltekit-noscroll
      style="grid-column: {element.column}; grid-row: {element.row};"
      class:last-active={$last_element === element}
    >
      <ElementTile
        {element}
        show_name={show_names}
        show_number={show_numbers}
        show_symbol={show_symbols}
        {value}
        {bg_color}
        {active}
        on:mouseenter={set_active_element(element)}
        on:mouseleave={set_active_element(null)}
      />
    </a>
  {/each}
  <!-- provide vertical offset for lathanices + actinides -->
  <div class="spacer" />

  {#if show_photo}
    <ElementPhoto style="grid-column: 1 / span 2; grid-row: 9 / span 2;" />
  {/if}
</div>

<style>
  div.periodic-table {
    display: grid;
    grid-template-columns: repeat(18, 1fr);
    gap: min(0.2vw, 3pt);
    position: relative;
  }
  div.spacer {
    grid-row: 8;
    aspect-ratio: 2;
  }
  div.periodic-table > a.last-active {
    filter: brightness(110%);
  }
</style>
