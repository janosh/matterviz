<script lang="ts">
  import { format_value_or_num } from '$lib/labels'
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
  import { HistogramControls, PlotAxis, PlotLegend, PlotMarginals } from '$lib/plot'
  import ReferenceLinesLayer from '$lib/plot/core/components/ReferenceLinesLayer.svelte'
  import PlotTitle from '$lib/plot/core/components/PlotTitle.svelte'
  import type { MarginalSeriesInput, MarginalsProp } from '$lib/plot/core/marginals'
  import {
    add_sides,
    marginal_axis,
    marginal_axis_presence,
    normalize_marginals,
    reserve_marginal_pad,
  } from '$lib/plot/core/marginals'
  import { AXIS_DEFAULTS, create_axis_loader } from '$lib/plot/core/axis-utils'
  import type { AxisChangeState } from '$lib/plot/core/axis-utils'
  import {
    build_legend_items,
    extract_series_color,
    series_symbol_swatch,
  } from '$lib/plot/core/data-transform'
  import { create_facet_plot_adapter } from '$lib/plot/core/facet-layout.svelte'
  import { FACET_AXES, type FacetLayoutContext } from '$lib/plot/core/facets'
  import { create_placed_tween } from '$lib/plot/core/placed-tween.svelte'
  import { create_pan_zoom } from '$lib/plot/core/pan-zoom.svelte'
  import {
    create_legend_visibility,
    legend_mode_to_prop,
    resolve_legend_visibility,
  } from '$lib/plot/core/utils/series-visibility'
  import {
    invert_rect_range,
    resolve_axis_ranges,
    vec2_equal,
  } from '$lib/plot/core/interactions'
  import {
    AXIS_TITLE_OFFSET,
    calc_auto_padding,
    DEFAULT_PLOT_PADDING,
    filter_padding,
    measured_axis,
    resolve_tick_layout,
    sides_equal,
    y_axis_label_x,
    y2_axis_label_x,
  } from '$lib/plot/core/layout'
  import type { FontSpec } from '$lib/plot/core/text-metrics'
  import { normalize_plot_title, pad_for_plot_title } from '$lib/plot/core/plot-title'
  import {
    build_obstacles_norm,
    clip_bar,
    create_legend_decoration_item,
    decoration_placement_rects,
    get_decoration_placement,
    resolve_legend_layout_tracks,
    solve_decorations,
  } from '$lib/plot/core/decorations'
  import { has_explicit_position, measured_footprint } from '$lib/plot/core/auto-place'
  import type { IndexedRefLine } from '$lib/plot/core/reference-line'
  import {
    group_ref_lines_by_z,
    index_ref_lines,
    solve_reference_annotations,
  } from '$lib/plot/core/reference-line'
  import {
    accumulate_extent,
    create_axis_scales,
    empty_extent,
    generate_ticks,
    get_tick_label,
    nice_range_from_extent,
  } from '$lib/plot/core/scales'
  import type {
    BasePlotProps,
    DataSeries,
    LegendConfig,
    PlotConfig,
  } from '$lib/plot/core/types'
  import {
    compute_count_range,
    compute_histogram_bins,
    log_safe_range,
  } from '$lib/plot/histogram/histogram'
  import ZeroLines from '$lib/plot/core/components/ZeroLines.svelte'
  import ZoomRect from '$lib/plot/core/components/ZoomRect.svelte'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import { onDestroy, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
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
    range_padding = 0,
    padding = {},
    title,
    bins = $bindable(100),
    // explicit type arg keeps `undefined` (auto) in the prop type - a bare fallback
    // would collapse it to plain boolean
    show_legend = $bindable<boolean | undefined>(
      legend_mode_to_prop(DEFAULTS.histogram.show_legend),
    ),
    legend = {},
    bar: bar_init = {},
    selected_property = $bindable(``),
    // Defaults come from settings so the component and its controls pane agree; the pane
    // read DEFAULTS.histogram.mode ('overlay') while the component hard-coded 'single'
    mode = $bindable(DEFAULTS.histogram.mode),
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
    marginals = false,
    facet_layout,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `title`> &
    BasePlotProps &
    PlotConfig & {
      series: DataSeries[]
      // Component-specific props
      bins?: number
      show_legend?: boolean
      legend?: LegendConfig | null
      bar?: BarStyle
      selected_property?: string
      mode?: `single` | `overlay`
      tooltip?: Snippet<[HistogramHandlerProps]>
      header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
      controls_extra?: Snippet<[Required<PlotConfig>]>
      change?: (data: { value: number; count: number; property: string } | null) => void
      on_bar_click?: (data: {
        value: number
        count: number
        property: string
        event: MouseEvent | KeyboardEvent
      }) => void
      on_bar_hover?: (
        data: { value: number; count: number; property: string; event: MouseEvent } | null,
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
      marginals?: MarginalsProp
      facet_layout?: FacetLayoutContext
    } = $props()

  // Local state for controls (initialized from props, owned by this component)
  // Include key AXIS_DEFAULTS props (range, ticks, scale_type) that PlotControls needs
  // Using $state because these have bindings in HistogramControls/PlotControls
  // untrack() explicitly captures initial prop values (intentional - props provide initial config)
  const { format: _, ...axis_state_defaults } = AXIS_DEFAULTS // Exclude format (has component-specific default)
  let bar = $state(untrack(() => ({ ...DEFAULTS.histogram.bar, ...bar_init })))
  let x_axis = $state(untrack(() => ({ ...axis_state_defaults, ...x_axis_init })))
  // x2-axis needs different default label_shift for top-side positioning
  let x2_axis = $state(
    untrack(() => ({
      ...axis_state_defaults,
      label_shift: { x: 0, y: AXIS_TITLE_OFFSET },
      ...x2_axis_init,
    })),
  )
  let y_axis = $state(untrack(() => ({ ...axis_state_defaults, ...y_axis_init })))
  // y2 title stays vertically centered; its x position is computed by y2_axis_label_x
  let y2_axis = $state(
    untrack(() => ({
      ...axis_state_defaults,
      label_shift: { x: 0, y: 0 },
      ...y2_axis_init,
    })),
  )
  let display = $state(untrack(() => ({ ...DEFAULTS.histogram.display, ...display_init })))

  // Merge component-specific defaults with local state (format comes from here, not AXIS_DEFAULTS)
  // No default tick format: PlotAxis falls back to format_num, which uses SI
  // prefixes above 1 but plain decimals below (0.2 must not render as 200m)
  const final_x_axis = $derived({ label: `Value`, ...x_axis })
  const final_x2_axis = $derived({ label: `Value`, ...x2_axis })
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

  // Legend placement stability state
  let legend_element = $state<HTMLDivElement | undefined>()
  let legend_filter_query = $derived(legend?.filter_query ?? ``)
  let hovered_legend_series_idx = $state<number | null>(null)

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
      .filter(
        ({ series_data }) =>
          (series_data.visible ?? true) &&
          (mode !== `single` || !selected_property || series_data.label === selected_property),
      ),
  )
  let selected_series = $derived(selected_series_entries.map(({ series_data }) => series_data))

  // Partition count axes and accumulate value extents in one pass.
  let axis_data = $derived.by(() => {
    const y1_series: DataSeries[] = []
    const y2_series: DataSeries[] = []
    const x1_extent = empty_extent()
    const x2_extent = empty_extent()
    const y2_extent = empty_extent()
    for (const srs of selected_series) {
      accumulate_extent(srs.x_axis === `x2` ? x2_extent : x1_extent, srs.y)
      if (srs.y_axis === `y2`) {
        y2_series.push(srs)
        accumulate_extent(y2_extent, srs.y)
      } else y1_series.push(srs)
    }
    return { y1_series, y2_series, x1_extent, x2_extent, y2_extent }
  })

  const count_ranges = (x_domain: Vec2, x2_domain: Vec2) => {
    const count_cfg = { x_domain, x2_domain, bin_count: bins, range_padding }
    return {
      y: compute_count_range(axis_data.y1_series, {
        ...count_cfg,
        scale_type: final_y_axis.scale_type ?? `linear`,
        y_limit: log_safe_range(final_y_axis),
      }),
      y2: compute_count_range(axis_data.y2_series, {
        ...count_cfg,
        scale_type: final_y2_axis.scale_type ?? `linear`,
        y_limit: log_safe_range(final_y2_axis),
      }),
    }
  }

  let has_x2_points = $derived(axis_data.x2_extent.n_finite > 0)
  let has_y2_points = $derived(axis_data.y2_extent.n_finite > 0)

  let auto_ranges = $derived.by(() => {
    const auto_x = nice_range_from_extent(
      axis_data.x1_extent,
      final_x_axis.range ?? [null, null],
      final_x_axis.scale_type ?? `linear`,
      range_padding,
    )

    const auto_x2 = has_x2_points
      ? nice_range_from_extent(
          axis_data.x2_extent,
          final_x2_axis.range ?? [null, null],
          final_x2_axis.scale_type ?? `linear`,
          range_padding,
        )
      : ([0, 1] as Vec2)

    return { x: auto_x, x2: auto_x2, ...count_ranges(auto_x, auto_x2) }
  })
  // Histogram count ranges depend on the bin domain. Once FacetGrid resolves shared x domains,
  // re-bin against those domains before reporting y so the reconciled count range cannot clip bars.
  const intrinsic_ranges = $derived.by(() => {
    if (!facet_layout) return auto_ranges
    const x_domain = facet_layout.ranges.x ?? auto_ranges.x
    const x2_domain = facet_layout.ranges.x2 ?? auto_ranges.x2
    return { ...auto_ranges, ...count_ranges(x_domain, x2_domain) }
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
  let base_pad = $derived(filter_padding(padding, DEFAULT_PLOT_PADDING))
  const facet = create_facet_plot_adapter({
    axes: FACET_AXES,
    facet_layout: () => facet_layout,
    intrinsic_padding: () => base_pad,
    intrinsic_ranges: () => intrinsic_ranges,
    ranges: () => ranges.current,
  })
  const effective_base_pad = $derived(facet.padding(base_pad))
  const get_plot_ticks = (
    axis_scales: ReturnType<typeof create_axis_scales>,
    axis_ranges = ranges.current,
  ) => {
    const axis_ticks = (
      axis: typeof final_x_axis,
      range: Vec2,
      scale: typeof axis_scales.x,
      default_count: number,
      show = true,
    ) =>
      width && height && show
        ? generate_ticks(range, axis.scale_type ?? `linear`, axis.ticks, scale, {
            default_count,
          })
        : []
    return {
      x: axis_ticks(final_x_axis, axis_ranges.x, axis_scales.x, 8),
      x2: axis_ticks(final_x2_axis, axis_ranges.x2, axis_scales.x2, 8, has_x2_points),
      y: axis_ticks(final_y_axis, axis_ranges.y, axis_scales.y, 6),
      y2: axis_ticks(final_y2_axis, axis_ranges.y2, axis_scales.y2, 6, has_y2_points),
    }
  }

  $effect(() => {
    // Supports one-sided range pinning (null bounds fall back to auto); returns null for transient
    // non-finite bounds (skip: writing NaN breaks scales and loops here). y/y2 ranges are
    // log-sanitized so an invalid (<= 0) log lower falls back to the auto count minimum.
    const next = resolve_axis_ranges(
      {
        x: final_x_axis,
        x2: final_x2_axis,
        y: { range: log_safe_range(final_y_axis) },
        y2: { range: log_safe_range(final_y2_axis) },
      },
      auto_ranges,
    )
    if (!next) return
    // Update only changed axes (preserving each unchanged axis's panned current view).
    // untrack the reads of `ranges` so the writes below can't re-trigger this effect
    // (reading + writing the same state otherwise causes effect_update_depth_exceeded).
    const init = untrack(() => ranges.initial)
    for (const axis of [`x`, `x2`, `y`, `y2`] as const) {
      if (vec2_equal(init[axis], next[axis])) continue
      ranges.initial[axis] = next[axis]
      ranges.current[axis] = next[axis]
    }
    facet.apply_ranges()
  })

  // Layout: dynamic padding based on tick label widths
  // base_pad reserves space for tick labels/axis titles; pad (below) adds decoration reservations
  let tick_font = $state<Readonly<FontSpec> | undefined>()
  const title_config = $derived(normalize_plot_title(title))

  // Track tick values so x auto-rotation / bottom pad recompute when ticks change.
  // sides_equal stops the pad write from looping when nothing moved.
  $effect(() => {
    const padding_ranges = facet_layout ? intrinsic_ranges : ranges.current
    const padding_scales = create_axis_scales(
      { x: final_x_axis, x2: final_x2_axis, y: final_y_axis, y2: final_y2_axis },
      padding_ranges,
      base_pad,
      width,
      height,
    )
    const padding_x2_axis = has_x2_points ? final_x2_axis : {}
    const padding_y2_axis = has_y2_points ? final_y2_axis : {}
    const padding_ticks = get_plot_ticks(padding_scales, padding_ranges)
    const x_extent = { start: base_pad.l, end: width - base_pad.r }
    const y_extent = { start: height - base_pad.b, end: base_pad.t }
    const measure_axis = (
      axis: Partial<typeof final_x_axis>,
      axis_ticks: number[],
      scale: typeof padding_scales.x,
      extent: typeof x_extent,
    ) => measured_axis(axis, axis_ticks, scale, extent, tick_font)
    const axis_pad =
      width && height
        ? calc_auto_padding({
            padding,
            default_padding: DEFAULT_PLOT_PADDING,
            width,
            height,
            x_axis: measure_axis(final_x_axis, padding_ticks.x, padding_scales.x, x_extent),
            x2_axis: measure_axis(
              padding_x2_axis,
              padding_ticks.x2,
              padding_scales.x2,
              x_extent,
            ),
            y_axis: measure_axis(final_y_axis, padding_ticks.y, padding_scales.y, y_extent),
            y2_axis: measure_axis(
              padding_y2_axis,
              padding_ticks.y2,
              padding_scales.y2,
              y_extent,
            ),
          })
        : filter_padding(padding, DEFAULT_PLOT_PADDING)
    const new_pad = pad_for_plot_title(axis_pad, title_config, width, height)

    if (!sides_equal(base_pad, new_pad)) base_pad = new_pad
  })

  let legend_size_revision = $state(0)
  const legend_footprint = $derived.by(() => {
    void legend_size_revision
    return measured_footprint(legend_element, { width: 120, height: 60 })
  })
  const legend_has_explicit_pos = $derived(has_explicit_position(legend?.style))
  // Controls read the resolved auto value and write back an explicit override.
  const should_show_legend = $derived(
    resolve_legend_visibility(show_legend, legend, series.length),
  )

  // Obstacle field in normalized [0,1] plot coords (y=0 at top). Each filled bar is modeled as a
  // vertical segment (top -> baseline) so the legend can't hide inside a tall bar. Built from
  // histogram_bins (pad-independent) + ranges so the crowding decision can't see its own reservation.
  const obstacles_norm = $derived.by(() => {
    if (!width || !height || histogram_bins.length === 0) return []
    const base_w = width - effective_base_pad.l - effective_base_pad.r
    const base_h = height - effective_base_pad.t - effective_base_pad.b
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

  // Pass the histogram's `bins` as the marginal's histogram bin count (not strip thickness)
  // so a histogram marginal inherits the main binning; CDF marginals ignore it.
  const resolved_marginals = $derived(
    normalize_marginals(marginals, { top: { type: `cdf`, bins } }),
  )

  const legend_item = $derived(
    create_legend_decoration_item({
      enabled: should_show_legend && legend_element != null && !legend_has_explicit_pos,
      footprint: legend_footprint,
      items: series.map((series_data, series_idx) => ({
        label: series_data.label ?? `Series ${series_idx + 1}`,
        legend_group: series_data.legend_group,
      })),
      config: { ...legend, filter_query: legend_filter_query },
    }),
  )
  const base_decoration_solution = $derived.by(() =>
    solve_decorations({
      base_pad: effective_base_pad,
      width,
      height,
      obstacles_norm,
      items: legend_item ? [legend_item] : [],
    }),
  )
  const pad = $derived(
    add_sides(base_decoration_solution.pad, reserve_marginal_pad(resolved_marginals)),
  )
  // a lone series uses the configured bar color; with multiple, each gets its own
  const series_color = (series_data: DataSeries) =>
    selected_series.length === 1 ? final_bar.color : extract_series_color(series_data)
  const marginal_series = $derived<MarginalSeriesInput[]>(
    selected_series_entries.map(({ series_data }) => ({
      x: series_data.y ?? [],
      color: series_color(series_data),
      label: series_data.label,
      visible: true,
      x_axis: series_data.x_axis,
      y_axis: series_data.y_axis,
    })),
  )
  const marginal_has_axis = $derived(marginal_axis_presence(has_x2_points, has_y2_points))

  // Scales and data (x/x2 share the horizontal pixel span, y/y2 the inverted vertical one)
  let scales = $derived(
    create_axis_scales(
      { x: final_x_axis, x2: final_x2_axis, y: final_y_axis, y2: final_y2_axis },
      ranges.current,
      pad,
      width,
      height,
    ),
  )
  const decoration_solution = $derived(
    solve_reference_annotations({
      base_solution: base_decoration_solution,
      base_pad: pad,
      width,
      height,
      obstacles_norm,
      lines: indexed_ref_lines,
      ranges: ranges.current,
      scales,
    }),
  )
  const legend_placement = $derived(get_decoration_placement(decoration_solution, `legend`))
  const decoration_exclusion_rects = $derived(decoration_placement_rects(decoration_solution))

  // Pad-independent binning (no pixel scales) so the auto-place obstacle field can reuse it
  let histogram_bins = $derived.by(() => {
    if (selected_series.length === 0 || !width || !height) return []
    return compute_histogram_bins(selected_series_entries, {
      x_domain: ranges.current.x,
      x2_domain: ranges.current.x2,
      has_x2: has_x2_points,
      bin_count: bins,
      series_color,
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

  let ticks = $derived(get_plot_ticks(scales))

  // Use the same adaptive y/y2 bands for title placement that padding and PlotAxis render.
  let tick_label_widths = $derived.by(() => {
    const extent = { start: height - pad.b, end: pad.t }
    const band = Math.max(0, height - pad.t - pad.b)
    return {
      y_max: resolve_tick_layout(
        measured_axis(final_y_axis, ticks.y, scales.y, extent, tick_font),
        band,
        `y`,
      ).band,
      y2_max: resolve_tick_layout(
        measured_axis(final_y2_axis, ticks.y2, scales.y2, extent, tick_font),
        band,
        `y2`,
      ).band,
    }
  })

  let legend_data = $derived(build_legend_items(series, series_symbol_swatch))

  // Tweened legend coordinates with shared placement stability gating
  const legend_tween = create_placed_tween({
    placement: () =>
      !should_show_legend || !width || !height || legend_has_explicit_pos
        ? null
        : (legend_placement ?? null),
    dims: () => ({ width, height }),
    responsive: () => legend?.responsive ?? false,
    element: () => legend_element,
    tween: () => legend?.tween,
    on_element_resize: () => (legend_size_revision += 1),
  })

  // Shared pan/zoom/touch/drag-rect interaction controller
  const pan_zoom = create_pan_zoom({
    ranges: () => ranges.current,
    scale_type: (axis) =>
      ({ x: final_x_axis, x2: final_x2_axis, y: final_y_axis, y2: final_y2_axis })[axis]
        .scale_type,
    // Clamp to at least 1 to avoid Infinity deltas when padding equals container size
    plot_bounds: () => ({
      x: pad.l,
      y: pad.t,
      width: Math.max(1, width - pad.l - pad.r),
      height: Math.max(1, height - pad.t - pad.b),
    }),
    pan: () => pan,
    set_range: facet.update_range,
    svg: () => svg_element,
    on_rect_zoom: (start, current) => {
      // Update axis ranges to trigger reactivity and prevent effect from overriding
      const next_x = invert_rect_range(scales.x, start.x, current.x)
      if (!next_x) return
      if (!facet.update_range(`x`, next_x)) x_axis = { ...x_axis, range: next_x }
      // Gate x2/y2 on valid data: their scales are [0, 1] sentinels otherwise,
      // so inverting would store a phantom range in the bindable prop
      const next_x2 = has_x2_points ? invert_rect_range(scales.x2, start.x, current.x) : null
      if (next_x2 && !facet.update_range(`x2`, next_x2)) {
        x2_axis = { ...x2_axis, range: next_x2 }
      }
      const next_y = invert_rect_range(scales.y, start.y, current.y)
      if (next_y && !facet.update_range(`y`, next_y)) {
        y_axis = { ...y_axis, range: next_y }
      }
      const next_y2 = has_y2_points ? invert_rect_range(scales.y2, start.y, current.y) : null
      if (next_y2 && !facet.update_range(`y2`, next_y2)) {
        y2_axis = { ...y2_axis, range: next_y2 }
      }
    },
    on_reset: () => {
      if (facet.reset_ranges()) return
      // Reset zoom to initial ranges (undo any pan/zoom)
      ranges.current = {
        x: [...ranges.initial.x] as Vec2,
        x2: [...ranges.initial.x2] as Vec2,
        y: [...ranges.initial.y] as Vec2,
        y2: [...ranges.initial.y2] as Vec2,
      }
      // Also reset axis props so future data changes recalculate auto ranges
      x_axis = { ...x_axis, range: [null, null] }
      x2_axis = { ...x2_axis, range: [null, null] }
      y_axis = { ...y_axis, range: [null, null] }
      y2_axis = { ...y2_axis, range: [null, null] }
    },
  })
  onDestroy(() => pan_zoom.destroy())

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

  const legend_vis = create_legend_visibility(
    () => series,
    (next) => (series = next),
  )

  // Set theme-aware background when entering fullscreen
  $effect(() => set_fullscreen_bg(wrapper, fullscreen, `--histogram-fullscreen-bg`))

  // State accessors for shared axis change handler
  // Spread into existing state in each setter to preserve merged type structure
  const axis_state: AxisChangeState<DataSeries> = {
    axes: {
      x: { get: () => x_axis, set: (config) => (x_axis = { ...x_axis, ...config }) },
      x2: { get: () => x2_axis, set: (config) => (x2_axis = { ...x2_axis, ...config }) },
      y: { get: () => y_axis, set: (config) => (y_axis = { ...y_axis, ...config }) },
      y2: { get: () => y2_axis, set: (config) => (y2_axis = { ...y2_axis, ...config }) },
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

{#snippet ref_lines_layer(lines: readonly IndexedRefLine[])}
  <ReferenceLinesLayer
    {lines}
    ranges={ranges.current}
    {scales}
    {clip_path_id}
    {decoration_solution}
    bind:hovered_line_idx={hovered_ref_line_idx}
    on_click={on_ref_line_click}
    on_hover={on_ref_line_hover}
  />
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
  onblur={pan_zoom.on_window_blur}
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
      (title_config?.text ||
        [final_x_axis.label, final_y_axis.label].filter(Boolean).join(` vs `) ||
        `Histogram`)}
    tabindex="0"
    onfocusin={() => pan_zoom.set_focused(true)}
    onfocusout={() => pan_zoom.set_focused(false)}
    onmouseenter={() => (hovered = true)}
    onmousedown={pan_zoom.on_mouse_down}
    onmouseleave={() => {
      hovered = false
      hover_info = null
      on_bar_hover?.(null)
    }}
    ondblclick={pan_zoom.reset_view}
    onwheel={pan_zoom.on_wheel}
    ontouchstart={pan_zoom.on_touch_start}
    ontouchmove={pan_zoom.on_touch_move}
    ontouchend={pan_zoom.on_touch_end}
    ontouchcancel={pan_zoom.on_touch_end}
    style:cursor={pan_zoom.cursor}
    onkeydown={pan_zoom.on_key_down}
  >
    <PlotTitle
      config={title_config}
      x={effective_base_pad.l}
      y={decoration_solution.pad.t - effective_base_pad.t}
      width={Math.max(0, width - effective_base_pad.l - effective_base_pad.r)}
    />
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

    <ZoomRect start={pan_zoom.drag_start} current={pan_zoom.drag_current} />

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
      has_x2={has_x2_points}
      has_y2={has_y2_points}
      {width}
      {height}
      {pad}
    />

    <!-- Reference lines: below lines -->
    {@render ref_lines_layer(ref_lines_by_z.below_lines)}

    <!-- Reference lines: below points -->
    {@render ref_lines_layer(ref_lines_by_z.below_points)}

    <!-- X-axis -->
    {#if facet.axis_visible(`x`)}
      <PlotAxis
        side="x"
        ticks={ticks.x}
        place={scales.x}
        axis={final_x_axis}
        on_tick_font={(font) => (tick_font = font)}
        domain={ranges.current.x}
        {pad}
        {width}
        {height}
        show_grid={display.x_grid}
        tick_label={(tick) => get_tick_label(tick, final_x_axis.ticks)}
        label_x={(pad.l + width - pad.r) / 2 + (final_x_axis.label_shift?.x ?? 0)}
        label_y={height - pad.b + AXIS_TITLE_OFFSET + (final_x_axis.label_shift?.y ?? 0)}
        axis_loading={axis_loading === `x`}
        on_axis_change={(key) => handle_axis_change(`x`, key)}
      />
    {/if}

    <!-- X2-axis (Top) -->
    {#if has_x2_points && facet.axis_visible(`x2`)}
      <PlotAxis
        side="x2"
        ticks={ticks.x2}
        place={scales.x2}
        axis={final_x2_axis}
        domain={ranges.current.x2}
        {pad}
        {width}
        {height}
        show_grid={display.x2_grid}
        tick_label={(tick) => get_tick_label(tick, final_x2_axis.ticks)}
        label_x={(pad.l + width - pad.r) / 2 + (final_x2_axis.label_shift?.x ?? 0)}
        label_y={Math.max(12, pad.t - (final_x2_axis.label_shift?.y ?? AXIS_TITLE_OFFSET))}
        axis_loading={axis_loading === `x2`}
        on_axis_change={(key) => handle_axis_change(`x2`, key)}
      />
    {/if}

    <!-- Y-axis -->
    {#if facet.axis_visible(`y`)}
      <PlotAxis
        side="y"
        ticks={ticks.y}
        place={scales.y}
        axis={final_y_axis}
        domain={ranges.current.y}
        {pad}
        {width}
        {height}
        show_grid={display.y_grid}
        tick_label={(tick) => get_tick_label(tick, final_y_axis.ticks)}
        label_x={y_axis_label_x(final_y_axis, pad.l, tick_label_widths.y_max)}
        label_y={pad.t + (height - pad.t - pad.b) / 2 + (final_y_axis.label_shift?.y ?? 0)}
        axis_loading={axis_loading === `y`}
        on_axis_change={(key) => handle_axis_change(`y`, key)}
      />
    {/if}

    <!-- Y2-axis (Right) -->
    {#if has_y2_points && facet.axis_visible(`y2`)}
      <PlotAxis
        side="y2"
        ticks={ticks.y2}
        place={scales.y2}
        axis={final_y2_axis}
        domain={ranges.current.y2}
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
    {#each histogram_data as { id, bins, color, label, x_scale, y_scale, x_axis: srs_x_axis, y_axis, series_idx }, idx (id ?? idx)}
      <g
        class="histogram-series"
        data-series-idx={series_idx}
        clip-path="url(#{clip_path_id})"
        opacity={hovered_legend_series_idx !== null && hovered_legend_series_idx !== series_idx
          ? 0.25
          : 1}
      >
        {#each bins as bin, bin_idx (bin_idx)}
          {@const bar_x = x_scale(bin.x0!)}
          {@const bar_width = Math.max(1, Math.abs(x_scale(bin.x1!) - bar_x))}
          {@const bar_height = Math.max(0, height - pad.b - y_scale(bin.length))}
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

    <!-- Marginal distribution strips -->
    <PlotMarginals
      marginals={resolved_marginals}
      series={marginal_series}
      {width}
      {height}
      {pad}
      has_axis={marginal_has_axis}
      axes={{
        x1: marginal_axis(scales.x, ranges.current.x, final_x_axis),
        x2: marginal_axis(scales.x2, ranges.current.x2, final_x2_axis),
        y1: marginal_axis(scales.y, ranges.current.y, final_y_axis),
        y2: marginal_axis(scales.y2, ranges.current.y2, final_y2_axis),
      }}
      id={clip_path_id}
    />
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
      exclusion_rects={decoration_exclusion_rects}
      fallback_size={{ width: 120, height: mode === `overlay` ? 60 : 40 }}
    >
      {#if tooltip}
        {@render tooltip({ ...hover_info, fullscreen })}
      {:else}
        <div>Value: {format_value_or_num(value, hover_info.x_axis.format)}</div>
        <div>Count: {format_value_or_num(count, hover_info.y_axis.format)}</div>
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
      resolved_show_legend={should_show_legend}
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
      {has_x2_points}
      {has_y2_points}
      children={controls_extra}
    />
  {/if}

  {#if should_show_legend && legend}
    {@const solved_legend_pos = legend_placement ?? { x: pad.l + 10, y: pad.t + 10 }}
    {@const legend_pos =
      legend_placement?.location === `outside`
        ? solved_legend_pos
        : legend_tween.placed()
          ? legend_tween.coords.current
          : solved_legend_pos}
    <PlotLegend
      bind:root_element={legend_element}
      {...legend}
      bind:filter_query={legend_filter_query}
      layout_tracks={resolve_legend_layout_tracks(legend.layout_tracks, legend_placement)}
      series_data={legend_data}
      on_toggle={legend?.on_toggle ??
        ((series_idx: number) => {
          if (series_idx < 0 || series_idx >= series.length) return
          legend_vis.on_toggle(series_idx)
          on_series_toggle(series_idx)
        })}
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
    border-radius: var(--histogram-border-radius, 0);
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
    transition:
      opacity 0.2s,
      background-color 0.2s;
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
