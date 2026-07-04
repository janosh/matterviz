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
    BasePlotProps,
    ColorScaleConfig,
    ControlsConfig,
    DataLoaderFn,
    DataSeries,
    ErrorBand,
    FillHandlerEvent,
    FillRegion,
    HoverConfig,
    InternalPoint,
    LabelPlacementConfig,
    LegendConfig,
    PanConfig,
    PlotConfig,
    Point,
    RefLine,
    RefLineEvent,
    ScatterHandlerEvent,
    ScatterHandlerProps,
    SizeScaleConfig,
    StyleOverrides,
    UserContentProps,
  } from '$lib/plot'
  import {
    ColorBar,
    compute_element_placement,
    FillArea,
    get_tick_label,
    Line,
    PlotAxis,
    PlotLegend,
    PlotMarginals,
    PlotTooltip,
    ReferenceLine,
    ScatterPlotControls,
    ScatterPoint,
    ZeroLines,
    ZoomRect,
  } from '$lib/plot'
  import type { MarginalSeriesInput, MarginalsProp } from '$lib/plot/core/marginals'
  import {
    add_sides,
    marginal_axis,
    marginal_axis_presence,
    normalize_marginals,
    reserve_marginal_pad,
  } from '$lib/plot/core/marginals'
  import {
    build_obstacles_norm,
    has_explicit_position,
    measured_footprint,
    place_decorations,
  } from '$lib/plot/core/auto-place'
  import {
    AXIS_DEFAULTS,
    type AxisChangeState,
    create_axis_loader,
  } from '$lib/plot/core/axis-utils'
  import { get_series_color, get_series_symbol } from '$lib/plot/core/data-transform'
  import { create_placed_tween } from '$lib/plot/core/placed-tween.svelte'
  import {
    COLOR_BAR_DEFAULTS,
    DEFAULT_MARKERS,
    get_scale_type_name,
    is_time_scale,
    SCALE_DEFAULTS,
  } from '$lib/plot/core/types'
  import { compute_label_positions } from '$lib/plot/core/utils/label-placement'
  import { create_legend_visibility } from '$lib/plot/core/utils/series-visibility'
  import { DEFAULTS } from '$lib/settings'
  import { extent } from 'd3-array'
  import { scaleTime } from 'd3-scale'
  import type { ComponentProps, Snippet } from 'svelte'
  import { onDestroy, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { TweenOptions } from 'svelte/motion'
  import { SvelteSet } from 'svelte/reactivity'
  import type { Pt } from '$lib/plot/core/fill-utils'
  import {
    compute_fill_segments,
    convert_error_band_to_fill_region,
    generate_fill_path,
  } from '$lib/plot/core/fill-utils'
  import {
    expand_range_if_needed,
    get_relative_coords,
    invert_rect_range,
    normalize_y2_sync,
    sync_y2_range,
  } from '$lib/plot/core/interactions'
  import { create_pan_zoom } from '$lib/plot/core/pan-zoom.svelte'
  import type { Rect, Sides } from '$lib/plot/core/layout'
  import {
    calc_auto_padding,
    filter_padding,
    LABEL_GAP_DEFAULT,
    y2_axis_label_x,
    measure_full_footprint,
    measure_max_tick_width,
    sample_series_obstacle_points,
  } from '$lib/plot/core/layout'
  import type { IndexedRefLine } from '$lib/plot/core/reference-line'
  import { group_ref_lines_by_z, index_ref_lines } from '$lib/plot/core/reference-line'
  import {
    create_color_scale,
    create_scale,
    create_size_scale,
    generate_ticks,
    get_nice_data_range,
  } from '$lib/plot/core/scales'
  import { resolve_line_tween, unique_id } from '$lib/plot/core/utils'
  import { build_legend_data, filter_series_to_ranges, pick_tooltip_bg } from './scatter-data'

  let {
    series = $bindable([]),
    x_axis = $bindable({}),
    x2_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable(DEFAULTS.scatter.display),
    styles: styles_init = {},
    controls: controls_init = {},
    padding = {},
    range_padding = 0.05,
    current_x_value = null,
    tooltip_point = $bindable(null),
    selected_point = null,
    hovered = $bindable(false),
    tooltip,
    user_content,
    change = () => {},
    color_scale = SCALE_DEFAULTS.color,
    color_bar = {},
    size_scale = SCALE_DEFAULTS.size,
    label_placement_config = {},
    hover_config = {},
    legend = {},
    point_tween,
    line_tween,
    point_events,
    on_point_click,
    on_point_hover,
    fill_regions = $bindable([]),
    error_bands = [],
    on_fill_click,
    on_fill_hover,
    ref_lines = $bindable([]),
    on_ref_line_click,
    on_ref_line_hover,
    selected_series_idx = $bindable(0),
    wrapper = $bindable(),
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
    Omit<BasePlotProps, `change`> &
    PlotConfig & {
      series?: DataSeries<Metadata>[]
      styles?: StyleOverrides
      controls?: ControlsConfig
      current_x_value?: number | null
      tooltip_point?: InternalPoint<Metadata> | null
      selected_point?: { series_idx: number; point_idx: number } | null
      tooltip?: Snippet<[ScatterHandlerProps<Metadata>]>
      user_content?: Snippet<[UserContentProps]>
      header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
      controls_extra?: Snippet<
        [{ styles: StyleOverrides; selected_series_idx: number } & Required<PlotConfig>]
      >
      change?: (data: (Point<Metadata> & { series: DataSeries<Metadata> }) | null) => void
      color_scale?: ColorScaleConfig | D3InterpolateName
      size_scale?: SizeScaleConfig
      color_bar?:
        | (ComponentProps<typeof ColorBar> & {
            margin?: number | Sides
            tween?: TweenOptions<Point2D>
            responsive?: boolean // Allow colorbar to reposition if density changes (default: false)
            axis_clearance?: number // Min distance kept from plot edges/axes (default: 15)
          })
        | null
      label_placement_config?: Partial<LabelPlacementConfig>
      hover_config?: Partial<HoverConfig>
      legend?: LegendConfig | null
      point_tween?: TweenOptions<Point2D>
      line_tween?: TweenOptions<string>
      point_events?: Record<
        string,
        (payload: { point: InternalPoint<Metadata>; event: Event }) => void
      >
      on_point_click?: (data: ScatterHandlerEvent<Metadata>) => void
      on_point_hover?: (data: ScatterHandlerEvent<Metadata> | null) => void
      fill_regions?: FillRegion[] // Bindable for legend toggle support
      error_bands?: ErrorBand[]
      on_fill_click?: (event: FillHandlerEvent) => void
      on_fill_hover?: (event: FillHandlerEvent | null) => void
      ref_lines?: RefLine[] // Bindable for legend toggle support
      on_ref_line_click?: (event: RefLineEvent) => void
      on_ref_line_hover?: (event: RefLineEvent | null) => void
      selected_series_idx?: number
      wrapper?: HTMLDivElement
      // Interactive axis props
      data_loader?: DataLoaderFn<Metadata>
      on_axis_change?: (
        axis: `x` | `x2` | `y` | `y2`,
        key: string,
        new_series: DataSeries<Metadata>[],
      ) => void
      on_error?: (error: AxisLoadError) => void
      pan?: PanConfig
      marginals?: MarginalsProp
    } = $props()

  // Merged axis/display values with defaults (use $derived to avoid breaking $bindable)
  const final_x_axis = $derived({
    ...AXIS_DEFAULTS,
    label_shift: { x: 0, y: -40 }, // x-axis needs different label position
    ...x_axis,
  })
  const final_y_axis = $derived({ ...AXIS_DEFAULTS, ...y_axis })
  const final_x2_axis = $derived({
    ...AXIS_DEFAULTS,
    label_shift: { x: 0, y: 40 }, // x2-axis label above top edge
    ...x2_axis,
  })
  const final_y2_axis = $derived({ ...AXIS_DEFAULTS, ...y2_axis })
  // Cache time-axis check — used in ~10 places for scale/tick/tooltip logic
  let is_time_x = $derived(is_time_scale(final_x_axis.scale_type, final_x_axis.format))
  let is_time_x2 = $derived(is_time_scale(final_x2_axis.scale_type, final_x2_axis.format))
  const final_display = $derived({ ...DEFAULTS.scatter.display, ...display })
  // Local state for styles (initialized from prop, owned by this component for controls)
  // Using $state because styles has bindings in ScatterPlotControls
  // untrack() explicitly captures initial prop value (intentional - props provide initial config)
  let styles = $state(
    untrack(() => ({
      show_points: DEFAULTS.scatter.show_points,
      show_lines: DEFAULTS.scatter.show_lines,
      point: { ...DEFAULTS.scatter.point, ...styles_init?.point },
      line: { ...DEFAULTS.scatter.line, ...styles_init?.line },
      ...styles_init,
    })),
  )
  let controls = $derived({ show: true, open: false, ...controls_init })

  let [width, height] = $state([0, 0])
  let svg_element: SVGElement | null = $state(null) // Bind the SVG element

  // Track which specific control properties user has modified
  let touched = new SvelteSet<string>()

  // Unique component ID to avoid clipPath conflicts between multiple instances
  let component_id = $state(unique_id(`scatter`))
  let clip_path_id = $derived(`plot-area-clip-${component_id}`)

  // Assign stable IDs to series for keying
  let series_with_ids = $derived(
    series.map((srs: DataSeries<Metadata>, idx: number) => {
      if (!srs || typeof srs !== `object`) return srs
      // Use series.id if provided, otherwise fall back to index
      // prevents re-mounts when series are reordered if stable IDs are provided
      return { ...srs, _id: srs.id ?? idx }
    }),
  )

  // Zoom/pan state - track both initial (data-driven) and current (after pan/zoom) ranges
  let ranges = $state<{
    initial: { x: Vec2; x2: Vec2; y: Vec2; y2: Vec2 }
    current: { x: Vec2; x2: Vec2; y: Vec2; y2: Vec2 }
  }>({
    initial: { x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] },
    current: { x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] },
  })
  const legend_vis = create_legend_visibility(
    () => series,
    (next) => (series = next),
  )

  // Y2 axis sync configuration
  let y2_sync_config = $derived(normalize_y2_sync(y2_axis?.sync))
  // Track previous sync mode to detect changes (updated in $effect.pre to avoid race conditions)
  let prev_sync_mode = $state<string>(`none`)

  // Helper to compute synced y2 range or return fallback when sync disabled
  const get_synced_y2 = (y1_range: Vec2, fallback: Vec2): Vec2 =>
    y2_sync_config.mode !== `none`
      ? sync_y2_range(y1_range, ranges.initial.y2, y2_sync_config)
      : fallback

  // Effect to update y2 range when sync mode changes - use $effect.pre to capture
  // mode change before the main range-update effect runs, ensuring sync is applied
  // immediately when toggled (not delayed until next data change)
  $effect.pre(() => {
    const mode = y2_sync_config.mode
    if (mode !== prev_sync_mode) {
      // When sync mode becomes enabled (or changes), apply sync immediately
      if (mode !== `none`) {
        ranges.current.y2 = sync_y2_range(ranges.current.y, ranges.initial.y2, y2_sync_config)
      } else {
        // When switching to independent mode, reset Y2 to its data range
        ranges.current.y2 = [...ranges.initial.y2] as Vec2
      }
      prev_sync_mode = mode
    }
  })

  // Fill region hover state
  let hovered_fill_key = $state<string | null>(null)

  // Reference line hover state
  let hovered_ref_line_idx = $state<number | null>(null)

  // Interactive axis loading state
  let axis_loading = $state<`x` | `x2` | `y` | `y2` | null>(null)

  // State to hold the calculated label positions after simulation
  let label_positions = $state<Record<string, Point2D>>({})

  // State for legend dragging
  let legend_is_dragging = $state(false)
  let legend_drag_offset = $state<{ x: number; y: number }>({ x: 0, y: 0 })
  let legend_manual_position = $state<{ x: number; y: number } | null>(null)
  let hovered_legend_series_idx = $state<number | null>(null)

  // State for legend/colorbar placement stability
  let legend_element = $state<HTMLDivElement | undefined>()
  let colorbar_element = $state<HTMLDivElement | undefined>()

  // Module-level constants to avoid repeated allocations
  // Create and categorize points in a single pass (instead of 3 separate iterations)
  type SimplePoint = { x: number; y: number }
  let points_by_axis = $derived.by(() => {
    const all: SimplePoint[] = []
    const y1: SimplePoint[] = []
    const y2: SimplePoint[] = []
    const x2: SimplePoint[] = []

    for (const srs of series_with_ids) {
      if (!srs) continue
      const {
        x: xs,
        y: ys,
        visible = true,
        y_axis: series_y_axis = `y1`,
        x_axis: x_ax = `x1`,
      } = srs as DataSeries
      for (let idx = 0; idx < xs.length; idx++) {
        const point = { x: xs[idx], y: ys[idx] }
        all.push(point)
        if (visible) {
          if (series_y_axis === `y2`) y2.push(point)
          else y1.push(point)
          if (x_ax === `x2`) x2.push(point)
        }
      }
    }
    return { all, y1, y2, x2 }
  })

  let all_points = $derived(points_by_axis.all)
  let y1_points = $derived(points_by_axis.y1)
  let y2_points = $derived(points_by_axis.y2)
  let x2_points = $derived(points_by_axis.x2)

  // Layout: tick-label padding (decoration reservations are added in `pad` below)
  const default_padding = { t: 5, b: 50, l: 50, r: 20 }
  let base_pad = $state(untrack(() => filter_padding(padding, default_padding)))

  // Update padding when format or ticks change
  $effect(() => {
    const new_pad =
      width &&
      height &&
      (y_tick_values.length > 0 || y2_tick_values.length > 0 || x2_tick_values.length > 0)
        ? calc_auto_padding({
            padding,
            default_padding,
            x2_axis: { ...final_x2_axis, tick_values: x2_tick_values },
            y_axis: { ...final_y_axis, tick_values: y_tick_values },
            y2_axis: { ...final_y2_axis, tick_values: y2_tick_values },
          })
        : filter_padding(padding, default_padding)

    if (
      base_pad.t !== new_pad.t ||
      base_pad.b !== new_pad.b ||
      base_pad.l !== new_pad.l ||
      base_pad.r !== new_pad.r
    )
      base_pad = new_pad
  })

  // === Auto-move legend/colorbar outside the plot when interior overlap is unavoidable ===
  // (shared logic lives in auto-place.ts so every 2D plot reuses it)
  // ColorBar's orientation prop defaults to horizontal, so treat unset as horizontal too
  const colorbar_is_horizontal = $derived(
    (color_bar?.orientation ?? `horizontal`) === `horizontal`,
  )
  const colorbar_footprint = $derived(
    colorbar_element?.offsetWidth && colorbar_element?.offsetHeight
      ? measure_full_footprint(colorbar_element)
      : colorbar_is_horizontal
        ? COLOR_BAR_DEFAULTS.horizontal_footprint
        : COLOR_BAR_DEFAULTS.vertical_footprint,
  )
  const legend_footprint = $derived(
    measured_footprint(legend_element, { width: 120, height: 80 }),
  )
  const legend_has_explicit_pos = $derived(has_explicit_position(legend?.style))

  // Plot-specific obstacle field: series points/lines normalized to [0,1] (y=0 at top)
  const obstacles_norm = $derived.by(() => {
    if (!width || !height || !filtered_series) return []
    const base_w = width - base_pad.l - base_pad.r
    const base_h = height - base_pad.t - base_pad.b
    if (base_w <= 0 || base_h <= 0) return []
    const norm_x = is_time_x
      ? scaleTime()
          .domain([new Date(x_min), new Date(x_max)])
          .range([0, 1])
      : create_scale(final_x_axis.scale_type ?? `linear`, [x_min, x_max], [0, 1])
    const norm_y = create_scale(final_y_axis.scale_type ?? `linear`, [y_min, y_max], [0, 1])
    return build_obstacles_norm(
      filtered_series
        .filter((srs) => srs?.filtered_data)
        .map((srs) => ({
          points: srs.filtered_data.map((pt) => ({
            x: is_time_x ? norm_x(new Date(pt.x)) : norm_x(pt.x),
            y: 1 - norm_y(pt.y), // norm_y is 0 at bottom; invert so 0 = top
          })),
          draws_line: styles.show_lines && (srs.markers ?? DEFAULT_MARKERS).includes(`line`),
        })),
      base_w,
      base_h,
    )
  })

  const decor = $derived.by(() =>
    place_decorations({
      base_pad,
      width,
      height,
      obstacles_norm,
      // gate on legend_element (the actual render signal) not legend_data, whose fill entries read
      // computed_fills -> pad and would make this derived reference itself
      legend:
        legend != null &&
        legend_element != null &&
        !legend_has_explicit_pos &&
        !legend_is_dragging &&
        !legend_manual_position
          ? { footprint: legend_footprint, clearance: legend?.axis_clearance }
          : null,
      // gate on a measured colorbar: its outside style stretches it to full width, so deciding from
      // the (wide) pre-measure fallback would flip-flop placement between interior and outside
      colorbar:
        Boolean(color_bar) &&
        all_color_values.length > 0 &&
        !color_bar?.wrapper_style &&
        (colorbar_element?.offsetWidth ?? 0) > 0 &&
        (colorbar_element?.offsetHeight ?? 0) > 0
          ? {
              footprint: colorbar_footprint,
              horizontal: colorbar_is_horizontal,
              clearance: color_bar?.axis_clearance,
            }
          : null,
    }),
  )
  // Resolve marginals and reserve outer-band padding so the plot shrinks to make room
  const resolved_marginals = $derived(
    normalize_marginals(marginals, { top: true, right: true }),
  )
  const pad = $derived(add_sides(decor.pad, reserve_marginal_pad(resolved_marginals)))
  // Map series to the generic marginal input, reusing the line/legend color fallback
  const marginal_series = $derived<MarginalSeriesInput[]>(
    series_with_ids.map((srs, idx) => {
      const point_fill = Array.isArray(srs?.point_style)
        ? srs.point_style[0]?.fill
        : srs?.point_style?.fill
      return {
        x: srs?.x ?? [],
        y: srs?.y ?? [],
        color:
          srs?.line_style?.stroke ??
          point_fill ??
          get_series_color(srs?.orig_series_idx ?? idx),
        label: srs?.label,
        visible: srs?.visible ?? true,
        x_axis: srs?.x_axis,
        y_axis: srs?.y_axis,
      }
    }),
  )
  const marginal_has_axis = $derived(
    marginal_axis_presence(x2_points.length > 0, y2_points.length > 0),
  )
  const legend_auto_outside = $derived(decor.legend_outside)
  const legend_outside_x = $derived(decor.legend_pos.x)
  const legend_outside_y = $derived(decor.legend_pos.y)
  const effective_cbar_wrapper_style = $derived(
    color_bar?.wrapper_style ?? (decor.colorbar_outside ? decor.colorbar_style : undefined),
  )

  // Reactive clip area dimensions to ensure proper responsiveness
  let clip_area = $derived({
    x: pad.l || 0,
    y: pad.t || 0,
    width: isFinite(width - pad.l - pad.r) ? Math.max(1, width - pad.l - pad.r) : 1,
    height: isFinite(height - pad.t - pad.b) ? Math.max(1, height - pad.t - pad.b) : 1,
  })

  // Calculate plot area center coordinates
  let plot_center_x = $derived(pad.l + (width - pad.r - pad.l) / 2)
  let plot_center_y = $derived(pad.t + (height - pad.b - pad.t) / 2)

  // Extract color and size values in single pass (used for scale computations)
  let series_value_arrays = $derived.by(() => {
    const color_values: number[] = []
    const size_values: number[] = []
    for (const srs of series_with_ids) {
      if (!srs) continue
      const { color_values: cvs, size_values: svs } = srs as DataSeries
      if (cvs) {
        for (const val of cvs) if (val != null) color_values.push(val)
      }
      if (svs) {
        for (const val of svs) if (val != null) size_values.push(val)
      }
    }
    return { color_values, size_values }
  })
  let all_color_values = $derived(series_value_arrays.color_values)

  // Compute auto ranges based on data and limits
  let auto_x_range = $derived(
    get_nice_data_range(
      all_points,
      ({ x }) => x,
      final_x_axis.range ?? [null, null],
      final_x_axis.scale_type ?? `linear`,
      range_padding,
      is_time_x,
    ),
  )

  let auto_y_range = $derived(
    get_nice_data_range(
      y1_points,
      ({ y }) => y,
      final_y_axis.range ?? [null, null],
      final_y_axis.scale_type ?? `linear`,
      range_padding,
      false,
    ),
  )

  let auto_x2_range = $derived(
    get_nice_data_range(
      x2_points,
      ({ x }) => x,
      final_x2_axis.range ?? [null, null],
      final_x2_axis.scale_type ?? `linear`,
      range_padding,
      is_time_x2,
    ),
  )

  let auto_y2_range = $derived(
    get_nice_data_range(
      y2_points,
      ({ y }) => y,
      final_y2_axis.range ?? [null, null],
      final_y2_axis.scale_type ?? `linear`,
      range_padding,
      false,
    ),
  )

  // Update zoom ranges when auto ranges or explicit ranges change
  // - Explicit ranges (from zoom/pan): apply directly
  // - Auto ranges (from data changes): use lazy expansion to preserve view context
  $effect(() => {
    // Helper to get effective range (explicit ?? auto) and check if explicit
    const get_range = (
      axis: { range?: [number | null, number | null] },
      auto: Vec2,
    ): { explicit: boolean; range: Vec2 } => {
      const explicit = axis.range?.[0] != null && axis.range?.[1] != null
      const range = [axis.range?.[0] ?? auto[0], axis.range?.[1] ?? auto[1]] as Vec2
      return { explicit, range }
    }

    const resolved = {
      x: get_range(final_x_axis, auto_x_range),
      x2: get_range(final_x2_axis, auto_x2_range),
      y: get_range(final_y_axis, auto_y_range),
      y2: get_range(final_y2_axis, auto_y2_range),
    }

    // untrack reads of `ranges`: this effect also writes it, and tracked reads of the
    // deep proxy would re-trigger the effect on every current/initial write
    for (const axis of [`x`, `x2`, `y`] as const) {
      const { explicit, range } = resolved[axis]
      if (explicit) {
        ranges.current[axis] = range
      } else {
        const result = expand_range_if_needed(
          untrack(() => ranges.initial[axis]),
          range,
        )
        if (result.changed) {
          ranges.initial[axis] = result.range
          ranges.current[axis] = result.range
        }
      }
    }

    // Y2 axis: explicit → direct, else expand initial range then optionally sync
    if (resolved.y2.explicit) {
      ranges.current.y2 = resolved.y2.range
    } else {
      const result = expand_range_if_needed(
        untrack(() => ranges.initial.y2),
        resolved.y2.range,
      )
      if (result.changed) ranges.initial.y2 = result.range
      // Apply sync if enabled, otherwise use expanded range (or keep current if unchanged)
      if (y2_sync_config.mode !== `none`) {
        // Pan/zoom handlers sync y2 themselves.
        ranges.current.y2 = sync_y2_range(
          untrack(() => ranges.current.y),
          untrack(() => ranges.initial.y2),
          y2_sync_config,
        )
      } else if (result.changed) {
        ranges.current.y2 = result.range
      }
    }
  })

  let [x_min, x_max] = $derived(ranges.current.x)
  let [x2_min, x2_max] = $derived(ranges.current.x2)
  let [y_min, y_max] = $derived(ranges.current.y)
  let [y2_min, y2_max] = $derived(ranges.current.y2)

  // Create auto color range
  let auto_color_range = $derived(
    // Ensure we only calculate extent on actual numbers, filtering out nulls/undefined
    all_color_values.length > 0
      ? extent(
          all_color_values.filter(
            (color_val: number | null): color_val is number => typeof color_val === `number`,
          ),
        )
      : [0, 1],
  ) as Vec2

  // Create scale functions
  // For time scales, use scaleTime directly; otherwise use create_scale (supports linear/log/arcsinh)
  let x_scale_fn = $derived(
    is_time_x
      ? scaleTime()
          .domain([new Date(x_min), new Date(x_max)])
          .range([pad.l, width - pad.r])
      : create_scale(
          final_x_axis.scale_type ?? `linear`,
          [x_min, x_max],
          [pad.l, width - pad.r],
        ),
  )

  let x2_scale_fn = $derived(
    is_time_x2
      ? scaleTime()
          .domain([new Date(x2_min), new Date(x2_max)])
          .range([pad.l, width - pad.r])
      : create_scale(
          final_x2_axis.scale_type ?? `linear`,
          [x2_min, x2_max],
          [pad.l, width - pad.r],
        ),
  )

  let y_scale_fn = $derived(
    create_scale(final_y_axis.scale_type ?? `linear`, [y_min, y_max], [height - pad.b, pad.t]),
  )

  let y2_scale_fn = $derived(
    create_scale(
      final_y2_axis.scale_type ?? `linear`,
      [y2_min, y2_max],
      [height - pad.b, pad.t],
    ),
  )

  // All size values from series (for size scale) - extracted in series_value_arrays
  let all_size_values = $derived(series_value_arrays.size_values)

  // Size scale function (using shared utility)
  let size_scale_fn = $derived(create_size_scale(size_scale, all_size_values))

  // Color scale function (using shared utility)
  let color_scale_fn = $derived(create_color_scale(color_scale, auto_color_range))

  // Filter series data to only include points within bounds and augment with internal data
  let filtered_series = $derived(
    filter_series_to_ranges(series_with_ids, {
      x: [x_min, x_max],
      x2: [x2_min, x2_max],
      y: [y_min, y_max],
      y2: [y2_min, y2_max],
    }),
  )

  // Tally line series/points to budget path-morph tweens (see resolve_line_tween).
  // Disabling the morph for high-cardinality plots (e.g. phonon bands) keeps them
  // snappy; Line.svelte short-circuits the Tween when duration <= 0.
  let line_tween_load = $derived.by(() => {
    if (!styles.show_lines) return { series: 0, points: 0 }
    let [n_series, n_points] = [0, 0]
    for (const srs of filtered_series ?? []) {
      if (!(srs.markers ?? DEFAULT_MARKERS).includes(`line`)) continue
      n_series += 1
      n_points += srs.x.length
    }
    return { series: n_series, points: n_points }
  })
  let effective_line_tween = $derived(resolve_line_tween(line_tween, line_tween_load))

  // Obstacle field for legend/colorbar auto-placement. Sampling only data points lets the
  // legend land on top of a steep connecting line whose markers are sparse (e.g. y=x^2), so
  // sample_series_obstacle_points also walks each drawn segment at a fixed pixel cadence.
  const SEGMENT_SAMPLE_STEP = 12 // px between samples taken along a connecting line
  let plot_points_for_placement = $derived.by(() => {
    if (!width || !height || !filtered_series) return []

    const points: { x: number; y: number }[] = []

    for (const series_data of filtered_series) {
      if (!series_data?.filtered_data) continue
      const use_x2_scale = series_data.x_axis === `x2`
      const active_x_scale = use_x2_scale ? x2_scale_fn : x_scale_fn
      const active_is_time_x = use_x2_scale ? is_time_x2 : is_time_x
      const active_y_scale = series_data.y_axis === `y2` ? y2_scale_fn : y_scale_fn
      const draws_line =
        styles.show_lines && (series_data.markers ?? DEFAULT_MARKERS).includes(`line`)

      const pixel_points = series_data.filtered_data.map((point) => ({
        x: active_is_time_x ? active_x_scale(new Date(point.x)) : active_x_scale(point.x),
        y: active_y_scale(point.y),
      }))
      points.push(
        ...sample_series_obstacle_points(pixel_points, draws_line, SEGMENT_SAMPLE_STEP),
      )
    }
    return points
  })

  const fill_hover_key = (
    source_type: `fill_region` | `error_band`,
    source_idx: number,
    id?: string | number,
    is_duplicate_id = false,
  ): string => {
    if (id == null) return `${source_type}:idx:${source_idx}`
    if (is_duplicate_id) return `${source_type}:id:${id}:idx:${source_idx}`
    return `${source_type}:id:${id}`
  }
  const has_duplicate_id = <T extends { id?: string | number }>(
    items: readonly T[] | undefined,
    source_idx: number,
    id?: string | number,
  ): boolean =>
    id != null && (items?.some((item, idx) => idx !== source_idx && item.id === id) ?? false)

  // Computed fill regions: merge fill_regions and converted error_bands, resolve boundaries
  type ComputedFill = FillRegion & {
    idx: number
    source_type: `fill_region` | `error_band`
    source_idx: number
    hover_key: string
    path_segments: string[]
  }
  let computed_fills = $derived.by((): ComputedFill[] => {
    // Early exit: skip expensive computation if no fills to render
    const has_fill_regions = fill_regions && fill_regions.length > 0
    const has_error_bands = error_bands && error_bands.length > 0
    if (!has_fill_regions && !has_error_bands) return []

    // Merge fill_regions and converted error_bands, tracking source
    const all_regions: {
      region: FillRegion | null
      source_type: `fill_region` | `error_band`
      source_idx: number
      hover_key: string
    }[] = [
      ...(fill_regions ?? []).map((region, source_idx) => ({
        region,
        source_type: `fill_region` as const,
        source_idx,
        hover_key: fill_hover_key(
          `fill_region`,
          source_idx,
          region.id,
          has_duplicate_id(fill_regions, source_idx, region.id),
        ),
      })),
      ...(error_bands ?? []).map((band, source_idx) => ({
        region: convert_error_band_to_fill_region(band, series_with_ids),
        source_type: `error_band` as const,
        source_idx,
        hover_key: fill_hover_key(
          `error_band`,
          source_idx,
          band.id,
          has_duplicate_id(error_bands, source_idx, band.id),
        ),
      })),
    ]

    // On log axes, clamp non-positive coords to the scale's domain floor (x_min/y_min) before
    // scaling. A fixed tiny epsilon can sit far below the domain and map to extreme pixel coords.
    const x_scale_type = final_x_axis.scale_type ?? `linear`
    const y_scale_type = final_y_axis.scale_type ?? `linear`
    const to_px = (pt: Pt): Pt => ({
      x: x_scale_fn(x_scale_type === `log` && pt.x <= 0 ? x_min : pt.x),
      y: y_scale_fn(y_scale_type === `log` && pt.y <= 0 ? y_min : pt.y),
    })

    // Each boundary is traced through its own points with the same curve the series line uses,
    // so fill edges coincide exactly with the lines they border (x_domain anchors flat boundaries).
    const domains = {
      x_domain: [x_min, x_max] as Vec2,
      y_domain: [y_min, y_max] as Vec2,
      y2_domain: [y2_min, y2_max] as Vec2,
    }

    return all_regions
      .filter(
        (
          entry,
        ): entry is {
          region: FillRegion
          source_type: `fill_region` | `error_band`
          source_idx: number
          hover_key: string
        } => entry.region !== null,
      )
      .map(({ region, source_type, source_idx, hover_key }, idx) => {
        // Hidden fills keep their entry (with empty path_segments -> nothing renders) so the
        // legend item persists greyed-out and can be toggled back on.
        const hidden = region.visible === false
        const path_segments = hidden
          ? []
          : compute_fill_segments(region, series_with_ids, domains)
              .map((seg) =>
                generate_fill_path(
                  seg.upper.map(to_px),
                  seg.lower.map(to_px),
                  seg.upper_curve,
                  seg.lower_curve,
                ),
              )
              .filter((path) => path.length > 0)

        // Drop only visible fills with no geometry; keep hidden ones for the legend
        if (!hidden && path_segments.length === 0) return null

        return { ...region, idx, source_type, source_idx, hover_key, path_segments }
      })
      .filter((fill): fill is ComputedFill => fill !== null)
  })

  // Prepare data needed for the legend component
  let legend_data = $derived(
    build_legend_data(series_with_ids, computed_fills, color_scale_fn),
  )

  // Group fills by z-index for ordered rendering (single pass instead of 4 filters)
  let fills_by_z = $derived.by(() => {
    const groups: {
      below_grid: typeof computed_fills
      below_lines: typeof computed_fills
      below_points: typeof computed_fills
      above_all: typeof computed_fills
    } = { below_grid: [], below_lines: [], below_points: [], above_all: [] }

    for (const fill of computed_fills) {
      if (fill.z_index === `below-grid`) groups.below_grid.push(fill)
      else if (fill.z_index === `below-points`) groups.below_points.push(fill)
      else if (fill.z_index === `above-all`) groups.above_all.push(fill)
      else groups.below_lines.push(fill) // default: no z_index or 'below-lines'
    }
    return groups
  })

  // Compute ref_lines with index and group by z-index (using shared utilities)
  let indexed_ref_lines = $derived(index_ref_lines(ref_lines))
  let ref_lines_by_z = $derived(group_ref_lines_by_z(indexed_ref_lines))

  // Calculate best legend placement using continuous grid sampling
  let legend_placement = $derived.by(() => {
    const should_place =
      legend != null && (legend_data.length > 1 || Object.keys(legend ?? {}).length > 0)

    if (!should_place || !width || !height) return null

    const plot_width = width - pad.l - pad.r
    const plot_height = height - pad.t - pad.b

    const placement_config = {
      plot_bounds: { x: pad.l, y: pad.t, width: plot_width, height: plot_height },
      element: legend_element,
      element_size: { width: 120, height: 80 }, // fallback before first render
      axis_clearance: legend?.axis_clearance,
      exclude_rects: [],
      points: plot_points_for_placement,
    }

    return compute_element_placement(placement_config)
  })

  // Calculate color bar placement (coordinates with legend to avoid overlap)
  let color_bar_placement = $derived.by(() => {
    if (!color_bar || all_color_values.length === 0 || !width || !height) return null

    const plot_width = width - pad.l - pad.r
    const plot_height = height - pad.t - pad.b

    // Fallback estimate (with room for tick labels) used before the colorbar first
    // renders; compute_element_placement measures the real footprint once it's laid out
    const is_horizontal = (color_bar.orientation ?? `horizontal`) === `horizontal`
    const colorbar_size = is_horizontal
      ? COLOR_BAR_DEFAULTS.horizontal_footprint
      : COLOR_BAR_DEFAULTS.vertical_footprint

    // Build exclusion rects (avoid legend if it's placed)
    const exclude_rects: Rect[] = []
    if (legend_element && legend_placement) {
      exclude_rects.push({
        x: legend_placement.x,
        y: legend_placement.y,
        width: legend_element.offsetWidth || 120,
        height: legend_element.offsetHeight || 80,
      })
    }

    return compute_element_placement({
      plot_bounds: { x: pad.l, y: pad.t, width: plot_width, height: plot_height },
      element: colorbar_element,
      element_size: colorbar_size,
      // Small gap from the corner; the full-footprint measurement reserves the tick
      // labels, so this alone keeps the colorbar off the axes
      axis_clearance: color_bar?.axis_clearance ?? 15,
      exclude_rects,
      points: plot_points_for_placement,
    })
  })

  // Active legend placement (null if user set explicit position)
  let active_legend_placement = $derived.by(() => {
    if (!legend_placement) return null

    // Skip auto-placement if user set explicit position in style
    const legend_style = legend?.style ?? ``
    if (
      /(?:^|[;{]\s*)(?:top|bottom|left|right)\s*:|position\s*:\s*absolute/.test(legend_style)
    )
      return null

    return legend_placement
  })

  // Tweened colorbar/legend coordinates with shared placement stability gating
  const colorbar_tween = create_placed_tween({
    placement: () => color_bar_placement,
    dims: () => ({ width, height }),
    responsive: () => color_bar?.responsive ?? false,
    element: () => colorbar_element,
    tween: () => color_bar?.tween,
  })
  const legend_tween = create_placed_tween({
    placement: () => active_legend_placement,
    dims: () => ({ width, height }),
    responsive: () => legend?.responsive ?? false,
    element: () => legend_element,
    tween: () => legend?.tween,
    // Leave coords alone mid-drag; once dragged, the manual position wins permanently
    suspended: () => legend_is_dragging,
    manual_position: () => legend_manual_position,
  })

  // Generate axis ticks - consolidated into single derived for efficiency
  let axis_ticks = $derived.by(() => {
    if (!width || !height) return { x: [], x2: [], y: [], y2: [] }

    // X-axis ticks: choose appropriate scale for tick generation
    // Time scales (format starts with %) use scaleTime for better tick placement
    const x_scale_for_ticks = is_time_x
      ? scaleTime().domain([new Date(x_min), new Date(x_max)])
      : create_scale(final_x_axis.scale_type ?? `linear`, [x_min, x_max], [0, 1])

    const x2_scale_for_ticks = is_time_x2
      ? scaleTime().domain([new Date(x2_min), new Date(x2_max)])
      : create_scale(final_x2_axis.scale_type ?? `linear`, [x2_min, x2_max], [0, 1])

    return {
      x: generate_ticks(
        [x_min, x_max],
        final_x_axis.scale_type ?? `linear`,
        final_x_axis.ticks,
        x_scale_for_ticks,
        { format: final_x_axis.format },
      ),
      x2:
        x2_points.length > 0
          ? generate_ticks(
              [x2_min, x2_max],
              final_x2_axis.scale_type ?? `linear`,
              final_x2_axis.ticks,
              x2_scale_for_ticks,
              { format: final_x2_axis.format },
            )
          : [],
      y: generate_ticks(
        [y_min, y_max],
        final_y_axis.scale_type ?? `linear`,
        final_y_axis.ticks,
        y_scale_fn,
        { default_count: 5 },
      ),
      y2:
        y2_points.length > 0
          ? generate_ticks(
              [y2_min, y2_max],
              final_y2_axis.scale_type ?? `linear`,
              final_y2_axis.ticks,
              y2_scale_fn,
              { default_count: 5 },
            )
          : [],
    }
  })

  let x_tick_values = $derived(axis_ticks.x)
  let x2_tick_values = $derived(axis_ticks.x2)
  let y_tick_values = $derived(axis_ticks.y)
  let y2_tick_values = $derived(axis_ticks.y2)

  // Cache measured tick-label widths so expensive text measurement only runs
  // when tick values/format change, not on every template rerender.
  let tick_label_widths = $derived({
    x2_max: measure_max_tick_width(x2_tick_values, final_x2_axis.format ?? ``),
    y_max: measure_max_tick_width(y_tick_values, final_y_axis.format ?? ``),
    y2_max: measure_max_tick_width(y2_tick_values, final_y2_axis.format ?? ``),
  })

  // Shared pan/zoom/touch/drag-rect interaction controller. set_range routes y2
  // writes through get_synced_y2 (write-order contract: y is written before y2, so
  // the sync reads the just-updated y range).
  const pan_zoom = create_pan_zoom({
    ranges: () => ranges.current,
    scale_type: (axis) =>
      ({ x: final_x_axis, x2: final_x2_axis, y: final_y_axis, y2: final_y2_axis })[axis]
        .scale_type,
    // Clamp to at least 1 to avoid Infinity deltas when padding equals container size
    plot_dims: () => ({
      width: Math.max(1, width - pad.l - pad.r),
      height: Math.max(1, height - pad.t - pad.b),
    }),
    pan: () => pan,
    set_range: (axis, range) => {
      if (axis === `y2`) ranges.current.y2 = get_synced_y2(ranges.current.y, range)
      else ranges.current[axis] = range
    },
    svg: () => svg_element,
    on_rect_zoom: (start, current) => {
      // Update axis ranges to trigger reactivity; both x and y must invert to valid
      // (finite, non-degenerate) ranges or the rect zoom is discarded entirely
      const next_x = invert_rect_range(x_scale_fn, start.x, current.x)
      const next_y = invert_rect_range(y_scale_fn, start.y, current.y)
      if (!next_x || !next_y) return
      x_axis = { ...x_axis, range: next_x }
      y_axis = { ...y_axis, range: next_y }

      // X2 axis: invert screen coords using x2 scale
      const next_x2 =
        x2_points.length > 0 ? invert_rect_range(x2_scale_fn, start.x, current.x) : null
      if (next_x2) x2_axis = { ...x2_axis, range: next_x2 }

      // Y2 axis: when sync is enabled the y_axis effect derives y2; with sync 'none'
      // y2 must zoom from the rect directly (parity with BarPlot/Histogram/BoxPlot)
      const next_y2 =
        y2_points.length > 0 && y2_sync_config.mode === `none`
          ? invert_rect_range(y2_scale_fn, start.y, current.y)
          : null
      if (next_y2) y2_axis = { ...y2_axis, range: next_y2 }
    },
    on_reset: () => {
      // Reset to current auto ranges (not stale initial ranges which may have expanded)
      // This ensures lazy expansion restarts fresh from current data bounds
      ranges.initial = {
        x: [...auto_x_range] as Vec2,
        x2: [...auto_x2_range] as Vec2,
        y: [...auto_y_range] as Vec2,
        y2: [...auto_y2_range] as Vec2,
      }
      ranges.current = {
        x: [...auto_x_range] as Vec2,
        x2: [...auto_x2_range] as Vec2,
        y: [...auto_y_range] as Vec2,
        y2: get_synced_y2(auto_y_range, [...auto_y2_range] as Vec2),
      }
      // Also reset axis props so future data changes recalculate auto ranges
      x_axis = { ...x_axis, range: [null, null] }
      x2_axis = { ...x2_axis, range: [null, null] }
      y_axis = { ...y_axis, range: [null, null] }
      y2_axis = { ...y2_axis, range: [null, null] }
    },
    // Live tooltip while rect-dragging: update for the closest point inside the
    // plot bounds, clear when the cursor leaves the svg
    on_drag_move: (coords, inside_svg) => {
      if (inside_svg) update_tooltip_point(coords.x, coords.y)
      else tooltip_point = null
    },
  })
  onDestroy(() => pan_zoom.destroy())

  // tooltip logic: find closest point and update tooltip state
  function update_tooltip_point(x_rel: number, y_rel: number, evt?: MouseEvent) {
    if (!width || !height) return

    let closest_point: InternalPoint<Metadata> | null = null
    let closest_series: DataSeries<Metadata> | null = null
    let min_screen_dist_sq = Infinity
    const { threshold_px = 20 } = hover_config // Use configured threshold
    const hover_threshold_px_sq = threshold_px * threshold_px

    // Iterate through points to find the closest one in screen coordinates
    for (const series_data of filtered_series) {
      if (!series_data?.filtered_data) continue

      const tooltip_use_x2 = series_data.x_axis === `x2`
      const tooltip_x_scale = tooltip_use_x2 ? x2_scale_fn : x_scale_fn
      const tooltip_is_time_x = tooltip_use_x2 ? is_time_x2 : is_time_x
      for (const point of series_data.filtered_data) {
        // Calculate screen coordinates of the point
        const point_cx = tooltip_is_time_x
          ? tooltip_x_scale(new Date(point.x))
          : tooltip_x_scale(point.x)
        const point_cy = (series_data.y_axis === `y2` ? y2_scale_fn : y_scale_fn)(point.y)

        // Calculate squared screen distance between mouse and point
        const screen_dx = x_rel - point_cx
        const screen_dy = y_rel - point_cy
        const screen_distance_sq = screen_dx * screen_dx + screen_dy * screen_dy

        // Update if this point is closer
        if (screen_distance_sq < min_screen_dist_sq) {
          min_screen_dist_sq = screen_distance_sq
          closest_point = point
          closest_series = series_data
        }
      }
    }

    // Check if the closest point is within the hover threshold
    if (closest_point && closest_series && min_screen_dist_sq <= hover_threshold_px_sq) {
      // Construct handler props synchronously to avoid stale derived reads
      const props = construct_handler_props(closest_point)
      tooltip_point = closest_point
      // Construct object matching change signature
      const { x, y, metadata } = closest_point
      change({ x, y, metadata, series: closest_series })
      // Call hover handler with synchronously constructed props
      if (evt && props) {
        on_point_hover?.({ ...props, event: evt, point: closest_point })
      }
    } else {
      tooltip_point = null
      change(null)
      on_point_hover?.(null)
    }
  }

  function on_mouse_move(evt: MouseEvent) {
    hovered = true

    const coords = get_relative_coords(evt)
    if (!coords) return

    update_tooltip_point(coords.x, coords.y, evt)
  }

  // Merge user config with defaults before the effect that uses it
  let actual_label_config = $derived({
    sa_iterations: 2000,
    max_labels: 300,
    leader_line_threshold: 15,
    ...label_placement_config,
  })

  $effect(() => {
    if (!width || !height) {
      label_positions = {}
      return
    }

    label_positions = compute_label_positions(
      filtered_series,
      actual_label_config,
      { x_scale_fn, y_scale_fn, y2_scale_fn, x_axis: final_x_axis },
      { width, height, pad },
    )
  })

  // Legend drag handlers
  function handle_legend_drag_start(event: MouseEvent) {
    if (!svg_element) return

    legend_is_dragging = true

    // Get the actual rendered position of the legend element (accounts for transforms)
    const legend_el = event.currentTarget
    if (!(legend_el instanceof HTMLElement)) return
    const legend_rect = legend_el.getBoundingClientRect()

    // Calculate offset from mouse to legend's actual rendered position relative to SVG
    const [x, y] = [event.clientX - legend_rect.left, event.clientY - legend_rect.top]
    legend_drag_offset = { x, y }
  }

  function handle_legend_drag(event: MouseEvent) {
    if (!legend_is_dragging || !svg_element || !legend_element) return

    const svg_rect = svg_element.getBoundingClientRect()

    // Calculate new position: mouse position relative to SVG, minus the offset within the legend
    const new_x = event.clientX - svg_rect.left - legend_drag_offset.x
    const new_y = event.clientY - svg_rect.top - legend_drag_offset.y

    // Get actual legend dimensions for accurate bounds checking using the bound element reference
    const { width: legend_width, height: legend_height } =
      legend_element.getBoundingClientRect()

    // Constrain to plot bounds using measured legend size
    const constrained_x = Math.max(0, Math.min(width - legend_width, new_x))
    const constrained_y = Math.max(0, Math.min(height - legend_height, new_y))

    legend_manual_position = { x: constrained_x, y: constrained_y }
  }

  function get_screen_coords(point: Point, data_series?: DataSeries): Vec2 {
    // convert data coordinates to potentially non-finite screen coordinates
    const use_x2 = data_series?.x_axis === `x2`
    const active_x_scale = use_x2 ? x2_scale_fn : x_scale_fn
    const active_is_time_x = use_x2 ? is_time_x2 : is_time_x
    const screen_x = active_is_time_x
      ? active_x_scale(new Date(point.x))
      : active_x_scale(point.x)

    const y_val = point.y
    // Determine which y-scale to use based on series y_axis property
    const use_y2 = data_series?.y_axis === `y2`
    const y_scale = use_y2 ? y2_scale_fn : y_scale_fn
    const y_scale_type = use_y2
      ? get_scale_type_name(final_y2_axis.scale_type)
      : get_scale_type_name(final_y_axis.scale_type)
    // Only log scale needs domain clamping; linear and arcsinh can handle any value
    const min_domain_y = y_scale_type === `log` ? y_scale.domain()[0] : -Infinity
    const safe_y_val = y_scale_type === `log` ? Math.max(y_val, min_domain_y) : y_val
    const screen_y = y_scale(safe_y_val) // This might be non-finite

    return [screen_x, screen_y]
  }

  // Helper function to construct ScatterHandlerProps synchronously from InternalPoint
  function construct_handler_props(
    point: InternalPoint<Metadata>,
  ): ScatterHandlerProps<Metadata> | null {
    const hovered_series = series_with_ids[point.series_idx]
    if (!hovered_series) return null
    const { x, y, color_value, metadata, series_idx } = point
    const handler_use_x2 = hovered_series.x_axis === `x2`
    const handler_x_scale = handler_use_x2 ? x2_scale_fn : x_scale_fn
    const handler_is_time_x = handler_use_x2 ? is_time_x2 : is_time_x
    const cx = handler_is_time_x ? handler_x_scale(new Date(x)) : handler_x_scale(x)
    const cy = (hovered_series.y_axis === `y2` ? y2_scale_fn : y_scale_fn)(y)
    const active_x_config = handler_use_x2 ? final_x2_axis : final_x_axis
    const active_y_config = hovered_series.y_axis === `y2` ? final_y2_axis : final_y_axis
    const coords = {
      x,
      y,
      cx,
      cy,
      x_axis: active_x_config,
      x2_axis: final_x2_axis,
      y_axis: active_y_config,
      y2_axis: final_y2_axis,
    }
    return {
      ...coords,
      fullscreen,
      metadata,
      label: hovered_series.label ?? null,
      series_idx,
      x_formatted: format_value(x, active_x_config.format || `.3~s`),
      y_formatted: format_value(y, active_y_config.format || `.3~s`),
      color_value: color_value ?? null,
      colorbar: {
        value: color_value ?? null,
        title: color_bar?.title ?? null,
        scale: color_scale,
        tick_format: color_bar?.tick_format ?? null,
      },
    }
  }

  // Derive handler props from hovered point for both tooltip and event handlers
  let handler_props = $derived.by((): ScatterHandlerProps<Metadata> | null => {
    if (!tooltip_point) return null
    return construct_handler_props(tooltip_point)
  })

  let has_multiple_series = $derived(series_with_ids.filter(Boolean).length > 1)

  // Precompute non-click event names from point_events so we don't rebuild
  // the entries array on every point render.
  let point_event_names = $derived(
    point_events ? Object.keys(point_events).filter((name) => name !== `onclick`) : [],
  )

  // Set theme-aware background when entering fullscreen
  $effect(() => {
    set_fullscreen_bg(wrapper, fullscreen, `--scatter-fullscreen-bg`)
  })

  // State accessors for shared axis change handler
  // Spread into existing state in each setter to preserve merged type structure
  const axis_state: AxisChangeState<DataSeries<Metadata>> = {
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

{#snippet fill_regions_layer(fills: typeof computed_fills)}
  {#each fills as fill (fill.hover_key)}
    {#each fill.path_segments as path_d, segment_idx (`${fill.id ?? fill.idx}-${segment_idx}`)}
      <FillArea
        region={fill}
        region_idx={fill.idx}
        path={path_d}
        {clip_path_id}
        {x_scale_fn}
        {y_scale_fn}
        is_hovered={hovered_fill_key === fill.hover_key}
        on_click={(event: FillHandlerEvent) => {
          fill.on_click?.(event)
          on_fill_click?.(event)
        }}
        on_hover={(event: FillHandlerEvent | null) => {
          hovered_fill_key = event ? fill.hover_key : null
          fill.on_hover?.(event)
          on_fill_hover?.(event)
        }}
      />
    {/each}
  {/each}
{/snippet}

{#snippet ref_lines_layer(lines: IndexedRefLine[])}
  {#each lines as line (line.id ?? line.idx)}
    <ReferenceLine
      ref_line={line}
      line_idx={line.idx}
      x_min={line.x_axis === `x2` ? x2_min : x_min}
      x_max={line.x_axis === `x2` ? x2_max : x_max}
      y_min={line.y_axis === `y2` ? y2_min : y_min}
      y_max={line.y_axis === `y2` ? y2_max : y_max}
      x_scale={x_scale_fn}
      x2_scale={x2_scale_fn}
      y_scale={y_scale_fn}
      y2_scale={y2_scale_fn}
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
  class={[`scatter`, rest.class]}
  class:fullscreen
>
  {#if width && height}
    <div class="header-controls">
      {@render header_controls?.({ height, width, fullscreen })}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <svg
      bind:this={svg_element}
      role="application"
      aria-label={rest[`aria-label`] ??
        ([final_x_axis.label, final_y_axis.label].filter(Boolean).join(` vs `) ||
          `Scatter plot`)}
      tabindex="0"
      onfocusin={() => pan_zoom.set_focused(true)}
      onfocusout={() => pan_zoom.set_focused(false)}
      onmouseenter={() => (hovered = true)}
      onmousedown={pan_zoom.on_mouse_down}
      onmousemove={(evt: MouseEvent) => {
        // Only find closest point if not actively dragging
        if (!pan_zoom.drag_start && !pan_zoom.is_pan_dragging) on_mouse_move(evt)
      }}
      onmouseleave={() => {
        hovered = false
        tooltip_point = null
        on_point_hover?.(null)
      }}
      ondblclick={pan_zoom.reset_view}
      onkeydown={pan_zoom.on_key_down}
      onwheel={pan_zoom.on_wheel}
      ontouchstart={pan_zoom.on_touch_start}
      ontouchmove={pan_zoom.on_touch_move}
      ontouchend={pan_zoom.on_touch_end}
      ontouchcancel={pan_zoom.on_touch_end}
      style:cursor={pan_zoom.cursor}
    >
      {@render user_content?.({
        height,
        width,
        x_scale_fn,
        x2_scale_fn,
        y_scale_fn,
        y2_scale_fn,
        pad,
        x_range: [x_min, x_max],
        x2_range: [x2_min, x2_max],
        y_range: [y_min, y_max],
        y2_range: [y2_min, y2_max],
        fullscreen,
      })}

      <!-- Fill regions: below grid -->
      {@render fill_regions_layer(fills_by_z.below_grid)}
      <!-- Reference lines: below grid -->
      {@render ref_lines_layer(ref_lines_by_z.below_grid)}

      <PlotAxis
        side="x"
        ticks={x_tick_values}
        place={(tick) => (is_time_x ? x_scale_fn(new Date(tick)) : x_scale_fn(tick))}
        axis={final_x_axis}
        {pad}
        {width}
        {height}
        show_grid={final_display.x_grid}
        show_baseline={false}
        domain={[x_min, x_max]}
        tick_label={(tick) => get_tick_label(tick, final_x_axis.ticks)}
        label_x={width / 2 + (final_x_axis.label_shift?.x ?? 0)}
        label_y={height - pad.b - (final_x_axis.label_shift?.y ?? -40)}
        axis_loading={axis_loading === `x`}
        on_axis_change={(key) => handle_axis_change(`x`, key)}
      />

      <!-- Current frame indicator -->
      {#if current_x_value != null}
        {@const current_pos_raw = is_time_x
          ? x_scale_fn(new Date(current_x_value))
          : x_scale_fn(current_x_value)}
        {#if isFinite(current_pos_raw)}
          {@const current_pos = current_pos_raw}
          {#if current_pos >= pad.l && current_pos <= width - pad.r}
            {@const active_tick_height = 7}
            <rect
              x={current_pos - 1.5}
              y={height - pad.b - active_tick_height / 2}
              width="3"
              height={active_tick_height}
              fill="var(--scatter-current-frame-color, #ff6b35)"
              stroke="white"
              stroke-width="1"
              class="current-frame-indicator"
            />
          {/if}
        {/if}
      {/if}

      <PlotAxis
        side="y"
        ticks={y_tick_values}
        place={y_scale_fn}
        axis={final_y_axis}
        {pad}
        {width}
        {height}
        show_grid={final_display.y_grid}
        show_baseline={false}
        domain={[y_min, y_max]}
        unit_on_first_tick
        tick_label={(tick) => get_tick_label(tick, final_y_axis.ticks)}
        label_x={Math.max(
          12,
          pad.l -
            (final_y_axis.tick?.label?.inside ? 0 : tick_label_widths.y_max) -
            LABEL_GAP_DEFAULT,
        ) + (final_y_axis.label_shift?.x ?? 0)}
        label_y={pad.t + (height - pad.t - pad.b) / 2 + (final_y_axis.label_shift?.y ?? 0)}
        axis_loading={axis_loading === `y`}
        on_axis_change={(key) => handle_axis_change(`y`, key)}
      />

      <!-- Y2-axis (Right) -->
      {#if y2_points.length > 0}
        <PlotAxis
          side="y2"
          ticks={y2_tick_values}
          place={y2_scale_fn}
          axis={final_y2_axis}
          {pad}
          {width}
          {height}
          show_grid={final_display.y2_grid}
          show_baseline={false}
          domain={[y2_min, y2_max]}
          unit_on_first_tick
          tick_label={(tick) => get_tick_label(tick, final_y2_axis.ticks)}
          label_x={y2_axis_label_x(final_y2_axis, width, pad.r, tick_label_widths.y2_max)}
          label_y={pad.t + (height - pad.t - pad.b) / 2 + (final_y2_axis.label_shift?.y ?? 0)}
          axis_loading={axis_loading === `y2`}
          on_axis_change={(key) => handle_axis_change(`y2`, key)}
        />
      {/if}

      <!-- X2-axis (Top) -->
      {#if x2_points.length > 0}
        <PlotAxis
          side="x2"
          ticks={x2_tick_values}
          place={(tick) => (is_time_x2 ? x2_scale_fn(new Date(tick)) : x2_scale_fn(tick))}
          axis={final_x2_axis}
          {pad}
          {width}
          {height}
          show_grid={final_display.x2_grid}
          show_baseline={false}
          domain={[x2_min, x2_max]}
          tick_label={(tick) => get_tick_label(tick, final_x2_axis.ticks)}
          label_x={width / 2 + (final_x2_axis.label_shift?.x ?? 0)}
          label_y={Math.max(12, pad.t - (final_x2_axis.label_shift?.y ?? 40))}
          axis_loading={axis_loading === `x2`}
          on_axis_change={(key) => handle_axis_change(`x2`, key)}
        />
      {/if}

      <!-- Tooltip rendered inside overlay (moved outside SVG for stacking above colorbar) -->

      <ZoomRect start={pan_zoom.drag_start} current={pan_zoom.drag_current} />

      <ZeroLines
        display={final_display}
        {x_scale_fn}
        {x2_scale_fn}
        {y_scale_fn}
        {y2_scale_fn}
        x_range={ranges.current.x}
        x2_range={ranges.current.x2}
        y_range={ranges.current.y}
        y2_range={ranges.current.y2}
        x_scale_type={final_x_axis.scale_type}
        x2_scale_type={final_x2_axis.scale_type}
        y_scale_type={final_y_axis.scale_type}
        y2_scale_type={final_y2_axis.scale_type}
        x_is_time={is_time_x}
        x2_is_time={is_time_x2}
        has_x2={x2_points.length > 0}
        has_y2={y2_points.length > 0}
        {width}
        {height}
        {pad}
      />

      <defs>
        <clipPath id={clip_path_id}>
          <rect
            x={clip_area.x}
            y={clip_area.y}
            width={clip_area.width}
            height={clip_area.height}
          />
        </clipPath>
      </defs>

      <!-- Fill regions: below lines (default z-index) -->
      {@render fill_regions_layer(fills_by_z.below_lines)}
      <!-- Reference lines: below lines (default z-index) -->
      {@render ref_lines_layer(ref_lines_by_z.below_lines)}

      <!-- Lines -->
      {#if styles.show_lines}
        {#each filtered_series ?? [] as series_data (series_data._id)}
          {@const series_markers = series_data.markers ?? DEFAULT_MARKERS}
          {@const series_default_color = get_series_color(series_data.orig_series_idx ?? 0)}
          <g
            data-series-id={series_data._id}
            clip-path="url(#{clip_path_id})"
            opacity={hovered_legend_series_idx !== null &&
            hovered_legend_series_idx !== series_data.orig_series_idx
              ? 0.25
              : 1}
          >
            {#if series_markers?.includes(`line`)}
              {@const all_line_points = series_data.x.map((x, idx) => ({
                x,
                y: series_data.y[idx],
              }))}
              {@const finite_screen_points = all_line_points
                .map((point) => get_screen_coords(point, series_data))
                .filter(([sx, sy]) => isFinite(sx) && isFinite(sy))}
              {@const apply_line_controls =
                controls.show &&
                (!has_multiple_series ||
                  series_data._id === series_with_ids[selected_series_idx]?._id)}
              {@const ls = series_data.line_style}
              {@const tc = (key: string) => apply_line_controls && touched.has(key)}
              {@const color_fallback =
                ls?.stroke ??
                (Array.isArray(series_data.point_style)
                  ? series_data.point_style[0]?.fill
                  : series_data.point_style?.fill) ??
                (series_data.color_values?.[0] != null
                  ? color_scale_fn(series_data.color_values[0])
                  : series_default_color)}
              <Line
                points={finite_screen_points}
                origin={[
                  is_time_x ? x_scale_fn(new Date(x_min)) : x_scale_fn(x_min),
                  series_data.y_axis === `y2` ? y2_scale_fn(y2_min) : y_scale_fn(y_min),
                ]}
                line_color={(tc(`line.color`) ? styles.line?.color : null) ?? color_fallback}
                line_width={(tc(`line.width`) ? styles.line?.width : null) ??
                  ls?.stroke_width ??
                  2}
                line_dash={(tc(`line.dash`) ? styles.line?.dash : null) ?? ls?.line_dash}
                curve={ls?.curve}
                area_color="transparent"
                line_tween={effective_line_tween}
              />
            {/if}
          </g>
        {/each}
      {/if}

      <!-- Fill regions: below points -->
      {@render fill_regions_layer(fills_by_z.below_points)}
      <!-- Reference lines: below points -->
      {@render ref_lines_layer(ref_lines_by_z.below_points)}

      <!-- Points -->
      {#if styles.show_points}
        {#each filtered_series ?? [] as series_data (series_data._id)}
          {@const series_markers = series_data.markers ?? DEFAULT_MARKERS}
          {@const series_default_color = get_series_color(series_data.orig_series_idx ?? 0)}
          {@const series_default_symbol = get_series_symbol(series_data.orig_series_idx ?? 0)}
          <g data-series-id={series_data._id}>
            {#if series_markers?.includes(`points`)}
              {#each series_data.filtered_data as point (`${point.series_idx}-${point.point_idx}`)}
                {@const label_id = `${point.series_idx}-${point.point_idx}`}
                {@const calculated_label_pos = label_positions[label_id]}
                {@const point_label = point.point_label ?? {}}
                {@const label_style =
                  point_label.auto_placement &&
                  actual_label_config.max_neighbors &&
                  !calculated_label_pos
                    ? {}
                    : point_label}
                {@const final_label = calculated_label_pos
                  ? {
                      ...label_style,
                      offset: {
                        x:
                          calculated_label_pos.x -
                          (is_time_x ? x_scale_fn(new Date(point.x)) : x_scale_fn(point.x)),
                        y:
                          calculated_label_pos.y -
                          (series_data.y_axis === `y2`
                            ? y2_scale_fn(point.y)
                            : y_scale_fn(point.y)),
                      },
                    }
                  : label_style}
                {@const [raw_screen_x, raw_screen_y] = get_screen_coords(point, series_data)}
                {@const screen_x = isFinite(raw_screen_x)
                  ? raw_screen_x
                  : x_scale_fn.range()[0]}
                {@const screen_y = isFinite(raw_screen_y)
                  ? raw_screen_y
                  : (series_data.y_axis === `y2` ? y2_scale_fn : y_scale_fn).range()[0]}
                {@const apply_controls =
                  controls.show &&
                  (!has_multiple_series ||
                    series_data._id === series_with_ids[selected_series_idx]?._id)}
                {@const pt = point.point_style}
                {@const tc = (key: string) => apply_controls && touched.has(key)}
                {@const computed_radius =
                  point.size_value != null
                    ? size_scale_fn(point.size_value)
                    : ((tc(`point.size`) ? styles.point?.size : null) ?? pt?.radius ?? 4)}
                <ScatterPoint
                  x={screen_x}
                  y={screen_y}
                  is_dimmed={hovered_legend_series_idx !== null &&
                    hovered_legend_series_idx !== point.series_idx}
                  is_hovered={tooltip_point?.series_idx === point.series_idx &&
                    tooltip_point?.point_idx === point.point_idx}
                  is_selected={selected_point?.series_idx === point.series_idx &&
                    selected_point?.point_idx === point.point_idx}
                  leader_line_threshold={actual_label_config.leader_line_threshold}
                  style={{
                    symbol_type: pt?.symbol_type ?? series_default_symbol,
                    ...pt,
                    radius: computed_radius,
                    stroke_width:
                      (tc(`point.stroke_width`) ? styles.point?.stroke_width : null) ??
                      pt?.stroke_width ??
                      1,
                    stroke:
                      (tc(`point.stroke_color`) ? styles.point?.stroke_color : null) ??
                      pt?.stroke ??
                      `#000`,
                    stroke_opacity:
                      (tc(`point.stroke_opacity`) ? styles.point?.stroke_opacity : null) ??
                      pt?.stroke_opacity ??
                      1,
                    fill_opacity:
                      (tc(`point.opacity`) ? styles.point?.opacity : null) ??
                      pt?.fill_opacity ??
                      1,
                    cursor: on_point_click || point_events?.onclick ? `pointer` : undefined,
                  }}
                  hover={point.point_hover ?? {}}
                  label={final_label}
                  offset={point.point_offset ?? { x: 0, y: 0 }}
                  {point_tween}
                  origin={{ x: plot_center_x, y: plot_center_y }}
                  --point-fill-color={point.color_value != null
                    ? color_scale_fn(point.color_value)
                    : ((tc(`point.color`) ? styles.point?.color : null) ??
                      pt?.fill ??
                      series_default_color)}
                  {...point_events &&
                    Object.fromEntries(
                      point_event_names.map((name) => [
                        name,
                        (event: Event) => point_events?.[name]?.({ point, event }),
                      ]),
                    )}
                  onclick={(event: MouseEvent) => {
                    // Call user-provided onclick handler first if it exists
                    point_events?.onclick?.({ point, event })
                    // then handle internal logic
                    const props = construct_handler_props(point)
                    tooltip_point = point
                    if (props) on_point_click?.({ ...props, event, point })
                  }}
                />
              {/each}
            {/if}
          </g>
        {/each}
      {/if}

      <!-- Fill regions: above all -->
      {@render fill_regions_layer(fills_by_z.above_all)}
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
          x1: marginal_axis(x_scale_fn, [x_min, x_max], final_x_axis),
          x2: marginal_axis(x2_scale_fn, [x2_min, x2_max], final_x2_axis),
          y1: marginal_axis(y_scale_fn, [y_min, y_max], final_y_axis),
          y2: marginal_axis(y2_scale_fn, [y2_min, y2_max], final_y2_axis),
        }}
        id={component_id}
      />
    </svg>

    <!-- Tooltip overlay above all plot overlays (legend, colorbar) -->
    {#if handler_props && hovered && tooltip_point}
      {@const { point_label, series_idx } = tooltip_point}
      {@const tooltip_bg_color = pick_tooltip_bg(
        tooltip_point,
        series_with_ids[series_idx],
        color_scale_fn,
      )}
      <PlotTooltip
        x={handler_props.cx}
        y={handler_props.cy}
        offset={{ x: 10, y: 5 }}
        constrain_to={{ width, height }}
        fallback_size={{ width: 120, height: 50 }}
        bg_color={tooltip_bg_color}
      >
        {#if tooltip}
          {@render tooltip(handler_props)}
        {:else}
          {@const hp = handler_props}
          {#if has_multiple_series && hp.label}<strong>{hp.label}</strong><br />{/if}
          {@html sanitize_html(point_label?.text ? `${point_label.text}<br />` : ``)}
          {@html sanitize_html(hp.x_axis.label || `x`)}: {hp.x_formatted}<br />
          {@html sanitize_html(hp.y_axis.label || `y`)}: {hp.y_formatted}
          {#if hp.colorbar?.value != null}
            <br />{@html sanitize_html(hp.colorbar.title || `Color`)}: {format_value(
              hp.colorbar.value,
              hp.colorbar.tick_format || `.3~g`,
            )}
          {/if}
        {/if}
      </PlotTooltip>
    {/if}

    <!-- Control Pane -->
    {#if controls.show}
      <ScatterPlotControls
        toggle_props={{
          ...controls.toggle_props,
          style: `--ctrl-btn-right: var(--fullscreen-btn-offset, 30px); top: var(--ctrl-btn-top, 5pt); ${
            controls.toggle_props?.style ?? ``
          }`,
        }}
        pane_props={controls.pane_props}
        bind:x_axis
        bind:x2_axis
        bind:y_axis
        bind:y2_axis
        bind:display
        bind:styles
        {auto_x_range}
        {auto_x2_range}
        {auto_y_range}
        {auto_y2_range}
        bind:selected_series_idx
        series={series_with_ids}
        has_x2_points={x2_points.length > 0}
        has_y2_points={y2_points.length > 0}
        children={controls_extra}
        on_touch={(key: string) => touched.add(key)}
      />
    {/if}

    <!-- Color Bar -->
    {#if color_bar && all_color_values.length > 0 && color_bar_placement}
      {@const color_domain = [
        (typeof color_scale === `string` ? undefined : color_scale.value_range)?.[0] ??
          auto_color_range[0],
        (typeof color_scale === `string` ? undefined : color_scale.value_range)?.[1] ??
          auto_color_range[1],
      ] as Vec2}
      <div
        bind:this={colorbar_element}
        onmouseenter={() => colorbar_tween.set_locked(true)}
        onmouseleave={() => colorbar_tween.set_locked(false)}
        class="colorbar-wrapper"
        role="img"
        aria-label="Color scale legend"
        style={`${
          // explicit wrapper_style or auto-outside places the colorbar; else auto-placement coords
          effective_cbar_wrapper_style ??
          `position: absolute; left: ${colorbar_tween.coords.current.x}px; top: ${colorbar_tween.coords.current.y}px`
        }; pointer-events: auto;`}
      >
        <ColorBar
          tick_labels={4}
          tick_side="primary"
          {color_scale_fn}
          color_scale_domain={color_domain}
          scale_type={typeof color_scale === `string` ? undefined : color_scale.type}
          range={color_domain?.every((val) => val != null) ? color_domain : undefined}
          bar_style="width: {COLOR_BAR_DEFAULTS.width}px; height: {COLOR_BAR_DEFAULTS.horizontal_bar_height}px; {color_bar?.style ??
            ``}"
          {...color_bar}
          wrapper_style={effective_cbar_wrapper_style ? `height: 100%; width: 100%;` : ``}
        />
      </div>
    {/if}

    <!-- Legend -->
    <!-- Only render if multiple series or if legend prop was explicitly provided by user (even if empty object) -->
    {#if legend != null && legend_data.length > 0 && (legend_data.length > 1 || Object.keys(legend ?? {}).length > 0)}
      {@const default_x = pad.l + 10}
      {@const default_y = pad.t + 10}
      {@const current_x =
        legend_is_dragging && legend_manual_position
          ? legend_manual_position.x
          : legend_auto_outside
            ? legend_outside_x
            : legend_placement
              ? legend_tween.coords.current.x
              : default_x}
      {@const current_y =
        legend_is_dragging && legend_manual_position
          ? legend_manual_position.y
          : legend_auto_outside
            ? legend_outside_y
            : legend_placement
              ? legend_tween.coords.current.y
              : default_y}
      <PlotLegend
        bind:root_element={legend_element}
        series_data={legend_data}
        on_drag_start={handle_legend_drag_start}
        on_drag={handle_legend_drag}
        on_drag_end={() => (legend_is_dragging = false)}
        on_hover_change={legend_tween.set_locked}
        on_item_hover={(item) => {
          if (item?.item_type === `fill`) {
            // highlight the matching fill in the plot (same state plot fill-hover uses), but skip
            // hidden fills since they render nothing and would mark the legend item active for naught
            const fill = computed_fills.find((entry) => entry.idx === item.fill_idx)
            hovered_fill_key = fill && fill.visible !== false ? fill.hover_key : null
            hovered_legend_series_idx = null
          } else {
            hovered_legend_series_idx =
              item != null && item.series_idx >= 0 ? item.series_idx : null
            hovered_fill_key = null
          }
        }}
        active_series_idx={tooltip_point?.series_idx ?? hovered_legend_series_idx}
        active_fill_idx={computed_fills.find((fill) => fill.hover_key === hovered_fill_key)
          ?.idx ?? null}
        draggable={legend?.draggable ?? true}
        {...legend}
        on_toggle={legend?.on_toggle ?? legend_vis.on_toggle}
        on_double_click={legend?.on_double_click ?? legend_vis.on_double_click}
        on_group_toggle={legend?.on_group_toggle ?? legend_vis.on_group_toggle}
        on_fill_toggle={(source_type: `fill_region` | `error_band`, source_idx: number) => {
          // Only fill_regions can be toggled (error_bands are not bindable)
          if (source_type === `fill_region`) {
            fill_regions = fill_regions.map((region, idx) =>
              idx === source_idx
                ? { ...region, visible: !(region.visible !== false) }
                : region,
            )
          }
        }}
        on_fill_double_click={(
          source_type: `fill_region` | `error_band`,
          source_idx: number,
        ) => {
          // Only fill_regions can be toggled (error_bands are not bindable)
          if (source_type !== `fill_region`) return
          // Toggle: if only this fill is visible, show all; otherwise show only this one
          const visible_count = fill_regions.filter(
            (region) => region.visible !== false,
          ).length
          const this_visible = fill_regions[source_idx]?.visible !== false
          if (visible_count === 1 && this_visible) {
            // Show all fills
            fill_regions = fill_regions.map((region) => ({ ...region, visible: true }))
          } else {
            // Show only this fill
            fill_regions = fill_regions.map((region, idx) => ({
              ...region,
              visible: idx === source_idx,
            }))
          }
        }}
        style={`
          position: absolute;
          left: ${current_x}px;
          top: ${current_y}px;
          pointer-events: auto;
          ${legend?.style ?? ``}
        `}
      />
    {/if}
  {/if}

  <!-- User-provided children (e.g. for custom absolutely-positioned overlays) -->
  {@render children?.({ height, width, fullscreen })}
</div>

<style>
  div.scatter {
    position: relative; /* Needed for absolute positioning of children like ColorBar */
    width: var(--scatter-width, 100%);
    height: var(--scatter-height, auto);
    min-height: var(--scatter-min-height, 350px);
    container-type: size; /* enable cqh for panes */
    container-name: scatter-plot;
    z-index: var(--scatter-z-index);
    flex: var(--scatter-flex, 1); /* Allow filling available space in flex containers */
    display: var(--scatter-display, flex);
    flex-direction: column;
    background: var(--scatter-bg, var(--plot-bg));
    border-radius: var(--scatter-border-radius, var(--border-radius, 3pt));
  }
  div.scatter.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    /* Must be higher than Structure.svelte's --struct-buttons-z-index. */
    z-index: var(--scatter-fullscreen-z-index, var(--z-index-overlay-nav, 100000001));
    margin: 0;
    border-radius: 0;
    background: var(--scatter-fullscreen-bg, var(--scatter-bg, var(--plot-bg)));
    max-height: none !important;
    overflow: hidden;
    /* border-top (not padding-top): bind:clientHeight includes padding but excludes
    borders - padding made the chart overflow + clip its bottom 2em (x-axis title) */
    border-top: var(--plot-fullscreen-padding-top, 2em) solid
      var(--scatter-fullscreen-bg, var(--scatter-bg, var(--plot-bg, transparent)));
    box-sizing: border-box;
  }
  /* Center the colorbar within its wrapper when shorter than it (e.g. capped by --cbar-max-height
     in fullscreen). Users can override via wrapper_style (inline wins). */
  .colorbar-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
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
  div.scatter :global(.pane-toggle),
  div.scatter .header-controls {
    opacity: 0;
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  div.scatter:hover :global(.pane-toggle),
  div.scatter:hover .header-controls,
  div.scatter :global(.pane-toggle:focus-visible),
  div.scatter :global(.pane-toggle[aria-expanded='true']),
  div.scatter .header-controls:focus-within {
    opacity: 1;
  }
  svg {
    width: var(--scatter-svg-width, 100%);
    height: var(--scatter-svg-height, 100%);
    flex: var(--scatter-svg-flex, 1);
    overflow: var(--scatter-svg-overflow, visible);
    fill: var(--text-color);
    font-weight: var(--scatter-font-weight);
    font-size: var(--scatter-font-size);
  }
  .scatter :global(.axis-label) {
    text-align: center;
    width: 100%;
    height: 100%;
    font-size: var(--scatter-font-size, inherit);
    font-weight: var(--scatter-font-weight, normal);
    color: var(--text-color);
    white-space: nowrap;
    /* Use line-height to center text vertically without flexbox */
    line-height: var(--scatter-axis-label-line-height, 20px); /* Match foreignObject height */
    display: block;
  }
  .current-frame-indicator {
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.2));
    transition: opacity 0.2s ease;
  }
  .current-frame-indicator:hover {
    opacity: 0.8;
  }
</style>
