<script lang="ts">
  import { format_value } from '$lib/labels'
  import { FullscreenToggle, set_fullscreen_bg } from '$lib/layout'
  import type {
    AxisLoadError,
    BarStyle,
    DataLoaderFn,
    HistogramHandlerProps,
    PanConfig,
    RefLine,
    RefLineEvent,
  } from '$lib/plot'
  import {
    compute_element_placement,
    HistogramControls,
    PlotAxis,
    PlotLegend,
    ReferenceLine,
  } from '$lib/plot'
  import type { AxisChangeState } from '$lib/plot/core/axis-utils'
  import { AXIS_DEFAULTS, create_axis_loader } from '$lib/plot/core/axis-utils'
  import { extract_series_color, prepare_legend_data } from '$lib/plot/core/data-transform'
  import {
    create_dimension_tracker,
    create_hover_lock,
  } from '$lib/plot/core/hover-lock.svelte'
  import { create_legend_visibility } from '$lib/plot/core/utils/series-visibility'
  import {
    get_relative_coords,
    MIN_TOUCH_DISTANCE_PIXELS,
    pan_range_by_pixels,
    PINCH_ZOOM_THRESHOLD,
    remove_drag_listeners,
    resolve_axis_ranges,
    sorted_range,
    vec2_equal,
    zoom_range_by_factor,
  } from '$lib/plot/core/interactions'
  import {
    calc_auto_padding,
    filter_padding,
    LABEL_GAP_DEFAULT,
    y2_axis_label_x,
    measure_max_tick_width,
  } from '$lib/plot/core/layout'
  import {
    build_obstacles_norm,
    clip_bar,
    has_explicit_position,
    measured_footprint,
    place_decorations,
  } from '$lib/plot/core/auto-place'
  import type { IndexedRefLine } from '$lib/plot/core/reference-line'
  import { group_ref_lines_by_z, index_ref_lines } from '$lib/plot/core/reference-line'
  import {
    create_scale,
    generate_ticks,
    get_nice_data_range,
    get_tick_label,
  } from '$lib/plot/core/scales'
  import type {
    BasePlotProps,
    DataSeries,
    InitialRanges,
    LegendConfig,
    PlotConfig,
    ScaleType,
  } from '$lib/plot/core/types'
  import { get_scale_type_name } from '$lib/plot/core/types'
  import ZeroLines from '$lib/plot/core/components/ZeroLines.svelte'
  import ZoomRect from '$lib/plot/core/components/ZoomRect.svelte'
  import { DEFAULTS } from '$lib/settings'
  import { bin, max } from 'd3-array'
  import type { Snippet } from 'svelte'
  import { onDestroy, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { Tween } from 'svelte/motion'
  import type { Vec2 } from '$lib/math'
  import PlotTooltip from '$lib/plot/core/components/PlotTooltip.svelte'
  import { bar_path } from '$lib/plot/core/svg'
  import { unique_id } from '$lib/plot/core/utils'

  let {
    series = $bindable([]),
    x_axis: x_axis_init = {},
    x2_axis: x2_axis_init = {},
    y_axis: y_axis_init = {},
    y2_axis: y2_axis_init = {},
    display: display_init = DEFAULTS.histogram.display,
    range_padding = 0.05,
    padding = { t: 20, b: 60, l: 60, r: 20 },
    bins = $bindable(100),
    show_legend = $bindable(true),
    legend = {},
    bar: bar_init = {},
    selected_property = $bindable(``),
    mode = $bindable(`single`),
    tooltip,
    hovered = $bindable(false),
    change = () => {},
    on_bar_click,
    on_bar_hover,
    ref_lines = $bindable([]),
    on_ref_line_click,
    on_ref_line_hover,
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    on_series_toggle = () => {},
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
    ...rest
  }: HTMLAttributes<HTMLDivElement> & BasePlotProps & PlotConfig & {
    series: DataSeries[]
    // Component-specific props
    bins?: number
    show_legend?: boolean
    legend?: LegendConfig | null
    bar?: BarStyle
    selected_property?: string
    mode?: `single` | `overlay`
    tooltip?: Snippet<[HistogramHandlerProps]>
    header_controls?: Snippet<
      [{ height: number; width: number; fullscreen: boolean }]
    >
    controls_extra?: Snippet<[Required<PlotConfig>]>
    change?: (data: { value: number; count: number; property: string } | null) => void
    on_bar_click?: (
      data: {
        value: number
        count: number
        property: string
        event: MouseEvent | KeyboardEvent
      },
    ) => void
    on_bar_hover?: (
      data:
        | { value: number; count: number; property: string; event: MouseEvent }
        | null,
    ) => void
    ref_lines?: RefLine[]
    on_ref_line_click?: (event: RefLineEvent) => void
    on_ref_line_hover?: (event: RefLineEvent | null) => void
    on_series_toggle?: (series_idx: number) => void
    // Interactive axis props
    data_loader?: DataLoaderFn
    on_axis_change?: (
      axis: `x` | `x2` | `y` | `y2`,
      key: string,
      new_series: DataSeries[],
    ) => void
    on_error?: (error: AxisLoadError) => void
    pan?: PanConfig
  } = $props()

  // Local state for controls (initialized from props, owned by this component)
  // Include key AXIS_DEFAULTS props (range, ticks, scale_type) that PlotControls needs
  // Using $state because these have bindings in HistogramControls/PlotControls
  // untrack() explicitly captures initial prop values (intentional - props provide initial config)
  const { format: _, ...axis_state_defaults } = AXIS_DEFAULTS // Exclude format (has component-specific default)
  let bar = $state(untrack(() => ({ ...DEFAULTS.histogram.bar, ...bar_init })))
  let x_axis = $state(untrack(() => ({ ...axis_state_defaults, ...x_axis_init })))
  // x2-axis needs different default label_shift for top-side positioning
  let x2_axis = $state(untrack(() => ({
    ...axis_state_defaults,
    label_shift: { x: 0, y: 40 },
    ...x2_axis_init,
  })))
  let y_axis = $state(untrack(() => ({ ...axis_state_defaults, ...y_axis_init })))
  // y2 title stays vertically centered; its x position is computed by y2_axis_label_x
  let y2_axis = $state(untrack(() => ({
    ...axis_state_defaults,
    label_shift: { x: 0, y: 0 },
    ...y2_axis_init,
  })))
  let display = $state(
    untrack(() => ({ ...DEFAULTS.histogram.display, ...display_init })),
  )

  // Merge component-specific defaults with local state (format comes from here, not AXIS_DEFAULTS)
  const final_x_axis = $derived({ label: `Value`, format: `.2~s`, ...x_axis })
  const final_x2_axis = $derived({ label: `Value`, format: `.2~s`, ...x2_axis })
  const final_y_axis = $derived({ label: `Count`, format: `d`, ...y_axis })
  const final_bar = $derived({ ...DEFAULTS.histogram.bar, ...bar })
  const final_y2_axis = $derived({ label: `Count`, format: `d`, ...y2_axis })

  // Core state
  let [width, height] = $state([0, 0])
  let wrapper: HTMLDivElement | undefined = $state()
  let svg_element: SVGElement | null = $state(null)
  const clip_path_id = unique_id(`histogram-clip`) // stable, collision-resistant (see unique_id)
  let hover_info = $state<HistogramHandlerProps | null>(null)

  // Reference line hover state
  let hovered_ref_line_idx = $state<number | null>(null)

  // Interactive axis loading state
  let axis_loading = $state<`x` | `x2` | `y` | `y2` | null>(null)

  // Compute ref_lines with index and group by z-index (using shared utilities)
  let indexed_ref_lines = $derived(index_ref_lines(ref_lines))
  let ref_lines_by_z = $derived(group_ref_lines_by_z(indexed_ref_lines))
  let drag_state = $state<{
    start: { x: number; y: number } | null
    current: { x: number; y: number } | null
    bounds: DOMRect | null
  }>({ start: null, current: null, bounds: null })

  // Pan state
  let is_focused = $state(false)
  let shift_held = $state(false)
  let pan_drag_state = $state<
    InitialRanges & { start: { x: number; y: number } } | null
  >(null)
  let touch_state = $state<
    InitialRanges & { start_touches: { x: number; y: number }[] } | null
  >(null)

  // Legend placement stability state
  let legend_element = $state<HTMLDivElement | undefined>()
  let hovered_legend_series_idx = $state<number | null>(null)
  const legend_hover = create_hover_lock()
  const dim_tracker = create_dimension_tracker()
  let has_initial_legend_placement = $state(false)

  // Clear pending hover lock timeout on unmount
  $effect(() => () => legend_hover.cleanup())

  // Derived data
  type IndexedSeries = { series_data: DataSeries; series_idx: number }
  let visible_series_labels = $derived(
    series
      .filter((series_data) => series_data.visible ?? true)
      .map((series_data) => series_data.label)
      .filter((label): label is string => typeof label === `string` && label.length > 0),
  )
  $effect(() => {
    if (mode !== `single`) return
    if (selected_property && visible_series_labels.includes(selected_property)) return
    selected_property = visible_series_labels[0] ?? ``
  })
  let selected_series_entries = $derived<IndexedSeries[]>(
    series
      .map((series_data: DataSeries, series_idx: number) => ({ series_data, series_idx }))
      .filter(({ series_data }) =>
        (series_data.visible ?? true) &&
        (mode !== `single` || !selected_property || series_data.label === selected_property)
      ),
  )
  let selected_series = $derived(
    selected_series_entries.map(({ series_data }) => series_data),
  )

  // Separate series by y-axis
  let y1_series = $derived(
    selected_series.filter((srs: DataSeries) => (srs.y_axis ?? `y1`) === `y1`),
  )
  let y2_series = $derived(
    selected_series.filter((srs: DataSeries) => srs.y_axis === `y2`),
  )
  let x2_series = $derived(
    selected_series.filter((srs: DataSeries) => srs.x_axis === `x2`),
  )

  let auto_ranges = $derived.by(() => {
    // Only x1 series contribute to the x1 auto-range (x2 series get their own domain below)
    const x1_values = selected_series.flatMap((srs) => srs.x_axis === `x2` ? [] : srs.y)
    const auto_x = get_nice_data_range(
      x1_values.map((val) => ({ x: val, y: 0 })),
      ({ x }) => x,
      final_x_axis.range ?? [null, null],
      final_x_axis.scale_type ?? `linear`,
      range_padding,
      false,
    )

    const x2_values = x2_series.flatMap((srs: DataSeries) => srs.y)
    const auto_x2 = x2_values.length > 0
      ? get_nice_data_range(
        x2_values.map((val) => ({ x: val, y: 0 })),
        ({ x }) => x,
        final_x2_axis.range ?? [null, null],
        final_x2_axis.scale_type ?? `linear`,
        range_padding,
        false,
      )
      : [0, 1] as Vec2

    // Calculate y-range for a specific set of series
    const calc_y_range = (
      series_list: typeof selected_series,
      y_limit: [number | null, number | null],
      scale_type: ScaleType,
    ): Vec2 => {
      const type_name = get_scale_type_name(scale_type)
      if (series_list.length === 0) {
        const fallback = type_name === `log` ? 1 : 0
        return [fallback, 1]
      }
      // Bin each series over the domain of the x-axis it renders on (d3 bin() drops
      // out-of-domain values, so binning x2 series over the x1 domain skews max_count)
      const max_count = Math.max(
        0,
        ...series_list.map((srs: DataSeries) => {
          const hist = bin().domain(srs.x_axis === `x2` ? auto_x2 : auto_x).thresholds(bins)
          return max(hist(srs.y), (data) => data.length) || 0
        }),
      )

      // If there's effectively no data, avoid log-range issues (counts can't be <= 0 on log)
      if (max_count <= 0) {
        const fallback = type_name === `log` ? 1 : 0
        return [fallback, 1]
      }

      const [y0, y1] = get_nice_data_range(
        [{ x: 0, y: 0 }, { x: max_count, y: 0 }],
        ({ x }) => x,
        y_limit,
        scale_type,
        range_padding,
        false,
      )
      // For log scale, minimum must be >= 1 (count can't be 0 on log)
      // For linear/arcsinh, start from 0
      const y_min = type_name === `log` ? Math.max(1, y0) : Math.max(0, y0)
      return [y_min, y1]
    }

    const y1_range = calc_y_range(
      y1_series,
      final_y_axis.range ?? [null, null],
      final_y_axis.scale_type ?? `linear`,
    )
    const y2_auto_range = calc_y_range(
      y2_series,
      final_y2_axis.range ?? [null, null],
      final_y2_axis.scale_type ?? `linear`,
    )

    return { x: auto_x, x2: auto_x2, y: y1_range, y2: y2_auto_range }
  })

  // Initialize ranges
  let ranges = $state({
    initial: {
      x: [0, 1] as Vec2,
      x2: [0, 1] as Vec2,
      y: [0, 1] as Vec2,
      y2: [0, 1] as Vec2,
    },
    current: {
      x: [0, 1] as Vec2,
      x2: [0, 1] as Vec2,
      y: [0, 1] as Vec2,
      y2: [0, 1] as Vec2,
    },
  })

  $effect(() => {
    // Supports one-sided range pinning (null bounds fall back to auto); returns null
    // for transient non-finite bounds (skip: writing NaN breaks scales and loops here)
    const next = resolve_axis_ranges(
      { x: final_x_axis, x2: final_x2_axis, y: final_y_axis, y2: final_y2_axis },
      auto_ranges,
    )
    if (!next) return
    // Update only changed axes (preserving each unchanged axis's panned current view).
    // untrack the reads of `ranges` so the writes below can't re-trigger this effect
    // (reading + writing the same state otherwise causes effect_update_depth_exceeded).
    const init = untrack(() => ranges.initial)
    if (!vec2_equal(init.x, next.x)) [ranges.initial.x, ranges.current.x] = [next.x, next.x]
    if (!vec2_equal(init.x2, next.x2)) [ranges.initial.x2, ranges.current.x2] = [next.x2, next.x2]
    if (!vec2_equal(init.y, next.y)) [ranges.initial.y, ranges.current.y] = [next.y, next.y]
    if (!vec2_equal(init.y2, next.y2)) [ranges.initial.y2, ranges.current.y2] = [next.y2, next.y2]
  })

  // Layout: dynamic padding based on tick label widths
  const default_padding = { t: 20, b: 60, l: 60, r: 20 }
  // base_pad reserves space for tick labels/axis titles; pad (below) adds decoration reservations
  let base_pad = $derived(filter_padding(padding, default_padding))

  // Update padding based on tick label widths (untrack breaks circular dependency)
  $effect(() => {
    const current_ticks_x2 = untrack(() => ticks.x2)
    const current_ticks_y = untrack(() => ticks.y)
    const current_ticks_y2 = untrack(() => ticks.y2)

    const new_pad = width && height && current_ticks_y.length > 0
      ? calc_auto_padding({
        padding,
        default_padding,
        x2_axis: { ...final_x2_axis, tick_values: current_ticks_x2 },
        y_axis: { ...final_y_axis, tick_values: current_ticks_y },
        y2_axis: { ...final_y2_axis, tick_values: current_ticks_y2 },
      })
      : filter_padding(padding, default_padding)

    // Add y2 axis label space (calc_auto_padding only accounts for tick labels)
    if (
      width && height && y2_series.length > 0 && current_ticks_y2.length > 0 &&
      final_y2_axis.label
    ) {
      const inside = final_y2_axis.tick?.label?.inside ?? false
      // When ticks are inside, they don't contribute to padding
      const tick_shift = inside ? 0 : (final_y2_axis.tick?.label?.shift?.x ?? 0) + 8
      const tick_width_contribution = inside ? 0 : tick_label_widths.y2_max
      const label_thickness = Math.round(12 * 1.2)
      new_pad.r = Math.max(
        new_pad.r,
        tick_width_contribution + LABEL_GAP_DEFAULT + tick_shift + label_thickness,
      )
    }

    // Add x2 axis label space (mirroring y2 logic for top padding)
    if (
      width && height && x2_series.length > 0 && current_ticks_x2.length > 0 &&
      final_x2_axis.label
    ) {
      const inside = final_x2_axis.tick?.label?.inside ?? false
      const tick_shift = inside
        ? 0
        : Math.abs(final_x2_axis.tick?.label?.shift?.y ?? 0) + 8
      const label_thickness = Math.round(12 * 1.2)
      new_pad.t = Math.max(
        new_pad.t,
        tick_shift + LABEL_GAP_DEFAULT + label_thickness,
      )
    }

    // Only update if padding actually changed
    if (
      base_pad.t !== new_pad.t || base_pad.b !== new_pad.b ||
      base_pad.l !== new_pad.l || base_pad.r !== new_pad.r
    ) base_pad = new_pad
  })

  const legend_footprint = $derived(measured_footprint(legend_element, { width: 120, height: 60 }))
  const legend_has_explicit_pos = $derived(has_explicit_position(legend?.style))

  // Obstacle field in normalized [0,1] plot coords (y=0 at top). Each filled bar is modeled as a
  // vertical segment (top -> baseline) so the legend can't hide inside a tall bar. Built from
  // histogram_bins (pad-independent) + ranges so the crowding decision can't see its own reservation.
  const obstacles_norm = $derived.by(() => {
    if (!width || !height || histogram_bins.length === 0) return []
    const base_w = width - base_pad.l - base_pad.r
    const base_h = height - base_pad.t - base_pad.b
    if (base_w <= 0 || base_h <= 0) return []
    const bars: { points: { x: number; y: number }[]; draws_line: boolean }[] = []
    for (const hist of histogram_bins) {
      const [rx0, rx1] = hist.x_axis === `x2` ? ranges.current.x2 : ranges.current.x
      const [ry0, ry1] = hist.y_axis === `y2` ? ranges.current.y2 : ranges.current.y
      const x_span = rx1 - rx0
      const y_span = ry1 - ry0
      if (!(x_span > 0) || !(y_span > 0)) continue
      for (const series_bin of hist.bins) {
        if (series_bin.length <= 0) continue
        const x_norm = (((series_bin.x0 ?? 0) + (series_bin.x1 ?? 0)) / 2 - rx0) / x_span
        const top = 1 - (series_bin.length - ry0) / y_span
        const baseline = 1 + ry0 / y_span // normalized y of count=0 (bar foot)
        const seg = clip_bar(true, x_norm, top, baseline)
        if (seg) bars.push(seg)
      }
    }
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
      legend: show_legend && legend != null && series.length > 1 &&
          legend_element != null && !legend_has_explicit_pos
        ? { footprint: legend_footprint, clearance: legend?.axis_clearance }
        : null,
    })
  )
  const pad = $derived(decor.pad)
  const legend_auto_outside = $derived(decor.legend_outside)
  const legend_outside_x = $derived(decor.legend_pos.x)
  const legend_outside_y = $derived(decor.legend_pos.y)

  // Scales and data
  let scales = $derived({
    x: create_scale(
      final_x_axis.scale_type ?? `linear`,
      ranges.current.x,
      [pad.l, width - pad.r],
    ),
    x2: create_scale(
      final_x2_axis.scale_type ?? `linear`,
      ranges.current.x2,
      [pad.l, width - pad.r],
    ),
    y: create_scale(
      final_y_axis.scale_type ?? `linear`,
      ranges.current.y,
      [height - pad.b, pad.t],
    ),
    y2: create_scale(
      final_y2_axis.scale_type ?? `linear`,
      ranges.current.y2,
      [height - pad.b, pad.t],
    ),
  })

  // Pad-independent binning (no pixel scales) so the auto-place obstacle field can reuse it
  let histogram_bins = $derived.by(() => {
    if (selected_series.length === 0 || !width || !height) return []
    const hist_generator = bin()
      .domain([ranges.current.x[0], ranges.current.x[1]])
      .thresholds(bins)
    const x2_hist_generator = x2_series.length > 0
      ? bin().domain([ranges.current.x2[0], ranges.current.x2[1]]).thresholds(bins)
      : null
    return selected_series_entries.map(({ series_data, series_idx }) => {
      const use_x2 = series_data.x_axis === `x2`
      const active_hist = use_x2 && x2_hist_generator ? x2_hist_generator : hist_generator
      const bins_arr = active_hist(series_data.y)
      return {
        id: series_data.id ?? series_idx,
        series_idx,
        label: series_data.label || `Series ${series_idx + 1}`,
        color: selected_series.length === 1
          ? final_bar.color
          : extract_series_color(series_data),
        bins: bins_arr,
        max_count: max(bins_arr, (data) => data.length) || 0,
        x_axis: series_data.x_axis,
        y_axis: series_data.y_axis,
      }
    })
  })
  // Render-time data adds the pixel scales (pad-dependent)
  let histogram_data = $derived(
    histogram_bins.map((hist) => ({
      ...hist,
      x_scale: hist.x_axis === `x2` ? scales.x2 : scales.x,
      y_scale: hist.y_axis === `y2` ? scales.y2 : scales.y,
    })),
  )

  let ticks = $derived({
    x: width && height
      ? generate_ticks(
        ranges.current.x,
        final_x_axis.scale_type ?? `linear`,
        final_x_axis.ticks,
        scales.x,
        { default_count: 8 },
      )
      : [],
    x2: width && height && x2_series.length > 0
      ? generate_ticks(
        ranges.current.x2,
        final_x2_axis.scale_type ?? `linear`,
        final_x2_axis.ticks,
        scales.x2,
        { default_count: 8 },
      )
      : [],
    y: width && height
      ? generate_ticks(
        ranges.current.y,
        final_y_axis.scale_type ?? `linear`,
        final_y_axis.ticks,
        scales.y,
        { default_count: 6 },
      )
      : [],
    y2: width && height && y2_series.length > 0
      ? generate_ticks(
        ranges.current.y2,
        final_y2_axis.scale_type ?? `linear`,
        final_y2_axis.ticks,
        scales.y2,
        { default_count: 6 },
      )
      : [],
  })

  // Cache measured tick-label widths so expensive text measurement only runs
  // when tick values/format change, not on every template rerender.
  let tick_label_widths = $derived({
    x2_max: measure_max_tick_width(ticks.x2, final_x2_axis.format ?? ``),
    y_max: measure_max_tick_width(ticks.y, final_y_axis.format ?? ``),
    y2_max: measure_max_tick_width(ticks.y2, final_y2_axis.format ?? ``),
  })

  let legend_data = $derived(prepare_legend_data(series))

  // Collect histogram bar positions for legend placement
  let hist_points_for_placement = $derived.by(() => {
    if (!width || !height || histogram_data.length === 0) return []

    const points: { x: number; y: number }[] = []

    for (const { bins: series_bins, x_scale, y_scale } of histogram_data) {
      for (const series_bin of series_bins) {
        if (series_bin.length > 0) {
          const bar_x = x_scale(((series_bin.x0 ?? 0) + (series_bin.x1 ?? 0)) / 2)
          const bar_y = y_scale(series_bin.length)
          if (isFinite(bar_x) && isFinite(bar_y)) {
            // Add multiple points for taller bars to increase their weight
            // Cap to prevent O(N·count/10) blow-ups for large counts
            const weight = Math.min(20, Math.ceil(series_bin.length / 10))
            for (let idx = 0; idx < weight; idx++) points.push({ x: bar_x, y: bar_y })
          }
        }
      }
    }
    return points
  })

  // Calculate best legend placement using continuous grid sampling
  let legend_placement = $derived.by(() => {
    const should_place = show_legend && legend != null && series.length > 1
    if (!should_place || !width || !height) return null

    const plot_width = width - pad.l - pad.r
    const plot_height = height - pad.t - pad.b

    const result = compute_element_placement({
      plot_bounds: { x: pad.l, y: pad.t, width: plot_width, height: plot_height },
      element: legend_element,
      element_size: { width: 120, height: 60 }, // fallback before first render
      axis_clearance: legend?.axis_clearance,
      exclude_rects: [],
      points: hist_points_for_placement,
    })

    return result
  })

  // Tweened legend coordinates for smooth animation - create once, update target via effect
  // untrack() explicitly captures initial tween config (intentional - config set once at mount)
  const tweened_legend_coords = new Tween(
    { x: 0, y: 0 },
    untrack(() => ({ duration: 400, ...legend?.tween })),
  )

  // Update legend position with stability checks
  $effect(() => {
    if (!width || !height || !legend_placement) return

    // Track dimensions for resize detection
    const dims_changed = dim_tracker.has_changed(width, height)
    if (dims_changed) dim_tracker.update(width, height)

    // Only update if: resize occurred, OR (not hover-locked AND (responsive OR not yet initially placed))
    const is_responsive = legend?.responsive ?? false
    const should_update = dims_changed || (!legend_hover.is_locked.current &&
      (is_responsive || !has_initial_legend_placement))

    if (should_update) {
      tweened_legend_coords.set(
        { x: legend_placement.x, y: legend_placement.y },
        // Skip animation on initial placement to avoid jump from (0, 0)
        has_initial_legend_placement ? undefined : { duration: 0 },
      )
      // Only lock position after we have actual measured size
      if (legend_element) {
        has_initial_legend_placement = true
      }
    }
  })

  // Event handlers
  const handle_zoom = () => {
    if (!drag_state.start || !drag_state.current) return
    const start_x = scales.x.invert(drag_state.start.x)
    const end_x = scales.x.invert(drag_state.current.x)
    const start_x2 = scales.x2.invert(drag_state.start.x)
    const end_x2 = scales.x2.invert(drag_state.current.x)
    const start_y = scales.y.invert(drag_state.start.y)
    const end_y = scales.y.invert(drag_state.current.y)
    const start_y2 = scales.y2.invert(drag_state.start.y)
    const end_y2 = scales.y2.invert(drag_state.current.y)

    if (typeof start_x === `number` && typeof end_x === `number`) {
      const dx = Math.abs(drag_state.start.x - drag_state.current.x)
      const dy = Math.abs(drag_state.start.y - drag_state.current.y)
      if (dx > 5 && dy > 5) {
        // Update axis ranges to trigger reactivity and prevent effect from overriding
        x_axis = { ...x_axis, range: sorted_range(start_x, end_x) }
        if (x2_series.length > 0) {
          x2_axis = { ...x2_axis, range: sorted_range(start_x2, end_x2) }
        }
        y_axis = { ...y_axis, range: sorted_range(start_y, end_y) }
        // gate on y2 series presence (like x2): the y2 scale is a [0, 1] sentinel
        // otherwise, so inverting would store a phantom range in the bindable prop
        if (y2_series.length > 0) {
          y2_axis = { ...y2_axis, range: sorted_range(start_y2, end_y2) }
        }
      }
    }
  }

  const on_window_mouse_move = (evt: MouseEvent) => {
    if (!drag_state.start || !drag_state.bounds) return
    drag_state.current = {
      x: evt.clientX - drag_state.bounds.left,
      y: evt.clientY - drag_state.bounds.top,
    }
  }

  const on_window_mouse_up = () => {
    handle_zoom()
    drag_state = { start: null, current: null, bounds: null }
    window.removeEventListener(`mousemove`, on_window_mouse_move)
    window.removeEventListener(`mouseup`, on_window_mouse_up)
    document.body.style.cursor = `default`
  }

  // Pan/zoom all four axes from an interaction-start snapshot, each in its own
  // scale's transform space (log axes pan by a constant factor, linear by a shift).
  // Plot dims clamped to 1px so degenerate containers can't produce Infinity deltas.
  const pan_all_axes = (init: InitialRanges, dx_px: number, dy_px: number) => {
    const plot_width = Math.max(1, width - pad.l - pad.r)
    const plot_height = Math.max(1, height - pad.t - pad.b)
    ranges.current.x = pan_range_by_pixels(init.initial_x_range, dx_px, plot_width, final_x_axis.scale_type)
    ranges.current.x2 = pan_range_by_pixels(init.initial_x2_range, dx_px, plot_width, final_x2_axis.scale_type)
    ranges.current.y = pan_range_by_pixels(init.initial_y_range, dy_px, plot_height, final_y_axis.scale_type)
    ranges.current.y2 = pan_range_by_pixels(init.initial_y2_range, dy_px, plot_height, final_y2_axis.scale_type)
  }
  const zoom_all_axes = (init: InitialRanges, factor: number) => {
    ranges.current.x = zoom_range_by_factor(init.initial_x_range, factor, final_x_axis.scale_type)
    ranges.current.x2 = zoom_range_by_factor(init.initial_x2_range, factor, final_x2_axis.scale_type)
    ranges.current.y = zoom_range_by_factor(init.initial_y_range, factor, final_y_axis.scale_type)
    ranges.current.y2 = zoom_range_by_factor(init.initial_y2_range, factor, final_y2_axis.scale_type)
  }

  // Pan drag handler (drag direction inverted on x for natural pan feel)
  const on_pan_move = (evt: MouseEvent) => {
    if (!pan_drag_state) return
    const sensitivity = pan?.drag_sensitivity ?? 1
    pan_all_axes(
      pan_drag_state,
      -(evt.clientX - pan_drag_state.start.x) * sensitivity,
      (evt.clientY - pan_drag_state.start.y) * sensitivity,
    )
  }

  const on_pan_end = () => {
    pan_drag_state = null
    document.body.style.cursor = ``
    window.removeEventListener(`mousemove`, on_pan_move)
    window.removeEventListener(`mouseup`, on_pan_end)
  }

  // Tear down any window listeners + cursor override if the component unmounts mid-drag
  // (mouseup/panend would otherwise never fire, leaking listeners and a stuck cursor).
  // onDestroy also runs during SSR teardown, where window/document don't exist.
  onDestroy(() => {
    remove_drag_listeners([on_window_mouse_move, on_pan_move], [on_window_mouse_up, on_pan_end])
    drag_state = { start: null, current: null, bounds: null }
    pan_drag_state = null
  })

  function handle_mouse_down(evt: MouseEvent) {
    const coords = get_relative_coords(evt)
    if (!coords || !svg_element) return

    // Check if pan is enabled and shift is held for pan mode
    const pan_enabled = pan?.enabled !== false
    if (pan_enabled && evt.shiftKey) {
      evt.preventDefault()
      pan_drag_state = {
        start: { x: evt.clientX, y: evt.clientY },
        initial_x_range: [...ranges.current.x] as [number, number],
        initial_x2_range: [...ranges.current.x2] as [number, number],
        initial_y_range: [...ranges.current.y] as [number, number],
        initial_y2_range: [...ranges.current.y2] as [number, number],
      }
      document.body.style.cursor = `grabbing`
      window.addEventListener(`mousemove`, on_pan_move)
      window.addEventListener(`mouseup`, on_pan_end)
      return
    }

    drag_state = {
      start: coords,
      current: coords,
      bounds: svg_element.getBoundingClientRect(),
    }
    window.addEventListener(`mousemove`, on_window_mouse_move)
    window.addEventListener(`mouseup`, on_window_mouse_up)
    evt.preventDefault()
  }

  // Wheel handler for pan (requires focus and shift)
  function handle_wheel(evt: WheelEvent) {
    const pan_enabled = pan?.enabled !== false
    // Only capture wheel when focused AND Shift is held
    // Use shift_held state (tracked via keydown/keyup) for compatibility with synthetic events
    if (!pan_enabled || !is_focused || !shift_held) return

    evt.preventDefault()

    // Clamp to at least 1 to avoid Infinity deltas when padding equals container size
    const plot_width = Math.max(1, width - pad.l - pad.r)
    const plot_height = Math.max(1, height - pad.t - pad.b)
    const sensitivity = pan?.wheel_sensitivity ?? 1

    // Pan along the dominant wheel direction
    if (Math.abs(evt.deltaX) > Math.abs(evt.deltaY)) {
      const dx = evt.deltaX * sensitivity
      ranges.current.x = pan_range_by_pixels(ranges.current.x, dx, plot_width, final_x_axis.scale_type)
      ranges.current.x2 = pan_range_by_pixels(ranges.current.x2, dx, plot_width, final_x2_axis.scale_type)
    } else {
      const dy = evt.deltaY * sensitivity
      ranges.current.y = pan_range_by_pixels(ranges.current.y, dy, plot_height, final_y_axis.scale_type)
      ranges.current.y2 = pan_range_by_pixels(ranges.current.y2, dy, plot_height, final_y2_axis.scale_type)
    }
  }

  // Touch handlers for pinch-zoom and two-finger pan
  function handle_touch_start(evt: TouchEvent) {
    const touch_enabled = pan?.enabled !== false && pan?.touch_enabled !== false
    if (!touch_enabled || evt.touches.length !== 2) return

    evt.preventDefault()
    const touches = Array.from(evt.touches)
    touch_state = {
      start_touches: touches.map((touch) => ({ x: touch.clientX, y: touch.clientY })),
      initial_x_range: [...ranges.current.x] as [number, number],
      initial_x2_range: [...ranges.current.x2] as [number, number],
      initial_y_range: [...ranges.current.y] as [number, number],
      initial_y2_range: [...ranges.current.y2] as [number, number],
    }
  }

  function handle_touch_move(evt: TouchEvent) {
    if (!touch_state || evt.touches.length !== 2) return
    evt.preventDefault()

    const [t1, t2] = Array.from(evt.touches)
    const [s1, s2] = touch_state.start_touches

    // Calculate center movement for pan
    const start_center = { x: (s1.x + s2.x) / 2, y: (s1.y + s2.y) / 2 }
    const curr_center = {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    }
    const dx = curr_center.x - start_center.x
    const dy = curr_center.y - start_center.y

    // Calculate pinch scale (curr/start so spread = zoom out, pinch = zoom in)
    const start_dist = Math.hypot(s2.x - s1.x, s2.y - s1.y)
    // ignore near-coincident touches so curr_dist / start_dist can't blow up the scale
    if (start_dist < MIN_TOUCH_DISTANCE_PIXELS) return
    const curr_dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
    const scale = curr_dist / start_dist

    // Pinch zoom about the view center (spread = zoom in, pinch = zoom out)
    if (Math.abs(scale - 1) > PINCH_ZOOM_THRESHOLD && scale > Number.EPSILON) {
      zoom_all_axes(touch_state, scale)
    } else pan_all_axes(touch_state, -dx, dy)
  }

  function handle_touch_end() {
    touch_state = null
  }

  function handle_double_click() {
    // Reset zoom to initial ranges (undo any pan/zoom)
    ranges.current.x = [...ranges.initial.x] as [number, number]
    ranges.current.x2 = [...ranges.initial.x2] as [number, number]
    ranges.current.y = [...ranges.initial.y] as [number, number]
    ranges.current.y2 = [...ranges.initial.y2] as [number, number]
    // Also reset axis props so future data changes recalculate auto ranges
    x_axis = { ...x_axis, range: [null, null] }
    x2_axis = { ...x2_axis, range: [null, null] }
    y_axis = { ...y_axis, range: [null, null] }
    y2_axis = { ...y2_axis, range: [null, null] }
  }

  function handle_mouse_move(
    evt: MouseEvent,
    value: number,
    count: number,
    property: string,
    active_y_axis: `y1` | `y2` = `y1`,
    series_idx: number = 0,
    active_x_axis: `x1` | `x2` = `x1`,
  ) {
    hovered = true
    hover_info = {
      value,
      count,
      property,
      active_y_axis,
      active_x_axis,
      x: value,
      y: count,
      series_idx,
      metadata: null,
      label: property,
      x_axis: active_x_axis === `x2` ? x2_axis : x_axis,
      x2_axis,
      y_axis: active_y_axis === `y2` ? y2_axis : y_axis,
      y2_axis,
    }
    change({ value, count, property })
    on_bar_hover?.({ value, count, property, event: evt })
  }

  const legend_vis = create_legend_visibility(() => series, (next) => (series = next))

  // Set theme-aware background when entering fullscreen
  $effect(() => {
    set_fullscreen_bg(wrapper, fullscreen, `--histogram-fullscreen-bg`)
  })

  // State accessors for shared axis change handler
  const axis_state: AxisChangeState<DataSeries> = {
    get_axis: (axis) => {
      if (axis === `x`) return x_axis
      if (axis === `x2`) return x2_axis
      if (axis === `y`) return y_axis
      return y2_axis
    },
    set_axis: (axis, config) => {
      // Spread into existing state to preserve merged type structure
      if (axis === `x`) x_axis = { ...x_axis, ...config }
      else if (axis === `x2`) x2_axis = { ...x2_axis, ...config }
      else if (axis === `y`) y_axis = { ...y_axis, ...config }
      else y2_axis = { ...y2_axis, ...config }
    },
    get_series: () => series,
    set_series: (new_series) => (series = new_series),
    get_loading: () => axis_loading,
    set_loading: (axis) => (axis_loading = axis),
  }

  // Shared handler + one-shot auto-load bound to this component's state
  const { handle_axis_change, try_auto_load } = create_axis_loader(
    axis_state,
    () => ({ data_loader, on_axis_change, on_error }),
  )
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
    if (evt.key === `Shift`) shift_held = true
  }}
  onkeyup={(evt) => {
    if (evt.key === `Shift`) shift_held = false
  }}
/>

<div
  class="histogram"
  bind:this={wrapper}
  bind:clientWidth={width}
  bind:clientHeight={height}
  {...rest}
  class:fullscreen
>
  {#if width && height}
    <div class="header-controls">
      {@render header_controls?.({ height, width, fullscreen })}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <svg
    bind:this={svg_element}
    role="application"
    aria-label={rest[`aria-label`] ??
    ([final_x_axis.label, final_y_axis.label].filter(Boolean).join(` vs `) ||
      `Histogram`)}
    tabindex="0"
    onfocusin={() => (is_focused = true)}
    onfocusout={() => (is_focused = false)}
    onmouseenter={() => (hovered = true)}
    onmousedown={handle_mouse_down}
    onmouseleave={() => {
      hovered = false
      hover_info = null
      on_bar_hover?.(null)
    }}
    ondblclick={handle_double_click}
    onwheel={handle_wheel}
    ontouchstart={handle_touch_start}
    ontouchmove={handle_touch_move}
    ontouchend={handle_touch_end}
    ontouchcancel={handle_touch_end}
    style:cursor={pan_drag_state
    ? `grabbing`
    : shift_held && pan?.enabled !== false
    ? `grab`
    : `crosshair`}
    onkeydown={(event) => {
      if (event.key === `Escape` && drag_state.start) {
        drag_state = { start: null, current: null, bounds: null }
      }
      if ([`Enter`, ` `].includes(event.key)) {
        event.preventDefault()
        handle_double_click()
      }
    }}
  >
    <!-- Define clip path for chart area -->
    <defs>
      <clipPath id={clip_path_id}>
        <rect
          x={pad.l}
          y={pad.t}
          width={width - pad.l - pad.r}
          height={height - pad.t - pad.b}
        />
      </clipPath>
    </defs>

    <!-- Reference lines: below grid (must render first to appear behind grid) -->
    {@render ref_lines_layer(ref_lines_by_z.below_grid)}

    <ZoomRect start={drag_state.start} current={drag_state.current} />

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
      x_scale_type={final_x_axis.scale_type}
      x2_scale_type={final_x2_axis.scale_type}
      y_scale_type={final_y_axis.scale_type}
      y2_scale_type={final_y2_axis.scale_type}
      has_x2={x2_series.length > 0}
      has_y2={y2_series.length > 0}
      {width}
      {height}
      {pad}
    />

    <!-- Reference lines: below lines -->
    {@render ref_lines_layer(ref_lines_by_z.below_lines)}

    <!-- Reference lines: below points -->
    {@render ref_lines_layer(ref_lines_by_z.below_points)}

    <!-- X-axis -->
    <PlotAxis
      side="x"
      ticks={ticks.x as number[]}
      place={scales.x}
      axis={final_x_axis}
      domain={ranges.current.x as Vec2}
      {pad}
      {width}
      {height}
      show_grid={display.x_grid}
      tick_label={(tick) => get_tick_label(tick, final_x_axis.ticks)}
      label_x={(pad.l + width - pad.r) / 2 + (final_x_axis.label_shift?.x ?? 0)}
      label_y={height - 10 + (final_x_axis.label_shift?.y ?? 0)}
      axis_loading={axis_loading === `x`}
      on_axis_change={(key) => handle_axis_change(`x`, key)}
    />

    <!-- X2-axis (Top) -->
    {#if x2_series.length > 0}
      <PlotAxis
        side="x2"
        ticks={ticks.x2 as number[]}
        place={scales.x2}
        axis={final_x2_axis}
        domain={ranges.current.x2 as Vec2}
        {pad}
        {width}
        {height}
        show_grid={display.x2_grid}
        tick_label={(tick) => get_tick_label(tick, final_x2_axis.ticks)}
        label_x={(pad.l + width - pad.r) / 2 + (final_x2_axis.label_shift?.x ?? 0)}
        label_y={Math.max(12, pad.t - (final_x2_axis.label_shift?.y ?? 40))}
        axis_loading={axis_loading === `x2`}
        on_axis_change={(key) => handle_axis_change(`x2`, key)}
      />
    {/if}

    <!-- Y-axis -->
    <PlotAxis
      side="y"
      ticks={ticks.y as number[]}
      place={scales.y}
      axis={final_y_axis}
      domain={ranges.current.y as Vec2}
      {pad}
      {width}
      {height}
      show_grid={display.y_grid}
      tick_label={(tick) => get_tick_label(tick, final_y_axis.ticks)}
      label_x={Math.max(
        12,
        pad.l - (final_y_axis.tick?.label?.inside ? 0 : tick_label_widths.y_max) -
          LABEL_GAP_DEFAULT,
      ) + (final_y_axis.label_shift?.x ?? 0)}
      label_y={pad.t + (height - pad.t - pad.b) / 2 + (final_y_axis.label_shift?.y ?? 0)}
      axis_loading={axis_loading === `y`}
      on_axis_change={(key) => handle_axis_change(`y`, key)}
    />

    <!-- Y2-axis (Right) -->
    {#if y2_series.length > 0}
      <PlotAxis
        side="y2"
        ticks={ticks.y2 as number[]}
        place={scales.y2}
        axis={final_y2_axis}
        domain={ranges.current.y2 as Vec2}
        {pad}
        {width}
        {height}
        show_grid={display.y2_grid}
        tick_label={(tick) => get_tick_label(tick, final_y2_axis.ticks)}
        label_x={y2_axis_label_x(final_y2_axis, width, pad.r, tick_label_widths.y2_max)}
        label_y={pad.t + (height - pad.t - pad.b) / 2 + (final_y2_axis.label_shift?.y ?? 0)}
        axis_loading={axis_loading === `y2`}
        on_axis_change={(key) => handle_axis_change(`y2`, key)}
      />
    {/if}

    <!-- Histogram bars (rendered after axes so bars appear above grid lines) -->
    {#each histogram_data as
      { id, bins, color, label, x_scale, y_scale, x_axis: srs_x_axis, y_axis, series_idx },
      idx
      (id ?? idx)
    }
      <g
        class="histogram-series"
        data-series-idx={series_idx}
        clip-path="url(#{clip_path_id})"
        opacity={hovered_legend_series_idx !== null &&
            hovered_legend_series_idx !== series_idx
          ? 0.25
          : 1}
      >
        {#each bins as bin, bin_idx (bin_idx)}
          {@const bar_x = x_scale(bin.x0!)}
          {@const bar_width = Math.max(1, Math.abs(x_scale(bin.x1!) - bar_x))}
          {@const bar_height = Math.max(0, (height - pad.b) - y_scale(bin.length))}
          {@const bar_y = y_scale(bin.length)}
          {@const value = (bin.x0! + bin.x1!) / 2}
          {#if bar_height > 0}
            <path
              d={bar_path(
                bar_x,
                bar_y,
                bar_width,
                bar_height,
                Math.min(final_bar.border_radius ?? 0, bar_width / 2, bar_height / 2),
              )}
              fill={color}
              opacity={final_bar.opacity}
              stroke={final_bar.stroke_color}
              stroke-opacity={final_bar.stroke_opacity}
              stroke-width={final_bar.stroke_width}
              role="button"
              tabindex="0"
              onmousemove={(evt) =>
              handle_mouse_move(
                evt,
                value,
                bin.length,
                label,
                (y_axis ?? `y1`) as `y1` | `y2`,
                series_idx,
                (srs_x_axis ?? `x1`) as `x1` | `x2`,
              )}
              onmouseleave={() => {
                hover_info = null
                change(null)
                on_bar_hover?.(null)
              }}
              onclick={(event) =>
              on_bar_click?.({ value, count: bin.length, property: label, event })}
              onkeydown={(event: KeyboardEvent) => {
                if ([`Enter`, ` `].includes(event.key)) {
                  event.preventDefault()
                  on_bar_click?.({ value, count: bin.length, property: label, event })
                }
              }}
              style:cursor={on_bar_click ? `pointer` : undefined}
            />
          {/if}
        {/each}
      </g>
    {/each}

    <!-- Reference lines: above all -->
    {@render ref_lines_layer(ref_lines_by_z.above_all)}
  </svg>

  <!-- Tooltip (outside SVG for proper HTML rendering) -->
  {#if hover_info}
    {@const { value, count, property, active_y_axis, active_x_axis } = hover_info}
    {@const tooltip_x = (active_x_axis === `x2` ? scales.x2 : scales.x)(value)}
    {@const tooltip_y = (active_y_axis === `y2` ? scales.y2 : scales.y)(count)}
    <PlotTooltip
      x={tooltip_x}
      y={tooltip_y}
      offset={{ x: 5, y: -10 }}
      constrain_to={{ width, height }}
      fallback_size={{ width: 120, height: mode === `overlay` ? 60 : 40 }}
    >
      {#if tooltip}
        {@render tooltip({ ...hover_info, fullscreen })}
      {:else}
        <div>Value: {format_value(value, hover_info.x_axis.format || `.3~s`)}</div>
        <div>Count: {format_value(count, hover_info.y_axis.format || `.3~s`)}</div>
        {#if mode === `overlay`}<div>{property}</div>{/if}
      {/if}
    </PlotTooltip>
  {/if}

  {#if show_controls}
    <HistogramControls
      toggle_props={{
        ...controls_toggle_props,
        style: `--ctrl-btn-right: var(--fullscreen-btn-offset, 30px); ${
          controls_toggle_props?.style ?? ``
        }`,
      }}
      pane_props={controls_pane_props}
      bind:show_controls
      bind:controls_open
      bind:bins
      bind:mode
      bind:show_legend
      bind:selected_property
      bind:display
      bind:bar
      bind:x_axis
      bind:x2_axis
      bind:y_axis
      bind:y2_axis
      auto_x_range={auto_ranges.x}
      auto_x2_range={auto_ranges.x2}
      auto_y_range={auto_ranges.y}
      auto_y2_range={auto_ranges.y2}
      {series}
      has_x2_points={x2_series.length > 0}
      has_y2_points={y2_series.length > 0}
      children={controls_extra}
    />
  {/if}

  {#if show_legend && legend != null && series.length > 1}
    {@const legend_left = legend_auto_outside
    ? legend_outside_x
    : legend_placement
    ? tweened_legend_coords.current.x
    : pad.l + 10}
    {@const legend_top = legend_auto_outside
    ? legend_outside_y
    : legend_placement
    ? tweened_legend_coords.current.y
    : pad.t + 10}
    <PlotLegend
      bind:root_element={legend_element}
      {...legend}
      series_data={legend_data}
      on_toggle={legend?.on_toggle ?? ((series_idx: number) => {
        if (series_idx < 0 || series_idx >= series.length) return
        legend_vis.on_toggle(series_idx)
        on_series_toggle(series_idx)
      })}
      on_double_click={legend?.on_double_click ?? legend_vis.on_double_click}
      on_hover_change={legend_hover.set_locked}
      on_item_hover={(item) =>
        (hovered_legend_series_idx = item != null && item.series_idx >= 0
          ? item.series_idx
          : null)}
      active_series_idx={hover_info?.series_idx ?? hovered_legend_series_idx}
      style={`
        position: absolute;
        left: ${legend_left}px;
        top: ${legend_top}px;
        pointer-events: auto;
        ${legend?.style || ``}
      `}
    />
  {/if}

  <!-- User-provided children (e.g. for custom absolutely-positioned overlays) -->
  {@render children?.({ height, width, fullscreen })}
</div>

<style>
  .histogram {
    position: relative;
    width: var(--histogram-width, 100%);
    height: var(--histogram-height, auto);
    min-height: var(--histogram-min-height, 300px);
    container-type: size; /* enable cqh for panes if explicit height is set */
    z-index: var(--histogram-z-index, auto);
    flex: var(--histogram-flex, 1);
    display: var(--histogram-display, flex);
    flex-direction: column;
    background: var(--histogram-bg, var(--plot-bg));
    border-radius: var(--histogram-border-radius, var(--border-radius, 3pt));
  }
  .histogram.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    /* Must be higher than Structure.svelte's --struct-buttons-z-index. */
    z-index: var(--histogram-fullscreen-z-index, var(--z-index-overlay-nav, 100000001));
    margin: 0;
    border-radius: 0;
    background: var(--histogram-fullscreen-bg, var(--histogram-bg, var(--plot-bg)));
    max-height: none !important;
    overflow: hidden;
    /* border-top (not padding-top): bind:clientHeight includes padding but excludes
    borders - padding made the chart overflow + clip its bottom 2em (x-axis title) */
    border-top: var(--plot-fullscreen-padding-top, 2em) solid
      var(--histogram-fullscreen-bg, var(--histogram-bg, var(--plot-bg, transparent)));
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
  .histogram :global(.pane-toggle),
  .histogram .header-controls {
    opacity: 0;
    transition: opacity 0.2s, background-color 0.2s;
  }
  .histogram:hover :global(.pane-toggle),
  .histogram:hover .header-controls,
  .histogram :global(.pane-toggle:focus-visible),
  .histogram :global(.pane-toggle[aria-expanded='true']),
  .histogram .header-controls:focus-within {
    opacity: 1;
  }
  svg {
    width: var(--histogram-svg-width, 100%);
    height: var(--histogram-svg-height, 100%);
    max-height: var(--histogram-svg-max-height, 100%);
    flex: var(--histogram-svg-flex, 1);
    overflow: var(--histogram-svg-overflow, visible);
    fill: var(--text-color);
    font-weight: var(--histogram-font-weight);
    font-size: var(--histogram-font-size);
  }
  .histogram-series path {
    transition: opacity 0.2s ease;
  }
  .histogram-series path:hover {
    opacity: 1 !important;
  }
</style>
