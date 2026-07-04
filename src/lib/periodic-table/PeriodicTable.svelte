<script lang="ts">
  import { get_d3_interpolator, is_color } from '$lib/colors'
  import type { ChemicalElement, ElementCategory, ElementSymbol } from '$lib/element'
  import { element_data, ElementPhoto, ElementTile } from '$lib/element'
  import { ELEM_SYMBOLS } from '$lib/labels'
  import type { Point2D, Vec2 } from '$lib/math'
  import { ColorBar } from '$lib/plot'
  import { colors } from '$lib/state.svelte'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { D3InterpolateName } from '$lib/colors'
  import type { MissingCellStyle } from '$lib/heatmap-matrix'
  import type { ScaleContext } from './index'
  import { TableInset } from './index'

  // a tile's heat value: scalar or 1-4-segment array of numbers/colors
  type HeatValue = number | number[] | string | string[]

  const default_f_block_inset_tiles = [
    { name: `Lanthanides`, symbol: `La-Lu`, number: `57-71`, category: `lanthanide` },
    { name: `Actinides`, symbol: `Ac-Lr`, number: `89-103`, category: `actinide` },
  ] as const
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
    active_elements = $bindable([]),
    gap = `0.3cqw`,
    inner_transition_metal_offset = 0.5,
    lanth_act_tiles = tile_props?.show_symbol === false
      ? []
      : [...default_f_block_inset_tiles],
    lanth_act_style = ``,
    color_scale_range = [null, null],
    color_overrides = {},
    labels = {},
    missing = {},
    split_layout = undefined,
    show_color_bar = true,
    color_bar_props = {},
    inset,
    bottom_left_inset,
    tooltip = false,
    onenter,
    children,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    tile_props?: Partial<ComponentProps<typeof ElementTile>>
    show_photo?: boolean
    disabled?: boolean // disable hover and click events from updating active_element
    // array (positional by atomic number, can be partial) or object keyed by element symbol.
    // each value is a single number/color or an array of 1-4 numbers/colors for multi-segment
    // tiles. null/omitted -> missing (uses the `missing` fallback); 0 is a real value
    heatmap_values?: Partial<Record<ElementSymbol, HeatValue | null>> | (HeatValue | null)[]
    // links is either string with element property (name, symbol, number, ...) to use as link,
    // or object with mapping element symbols to link
    links?: keyof ChemicalElement | Record<ElementSymbol, string> | null
    log?: boolean
    color_scale?: D3InterpolateName | ((num: number) => string)
    active_element?: ChemicalElement | null
    active_category?: ElementCategory | null
    // array of element symbols or ChemicalElement objects to highlight
    active_elements?: (ElementSymbol | ChemicalElement)[]
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
    missing?: MissingCellStyle // styling for tiles with no heatmap value
    // control the layout of multi-value splits for all tiles
    split_layout?: `diagonal` | `horizontal` | `vertical` | `triangular` | `quadrant`
    // automatically show a color bar when heatmap_values is provided (default: true)
    show_color_bar?: boolean
    // props to pass to the ColorBar component (e.g. { title: 'Bar Title', tick_labels: 5 })
    color_bar_props?: Partial<ComponentProps<typeof ColorBar>>
    inset?: Snippet<[{ active_element: ChemicalElement | null }]>
    bottom_left_inset?: Snippet<[{ active_element: ChemicalElement | null }]>
    tooltip?:
      | Snippet<
          [
            {
              element: ChemicalElement
              value: HeatValue | null
              active: boolean
              bg_color: string | null
              scale_context: ScaleContext
            },
          ]
        >
      | boolean
    children?: Snippet
    onenter?: (element: ChemicalElement) => void
  } = $props()

  let heat_values = $derived.by(() => {
    if (Array.isArray(heatmap_values)) {
      if (heatmap_values.length > 118) {
        console.error(
          `heatmap_values is an array of numbers/arrays, length should be 118 or less, one for ` +
            `each element possibly omitting elements at the end, got ${heatmap_values.length}`,
        )
        return []
      }
      return heatmap_values
    } else if (typeof heatmap_values === `object`) {
      const bad_keys = Object.keys(heatmap_values).filter(
        (key) => !ELEM_SYMBOLS.includes(key as ElementSymbol),
      )
      if (bad_keys.length > 0) {
        console.error(
          `heatmap_values is an object, keys should be element symbols, got ${bad_keys}`,
        )
        return []
      }
      // keep absent elements as null (distinct from a real 0 value) so they map to the
      // missing fallback while explicit 0 maps through the color scale
      return ELEM_SYMBOLS.map((symbol) => heatmap_values[symbol] ?? null)
    }
    return []
  })

  let set_active_element = $derived((element: ChemicalElement | null) => () => {
    if (disabled) return
    active_element = element
  })

  let window_width: number = $state(0)
  let tooltip_element: ChemicalElement | null = $state(null)
  let tooltip_pos: Point2D = $state({ x: 0, y: 0 })
  let tooltip_visible: boolean = $state(false)

  function handle_key(event: KeyboardEvent) {
    if (disabled || !active_element) return
    if (event.key === `Enter`) onenter?.(active_element)

    const arrow_keys = [`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`]
    if (!arrow_keys.includes(event.key)) return

    event.preventDefault() // prevent scrolling the page
    event.stopPropagation()

    // Arrow key navigation including lanthanides (row 9) and actinides (row 10)
    const { column: col, row } = active_element
    const in_f_block = col >= 3 && col <= 17
    const row_map: Record<string, number> = {
      ArrowUp: row === 9 ? 6 : row === 10 ? 7 : row - 1,
      ArrowDown: row === 6 && in_f_block ? 9 : row === 7 && in_f_block ? 10 : row + 1,
    }
    const target_row = row_map[event.key] ?? row
    const target_col =
      event.key === `ArrowLeft` ? col - 1 : event.key === `ArrowRight` ? col + 1 : col
    active_element =
      element_data.find((el) => el.column === target_col && el.row === target_row) ??
      active_element
  }

  function handle_tooltip_enter(element: ChemicalElement, event: MouseEvent) {
    if (tooltip === false || disabled) return
    tooltip_element = element
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    const rect = target.getBoundingClientRect()
    const container_rect = target.closest(`.ptable-grid`)?.getBoundingClientRect()
    if (container_rect) {
      tooltip_pos = {
        x: rect.left - container_rect.left + rect.width / 2,
        y: rect.bottom - container_rect.top + 8,
      }
    }
    tooltip_visible = true
  }

  let color_scale_fn = $derived(
    typeof color_scale === `string` ? get_d3_interpolator(color_scale) : color_scale,
  )

  // finite numeric heat value (numeric strings coerced; colors, null/false and non-finite
  // excluded so they can't poison the color-scale domain). null => not a mappable number
  const to_heat_num = (value: number | string | false | null | undefined): number | null => {
    if (value == null || value === false || is_color(value)) return null
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  }

  let heat_nums = $derived(
    heat_values
      .flat()
      .map(to_heat_num)
      .filter((num): num is number => num !== null),
  )
  // values usable by the active scale (log excludes non-positive)
  let usable_heat_nums = $derived(log ? heat_nums.filter((num) => num > 0) : heat_nums)

  let cs_min = $derived(
    color_scale_range[0] ?? (heat_nums.length > 0 ? Math.min(...heat_nums) : 0),
  )
  let cs_max = $derived(
    color_scale_range[1] ?? (heat_nums.length > 0 ? Math.max(...heat_nums) : 1),
  )

  // smallest positive bound for log color mapping (matches the auto ColorBar's log scale)
  let cs_min_pos = $derived.by(() => {
    if (cs_min > 0) return cs_min
    const pos = heat_nums.filter((num) => num > 0)
    return pos.length > 0 ? Math.min(...pos) : cs_max
  })

  // whether a value maps to a heatmap color (false => use the missing fallback). 0 is a
  // real value; only absent/null/non-finite (and <=0 in log mode) count as missing. a
  // multi-value tile is missing only when every segment is missing
  const value_is_missing = (value: HeatValue | false | null): boolean => {
    if (Array.isArray(value)) return value.every(value_is_missing) // [] -> true (missing)
    if (is_color(value)) return false // explicit colors are real values, not missing
    const num = to_heat_num(value)
    return num === null || (log && num <= 0)
  }

  const bg_color = (
    value: HeatValue | false | null,
    element?: ChemicalElement,
  ): string | null => {
    if (Array.isArray(value)) return bg_color(value[0], element) // arrays: use first value
    if (is_color(value)) return value // already a color string

    if (!heat_values.length || !color_scale_fn || value_is_missing(value)) {
      const category_color = (element && colors.category[element.category]) || `#cccccc`
      if (missing.color === `element-category`) return category_color
      // default: category colors for a plain table, gray for missing heatmap data
      return missing.color || (heat_values.length ? `#666` : category_color)
    }

    // map value to [0, 1] range
    const num = Number(value)
    const span = cs_max - cs_min
    if (span === 0) return color_scale_fn(0.5) // midpoint when all values equal
    if (log) {
      const log_span = Math.log(cs_max) - Math.log(cs_min_pos)
      if (log_span === 0) return color_scale_fn(0.5)
      return color_scale_fn((Math.log(num) - Math.log(cs_min_pos)) / log_span)
    }
    return color_scale_fn((num - cs_min) / span)
  }

  // per-segment colors for multi-value tiles (bg_color already handles color strings)
  const bg_colors = (value: HeatValue | false, element?: ChemicalElement) =>
    Array.isArray(value) ? value.map((val) => bg_color(val, element)) : []

  // Determine whether to automatically show the color bar
  let should_show_color_bar = $derived(show_color_bar && !inset && usable_heat_nums.length > 0)

  // Calculate heat range for color bar
  let heat_range = $derived.by((): Vec2 => {
    if (!should_show_color_bar) return [0, 1]
    const min = color_scale_range[0] ?? Math.min(...usable_heat_nums)
    const max = color_scale_range[1] ?? Math.max(...usable_heat_nums)
    return [min, max]
  })
</script>

<svelte:window bind:innerWidth={window_width} onkeydown={handle_key} />

<div {...rest} class={[`periodic-table`, rest.class]}>
  <div class="ptable-grid" style:gap>
    {#if should_show_color_bar}
      <TableInset class="auto-colorbar-inset">
        <ColorBar
          {color_scale}
          range={heat_range}
          tick_labels={color_bar_props.tick_labels ?? 3}
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
      {@const override = color_overrides[symbol]}
      {@const tile_missing = heat_values.length > 0 && !override && value_is_missing(value)}
      {@const is_active_elem = active_elements?.some((active_elem) =>
        typeof active_elem === `string`
          ? active_elem === symbol
          : active_elem?.symbol === symbol,
      )}
      {@const active =
        active_category === category || active_element?.name === name || is_active_elem}
      {@const style = `grid-column: ${column}; grid-row: ${row};${
        tile_props?.style ? ` ${tile_props.style}` : ``
      }${tile_missing && missing.style ? ` ${missing.style}` : ``}`}
      <ElementTile
        {element}
        href={links
          ? typeof links == `string`
            ? `/${element[links]}`.toLowerCase()
            : links[symbol]
          : undefined}
        value={tile_missing ? undefined : (value ?? undefined)}
        bg_color={override ?? bg_color(value, element) ?? undefined}
        bg_colors={!override && Array.isArray(value) ? bg_colors(value, element) : []}
        {active}
        label={labels[symbol] ?? (tile_missing ? missing.label : undefined)}
        {...tile_props}
        {style}
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
    {#if tooltip_visible && tooltip_element}
      {@const el = tooltip_element as ChemicalElement}
      {@const style = `left: ${tooltip_pos.x}px; top: ${tooltip_pos.y}px;`}
      {@const tooltip_value = heat_values[el.number - 1]}
      {#if typeof tooltip == `function`}
        <div class="tooltip" {style}>
          {@render tooltip({
            element: el,
            value: tooltip_value ?? null,
            active: active_category === el.category || active_element?.name === el.name,
            bg_color: color_overrides[el.symbol] ?? bg_color(tooltip_value, el),
            scale_context: { min: log ? cs_min_pos : cs_min, max: cs_max, color_scale },
          })}
        </div>
      {:else if tooltip !== false}
        <div class="tooltip" {style}>
          {el.name}<br />
          <small>{el.symbol} • {el.number}</small>
          {#if Array.isArray(tooltip_value)}
            <br />
            <small>Values: {(tooltip_value as number[]).join(`, `)}</small>
          {/if}
        </div>
      {/if}
    {/if}

    {@render children?.()}
  </div>
</div>

<style>
  .periodic-table {
    /* needed for gap: 0.3cqw; to work */
    container-type: inline-size;
    width: 100%; /* prevent collapse in shrink-to-fit contexts (inline-size containment) */
  }
  .ptable-grid {
    display: grid;
    grid-template-columns: repeat(18, 1fr);
    position: relative;
    container-type: inline-size;
    gap: var(--ptable-gap, 0.3cqw);
  }
  /* Auto-generated color bar inset with fluid responsive sizing using container query units */
  .ptable-grid :global(.auto-colorbar-inset) {
    place-items: center;
    padding: clamp(0.3em, 1.5cqw, 1em) clamp(0.4em, 3cqw, 2em);
    --cbar-font-size: clamp(7pt, 1.8cqw, 9pt);
    --cbar-thickness: clamp(8px, 2.5cqw, 14px);
  }
  .ptable-grid :global(.auto-colorbar-inset .colorbar) {
    width: 90%;
  }
  div.spacer {
    grid-row: 8;
    aspect-ratio: var(--ptable-spacer-ratio, 2);
  }
  .tooltip {
    position: absolute;
    transform: translate(-50%, -10%);
    background: var(--tooltip-bg, light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.85)));
    color: var(--tooltip-color, light-dark(#222, #eee));
    padding: var(--tooltip-padding, 4px 6px);
    border-radius: var(--tooltip-border-radius, var(--border-radius, 3pt));
    font-size: var(--tooltip-font-size, 14px);
    text-align: var(--tooltip-text-align, center);
    line-height: var(--tooltip-line-height, 1.2);
    z-index: var(--tooltip-z-index, 2);
    pointer-events: none;
    box-shadow: var(
      --tooltip-shadow,
      light-dark(0 2px 8px rgba(0, 0, 0, 0.15), 0 2px 8px rgba(0, 0, 0, 0.4))
    );
  }
  .tooltip::before {
    content: '';
    position: absolute;
    top: -15%;
    left: 50%;
    transform: translateX(-50%);
    border-left: 8px solid transparent;
    border-right: 8px solid transparent;
    border-bottom: 8px solid
      var(--tooltip-bg, light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.85)));
    box-sizing: border-box;
    margin: 0 auto;
  }
</style>
