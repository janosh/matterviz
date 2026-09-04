<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import { create_chart_exporter, series_to_csv_rows } from '$lib/plot/core/utils/chart-export'
  import type { D3InterpolateName } from '$lib/colors'
  import { format_value_or_num } from '$lib/labels'
  import { sanitize_html } from '$lib/sanitize'
  import type {
    AxisLoadError,
    BarHandlerProps,
    BarMode,
    BarSeries,
    BarStyle,
    BasePlotProps,
    ColorScaleConfig,
    DataLoaderFn,
    InternalPoint,
    LayerZIndex,
    LegendConfig,
    LegendItem,
    LineStyle,
    Orientation,
    PanConfig,
    PlotConfig,
    RefLine,
    RefLineEvent,
    SizeScaleConfig,
    UserContentProps,
  } from '$lib/plot'
  import { BarPlotControls, ScatterPoint } from '$lib/plot'
  import CartesianFrame from '$lib/plot/core/components/CartesianFrame.svelte'
  import PatternDefs from '$lib/plot/core/components/PatternDefs.svelte'
  import PlotAxes from '$lib/plot/core/components/PlotAxes.svelte'
  import PlotLegendLayer from '$lib/plot/core/components/PlotLegendLayer.svelte'
  import ReferenceLinesLayer from '$lib/plot/core/components/ReferenceLinesLayer.svelte'
  import type { MarginalSeriesInput, MarginalsProp } from '$lib/plot/core/marginals'
  import { normalize_marginals } from '$lib/plot/core/marginals'
  import type { AxisChangeState } from '$lib/plot/core/axis-utils'
  import {
    category_tick_labels,
    create_axis_loader,
    merge_secondary_axes,
  } from '$lib/plot/core/axis-utils'
  import { create_cartesian_frame } from '$lib/plot/core/cartesian-frame.svelte'
  import type { FacetLayoutContext } from '$lib/plot/core/facets'
  import {
    create_legend_visibility,
    resolve_legend_visibility,
  } from '$lib/plot/core/utils/series-visibility'
  import {
    create_focus_exit,
    get_relative_coords,
    is_activation_key,
  } from '$lib/plot/core/interactions'
  import { roving_key } from '$lib/plot/core/utils/roving-focus.svelte'
  import { create_roving_focus, ROVING_ATTR } from 'svelte-widgets/roving-focus'
  import { assign_axes } from '$lib/plot/core/axis-assignment'
  import type { ObstacleSeries } from '$lib/plot/core/decorations'
  import { clip_bar, with_obstacle_frame } from '$lib/plot/core/decorations'
  import { index_ref_lines } from '$lib/plot/core/reference-line'
  import {
    collect_scale_values,
    create_axis_scales,
    create_color_scale,
    create_size_scale,
    log_floor_scale,
  } from '$lib/plot/core/scales'
  import { DEFAULT_MARKERS, SCALE_DEFAULTS } from '$lib/plot/core/types'
  import { build_legend_items, first_point_style } from '$lib/plot/core/data-transform'
  import { DEFAULTS } from '$lib/settings'
  import { clamp01 } from '$lib/utils'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { create_category_display } from '$lib/plot/core/display.svelte'
  import PlotTooltip from '$lib/plot/core/components/PlotTooltip.svelte'
  import { bar_path } from '$lib/plot/core/svg'
  import { resolve_pattern } from '$lib/plot/core/patterns'
  import { unique_id } from '$lib/plot/core/utils'
  import ZeroLines from '$lib/plot/core/components/ZeroLines.svelte'
  import {
    compute_bar_auto_ranges,
    compute_group_info,
    compute_stacked_offsets,
    normalize_categorical,
  } from './data'
  import { compute_bar_rect, compute_line_points, nearest_line_point } from './geometry'
  import type { LineSeriesPoint as BarLineSeriesPoint } from './geometry'

  // Handler props for line marker events (extends BarHandlerProps with point-specific data)
  interface LineMarkerHandlerProps extends BarHandlerProps<Metadata> {
    point: InternalPoint<Metadata>
  }

  // Extended point type with computed screen coordinates (used internally for rendering)
  type LineSeriesPoint = BarLineSeriesPoint<Metadata>

  let {
    series: series_in = $bindable([]),
    orientation = $bindable(`vertical`),
    mode = $bindable(`overlay`),
    x_axis = $bindable({}),
    x2_axis: x2_axis_prop = $bindable({}),
    y_axis = $bindable({}),
    y2_axis: y2_axis_prop = $bindable({}),
    // Clone so controls / categorical sync never mutate shared DEFAULTS.
    display = $bindable({ ...DEFAULTS.plot.display }),
    range_padding = 0,
    padding = {},
    title,
    legend = {},
    show_legend,
    bar = {},
    line = {},
    tooltip,
    user_content,
    hovered = $bindable(false),
    on_bar_click,
    on_bar_hover,
    // Line marker props (matching ScatterPlot)
    color_scale = SCALE_DEFAULTS.color,
    size_scale = SCALE_DEFAULTS.size,
    on_point_click,
    on_point_hover,
    ref_lines = $bindable([]),
    on_ref_line_click,
    on_ref_line_hover,
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    controls_toggle_props,
    controls_pane_props,
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    children,
    header_controls,
    controls_extra,
    data_loader,
    on_axis_change,
    on_error,
    pan = {},
    marginals = false,
    facet_layout,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `title`> &
    BasePlotProps &
    PlotConfig & {
      series?: BarSeries<Metadata>[]
      // Component-specific props
      orientation?: Orientation
      mode?: BarMode
      legend?: LegendConfig | null
      show_legend?: boolean
      bar?: BarStyle
      line?: LineStyle
      tooltip?: Snippet<[BarHandlerProps<Metadata>]>
      user_content?: Snippet<[UserContentProps]>
      header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
      controls_extra?: Snippet<
        [{ orientation: Orientation; mode: BarMode } & Required<PlotConfig>]
      >
      on_bar_click?: (
        data: BarHandlerProps<Metadata> & { event: MouseEvent | KeyboardEvent },
      ) => void
      on_bar_hover?: (
        data:
          | (BarHandlerProps<Metadata> & { event: MouseEvent | FocusEvent | KeyboardEvent })
          | null,
      ) => void
      // Line marker props (matching ScatterPlot)
      color_scale?: ColorScaleConfig | D3InterpolateName
      size_scale?: SizeScaleConfig
      on_point_click?: (
        data: LineMarkerHandlerProps & { event: MouseEvent | KeyboardEvent },
      ) => void
      on_point_hover?: (
        data:
          | (LineMarkerHandlerProps & {
              event: MouseEvent | FocusEvent | KeyboardEvent
            })
          | null,
      ) => void
      ref_lines?: RefLine[]
      on_ref_line_click?: (event: RefLineEvent) => void
      on_ref_line_hover?: (event: RefLineEvent | null) => void
      // Interactive axis props
      data_loader?: DataLoaderFn<Metadata, BarSeries<Metadata>>
      on_axis_change?: (
        axis: `x` | `x2` | `y` | `y2`,
        key: string,
        new_series: BarSeries<Metadata>[],
      ) => void
      on_error?: (error: AxisLoadError) => void
      pan?: PanConfig
      marginals?: MarginalsProp
      facet_layout?: FacetLayoutContext
    } = $props()

  // Legend toggles write back into the bindable series prop; see create_legend_visibility
  const legend_vis = create_legend_visibility(
    () => series,
    (next) => (series_in = next),
    (srs) => (vertical ? srs.y_axis : srs.x_axis),
  )
  let series: BarSeries<Metadata>[] = $derived(legend_vis.resolve(series_in))

  const vertical = $derived(orientation === `vertical`)
  let bar_state = $derived({ ...DEFAULTS.bar.bar, ...bar })
  let line_state = $derived({ ...DEFAULTS.bar.line, ...line })
  let { y2: y2_axis, x2: x2_axis } = $derived(merge_secondary_axes(y2_axis_prop, x2_axis_prop))

  const plot_axes = $derived({ x: x_axis, x2: x2_axis, y: y_axis, y2: y2_axis })

  const frame = create_cartesian_frame({
    axes: () => plot_axes,
    auto_ranges: () => auto_ranges,
    has_x2: () => show_x2,
    has_y2: () => show_y2,
    padding: () => padding,
    title: () => title,
    obstacles: () => obstacles_norm,
    legend: () => legend,
    legend_visible: () => should_show_legend,
    legend_items: () => legend_data,
    marginals: () => resolved_marginals,
    ref_lines: () => indexed_ref_lines,
    pan: () => pan,
    facet_layout: () => facet_layout,
    // Categorical axes show one tick per category instead of generated numeric ticks
    tick_override: (axis) =>
      cat_tick_indices.length > 0 && axis === cat_axis ? cat_tick_indices : undefined,
    // Numeric x keeps its own ticks: measuring `undefined` would size the padding from the
    // numeric values instead of the user's custom labels
    measured_axes: () => ({
      [cat_axis]: {
        ...plot_axes[cat_axis],
        ticks: effective_cat_ticks ?? plot_axes[cat_axis].ticks,
      },
    }),
    clip_id_prefix: `chart-clip`,
  })

  // One tab stop for the whole mark group instead of one per bar/point: a 230-bar
  // spacegroup plot would otherwise take 230 presses to tab past, and the line-point
  // group was worse - its only tab stop was the *hovered* point, so with nothing
  // hovered every point was tabindex=-1 and keyboard users could not enter at all.
  const roving = create_roving_focus({
    container: () => frame.svg_element,
    items: () => [internal_series, frame.ranges.current],
  })

  // Interactive axis loading state
  let axis_loading = $state<`x` | `x2` | `y` | `y2` | null>(null)

  let indexed_ref_lines = $derived(index_ref_lines(ref_lines))

  // Horizontal bars take their value axis from the x axis they were assigned
  const HORIZONTAL_VALUE_AXIS = { x1: `y1`, x2: `y2` } as const
  // Assign visible series without an explicit value axis by unit/group. The value axis is
  // y/y2 for vertical bars and x/x2 for horizontal bars. Keep this as an effective copy so
  // legend toggles can reassign axes without mutating bound input series.
  const axis_assigned_series = $derived.by<BarSeries<Metadata>[]>(() => {
    const assignment_inputs = series.map((srs) => ({
      ...srs,
      y_axis: vertical ? srs.y_axis : srs.x_axis && HORIZONTAL_VALUE_AXIS[srs.x_axis],
    }))
    const assignment = assign_axes(assignment_inputs)
    if (assignment.status === `overflow`) {
      const axis_prop = vertical ? `y_axis` : `x_axis`
      throw new Error(
        `BarPlot cannot automatically assign visible value series in ${orientation} orientation: ${assignment.error.message}. Set ${axis_prop} explicitly or hide an axis group.`,
        { cause: assignment.error },
      )
    }
    return series.map((srs, series_idx) => {
      if (srs.visible === false) return srs
      const assigned_axis = assignment.assignments[series_idx]
      if (!assigned_axis) return srs
      return vertical
        ? { ...srs, y_axis: assigned_axis }
        : { ...srs, x_axis: assigned_axis === `y1` ? `x1` : `x2` }
    })
  })

  // === Categorical Normalization (string x values -> integer indices, see ./data) ===
  let { category_list, internal_series } = $derived(
    normalize_categorical(axis_assigned_series, x_axis.categories),
  )
  let cat_axis: `x` | `y` = $derived(orientation === `horizontal` ? `y` : `x`)

  // Keeps category-axis zeros off (and settings checkboxes in sync) across orientation flips
  const category_display = create_category_display(
    () => display,
    () => (category_list.length > 0 ? cat_axis : null),
  )

  // Keep every category available to the shared adaptive resolver. Its measured, bounded
  // thinning candidate replaces the former fixed 28px/category heuristic.
  let cat_tick_indices = $derived(category_list.map((_, idx) => idx))

  let visible_series = $derived(internal_series.filter((srs) => srs?.visible ?? true))

  // Per-series hatch/texture tiles resolved against the bar color (null: plain fill); ids
  // are scoped to this instance so several bar plots on a page never share <pattern>s
  const pattern_uid = unique_id(`bar`)
  let series_patterns = $derived(
    internal_series.map((srs) =>
      srs?.pattern && srs.render_mode !== `line`
        ? resolve_pattern(srs.pattern, srs.color ?? bar_state.color, pattern_uid)
        : null,
    ),
  )
  const has_finite_point = ({ x, y }: BarSeries<Metadata>) =>
    x.some((x_value, idx) => Number.isFinite(x_value) && Number.isFinite(y[idx]))
  // Only show secondary axes for series with at least one drawable bar. Horizontal bars put
  // their secondary values on x2, so y2 is never shown in that orientation.
  let show_x2 = $derived(
    visible_series.some((srs) => srs.x_axis === `x2` && has_finite_point(srs)),
  )
  let show_y2 = $derived(
    vertical && visible_series.some((srs) => srs.y_axis === `y2` && has_finite_point(srs)),
  )

  let auto_ranges = $derived(
    compute_bar_auto_ranges({
      visible_series,
      mode,
      orientation,
      range_padding,
      category_count: category_list.length,
      axes: plot_axes,
    }),
  )

  const should_show_legend = $derived(
    resolve_legend_visibility(show_legend, legend, series.length),
  )

  // Pixel scale for a value axis. On a log axis 0 (the bar baseline) has no finite pixel, so
  // values are clamped to the axis minimum: bars grow from the plot edge instead of vanishing
  // with NaN geometry, and sub-range bars collapse to the 1px floor at the edge.
  const value_scale_for = (
    axis: `x` | `x2` | `y` | `y2`,
    scales: typeof frame.scales = frame.scales,
  ): ((val: number) => number) =>
    log_floor_scale(scales[axis], plot_axes[axis].scale_type, frame.ranges.current[axis])

  // Obstacle field in normalized [0,1] plot coords (y=0 at top). Geometry is computed
  // against the decoration-independent base plot so outside padding cannot feed back into
  // the crowding decision. Bars contribute their grouped/stacked screen rectangles and
  // line series contribute sampled polylines.
  const obstacles_norm = $derived.by(() =>
    with_obstacle_frame(frame, visible_series.length > 0, ({ base_w, base_h }) => {
      const { width, height, effective_base_pad } = frame
      const obstacle_series: ObstacleSeries[] = []
      const obstacle_scales = create_axis_scales(
        plot_axes,
        frame.ranges.current,
        effective_base_pad,
        width,
        height,
      )
      internal_series.forEach((srs, series_idx) => {
        if (!(srs?.visible ?? true)) return
        const is_line = srs.render_mode === `line`
        const series_offsets = stacked_offsets[series_idx] ?? []
        const x_axis_key = srs.x_axis === `x2` ? `x2` : `x`
        const y_axis_key = srs.y_axis === `y2` ? `y2` : `y`
        const category_scale = vertical
          ? (value: number) => obstacle_scales[x_axis_key](value) - effective_base_pad.l
          : (value: number) => obstacle_scales.y(value) - effective_base_pad.t
        const value_px = value_scale_for(vertical ? y_axis_key : x_axis_key, obstacle_scales)
        const value_scale = vertical
          ? (value: number) => value_px(value) - effective_base_pad.t
          : (value: number) => value_px(value) - effective_base_pad.l

        if (is_line) {
          const line_points = srs.x.map((x_val, point_idx) => {
            const y_val = srs.y[point_idx]
            const x = vertical ? category_scale(x_val) / base_w : value_scale(y_val) / base_w
            const y = vertical ? value_scale(y_val) / base_h : category_scale(x_val) / base_h
            return { x: clamp01(x), y: clamp01(y) }
          })
          const markers = srs.markers ?? DEFAULT_MARKERS
          obstacle_series.push({
            points: line_points,
            draws_line: markers === `line` || markers === `line+points`,
          })
          return
        }

        srs.x.forEach((x_val, bar_idx) => {
          const value = srs.y[bar_idx]
          if (!Number.isFinite(x_val) || !Number.isFinite(value)) return
          const base = mode === `stacked` ? (series_offsets[bar_idx] ?? 0) : 0
          const bar_width_val = Array.isArray(srs.bar_width)
            ? (srs.bar_width[bar_idx] ?? 0.5)
            : (srs.bar_width ?? 0.5)
          const rect = compute_bar_rect({
            cat_val: x_val,
            val: value,
            base,
            bar_width_val,
            series_idx,
            mode,
            orientation,
            group_info,
            cat_scale: category_scale,
            val_scale: value_scale,
          })
          const { rect_x, rect_y, rect_w, rect_h } = rect
          // cross = across the bar, value = along it; sample both edges and the middle
          const [cross0, cross_len, value_start, value_len] = vertical
            ? [rect_x / base_w, rect_w / base_w, rect_y / base_h, rect_h / base_h]
            : [rect_y / base_h, rect_h / base_h, rect_x / base_w, rect_w / base_w]
          const value_end = value_start + value_len
          for (const frac of [0, 0.5, 1]) {
            const seg = clip_bar(vertical, cross0 + frac * cross_len, value_start, value_end)
            if (seg) obstacle_series.push(seg)
          }
        })
      })
      return obstacle_series
    }),
  )

  // Resolve marginals before decoration placement so both share one final plot box.
  const resolved_marginals = $derived(
    normalize_marginals(
      marginals,
      vertical ? { top: { type: `cdf` } } : { right: { type: `cdf` } },
    ),
  )
  const marginal_series = $derived<MarginalSeriesInput[]>(
    internal_series.map((srs) => ({
      x: vertical ? (srs?.x ?? []) : undefined,
      y: vertical ? undefined : (srs?.x ?? []),
      // magnitude weights so negative bars still yield a monotonic cumulative (CDF) marginal
      weight: srs?.y?.map((value) => Math.abs(value)) ?? [],
      color: srs?.color ?? (srs?.render_mode === `line` ? line_state.color : bar_state.color),
      label: srs?.label,
      visible: srs?.visible ?? true,
      x_axis: srs?.x_axis,
      y_axis: srs?.y_axis,
    })),
  )
  // Finite color/size values of the visible line series drive the shared color/size scales
  const scale_values = $derived(
    collect_scale_values(visible_series.filter((srs) => srs.render_mode === `line`)),
  )
  let color_scale_fn = $derived(create_color_scale(color_scale, scale_values.color_range))
  let size_scale_fn = $derived(create_size_scale(size_scale, scale_values.size_values))

  let effective_cat_ticks = $derived(
    category_tick_labels(category_list, plot_axes[cat_axis].ticks),
  )

  // Legend swatch: bars show a square, line series a line and/or their first point's symbol
  const legend_swatch = (srs: BarSeries<Metadata>): LegendItem[`display_style`] => {
    const series_color =
      srs.color ?? (srs.render_mode === `line` ? line_state.color : bar_state.color)
    if (srs.render_mode !== `line`) {
      return { symbol_type: `Square`, symbol_color: series_color, pattern: srs.pattern }
    }
    const series_markers = srs.markers ?? DEFAULT_MARKERS
    const point_style = first_point_style(srs)
    const first_color_value = srs.color_values?.[0]
    return {
      ...(series_markers === `line` || series_markers === `line+points`
        ? { line_color: series_color, line_dash: srs.line_style?.line_dash }
        : {}),
      ...(series_markers === `points` || series_markers === `line+points`
        ? {
            symbol_type: point_style?.symbol_type ?? DEFAULTS.scatter.symbol_type,
            symbol_color:
              first_color_value != null
                ? color_scale_fn(first_color_value)
                : (point_style?.fill ?? series_color),
          }
        : {}),
    }
  }
  let legend_data = $derived(build_legend_items(series, legend_swatch))

  // Tooltip state
  let hover_info = $state<BarHandlerProps<Metadata> | null>(null)

  function get_bar_data(
    series_idx: number,
    bar_idx: number,
    color: string,
  ): BarHandlerProps<Metadata> {
    const srs = internal_series[series_idx]
    const [x, y] = [srs.x[bar_idx], srs.y[bar_idx]]
    const [orient_x, orient_y] = orientation === `horizontal` ? [y, x] : [x, y]
    const metadata = Array.isArray(srs.metadata) ? srs.metadata[bar_idx] : srs.metadata
    const label = srs.labels?.[bar_idx] ?? null
    const active_y_axis = srs.y_axis ?? `y1`
    const active_x_axis = srs.x_axis ?? `x1`
    const category_label = category_list[x]
    return {
      x,
      y,
      orient_x,
      orient_y,
      x_axis: active_x_axis === `x2` ? x2_axis : x_axis,
      x2_axis,
      y_axis: active_y_axis === `y2` ? y2_axis : y_axis,
      y2_axis,
      metadata,
      color,
      label,
      series_idx,
      bar_idx,
      active_y_axis,
      active_x_axis,
      category_label,
    }
  }

  // Resolve a cursor event over a polyline overlay to its nearest vertex.
  function find_closest_point(
    evt: MouseEvent,
    points: LineSeriesPoint[],
  ): LineSeriesPoint | null {
    const svg_el = evt.target instanceof Element ? evt.target.closest(`svg`) : null
    const pointer = get_relative_coords(evt, svg_el)
    return pointer && nearest_line_point(points, pointer)
  }

  const line_point_fill = (pt: LineSeriesPoint, series_color: string): string =>
    pt.color_value != null
      ? color_scale_fn(pt.color_value)
      : (pt.point_style?.fill ?? series_color)

  // Accepts a FocusEvent too: keyboard focus is the keyboard's hover
  const handle_bar_hover =
    (series_idx: number, bar_idx: number, color: string) =>
    (event: MouseEvent | FocusEvent) => {
      hovered = true
      hover_info = get_bar_data(series_idx, bar_idx, color)
      on_bar_hover?.({ ...hover_info, event })
    }

  const clear_hover = () => {
    hover_info = null
    on_bar_hover?.(null)
  }

  const clear_hover_on_exit = create_focus_exit(() => frame.svg_element, clear_hover)
  const clear_point_hover = () => {
    hover_info = null
    on_point_hover?.(null)
  }

  // Stack offsets (only for bar series in stacked mode, grouped by the value axis)
  let stacked_offsets = $derived(compute_stacked_offsets(internal_series, mode, orientation))

  let group_info = $derived(compute_group_info(internal_series, mode))

  // State accessors for shared axis change handler
  // Secondary axes read the merged $derived (x2_axis/y2_axis) but write the raw $bindable props
  // (x2_axis_prop/y2_axis_prop) so library defaults aren't pushed into the parent's bound state
  const axis_state: AxisChangeState<BarSeries<Metadata>> = {
    axes: {
      x: { get: () => x_axis, set: (config) => (x_axis = config) },
      x2: { get: () => x2_axis, set: (config) => (x2_axis_prop = config) },
      y: { get: () => y_axis, set: (config) => (y_axis = config) },
      y2: { get: () => y2_axis, set: (config) => (y2_axis_prop = config) },
    },
    series: { get: () => series, set: (next) => (series_in = next) },
    loading: { get: () => axis_loading, set: (axis) => (axis_loading = axis) },
  }

  const { handle_axis_change, try_auto_load } = create_axis_loader(axis_state, () => ({
    data_loader,
    on_axis_change,
    on_error,
  }))
  $effect(try_auto_load)

  // === Export ===
  const handle_export = create_chart_exporter(frame, () =>
    series_to_csv_rows(
      internal_series.map((srs, series_idx) => ({
        label: srs?.label ?? `series ${series_idx + 1}`,
        x: srs?.x ?? [],
        y: srs?.y ?? [],
      })),
    ),
  )
</script>

{#snippet ref_lines_layer(z: LayerZIndex)}
  <ReferenceLinesLayer {frame} {z} on_click={on_ref_line_click} on_hover={on_ref_line_hover} />
{/snippet}

<CartesianFrame
  {frame}
  plot_class="bar-plot"
  css_prefix="barplot"
  css_var_fallbacks={{
    'font-weight': `var(--scatter-font-weight)`,
    'font-size': `var(--scatter-font-size)`,
  }}
  aria_label="Bar chart"
  bind:fullscreen
  {fullscreen_toggle}
  marginals={resolved_marginals}
  {marginal_series}
  marginal_tick_label={{
    [cat_axis === `x` ? `x1` : `y1`]: (pos: number) => category_list[Math.round(pos)],
  }}
  on_mouse_leave={() => {
    hovered = false
    clear_hover()
  }}
  {header_controls}
  {user_content}
  {children}
  {...rest}
>
  {#snippet layers()}
    {@const pad = frame.pad}
    <!-- Reference lines: below grid (rendered before axes which contain grid lines) -->
    {@render ref_lines_layer(`below-grid`)}

    <PlotAxes
      {frame}
      display={category_display.resolved}
      label_ticks={{ [cat_axis]: effective_cat_ticks }}
      {axis_loading}
      on_axis_change={handle_axis_change}
    />

    <!-- Chart content is clipped in two groups so reference lines can interleave
         at their z positions while staying outside the chart clip: each line still
         self-clips to the plot area inside ReferenceLine, only its annotation text
         is allowed to overflow the plot edges. -->
    <g clip-path="url(#{frame.clip_path_id})">
      <ZeroLines {frame} display={category_display.resolved} />
    </g>

    {@render ref_lines_layer(`below-lines`)}

    <!-- Continuous line/bar geometry stays clipped to the plot. Discrete line markers are
         range-filtered by center and may extend into the padding without losing part of the icon. -->
    <g>
      <defs><PatternDefs patterns={series_patterns} /></defs>
      {#each internal_series as srs, series_idx (srs?.id ?? series_idx)}
        {#if srs?.visible ?? true}
          {@const is_line = srs.render_mode === `line`}
          <g
            class={is_line ? `line-series` : `bar-series`}
            data-series-idx={series_idx}
            opacity={frame.hovered_series_idx !== null &&
            frame.hovered_series_idx !== series_idx
              ? 0.25
              : 1}
          >
            {#if is_line}
              <!-- Render as line -->
              {@const color = srs.color ?? line_state.color}
              {@const stroke_width = srs.line_style?.stroke_width ?? line_state.width}
              {@const line_dash = srs.line_style?.line_dash ?? `none`}
              {@const y_scale = srs.y_axis === `y2` ? frame.scales.y2 : frame.scales.y}
              {@const x_scale = srs.x_axis === `x2` ? frame.scales.x2 : frame.scales.x}
              {@const series_markers = srs.markers ?? DEFAULT_MARKERS}
              {@const show_line =
                series_markers === `line` || series_markers === `line+points`}
              {@const show_points =
                series_markers === `points` || series_markers === `line+points`}
              {@const points = compute_line_points({
                series: srs,
                series_idx,
                orientation,
                x_scale,
                y_scale,
                cat_y_scale: frame.scales.y,
              })}
              <!-- Use exact scale endpoints to avoid fractional-padding ULP gaps. -->
              {@const points_in_view = points.filter(
                ({ x, y }) =>
                  x >= pad.l &&
                  x <= frame.width - pad.r &&
                  y >= pad.t &&
                  y <= frame.height - pad.b,
              )}
              {@const polyline_str =
                show_line && points.length > 1
                  ? points.map((pt) => `${pt.x},${pt.y}`).join(` `)
                  : ``}
              {@const set_hover = (
                pt: LineSeriesPoint | null,
                evt: MouseEvent | FocusEvent,
              ) => {
                if (!pt) return clear_point_hover()
                hovered = true
                const fill = line_point_fill(pt, color)
                hover_info = get_bar_data(series_idx, pt.idx, fill)
                on_point_hover?.({ ...hover_info, event: evt, point: pt })
              }}
              {@const do_click = (pt: LineSeriesPoint, evt: MouseEvent | KeyboardEvent) => {
                const fill = line_point_fill(pt, color)
                const point_data = get_bar_data(series_idx, pt.idx, fill)
                on_point_click?.({ ...point_data, event: evt, point: pt })
              }}
              {#if polyline_str}
                <polyline
                  points={polyline_str}
                  fill="none"
                  stroke={color}
                  stroke-width={stroke_width}
                  stroke-dasharray={line_dash}
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  clip-path="url(#{frame.clip_path_id})"
                />
              {/if}
              {#if polyline_str && points_in_view.length > 0 && !show_points && (on_point_hover || on_point_click)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <polyline
                  points={polyline_str}
                  fill="none"
                  stroke="transparent"
                  stroke-width={Math.max(10, stroke_width * 3)}
                  stroke-linejoin="round"
                  stroke-linecap="round"
                  clip-path="url(#{frame.clip_path_id})"
                  style:cursor={on_point_click ? `pointer` : undefined}
                  onmousemove={(evt) =>
                    set_hover(find_closest_point(evt, points_in_view), evt)}
                  onmouseleave={clear_point_hover}
                  onclick={(evt) => {
                    const pt = find_closest_point(evt, points_in_view)
                    if (pt) do_click(pt, evt)
                  }}
                />
              {/if}
              {#if show_points}
                {@const clickable = Boolean(on_point_click)}
                {@const get_pt = (evt: Event) => {
                  const attr =
                    evt.target instanceof Element
                      ? evt.target.closest(`[data-bar-idx]`)?.getAttribute(`data-bar-idx`)
                      : null
                  return points_in_view.find((pt) => pt.idx === parseInt(attr ?? ``, 10))
                }}
                {@const leaving = (evt: MouseEvent | FocusEvent) =>
                  (evt.relatedTarget instanceof Element
                    ? evt.relatedTarget.closest(`.line-points`)
                    : null) !== evt.currentTarget}
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_mouse_events_have_key_events -->
                <g
                  class="line-points"
                  role="group"
                  onmouseover={(evt) => {
                    const pt = get_pt(evt)
                    if (pt) set_hover(pt, evt)
                  }}
                  onfocusin={(evt) => {
                    roving.focusin(evt)
                    const pt = get_pt(evt)
                    if (pt) set_hover(pt, evt)
                  }}
                  onmouseout={(evt) => {
                    if (leaving(evt)) set_hover(null, evt)
                  }}
                  onfocusout={(evt) => {
                    if (leaving(evt)) set_hover(null, evt)
                  }}
                  onclick={(evt) => {
                    const pt = get_pt(evt)
                    if (pt && clickable) do_click(pt, evt)
                  }}
                  onkeydown={(evt) => {
                    if (roving.handle_keydown(evt)) return
                    const pt = get_pt(evt)
                    if (pt && clickable && is_activation_key(evt)) {
                      evt.preventDefault()
                      do_click(pt, evt)
                    }
                  }}
                >
                  {#each points_in_view as pt (pt.idx)}
                    {@const sty = pt.point_style}
                    {@const fl = line_point_fill(pt, color)}
                    {@const rad =
                      pt.size_value != null
                        ? size_scale_fn(pt.size_value)
                        : (sty?.radius ?? 4)}
                    {@const hov =
                      hover_info?.series_idx === series_idx && hover_info?.bar_idx === pt.idx}
                    <ScatterPoint
                      x={pt.x}
                      y={pt.y}
                      is_hovered={hov}
                      style={{
                        ...sty,
                        radius: rad,
                        fill: fl,
                        stroke: sty?.stroke ?? `transparent`,
                        stroke_width: sty?.stroke_width ?? 1,
                        fill_opacity: sty?.fill_opacity ?? 1,
                        stroke_opacity: sty?.stroke_opacity ?? 1,
                        cursor: clickable ? `pointer` : undefined,
                      }}
                      hover={pt.point_hover ?? {}}
                      label={pt.point_label ?? {}}
                      offset={pt.point_offset ?? { x: 0, y: 0 }}
                      --point-fill-color={fl}
                      data-bar-idx={pt.idx}
                      {...{ [ROVING_ATTR]: roving_key(series_idx, pt.idx) }}
                      tabindex={roving.tabindex(roving_key(series_idx, pt.idx))}
                    />
                  {/each}
                </g>
              {/if}
            {:else}
              <!-- Render as bars -->
              {#each srs.x as x_val, bar_idx (bar_idx)}
                {@const y_val = srs.y[bar_idx]}
                {@const base =
                  mode === `stacked` ? (stacked_offsets[series_idx]?.[bar_idx] ?? 0) : 0}
                {@const color = srs.color ?? bar_state.color}
                {@const bar_width_val = Array.isArray(srs.bar_width)
                  ? (srs.bar_width[bar_idx] ?? 0.5)
                  : (srs.bar_width ?? 0.5)}
                {@const x_axis_key = srs.x_axis === `x2` ? `x2` : `x`}
                {@const [cat_scale, val_scale] = vertical
                  ? [
                      frame.scales[x_axis_key],
                      value_scale_for(srs.y_axis === `y2` ? `y2` : `y`),
                    ]
                  : [frame.scales.y, value_scale_for(x_axis_key)]}
                {@const { c0, c1, v0, v1, rect_x, rect_y, rect_w, rect_h } = compute_bar_rect({
                  cat_val: x_val,
                  val: y_val,
                  base,
                  bar_width_val,
                  series_idx,
                  mode,
                  orientation,
                  group_info,
                  cat_scale,
                  val_scale,
                })}
                {#if Number.isFinite(rect_x) && Number.isFinite(rect_y) && Number.isFinite(rect_w) && Number.isFinite(rect_h) && (vertical ? rect_h : rect_w) > 0}
                  <path
                    d={bar_path(
                      rect_x,
                      rect_y,
                      rect_w,
                      rect_h,
                      bar_state.border_radius ?? 0,
                      vertical,
                      vertical ? v1 > v0 : v1 < v0,
                    )}
                    fill={series_patterns[series_idx]?.url ?? color}
                    opacity={mode === `overlay` ? bar_state.opacity : 1}
                    stroke={bar_state.stroke_color}
                    stroke-opacity={bar_state.stroke_opacity}
                    stroke-width={bar_state.stroke_width}
                    clip-path="url(#{frame.clip_path_id})"
                    role="button"
                    tabindex={roving.tabindex(roving_key(series_idx, bar_idx))}
                    {...{ [ROVING_ATTR]: roving_key(series_idx, bar_idx) }}
                    aria-label={`bar ${bar_idx + 1} of ${srs.label ?? `series`}: ${
                      srs.y[bar_idx]
                    }`}
                    onfocusin={(evt) => {
                      roving.focusin(evt)
                      // Focus is the keyboard's hover: without this the tooltip never
                      // opens and on_bar_hover never fires for a keyboard user
                      handle_bar_hover(series_idx, bar_idx, color)(evt)
                    }}
                    onfocusout={clear_hover_on_exit}
                    style:cursor={on_bar_click ? `pointer` : undefined}
                    onmousemove={handle_bar_hover(series_idx, bar_idx, color)}
                    onmouseleave={clear_hover}
                    onclick={(evt) =>
                      on_bar_click?.({
                        ...get_bar_data(series_idx, bar_idx, color),
                        event: evt,
                      })}
                    onkeydown={(evt) => {
                      if (roving.handle_keydown(evt)) return
                      if (is_activation_key(evt)) {
                        evt.preventDefault()
                        on_bar_click?.({
                          ...get_bar_data(series_idx, bar_idx, color),
                          event: evt,
                        })
                      }
                    }}
                  />
                  {#if srs.labels?.[bar_idx]}
                    {@const label_x = vertical ? (c0 + c1) / 2 : Math.max(v0, v1) + 4}
                    {@const label_y = vertical
                      ? Math.max(0, Math.min(v0, v1) - 6)
                      : (c0 + c1) / 2}
                    {@const label_rotation = bar_state.label_rotation ?? 0}
                    <text
                      x={label_x}
                      y={label_y}
                      text-anchor={vertical
                        ? label_rotation > 0
                          ? `end`
                          : label_rotation < 0
                            ? `start`
                            : `middle`
                        : undefined}
                      dominant-baseline={vertical ? undefined : `central`}
                      transform={label_rotation
                        ? `rotate(${label_rotation}, ${label_x}, ${label_y})`
                        : undefined}
                      class="bar-label"
                    >
                      {srs.labels[bar_idx]}
                    </text>
                  {/if}
                {/if}
              {/each}
            {/if}
          </g>
        {/if}
      {/each}
    </g>

    {@render ref_lines_layer(`below-points`)}
    {@render ref_lines_layer(`above-all`)}
  {/snippet}

  {#snippet overlays()}
    <!-- Legend -->
    <PlotLegendLayer
      {frame}
      {legend}
      series_data={legend_data}
      active_series_idx={hover_info?.series_idx ?? frame.hovered_series_idx}
      on_toggle={legend_vis.on_toggle}
      on_group_toggle={legend_vis.on_group_toggle}
      on_double_click={legend_vis.on_double_click}
    />

    {#if hover_info && hovered}
      <!-- Anchor at the bar's drawn end: in stacked mode that is the value plus what sits below -->
      {@const stack_base =
        mode === `stacked`
          ? (stacked_offsets[hover_info.series_idx]?.[hover_info.bar_idx] ?? 0)
          : 0}
      {@const tip_x_key = hover_info.active_x_axis === `x2` ? `x2` : `x`}
      {@const tip_y_key = hover_info.active_y_axis === `y2` ? `y2` : `y`}
      <!-- Value axis via value_scale_for, like the bars: a non-positive value on a log axis
      draws at the 1px floor where the raw scale anchors the tooltip at NaN. The category axis
      keeps the bars' raw scale, so a log one cannot floor the anchor off its bar. -->
      {@const cx = (vertical ? frame.scales[tip_x_key] : value_scale_for(tip_x_key))(
        hover_info.orient_x + (orientation === `horizontal` ? stack_base : 0),
      )}
      {@const cy = (vertical ? value_scale_for(tip_y_key) : frame.scales.y)(
        hover_info.orient_y + (vertical ? stack_base : 0),
      )}
      <!-- avoid_cursor off: the anchor is the bar's drawn end, not the pointer -->
      <PlotTooltip
        x={cx}
        y={cy}
        avoid_cursor={false}
        offset={{ x: 10, y: 5 }}
        constrain_to={{ width: frame.width, height: frame.height }}
        exclusion_rects={frame.exclusion_rects}
        fallback_size={{ width: 140, height: 50 }}
        bg_color={hover_info.color}
      >
        {#if tooltip}
          {@render tooltip({ ...hover_info, fullscreen })}
        {:else}
          {@const series_label = series[hover_info.series_idx]?.label}
          {#if series.length > 1 && series_label}
            <div><strong>{series_label}</strong></div>
          {/if}
          <div>
            {@html sanitize_html(hover_info.x_axis.label || `x`)}: {(cat_axis === `x`
              ? hover_info.category_label
              : undefined) ??
              format_value_or_num(hover_info.orient_x, hover_info.x_axis.format)}
          </div>
          <div>
            {@html sanitize_html(hover_info.y_axis.label || `y`)}: {(cat_axis === `y`
              ? hover_info.category_label
              : undefined) ??
              format_value_or_num(hover_info.orient_y, hover_info.y_axis.format)}
          </div>
        {/if}
      </PlotTooltip>
    {/if}

    {#if show_controls}
      <BarPlotControls
        on_export={handle_export}
        toggle_props={controls_toggle_props}
        pane_props={controls_pane_props}
        bind:show_controls
        bind:controls_open
        bind:orientation
        bind:mode
        bind:x_axis
        bind:x2_axis={x2_axis_prop}
        bind:y_axis
        bind:y2_axis={y2_axis_prop}
        bind:display
        auto_x_range={auto_ranges.x}
        auto_x2_range={auto_ranges.x2}
        auto_y_range={auto_ranges.y}
        auto_y2_range={auto_ranges.y2}
        has_x2_points={show_x2}
        has_y2_points={show_y2}
        children={controls_extra}
      />
    {/if}
  {/snippet}
</CartesianFrame>

<style>
  .bar-label {
    fill: var(--text-color);
    font-size: 11px;
  }
</style>
