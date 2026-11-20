<script lang="ts">
  import { is_plain_object } from 'svelte-widgets/utils'
  import { format_num } from 'svelte-widgets/format'
  import { is_modifier_chord } from 'svelte-widgets/shortcuts'
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
  import { ELEM_SYMBOLS } from '#lib/labels.js'
  import { array_extent } from '#lib/math.js'
  import { ticks as d3_ticks } from 'd3-array'
  import { ColorBar } from '#lib/plot/index.js'
  import PlotTooltip from '#lib/plot/core/components/PlotTooltip.svelte'
  import { beside_rect, clip_bounds } from '#lib/plot/core/decorations/tooltip.js'
  import type { Rect } from '#lib/plot/core/layout.js'
  import { resolve_color_scale, to_color_scale_config } from '#lib/plot/core/scales.js'
  import { type ColorScale, get_scale_type_name } from '#lib/plot/core/types.js'
  import { colors } from '#lib/state.svelte.js'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { TooltipProp } from '#lib/tooltip/index.js'
  import { TooltipPin } from '#lib/tooltip/pin.svelte.js'
  import { viewer_keys } from '#lib/shortcuts.js'
  import type { HTMLAttributes, SVGAttributes } from 'svelte/elements'
  import type { MissingCellStyle } from '#lib/heatmap-matrix/index.js'
  import type { ScaleContext } from './index'
  import { TableInset } from './index'
  import {
    type TileMark,
    tile_plot_marks,
    type TilePlotConfig,
    type TilePlotData,
  } from './tile-plots'

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
    tile_plots = {},
    tile_plot_config = {},
    inset,
    tooltip,
    on_activate,
    // Keydown handler on the table, run before arrow-key tile navigation; call preventDefault() to skip navigation.
    onkeydown: on_table_keydown,
    ...rest
  }: HTMLAttributes<HTMLDivElement> & {
    // Props spread onto every ElementTile (e.g. show_name, symbol_style); the per-tile active, backdrop, element, href, label, segments and split_layout are set by the table.
    // Its own onmouseenter, onmouseleave, onfocus, onblur and onpointerdown replace yours (as onclick does on interactive tiles, where tile_props.onclick still runs on activation).
    tile_props?: Omit<
      Partial<ComponentProps<typeof ElementTile>>,
      `active` | `backdrop` | `element` | `href` | `label` | `segments` | `split_layout`
    >
    // Show a photo of the active element in the empty area left of the f-block rows.
    show_photo?: boolean
    disabled?: boolean // disable hover and click events from updating active_element
    // array (positional by atomic number, can be partial) or object keyed by element symbol.
    // each value is a single number/color or an array of 1-4 numbers/colors for multi-segment
    // tiles. null/omitted -> missing (uses the `missing` fallback); 0 is a real value
    heatmap_values?: Partial<Record<ElementSymbol, HeatValue | null>> | (HeatValue | null)[]
    // links is either string with element property (name, symbol, number, ...) to use as link,
    // or object with mapping element symbols to link
    links?: keyof ChemicalElement | Partial<Record<ElementSymbol, string>> | null
    // Color scale mapping heatmap_values to tile colors: a d3 interpolator name, function or scale config.
    color_scale?: ColorScale
    // Hovered or keyboard-focused element, null when none. Bindable; writes are ignored while disabled.
    active_element?: ChemicalElement | null
    // Element category currently highlighted (e.g. by hovering a lanthanide/actinide inset tile); tiles of this category show as active.
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
    // Per-element tile color keyed by symbol; wins over the heatmap color scale and exempts the tile from missing styling.
    color_overrides?: Partial<Record<ElementSymbol, string>>
    // Per-element text keyed by symbol, shown instead of the element name (hidden when the tile shows value labels).
    labels?: Partial<Record<ElementSymbol, string>>
    missing?: MissingCellStyle // styling for tiles with no heatmap value
    // control the layout of multi-value splits for all tiles
    split_layout?: SplitLayout
    // auto color bar shown when heatmap_values is provided; null hides it
    color_bar?: Partial<ComponentProps<typeof ColorBar>> | null
    // Mini plot per element keyed by symbol: `{ values }` bins into a histogram, `{ x, y }` draws
    // markers and/or a line (a list overlays several series). Tiles share axes; the symbol moves
    // to the top-right corner, a `labels` entry or heatmap value under it, the element name hides.
    tile_plots?: Partial<Record<ElementSymbol, TilePlotData | null>>
    // Bin count, x/y drawing mode, colors, log heights and shared axis ranges of the tile plots
    tile_plot_config?: TilePlotConfig
    // Content for the empty grid area above the d-block (columns 3-12, top rows); replaces the auto color bar. Receives the active element.
    inset?: Snippet<[{ active_element: ChemicalElement | null }]>
    // Hover tooltip: a snippet replaces the default, false disables it. Clicking a tile without link or on_activate pins it.
    tooltip?: TooltipProp<{
      element: ChemicalElement
      value: HeatValue | null
      active: boolean
      bg_color: string | null
      scale_context: ScaleContext
    }>
    // Called with the element when an unlinked tile is clicked or activated by keyboard; makes tiles focusable buttons.
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
  // throws on keys that aren't element symbols and malformed series (see tile_plot_marks)
  let tile_plot_result = $derived(tile_plot_marks(tile_plots, tile_plot_config))
  // Tiles behind plots share one neutral fill instead of category colors that would compete
  // with the plots (heatmap values and color_overrides still win). A CSS var, so tile text
  // inherits the page color in either theme.
  const plot_tile_bg = `var(--ptable-plot-tile-bg, color-mix(in srgb, currentColor 12%, transparent))`
  let has_tile_plots = $derived(Object.keys(tile_plot_result.marks).length > 0)
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
      handle_tooltip_enter(element, event.currentTarget)
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

  // On hover and on keyboard focus alike, so arrow-key navigation shows each tile's tooltip
  function handle_tooltip_enter(element: ChemicalElement, target: EventTarget | null): void {
    if (tooltip === false || disabled) return
    if (!(target instanceof HTMLElement) || !table_node) return
    const { left, top, width, height } = target.getBoundingClientRect()
    const origin = table_node.getBoundingClientRect()
    const tile = { x: left - origin.left, y: top - origin.top, width, height }
    const labeled = [...target.querySelectorAll(`.value`)].filter(
      (label) => getComputedStyle(label).display !== `none`,
    ).length
    tooltip_hover = { element, tile, bounds: clip_bounds(table_node), labeled }
  }

  // Hover ends: the keyboard-focused tile, if any, takes the active ring and tooltip back
  const end_hover = (): void => {
    const node = focused_symbol
      ? table_node?.querySelector(`[data-element-symbol="${focused_symbol}"]`)
      : null
    const element = element_data.find(({ symbol }) => symbol === focused_symbol)
    set_active_element(element ?? null)
    tooltip_hover = null
    if (node && element) handle_tooltip_enter(element, node)
  }
  // Escape unpins, else hides a hover or focus tooltip (WCAG 1.4.13); false leaves it to the host
  const dismiss_tooltip = (): boolean => {
    if (pin.unpin()) return true
    if (!tooltip_hover) return false
    tooltip_hover = null
    return true
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
    if (!heat_values.length && has_tile_plots) return plot_tile_bg
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

  // The active (hovered or focused) tile's plot, enlarged with axes in the auto inset: its plot
  // box in px (at most 2.5x wider than tall, centered, so wide insets don't flatten it) and
  // ticks as [px, label], about one per 60px on x and 40px on y
  let zoom_size = $state({ width: 0, height: 0 })
  let zoom = $derived.by(() => {
    const symbol = active_element?.symbol
    const marks = symbol && tile_plot_result.marks[symbol]
    const axes = symbol && tile_plot_result.axes[symbol]
    if (!active_element || !marks || !axes) return null
    const pad = { left: 40, right: 10, top: 16, bottom: 18 }
    const height = Math.max(0, zoom_size.height - pad.top - pad.bottom)
    const width = Math.max(0, Math.min(zoom_size.width - pad.left - pad.right, 2.5 * height))
    if (!width || !height) return null // unmeasured: every tick would land on one px
    const left = (zoom_size.width - width + pad.left - pad.right) / 2
    const {
      x: [x_lo, x_hi],
      y: [y_lo, y_hi],
      log_y,
    } = axes
    const ticks = (lo: number, hi: number, length: number, px_per_tick: number) =>
      d3_ticks(lo, hi, Math.max(2, Math.floor(length / px_per_tick)))
    const tick = (val: number, px: number) => ({ val, px, text: format_num(val) })
    const y_frac = (val: number): number =>
      log_y ? Math.log1p(val) / Math.log1p(y_hi) : (val - y_lo) / (y_hi - y_lo)
    // log_y histograms tick 0 and powers of ten on their log(1 + count) heights, skipping
    // any closer than 12px to the tick below so labels don't collide
    const y_values = log_y
      ? [
          0,
          ...Array.from({ length: Math.floor(Math.log10(y_hi)) + 1 }, (_, exp) => 10 ** exp),
        ].filter(
          (val, idx, all) => !idx || height * (y_frac(val) - y_frac(all[idx - 1])) >= 12,
        )
      : ticks(y_lo, y_hi, height, 40)
    return {
      element: active_element,
      marks,
      box: { left, top: pad.top, width, height },
      x_ticks: ticks(x_lo, x_hi, width, 60).map((val) =>
        tick(val, left + (width * (val - x_lo)) / (x_hi - x_lo)),
      ),
      y_ticks: y_values.map((val) => tick(val, pad.top + height * (1 - y_frac(val)))),
    }
  })

  // the auto color bar explains the heatmap, else the tile plots' color scale
  let color_bar_ramp = $derived(heat_nums.length > 0 ? ramp : tile_plot_result.ramp)
  let should_show_color_bar = $derived(color_bar && !inset && color_bar_ramp)
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
  {@attach viewer_keys(() => ({ Escape: dismiss_tooltip }))}
  onpointerdown={({ target }) => {
    if (!(target instanceof Element && target.closest(`.element-tile, .plot-tooltip`)))
      pin.unpin()
  }}
>
  {#snippet plot_marks(marks: TileMark[], attrs: SVGAttributes<SVGSVGElement>)}
    <svg
      {...attrs}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      style:color={tile_plot_config.color}
    >
      {#each marks as { kind, d, color }, idx (idx)}
        <path class={kind} {d} style:color />
      {/each}
    </svg>
  {/snippet}
  {#if should_show_color_bar || (has_tile_plots && !inset)}
    <TableInset class={[`auto-colorbar-inset`, has_tile_plots && `with-tile-plots`]}>
      {#if has_tile_plots}
        <figure
          class="tile-zoom"
          bind:clientWidth={zoom_size.width}
          bind:clientHeight={zoom_size.height}
        >
          {#if zoom}
            {@const { element, marks, box, x_ticks, y_ticks } = zoom}
            {@const { left, top, width, height } = box}
            <svg role="img" aria-label="{element.name} tile plot">
              <text class="title" x={left} y={top - 8}>{element.number} {element.name}</text>
              <path class="frame" d="M{left} {top}V{top + height}H{left + width}" />
              {#each x_ticks as { val, px, text } (val)}
                <g transform="translate({px} {top + height})">
                  <line y2="4" />
                  <text y="15" text-anchor="middle">{text}</text>
                </g>
              {/each}
              {#each y_ticks as { val, px, text } (val)}
                <g transform="translate({left} {px})">
                  <line x2="-4" />
                  <text x="-7" dy="0.35em" text-anchor="end">{text}</text>
                </g>
              {/each}
              {@render plot_marks(marks, { class: `marks`, x: left, y: top, width, height })}
            </svg>
          {:else}
            <figcaption>Hover or tap a tile to enlarge its plot</figcaption>
          {/if}
        </figure>
      {/if}
      {#if should_show_color_bar}
        <ColorBar
          color_scale={color_bar_ramp?.color_scale}
          tick_labels={3}
          tick_side="primary"
          bar_style="width: 100%;"
          {...color_bar}
        />
      {/if}
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
    {@const marks = tile_plot_result.marks[symbol]}
    {@const label = labels[symbol] ?? (tile_missing ? missing.label : undefined)}
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
      {label}
      {style}
      onmouseenter={(event: MouseEvent) => {
        set_active_element(element)
        handle_tooltip_enter(element, event.currentTarget)
      }}
      onmouseleave={end_hover}
      onfocus={(event: FocusEvent) => {
        focused_symbol = symbol
        set_active_element(element)
        handle_tooltip_enter(element, event.currentTarget)
      }}
      onblur={() => {
        focused_symbol = null
        set_active_element(null)
        tooltip_hover = null
      }}
      role={tile_activation ? `button` : href ? `link` : tile_props?.role}
      tabindex={interactive ? (roving_symbol === symbol ? 0 : -1) : tile_props?.tabindex}
      onpointerdown={(event: PointerEvent) => handle_tile_pointerdown(element, event)}
      onclick={interactive || tooltip !== false
        ? (data: { element: ChemicalElement; event: MouseEvent }) =>
            handle_tile_click(data, interactive, tile_activation)
        : tile_props?.onclick}
      {split_layout}
      show_name={(tile_props?.show_name ?? true) && (!marks || label !== undefined)}
    >
      {#if marks}
        {@render plot_marks(marks, { class: `tile-plot marks`, 'aria-hidden': `true` })}
      {/if}
    </ElementTile>
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
      segments={has_tile_plots ? [{ color: plot_tile_bg }] : undefined}
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
  /* Paint of the tile plots and their enlarged copy: bars filled, markers and lines stroked */
  .marks {
    overflow: visible;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: var(--stroke);
    path {
      vector-effect: non-scaling-stroke;
    }
    .markers {
      stroke-width: calc(2 * var(--stroke));
    }
    .bars {
      fill: currentColor;
      stroke: none;
    }
  }
  .tile-plot {
    position: absolute;
    inset: auto 6cqw 6cqw;
    width: 88cqw;
    height: 58cqw;
    z-index: 2;
    --stroke: max(1.5px, 3cqw);
  }
  /* With tile plots the enlarged plot takes the inset's full height beside the color bar */
  .periodic-table :global(.auto-colorbar-inset.with-tile-plots) {
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    place-items: center stretch;
    gap: 1em;
  }
  .tile-zoom {
    position: relative;
    align-self: stretch;
    margin: 0;
    min-height: 0;
    &:only-child {
      grid-column: 1 / -1;
    }
    font-size: 11px;
    > svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .marks {
      --stroke: 2.5px;
    }
    .frame,
    line {
      fill: none;
      stroke: currentColor;
      opacity: 0.5;
    }
    text {
      fill: currentColor;
    }
    .title {
      font-weight: 600;
    }
    figcaption {
      display: grid;
      place-items: center;
      height: 100%;
      opacity: 0.6;
    }
  }
  /* a label or value under the symbol pushes the plot top down */
  .periodic-table
    :global(.element-tile:has(> span.name, > span.value:not(.multi-value)) > .tile-plot) {
    height: 50cqw;
  }
  /* Number and symbol share the top row (left and right corners), a label or value sits
     under the symbol, and the plot fills the rest above split-heatmap segments */
  .periodic-table :global(.element-tile:has(> .tile-plot)) {
    :global(.symbol) {
      position: absolute;
      top: 6cqw;
      right: 6cqw;
      /* capped: a larger symbol would run into the number */
      font-size: min(var(--elem-symbol-font-size, 24cqw), 24cqw);
    }
    :global(span.name),
    :global(span.value:not(.multi-value)) {
      top: 31cqw;
      right: 6cqw;
      bottom: auto;
      font-size: 12cqw;
    }
  }
  div.spacer {
    grid-row: 8;
    /* spacer height in tile widths; 0 degenerates the ratio to auto, i.e. no offset */
    aspect-ratio: 1 / var(--ptable-inner-transition-offset, 0.5);
  }
</style>
