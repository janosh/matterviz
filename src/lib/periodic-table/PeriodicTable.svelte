<script lang="ts">
  import { is_modifier_chord } from 'svelte-widgets/utils'
  import { is_color, resolve_backdrop } from '#lib/colors/index.js'
  import type {
    ChemicalElement,
    ElementCategory,
    ElementSymbol,
    SplitLayout,
    TileSegment,
  } from '#lib/element/index.js'
  import {
    element_data,
    ElementPhoto,
    ElementTile,
    is_elem_symbol,
  } from '#lib/element/index.js'
  import { ELEM_SYMBOLS, format_num } from '#lib/labels.js'
  import { array_extent } from '#lib/math.js'
  import { ColorBar } from '#lib/plot/index.js'
  import PlotTooltip from '#lib/plot/core/components/PlotTooltip.svelte'
  import { beside_rect, clip_bounds } from '#lib/plot/core/decorations/tooltip.js'
  import type { Rect } from '#lib/plot/core/layout.js'
  import { resolve_color_scale, to_color_scale_config } from '#lib/plot/core/scales.js'
  import { type ColorScale, get_scale_type_name } from '#lib/plot/core/types.js'
  import { colors } from '#lib/state.svelte.js'
  import { is_plain_object } from '#lib/utils.js'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { TooltipProp } from '#lib/tooltip/index.js'
  import { TooltipPin } from '#lib/tooltip/pin.svelte.js'
  import { viewer_keys } from '#lib/shortcuts.js'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { MissingCellStyle } from '#lib/heatmap-matrix/index.js'
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
    color_scale = `interpolateViridis`,
    active_element = $bindable(null),
    active_category = $bindable(null),
    active_elements = $bindable([]),
    gap,
    lanth_act_tiles = tile_props?.show_symbol === false
      ? []
      : [...default_f_block_inset_tiles],
    color_overrides = {},
    labels = {},
    missing = {},
    split_layout = undefined,
    color_bar = {},
    inset,
    tooltip,
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
    color_scale?: ColorScale
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
    color_overrides?: Partial<Record<ElementSymbol, string>>
    labels?: Partial<Record<ElementSymbol, string>>
    missing?: MissingCellStyle // styling for tiles with no heatmap value
    // control the layout of multi-value splits for all tiles
    split_layout?: SplitLayout
    // auto color bar shown when heatmap_values is provided; null hides it
    color_bar?: Partial<ComponentProps<typeof ColorBar>> | null
    inset?: Snippet<[{ active_element: ChemicalElement | null }]>
    tooltip?: TooltipProp<{
      element: ChemicalElement
      value: HeatValue | null
      active: boolean
      bg_color: string | null
      scale_context: ScaleContext
    }>
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
    // keep absent elements as null (distinct from a real 0 value) so they map to the
    // missing fallback while explicit 0 maps through the color scale
    return ELEM_SYMBOLS.map((symbol) => heatmap_values[symbol] ?? null)
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
  let active_symbols = $derived(
    new Set(active_elements.map((elem) => (typeof elem === `string` ? elem : elem.symbol))),
  )
  // shared by the tiles and the tooltip snippet, so both agree on what is active. A pinned
  // tooltip's tile stays active like a hovered one.
  const is_active = (element: ChemicalElement): boolean =>
    active_category === element.category ||
    active_element?.name === element.name ||
    pin.is({ element }) ||
    active_symbols.has(element.symbol)
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
  // Keys that aren't element symbols (`fe`, `FE`, `Xx`) match no tile, so they're ignored
  $effect(() => {
    const keyed = { heatmap_values, color_overrides, labels, links }
    for (const [prop, record] of Object.entries(keyed)) {
      if (!is_plain_object(record)) continue // arrays, links templates and unset props
      const bad_keys = Object.keys(record).filter((key) => !is_elem_symbol(key))
      if (bad_keys.length)
        console.warn(`PeriodicTable ${prop}: keys must be element symbols, got ${bad_keys}`)
    }
  })
  $effect(() => {
    if (links && on_activate)
      console.warn(
        `PeriodicTable links use native link activation; on_activate applies only to unlinked tiles.`,
      )
  })

  // The hovered tile's box in table coordinates, and the box that would clip a tooltip there:
  // the table itself when it pans (phones), so f-block tooltips flip above their tiles
  // `labeled`: value labels the tile shows, so the tooltip lists the values only when it hides
  // some (tiles too small for labels, colors, off-scale values, segments past four)
  type TileTooltip = { element: ChemicalElement; tile: Rect; bounds: Rect; labeled: number }
  let tooltip_hover = $state<TileTooltip | null>(null)
  // Clicking a tile without a link or on_activate pins its tooltip, as does a touch preview
  const pin = new TooltipPin<TileTooltip, Pick<TileTooltip, `element`>>({
    key: ({ element }) => element.symbol,
  })
  const shown_tooltip = $derived(pin.shown(tooltip_hover))

  // Touch has no hover, so the first tap on a tile only selects it (active ring, pinned
  // tooltip, inset) and a second tap follows its link or fires on_activate. Mouse clicks
  // unaffected. Plain (non-state) flag: it's consumed by the click of the same tap.
  let tap_is_preview = false
  const handle_tile_pointerdown = (element: ChemicalElement, event: PointerEvent): void => {
    tap_is_preview =
      event.pointerType === `touch` && !disabled && active_element?.symbol !== element.symbol
    // select here rather than relying on the compat mouseenter a tap usually emits: without
    // it the second tap would still see another tile active and preview again
    if (tap_is_preview) {
      set_active_element(element)
      handle_tooltip_enter(element, event)
      pin.value = tooltip_hover
    }
  }
  const handle_tile_click = (
    data: { element: ChemicalElement; event: MouseEvent },
    interactive: boolean,
    activation?: (element: ChemicalElement) => void,
  ): void => {
    const preview = tap_is_preview
    tap_is_preview = false
    // the preview tap pinned on pointerdown; keep a link from navigating until the second tap
    if (preview && interactive) return data.event.preventDefault()
    if (interactive) pin.unpin() // activation ends the preview
    else if (!preview)
      pin.toggle(tooltip_hover?.element.symbol === data.element.symbol ? tooltip_hover : null)
    if (activation) activation(data.element)
    else tile_props?.onclick?.(data)
  }

  function handle_key(event: KeyboardEvent & { currentTarget: HTMLDivElement }): void {
    on_table_keydown?.(event)
    if (disabled || event.defaultPrevented) return
    const row_step = event.key === `ArrowUp` ? -1 : event.key === `ArrowDown` ? 1 : 0
    const col_step = event.key === `ArrowLeft` ? -1 : event.key === `ArrowRight` ? 1 : 0
    // Cmd/Ctrl+Arrow scrolls the page; only bare arrows walk tiles
    if ((!row_step && !col_step) || is_modifier_chord(event)) return

    const tile =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(`.element-tile`)
        : null
    if (!tile || !event.currentTarget.contains(tile)) return
    const current_element = element_data.find(
      ({ symbol }) => symbol === tile.dataset.elementSymbol,
    )
    if (!current_element) return

    event.preventDefault() // prevent scrolling the page
    event.stopPropagation()

    // Walk the grid, including lanthanides (row 9) and actinides (row 10) below empty row 8
    let target_row = current_element.row + row_step
    let target_col = current_element.column + col_step
    // Sparse links and the table's empty grid cells must not strand keyboard focus.
    while (target_row >= 1 && target_row <= 10 && target_col >= 1 && target_col <= 18) {
      const target_element = element_data.find(
        (element) =>
          element.column === target_col &&
          element.row === target_row &&
          element_is_interactive(element),
      )
      if (target_element) {
        focused_symbol = target_element.symbol
        active_element = target_element
        event.currentTarget
          .querySelector<HTMLElement>(`[data-element-symbol="${target_element.symbol}"]`)
          ?.focus()
        return
      }
      target_row += row_step
      target_col += col_step
    }
  }

  function handle_tooltip_enter(element: ChemicalElement, event: MouseEvent): void {
    if (tooltip === false || disabled) return
    const target = event.currentTarget
    if (!(target instanceof HTMLElement) || !table_node) return
    const { left, top, width, height } = target.getBoundingClientRect()
    const origin = table_node.getBoundingClientRect()
    const tile = { x: left - origin.left, y: top - origin.top, width, height }
    const labeled = [...target.querySelectorAll(`.value`)].filter(
      (label) => getComputedStyle(label).display !== `none`,
    ).length
    tooltip_hover = { element, tile, bounds: clip_bounds(table_node), labeled }
  }

  let use_log = $derived(
    get_scale_type_name(to_color_scale_config(color_scale).type) === `log`,
  )
  // Numeric heat values usable by the active scale; blank/color strings and missing data
  // cannot enter the domain or labels. Log scales also exclude non-positive values.
  const to_heat_num = (value: number | string | false | null | undefined): number | null => {
    const num = typeof value === `string` && value.trim() ? Number(value) : value
    if (typeof num !== `number` || !Number.isFinite(num) || (use_log && num <= 0)) return null
    return num
  }

  let heat_nums = $derived(
    heat_values
      .flat()
      .map(to_heat_num)
      .filter((num): num is number => num !== null),
  )
  // tile colors and the auto ColorBar over one span: explicit value_range ends win, the data
  // extent fills the rest (non-positive log ends lift to the smallest positive value)
  let ramp = $derived(
    resolve_color_scale(color_scale, () =>
      heat_nums.length > 0 ? array_extent(heat_nums) : [0, 1],
    ),
  )
  let heat_range = $derived(ramp.color_scale.value_range)

  // whether a value maps to a heatmap color (false => use the missing fallback). 0 is a
  // real value; only absent/null/non-finite (and <=0 in log mode) count as missing. a
  // multi-value tile is missing only when every segment is missing
  const value_is_missing = (value: HeatValue | false | null): boolean => {
    if (Array.isArray(value)) return value.every(value_is_missing) // [] -> true (missing)
    if (is_color(value)) return false // explicit colors are real values, not missing
    return to_heat_num(value) === null
  }

  const bg_color = (
    value: HeatValue | false | null,
    element: ChemicalElement,
  ): string | null => {
    if (Array.isArray(value)) return bg_color(value[0], element) // arrays: use first value
    if (is_color(value)) return value // already a color string

    const num = to_heat_num(value)
    if (!heat_values.length || num === null) {
      const category_color = colors.category[element.category] || `#cccccc`
      if (missing.color === `element-category`) return category_color
      // default: category colors for a plain table, gray for missing heatmap data
      return missing.color || (heat_values.length ? `#666` : category_color)
    }

    return ramp.color_fn(num)
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
        (typeof val === `number` || typeof val === `string`) && to_heat_num(val) !== null
          ? val
          : undefined,
    }))
  }

  let should_show_color_bar = $derived(color_bar && !inset && heat_nums.length > 0)
  // Resolve the shared surface once rather than installing a theme observer per tile.
  let table_node = $state<HTMLDivElement>()
  const page_backdrop = resolve_backdrop(() => table_node)
</script>

<div
  bind:this={table_node}
  {...rest}
  class={[`periodic-table`, rest.class]}
  style:gap
  onkeydown={handle_key}
  {@attach viewer_keys(() => ({ Escape: pin.unpin }))}
  onpointerdown={({ target }) => {
    if (!(target instanceof Element && target.closest(`.element-tile, .plot-tooltip`)))
      pin.unpin()
  }}
>
  {#if should_show_color_bar}
    <TableInset class="auto-colorbar-inset">
      <ColorBar
        color_scale={ramp.color_scale}
        tick_labels={3}
        tick_side="primary"
        bar_style="width: 100%;"
        {...color_bar}
      />
    </TableInset>
  {:else}
    {@render inset?.({ active_element })}
  {/if}
  {#each element_data as element (element.number)}
    {@const { column, row, symbol } = element}
    {@const href = element_href(element)}
    {@const tile_activation = href ? undefined : on_activate}
    {@const value = heat_values[element.number - 1]}
    {@const override = color_overrides[symbol]}
    {@const tile_missing = heat_values.length > 0 && !override && value_is_missing(value)}
    {@const interactive = Boolean(href || on_activate)}
    {@const active = is_active(element)}
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
        tooltip_hover = null
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
      tabindex={interactive ? (roving_symbol === symbol ? 0 : -1) : tile_props?.tabindex}
      onpointerdown={(event: PointerEvent) => handle_tile_pointerdown(element, event)}
      onclick={interactive || tooltip !== false
        ? (data: { element: ChemicalElement; event: MouseEvent }) =>
            handle_tile_click(data, interactive, tile_activation)
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

  {#if shown_tooltip && tooltip !== false}
    {@const { element, tile, bounds, labeled } = shown_tooltip}
    {@const tooltip_value = heat_values[element.number - 1]}
    {@const values = Array.isArray(tooltip_value)
      ? tooltip_value
      : tooltip_value == null
        ? []
        : [tooltip_value]}
    <!-- inline, so it beats PlotTooltip's start default while still reading the variable -->
    <PlotTooltip
      {...beside_rect(tile, `bottom`, 8)}
      arrow
      constrain_to={bounds}
      pinned={pin.value !== null}
      style="text-align: var(--plot-tooltip-text-align, center)"
    >
      {#if typeof tooltip === `function`}
        {@render tooltip({
          element,
          value: tooltip_value ?? null,
          active: is_active(element),
          bg_color: color_overrides[element.symbol] ?? bg_color(tooltip_value, element),
          scale_context: { min: heat_range[0], max: heat_range[1], color_scale },
        })}
      {:else}
        {element.name}<br />
        <small>{element.symbol} • {element.number}</small>
        {#if values.length > labeled}
          <br />
          <!-- numbers formatted like the tile labels, colors verbatim -->
          <small
            >{values.length > 1 ? `Values` : `Value`}: {values
              .map((val) =>
                typeof val === `number` ? format_num(val, tile_props?.float_fmt) : val,
              )
              .join(`, `)}</small
          >
        {/if}
      {/if}
    </PlotTooltip>
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
  /* Phones: a ~370px table has 20px tiles, too small to read or tap, so below this width tiles
     keep a finger-sized floor and the table pans sideways. The query resolves against the
     nearest ancestor container (none: never applies). `--ptable-min-tile-size: 0` opts out. */
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
    padding: min(1.5cqw, 1em) min(3cqw, 2em);
    --cbar-font-size: min(4.5cqw, 9pt);
    --cbar-thickness: min(5cqw, 14px);
    --cbar-label-padding: 0 0.4em;
    --cbar-tick-label-padding: 0 0.2em;
    --cbar-tick-gutter: 1.2em;
  }
  .periodic-table :global(.auto-colorbar-inset .colorbar) {
    width: 90%;
    line-height: 1.2;
  }
  div.spacer {
    grid-row: 8;
    /* spacer height in tile widths; 0 degenerates the ratio to auto, i.e. no offset */
    aspect-ratio: 1 / var(--ptable-inner-transition-offset, 0.5);
  }
</style>
