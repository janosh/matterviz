<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import { plot_color } from '$lib/colors'
  import { TRIANGLE_VERTICES } from '$lib/convex-hull/barycentric-coords'
  import { StatusMessage } from 'svelte-widgets'
  import { format_value } from '$lib/labels'
  import { array_extent } from '$lib/math'
  import type { Vec2, Vec3 } from '$lib/math'
  import type { BasePlotProps, ColorBarScale, LegendConfig, PointStyle } from '$lib/plot'
  import { ColorBar, PlotLegend, PlotTooltip } from '$lib/plot'
  import ChartShell from '$lib/plot/core/components/ChartShell.svelte'
  import { resolve_color_ramp } from '$lib/plot/core/color-ramp'
  import {
    closest_data_idx,
    focus_left,
    is_activation_key,
    pointer_pos,
  } from '$lib/plot/core/interactions'
  import { compute_element_placement, filter_padding } from '$lib/plot/core/layout'
  import type { Sides } from '$lib/plot/core/layout'
  import { observe_size } from '$lib/plot/core/utils'
  import { create_chart_exporter } from '$lib/plot/core/utils/chart-export'
  import type { ChartExportFormat } from '$lib/plot/core/utils/chart-export'
  import { roving_key } from '$lib/plot/core/utils/roving-focus.svelte'
  import { create_roving_focus, ROVING_ATTR } from 'svelte-widgets/roving-focus'
  import {
    create_legend_visibility,
    resolve_legend_visibility,
  } from '$lib/plot/core/utils/series-visibility'
  import ScatterPoint from '$lib/plot/scatter/ScatterPoint.svelte'
  import type { TernaryPointProps, TernarySeries } from '$lib/plot/ternary/ternary'
  import {
    ternary_fractions,
    ternary_grid_lines,
    ternary_layout,
    ternary_to_xy,
  } from '$lib/plot/ternary/ternary'
  import TernaryControls from '$lib/plot/ternary/TernaryControls.svelte'
  import { to_error } from '$lib/utils'
  import type { ComponentProps, Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'

  // Room for the corner labels beside the bottom corners and above the apex, and for
  // the tick labels written outside each edge
  const DEFAULT_PADDING: Required<Sides> = { t: 30, b: 34, l: 50, r: 50 }
  const COLOR_BAR_GAP = 8

  let {
    series: series_in = $bindable([]),
    labels = [`A`, `B`, `C`],
    grid_step = $bindable(0.1),
    show_grid = $bindable(true),
    show_ticks = $bindable(true),
    tick_format = `.0%`,
    color_scale = `interpolateViridis`,
    color_range,
    color_bar = {},
    padding = DEFAULT_PADDING,
    legend = {},
    show_legend,
    tooltip,
    hovered = $bindable(false),
    on_point_click,
    on_point_hover,
    show_controls = $bindable(true),
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
      series?: TernarySeries<Metadata>[]
      // Component names at the right, top and left corner (the order of every triple)
      labels?: readonly [string, string, string]
      grid_step?: number // fraction between grid lines / ticks; 0 disables both
      show_grid?: boolean
      show_ticks?: boolean
      tick_format?: string // d3-format spec applied to fractions in [0, 1]
      color_scale?: ColorBarScale
      color_range?: Vec2 // defaults to the min/max of every series' color_values
      color_bar?: Partial<ComponentProps<typeof ColorBar>> | null
      legend?: LegendConfig | null
      show_legend?: boolean
      tooltip?: Snippet<[TernaryPointProps<Metadata>]>
      on_point_click?: (
        data: TernaryPointProps<Metadata> & { event: MouseEvent | KeyboardEvent },
      ) => void
      on_point_hover?: (
        data: (TernaryPointProps<Metadata> & { event: MouseEvent | FocusEvent }) | null,
      ) => void
      header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
      controls_extra?: Snippet
    } = $props()

  let [width, height] = $state([0, 0])
  let wrapper: HTMLDivElement | undefined = $state()
  let svg_element: SVGSVGElement | null = $state(null)
  let colorbar_size = $state({ width: 0, height: 0 })

  let hover_info = $state<TernaryPointProps<Metadata> | null>(null)
  let hover_pos = $state({ x: 0, y: 0 })
  // Keyboard focus anchors at the marker, where there is no pointer glyph to dodge
  let hover_at_pointer = $state(false)
  let legend_hover_idx = $state<number | null>(null)
  // Legend toggles write `visible` back into the bindable series prop, so the host sees
  // them and can still hide or show a series itself; see create_legend_visibility
  const legend_vis = create_legend_visibility<TernarySeries<Metadata>>(
    () => series,
    (next) => (series_in = next),
  )
  let series: TernarySeries<Metadata>[] = $derived(legend_vis.resolve(series_in))
  const is_visible = (series_idx: number): boolean => series[series_idx]?.visible !== false

  const series_color = (series_idx: number): string =>
    series[series_idx]?.color ?? plot_color(series_idx)
  const series_label = (series_idx: number): string =>
    series[series_idx]?.label ?? `Series ${series_idx + 1}`

  // Every point of every series, validated and placed in the unit triangle. An invalid
  // triple fails the whole plot with a message in place of the chart rather than
  // silently dropping data.
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
      const points = series.flatMap((srs, series_idx) =>
        srs.points.map((triple, point_idx): PlacedPoint => {
          const fractions = ternary_fractions(
            triple,
            `${series_label(series_idx)} point ${point_idx}`,
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
      return { points, error: null }
    } catch (err) {
      return { points: [] as PlacedPoint[], error: to_error(err).message }
    }
  })
  let rendered = $derived(placed.points.filter((point) => is_visible(point.series_idx)))

  // Color values of visible series decide whether a color bar shows and what it spans
  let color_values = $derived(
    rendered.flatMap((point) => (point.color_value === null ? [] : [point.color_value])),
  )
  let color_bar_visible = $derived(color_bar !== null && color_values.length > 0)
  let effective_color_range = $derived<Vec2>(color_range ?? array_extent(color_values))
  let color_ramp = $derived(
    resolve_color_ramp(color_scale, effective_color_range, color_bar?.scale_type),
  )
  const point_color = (point: PlacedPoint): string =>
    point.color_value === null
      ? series_color(point.series_idx)
      : color_ramp.color_fn(point.color_value)

  let pad = $derived(filter_padding(padding, DEFAULT_PADDING))
  let inner_width = $derived(Math.max(0, width - pad.l - pad.r))
  let inner_height = $derived(
    Math.max(
      0,
      height - pad.t - pad.b - (color_bar_visible ? colorbar_size.height + COLOR_BAR_GAP : 0),
    ),
  )
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
  const is_hovered = (point: PlacedPoint): boolean =>
    hover_info?.series_idx === point.series_idx && hover_info.point_idx === point.point_idx

  // Lines connect a series' points in order. Hidden series contribute no rendered points,
  // so they drop out on the length check rather than needing a visibility test.
  let line_paths = $derived(
    series.flatMap((srs, series_idx) => {
      if (!srs.markers?.includes(`line`)) return []
      const points = rendered.filter((point) => point.series_idx === series_idx).map(pixel)
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
    (series[series_idx]?.markers ?? `points`).includes(`points`)

  const point_props = (point: PlacedPoint): TernaryPointProps<Metadata> => {
    const srs = series[point.series_idx]
    return {
      series_idx: point.series_idx,
      point_idx: point.point_idx,
      series_id: srs?.id ?? point.series_idx,
      series_label: series_label(point.series_idx),
      amounts: srs?.points[point.point_idx] ?? [0, 0, 0],
      fractions: point.fractions,
      color: point_color(point),
      color_value: point.color_value,
      metadata: Array.isArray(srs?.metadata)
        ? (srs.metadata[point.point_idx] as Metadata | undefined)
        : (srs?.metadata as Metadata | undefined),
    }
  }
  const accessible_label = (point: PlacedPoint): string =>
    `${series_label(point.series_idx)}: ${labels
      .map((label, idx) => `${label} ${format_value(point.fractions[idx], tick_format)}`)
      .join(`, `)}`

  const point_from_event = (event: Event): PlacedPoint | null =>
    rendered[closest_data_idx(event, `data-ternary-idx`, svg_element) ?? -1] ?? null

  // Hover follows the cursor; keyboard focus (no cursor) anchors at the marker. Same
  // point as before only moves the anchor, the callback does not re-fire.
  function handle_hover(event: MouseEvent | FocusEvent) {
    const point = point_from_event(event)
    if (!point) return clear_hover()
    hovered = true
    const cursor = pointer_pos(event, svg_element)
    hover_at_pointer = Boolean(cursor)
    hover_pos = cursor ?? svg_pixel(point)
    if (is_hovered(point)) return
    hover_info = point_props(point)
    on_point_hover?.({ ...hover_info, event })
  }

  function clear_hover() {
    if (!hover_info) return
    hover_info = null
    hovered = false
    on_point_hover?.(null)
  }

  function handle_click(event: MouseEvent | KeyboardEvent) {
    const point = point_from_event(event)
    if (point) on_point_click?.({ ...point_props(point), event })
  }

  const roving = create_roving_focus({
    container: () => svg_element,
    items: () => rendered,
  })

  function handle_keydown(event: KeyboardEvent) {
    if (roving.handle_keydown(event)) return
    if (!is_activation_key(event)) return
    event.preventDefault()
    handle_click(event)
  }

  // Legend: one entry per series, toggling hides the series
  let legend_element = $state<HTMLDivElement | undefined>()
  let legend_data = $derived(
    series.map((srs, series_idx) => ({
      series_idx,
      label: series_label(series_idx),
      visible: is_visible(series_idx),
      display_style: {
        symbol_type: style_at(srs, 0).symbol_type ?? `Circle`,
        symbol_color: series_color(series_idx),
        line_color: srs.markers?.includes(`line`)
          ? (srs.line_style?.color ?? series_color(series_idx))
          : undefined,
        line_dash: srs.line_style?.dash,
      },
    })),
  )
  let legend_visible = $derived(resolve_legend_visibility(show_legend, legend, series.length))
  let legend_placement = $derived.by(() => {
    if (!legend_visible || !width || !height) return null
    return compute_element_placement({
      plot_bounds: { x: pad.l, y: pad.t, width: inner_width, height: inner_height },
      element: legend_element,
      element_size: { width: 120, height: 60 },
      axis_clearance: legend?.axis_clearance,
      exclude_rects: [],
      points: rendered.map(svg_pixel),
    })
  })
  const is_dimmed = (series_idx: number): boolean =>
    legend_hover_idx !== null && legend_hover_idx !== series_idx

  // Text placement per edge (tick labels: below the bottom edge, beside the slanted
  // edges) and per corner (component labels: right, top, left), spread onto the <text>
  // elements - dx/dy nudge the corner labels clear of the triangle
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

  const export_chart = (format: ChartExportFormat) =>
    create_chart_exporter(
      {
        svg_element,
        title_config: { text: `ternary` },
        axes: { x: { label: labels.join(`-`) }, y: {} },
      },
      () => ({
        header: [`series`, ...labels, `color_value`],
        rows: rendered.map((point) => [
          series_label(point.series_idx),
          ...point.fractions,
          point.color_value,
        ]),
      }),
    )(format)
</script>

<ChartShell
  chart_class="ternary"
  css_prefix="ternary"
  bind:wrapper
  bind:width
  bind:height
  bind:fullscreen
  {fullscreen_toggle}
  {controls_toggle_props}
  {header_controls}
  {children}
  {...rest}
>
  {#snippet controls(toggle_props)}
    <TernaryControls
      {toggle_props}
      pane_props={controls_pane_props}
      bind:show_controls
      bind:controls_open
      bind:grid_step
      bind:show_grid
      bind:show_ticks
      on_export={export_chart}
    >
      {@render controls_extra?.()}
    </TernaryControls>
  {/snippet}

  {#snippet body()}
    {#if placed.error}
      <StatusMessage message={placed.error} type="error" style="margin: auto 1em" />
    {/if}
    <svg
      bind:this={svg_element}
      role="application"
      aria-label={rest[`aria-label`] ?? `Ternary plot of ${labels.join(`, `)}`}
      onmouseleave={clear_hover}
    >
      <g transform="translate({pad.l}, {pad.t})">
        <polygon class="frame" points={outline} />
        {#if show_grid}
          <g class="grid">
            {#each grid as line (`${line.component}-${line.value}`)}
              {@const [x1, y1] = layout.to_px(line.from)}
              {@const [x2, y2] = layout.to_px(line.to)}
              <line {x1} {y1} {x2} {y2} />
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

        <!-- One delegated handler set for every marker: targets resolve via their
        data-ternary-idx attribute (index into `rendered`) -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <g
          class="points"
          role="group"
          onmousemove={handle_hover}
          onmouseleave={clear_hover}
          onfocusin={(event) => {
            roving.focusin(event)
            handle_hover(event)
          }}
          onfocusout={(event) => focus_left(event, svg_element) && clear_hover()}
          onclick={handle_click}
          onkeydown={handle_keydown}
        >
          {#each rendered as point, flat_idx (`${point.series_idx}-${point.point_idx}`)}
            {#if draws_points(point.series_idx)}
              {@const [px_x, px_y] = pixel(point)}
              {@const key = roving_key(point.series_idx, point.point_idx)}
              <ScatterPoint
                x={px_x}
                y={px_y}
                style={{
                  radius: 4,
                  ...point.style,
                  fill: point.style.fill ?? point_color(point),
                  cursor: on_point_click ? `pointer` : undefined,
                }}
                is_hovered={is_hovered(point)}
                is_dimmed={is_dimmed(point.series_idx)}
                hit_padding={4}
                data-ternary-idx={flat_idx}
                role={on_point_click ? `button` : `img`}
                tabindex={roving.tabindex(key)}
                {...{ [ROVING_ATTR]: key }}
                aria-label={accessible_label(point)}
              />
            {/if}
          {/each}
        </g>
      </g>
    </svg>

    {#if hover_info}
      <PlotTooltip
        x={hover_pos.x}
        y={hover_pos.y}
        offset={{ x: 10, y: 5 }}
        avoid_cursor={hover_at_pointer}
        constrain_to={{ width, height }}
        fallback_size={{ width: 140, height: 60 }}
        bg_color={hover_info.color}
      >
        {#if tooltip}
          {@render tooltip(hover_info)}
        {:else}
          <strong>{hover_info.series_label}</strong>
          {#each labels as label, idx (idx)}
            <br />{label}: {format_value(hover_info.fractions[idx], tick_format)}
          {/each}
          {#if hover_info.color_value !== null}
            <br />{color_bar?.title ?? `value`}: {format_value(hover_info.color_value)}
          {/if}
        {/if}
      </PlotTooltip>
    {/if}

    {#if legend_visible}
      {@const legend_left = legend_placement?.x ?? pad.l + 10}
      {@const legend_top = legend_placement?.y ?? pad.t + 10}
      <PlotLegend
        bind:root_element={legend_element}
        {...legend}
        series_data={legend_data}
        on_toggle={legend?.on_toggle ?? legend_vis.on_toggle}
        on_double_click={legend_vis.on_double_click}
        on_item_hover={(item) =>
          (legend_hover_idx = item != null && item.series_idx >= 0 ? item.series_idx : null)}
        style={`position: absolute; left: ${legend_left}px; top: ${legend_top}px; pointer-events: auto; ${
          legend?.style ?? ``
        }`}
      />
    {/if}

    {#if color_bar_visible && color_bar}
      <ColorBar
        scale={color_scale}
        range={effective_color_range}
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
</style>
