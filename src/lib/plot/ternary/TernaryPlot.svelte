<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import { type TooltipProp, TooltipValue } from '#lib/tooltip/index.js'
  import { plot_color } from '#lib/colors/index.js'
  import { TRIANGLE_VERTICES } from '#lib/convex-hull/barycentric-coords.js'
  import ViewerError from '#lib/layout/ViewerError.svelte'
  import { format_value, format_value_or_num } from '#lib/labels.js'
  import type { Vec2, Vec3 } from '#lib/math.js'
  import type { BasePlotProps, ColorScale, LegendConfig, PointStyle } from '#lib/plot/index.js'
  import { ColorBar, PlotTooltip } from '#lib/plot/index.js'
  import ChartShell from '#lib/plot/core/components/ChartShell.svelte'
  import InsetLegend from '#lib/plot/core/components/InsetLegend.svelte'
  import { resolve_color_scale } from '#lib/plot/core/scales.js'
  import { build_legend_items } from '#lib/plot/core/data-transform.js'
  import { has_marker } from '#lib/plot/core/types.js'
  import {
    CANVAS_MARKER_THRESHOLD,
    type CanvasMarker,
    canvas_safe_color,
    create_marker_canvas,
  } from '#lib/plot/core/canvas-markers.svelte.js'
  import {
    build_spatial_index,
    query_nearest,
    type SpatialIndex,
  } from '#lib/plot/core/spatial-index.js'
  import {
    closest_data_idx,
    focus_left,
    is_activation_key,
    pointer_pos,
    step_point_cursor,
  } from '#lib/plot/core/interactions.js'
  import { filter_padding } from '#lib/plot/core/layout.js'
  import type { Sides } from '#lib/plot/core/layout.js'
  import { observe_size } from '#lib/plot/core/utils.js'
  import { csv_source, export_filename } from '#lib/plot/core/utils/chart-export.js'
  import { svg_sources } from '#lib/io/export.js'
  import { COLOR_BAR_GAP } from '#lib/plot/core/utils/hierarchy-chart.js'
  import { roving_key } from '#lib/plot/core/utils/roving-focus.js'
  import { create_roving_focus, ROVING_ATTR } from 'svelte-widgets/roving-focus'
  import {
    create_legend_visibility,
    resolve_legend_visibility,
  } from '#lib/plot/core/utils/series-visibility.js'
  import ScatterPoint from '#lib/plot/scatter/ScatterPoint.svelte'
  import type { TernaryPointProps, TernarySeries } from '#lib/plot/ternary/ternary.js'
  import {
    ternary_fractions,
    ternary_grid_lines,
    ternary_layout,
    ternary_to_xy,
  } from '#lib/plot/ternary/ternary.js'
  import TernaryControls, { GRID_DEFAULTS } from '#lib/plot/ternary/TernaryControls.svelte'
  import { is_modifier_chord, to_error } from 'svelte-widgets/utils'
  import { clear_stale_hover } from '#lib/plot/core/hover.svelte.js'
  import { TooltipPin } from '#lib/tooltip/pin.svelte.js'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  // Room for the corner labels beside the bottom corners and above the apex, and for
  // the tick labels written outside each edge
  const DEFAULT_PADDING: Required<Sides> = { t: 30, b: 34, l: 50, r: 50 }
  // Invisible pick margin around each marker, in px
  const HIT_PADDING = 4

  let {
    series: series_in = [],
    hidden_series = $bindable(),
    labels = [`A`, `B`, `C`],
    grid_step = $bindable(GRID_DEFAULTS.grid_step),
    show_grid = $bindable(GRID_DEFAULTS.show_grid),
    show_ticks = $bindable(GRID_DEFAULTS.show_ticks),
    tick_format = `.0%`,
    color_scale = `interpolateViridis`,
    color_bar = {},
    padding = DEFAULT_PADDING, // px around the triangle for corner and tick labels
    legend = {},
    show_legend,
    tooltip,
    hovered = $bindable(false),
    on_point_click,
    on_point_hover,
    show_controls,
    controls_open = $bindable(false),
    controls_toggle_props,
    controls_pane_props,
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    children,
    header_controls,
    controls_extra,
    ...rest
  }: HTMLAttributes<HTMLDivElement> &
    // `range_padding` / `title` are Cartesian-only: accepting them here would silently
    // forward them to the wrapper div as invalid DOM attributes.
    Omit<BasePlotProps, `range_padding` | `title`> & {
      hidden_series?: readonly (string | number)[]
      series?: readonly TernarySeries<Metadata>[]
      // Component names at the right, top and left corner (the order of every triple)
      labels?: readonly [string, string, string]
      grid_step?: number // fraction between grid lines / ticks; 0 disables both
      show_grid?: boolean
      show_ticks?: boolean
      tick_format?: string // d3-format spec applied to fractions in [0, 1]
      color_scale?: ColorScale // value_range defaults to the extent of all color_values
      // ColorBar props for the color_values scale, shown below the triangle; null hides it
      color_bar?: Partial<ComponentProps<typeof ColorBar>> | null
      legend?: LegendConfig | null // series legend props; null hides it
      show_legend?: boolean
      // Hover tooltip: a snippet of the point replaces the default content, false hides it
      tooltip?: TooltipProp<TernaryPointProps<Metadata>>
      // Called when a marker is clicked or activated by keyboard
      on_point_click?: (
        data: TernaryPointProps<Metadata> & { event: MouseEvent | KeyboardEvent },
      ) => void
      // Called when a marker is hovered or focused, with null once it is left
      on_point_hover?: (
        data:
          | (TernaryPointProps<Metadata> & { event: MouseEvent | FocusEvent | KeyboardEvent })
          | null,
      ) => void
      header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
      controls_extra?: Snippet
    } = $props()

  let [width, height] = $state([0, 0])
  let wrapper: HTMLDivElement | undefined = $state()
  let svg_element: SVGSVGElement | null = $state(null)
  let colorbar_size = $state({ width: 0, height: 0 })

  // Hover state is indices only: the payload follows new data and closes once the point is gone
  type PointKey = { series_idx: number; point_idx: number }
  let hover_key = $state<PointKey | null>(null)
  let hover_pos = $state({ x: 0, y: 0 })
  // Keyboard focus anchors at the marker, where there is no pointer glyph to dodge
  let hover_at_pointer = $state(false)
  let legend_hover_idx = $state<number | null>(null)
  // Legend choices are separate from immutable series data.
  const legend_vis = create_legend_visibility<TernarySeries<Metadata>>(
    () => series,
    () => hidden_series,
    (next) => (hidden_series = next),
  )
  let series: TernarySeries<Metadata>[] = $derived(legend_vis.resolve(series_in))
  const is_visible = (series_idx: number): boolean => series[series_idx]?.visible !== false

  const series_color = (series_idx: number): string =>
    series[series_idx]?.color ?? plot_color(series_idx)
  const series_label = (series_idx: number): string =>
    series[series_idx]?.label ?? `Series ${series_idx + 1}`

  // Every point of every series, validated and placed in the unit triangle. An invalid triple
  // fails the whole plot with a message in place of the chart rather than dropping data.
  interface PlacedPoint {
    series_idx: number
    point_idx: number
    fractions: Vec3
    xy: Vec2 // unit triangle coordinates
    color_value: number | null
    style: PointStyle
  }
  // `point_style` is one style for the series or one per point
  const style_at = (srs: TernarySeries<Metadata>, point_idx: number): PointStyle =>
    (Array.isArray(srs.point_style) ? srs.point_style[point_idx] : srs.point_style) ?? {}
  // a NaN color value has no color: fall back to the series color like null does
  const color_value_at = (srs: TernarySeries<Metadata>, point_idx: number): number | null => {
    const value = srs.color_values?.[point_idx]
    return typeof value === `number` && Number.isFinite(value) ? value : null
  }
  let placed = $derived.by(() => {
    try {
      const groups = series_in.map((srs, series_idx) =>
        srs.points.map((triple, point_idx): PlacedPoint => {
          const fractions = ternary_fractions(
            triple,
            `${srs.label ?? `Series ${series_idx + 1}`} point ${point_idx + 1}`,
          )
          return {
            series_idx,
            point_idx,
            fractions,
            xy: ternary_to_xy(fractions),
            color_value: color_value_at(srs, point_idx),
            style: style_at(srs, point_idx),
          }
        }),
      )
      return { groups, error: null }
    } catch (err) {
      return { groups: [] as PlacedPoint[][], error: to_error(err).message }
    }
  })
  const visible_points = $derived(
    placed.groups.flatMap((points, idx) => (is_visible(idx) ? points : [])),
  )
  // Line-only series need no per-point DOM blocks or keyboard stops.
  const rendered = $derived(
    placed.groups.flatMap((points, idx) =>
      is_visible(idx) && draws_points(idx) ? points : [],
    ),
  )

  // Only the bounds are needed; avoid allocating one array per colored point.
  const color_extent = $derived.by((): Vec2 => {
    let min = Infinity
    let max = -Infinity
    for (const { color_value } of visible_points) {
      if (color_value === null) continue
      if (color_value < min) min = color_value
      if (color_value > max) max = color_value
    }
    return [min, max]
  })
  let color_bar_visible = $derived(color_bar !== null && color_extent[0] <= color_extent[1])
  let color_ramp = $derived(resolve_color_scale(color_scale, color_extent))
  const point_color = (point: PlacedPoint): string =>
    point.color_value === null
      ? series_color(point.series_idx)
      : color_ramp.color_fn(point.color_value)

  let pad = $derived(filter_padding(padding, DEFAULT_PADDING))
  let inner_width = $derived(Math.max(0, width - pad.l - pad.r))
  let colorbar_space = $derived(color_bar_visible ? colorbar_size.height + COLOR_BAR_GAP : 0)
  let inner_height = $derived(Math.max(0, height - pad.t - pad.b - colorbar_space))
  let layout = $derived(ternary_layout(inner_width, inner_height))
  // Corner pixels in the order of `labels`: right, top, left
  let corners = $derived(TRIANGLE_VERTICES.map((vertex) => layout.to_px(vertex)))
  let outline = $derived(corners.map(([px_x, px_y]) => `${px_x},${px_y}`).join(` `))
  let grid = $derived(show_grid || show_ticks ? ternary_grid_lines(grid_step) : [])
  const pixel = (point: PlacedPoint): Vec2 => layout.to_px(point.xy)
  // the markers sit inside the padded <g>; tooltip and legend are positioned in svg pixels
  const svg_pixel = (point: PlacedPoint): { x: number; y: number } => {
    const [px_x, px_y] = pixel(point)
    return { x: pad.l + px_x, y: pad.t + px_y }
  }
  const same_point = (key: PointKey | null, point: PlacedPoint): boolean =>
    key?.series_idx === point.series_idx && key.point_idx === point.point_idx
  const is_hovered = (point: PlacedPoint): boolean => same_point(hover_key, point)

  // Lines connect each visible series directly from its ordered point group.
  let line_paths = $derived(
    series.flatMap((srs, series_idx) => {
      if (!is_visible(series_idx) || !has_marker(srs, `line`, `points`)) return []
      const points = (placed.groups[series_idx] ?? []).map(pixel)
      if (points.length < 2) return []
      const line_style = srs.line_style ?? {}
      return [
        {
          d: points.map(([px_x, px_y], idx) => `${idx ? `L` : `M`}${px_x} ${px_y}`).join(``),
          series_idx,
          stroke: line_style.color ?? series_color(series_idx),
          stroke_width: line_style.width ?? 1.5,
          dash: line_style.dash,
        },
      ]
    }),
  )
  const draws_points = (series_idx: number): boolean =>
    has_marker(series[series_idx], `points`, `points`)

  const point_props = (point: PlacedPoint): TernaryPointProps<Metadata> => {
    const srs = series[point.series_idx]
    return {
      series_idx: point.series_idx,
      point_idx: point.point_idx,
      series_id: srs.id ?? point.series_idx,
      series_label: series_label(point.series_idx),
      amounts: srs.points[point.point_idx],
      fractions: point.fractions,
      color: point_color(point),
      color_value: point.color_value,
      metadata: Array.isArray(srs.metadata)
        ? (srs.metadata[point.point_idx] as Metadata | undefined)
        : (srs.metadata as Metadata | undefined),
    }
  }
  const hover_idx = $derived(hover_key ? rendered.findIndex(is_hovered) : -1)
  const hover_info = $derived(hover_idx < 0 ? null : point_props(rendered[hover_idx]))
  clear_stale_hover(() => hover_key && !hover_info, clear_hover)
  // The tooltip: the hovered point where it was hovered, unless a click pinned one (see
  // TooltipPin) when on_point_click leaves the click free
  const pin = new TooltipPin<PointKey>({
    key: ({ series_idx, point_idx }) => `${series_idx}:${point_idx}`,
    enabled: () => tooltip !== false && !on_point_click,
  })
  const tip_anchor = pin.anchored(() => ({ ...hover_pos, at_pointer: hover_at_pointer }))
  const pinned_idx = $derived(pin.value ? rendered.findIndex(pin.is) : -1)
  const tip_info = $derived.by(() => {
    if (!pin.value) return hover_info
    return pinned_idx < 0 ? null : point_props(rendered[pinned_idx])
  })
  clear_stale_hover(() => pin.value && !tip_info, pin.unpin)
  const accessible_label = (point: PlacedPoint): string =>
    `${series_label(point.series_idx)}: ${labels
      .map((label, idx) => `${label} = ${format_value(point.fractions[idx], tick_format)}`)
      .join(`, `)}`

  // Marker style as drawn, shared by the SVG and canvas paths so they can't drift
  const marker_style = (point: PlacedPoint) => ({
    radius: 4,
    ...point.style,
    fill: point.style.fill ?? point_color(point),
  })
  // Highlight rings animate, so those markers stay SVG nodes in canvas mode
  const needs_svg = ({ style }: PlacedPoint): boolean =>
    Boolean(style.is_highlighted && style.highlight_effect)
  // Past CANVAS_MARKER_THRESHOLD markers paint on one canvas like ScatterPlot's. Null when
  // markers stay SVG: below the threshold or a paint canvas can't parse (e.g. a CSS variable).
  // Hover and click resolve the nearest marker through `hits`, not per-point DOM targets.
  type HitItem = { cx: number; cy: number; idx: number }
  const canvas_layer = $derived.by(
    (): { markers: CanvasMarker[]; hits: SpatialIndex<HitItem> } | null => {
      if (rendered.length <= CANVAS_MARKER_THRESHOLD) return null
      const markers: CanvasMarker[] = []
      const items: HitItem[] = []
      let max_radius = 0
      for (const [idx, point] of rendered.entries()) {
        const style = marker_style(point)
        const stroke = style.stroke ?? `transparent`
        if (!canvas_safe_color(style.fill) || !canvas_safe_color(stroke)) return null
        const { x: cx, y: cy } = svg_pixel(point)
        items.push({ cx, cy, idx })
        max_radius = Math.max(max_radius, style.radius)
        if (needs_svg(point)) continue
        // ScatterPoint's SVG defaults
        markers.push({
          cx,
          cy,
          radius: style.radius,
          symbol_type: style.symbol_type,
          symbol_size: style.symbol_size ?? undefined,
          fill: style.fill,
          fill_opacity: style.fill_opacity ?? 1,
          stroke,
          stroke_width: style.stroke_width ?? 1,
          stroke_opacity: style.stroke_opacity ?? 1,
          opacity: is_dimmed(point.series_idx) ? 0.25 : 1,
        })
      }
      // the same reach as an SVG marker's hit target
      return { markers, hits: build_spatial_index(items, max_radius + HIT_PADDING) }
    },
  )
  // [index into `rendered`, point] per SVG marker: all, or in canvas mode the highlighted ones
  // plus the hovered and pinned ones. Derived apart from the hover so pointer moves don't
  // rescan points.
  const static_svg_points = $derived(
    canvas_layer
      ? [...rendered.entries()].filter(([, point]) => needs_svg(point))
      : [...rendered.entries()],
  )
  const svg_points = $derived.by(() => {
    if (!canvas_layer) return static_svg_points
    const lit_idxs = new Set([hover_idx, pinned_idx])
    const extra = [...lit_idxs]
      .filter((idx) => idx >= 0 && !needs_svg(rendered[idx]))
      .map((idx): [number, PlacedPoint] => [idx, rendered[idx]])
    return extra.length ? [...static_svg_points, ...extra] : static_svg_points
  })

  const marker_canvas = create_marker_canvas(() => ({
    markers: canvas_layer?.markers ?? [],
    width,
    height,
  }))

  const point_from_event = (event: Event): PlacedPoint | null => {
    const svg_idx = closest_data_idx(event, `data-ternary-idx`, svg_element)
    if (svg_idx !== null) return rendered[svg_idx] ?? null
    const pointer = canvas_layer && pointer_pos(event, svg_element)
    if (!canvas_layer || !pointer) return null
    return rendered[query_nearest(canvas_layer.hits, pointer)?.idx ?? -1] ?? null
  }

  // Hover follows the cursor; keyboard focus (no cursor) anchors at the marker. Same
  // point as before only moves the anchor, the callback does not re-fire.
  function handle_hover(
    event: MouseEvent | FocusEvent | KeyboardEvent,
    point = point_from_event(event),
  ) {
    if (!point) return clear_hover()
    hovered = true
    const cursor = pointer_pos(event, svg_element)
    hover_at_pointer = Boolean(cursor)
    hover_pos = cursor ?? svg_pixel(point)
    if (is_hovered(point)) return
    hover_key = { series_idx: point.series_idx, point_idx: point.point_idx }
    on_point_hover?.({ ...point_props(point), event })
  }

  function clear_hover() {
    if (!hover_key) return
    hover_key = null
    hovered = false
    on_point_hover?.(null)
  }

  function handle_click(event: MouseEvent | KeyboardEvent, point = point_from_event(event)) {
    if (point) on_point_click?.({ ...point_props(point), event })
    pin.toggle(point && hover_key)
  }

  const roving = create_roving_focus({ container: () => svg_element, items: () => svg_points })

  function handle_keydown(event: KeyboardEvent) {
    if (event.key === `Escape` && pin.unpin()) return event.preventDefault()
    if (roving.handle_keydown(event) || !is_activation_key(event)) return
    event.preventDefault()
    handle_click(event)
  }

  // Canvas markers have no node to focus, so in canvas mode the svg is one tab stop and the
  // arrows walk `rendered` like ScatterPlot's cursor: its point becomes the hovered one and is
  // announced. Apart from hover_key, so the pointer sweeping over markers announces nothing.
  let kbd_key = $state<PointKey | null>(null)
  const kbd_idx = $derived(
    kbd_key ? rendered.findIndex((point) => same_point(kbd_key, point)) : -1,
  )
  const live_message = $derived(kbd_idx < 0 ? `` : accessible_label(rendered[kbd_idx]))
  function handle_canvas_keydown(event: KeyboardEvent) {
    if (event.target !== svg_element || event.defaultPrevented || is_modifier_chord(event))
      return
    if (event.key === `Escape` && pin.unpin()) return event.preventDefault()
    if (event.key === `Escape` && kbd_key) {
      kbd_key = null
      clear_hover()
    } else if (kbd_idx >= 0 && is_activation_key(event)) handle_click(event, rendered[kbd_idx])
    else {
      const next = step_point_cursor(event.key, kbd_idx < 0 ? null : kbd_idx, rendered.length)
      if (next === null) return
      const { series_idx, point_idx } = rendered[next]
      kbd_key = { series_idx, point_idx }
      handle_hover(event, rendered[next])
    }
    event.preventDefault()
  }

  // Legend: one entry per series, toggling hides the series
  let legend_data = $derived(
    build_legend_items(series, (srs, series_idx) => ({
      symbol_type: style_at(srs, 0).symbol_type ?? `Circle`,
      symbol_color: series_color(series_idx),
      line_color: has_marker(srs, `line`, `points`)
        ? (srs.line_style?.color ?? series_color(series_idx))
        : undefined,
      line_dash: srs.line_style?.dash,
    })),
  )
  let legend_visible = $derived(resolve_legend_visibility(show_legend, legend, series.length))
  const is_dimmed = (series_idx: number): boolean =>
    legend_hover_idx !== null && legend_hover_idx !== series_idx

  // <text> placement per edge (tick labels below the bottom edge, beside the slanted ones) and
  // per corner (component labels: right, top, left); dx/dy nudge them clear of the triangle
  const tick_text_attrs = [
    { 'text-anchor': `middle`, 'dominant-baseline': `hanging` },
    { 'text-anchor': `start`, 'dominant-baseline': `middle` },
    { 'text-anchor': `end`, 'dominant-baseline': `middle` },
  ] as const
  const corner_text_attrs = [
    { dx: 8, 'text-anchor': `start`, 'dominant-baseline': `middle` },
    { dy: -10, 'text-anchor': `middle`, 'dominant-baseline': `auto` },
    { dx: -8, 'text-anchor': `end`, 'dominant-baseline': `middle` },
  ] as const

  const export_sources = {
    ...svg_sources(() => svg_element),
    csv: csv_source(() => ({
      header: [`series`, ...labels, `color_value`],
      rows: visible_points.map((point) => [
        series_label(point.series_idx),
        ...point.fractions,
        point.color_value,
      ]),
    })),
  }
</script>

<ChartShell
  empty={!series_in.some((srs) => srs.points.length)}
  chart_class="ternary"
  css_prefix="ternary"
  bind:wrapper
  bind:width
  bind:height
  bind:fullscreen
  {fullscreen_toggle}
  {show_controls}
  {controls_toggle_props}
  {header_controls}
  {export_sources}
  export_filename={export_filename(`ternary`, labels.join(`-`))}
  {children}
  {live_message}
  {...rest}
>
  {#snippet controls(toggle_props, show_controls)}
    <TernaryControls
      {toggle_props}
      pane_props={controls_pane_props}
      {show_controls}
      bind:controls_open
      bind:grid_step
      bind:show_grid
      bind:show_ticks
    >
      {@render controls_extra?.()}
    </TernaryControls>
  {/snippet}

  {#snippet body()}
    <ViewerError message={placed.error} />
    <!-- Pointer picking reaches canvas markers here; keys go through the roving points group,
    or in canvas mode a cursor on the svg itself -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
    <svg
      bind:this={svg_element}
      role="application"
      aria-label={rest[`aria-label`] ?? `Ternary plot of ${labels.join(`, `)}`}
      tabindex={canvas_layer ? 0 : undefined}
      onkeydown={canvas_layer ? handle_canvas_keydown : undefined}
      onmousemove={handle_hover}
      onmouseleave={clear_hover}
      onclick={handle_click}
      style:cursor={canvas_layer && on_point_click && hover_info ? `pointer` : undefined}
    >
      <g transform="translate({pad.l}, {pad.t})">
        <polygon class="frame" points={outline} />
        {#if show_grid}
          <g class="grid">
            {#each grid as line (`${line.component}-${line.value}`)}
              {@const [coord_x_1, coord_y_1] = layout.to_px(line.from)}
              {@const [coord_x_2, coord_y_2] = layout.to_px(line.to)}
              <line x1={coord_x_1} y1={coord_y_1} x2={coord_x_2} y2={coord_y_2} />
            {/each}
          </g>
        {/if}
        {#if show_ticks}
          <g class="ticks">
            {#each grid as line (`${line.component}-${line.value}`)}
              {@const [tick_x, tick_y] = layout.to_px(line.from)}
              <!-- `outward` points away from the triangle in unit space, pixels grow down -->
              {@const [out_x, out_y] = [line.outward[0], -line.outward[1]]}
              <line x1={tick_x} y1={tick_y} x2={tick_x + 5 * out_x} y2={tick_y + 5 * out_y} />
              <text
                x={tick_x + 9 * out_x}
                y={tick_y + 9 * out_y}
                {...tick_text_attrs[line.component]}
                >{format_value(line.value, tick_format)}</text
              >
            {/each}
          </g>
        {/if}
        <g class="corner-labels">
          {#each labels as label, idx (idx)}
            {@const [corner_x, corner_y] = corners[idx]}
            <text x={corner_x} y={corner_y} {...corner_text_attrs[idx]}>{label}</text>
          {/each}
        </g>

        <g class="lines" fill="none">
          {#each line_paths as path (path.series_idx)}
            <path
              d={path.d}
              stroke={path.stroke}
              stroke-width={path.stroke_width}
              stroke-dasharray={path.dash}
              style:opacity={is_dimmed(path.series_idx) ? 0.25 : 1}
            />
          {/each}
        </g>

        {#if canvas_layer}
          <!-- Below the SVG overlay markers; pointer events stay on the parent SVG -->
          <foreignObject
            x={-pad.l}
            y={-pad.t}
            {width}
            {height}
            pointer-events="none"
            {@attach marker_canvas}
          ></foreignObject>
        {/if}

        <!-- One delegated handler set for every marker: targets resolve via their
        data-ternary-idx attribute (index into `rendered`), canvas markers via `hits` -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <g
          class="points"
          role="group"
          onfocusin={(event) => {
            roving.focusin(event)
            handle_hover(event)
          }}
          onfocusout={(event) => focus_left(event, svg_element) && clear_hover()}
          onkeydown={handle_keydown}
        >
          {#each svg_points as [flat_idx, point] (`${point.series_idx}-${point.point_idx}`)}
            {@const [px_x, px_y] = pixel(point)}
            {@const key = roving_key(point.series_idx, point.point_idx)}
            <ScatterPoint
              x={px_x}
              y={px_y}
              style={{
                ...marker_style(point),
                cursor: on_point_click ? `pointer` : undefined,
              }}
              is_hovered={pin.lit(point, hover_key)}
              is_dimmed={is_dimmed(point.series_idx)}
              hit_padding={HIT_PADDING}
              data-ternary-idx={flat_idx}
              role={on_point_click ? `button` : `img`}
              tabindex={roving.tabindex(key)}
              {...{ [ROVING_ATTR]: key }}
              aria-label={accessible_label(point)}
            />
          {/each}
        </g>
      </g>
    </svg>

    {#if tip_info && tooltip !== false}
      {@const { at_pointer, ...pos } = tip_anchor.current}
      <PlotTooltip
        {...pos}
        offset={{ x: 10, y: 5 }}
        avoid_cursor={at_pointer}
        constrain_to={{ width, height }}
        fallback_size={{ width: 140, height: 60 }}
        bg_color={tip_info.color}
        pinned={pin.value !== null}
      >
        {#if tooltip}
          {@render tooltip(tip_info)}
        {:else}
          <strong>{tip_info.series_label}</strong>
          {#each labels as label, idx (idx)}
            <br /><TooltipValue
              {label}
              value={format_value(tip_info.fractions[idx], tick_format)}
            />
          {/each}
          {#if tip_info.color_value !== null}
            <br /><TooltipValue
              label={color_bar?.title ?? `value`}
              value={format_value_or_num(tip_info.color_value, color_bar?.tick_format)}
            />
          {/if}
        {/if}
      </PlotTooltip>
    {/if}

    {#if legend_visible}
      <InsetLegend
        {legend}
        measured={width > 0 && height > 0}
        plot_bounds={{ x: pad.l, y: pad.t, width: inner_width, height: inner_height }}
        points={visible_points.map(svg_pixel)}
        bind:hover_idx={legend_hover_idx}
        series_data={legend_data}
        on_toggle={legend_vis.on_toggle}
        on_double_click={legend_vis.on_double_click}
      />
    {/if}

    {#if color_bar_visible && color_bar}
      <ColorBar
        color_scale={color_ramp.color_scale}
        {...color_bar}
        style="position: absolute; bottom: {COLOR_BAR_GAP}px; left: 50%; transform: translateX(-50%); width: var(--ternary-colorbar-width, 40%); min-width: 120px; pointer-events: auto; {color_bar.style ??
          ``}"
        {@attach observe_size((size) => (colorbar_size = size))}
      />
    {/if}
  {/snippet}
</ChartShell>

<style>
  svg {
    width: var(--ternary-svg-width, 100%);
    height: var(--ternary-svg-height, 100%);
    flex: var(--ternary-svg-flex, 1);
    overflow: var(--ternary-svg-overflow, visible);
    fill: var(--text-color);
    font-size: var(--ternary-font-size, 11px);
  }
  .frame {
    fill: var(--ternary-fill, none);
    stroke: var(--ternary-frame-color, var(--text-color));
    stroke-width: var(--ternary-frame-width, 1);
  }
  .grid line {
    stroke: var(--ternary-grid-color, rgba(128, 128, 128, 0.35));
    stroke-width: var(--ternary-grid-width, 0.6);
    stroke-dasharray: var(--ternary-grid-dash, none);
  }
  .ticks line {
    stroke: var(--ternary-frame-color, var(--text-color));
    stroke-width: 1;
  }
  .ticks text {
    font-size: var(--ternary-tick-font-size, 10px);
    fill: var(--ternary-tick-color, var(--text-color));
  }
  .corner-labels text {
    font-size: var(--ternary-label-font-size, 13px);
    font-weight: var(--ternary-label-font-weight, 600);
  }
  .lines path {
    transition: opacity 0.15s ease;
  }
  .points :global([data-ternary-idx]:focus) {
    outline: none;
  }
  .points :global([data-ternary-idx]:focus > .marker) {
    stroke: var(--ternary-focus-stroke, var(--accent-color, #1976d2));
    stroke-width: 1.5px;
    stroke-opacity: 1;
    vector-effect: non-scaling-stroke;
  }
</style>
