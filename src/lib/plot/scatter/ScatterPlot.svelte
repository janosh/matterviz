<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import type { D3InterpolateName } from '$lib/colors'
  import { format_value, format_value_or_num } from '$lib/labels'
  import { sanitize_html } from '$lib/sanitize'
  import type { Point2D, Vec2 } from '$lib/math'
  import type {
    AxisLoadError,
    BasePlotProps,
    ColorScaleConfig,
    DataLoaderFn,
    DataSeries,
    ErrorBand,
    FillHandlerEvent,
    FillRegion,
    HoverConfig,
    InternalPoint,
    LabelPlacementConfig,
    LabelStyle,
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
    PlotLegend,
    PlotTooltip,
    ScatterPlotControls,
    ScatterPoint,
  } from '$lib/plot'
  import { FillArea, Line, PlotAxis, ZeroLines } from '$lib/plot/core/components'
  import {
    get_tick_label,
    accumulate_extent,
    create_color_scale,
    create_scale,
    create_size_scale,
    empty_extent,
    nice_range_from_extent,
    type RunningExtent,
  } from '$lib/plot/core/scales'
  import ReferenceLinesLayer from '$lib/plot/core/components/ReferenceLinesLayer.svelte'
  import CartesianFrame from '$lib/plot/core/components/CartesianFrame.svelte'
  import type { MarginalSeriesInput, MarginalsProp } from '$lib/plot/core/marginals'
  import { normalize_marginals } from '$lib/plot/core/marginals'
  import {
    build_obstacles_norm,
    has_explicit_position,
    measured_footprint,
  } from '$lib/plot/core/auto-place'
  import { assign_axes, axis_labels, axis_scale_types } from '$lib/plot/core/axis-assignment'
  import { create_axis_loader, AXIS_DEFAULTS } from '$lib/plot/core/axis-utils'
  import type { AxisChangeState } from '$lib/plot/core/axis-utils'
  import { get_series_color, get_series_symbol } from '$lib/plot/core/data-transform'
  import type { FacetLayoutContext } from '$lib/plot/core/facets'
  import {
    decoration_placement_revision,
    get_decoration_placement,
    resolve_legend_layout_tracks,
    type DecorationItem,
    type DecorationPlacement,
  } from '$lib/plot/core/decorations'
  import { create_placed_tween } from '$lib/plot/core/placed-tween.svelte'
  import {
    COLOR_BAR_DEFAULTS,
    DEFAULT_MARKERS,
    get_scale_type_name,
    is_time_scale,
    SCALE_DEFAULTS,
  } from '$lib/plot/core/types'
  import { compute_label_positions } from '$lib/plot/core/utils/label-placement'
  import {
    create_legend_visibility,
    legend_mode_to_prop,
    resolve_legend_visibility,
  } from '$lib/plot/core/utils/series-visibility'
  import { DEFAULTS } from '$lib/settings'
  import { extent } from 'd3-array'
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
  import { get_relative_coords } from '$lib/plot/core/interactions'
  import { create_cartesian_frame } from '$lib/plot/core/cartesian-frame.svelte'
  import type { Rect, Sides } from '$lib/plot/core/layout'
  import {
    AXIS_TITLE_OFFSET,
    stride_sample,
    y_axis_label_x,
    y2_axis_label_x,
  } from '$lib/plot/core/layout'
  import type { IndexedRefLine } from '$lib/plot/core/reference-line'
  import { group_ref_lines_by_z, index_ref_lines } from '$lib/plot/core/reference-line'
  import { type CanvasMarker, draw_markers } from '$lib/plot/core/canvas-markers'
  import { build_spatial_index, query_nearest } from '$lib/plot/core/spatial-index'
  import { resolve_line_tween } from '$lib/plot/core/utils'
  import { color as d3_color } from 'd3-color'
  import { build_legend_data, filter_series_to_ranges, pick_tooltip_bg } from './scatter-data'

  // Marker-density thresholds and decoration sampling cap
  const DENSE_MARKER_COUNT = 100
  const OBSTACLE_SAMPLE_LIMIT = 500
  const CANVAS_MARKER_THRESHOLD = 10_000

  let {
    series = $bindable([]),
    x_axis = $bindable({}),
    x2_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    display = $bindable(DEFAULTS.scatter.display),
    styles: styles_init = {},
    show_controls = $bindable(true),
    controls_open = $bindable(false),
    controls_toggle_props,
    controls_pane_props,
    padding = {},
    title,
    range_padding = 0,
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
    show_legend = legend_mode_to_prop(DEFAULTS.scatter.show_legend),
    point_tween,
    line_tween,
    point_events,
    on_point_click,
    on_point_hover,
    on_pointer_leave,
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
    facet_layout,
    marker_renderer = `auto`,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `title`> &
    Omit<BasePlotProps, `change`> &
    PlotConfig & {
      series?: DataSeries<Metadata>[]
      styles?: StyleOverrides
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
      show_legend?: boolean
      point_tween?: TweenOptions<Point2D>
      line_tween?: TweenOptions<string>
      point_events?: Record<
        string,
        (payload: { point: InternalPoint<Metadata>; event: Event }) => void
      >
      on_point_click?: (data: ScatterHandlerEvent<Metadata>) => void
      on_point_hover?: (data: ScatterHandlerEvent<Metadata> | null) => void
      on_pointer_leave?: () => void
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
      facet_layout?: FacetLayoutContext
      // `auto` switches from SVG to canvas past CANVAS_MARKER_THRESHOLD visible markers.
      // Canvas keeps labelled, hovered, and selected points in an SVG overlay.
      marker_renderer?: `auto` | `svg` | `canvas`
    } = $props()

  // Assign visible series by unit/axis_group while preserving every explicit y_axis.
  // Dimensionless series retain the historical y1 default. Re-running this derived after a
  // legend toggle lets the remaining visible group move back to y1.
  const assigned_series = $derived.by(() => {
    const assignment = assign_axes(series, {
      is_visible: (srs) => Boolean(srs && typeof srs === `object` && srs.visible !== false),
      priority: (group_key) => (group_key === `dimensionless` ? -1 : 0),
    })
    if (assignment.status === `overflow`) {
      throw new Error(
        `ScatterPlot cannot automatically assign visible value series: ${assignment.error.message}. Set y_axis explicitly or hide an axis group.`,
        { cause: assignment.error },
      )
    }

    return series.map((srs, series_idx) => {
      const assigned_axis = assignment.assignments[series_idx]
      return assigned_axis && !srs.y_axis ? { ...srs, y_axis: assigned_axis } : srs
    })
  })

  const inferred_y_axes = $derived.by(() => {
    const valid_series = assigned_series.filter((srs): srs is DataSeries<Metadata> =>
      Boolean(srs && typeof srs === `object`),
    )
    const labels = axis_labels(valid_series)
    const scale_types = axis_scale_types(valid_series, {
      // axis_group is the explicit signal that otherwise unit-compatible data needs an
      // independent scale (for example, positive SCF residuals spanning many decades).
      can_use_log_scale: (srs) => srs.axis_group != null,
    })
    const inferred = (axis: `y1` | `y2`) => {
      const has_metadata = valid_series.some(
        (srs) =>
          srs.visible !== false &&
          (srs.y_axis ?? `y1`) === axis &&
          (srs.unit !== undefined || srs.axis_group !== undefined),
      )
      return has_metadata ? { label: labels[axis], scale_type: scale_types[axis] } : {}
    }
    return { y1: inferred(`y1`), y2: inferred(`y2`) }
  })

  // Merged axis/display values with defaults (use $derived to avoid breaking $bindable)
  const final_x_axis = $derived({
    ...AXIS_DEFAULTS,
    label_shift: { x: 0, y: 0 },
    ...x_axis,
  })
  const final_y_axis = $derived({ ...AXIS_DEFAULTS, ...inferred_y_axes.y1, ...y_axis })
  const final_x2_axis = $derived({
    ...AXIS_DEFAULTS,
    label_shift: { x: 0, y: AXIS_TITLE_OFFSET }, // x2-axis label above top edge
    ...x2_axis,
  })
  const final_y2_axis = $derived({ ...AXIS_DEFAULTS, ...inferred_y_axes.y2, ...y2_axis })
  // Cache time-axis check — used in ~10 places for scale/tick/tooltip logic
  let is_time_x = $derived(is_time_scale(final_x_axis.scale_type))
  let is_time_x2 = $derived(is_time_scale(final_x2_axis.scale_type))
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
  // Track which specific control properties user has modified
  let touched = new SvelteSet<string>()

  // Assign stable IDs to series for keying
  let series_with_ids = $derived(
    assigned_series.map((srs: DataSeries<Metadata>, idx: number) => {
      if (!srs || typeof srs !== `object`) return srs
      // Use series.id if provided, otherwise fall back to index
      // prevents re-mounts when series are reordered if stable IDs are provided
      return { ...srs, _id: srs.id ?? idx }
    }),
  )

  const legend_vis = create_legend_visibility(
    () => series,
    (next) => (series = next),
  )

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
  let colorbar_element = $state<HTMLDivElement | undefined>()

  // Avoid materializing point objects when only axis extrema and counts are needed.
  let extents_by_axis = $derived.by(() => {
    const all_x = empty_extent()
    const y1 = empty_extent()
    const y2 = empty_extent()
    const x2 = empty_extent()
    let has_x2_points = false
    let has_y2_points = false

    for (const srs of series_with_ids) {
      if (!srs) continue
      const {
        x: xs,
        y: ys,
        visible = true,
        y_axis: series_y_axis = `y1`,
        x_axis: x_ax = `x1`,
      } = srs as DataSeries
      // x drives the point count: a y array of a different length is read through xs.length
      const n_points = xs.length
      accumulate_extent(all_x, xs, n_points)
      if (visible) {
        const y_extent = series_y_axis === `y2` ? y2 : y1
        accumulate_extent(y_extent, ys, n_points)
        if (x_ax === `x2`) accumulate_extent(x2, xs, n_points)
        const has_drawable_point: boolean =
          ((x_ax === `x2` && !has_x2_points) || (series_y_axis === `y2` && !has_y2_points)) &&
          xs.some(
            (x_value, point_idx) => Number.isFinite(x_value) && Number.isFinite(ys[point_idx]),
          )
        has_x2_points ||= x_ax === `x2` && has_drawable_point
        has_y2_points ||= series_y_axis === `y2` && has_drawable_point
      }
    }
    return { all_x, y1, y2, x2, has_x2_points, has_y2_points }
  })

  let { has_x2_points, has_y2_points } = $derived(extents_by_axis)

  const auto_range = (
    data_extent: RunningExtent,
    axis: typeof final_x_axis,
    time_scale = false,
  ): Vec2 =>
    nice_range_from_extent(
      data_extent,
      axis.range ?? [null, null],
      axis.scale_type ?? `linear`,
      range_padding,
      time_scale,
    )
  let auto_x_range = $derived(auto_range(extents_by_axis.all_x, final_x_axis, is_time_x))
  let auto_y_range = $derived(auto_range(extents_by_axis.y1, final_y_axis))
  let auto_x2_range = $derived(auto_range(extents_by_axis.x2, final_x2_axis, is_time_x2))
  let auto_y2_range = $derived(auto_range(extents_by_axis.y2, final_y2_axis))
  const intrinsic_ranges = $derived({
    x: auto_x_range,
    x2: auto_x2_range,
    y: auto_y_range,
    y2: auto_y2_range,
  })
  const frame = create_cartesian_frame({
    axes: () => ({ x: final_x_axis, x2: final_x2_axis, y: final_y_axis, y2: final_y2_axis }),
    auto_ranges: () => intrinsic_ranges,
    // Keep the current view when every series is hidden instead of snapping to the
    // [0, 1] sentinel, so toggling series off doesn't jump the plot
    range_sync: `expand`,
    has_x2: () => has_x2_points,
    has_y2: () => has_y2_points,
    tick_counts: { y: 5, y2: 5 },
    padding: () => padding,
    title: () => title,
    obstacles: () => obstacles_norm,
    legend: () => legend,
    legend_visible: () => should_show_legend,
    legend_items: () => legend_track_items,
    legend_footprint_fallback: { width: 120, height: 80 },
    // A legend the user grabbed or dropped owns its position; the solver only routes
    // around it (via exclusion_rects) from then on.
    legend_auto_placed: () => !legend_is_dragging && !legend_manual_position,
    legend_suspended: () => legend_is_dragging,
    legend_manual_position: () => legend_manual_position,
    decorations: () => colorbar_decoration,
    exclusion_rects: () => pinned_decoration_rects,
    marginals: () => resolved_marginals,
    ref_lines: () => indexed_ref_lines,
    pan: () => pan,
    facet_layout: () => facet_layout,
    write_range: (axis, range) => {
      if (axis === `x`) x_axis = { ...x_axis, range }
      else if (axis === `x2`) x2_axis = { ...x2_axis, range }
      else if (axis === `y`) y_axis = { ...y_axis, range }
      else y2_axis = { ...y2_axis, range }
    },
    // Live tooltip while rect-dragging: update for the closest point inside the plot
    // bounds, clear when the cursor leaves the svg
    on_drag_move: (coords, inside_svg) => {
      if (inside_svg) update_tooltip_point(coords.x, coords.y)
      else tooltip_point = null
    },
    clip_id_prefix: `plot-area-clip`,
  })

  // Aliases onto the frame so the marks, axes and overlays below read the same names
  // they did when ScatterPlot owned this machinery itself.
  const width = $derived(frame.width)
  const height = $derived(frame.height)
  const pad = $derived(frame.pad)
  const effective_base_pad = $derived(frame.effective_base_pad)
  const ranges = $derived(frame.ranges)
  const clip_path_id = $derived(frame.clip_path_id)
  const title_config = $derived(frame.title_config)
  const facet = frame.facet
  const pan_zoom = frame.pan_zoom
  const legend_tween = frame.legend_tween
  const decoration_solution = $derived(frame.decoration_solution)
  const legend_placement = $derived(frame.legend_placement)
  const x_scale_fn = $derived(frame.scales.x)
  const x2_scale_fn = $derived(frame.scales.x2)
  const y_scale_fn = $derived(frame.scales.y)
  const y2_scale_fn = $derived(frame.scales.y2)
  const x_tick_values = $derived(frame.ticks.x)
  const x2_tick_values = $derived(frame.ticks.x2)
  const y_tick_values = $derived(frame.ticks.y)
  const y2_tick_values = $derived(frame.ticks.y2)
  const tick_label_widths = $derived(frame.tick_label_widths)

  // === Unified automatic legend/colorbar layout ===
  // ColorBar's orientation prop defaults to horizontal, so treat unset as horizontal too
  const colorbar_is_horizontal = $derived(
    (color_bar?.orientation ?? `horizontal`) === `horizontal`,
  )
  // Fallback estimate (with room for tick labels) used before the colorbar first renders
  const colorbar_fallback_size = $derived(
    colorbar_is_horizontal
      ? COLOR_BAR_DEFAULTS.horizontal_footprint
      : COLOR_BAR_DEFAULTS.vertical_footprint,
  )
  let colorbar_size_revision = $state(0)
  const colorbar_footprint = $derived.by(() => {
    void colorbar_size_revision
    return measured_footprint(colorbar_element, colorbar_fallback_size)
  })
  const legend_footprint = $derived(frame.legend_footprint)
  const legend_has_explicit_pos = $derived(has_explicit_position(legend?.style))

  // Plot-specific immutable obstacle field: visible series points and sampled line segments in
  // normalized [0,1] coordinates (y=0 at top). Each series uses its assigned x/y scale.
  const obstacles_norm = $derived.by(() => {
    if (!width || !height) return []
    const base_w = width - effective_base_pad.l - effective_base_pad.r
    const base_h = height - effective_base_pad.t - effective_base_pad.b
    if (base_w <= 0 || base_h <= 0) return []
    return build_obstacles_norm(
      filtered_series.map((srs) => {
        const uses_x2 = srs.x_axis === `x2`
        const uses_y2 = srs.y_axis === `y2`
        const x_config = uses_x2 ? final_x2_axis : final_x_axis
        const y_config = uses_y2 ? final_y2_axis : final_y_axis
        const x_range = uses_x2 ? ([x2_min, x2_max] as Vec2) : ([x_min, x_max] as Vec2)
        const y_range = uses_y2 ? ([y2_min, y2_max] as Vec2) : ([y_min, y_max] as Vec2)
        const norm_x = create_scale(x_config.scale_type ?? `linear`, x_range, [0, 1])
        const norm_y = create_scale(y_config.scale_type ?? `linear`, y_range, [0, 1])
        // Thin before projecting because the placement solver also caps its obstacle field.
        return {
          points: stride_sample(srs.filtered_data, OBSTACLE_SAMPLE_LIMIT).map((point) => ({
            x: norm_x(point.x) + (point.point_offset?.x ?? 0) / base_w,
            y: 1 - norm_y(point.y) + (point.point_offset?.y ?? 0) / base_h,
          })),
          draws_line: styles.show_lines && (srs.markers ?? DEFAULT_MARKERS).includes(`line`),
        }
      }),
      base_w,
      base_h,
    )
  })

  // Explicit styles and a dragged legend stay outside solver ownership, but their measured
  // rectangles remain exclusions for the automatic item.
  const pinned_decoration_rects = $derived.by((): Rect[] => {
    const rects: Rect[] = []
    const legend_element = frame.legend_element
    if (
      legend_element &&
      (legend_has_explicit_pos || legend_is_dragging || legend_manual_position)
    ) {
      const position = legend_manual_position ?? {
        x: legend_element.offsetLeft,
        y: legend_element.offsetTop,
      }
      rects.push({ ...position, ...legend_footprint })
    }
    if (colorbar_element && color_bar?.wrapper_style) {
      rects.push({
        x: colorbar_element.offsetLeft,
        y: colorbar_element.offsetTop,
        ...colorbar_footprint,
      })
    }
    return rects
  })

  const legend_track_items = $derived.by(() => {
    const candidates: { label: string; legend_group?: string }[] = [
      ...series_with_ids.filter(Boolean).map((series_data, series_idx) => {
        const metadata_label =
          typeof series_data.metadata === `object` &&
          series_data.metadata !== null &&
          `label` in series_data.metadata &&
          typeof series_data.metadata.label === `string`
            ? series_data.metadata.label
            : undefined
        return {
          label: series_data.label ?? metadata_label ?? `Series ${series_idx + 1}`,
          legend_group: series_data.legend_group,
        }
      }),
      ...fill_regions.flatMap((fill) =>
        fill.show_in_legend !== false && fill.label
          ? [{ label: fill.label, legend_group: fill.legend_group }]
          : [],
      ),
      ...error_bands.flatMap((band) =>
        band.show_in_legend !== false && band.label ? [{ label: band.label }] : [],
      ),
    ]
    const seen = new SvelteSet<string>()
    return candidates.filter(({ label, legend_group }) => {
      const key = `${legend_group ?? ``}::${label}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  })

  const resolved_marginals = $derived(
    normalize_marginals(marginals, { top: true, right: true }),
  )
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
  // Canvas marker clip, matching the frame's clip-path rect
  const clip_area = $derived({
    x: pad.l || 0,
    y: pad.t || 0,
    width: frame.chart_width,
    height: frame.chart_height,
  })

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

  // The frame owns the legend item; the colorbar is ScatterPlot's own decoration
  const colorbar_decoration = $derived<DecorationItem[]>(
    color_bar &&
      all_color_values.length > 0 &&
      !color_bar.wrapper_style &&
      width > 0 &&
      height > 0
      ? [
          {
            id: `colorbar`,
            kind: `colorbar`,
            footprint: colorbar_footprint,
            horizontal: colorbar_is_horizontal,
            clearance: color_bar.axis_clearance,
          },
        ]
      : [],
  )

  let [x_min, x_max] = $derived(ranges.current.x)
  let [x2_min, x2_max] = $derived(ranges.current.x2)
  let [y_min, y_max] = $derived(ranges.current.y)
  let [y2_min, y2_max] = $derived(ranges.current.y2)

  // Create auto color range
  let auto_color_range = $derived(
    all_color_values.length > 0 ? extent(all_color_values) : [0, 1],
  ) as Vec2

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
    for (const srs of filtered_series) {
      if (!(srs.markers ?? DEFAULT_MARKERS).includes(`line`)) continue
      n_series += 1
      n_points += srs.x.length
    }
    return { series: n_series, points: n_points }
  })

  let visible_marker_count = $derived.by(() => {
    if (!styles.show_points) return 0
    let count = 0
    for (const series_data of filtered_series) {
      if ((series_data.markers ?? DEFAULT_MARKERS).includes(`points`)) {
        count += series_data.filtered_data.length
      }
    }
    return count
  })

  const default_point_radius = (markers: string): number => {
    const [sparse_radius, dense_radius] = markers.includes(`line`) ? [2.5, 2] : [3, 2.5]
    return visible_marker_count >= DENSE_MARKER_COUNT ? dense_radius : sparse_radius
  }

  // Apply controls to the selected series, comparing original indices so duplicate IDs work.
  const applies_style_controls = (series_data: { orig_series_idx?: number }): boolean =>
    show_controls &&
    (!has_multiple_series || series_data.orig_series_idx === selected_series_idx)

  // Keep canvas and SVG marker appearance in sync.
  const point_appearance = (
    point: InternalPoint<Metadata>,
    series_data: DataSeries<Metadata> & { filtered_data: InternalPoint<Metadata>[] },
  ) => {
    const series_markers = series_data.markers ?? DEFAULT_MARKERS
    const control_touched = applies_style_controls(series_data) ? touched : undefined
    const pt = point.point_style
    const ctrl = <T>(key: string, value: T | null | undefined): T | null =>
      control_touched?.has(key) ? (value ?? null) : null
    const series_idx = series_data.orig_series_idx ?? 0
    return {
      radius:
        point.size_value != null
          ? size_scale_fn(point.size_value)
          : (ctrl(`point.size`, styles.point?.size) ??
            pt?.radius ??
            default_point_radius(series_markers)),
      symbol_size: pt?.symbol_size ?? undefined,
      symbol_type: pt?.symbol_type ?? get_series_symbol(series_idx),
      fill:
        point.color_value != null
          ? color_scale_fn(point.color_value)
          : (ctrl(`point.color`, styles.point?.color) ??
            pt?.fill ??
            get_series_color(series_idx)),
      fill_opacity: ctrl(`point.opacity`, styles.point?.opacity) ?? pt?.fill_opacity ?? 1,
      stroke: ctrl(`point.stroke_color`, styles.point?.stroke_color) ?? pt?.stroke ?? `#000`,
      stroke_width:
        ctrl(`point.stroke_width`, styles.point?.stroke_width) ?? pt?.stroke_width ?? 1,
      stroke_opacity:
        ctrl(`point.stroke_opacity`, styles.point?.stroke_opacity) ?? pt?.stroke_opacity ?? 1,
    }
  }

  // Canvas ignores invalid paint values, so restrict it to d3 colors and SVG's no-paint keyword.
  const canvas_safe_color = (color: string): boolean =>
    color === `none` || d3_color(color) !== null
  const needs_svg_point_events = $derived(
    Boolean(on_point_click || (point_events && Object.values(point_events).some(Boolean))),
  )
  const use_canvas_markers = $derived.by(() => {
    const canvas_requested =
      marker_renderer === `canvas` ||
      (marker_renderer === `auto` && visible_marker_count > CANVAS_MARKER_THRESHOLD)
    if (!canvas_requested || needs_svg_point_events) return false
    for (const series_data of filtered_series) {
      if (!(series_data.markers ?? DEFAULT_MARKERS).includes(`points`)) continue
      for (const point of series_data.filtered_data) {
        const { fill, stroke } = point_appearance(point, series_data)
        if (!canvas_safe_color(fill) || !canvas_safe_color(stroke)) return false
      }
    }
    return true
  })

  // Points needing labels or effects remain in an SVG overlay.
  const same_logical_point = (
    point: InternalPoint<Metadata>,
    other: { series_idx: number; point_idx: number } | null,
  ): boolean => other?.series_idx === point.series_idx && other.point_idx === point.point_idx
  const needs_static_svg_overlay = (point: InternalPoint<Metadata>): boolean =>
    point.point_label?.text != null ||
    same_logical_point(point, selected_point) ||
    Boolean(
      point.point_style?.is_highlighted &&
      /pulse|glow/.test(point.point_style.highlight_effect ?? ``),
    )
  const static_svg_overlay_points_by_series = $derived.by(() => {
    if (!use_canvas_markers) return []
    return filtered_series.map((series_data) =>
      series_data.filtered_data.filter((point) => needs_static_svg_overlay(point)),
    )
  })
  const svg_overlay_points_by_series = $derived.by(() => {
    if (!use_canvas_markers) return []
    return static_svg_overlay_points_by_series.map((points, series_pos) => {
      const series_data = filtered_series[series_pos]
      // tooltip_point may come from a previous filtered derivation, so dedupe by logical key.
      if (
        tooltip_point == null ||
        tooltip_point.point_label?.text != null ||
        tooltip_point.series_idx !== series_data.orig_series_idx ||
        points.some((point) => same_logical_point(point, tooltip_point))
      ) {
        return points
      }
      return [...points, tooltip_point]
    })
  })
  // Shared by canvas markers and the hover index so offsets can't drift between them.
  const series_screen_scales = (series_data: { x_axis?: string; y_axis?: string }) => {
    const use_x2 = series_data.x_axis === `x2`
    return {
      x_scale: use_x2 ? x2_scale_fn : x_scale_fn,
      y_scale: series_data.y_axis === `y2` ? y2_scale_fn : y_scale_fn,
      is_time_x: use_x2 ? is_time_x2 : is_time_x,
    }
  }
  const point_screen_xy = (
    point: InternalPoint<Metadata>,
    scales: ReturnType<typeof series_screen_scales>,
  ) => ({
    cx:
      (scales.is_time_x ? scales.x_scale(new Date(point.x)) : scales.x_scale(point.x)) +
      (point.point_offset?.x ?? 0),
    cy: scales.y_scale(point.y) + (point.point_offset?.y ?? 0),
  })

  const canvas_markers = $derived.by((): CanvasMarker[] => {
    if (!use_canvas_markers || !styles.show_points) return []
    const markers: CanvasMarker[] = []
    for (const series_data of filtered_series) {
      if (!(series_data.markers ?? DEFAULT_MARKERS).includes(`points`)) continue
      const scales = series_screen_scales(series_data)
      const dimmed =
        hovered_legend_series_idx !== null &&
        hovered_legend_series_idx !== series_data.orig_series_idx
      for (const point of series_data.filtered_data) {
        if (needs_static_svg_overlay(point)) continue
        markers.push({
          ...point_screen_xy(point, scales),
          opacity: dimmed ? 0.25 : 1,
          ...point_appearance(point, series_data),
        })
      }
    }
    return markers
  })

  let canvas_element = $state<HTMLCanvasElement | null>(null)
  const attach_marker_canvas = (foreign_object: SVGForeignObjectElement) => {
    const canvas = document.createElement(`canvas`)
    canvas.className = `marker-canvas`
    Object.assign(canvas.style, { display: `block`, pointerEvents: `none` })
    foreign_object.append(canvas)
    canvas_element = canvas
    return () => {
      if (canvas_element === canvas) canvas_element = null
      canvas.remove()
    }
  }
  $effect(() => {
    const canvas = canvas_element
    if (!canvas || !width || !height) return
    const pixel_ratio = globalThis.devicePixelRatio ?? 1
    const [bw, bh] = [width * pixel_ratio, height * pixel_ratio]
    if (canvas.width !== bw) canvas.width = bw
    if (canvas.height !== bh) canvas.height = bh
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext(`2d`)
    if (ctx) draw_markers(ctx, canvas_markers, { width, height, pixel_ratio, clip: clip_area })
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
  // legend_track_items mirrors the rendered entries without depending on frame geometry,
  // avoiding a frame -> visibility -> computed fills -> frame dependency cycle.
  const should_show_legend = $derived(
    resolve_legend_visibility(show_legend, legend, legend_track_items.length),
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
  const colorbar_placement = $derived(
    get_decoration_placement(frame.decoration_solution, `colorbar`),
  )
  const colorbar_tween = create_placed_tween({
    placement: () => colorbar_placement ?? null,
    dims: () => ({ width, height }),
    responsive: () => color_bar?.responsive ?? false,
    element: () => colorbar_element,
    tween: () => color_bar?.tween,
    on_element_resize: () => (colorbar_size_revision += 1),
    placement_revision: () => decoration_placement_revision(colorbar_placement),
  })
  const decoration_exclusion_rects = $derived([
    ...pinned_decoration_rects,
    ...frame.exclusion_rects,
  ])

  // Panning retargets every marker and line on each pointer frame. Animating that leaves
  // them trailing the axes while hover hit-testing already uses the live scales, so snap
  // for the duration of the drag. Declared here because both read pan_zoom.
  const effective_point_tween = $derived(
    use_canvas_markers || pan_zoom.is_panning ? { duration: 0 } : point_tween,
  )
  const effective_line_tween = $derived(
    pan_zoom.is_panning ? { duration: 0 } : resolve_line_tween(line_tween, line_tween_load),
  )

  // Lazily index screen-space markers so pointer moves probe nearby cells only.
  const hover_index = $derived.by(() => {
    function* entries() {
      for (const series_data of filtered_series) {
        const scales = series_screen_scales(series_data)
        for (const point of series_data.filtered_data) {
          yield { ...point_screen_xy(point, scales), point, series: series_data }
        }
      }
    }
    return build_spatial_index(entries(), hover_config.threshold_px ?? 20)
  })

  // tooltip logic: find closest point and update tooltip state
  function update_tooltip_point(x_rel: number, y_rel: number, evt?: MouseEvent) {
    if (!width || !height) return

    const nearest = query_nearest(hover_index, { x: x_rel, y: y_rel })

    if (nearest) {
      const { point: closest_point, series: closest_series } = nearest
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

  let hover_animation_frame: number | undefined
  let pending_hover: { x_rel: number; y_rel: number; event: MouseEvent } | undefined

  function flush_pending_hover() {
    const next_hover = pending_hover
    pending_hover = undefined
    if (next_hover) {
      update_tooltip_point(next_hover.x_rel, next_hover.y_rel, next_hover.event)
    }
  }

  function queue_mouse_move(evt: MouseEvent) {
    hovered = true
    const coords = get_relative_coords(evt)
    if (!coords) return
    pending_hover = { x_rel: coords.x, y_rel: coords.y, event: evt }
    if (hover_animation_frame !== undefined) return
    hover_animation_frame = requestAnimationFrame(() => {
      hover_animation_frame = undefined
      flush_pending_hover()
    })
  }

  function end_queued_mouse_move(apply_pending: boolean) {
    if (hover_animation_frame !== undefined) cancelAnimationFrame(hover_animation_frame)
    hover_animation_frame = undefined
    if (apply_pending) flush_pending_hover()
    else pending_hover = undefined
  }
  onDestroy(() => end_queued_mouse_move(false))

  // Merge user config with defaults before the effect that uses it
  let actual_label_config = $derived({
    sa_iterations: 2000,
    max_labels: 300,
    leader_line_threshold: 15,
    ...label_placement_config,
  })

  // The solver below scans every point and reruns per pan/zoom frame (it reads the scales),
  // so skip it entirely on plots with no auto-placed labels. Scans `series_with_ids` rather
  // than `filtered_series` on purpose: the latter is refiltered from the ranges, which would
  // put this scan back on every frame. Counting labels outside the visible range only means
  // the solver runs and filters them out itself.
  // series and label entries can both be null: assigned_series passes non-objects through
  const is_auto_placed = (label: LabelStyle | null | undefined) =>
    Boolean(label?.auto_placement && label.text)
  let has_auto_placed_labels = $derived(
    series_with_ids.some((series_data) => {
      const label = series_data?.point_label
      return Array.isArray(label) ? label.some(is_auto_placed) : is_auto_placed(label)
    }),
  )

  // Last solve's label offsets, handed back so each pan/zoom frame polishes the previous
  // layout instead of re-solving from scratch. A plain Map, not SvelteMap: the effect below
  // both reads and writes it, and tracking that would re-trigger the effect forever.
  const label_offsets = new Map<string, Point2D>()
  let previous_label_series: typeof series_with_ids | undefined
  let previous_label_config: typeof actual_label_config | undefined

  $effect(() => {
    const label_series = series_with_ids
    const label_config = actual_label_config
    if (label_series !== previous_label_series || label_config !== previous_label_config) {
      label_offsets.clear()
      previous_label_series = label_series
      previous_label_config = label_config
    }
    if (!width || !height || !has_auto_placed_labels) {
      label_positions = {}
      label_offsets.clear()
      return
    }

    label_positions = compute_label_positions(
      filtered_series,
      label_config,
      { x_scale_fn, y_scale_fn, y2_scale_fn, x_axis: final_x_axis },
      { width, height, pad },
      label_offsets,
    )
  })

  // Legend drag handlers
  function handle_legend_drag_start(event: MouseEvent) {
    if (!frame.svg_element) return

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
    const legend_element = frame.legend_element
    if (!legend_is_dragging || !frame.svg_element || !legend_element) return

    const svg_rect = frame.svg_element.getBoundingClientRect()

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
    const { cx, cy } = point_screen_xy(point, series_screen_scales(hovered_series))
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
      x_formatted: format_value_or_num(x, active_x_config.format),
      y_formatted: format_value_or_num(y, active_y_config.format),
      color_value: color_value ?? null,
      color_bar: {
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
        tween_options={effective_line_tween}
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
  <ReferenceLinesLayer
    {lines}
    ranges={ranges.current}
    scales={{ x: x_scale_fn, x2: x2_scale_fn, y: y_scale_fn, y2: y2_scale_fn }}
    {clip_path_id}
    {decoration_solution}
    bind:hovered_line_idx={hovered_ref_line_idx}
    on_click={on_ref_line_click}
    on_hover={on_ref_line_hover}
  />
{/snippet}

<CartesianFrame
  {frame}
  plot_class="scatter"
  css_prefix="scatter"
  css_var_fallbacks={{ 'min-height': `350px` }}
  aria_label={frame.title_config?.text ||
    [final_x_axis.label, final_y_axis.label].filter(Boolean).join(` vs `) ||
    `Scatter plot`}
  bind:fullscreen
  bind:wrapper
  {fullscreen_toggle}
  marginals={resolved_marginals}
  {marginal_series}
  on_mouse_enter={() => (hovered = true)}
  on_mouse_move={(evt) => {
    // Only find the closest point when not actively dragging
    if (!pan_zoom.drag_start && !pan_zoom.is_panning) queue_mouse_move(evt)
  }}
  on_mouse_leave={() => {
    end_queued_mouse_move(false)
    hovered = false
    tooltip_point = null
    change(null)
    on_point_hover?.(null)
    on_pointer_leave?.()
  }}
  {header_controls}
  {children}
  {...rest}
>
  {#snippet layers()}
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

    {#if facet.axis_visible(`x`)}
      <PlotAxis
        side="x"
        ticks={x_tick_values}
        place={(tick) => (is_time_x ? x_scale_fn(new Date(tick)) : x_scale_fn(tick))}
        axis={final_x_axis}
        on_tick_font={(font) => (frame.tick_font = font)}
        {pad}
        {width}
        {height}
        show_grid={final_display.x_grid}
        show_baseline={false}
        domain={[x_min, x_max]}
        tick_label={(tick) => get_tick_label(tick, final_x_axis.ticks)}
        label_x={width / 2 + (final_x_axis.label_shift?.x ?? 0)}
        label_y={height - pad.b + AXIS_TITLE_OFFSET + (final_x_axis.label_shift?.y ?? 0)}
        axis_loading={axis_loading === `x`}
        on_axis_change={(key) => handle_axis_change(`x`, key)}
      />
    {/if}

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

    {#if facet.axis_visible(`y`)}
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
    {#if has_x2_points && facet.axis_visible(`x2`)}
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
        label_y={Math.max(12, pad.t - (final_x2_axis.label_shift?.y ?? AXIS_TITLE_OFFSET))}
        axis_loading={axis_loading === `x2`}
        on_axis_change={(key) => handle_axis_change(`x2`, key)}
      />
    {/if}

    <!-- Tooltip rendered inside overlay (moved outside SVG for stacking above colorbar) -->

    <ZeroLines {frame} display={final_display} />

    <!-- Fill regions: below lines (default z-index) -->
    {@render fill_regions_layer(fills_by_z.below_lines)}
    <!-- Reference lines: below lines (default z-index) -->
    {@render ref_lines_layer(ref_lines_by_z.below_lines)}

    <!-- Lines -->
    {#if styles.show_lines}
      {#each filtered_series as series_data (series_data._id)}
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
          {#if series_markers.includes(`line`)}
            {@const all_line_points = series_data.x.map((x, idx) => ({
              x,
              y: series_data.y[idx],
            }))}
            {@const finite_screen_points = all_line_points
              .map((point) => get_screen_coords(point, series_data))
              .filter(([sx, sy]) => isFinite(sx) && isFinite(sy))}
            {@const apply_line_controls = applies_style_controls(series_data)}
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

    {#if use_canvas_markers}
      <!-- Keep the canvas in SVG paint order: above lines, below SVG marker overlays and
             explicit above-all layers. Pointer events remain on the parent SVG. -->
      <foreignObject
        x="0"
        y="0"
        {width}
        {height}
        pointer-events="none"
        {@attach attach_marker_canvas}
      ></foreignObject>
    {/if}

    <!-- Canvas mode retains only labelled/hovered/selected points here. -->
    {#if styles.show_points}
      {#each filtered_series as series_data, series_pos (series_data._id)}
        {@const series_markers = series_data.markers ?? DEFAULT_MARKERS}
        {@const rendered_points = use_canvas_markers
          ? (svg_overlay_points_by_series[series_pos] ?? [])
          : series_data.filtered_data}
        <g data-series-id={series_data._id} clip-path="url(#{clip_path_id})">
          {#if series_markers.includes(`points`)}
            {#each rendered_points as point (`${point.series_idx}-${point.point_idx}`)}
              {@const label_id = `${point.series_idx}-${point.point_idx}`}
              {@const calculated_label_pos = label_positions[label_id]}
              {@const point_label = point.point_label ?? {}}
              {@const marker_screen = point_screen_xy(
                point,
                series_screen_scales(series_data),
              )}
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
                      x: calculated_label_pos.x - marker_screen.cx,
                      y: calculated_label_pos.y - marker_screen.cy,
                    },
                  }
                : label_style}
              {@const [raw_screen_x, raw_screen_y] = get_screen_coords(point, series_data)}
              {@const screen_x = isFinite(raw_screen_x) ? raw_screen_x : x_scale_fn.range()[0]}
              {@const screen_y = isFinite(raw_screen_y)
                ? raw_screen_y
                : (series_data.y_axis === `y2` ? y2_scale_fn : y_scale_fn).range()[0]}
              {@const appearance = point_appearance(point, series_data)}
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
                overlay_only={use_canvas_markers && !needs_static_svg_overlay(point)}
                style={{
                  symbol_type: appearance.symbol_type,
                  ...point.point_style,
                  radius: appearance.radius,
                  stroke_width: appearance.stroke_width,
                  stroke: appearance.stroke,
                  stroke_opacity: appearance.stroke_opacity,
                  fill_opacity: appearance.fill_opacity,
                  cursor: on_point_click || point_events?.onclick ? `pointer` : undefined,
                }}
                hover={point.point_hover ?? {}}
                label={final_label}
                offset={point.point_offset ?? { x: 0, y: 0 }}
                point_tween={effective_point_tween}
                --point-fill-color={appearance.fill}
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
  {/snippet}

  {#snippet overlays()}
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
        exclusion_rects={decoration_exclusion_rects}
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
          {#if hp.color_bar?.value != null}
            <br />{@html sanitize_html(hp.color_bar.title || `Color`)}: {format_value(
              hp.color_bar.value,
              hp.color_bar.tick_format || `.3~g`,
            )}
          {/if}
        {/if}
      </PlotTooltip>
    {/if}

    <!-- Control Pane -->
    {#if show_controls}
      <ScatterPlotControls
        toggle_props={{
          ...controls_toggle_props,
          style: `--ctrl-btn-right: var(--fullscreen-btn-offset, 30px); top: var(--ctrl-btn-top, 5pt); ${
            controls_toggle_props?.style ?? ``
          }`,
        }}
        pane_props={controls_pane_props}
        bind:show_controls
        bind:controls_open
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
        {has_x2_points}
        {has_y2_points}
        children={controls_extra}
        on_touch={(key: string) => touched.add(key)}
      />
    {/if}

    <!-- Color Bar -->
    {#if width > 0 && height > 0 && color_bar && all_color_values.length > 0}
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
        data-decoration-location={colorbar_placement?.location}
        data-decoration-side={colorbar_placement?.side}
        data-decoration-x={colorbar_placement?.x}
        data-decoration-y={colorbar_placement?.y}
        data-decoration-width={colorbar_placement?.footprint.width}
        data-decoration-height={colorbar_placement?.footprint.height}
        style={`position: absolute; left: ${colorbar_tween.coords.current.x}px; top: ${
          colorbar_tween.coords.current.y
        }px; ${color_bar.wrapper_style ?? ``}; pointer-events: auto;`}
      >
        <ColorBar
          tick_labels={4}
          tick_side="primary"
          scale={{ fn: color_scale_fn, domain: color_domain }}
          scale_type={typeof color_scale === `string` ? undefined : color_scale.type}
          range={color_domain?.every((val) => val != null) ? color_domain : undefined}
          bar_style="width: {COLOR_BAR_DEFAULTS.width}px; height: {COLOR_BAR_DEFAULTS.horizontal_bar_height}px; {color_bar?.style ??
            ``}"
          {...color_bar}
          wrapper_style={color_bar.wrapper_style ? `height: 100%; width: 100%;` : ``}
        />
      </div>
    {/if}

    <!-- Legend -->
    {#if should_show_legend}
      {@const solved_position = legend_placement ?? { x: pad.l + 10, y: pad.t + 10 }}
      {@const auto_position =
        legend_placement?.location === `outside`
          ? solved_position
          : legend_tween.placed()
            ? legend_tween.coords.current
            : solved_position}
      {@const current_position =
        legend_is_dragging && legend_manual_position ? legend_manual_position : auto_position}
      <PlotLegend
        bind:root_element={frame.legend_element}
        data-decoration-location={legend_placement?.location}
        data-decoration-side={legend_placement?.side}
        data-decoration-x={legend_placement?.x}
        data-decoration-y={legend_placement?.y}
        data-decoration-width={legend_placement?.footprint.width}
        data-decoration-height={legend_placement?.footprint.height}
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
        bind:filter_query={frame.legend_filter_query}
        layout_tracks={resolve_legend_layout_tracks(legend?.layout_tracks, legend_placement)}
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
          left: ${current_position.x}px;
          top: ${current_position.y}px;
          pointer-events: auto;
          ${legend?.style ?? ``}
        `}
      />
    {/if}
  {/snippet}
</CartesianFrame>

<style>
  /* Center the colorbar within its wrapper when shorter than it (e.g. capped by --cbar-max-height
     in fullscreen). Users can override via wrapper_style (inline wins). */
  .colorbar-wrapper {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  :global(.scatter.fullscreen svg),
  :global(.scatter.fullscreen .axis-label) {
    font-size: var(--scatter-fullscreen-font-size, var(--scatter-font-size, inherit));
  }
  :global(.scatter .axis-label) {
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
