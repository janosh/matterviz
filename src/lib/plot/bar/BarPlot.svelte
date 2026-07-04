<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import type { D3InterpolateName } from '$lib/colors'
  import { format_value } from '$lib/labels'
  import { sanitize_html } from '$lib/sanitize'
  import { FullscreenToggle, set_fullscreen_bg } from '$lib/layout'
  import type { Point2D, Vec2 } from '$lib/math'
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
  import {
    BarPlotControls,
    compute_element_placement,
    PlotAxis,
    PlotLegend,
    PlotMarginals,
    ReferenceLine,
    ScatterPoint,
  } from '$lib/plot'
  import type { MarginalSeriesInput, MarginalsProp } from '$lib/plot/core/marginals'
  import {
    add_sides,
    marginal_axis,
    marginal_axis_presence,
    normalize_marginals,
    reserve_marginal_pad,
  } from '$lib/plot/core/marginals'
  import { type AxisChangeState, create_axis_loader } from '$lib/plot/core/axis-utils'
  import { create_placed_tween } from '$lib/plot/core/placed-tween.svelte'
  import { create_pan_zoom } from '$lib/plot/core/pan-zoom.svelte'
  import { create_legend_visibility } from '$lib/plot/core/utils/series-visibility'
  import {
    axis_ranges_equal,
    invert_rect_range,
    resolve_axis_ranges,
  } from '$lib/plot/core/interactions'
  import type { IndexedRefLine } from '$lib/plot/core/reference-line'
  import { group_ref_lines_by_z, index_ref_lines } from '$lib/plot/core/reference-line'
  import {
    create_axis_scales,
    create_color_scale,
    create_size_scale,
    generate_ticks,
    get_tick_label,
  } from '$lib/plot/core/scales'
  import { DEFAULT_MARKERS, SCALE_DEFAULTS } from '$lib/plot/core/types'
  import { DEFAULTS } from '$lib/settings'
  import { extent } from 'd3-array'
  import type { Snippet } from 'svelte'
  import { onDestroy, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { TweenOptions } from 'svelte/motion'
  import {
    build_obstacles_norm,
    clip_bar,
    has_explicit_position,
    measured_footprint,
    place_decorations,
    placed_coords,
  } from '$lib/plot/core/auto-place'
  import {
    calc_auto_padding,
    DEFAULT_PLOT_PADDING,
    filter_padding,
    LABEL_GAP_DEFAULT,
    y2_axis_label_x,
    measure_max_tick_width,
  } from '$lib/plot/core/layout'
  import PlotTooltip from '$lib/plot/core/components/PlotTooltip.svelte'
  import { bar_path } from '$lib/plot/core/svg'
  import { unique_id } from '$lib/plot/core/utils'
  import ZeroLines from '$lib/plot/core/components/ZeroLines.svelte'
  import ZoomRect from '$lib/plot/core/components/ZoomRect.svelte'
  import {
    compute_bar_auto_ranges,
    compute_group_info,
    compute_stacked_offsets,
    normalize_categorical,
  } from './data'
  import { compute_bar_rect, compute_line_points } from './geometry'
  import type { LineSeriesPoint as BarLineSeriesPoint } from './geometry'

  // Handler props for line marker events (extends BarHandlerProps with point-specific data)
  interface LineMarkerHandlerProps extends BarHandlerProps<Metadata> {
    point: InternalPoint<Metadata>
  }

  // Extended point type with computed screen coordinates (used internally for rendering)
  type LineSeriesPoint = BarLineSeriesPoint<Metadata>

  let {
    series = $bindable([]),
    orientation = $bindable(`vertical`),
    mode = $bindable(`overlay`),
    x_axis = $bindable({}),
    x2_axis: x2_axis_prop = $bindable({}),
    y_axis = $bindable({}),
    y2_axis: y2_axis_prop = $bindable({}),
    display = $bindable(DEFAULTS.bar.display),
    range_padding = 0.05,
    padding = DEFAULT_PLOT_PADDING,
    legend = {},
    show_legend,
    bar = {},
    line = {},
    tooltip,
    user_content,
    hovered = $bindable(false),
    change = () => {},
    on_bar_click,
    on_bar_hover,
    // Line marker props (matching ScatterPlot)
    color_scale = SCALE_DEFAULTS.color,
    size_scale = SCALE_DEFAULTS.size,
    point_tween,
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
    ...rest
  }: HTMLAttributes<HTMLDivElement> &
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
      change?: (data: BarHandlerProps<Metadata> | null) => void
      on_bar_click?: (
        data: BarHandlerProps<Metadata> & { event: MouseEvent | KeyboardEvent },
      ) => void
      on_bar_hover?: (
        data:
          | (BarHandlerProps<Metadata> & { event: MouseEvent | FocusEvent | KeyboardEvent })
          | null,
      ) => void
      // Line marker props (matching ScatterPlot)
      // Note: For line series with markers, BOTH on_bar_* AND on_point_* events fire.
      // Use on_point_* for marker-specific data (includes `point` with InternalPoint details)
      // or on_bar_* for backward compatibility with bar-style event handling.
      color_scale?: ColorScaleConfig | D3InterpolateName
      size_scale?: SizeScaleConfig
      point_tween?: TweenOptions<Point2D>
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
    } = $props()

  // Initialize bar, line, y2_axis with defaults - using $derived for reactivity
  let bar_state = $derived({ ...DEFAULTS.bar.bar, ...bar })
  let line_state = $derived({ ...DEFAULTS.bar.line, ...line })
  // Merge secondary-axis defaults as deriveds instead of assigning back into the
  // $bindable props (which would push library defaults into the parent's bound state)
  let y2_axis = $derived({
    format: ``,
    scale_type: `linear`,
    ticks: 5,
    label_shift: { x: 0, y: 0 }, // y2 title stays vertically centered (x pos set by y2_axis_label_x)
    tick: { label: { shift: { x: 0, y: 0 } } }, // base offset handled in rendering
    range: [null, null],
    ...y2_axis_prop,
  } as typeof y2_axis_prop)
  let x2_axis = $derived({
    format: ``,
    scale_type: `linear`,
    ticks: 5,
    label_shift: { x: 0, y: 40 },
    tick: { label: { shift: { x: 0, y: 0 } } },
    range: [null, null],
    ...x2_axis_prop,
  } as typeof x2_axis_prop)

  let [width, height] = $state([0, 0])
  let wrapper: HTMLDivElement | undefined = $state()
  let svg_element: SVGElement | null = $state(null)
  const clip_path_id = unique_id(`chart-clip`) // stable, collision-resistant (see unique_id)

  // Reference line hover state
  let hovered_ref_line_idx = $state<number | null>(null)

  // Interactive axis loading state
  let axis_loading = $state<`x` | `x2` | `y` | `y2` | null>(null)

  // Compute ref_lines with index and group by z-index (using shared utilities)
  let indexed_ref_lines = $derived(index_ref_lines(ref_lines))
  let ref_lines_by_z = $derived(group_ref_lines_by_z(indexed_ref_lines))

  // === Categorical Normalization (string x values -> integer indices, see ./data) ===
  let cat_norm = $derived(normalize_categorical(series, x_axis.categories))
  let category_list = $derived(cat_norm.category_list)
  let internal_series = $derived(cat_norm.internal_series)

  let category_indices = $derived(
    category_list.length > 0 ? category_list.map((_, idx) => idx) : null,
  )

  // Thin categorical tick labels + grid lines when many categories would overlap.
  // Bars still render for every category (this only reduces drawn ticks/labels/grid).
  let cat_tick_indices = $derived.by<number[]>(() => {
    if (!category_indices) return []
    const axis_px = (orientation === `horizontal` ? height : width) || 0
    const max_ticks = Math.max(1, Math.floor(axis_px / 28)) // ~28px per category label
    const step = Math.ceil(category_indices.length / max_ticks)
    return step <= 1 ? category_indices : category_indices.filter((_, idx) => idx % step === 0)
  })

  // Compute auto ranges from visible series
  let visible_series = $derived(internal_series.filter((srs) => srs?.visible ?? true))

  // Separate series by y-axis
  let y1_series = $derived(visible_series.filter((srs) => (srs.y_axis ?? `y1`) === `y1`))
  let y2_series = $derived(visible_series.filter((srs) => srs.y_axis === `y2`))
  let x2_series = $derived(visible_series.filter((srs) => srs.x_axis === `x2`))
  // Whether the secondary x2 (top) / y2 (right) axis actually renders: BarPlot only supports
  // them in vertical orientation. Derive once so ticks, padding, axis rendering, and marginal
  // placement stay in sync. (Data-existence checks below use the bare `*_series.length` instead.)
  let show_x2 = $derived(x2_series.length > 0 && orientation === `vertical`)
  let show_y2 = $derived(y2_series.length > 0 && orientation === `vertical`)

  let auto_ranges = $derived(
    compute_bar_auto_ranges({
      visible_series,
      y1_series,
      y2_series,
      x2_series,
      mode,
      orientation,
      range_padding,
      category_count: category_list.length,
      x_range: x_axis.range ?? [null, null],
      x_scale_type: x_axis.scale_type ?? `linear`,
      x_is_time: x_axis.format?.startsWith(`%`) || false,
      x2_range: x2_axis.range ?? [null, null],
      x2_scale_type: x2_axis.scale_type ?? `linear`,
      x2_is_time: x2_axis.format?.startsWith(`%`) || false,
      y_range: y_axis.range ?? [null, null],
      y_scale_type: y_axis.scale_type ?? `linear`,
      y2_range: y2_axis.range ?? [null, null],
      y2_scale_type: y2_axis.scale_type ?? `linear`,
    }),
  )

  // Initialize and current ranges
  let ranges = $state<{
    initial: { x: Vec2; x2: Vec2; y: Vec2; y2: Vec2 }
    current: { x: Vec2; x2: Vec2; y: Vec2; y2: Vec2 }
  }>({
    initial: { x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] },
    current: { x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] },
  })

  $effect(() => {
    // handle x_axis.range / x2_axis.range / y_axis.range / y2_axis.range changes
    // resolve_axis_ranges returns null for transient non-finite bounds (skip: writing
    // NaN breaks scales and, since NaN !== NaN, loops the effect)
    const next = resolve_axis_ranges(
      { x: x_axis, x2: x2_axis, y: y_axis, y2: y2_axis },
      auto_ranges,
    )
    if (!next) return
    // Only update if the initial (data-driven) ranges changed, not when user pans.
    // untrack the read of `ranges` so the assignment below can't re-trigger this effect
    // (reading + writing the same state otherwise causes effect_update_depth_exceeded).
    const init = untrack(() => ranges.initial)
    if (!axis_ranges_equal(init, next)) {
      ranges = { initial: { ...next }, current: { ...next } }
    }
  })

  // Layout: dynamic padding based on tick label widths
  // base_pad reserves space for tick labels/axis titles; pad (below) adds decoration reservations
  let base_pad = $derived(filter_padding(padding, DEFAULT_PLOT_PADDING))

  // Update padding when format or ticks change
  $effect(() => {
    const new_pad =
      width && height && ticks.y.length > 0
        ? calc_auto_padding({
            padding,
            default_padding: DEFAULT_PLOT_PADDING,
            x2_axis: { ...x2_axis, tick_values: ticks.x2 },
            y_axis: { ...y_axis, tick_values: ticks.y },
            y2_axis: { ...y2_axis, tick_values: ticks.y2 },
          })
        : filter_padding(padding, DEFAULT_PLOT_PADDING)
    // Expand right padding if y2 ticks are shown (only for vertical orientation)
    if (width && height && show_y2 && ticks.y2.length > 0) {
      // Need space for: tick shift + tick width + gap (30px) + label space (20px if present)
      // When ticks are inside, they don't contribute to padding
      const inside = y2_axis.tick?.label?.inside ?? false
      const tick_shift = inside ? 0 : (y2_axis.tick?.label?.shift?.x ?? 0) + 8
      const tick_width_contribution = inside ? 0 : tick_label_widths.y2_max
      const label_space = y2_axis.label ? 20 : 0
      new_pad.r = Math.max(new_pad.r, tick_shift + tick_width_contribution + 30 + label_space)
    }
    // Expand top padding if x2 ticks are shown (only for vertical orientation)
    if (width && height && show_x2 && ticks.x2.length > 0) {
      const inside = x2_axis.tick?.label?.inside ?? false
      const tick_shift = inside ? 0 : Math.abs(x2_axis.tick?.label?.shift?.y ?? 0) + 5
      const tick_height = inside ? 0 : 16
      const label_space = x2_axis.label ? 20 : 0
      new_pad.t = Math.max(new_pad.t, tick_shift + tick_height + 30 + label_space)
    }

    // Only update if padding actually changed (prevents infinite loop)
    if (
      base_pad.t !== new_pad.t ||
      base_pad.b !== new_pad.b ||
      base_pad.l !== new_pad.l ||
      base_pad.r !== new_pad.r
    )
      base_pad = new_pad
  })

  let legend_element = $state<HTMLDivElement | undefined>()
  const legend_footprint = $derived(
    measured_footprint(legend_element, { width: 120, height: 60 }),
  )
  const legend_has_explicit_pos = $derived(has_explicit_position(legend?.style))

  // Obstacle field in normalized [0,1] plot coords (y=0 at top). Each bar is modeled as a segment
  // from baseline to its tip so the legend can't hide inside a tall bar. Built from internal_series
  // (pad-independent) + ranges so the crowding decision can't see its own reservation.
  const obstacles_norm = $derived.by(() => {
    if (!width || !height || visible_series.length === 0) return []
    const base_w = width - base_pad.l - base_pad.r
    const base_h = height - base_pad.t - base_pad.b
    if (base_w <= 0 || base_h <= 0) return []
    const bars: { points: { x: number; y: number }[]; draws_line: boolean }[] = []
    const vertical = orientation === `vertical`
    internal_series.forEach((srs, series_idx) => {
      if (!(srs?.visible ?? true)) return
      const is_line = srs.render_mode === `line`
      const series_offsets = stacked_offsets[series_idx] ?? []
      const [ax0, ax1] = srs.x_axis === `x2` ? ranges.current.x2 : ranges.current.x
      const [vy0, vy1] = srs.y_axis === `y2` ? ranges.current.y2 : ranges.current.y
      const [cy0, cy1] = ranges.current.y
      const x_span = ax1 - ax0
      const y_span = vy1 - vy0
      const cy_span = cy1 - cy0
      if (!(x_span > 0) || !((vertical ? y_span : cy_span) > 0)) return
      srs.x.forEach((x_val, bar_idx) => {
        const base = !is_line && mode === `stacked` ? (series_offsets[bar_idx] ?? 0) : 0
        const value = base + srs.y[bar_idx]
        // vertical: category on x, value rises on y (inverted). horizontal: category on y, value on x
        const seg = vertical
          ? clip_bar(
              true,
              (x_val - ax0) / x_span,
              1 - (value - vy0) / y_span,
              1 - (base - vy0) / y_span,
            )
          : clip_bar(
              false,
              1 - (x_val - cy0) / cy_span,
              (value - ax0) / x_span,
              (base - ax0) / x_span,
            )
        if (seg) bars.push(seg)
      })
    })
    return build_obstacles_norm(bars, base_w, base_h)
  })

  // Move the legend to the bottom margin when no interior spot avoids the bars
  const decor = $derived.by(() =>
    place_decorations({
      base_pad,
      width,
      height,
      obstacles_norm,
      // gate on legend_element (the render signal) not legend_data, whose entries can read pad
      legend:
        legend != null &&
        (show_legend !== undefined ? show_legend : series.length > 1) &&
        legend_element != null &&
        !legend_has_explicit_pos
          ? { footprint: legend_footprint, clearance: legend?.axis_clearance }
          : null,
    }),
  )
  // Resolve marginals: a cumulative/Pareto CDF over the CATEGORY axis weighted by bar height.
  // Categories sit on x (vertical) or y (horizontal), so the default side and the value array
  // flip with orientation. The value axis carries no marginal (a bar's height isn't a sample).
  const marginal_is_vertical = $derived(orientation === `vertical`)
  const resolved_marginals = $derived(
    normalize_marginals(
      marginals,
      marginal_is_vertical ? { top: { type: `cdf` } } : { right: { type: `cdf` } },
    ),
  )
  const pad = $derived(add_sides(decor.pad, reserve_marginal_pad(resolved_marginals)))
  const marginal_series = $derived<MarginalSeriesInput[]>(
    internal_series.map((srs) => ({
      x: marginal_is_vertical ? (srs?.x ?? []) : undefined,
      y: marginal_is_vertical ? undefined : (srs?.x ?? []),
      // magnitude weights so negative bars still yield a monotonic cumulative (CDF) marginal
      weight: srs?.y?.map((value) => Math.abs(value)) ?? [],
      color:
        srs?.color ??
        (srs?.render_mode === `line` ? line_state.color : bar_state.color) ??
        `steelblue`,
      label: srs?.label,
      visible: srs?.visible ?? true,
      x_axis: srs?.x_axis,
      y_axis: srs?.y_axis,
    })),
  )
  const marginal_has_axis = $derived(marginal_axis_presence(show_x2, show_y2))
  const legend_auto_outside = $derived(decor.legend_outside)
  const legend_outside_x = $derived(decor.legend_pos.x)
  const legend_outside_y = $derived(decor.legend_pos.y)
  const chart_width = $derived(Math.max(1, width - pad.l - pad.r))
  const chart_height = $derived(Math.max(1, height - pad.t - pad.b))

  let scales = $derived(
    create_axis_scales(
      { x: x_axis, x2: x2_axis, y: y_axis, y2: y2_axis },
      ranges.current,
      pad,
      width,
      height,
    ),
  )

  // Compute plot center for point tweening origin
  let plot_center_x = $derived(pad.l + (width - pad.r - pad.l) / 2)
  let plot_center_y = $derived(pad.t + (height - pad.b - pad.t) / 2)

  // Compute color values from line series for color scaling (filter to numbers only)
  let all_color_values = $derived(
    visible_series
      .filter((srs: BarSeries<Metadata>) => srs.render_mode === `line`)
      .flatMap((srs: BarSeries<Metadata>) =>
        (srs.color_values ?? []).filter((val): val is number => typeof val === `number`),
      ),
  )

  // Create auto color range (safely handle empty arrays or undefined extent results)
  let auto_color_range: Vec2 = $derived.by(() => {
    if (all_color_values.length === 0) return [0, 1]
    const [min_val, max_val] = extent(all_color_values)
    return [min_val ?? 0, max_val ?? 1]
  })

  // All size values from line series (for size scale, filter to numbers only)
  let all_size_values = $derived(
    visible_series
      .filter((srs: BarSeries<Metadata>) => srs.render_mode === `line`)
      .flatMap((srs: BarSeries<Metadata>) =>
        [...(srs.size_values ?? [])].filter((val): val is number => typeof val === `number`),
      ),
  )

  // Color scale function (using shared utility)
  let color_scale_fn = $derived(create_color_scale(color_scale, auto_color_range))

  // Size scale function (using shared utility)
  let size_scale_fn = $derived(create_size_scale(size_scale, all_size_values))

  // Auto-generate tick labels for categorical data (unless user provides explicit ticks)
  // In vertical mode categories are on x-axis; in horizontal mode on y-axis
  let cat_axis = $derived(orientation === `horizontal` ? `y` : `x`)
  let effective_cat_ticks = $derived.by(() => {
    if (category_list.length === 0) return undefined
    // Only respect user ticks when they're a Record (custom label mapping),
    // not a number (tick count) or array (tick positions)
    const user_ticks = cat_axis === `x` ? x_axis.ticks : y_axis.ticks
    if (user_ticks != null && typeof user_ticks === `object` && !Array.isArray(user_ticks))
      return user_ticks
    return Object.fromEntries(category_list.map((cat, idx): [number, string] => [idx, cat]))
  })

  let ticks = $derived.by(() => {
    const axis_ticks = (
      axis: typeof x_axis,
      range: Vec2,
      scale: typeof scales.x,
      default_count: number,
      show = true,
    ) =>
      width && height && show
        ? generate_ticks(range, axis.scale_type ?? `linear`, axis.ticks, scale, {
            default_count,
          })
        : []
    // categorical axes show one tick per category instead of generated numeric ticks
    return {
      x:
        category_indices && cat_axis === `x` && width && height
          ? cat_tick_indices
          : axis_ticks(x_axis, ranges.current.x, scales.x, 8),
      y:
        category_indices && cat_axis === `y` && width && height
          ? cat_tick_indices
          : axis_ticks(y_axis, ranges.current.y, scales.y, 6),
      y2: axis_ticks(y2_axis, ranges.current.y2, scales.y2, 6, show_y2),
      x2: axis_ticks(x2_axis, ranges.current.x2, scales.x2, 8, show_x2),
    }
  })

  // Cache measured tick-label widths so expensive canvas text measurement
  // only runs when ticks/format change, not on every template rerender.
  let tick_label_widths = $derived({
    y_max: measure_max_tick_width(ticks.y, y_axis.format ?? ``),
    y2_max: measure_max_tick_width(ticks.y2, y2_axis.format ?? ``),
    x2_max: measure_max_tick_width(ticks.x2, x2_axis.format ?? ``),
  })

  // Shared pan/zoom/touch/drag-rect interaction controller
  const pan_zoom = create_pan_zoom({
    ranges: () => ranges.current,
    scale_type: (axis) =>
      ({ x: x_axis, x2: x2_axis, y: y_axis, y2: y2_axis })[axis].scale_type,
    plot_dims: () => ({ width: chart_width, height: chart_height }),
    pan: () => pan,
    set_range: (axis, range) => (ranges.current[axis] = range),
    svg: () => svg_element,
    on_rect_zoom: (start, current) => {
      // Update axis ranges to trigger reactivity and prevent effect from overriding
      const next_x = invert_rect_range(scales.x, start.x, current.x)
      if (!next_x) return
      x_axis = { ...x_axis, range: next_x }
      // gate x2/y2 on whether they actually render (show_x2/show_y2 also require vertical);
      // otherwise their [0, 1] sentinel scales would store a phantom range in the bindable prop
      const next_x2 = show_x2 ? invert_rect_range(scales.x2, start.x, current.x) : null
      if (next_x2) x2_axis_prop = { ...x2_axis_prop, range: next_x2 }
      const next_y = invert_rect_range(scales.y, start.y, current.y)
      if (next_y) y_axis = { ...y_axis, range: next_y }
      const next_y2 = show_y2 ? invert_rect_range(scales.y2, start.y, current.y) : null
      if (next_y2) y2_axis_prop = { ...y2_axis_prop, range: next_y2 }
    },
    on_reset: () => {
      // Reset zoom to initial ranges (undo any pan/zoom)
      ranges.current = {
        x: [...ranges.initial.x] as Vec2,
        x2: [...ranges.initial.x2] as Vec2,
        y: [...ranges.initial.y] as Vec2,
        y2: [...ranges.initial.y2] as Vec2,
      }
      // Also reset axis props so future data changes recalculate auto ranges
      x_axis = { ...x_axis, range: [null, null] }
      x2_axis_prop = { ...x2_axis_prop, range: [null, null] }
      y_axis = { ...y_axis, range: [null, null] }
      y2_axis_prop = { ...y2_axis_prop, range: [null, null] }
    },
  })
  onDestroy(() => pan_zoom.destroy())

  // Legend data and handlers
  let legend_data = $derived.by<LegendItem[]>(() =>
    series.map((srs: BarSeries<Metadata>, idx: number) => {
      const is_line = srs.render_mode === `line`
      const series_markers = srs.markers ?? DEFAULT_MARKERS
      const has_line = series_markers === `line` || series_markers === `line+points`
      const has_points = series_markers === `points` || series_markers === `line+points`
      const series_color = srs.color ?? (is_line ? line_state.color : bar_state.color)

      // Get point style for symbol color (handle array or single object)
      const first_point_style = Array.isArray(srs.point_style)
        ? srs.point_style[0]
        : srs.point_style
      const first_color_value = srs.color_values?.[0]
      const point_color =
        first_color_value != null
          ? color_scale_fn(first_color_value)
          : (first_point_style?.fill ?? series_color)

      if (is_line) {
        // Line series: show line and/or symbol based on markers
        return {
          series_idx: idx,
          label: srs.label ?? `Series ${idx + 1}`,
          visible: srs.visible ?? true,
          legend_group: srs.legend_group,
          display_style: {
            ...(has_line
              ? {
                  line_color: series_color,
                  line_dash: srs.line_style?.line_dash,
                }
              : {}),
            ...(has_points
              ? {
                  symbol_type: first_point_style?.symbol_type ?? DEFAULTS.scatter.symbol_type,
                  symbol_color: point_color,
                }
              : {}),
          },
        }
      }
      // Bar series: show square symbol
      return {
        series_idx: idx,
        label: srs.label ?? `Series ${idx + 1}`,
        visible: srs.visible ?? true,
        legend_group: srs.legend_group,
        display_style: {
          symbol_type: `Square` as const,
          symbol_color: series_color,
        },
      }
    }),
  )

  const legend_vis = create_legend_visibility(
    () => series,
    (next) => (series = next),
  )

  // Collect bar and line positions for legend placement
  let bar_points_for_placement = $derived.by(() => {
    if (!width || !height || visible_series.length === 0) return []

    return internal_series.flatMap((srs, series_idx) => {
      if (!(srs?.visible ?? true)) return []
      const is_line = srs.render_mode === `line`
      const series_offsets = stacked_offsets[series_idx] ?? []
      const use_y2 = srs.y_axis === `y2`
      const y_scale = use_y2 ? scales.y2 : scales.y
      const use_x2_pl = srs.x_axis === `x2`
      const x_scale_pl = use_x2_pl ? scales.x2 : scales.x
      return srs.x
        .map((x_val, bar_idx) => {
          const y_val = srs.y[bar_idx]
          const base = !is_line && mode === `stacked` ? (series_offsets[bar_idx] ?? 0) : 0
          const [bar_x, bar_y] =
            orientation === `vertical`
              ? [x_scale_pl(x_val), y_scale(base + y_val)]
              : [x_scale_pl(base + y_val), scales.y(x_val)]
          return { x: bar_x, y: bar_y }
        })
        .filter(({ x, y }) => isFinite(x) && isFinite(y))
    })
  })

  // Legend placement stability state (legend_element declared above for the auto-place block)
  let hovered_legend_series_idx = $state<number | null>(null)

  // Calculate best legend placement using continuous grid sampling
  let legend_placement = $derived.by(() => {
    const should_show = show_legend !== undefined ? show_legend : series.length > 1
    if (!should_show || !width || !height) return null

    const result = compute_element_placement({
      plot_bounds: { x: pad.l, y: pad.t, width: chart_width, height: chart_height },
      element: legend_element,
      element_size: { width: 120, height: 60 }, // fallback before first render
      axis_clearance: legend?.axis_clearance,
      exclude_rects: [],
      points: bar_points_for_placement,
    })

    return result
  })

  // Tweened legend coordinates with shared placement stability gating
  const legend_tween = create_placed_tween({
    placement: () => legend_placement,
    dims: () => ({ width, height }),
    responsive: () => legend?.responsive ?? false,
    element: () => legend_element,
    tween: () => legend?.tween,
  })

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
    const coords = {
      x,
      y,
      orient_x,
      orient_y,
      x_axis: active_x_axis === `x2` ? x2_axis : x_axis,
      x2_axis,
      y_axis: active_y_axis === `y2` ? y2_axis : y_axis,
      y2_axis,
    }
    return {
      ...coords,
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

  // Find the point closest to the cursor on a polyline overlay (O(n) scan).
  function find_closest_point(
    evt: MouseEvent,
    points: LineSeriesPoint[],
  ): LineSeriesPoint | null {
    const target = evt.target
    if (!(target instanceof Element)) return null
    const svg_el = target.closest(`svg`)
    if (!svg_el) return null
    const rect = svg_el.getBoundingClientRect()
    const mx = evt.clientX - rect.left
    const my = evt.clientY - rect.top
    let best: LineSeriesPoint | null = null
    let best_dist = Infinity
    for (const pt of points) {
      const dist = (pt.x - mx) ** 2 + (pt.y - my) ** 2
      if (dist < best_dist) {
        best_dist = dist
        best = pt
      }
    }
    return best
  }

  const line_point_fill = (pt: LineSeriesPoint, series_color: string): string =>
    pt.color_value != null
      ? color_scale_fn(pt.color_value)
      : (pt.point_style?.fill ?? series_color)

  const handle_bar_hover =
    (series_idx: number, bar_idx: number, color: string) => (event: MouseEvent) => {
      hovered = true
      hover_info = get_bar_data(series_idx, bar_idx, color)
      change(hover_info)
      on_bar_hover?.({ ...hover_info, event })
    }

  // Stack offsets (only for bar series in stacked mode, grouped by y-axis)
  let stacked_offsets = $derived(compute_stacked_offsets(internal_series, mode))

  // Calculate group positions for grouped mode (side-by-side bars)
  let group_info = $derived(compute_group_info(internal_series, mode))

  // Set theme-aware background when entering fullscreen
  $effect(() => {
    set_fullscreen_bg(wrapper, fullscreen, `--barplot-fullscreen-bg`)
  })

  // State accessors for shared axis change handler
  // Secondary axes read the merged $derived (x2_axis/y2_axis) but write the raw $bindable props
  // (x2_axis_prop/y2_axis_prop) so library defaults aren't pushed into the parent's bound state
  const axis_state: AxisChangeState<BarSeries<Metadata>> = {
    axes: {
      x: { get: () => x_axis, set: (config) => (x_axis = { ...x_axis, ...config }) },
      x2: {
        get: () => x2_axis,
        set: (config) => (x2_axis_prop = { ...x2_axis_prop, ...config }),
      },
      y: { get: () => y_axis, set: (config) => (y_axis = { ...y_axis, ...config }) },
      y2: {
        get: () => y2_axis,
        set: (config) => (y2_axis_prop = { ...y2_axis_prop, ...config }),
      },
    },
    series: { get: () => series, set: (next) => (series = next) },
    loading: { get: () => axis_loading, set: (axis) => (axis_loading = axis) },
  }

  // Shared handler + one-shot auto-load bound to this component's state
  const { handle_axis_change, try_auto_load } = create_axis_loader(axis_state, () => ({
    data_loader,
    on_axis_change,
    on_error,
  }))
  $effect(try_auto_load)
</script>

{#snippet ref_lines_layer(lines: IndexedRefLine[])}
  {#each lines as line (line.id ?? line.idx)}
    <ReferenceLine
      ref_line={line}
      line_idx={line.idx}
      x_min={line.x_axis === `x2` ? ranges.current.x2[0] : ranges.current.x[0]}
      x_max={line.x_axis === `x2` ? ranges.current.x2[1] : ranges.current.x[1]}
      y_min={line.y_axis === `y2` ? ranges.current.y2[0] : ranges.current.y[0]}
      y_max={line.y_axis === `y2` ? ranges.current.y2[1] : ranges.current.y[1]}
      x_scale={scales.x}
      x2_scale={scales.x2}
      y_scale={scales.y}
      y2_scale={scales.y2}
      {clip_path_id}
      hovered_line_idx={hovered_ref_line_idx}
      on_click={(event: RefLineEvent) => {
        line.on_click?.(event)
        on_ref_line_click?.(event)
      }}
      on_hover={(event: RefLineEvent | null) => {
        hovered_ref_line_idx = event?.line_idx ?? null
        line.on_hover?.(event)
        on_ref_line_hover?.(event)
      }}
    />
  {/each}
{/snippet}

<svelte:window
  onkeydown={(evt) => {
    if (evt.key === `Escape` && fullscreen) {
      evt.preventDefault()
      fullscreen = false
    }
    pan_zoom.on_window_key_down(evt)
  }}
  onkeyup={pan_zoom.on_window_key_up}
/>

<div
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class={[`bar-plot`, rest.class]}
  class:fullscreen
>
  {#if width && height}
    <div class="header-controls">
      {@render header_controls?.({ height, width, fullscreen })}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <svg
      bind:this={svg_element}
      role="application"
      aria-label={rest[`aria-label`] ??
        ([x_axis.label, y_axis.label].filter(Boolean).join(` vs `) || `Bar chart`)}
      tabindex="0"
      onfocusin={() => pan_zoom.set_focused(true)}
      onfocusout={() => pan_zoom.set_focused(false)}
      onmousedown={pan_zoom.on_mouse_down}
      ondblclick={pan_zoom.reset_view}
      onkeydown={pan_zoom.on_key_down}
      onmouseleave={() => {
        hovered = false
        hover_info = null
        change(null)
        on_bar_hover?.(null)
      }}
      onwheel={pan_zoom.on_wheel}
      ontouchstart={pan_zoom.on_touch_start}
      ontouchmove={pan_zoom.on_touch_move}
      ontouchend={pan_zoom.on_touch_end}
      ontouchcancel={pan_zoom.on_touch_end}
      style:cursor={pan_zoom.cursor}
    >
      <ZoomRect start={pan_zoom.drag_start} current={pan_zoom.drag_current} />

      <!-- User content (custom overlays, reference lines, etc.) -->
      {@render user_content?.({
        height,
        width,
        x_scale_fn: scales.x,
        x2_scale_fn: scales.x2,
        y_scale_fn: scales.y,
        y2_scale_fn: scales.y2,
        pad,
        x_range: ranges.current.x,
        x2_range: ranges.current.x2,
        y_range: ranges.current.y,
        y2_range: ranges.current.y2,
        fullscreen,
      })}

      <!-- Reference lines: below grid (rendered before axes which contain grid lines) -->
      {@render ref_lines_layer(ref_lines_by_z.below_grid)}

      <!-- X-axis -->
      <PlotAxis
        side="x"
        ticks={ticks.x}
        place={scales.x}
        axis={x_axis}
        domain={ranges.current.x}
        {pad}
        {width}
        {height}
        show_grid={display.x_grid}
        tick_label={(tick) =>
          get_tick_label(tick, cat_axis === `x` ? effective_cat_ticks : x_axis.ticks)}
        label_x={pad.l + chart_width / 2 + (x_axis.label_shift?.x ?? 0)}
        label_y={height - pad.b / 3 + (x_axis.label_shift?.y ?? 0)}
        axis_loading={axis_loading === `x`}
        on_axis_change={(key) => handle_axis_change(`x`, key)}
      />

      <!-- X2-axis (Top) -->
      <!-- Note: x2 axis is only supported for vertical orientation -->
      {#if show_x2}
        <PlotAxis
          side="x2"
          ticks={ticks.x2}
          place={scales.x2}
          axis={x2_axis}
          domain={ranges.current.x2}
          {pad}
          {width}
          {height}
          show_grid={display.x2_grid}
          tick_label={(tick) => get_tick_label(tick, x2_axis.ticks)}
          label_x={pad.l + chart_width / 2 + (x2_axis.label_shift?.x ?? 0)}
          label_y={Math.max(12, pad.t - (x2_axis.label_shift?.y ?? 40))}
          axis_loading={axis_loading === `x2`}
          on_axis_change={(key) => handle_axis_change(`x2`, key)}
        />
      {/if}

      <!-- Y-axis -->
      <PlotAxis
        side="y"
        ticks={ticks.y}
        place={scales.y}
        axis={y_axis}
        domain={ranges.current.y}
        {pad}
        {width}
        {height}
        show_grid={display.y_grid}
        tick_label={(tick) =>
          get_tick_label(tick, cat_axis === `y` ? effective_cat_ticks : y_axis.ticks)}
        label_x={Math.max(
          12,
          pad.l -
            (y_axis.tick?.label?.inside ? 0 : tick_label_widths.y_max) -
            LABEL_GAP_DEFAULT,
        ) + (y_axis.label_shift?.x ?? 0)}
        label_y={pad.t + chart_height / 2 + (y_axis.label_shift?.y ?? 0)}
        axis_loading={axis_loading === `y`}
        on_axis_change={(key) => handle_axis_change(`y`, key)}
      />

      <!-- Y2-axis (Right) -->
      <!-- Note: y2 axis is only supported for vertical orientation. Implementing x2 for horizontal mode requires additional complexity. -->
      {#if show_y2}
        <PlotAxis
          side="y2"
          ticks={ticks.y2}
          place={scales.y2}
          axis={y2_axis}
          domain={ranges.current.y2}
          {pad}
          {width}
          {height}
          show_grid={display.y2_grid}
          tick_label={(tick) => get_tick_label(tick, y2_axis.ticks)}
          label_x={y2_axis_label_x(y2_axis, width, pad.r, tick_label_widths.y2_max)}
          label_y={pad.t + chart_height / 2 + (y2_axis.label_shift?.y ?? 0)}
          axis_loading={axis_loading === `y2`}
          on_axis_change={(key) => handle_axis_change(`y2`, key)}
        />
      {/if}

      <!-- Define clip path for chart area -->
      <defs>
        <clipPath id={clip_path_id}>
          <rect x={pad.l} y={pad.t} width={chart_width} height={chart_height} />
        </clipPath>
      </defs>

      <!-- Chart content is clipped in two groups so reference lines can interleave
           at their z positions while staying outside the chart clip: each line still
           self-clips to the plot area inside ReferenceLine, only its annotation text
           is allowed to overflow the plot edges. -->
      <g clip-path="url(#{clip_path_id})">
        <ZeroLines
          {display}
          x_scale_fn={scales.x}
          x2_scale_fn={scales.x2}
          y_scale_fn={scales.y}
          y2_scale_fn={scales.y2}
          x_range={ranges.current.x}
          x2_range={ranges.current.x2}
          y_range={ranges.current.y}
          y2_range={ranges.current.y2}
          x_scale_type={x_axis.scale_type}
          x2_scale_type={x2_axis.scale_type}
          y_scale_type={y_axis.scale_type}
          y2_scale_type={y2_axis.scale_type}
          x_is_time={x_axis.format?.startsWith(`%`) ?? false}
          x2_is_time={x2_axis.format?.startsWith(`%`) ?? false}
          has_x2={show_x2}
          has_y2={show_y2}
          {width}
          {height}
          {pad}
        />
      </g>

      {@render ref_lines_layer(ref_lines_by_z.below_lines)}

      <!-- Bars and Lines -->
      <g clip-path="url(#{clip_path_id})">
        {#each internal_series as srs, series_idx (srs?.id ?? series_idx)}
          {#if srs?.visible ?? true}
            {@const is_line = srs.render_mode === `line`}
            <g
              class={is_line ? `line-series` : `bar-series`}
              data-series-idx={series_idx}
              opacity={hovered_legend_series_idx !== null &&
              hovered_legend_series_idx !== series_idx
                ? 0.25
                : 1}
            >
              {#if is_line}
                <!-- Render as line -->
                {@const color = srs.color ?? line_state.color ?? `steelblue`}
                {@const stroke_width = srs.line_style?.stroke_width ?? line_state.width ?? 2}
                {@const line_dash = srs.line_style?.line_dash ?? `none`}
                {@const use_y2 = srs.y_axis === `y2`}
                {@const y_scale = use_y2 ? scales.y2 : scales.y}
                {@const use_x2 = srs.x_axis === `x2`}
                {@const x_scale = use_x2 ? scales.x2 : scales.x}
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
                  cat_y_scale: scales.y,
                })}
                {@const polyline_str =
                  show_line && points.length > 1
                    ? points.map((pt) => `${pt.x},${pt.y}`).join(` `)
                    : ``}
                {#if polyline_str}
                  <polyline
                    points={polyline_str}
                    fill="none"
                    stroke={color}
                    stroke-width={stroke_width}
                    stroke-dasharray={line_dash}
                    stroke-linejoin="round"
                    stroke-linecap="round"
                  />
                {/if}
                {#if polyline_str && !show_points && (on_bar_hover || on_bar_click)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <polyline
                    points={polyline_str}
                    fill="none"
                    stroke="transparent"
                    stroke-width={Math.max(10, stroke_width * 3)}
                    stroke-linejoin="round"
                    stroke-linecap="round"
                    style:cursor={on_bar_click ? `pointer` : undefined}
                    onmousemove={(evt) => {
                      const pt = find_closest_point(evt, points)
                      if (!pt) return
                      hovered = true
                      const fill = line_point_fill(pt, color)
                      hover_info = get_bar_data(series_idx, pt.idx, fill)
                      change(hover_info)
                      on_bar_hover?.({ ...hover_info!, event: evt })
                    }}
                    onmouseleave={() => {
                      change(null)
                      hover_info = null
                      on_bar_hover?.(null)
                    }}
                    onclick={(evt) => {
                      const pt = find_closest_point(evt, points)
                      if (!pt) return
                      const fill = line_point_fill(pt, color)
                      const bar_data = get_bar_data(series_idx, pt.idx, fill)
                      on_bar_click?.({ ...bar_data, event: evt })
                    }}
                  />
                {/if}
                {#if show_points}
                  {@const clickable = on_bar_click || on_point_click}
                  {@const get_pt = (evt: Event) => {
                    const attr =
                      evt.target instanceof Element
                        ? evt.target.closest(`[data-bar-idx]`)?.getAttribute(`data-bar-idx`)
                        : null
                    return points.find((pt) => pt.idx === parseInt(attr ?? ``, 10))
                  }}
                  {@const set_hover = (
                    pt: LineSeriesPoint | null,
                    evt: MouseEvent | FocusEvent,
                  ) => {
                    if (pt) {
                      hovered = true
                      const fill = line_point_fill(pt, color)
                      hover_info = get_bar_data(series_idx, pt.idx, fill)
                      change(hover_info)
                    } else {
                      change(null)
                      hover_info = null
                    }
                    on_bar_hover?.(pt ? { ...hover_info!, event: evt } : null)
                    on_point_hover?.(pt ? { ...hover_info!, event: evt, point: pt } : null)
                  }}
                  {@const do_click = (
                    pt: LineSeriesPoint,
                    evt: MouseEvent | KeyboardEvent,
                  ) => {
                    const fill = line_point_fill(pt, color)
                    const bar_data = get_bar_data(series_idx, pt.idx, fill)
                    on_bar_click?.({ ...bar_data, event: evt })
                    on_point_click?.({ ...bar_data, event: evt, point: pt })
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
                      const pt = get_pt(evt)
                      if (pt && clickable && (evt.key === `Enter` || evt.key === ` `)) {
                        evt.preventDefault()
                        do_click(pt, evt)
                      }
                    }}
                  >
                    {#each points as pt (pt.idx)}
                      {@const sty = pt.point_style}
                      {@const fl = line_point_fill(pt, color)}
                      {@const rad =
                        pt.size_value != null
                          ? size_scale_fn(pt.size_value)
                          : (sty?.radius ?? 4)}
                      {@const hov =
                        hover_info?.series_idx === series_idx &&
                        hover_info?.bar_idx === pt.idx}
                      <ScatterPoint
                        x={pt.x}
                        y={pt.y}
                        is_hovered={hov}
                        {point_tween}
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
                        origin={{ x: plot_center_x, y: plot_center_y }}
                        --point-fill-color={fl}
                        data-bar-idx={pt.idx}
                        tabindex={clickable ? (hov ? 0 : -1) : undefined}
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
                  {@const color = srs.color ?? bar_state.color ?? `steelblue`}
                  {@const bar_width_val = Array.isArray(srs.bar_width)
                    ? (srs.bar_width[bar_idx] ?? 0.5)
                    : (srs.bar_width ?? 0.5)}
                  {@const is_vertical = orientation === `vertical`}
                  {@const x_scale_bar = srs.x_axis === `x2` ? scales.x2 : scales.x}
                  {@const [cat_scale, val_scale] = is_vertical
                    ? [x_scale_bar, srs.y_axis === `y2` ? scales.y2 : scales.y]
                    : [scales.y, x_scale_bar]}
                  {@const { c0, c1, v0, v1, rect_x, rect_y, rect_w, rect_h } =
                    compute_bar_rect({
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
                  {#if (is_vertical ? rect_h : rect_w) > 0}
                    <path
                      d={bar_path(
                        rect_x,
                        rect_y,
                        rect_w,
                        rect_h,
                        Math.min(bar_state.border_radius ?? 0, rect_w / 2, rect_h / 2),
                        is_vertical,
                      )}
                      fill={color}
                      opacity={mode === `overlay` ? bar_state.opacity : 1}
                      stroke={bar_state.stroke_color}
                      stroke-opacity={bar_state.stroke_opacity}
                      stroke-width={bar_state.stroke_width}
                      role="button"
                      tabindex="0"
                      aria-label={`bar ${bar_idx + 1} of ${srs.label ?? `series`}`}
                      style:cursor={on_bar_click ? `pointer` : undefined}
                      onmousemove={handle_bar_hover(series_idx, bar_idx, color)}
                      onmouseleave={() => {
                        hover_info = null
                        change(null)
                        on_bar_hover?.(null)
                      }}
                      onclick={(evt) =>
                        on_bar_click?.({
                          ...get_bar_data(series_idx, bar_idx, color),
                          event: evt,
                        })}
                      onkeydown={(evt) => {
                        if (evt.key === `Enter` || evt.key === ` `) {
                          evt.preventDefault()
                          on_bar_click?.({
                            ...get_bar_data(series_idx, bar_idx, color),
                            event: evt,
                          })
                        }
                      }}
                    />
                    {#if srs.labels?.[bar_idx]}
                      <text
                        x={is_vertical ? (c0 + c1) / 2 : Math.max(v0, v1) + 4}
                        y={is_vertical ? Math.max(0, Math.min(v0, v1) - 6) : (c0 + c1) / 2}
                        text-anchor={is_vertical ? `middle` : undefined}
                        dominant-baseline={is_vertical ? undefined : `central`}
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

      {@render ref_lines_layer(ref_lines_by_z.below_points)}
      {@render ref_lines_layer(ref_lines_by_z.above_all)}

      <!-- Marginal distribution strips -->
      <PlotMarginals
        marginals={resolved_marginals}
        series={marginal_series}
        {width}
        {height}
        {pad}
        has_axis={marginal_has_axis}
        axes={{
          x1: marginal_axis(
            scales.x,
            ranges.current.x,
            x_axis,
            cat_axis === `x` ? (pos) => category_list[Math.round(pos)] : undefined,
          ),
          x2: marginal_axis(scales.x2, ranges.current.x2, x2_axis),
          y1: marginal_axis(
            scales.y,
            ranges.current.y,
            y_axis,
            cat_axis === `y` ? (pos) => category_list[Math.round(pos)] : undefined,
          ),
          y2: marginal_axis(scales.y2, ranges.current.y2, y2_axis),
        }}
        id={clip_path_id}
      />
    </svg>

    <!-- Legend -->
    {#if legend && (show_legend !== undefined ? show_legend : series.length > 1)}
      {@const legend_pos = placed_coords(
        legend_auto_outside,
        { x: legend_outside_x, y: legend_outside_y },
        legend_placement,
        legend_tween.coords.current,
        { x: pad.l + 10, y: pad.t + 10 },
      )}
      <PlotLegend
        bind:root_element={legend_element}
        {...legend}
        series_data={legend_data}
        on_toggle={legend?.on_toggle ?? legend_vis.on_toggle}
        on_group_toggle={legend?.on_group_toggle ?? legend_vis.on_group_toggle}
        on_double_click={legend?.on_double_click ?? legend_vis.on_double_click}
        on_hover_change={legend_tween.set_locked}
        on_item_hover={(item) =>
          (hovered_legend_series_idx =
            item != null && item.series_idx >= 0 ? item.series_idx : null)}
        active_series_idx={hover_info?.series_idx ?? hovered_legend_series_idx}
        style={`
          position: absolute;
          left: ${legend_pos.x}px;
          top: ${legend_pos.y}px;
          pointer-events: auto;
          ${legend?.style || ``}
        `}
      />
    {/if}

    {#if hover_info && hovered}
      {@const cx = (hover_info.active_x_axis === `x2` ? scales.x2 : scales.x)(
        hover_info.orient_x,
      )}
      {@const cy = (hover_info.active_y_axis === `y2` ? scales.y2 : scales.y)(
        hover_info.orient_y,
      )}
      <PlotTooltip
        x={cx}
        y={cy}
        offset={{ x: 10, y: 5 }}
        constrain_to={{ width, height }}
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
              format_value(hover_info.orient_x, hover_info.x_axis.format || `.3~s`)}
          </div>
          <div>
            {@html sanitize_html(hover_info.y_axis.label || `y`)}: {(cat_axis === `y`
              ? hover_info.category_label
              : undefined) ??
              format_value(hover_info.orient_y, hover_info.y_axis.format || `.3~s`)}
          </div>
        {/if}
      </PlotTooltip>
    {/if}

    {#if show_controls}
      <BarPlotControls
        toggle_props={{
          ...controls_toggle_props,
          style: `--ctrl-btn-right: var(--fullscreen-btn-offset, 30px); ${
            controls_toggle_props?.style ?? ``
          }`,
        }}
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
  {/if}

  <!-- User-provided children (e.g. for custom absolutely-positioned overlays) -->
  {@render children?.({ height, width, fullscreen })}
</div>

<style>
  .bar-plot {
    position: relative;
    width: 100%;
    height: var(--barplot-height, auto);
    min-height: var(--barplot-min-height, 300px);
    container-type: size;
    z-index: var(--barplot-z-index, auto);
    border-radius: var(--barplot-border-radius, var(--border-radius, 3pt));
    flex: var(--barplot-flex, 1);
    display: var(--barplot-display, flex);
    flex-direction: column;
    background: var(--barplot-bg, var(--plot-bg));
  }
  .bar-plot.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    /* Must be higher than Structure.svelte's --struct-buttons-z-index. */
    z-index: var(--barplot-fullscreen-z-index, var(--z-index-overlay-nav, 100000001));
    margin: 0;
    border-radius: 0;
    background: var(--barplot-fullscreen-bg, var(--barplot-bg, var(--plot-bg)));
    max-height: none !important;
    overflow: hidden;
    /* border-top (not padding-top): bind:clientHeight includes padding but excludes
    borders - padding made the chart overflow + clip its bottom 2em (x-axis title) */
    border-top: var(--plot-fullscreen-padding-top, 2em) solid
      var(--barplot-fullscreen-bg, var(--barplot-bg, var(--plot-bg, transparent)));
    box-sizing: border-box;
  }
  .header-controls {
    position: absolute;
    top: var(--ctrl-btn-top, 5pt);
    right: var(--fullscreen-btn-right, 4px);
    z-index: var(--fullscreen-btn-z-index, 10);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .header-controls :global(.fullscreen-toggle) {
    position: static; /* Override absolute positioning since container handles it */
    opacity: 1; /* Always visible when inside header-controls, container controls visibility */
  }
  /* Hide controls and fullscreen toggles by default, show on hover */
  .bar-plot :global(.pane-toggle),
  .bar-plot .header-controls {
    opacity: 0;
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  .bar-plot:hover :global(.pane-toggle),
  .bar-plot:hover .header-controls,
  .bar-plot :global(.pane-toggle:focus-visible),
  .bar-plot :global(.pane-toggle[aria-expanded='true']),
  .bar-plot .header-controls:focus-within {
    opacity: 1;
  }
  svg {
    width: var(--barplot-svg-width, 100%);
    height: var(--barplot-svg-height, 100%);
    flex: var(--barplot-svg-flex, 1);
    overflow: var(--barplot-svg-overflow, visible);
    fill: var(--text-color);
    font-weight: var(--scatter-font-weight);
    font-size: var(--scatter-font-size);
  }
  .bar-plot.dragover {
    border: var(--barplot-dragover-border, var(--dragover-border));
    background-color: var(--barplot-dragover-bg, var(--dragover-bg));
  }
  .bar-label {
    fill: var(--text-color);
    font-size: 11px;
  }
</style>
