<script lang="ts">
  import { goto } from '$app/navigation'
  import * as d3sc from 'd3-scale-chromatic'
  import type { Category, ChemicalElement, PeriodicTableEvents } from '.'
  import { ElementPhoto, ElementTile, type ElementSymbol } from '.'
  import element_data from './element-data'
  import { elem_symbols } from './labels'

  export let tile_props: {
    show_name?: boolean
    show_number?: boolean
    show_symbol?: boolean
    text_color_threshold?: number
    precision?: number
  } = {}
  export let show_photo = true
  export let style = ``
  export let disabled = false // disable hover and click events from updating active_element
  // either array of length 118 (one heat value for each element) or object with
  // element symbol as key and heat value as value
  export let heatmap_values: Record<ElementSymbol, number> | number[] = []
  // links is either string with element property (name, symbol, number, ...) to use as link,
  // or object with mapping element symbols to link
  export let links: keyof ChemicalElement | Record<ElementSymbol, string> | null = null
  export let log = false
  export let color_scale: string | ((num: number) => string) = `Viridis`
  export let active_element: ChemicalElement | null = null
  export let active_category: Category | null = null
  export let gap = `0.3cqw` // gap between element tiles, default is 0.3% of container width
  export let inner_transition_metal_offset = 0.5
  const default_lanth_act_tiles = [
    {
      name: `Lanthanides`,
      symbol: `La-Lu`,
      number: `57-71`,
      category: `lanthanide` as const,
    },
    {
      name: `Actinides`,
      symbol: `Ac-Lr`,
      number: `89-103`,
      category: `actinide` as const,
    },
  ]
  // show lanthanides and actinides as tiles
  export let lanth_act_tiles: {
    name: string
    symbol: string
    number: string
    category: Category
  }[] = tile_props?.show_symbol == false ? [] : default_lanth_act_tiles
  export let lanth_act_style: string = ``
  export let color_scale_range: [number | null, number | null] = [null, null]
  export let color_overrides: Record<ElementSymbol, string> = {}
  export let labels: Record<ElementSymbol, string> = {}

  type $$Events = PeriodicTableEvents // for type-safe event listening on this component

  let heat_values: number[] = []

  $: if (Array.isArray(heatmap_values)) {
    if (heatmap_values.length > 118) {
      console.error(
        `heatmap_values is an array of numbers, length should be 118 or less, one for ` +
          `each element possibly omitting elements at the end, got ${heatmap_values.length}`
      )
    } else heat_values = heatmap_values
  } else if (typeof heatmap_values == `object`) {
    const bad_keys = Object.keys(heatmap_values).filter(
      (key) => !elem_symbols.includes(key)
    )
    if (bad_keys.length > 0) {
      console.error(
        `heatmap_values is an object, keys should be element symbols, got ${bad_keys}`
      )
    } else heat_values = elem_symbols.map((symbol) => heatmap_values[symbol])
  }

  $: set_active_element = (element: ChemicalElement | null) => () => {
    if (disabled) return
    active_element = element
  }

  let window_width: number
  function handle_key(event: KeyboardEvent) {
    if (disabled || !active_element) return
    if (event.key == `Enter`) return goto(active_element.name.toLowerCase())

    if (![`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`].includes(event.key)) return

    event.preventDefault() // prevent scrolling the page
    event.stopPropagation()

    // change the active element in the periodic table with arrow keys
    // TODO doesn't allow navigating to lanthanides and actinides yet
    const { column, row } = active_element
    active_element =
      element_data.find((elem) => {
        return {
          ArrowUp: elem.column == column && elem.row == row - 1,
          ArrowDown: elem.column == column && elem.row == row + 1,
          ArrowLeft: elem.column == column - 1 && elem.row == row,
          ArrowRight: elem.column == column + 1 && elem.row == row,
        }[event.key]
      }) ?? active_element
  }
  $: c_scale =
    typeof color_scale == `string` ? d3sc[`interpolate${color_scale}`] : color_scale

  $: cs_min = color_scale_range[0] ?? Math.min(...heat_values)
  $: cs_max = color_scale_range[1] ?? Math.max(...heat_values)

  $: bg_color = (value: number | false): string | null => {
    if (!heat_values?.length || !c_scale) return null
    if (!value || (log && value <= 0)) return `transparent`
    // map value to [0, 1] range
    if (log) value = Math.log(value - cs_min + 1) / Math.log(cs_max - cs_min + 1)
    else value = (value - cs_min) / (cs_max - cs_min)
    return c_scale(value)
  }
</script>

<svelte:window bind:innerWidth={window_width} on:keydown={handle_key} />

<div class="periodic-table-container" {style}>
  <div class="periodic-table" style:gap>
    <slot name="inset" {active_element} />
    {#each element_data as element, idx}
      {@const { column, row, category, name, symbol } = element}
      {@const value = heat_values[idx]}
      {@const active =
        active_category === category.replaceAll(` `, `-`) ||
        active_element?.name === name}
      <ElementTile
        {element}
        href={links
          ? typeof links == `string`
            ? `${element[links]}`.toLowerCase()
            : links[symbol]
          : null}
        style="grid-column: {column}; grid-row: {row};"
        {value}
        bg_color={color_overrides[symbol] ?? bg_color(value)}
        {active}
        label={labels[symbol]}
        {...tile_props}
        on:mouseenter={set_active_element(element)}
        on:mouseleave={set_active_element(null)}
        on:focus={set_active_element(element)}
        on:blur={set_active_element(null)}
        on:click
        on:mouseenter
        on:mouseleave
      />
    {/each}
    <!-- show tile for lanthanides and actinides with text La-Lu and Ac-Lr respectively -->
    {#each lanth_act_tiles || [] as element, idx}
      <ElementTile
        {element}
        style="opacity: 0.8; grid-column: 3; grid-row: {6 + idx}; {lanth_act_style};"
        on:mouseenter={() => (active_category = element.category)}
        on:mouseleave={() => (active_category = null)}
        symbol_style="font-size: 30cqw;"
      />
    {/each}
    {#if inner_transition_metal_offset}
      <!-- provide vertical offset for lanthanides + actinides -->
      <div class="spacer" style:aspect-ratio={1 / inner_transition_metal_offset} />
    {/if}

    <slot name="bottom-left-inset" {active_element}>
      {#if show_photo}
        <ElementPhoto element={active_element} style="grid-area: 9/1/span 2/span 2;" />
      {/if}
    </slot>
    <slot />
  </div>
</div>

<style>
  .periodic-table-container {
    /* needed for gap: 0.3cqw; to work */
    container-type: inline-size;
  }
  div.periodic-table {
    display: grid;
    grid-template-columns: repeat(18, 1fr);
    position: relative;
    container-type: inline-size;
  }
  div.spacer {
    grid-row: 8;
  }
</style>
