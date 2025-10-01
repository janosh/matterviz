<script lang="ts">
  import type { ChemicalElement, ElementCategory, XyObj } from '$lib'
  import { elem_symbols, ElementPhoto, type ElementSymbol, ElementTile } from '$lib'
  import { default_category_colors, is_color } from '$lib/colors'
  import element_data from '$lib/element/data'
  import { ColorBar } from '$lib/plot'
  import * as d3_sc from 'd3-scale-chromatic'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { D3InterpolateName } from '../colors'
  import type { ScaleContext } from './index'
  import { TableInset } from './index'

  const default_f_block_inset_tiles = [
    { name: `Lanthanides`, symbol: `La-Lu`, number: `57-71`, category: `lanthanide` },
    { name: `Actinides`, symbol: `Ac-Lr`, number: `89-103`, category: `actinide` },
  ] as const
  interface Props extends HTMLAttributes<HTMLDivElement> {
    tile_props?: Partial<ComponentProps<typeof ElementTile>>
    show_photo?: boolean
    disabled?: boolean // disable hover and click events from updating active_element
    // either array of numbers/colors (can be partial, missing elements default to 0) or object with
    // element symbol as key and heat value as value
    // NEW: each value can now be a single number/color or array of 1-4 numbers/colors for multi-segment display
    heatmap_values?:
      | Partial<Record<ElementSymbol, number | number[] | string | string[]>>
      | (number | number[] | string | string[])[]
    // links is either string with element property (name, symbol, number, ...) to use as link,
    // or object with mapping element symbols to link
    links?: keyof ChemicalElement | Record<ElementSymbol, string> | null
    log?: boolean
    color_scale?: D3InterpolateName | ((num: number) => string)
    active_element?: ChemicalElement | null
    active_category?: ElementCategory | null
    gap?: string // gap between element tiles, default is 0.3% of container width
    inner_transition_metal_offset?: number
    // show lanthanides and actinides as tiles
    lanth_act_tiles?: {
      name: string
      symbol: string
      number: string
      category: ElementCategory
    }[]
    lanth_act_style?: string
    color_scale_range?: [number | null, number | null]
    color_overrides?: Partial<Record<ElementSymbol, string>>
    labels?: Partial<Record<ElementSymbol, string>>
    // background color for elements missing from heatmap_values
    // "element-category" falls back to element category default color
    missing_color?: string
    // control the layout of multi-value splits for all tiles
    split_layout?: `diagonal` | `horizontal` | `vertical` | `triangular` | `quadrant`
    // automatically show a color bar when heatmap_values is provided (default: true)
    show_color_bar?: boolean
    // title for the color bar (optional)
    color_bar_title?: string
    // additional props to pass to the ColorBar component
    color_bar_props?: Partial<ComponentProps<typeof ColorBar>>
    inset?: Snippet<[{ active_element: ChemicalElement | null }]>
    bottom_left_inset?: Snippet<[{ active_element: ChemicalElement | null }]>
    tooltip?:
      | Snippet<
        [
          {
            element: ChemicalElement
            value: number | number[] | string | string[]
            active: boolean
            bg_color: string | null
            scale_context: ScaleContext
          },
        ]
      >
      | boolean
    children?: Snippet
    onenter?: (element: ChemicalElement) => void
  }
  let {
    tile_props,
    show_photo = false,
    disabled = false,
    heatmap_values = [],
    links = null,
    log = false,
    color_scale = $bindable(`interpolateViridis`),
    active_element = $bindable(null),
    active_category = $bindable(null),
    gap = `0.3cqw`,
    inner_transition_metal_offset = 0.5,
    lanth_act_tiles = tile_props?.show_symbol == false
      ? []
      : [...default_f_block_inset_tiles],
    lanth_act_style = ``,
    color_scale_range = [null, null],
    color_overrides = {},
    labels = {},
    missing_color = `element-category`,
    split_layout = undefined,
    show_color_bar = true,
    color_bar_title = undefined,
    color_bar_props = {},
    inset,
    bottom_left_inset,
    tooltip = false,
    onenter,
    children,
    ...rest
  }: Props = $props()

  let heat_values = $derived.by(() => {
    if (Array.isArray(heatmap_values)) {
      if (heatmap_values.length > 118) {
        console.error(
          `heatmap_values is an array of numbers/arrays, length should be 118 or less, one for ` +
            `each element possibly omitting elements at the end, got ${heatmap_values.length}`,
        )
        return []
      } else return heatmap_values
    } else if (typeof heatmap_values == `object`) {
      const bad_keys = Object.keys(heatmap_values).filter(
        (key) => !elem_symbols.includes(key as ElementSymbol),
      )
      if (bad_keys.length > 0) {
        console.error(
          `heatmap_values is an object, keys should be element symbols, got ${bad_keys}`,
        )
        return []
      }
      return elem_symbols.map((symbol) => heatmap_values[symbol] ?? 0)
    }
    return []
  })

  let set_active_element = $derived((element: ChemicalElement | null) => () => {
    if (disabled) return
    active_element = element
  })

  let window_width: number = $state(0)
  let tooltip_element: ChemicalElement | null = $state(null)
  let tooltip_pos: XyObj = $state({ x: 0, y: 0 })
  let tooltip_visible: boolean = $state(false)

  function handle_key(event: KeyboardEvent) {
    if (disabled || !active_element) return
    if (event.key == `Enter`) onenter?.(active_element)

    const arrow_keys = [`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`]
    if (!arrow_keys.includes(event.key)) return

    event.preventDefault() // prevent scrolling the page
    event.stopPropagation()

    // change the active element in the periodic table with arrow keys
    // TODO doesn't allow navigating to lanthanides and actinides yet
    const { column, row } = active_element
    active_element = element_data.find((elem) => {
      return {
        ArrowUp: elem.column == column && elem.row == row - 1,
        ArrowDown: elem.column == column && elem.row == row + 1,
        ArrowLeft: elem.column == column - 1 && elem.row == row,
        ArrowRight: elem.column == column + 1 && elem.row == row,
      }[event.key]
    }) ?? active_element
  }

  function handle_tooltip_enter(element: ChemicalElement, event: MouseEvent) {
    if (tooltip === false || disabled) return
    tooltip_element = element
    const target = event.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    const container_rect = target.closest(`.periodic-table`)?.getBoundingClientRect()
    if (container_rect) {
      tooltip_pos = {
        x: rect.left - container_rect.left + rect.width / 2,
        y: rect.bottom - container_rect.top + 8,
      }
    }
    tooltip_visible = true
  }

  let color_scale_fn = $derived(
    typeof color_scale == `string` ? d3_sc[color_scale] : color_scale,
  )

  let cs_min = $derived(
    color_scale_range[0] ??
      (heat_values.length
        ? Math.min(
          ...heat_values.flat().filter((v): v is number => typeof v === `number`),
        )
        : 0),
  )
  let cs_max = $derived(
    color_scale_range[1] ??
      (heat_values.length
        ? Math.max(
          ...heat_values.flat().filter((v): v is number => typeof v === `number`),
        )
        : 1),
  )

  let bg_color = $derived(
    (
      value: number | number[] | string | string[] | false,
      element?: ChemicalElement,
    ): string | null => {
      if (Array.isArray(value)) {
        // For arrays, return the color of the first value (used as fallback)
        return bg_color(value[0], element)
      }

      // If it's already a color string, return it directly
      if (is_color(value)) return value as string

      // Return missing color for zero/invalid values or when no heatmap data
      if (
        !value ||
        value === 0 ||
        (log && value <= 0) ||
        !heat_values?.length ||
        !color_scale_fn
      ) {
        // Use missing color for zero/missing values or when no heatmap data
        if (missing_color === `element-category` && element) {
          const category_key = element.category.replaceAll(` `, `-`)
          return `var(--${category_key}-bg-color, ${
            default_category_colors[category_key] || `#cccccc`
          })`
        }
        return missing_color
      }

      // map value to [0, 1] range
      const span = cs_max - cs_min
      if (span === 0) return color_scale_fn?.(0.5) // midpoint when all values equal

      if (log) value = Math.log((value as number) - cs_min + 1) / Math.log(span + 1)
      else value = ((value as number) - cs_min) / span
      return color_scale_fn?.(value as number)
    },
  )

  let bg_colors = $derived(
    (
      value: number | number[] | string | string[] | false,
      element?: ChemicalElement,
    ): (string | null)[] => {
      if (!Array.isArray(value)) return []

      return value.map((v) => {
        // If it's already a color string, return it directly
        if (is_color(v)) return v as string
        // Otherwise, map it through the color scale
        return bg_color(v as number, element)
      })
    },
  )

  // Determine whether to automatically show the color bar
  let should_show_color_bar = $derived.by(() => {
    if (!show_color_bar || inset || heat_values.length === 0) return false

    const num_vals = heat_values
      .flat()
      .filter((v): v is number => typeof v === `number`)

    const usable_values = log ? num_vals.filter((v) => v > 0) : num_vals

    return usable_values.length > 0
  })

  // Calculate heat range for color bar
  let heat_range = $derived.by(() => {
    if (!should_show_color_bar) return [0, 1] as [number, number]

    const numeric_values = heat_values
      .flat()
      .filter((v): v is number => typeof v === `number`)
    const usable_values = log ? numeric_values.filter((v) => v > 0) : numeric_values

    if (usable_values.length === 0) return [0, 1] as [number, number]

    const min = color_scale_range[0] ?? Math.min(...usable_values)
    const max = color_scale_range[1] ?? Math.max(...usable_values)

    return [min, max] as [number, number]
  })
</script>

<svelte:window bind:innerWidth={window_width} onkeydown={handle_key} />

<div {...rest} class="periodic-table-container {rest.class ?? ``}">
  <div class="periodic-table" style:gap>
    {#if should_show_color_bar}
      <TableInset style="place-items: center; padding: 1em 2em">
        <ColorBar
          {color_scale}
          title={color_bar_title}
          range={heat_range}
          tick_labels={5}
          tick_side="primary"
          scale_type={log ? `log` : `linear`}
          wrapper_style="width: 100%;"
          bar_style="width: 100%;"
          {...color_bar_props}
        />
      </TableInset>
    {:else}
      {@render inset?.({ active_element })}
    {/if}
    {#each element_data as element (element.number)}
      {@const { column, row, category, name, symbol } = element}
      {@const value = heat_values[element.number - 1]}
      {@const active = active_category === category.replaceAll(` `, `-`) ||
        active_element?.name === name}
      {@const style = `grid-column: ${column}; grid-row: ${row};`}
      <ElementTile
        {element}
        href={links
        ? typeof links == `string`
          ? `${element[links]}`.toLowerCase()
          : links[symbol]
        : undefined}
        {style}
        {value}
        bg_color={color_overrides[symbol] ?? bg_color(value, element) ?? undefined}
        bg_colors={Array.isArray(value) ? bg_colors(value, element) : []}
        {active}
        label={labels[symbol]}
        {...tile_props}
        onmouseenter={(event: MouseEvent) => {
          set_active_element(element)()
          handle_tooltip_enter(element, event)
        }}
        onmouseleave={() => {
          set_active_element(null)()
          tooltip_visible = false
          tooltip_element = null
        }}
        onfocus={set_active_element(element)}
        onblur={set_active_element(null)}
        {split_layout}
      />
    {/each}
    <!-- show tile for lanthanides and actinides with text La-Lu and Ac-Lr respectively -->
    {#each lanth_act_tiles || [] as lanth_act_element, idx (lanth_act_element.symbol)}
      {@const style = `opacity: 0.8; grid-column: 3; grid-row: ${
        6 + idx
      }; ${lanth_act_style};`}
      <ElementTile
        element={lanth_act_element as unknown as ChemicalElement}
        {style}
        onmouseenter={() => (active_category = lanth_act_element.category)}
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
    {:else if show_photo && active_element}
      <ElementPhoto element={active_element} style="grid-area: 9/1/span 2/span 2" />
    {/if}

    <!-- Tooltip -->
    {#if tooltip_visible && tooltip_element && tooltip !== false}
      {@const style = `left: ${tooltip_pos.x}px; top: ${tooltip_pos.y}px;`}
      <div class="tooltip" {style}>
        {#if typeof tooltip == `function`}
          {@const tooltip_value = heat_values[tooltip_element.number - 1]}
          {@render tooltip({
          element: tooltip_element,
          value: tooltip_value,
          active:
            active_category === tooltip_element.category.replaceAll(` `, `-`) ||
            active_element?.name === tooltip_element.name,
          bg_color: color_overrides[tooltip_element.symbol] ??
            bg_color(tooltip_value, tooltip_element),
          scale_context: { min: cs_min, max: cs_max, color_scale },
        })}
        {:else}
          {tooltip_element.name}<br />
          <small>{tooltip_element.symbol} • {tooltip_element.number}</small>
          {#if Array.isArray(heat_values[tooltip_element.number - 1])}
            <br />
            <small>Values: {
                (heat_values[tooltip_element.number - 1] as number[]).join(
                  `, `,
                )
              }</small>
          {/if}
        {/if}
      </div>
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
  .tooltip {
    position: absolute;
    transform: translate(-50%, -10%);
    background: var(--tooltip-bg, rgba(0, 0, 0, 0.8));
    color: var(--tooltip-color, light-dark(black, white));
    padding: var(--tooltip-padding, 4px 6px);
    border-radius: var(--tooltip-border-radius, 6px);
    font-size: var(--tooltip-font-size, 14px);
    text-align: var(--tooltip-text-align, center);
    line-height: var(--tooltip-line-height, 1.2);
    z-index: var(--tooltip-z-index, 2);
  }
  .tooltip::before {
    content: '';
    position: absolute;
    top: -15%;
    left: 50%;
    transform: translateX(-50%);
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-bottom: 8px solid var(--tooltip-bg, rgba(0, 0, 0, 0.8));
    box-sizing: border-box;
    margin: 0 auto;
  }
</style>
