<script lang="ts">
  import type { D3InterpolateName } from '$lib/colors'
  import { is_modifier_chord } from 'svelte-widgets/utils'
  import {
    is_color,
    is_dark_mode,
    pick_contrast_color,
    resolve_backdrop,
    resolve_css_color,
  } from '$lib/colors'
  import type {
    ChemicalElement,
    ElementCategory,
    ElementSymbol,
    SplitLayout,
    TileSegment,
  } from '$lib/element'
  import { element_data, ElementPhoto, ElementTile, is_elem_symbol } from '$lib/element'
  import { ELEM_SYMBOLS } from '$lib/labels'
  import { array_extent, type Point2D, type Vec2 } from '$lib/math'
  import { ColorBar } from '$lib/plot'
  import { resolve_color_ramp, to_color_bar_scale } from '$lib/plot/core/color-ramp'
  import { colors } from '$lib/state.svelte'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { MissingCellStyle } from '$lib/heatmap-matrix'
  import type { ScaleContext } from './index'
  import { TableInset } from './index'

  // a tile's heat value: scalar or 1-4-segment array of numbers/colors
  type HeatValue = number | string | (number | string)[]

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
    gap,
    lanth_act_tiles = tile_props?.show_symbol === false
      ? []
      : [...default_f_block_inset_tiles],
    color_scale_range = [null, null],
    color_overrides = {},
    labels = {},
    missing = {},
    split_layout = undefined,
    show_color_bar = true,
    color_bar_props = {},
    inset,
    tooltip = false,
    on_activate,
    onkeydown: on_table_keydown,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    tile_props?: Omit<
      Partial<ComponentProps<typeof ElementTile>>,
      `active` | `backdrop` | `element` | `href` | `label` | `segments` | `split_layout`
    >
    show_photo?: boolean
    disabled?: boolean // disable hover and click events from updating active_element
    // array (positional by atomic number, can be partial) or object keyed by element symbol.
    // each value is a single number/color or an array of 1-4 numbers/colors for multi-segment
    // tiles. null/omitted -> missing (uses the `missing` fallback); 0 is a real value
    heatmap_values?: Partial<Record<ElementSymbol, HeatValue | null>> | (HeatValue | null)[]
    // links is either string with element property (name, symbol, number, ...) to use as link,
    // or object with mapping element symbols to link
    links?: keyof ChemicalElement | Partial<Record<ElementSymbol, string>> | null
    log?: boolean
    color_scale?: D3InterpolateName | ((num: number) => string)
    active_element?: ChemicalElement | null
    active_category?: ElementCategory | null
    // array of element symbols or ChemicalElement objects to highlight
    active_elements?: (ElementSymbol | ChemicalElement)[]
    // gap between element tiles; overrides the --ptable-gap CSS variable (default 0.3cqw, i.e.
    // 0.3% of the container width)
    gap?: string
    // show lanthanides and actinides as tiles
    lanth_act_tiles?: {
      name: string
      symbol: string
      number: string
      category: ElementCategory
    }[]
    color_scale_range?: [number | null, number | null]
    color_overrides?: Partial<Record<ElementSymbol, string>>
    labels?: Partial<Record<ElementSymbol, string>>
    missing?: MissingCellStyle // styling for tiles with no heatmap value
    // control the layout of multi-value splits for all tiles
    split_layout?: SplitLayout
    // automatically show a color bar when heatmap_values is provided (default: true)
    show_color_bar?: boolean
    // props to pass to the ColorBar component (e.g. { title: 'Bar Title', tick_labels: 5 })
    color_bar_props?: Partial<ComponentProps<typeof ColorBar>>
    inset?: Snippet<[{ active_element: ChemicalElement | null }]>
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
    on_activate?: (element: ChemicalElement) => void
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
    }
    if (typeof heatmap_values === `object`) {
      const bad_keys = Object.keys(heatmap_values).filter((key) => !is_elem_symbol(key))
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

  const set_active_element = (element: ChemicalElement | null): void => {
    if (disabled) return
    active_element = element
  }
  const element_href = (element: ChemicalElement): string | undefined =>
    !links
      ? undefined
      : typeof links === `string`
        ? `/${element[links]}`.toLowerCase()
        : links[element.symbol]
  const element_is_interactive = (element: ChemicalElement): boolean =>
    Boolean(element_href(element) || on_activate)
  let focused_symbol = $state<ElementSymbol | null>(null)
  let first_interactive_symbol = $derived(
    element_data.find(element_is_interactive)?.symbol ?? null,
  )
  let roving_symbol = $derived(
    focused_symbol ??
      (active_element && element_is_interactive(active_element)
        ? active_element.symbol
        : first_interactive_symbol),
  )
  $effect(() => {
    if (links && on_activate) {
      console.warn(
        `PeriodicTable links use native link activation; on_activate applies only to unlinked tiles.`,
      )
    }
  })

  let tooltip_element = $state<ChemicalElement | null>(null)
  let tooltip_pos = $state<Point2D>({ x: 0, y: 0 })
  // tooltip hangs below the tile by default; flipped above for the f-block rows when the
  // table clips its overflow (phone pan mode), where a tooltip below them would be cut off
  let tooltip_above = $state(false)

  // Touch has no hover, so a tap must serve as both "look" and "go": the first tap on a tile
  // only selects it (active ring, tooltip, inset), a second tap on the same tile follows its
  // link or fires on_activate. Mouse clicks are unaffected: hover already made the tile active
  // before the click lands. Plain (non-state) flag: it's consumed by the click of the same tap.
  let tap_is_preview = false
  const handle_tile_pointerdown = (element: ChemicalElement, event: PointerEvent): void => {
    tap_is_preview =
      event.pointerType === `touch` && !disabled && active_element?.symbol !== element.symbol
    // select here rather than relying on the compat mouseenter a tap usually emits: without
    // it the second tap would still see another tile active and preview again
    if (tap_is_preview) {
      set_active_element(element)
      handle_tooltip_enter(element, event)
    }
  }
  const handle_tile_click = (
    data: { element: ChemicalElement; event: MouseEvent },
    activation?: (element: ChemicalElement) => void,
  ): void => {
    const preview = tap_is_preview
    tap_is_preview = false
    if (preview)
      data.event.preventDefault() // keep the link from navigating on the first tap
    else if (activation) activation(data.element)
    else tile_props?.onclick?.(data)
  }

  function handle_key(event: KeyboardEvent & { currentTarget: HTMLDivElement }): void {
    on_table_keydown?.(event)
    if (disabled || event.defaultPrevented) return
    const arrow_keys = [`ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`]
    // Cmd/Ctrl+Arrow scrolls the page; only bare arrows walk tiles
    if (!arrow_keys.includes(event.key) || is_modifier_chord(event)) return

    const event_target = event.target
    const tile =
      event_target instanceof Element
        ? event_target.closest<HTMLElement>(`.element-tile`)
        : null
    if (!tile || !event.currentTarget.contains(tile)) return
    const current_element = element_data.find(
      ({ symbol }) => symbol === tile.dataset.elementSymbol,
    )
    if (!current_element) return

    event.preventDefault() // prevent scrolling the page
    event.stopPropagation()

    // Arrow key navigation including lanthanides (row 9) and actinides (row 10)
    const { column: col, row } = current_element
    const in_f_block = col >= 3 && col <= 17
    const row_map: Record<string, number> = {
      ArrowUp: row === 9 ? 6 : row === 10 ? 7 : row - 1,
      ArrowDown: row === 6 && in_f_block ? 9 : row === 7 && in_f_block ? 10 : row + 1,
    }
    const target_row = row_map[event.key] ?? row
    const target_col =
      event.key === `ArrowLeft` ? col - 1 : event.key === `ArrowRight` ? col + 1 : col
    const target_element = element_data.find(
      (element) =>
        element.column === target_col &&
        element.row === target_row &&
        element_is_interactive(element),
    )
    if (!target_element) return

    focused_symbol = target_element.symbol
    active_element = target_element
    event.currentTarget
      .querySelector<HTMLElement>(`[data-element-symbol="${target_element.symbol}"]`)
      ?.focus()
  }

  function handle_tooltip_enter(element: ChemicalElement, event: MouseEvent): void {
    if (tooltip === false || disabled) return
    tooltip_element = element
    const target = event.currentTarget
    if (!(target instanceof HTMLElement) || !table_node) return
    const rect = target.getBoundingClientRect()
    const container_rect = table_node.getBoundingClientRect()
    tooltip_above = element.row > 7 && getComputedStyle(table_node).overflowY !== `visible`
    tooltip_pos = {
      x: rect.left - container_rect.left + rect.width / 2,
      y: tooltip_above
        ? rect.top - container_rect.top - 8
        : rect.bottom - container_rect.top + 8,
    }
  }

  // finite numeric heat value (numeric strings coerced; colors, null/false and non-finite
  // excluded so they can't poison the color-scale domain). null => not a mappable number
  const to_heat_num = (value: number | string | false | null | undefined): number | null => {
    if (value == null || value === false || is_color(value)) return null
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  }

  // finite numeric heat values usable by the active scale (log excludes non-positive)
  let heat_nums = $derived(
    heat_values
      .flat()
      .map(to_heat_num)
      .filter((num): num is number => num !== null && (!log || num > 0)),
  )
  // data span shared by tile colors and the auto ColorBar; explicit color_scale_range wins,
  // except a non-positive log min, which has no log image and would otherwise floor the ramp
  // at LOG_EPS and squash every tile into its top end: the smallest positive value stands in
  let heat_range = $derived.by((): Vec2 => {
    const [min_override, max_override] = color_scale_range
    const min_lifted = log && min_override !== null && min_override <= 0 ? null : min_override
    const [data_min, data_max] = heat_nums.length > 0 ? array_extent(heat_nums) : [0, 1]
    return [min_lifted ?? data_min, max_override ?? data_max]
  })
  let color_bar_scale = $derived(to_color_bar_scale(color_scale))
  let ramp = $derived(resolve_color_ramp(color_bar_scale, heat_range, log ? `log` : `linear`))

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
    element: ChemicalElement,
  ): string | null => {
    if (Array.isArray(value)) return bg_color(value[0], element) // arrays: use first value
    if (is_color(value)) return value // already a color string

    if (!heat_values.length || value_is_missing(value)) {
      const category_color = colors.category[element.category] || `#cccccc`
      if (missing.color === `element-category`) return category_color
      // default: category colors for a plain table, gray for missing heatmap data
      return missing.color || (heat_values.length ? `#666` : category_color)
    }

    return ramp.color_fn(Number(value))
  }

  // Keep each segment's fill and optional label together.
  const tile_segments = (
    value: HeatValue | false | null,
    element: ChemicalElement,
    override: string | undefined,
    tile_missing: boolean,
  ): TileSegment[] => {
    const values = !tile_missing && Array.isArray(value) ? value : [value]
    return values.map((val) => ({
      color: override ?? bg_color(val, element) ?? undefined,
      value:
        tile_missing || val == null || val === false || Array.isArray(val) || is_color(val)
          ? undefined
          : val,
    }))
  }

  let should_show_color_bar = $derived(show_color_bar && !inset && heat_nums.length > 0)
  // Resolve the shared surface once rather than installing a theme observer per tile.
  let table_node = $state<HTMLDivElement>()
  const page_backdrop = resolve_backdrop(() => table_node)
  // The tooltip fill is a translucent theme token, so it needs the page behind it.
  let tooltip_node = $state<HTMLElement | null>(null)
  const tooltip_fill = resolve_css_color(() => tooltip_node, {
    css_var: `--tooltip-bg`,
    // mirrors the light-dark() default in the .tooltip rule below
    fallback: () => (is_dark_mode() ? `rgba(0, 0, 0, 0.85)` : `rgba(255, 255, 255, 0.95)`),
  })
  const tooltip_text_color = $derived(
    pick_contrast_color({
      background: tooltip_fill.current,
      backdrop: page_backdrop.current,
    }),
  )
</script>

<div
  bind:this={table_node}
  {...rest}
  class={[`periodic-table`, rest.class]}
  style:gap
  onkeydown={handle_key}
>
  {#if should_show_color_bar}
    <TableInset class="auto-colorbar-inset">
      <ColorBar
        scale={color_bar_scale}
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
    {@const href = element_href(element)}
    {@const tile_activation = href ? undefined : on_activate}
    {@const value = heat_values[element.number - 1]}
    {@const override = color_overrides[symbol]}
    {@const tile_missing = heat_values.length > 0 && !override && value_is_missing(value)}
    {@const is_active_elem = active_elements.some((active_elem) =>
      typeof active_elem === `string` ? active_elem === symbol : active_elem.symbol === symbol,
    )}
    {@const active =
      active_category === category || active_element?.name === name || is_active_elem}
    {@const style = `grid-column: ${column}; grid-row: ${row};${
      tile_props?.style ? ` ${tile_props.style}` : ``
    }${tile_missing && missing.style ? ` ${missing.style}` : ``}`}
    <ElementTile
      {...tile_props}
      {element}
      {href}
      backdrop={page_backdrop.current}
      data-element-symbol={symbol}
      segments={tile_segments(value, element, override, tile_missing)}
      {active}
      label={labels[symbol] ?? (tile_missing ? missing.label : undefined)}
      {style}
      onmouseenter={(event: MouseEvent) => {
        set_active_element(element)
        handle_tooltip_enter(element, event)
      }}
      onmouseleave={() => {
        set_active_element(null)
        tooltip_element = null
      }}
      onfocus={() => {
        focused_symbol = symbol
        set_active_element(element)
      }}
      onblur={() => {
        focused_symbol = null
        set_active_element(null)
      }}
      role={tile_activation ? `button` : href ? `link` : tile_props?.role}
      tabindex={element_is_interactive(element)
        ? roving_symbol === symbol
          ? 0
          : -1
        : tile_props?.tabindex}
      onpointerdown={(event: PointerEvent) => handle_tile_pointerdown(element, event)}
      onclick={element_is_interactive(element)
        ? (data: { element: ChemicalElement; event: MouseEvent }) =>
            handle_tile_click(data, tile_activation)
        : tile_props?.onclick}
      onkeydown={tile_activation
        ? (event: KeyboardEvent) => {
            if (event.key !== `Enter` && event.key !== ` `) return
            event.preventDefault()
            tile_activation(element)
          }
        : tile_props?.onkeydown}
      {split_layout}
    />
  {/each}
  <!-- show tile for lanthanides and actinides with text La-Lu and Ac-Lr respectively -->
  {#each lanth_act_tiles as lanth_act_element, idx (lanth_act_element.symbol)}
    {@const style = `opacity: 0.8; grid-column: 3; grid-row: ${6 + idx}; ${tile_props?.style ?? ``}`}
    <ElementTile
      {...tile_props}
      element={lanth_act_element as unknown as ChemicalElement}
      backdrop={page_backdrop.current}
      {style}
      onmouseenter={() => (active_category = lanth_act_element.category)}
      onmouseleave={() => (active_category = null)}
      symbol_style="font-size: 30cqw;"
    />
  {/each}
  <!-- vertical offset between the main block and the lanthanide/actinide rows -->
  <div class="spacer"></div>

  {#if show_photo && active_element}
    <ElementPhoto element={active_element} style="grid-area: 9/1/span 2/span 2" />
  {/if}

  <!-- Tooltip -->
  {#if tooltip_element && tooltip !== false}
    {@const el = tooltip_element}
    {@const tooltip_value = heat_values[el.number - 1]}
    <div
      class={[`tooltip`, tooltip_above && `above`]}
      style:left="{tooltip_pos.x}px"
      style:top="{tooltip_pos.y}px"
      bind:this={tooltip_node}
      style:--tooltip-auto-color={tooltip_text_color}
    >
      {#if typeof tooltip === `function`}
        {@render tooltip({
          element: el,
          value: tooltip_value ?? null,
          active: active_category === el.category || active_element?.name === el.name,
          bg_color: color_overrides[el.symbol] ?? bg_color(tooltip_value, el),
          scale_context: { min: heat_range[0], max: heat_range[1], color_scale },
        })}
      {:else}
        {el.name}<br />
        <small>{el.symbol} • {el.number}</small>
        {#if Array.isArray(tooltip_value)}
          <br />
          <small>Values: {tooltip_value.join(`, `)}</small>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .periodic-table {
    container-type: inline-size; /* for gap: 0.3cqw */
    width: 100%; /* prevent collapse in shrink-to-fit contexts */
    display: grid;
    grid-template-columns: repeat(18, minmax(var(--ptable-min-tile-size, 0px), 1fr));
    position: relative;
    gap: var(--ptable-gap, 0.3cqw);
  }
  /* Phones: a table squeezed to ~370px has 20px tiles, too small to read or tap. Below this
     width the tiles keep a finger-sized floor and the table pans sideways instead. The query
     resolves against the nearest ancestor container (the docs site's <main>); with none the
     rule never applies and the table keeps fitting its box. An inline
     `--ptable-min-tile-size: 0` on the table opts a decorative mini-table out. */
  @container (max-width: 600px) {
    .periodic-table {
      --ptable-min-tile-size: 2rem;
      overflow-x: auto;
      overflow-y: hidden;
      /* a sideways flick at either end must not drag the whole page */
      overscroll-behavior-x: contain;
    }
  }
  .periodic-table :global(.auto-colorbar-inset) {
    place-items: center;
    padding: clamp(0.3em, 1.5cqw, 1em) clamp(0.4em, 3cqw, 2em);
    --cbar-font-size: clamp(7pt, 1.8cqw, 9pt);
    --cbar-thickness: clamp(8px, 2.5cqw, 14px);
  }
  .periodic-table :global(.auto-colorbar-inset .colorbar) {
    width: 90%;
  }
  div.spacer {
    grid-row: 8;
    /* the variable is the spacer height in tile widths; 0 degenerates the ratio to auto, i.e.
       no offset */
    aspect-ratio: 1 / var(--ptable-inner-transition-offset, 0.5);
  }
  .tooltip {
    --_bg: var(--tooltip-bg, light-dark(rgba(255, 255, 255, 0.95), rgba(0, 0, 0, 0.85)));
    position: absolute;
    transform: translate(-50%, -10%);
    background: var(--_bg);
    color: var(--tooltip-color, var(--tooltip-auto-color, light-dark(#222, #eee)));
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
    border-bottom: 8px solid var(--_bg);
    box-sizing: border-box;
    margin: 0 auto;
  }
  .tooltip.above {
    transform: translate(-50%, -100%);
  }
  .tooltip.above::before {
    top: auto;
    bottom: -15%;
    border-bottom: none;
    border-top: 8px solid var(--_bg);
  }
</style>
