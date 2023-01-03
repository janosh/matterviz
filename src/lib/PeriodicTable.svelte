<script lang="ts">
  import { extent } from 'd3-array'
  import type { ScaleLinear } from 'd3-scale'
  import { scaleLinear, scaleLog } from 'd3-scale'
  import type { Category, ChemicalElement } from '.'
  import element_data from './element-data'
  import ElementPhoto from './ElementPhoto.svelte'
  import ElementTile from './ElementTile.svelte'

  export let show_names = true
  export let show_numbers = true
  export let show_symbols = true
  export let show_photo = true
  export let style = ``
  export let disabled = false // disable hover and click events from updating active_element
  // either array of length 118 (one heat value for each element) or object with
  // element symbol as key and heat value as value
  export let heatmap_values: number[] = []
  // links is either string with element property (name, symbol, number, ...) to use as link,
  // or object with mapping element symbols to link
  export let links: keyof ChemicalElement | Record<string, string> | null = null
  export let color_map: keyof ChemicalElement | Record<number, string> | null = null
  export let log = false
  export let color_scale: ScaleLinear<number, string, never> | null = null
  export let active_element: ChemicalElement | null = null
  export let active_category: Category | null = null

  $: if (![0, 118].includes(heatmap_values.length)) {
    console.error(
      `heatmap_values should be an array of length 118, one for each element, got ${heatmap_values.length}`
    )
  }

  $: color_scale = (log ? scaleLog : scaleLinear)()
    // .domain(extent(heatmap_values ?? []).map((v) => (log ? Math.max(v, 1) : v)))
    .domain(color_map ? Object.keys(color_map) : extent(heatmap_values))
    .range(color_map ? Object.values(color_map) : [`blue`, `red`])

  $: set_active_element = (element: ChemicalElement | null) => () => {
    if (disabled) return
    active_element = element
  }

  let window_width: number
</script>

<svelte:window bind:innerWidth={window_width} />

<div class="periodic-table" {style}>
  <slot name="inset" />

  {#each element_data as element, idx}
    {@const { column, row, category, name, symbol } = element}
    {@const value = heatmap_values?.length > 0 && heatmap_values[idx]}
    {@const active =
      active_category === category.replaceAll(` `, `-`) || active_element?.name === name}
    <ElementTile
      {element}
      href={links
        ? typeof links == `string`
          ? `${element[links]}`.toLowerCase()
          : links[symbol]
        : null}
      style="grid-column: {column}; grid-row: {row};"
      show_name={show_names}
      show_number={show_numbers}
      show_symbol={show_symbols}
      {value}
      bg_color={value != false ? color_scale?.(value) ?? `transparent` : null}
      {active}
      on:mouseenter={set_active_element(element)}
      on:mouseleave={set_active_element(null)}
    />
  {/each}
  <!-- provide vertical offset for lanthanides + actinides -->
  <div class="spacer" />

  {#if show_photo}
    <ElementPhoto
      element_name={active_element?.name}
      style="grid-area: 9/1/span 2/span 2;"
    />
  {/if}
</div>

<style>
  :global(:has(div.periodic-table)) {
    /* needed for gap: 0.3cqw; below to work */
    container-type: inline-size;
  }
  div.periodic-table {
    display: grid;
    grid-template-columns: repeat(18, 1fr);
    gap: 0.3cqw;
    position: relative;
    container-type: inline-size;
  }
  div.spacer {
    grid-row: 8;
    aspect-ratio: 2;
  }
</style>
