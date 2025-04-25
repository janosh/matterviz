<script lang="ts">
  import { goto } from '$app/navigation'
  import type { Category, ChemicalElement, PeriodicTableEvents } from '$lib'
  import { ElementPhoto, ElementTile, elem_symbols, type ElementSymbol } from '$lib'
  import element_data from '$lib/element/data'
  import * as d3_sc from 'd3-scale-chromatic'
  import type { ComponentProps, Snippet } from 'svelte'

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
  interface Props {
    tile_props?: Partial<ComponentProps<typeof ElementTile>>
    show_photo?: boolean
    style?: string
    disabled?: boolean // disable hover and click events from updating active_element
    // either array of length 118 (one heat value for each element) or object with
    // element symbol as key and heat value as value
    heatmap_values?: Record<ElementSymbol, number> | number[]
    // links is either string with element property (name, symbol, number, ...) to use as link,
    // or object with mapping element symbols to link
    links?: keyof ChemicalElement | Record<ElementSymbol, string> | null
    log?: boolean
    color_scale?: string | ((num: number) => string)
    active_element?: ChemicalElement | null
    active_category?: Category | null
    gap?: string // gap between element tiles, default is 0.3% of container width
    inner_transition_metal_offset?: number
    // show lanthanides and actinides as tiles
    lanth_act_tiles?: {
      name: string
      symbol: string
      number: string
      category: Category
    }[]
    lanth_act_style?: string
    color_scale_range?: [number | null, number | null]
    color_overrides?: Partial<Record<ElementSymbol, string>>
    labels?: Partial<Record<ElementSymbol, string>>
    inset?: Snippet<[{ active_element: ChemicalElement | null }]>
    bottom_left_inset?: Snippet<[{ active_element: ChemicalElement | null }]>
    children?: Snippet
  }

  let {
    tile_props,
    show_photo = true,
    style = ``,
    disabled = false,
    heatmap_values = [],
    links = null,
    log = false,
    color_scale = $bindable(`Viridis`),
    active_element = $bindable(null),
    active_category = $bindable(null),
    gap = `0.3cqw`,
    inner_transition_metal_offset = 0.5,
    lanth_act_tiles = tile_props?.show_symbol == false ? [] : default_lanth_act_tiles,
    lanth_act_style = ``,
    color_scale_range = [null, null],
    color_overrides = {},
    labels = {},
    inset,
    bottom_left_inset,
    children,
  }: Props = $props()

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  type $$Events = PeriodicTableEvents // for type-safe event listening on this component

  let heat_values = $derived.by(() => {
    if (Array.isArray(heatmap_values)) {
      if (heatmap_values.length > 118) {
        console.error(
          `heatmap_values is an array of numbers, length should be 118 or less, one for ` +
            `each element possibly omitting elements at the end, got ${heatmap_values.length}`,
        )
      } else return heatmap_values
    } else if (typeof heatmap_values == `object`) {
      const bad_keys = Object.keys(heatmap_values).filter(
        (key) => !elem_symbols.includes(key as ElementSymbol),
      )
      if (bad_keys.length > 0) {
        console.error(
          `heatmap_values is an object, keys should be element symbols, got ${bad_keys}`,
        )
      } else return elem_symbols.map((symbol) => heatmap_values[symbol])
    }
  })

  let set_active_element = $derived((element: ChemicalElement | null) => () => {
    if (disabled) return
    active_element = element
  })

  let window_width: number = $state(0)
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
  let color_scale_fn = $derived(
    typeof color_scale == `string`
      ? d3_sc[`interpolate${color_scale}` as keyof typeof d3_sc]
      : color_scale,
  )

  let cs_min = $derived(color_scale_range[0] ?? Math.min(...heat_values))
  let cs_max = $derived(color_scale_range[1] ?? Math.max(...heat_values))

  let bg_color = $derived((value: number | false): string | null => {
    if (!heat_values?.length || !color_scale_fn) return null
    if (!value || (log && value <= 0)) return `transparent`
    // map value to [0, 1] range
    if (log) value = Math.log(value - cs_min + 1) / Math.log(cs_max - cs_min + 1)
    else value = (value - cs_min) / (cs_max - cs_min)
    return color_scale_fn?.(value)
  })
</script>

<svelte:window bind:innerWidth={window_width} onkeydown={handle_key} />

<div class="periodic-table-container" {style}>
  <div class="periodic-table" style:gap>
    {@render inset?.({ active_element })}
    {#each element_data as element (element.number)}
      {@const { column, row, category, name, symbol } = element}
      {@const value = heat_values[element.number - 1]}
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
        onmouseenter={set_active_element(element)}
        onmouseleave={set_active_element(null)}
        onfocus={set_active_element(element)}
        onblur={set_active_element(null)}
      />
    {/each}
    <!-- show tile for lanthanides and actinides with text La-Lu and Ac-Lr respectively -->
    {#each lanth_act_tiles || [] as element, idx (element.symbol)}
      <ElementTile
        {element}
        style="opacity: 0.8; grid-column: 3; grid-row: {6 + idx}; {lanth_act_style};"
        onmouseenter={() => (active_category = element.category)}
        onmouseleave={() => (active_category = null)}
        symbol_style="font-size: 30cqw;"
      />
    {/each}
    {#if inner_transition_metal_offset}
      <!-- provide vertical offset for lanthanides + actinides -->
      <div class="spacer" style:aspect-ratio={1 / inner_transition_metal_offset}></div>
    {/if}

    {#if bottom_left_inset}
      {@render bottom_left_inset({ active_element })}
    {:else if show_photo}
      <ElementPhoto element={active_element} style="grid-area: 9/1/span 2/span 2;" />
    {/if}
    {@render children?.()}
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
    gap: var(--ptable-gap, 0.3cqw);
  }
  div.spacer {
    grid-row: 8;
    aspect-ratio: var(--ptable-spacer-ratio, 2);
  }
</style>
