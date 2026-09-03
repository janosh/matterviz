<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import { error_bounds } from '$lib/plot/core/error-bars'
  import { create_chart_exporter, series_to_csv_rows } from '$lib/plot/core/utils/chart-export'
  import { type D3InterpolateName, plot_color, resolve_computed_color } from '$lib/colors'
  import { format_value, format_value_or_num } from '$lib/labels'
  import { sanitize_html } from '$lib/sanitize'
  import { partition_point, type Point2D, type Vec2 } from '$lib/math'
  import type {
    AxisLoadError,
    AxisRanges,
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
    LayerZIndex,
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
  } from '$lib/plot/core/types'
  import { FillArea, Line, PlotTooltip, ZeroLines } from '$lib/plot/core/components'
  import ScatterPlotControls from './ScatterPlotControls.svelte'
  import ScatterPoint from './ScatterPoint.svelte'
  import type { RunningExtent } from '$lib/plot/core/scales'
  import {
    accumulate_extent,
    collect_scale_values,
    create_color_scale,
    create_scale,
    create_size_scale,
    empty_extent,
    log_floor_scale,
    nice_range_from_extent,
  } from '$lib/plot/core/scales'
  import ReferenceLinesLayer from '$lib/plot/core/components/ReferenceLinesLayer.svelte'
  import CartesianFrame from '$lib/plot/core/components/CartesianFrame.svelte'
  import ColorBarDecoration from '$lib/plot/core/components/ColorBarDecoration.svelte'
  import PlotAxes from '$lib/plot/core/components/PlotAxes.svelte'
  import PlotLegendLayer from '$lib/plot/core/components/PlotLegendLayer.svelte'
  import { create_colorbar_decoration } from '$lib/plot/core/colorbar-decoration.svelte'
  import type { MarginalSeriesInput, MarginalsProp } from '$lib/plot/core/marginals'
  import { normalize_marginals } from '$lib/plot/core/marginals'
  import { assign_axes, axis_labels, axis_scale_types } from '$lib/plot/core/axis-assignment'
  import {
    AXIS_DEFAULTS,
    create_axis_loader,
    X2_AXIS_DEFAULTS,
  } from '$lib/plot/core/axis-utils'
  import type { AxisChangeState } from '$lib/plot/core/axis-utils'
  import { first_point_style, get_series_symbol } from '$lib/plot/core/data-transform'
  import { FACET_AXES, type FacetAxis, type FacetLayoutContext } from '$lib/plot/core/facets'
  import { with_obstacle_frame } from '$lib/plot/core/decorations'
  import {
    COLOR_BAR_DEFAULTS,
    DEFAULT_MARKERS,
    is_time_scale,
    SCALE_DEFAULTS,
  } from '$lib/plot/core/types'
  import { compute_label_positions } from '$lib/plot/core/utils/label-placement'
  import {
    create_roving_focus,
    ROVING_ATTR,
    roving_key,
  } from '$lib/plot/core/utils/roving-focus.svelte'
  import {
    create_legend_visibility,
    legend_mode_to_prop,
    resolve_legend_visibility,
  } from '$lib/plot/core/utils/series-visibility'
  import { DEFAULTS } from '$lib/settings'
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
    get_relative_coords,
    is_activation_key,
    sorted_range,
    vec2_equal,
  } from '$lib/plot/core/interactions'
  import { create_cartesian_frame } from '$lib/plot/core/cartesian-frame.svelte'
  import { resolve_plot_display } from '$lib/plot/core/display.svelte'
  import type { Rect, Sides } from '$lib/plot/core/layout'
  import { stride_sample } from '$lib/plot/core/layout'
  import { index_ref_lines } from '$lib/plot/core/reference-line'
  import { type CanvasMarker, draw_markers } from '$lib/plot/core/canvas-markers'
  import { build_spatial_index, query_nearest } from '$lib/plot/core/spatial-index'
  import { resolve_line_tween } from '$lib/plot/core/utils'
  import type ColorBar from '$lib/plot/core/components/ColorBar.svelte'
  import { color as d3_color } from 'd3-color'
  import {
    build_legend_data,
    filter_series_to_ranges,
    legend_row_dedupe,
    materialize_series_points,
    pick_tooltip_bg,
    scatter_legend_rows,
  } from './scatter-data'

  // Marker-density thresholds and decoration sampling cap
  const DENSE_MARKER_COUNT = 100
  const OBSTACLE_SAMPLE_LIMIT = 500
  const CANVAS_MARKER_THRESHOLD = 10_000
  const ZERO_OFFSET = { x: 0, y: 0 }

  let {
    series: series_in = $bindable([]),
    x_axis = $bindable({}),
    x2_axis = $bindable({}),
    y_axis = $bindable({}),
    y2_axis = $bindable({}),
    // Clone so the controls' checkbox writes never mutate the shared DEFAULTS
    display = $bindable({ ...DEFAULTS.plot.display }),
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
    selected_points = $bindable([]),
    on_select,
    hovered = $bindable(false),
    tooltip,
    user_content,
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
    on_plot_click,
    fill_regions = $bindable([]),
    error_bands = [],
    on_fill_click,
    on_fill_hover,
    ref_lines = $bindable([]),
    on_ref_line_click,
    on_ref_line_hover,
    selected_series_idx = $bindable(0),
    wrapper = $bindable(),
    resolved_padding = $bindable(),
    view = $bindable(),
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
    error_bar_cap = 4,
    point_hit_padding = 0,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `title` | `children`> &
    Omit<BasePlotProps, `children`> &
    PlotConfig & {
      series?: DataSeries<Metadata>[]
      // HTML overlays after the SVG, with the frame's scales so they can anchor to data coords
      children?: Snippet<[UserContentProps]>
      styles?: StyleOverrides
      current_x_value?: number | null
      tooltip_point?: InternalPoint<Metadata> | null
      selected_point?: { series_idx: number; point_idx: number } | null
      // Points inside the last Alt+drag rect. Bindable so a host can drive linked views
      // (or clear it); the chart renders them with the same treatment as selected_point.
      selected_points?: { series_idx: number; point_idx: number }[]
      // Fires on every Alt+drag, including one that selected nothing - a host filtering
      // another view needs to hear "empty" as much as it needs to hear a list
      on_select?: (selection: {
        points: InternalPoint<Metadata>[]
        rect: { x: Vec2; y: Vec2 }
      }) => void
      tooltip?: Snippet<[ScatterHandlerProps<Metadata>]>
      user_content?: Snippet<[UserContentProps]>
      header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
      controls_extra?: Snippet<
        [{ styles: StyleOverrides; selected_series_idx: number } & Required<PlotConfig>]
      >
      color_scale?: ColorScaleConfig | D3InterpolateName
      size_scale?: SizeScaleConfig
      color_bar?:
        | (ComponentProps<typeof ColorBar> & {
            tween?: TweenOptions<Point2D>
            responsive?: boolean // Allow colorbar to reposition if density changes (default: false)
            axis_clearance?: number // Min distance kept from plot edges/axes (default: 8)
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
      on_plot_click?: (data: ScatterHandlerEvent<Metadata>) => void
      fill_regions?: FillRegion[] // Bindable for legend toggle support
      error_bands?: ErrorBand[]
      on_fill_click?: (event: FillHandlerEvent) => void
      on_fill_hover?: (event: FillHandlerEvent | null) => void
      ref_lines?: RefLine[] // Bindable for legend toggle support
      on_ref_line_click?: (event: RefLineEvent) => void
      on_ref_line_hover?: (event: RefLineEvent | null) => void
      selected_series_idx?: number
      wrapper?: HTMLDivElement
      // Read-only: the padding actually in effect (auto axis bands, caller padding, outside
      // decorations), so hosts laying out several plots (BandsAndDos) can feed the maximum
      // back as a shared `padding` and keep their chart areas aligned
      resolved_padding?: Required<Sides>
      // The range each axis currently shows, after pan/zoom. The chart writes every change;
      // a host writing an axis moves the view without touching the axis config, so linked
      // panels (BandsAndDos) share one zoom while each keeps its own pins and reset target.
      view?: Partial<AxisRanges>
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
      // Half-width of the T caps on error bars, in px (0 draws bare lines)
      error_bar_cap?: number
      // Extra invisible SVG radius around interactive markers, in screen pixels.
      point_hit_padding?: number
    } = $props()

  // Legend toggles write back into the bindable series prop; see create_legend_visibility
  const legend_vis = create_legend_visibility(
    () => series,
    (next) => (series_in = next),
  )
  let series: DataSeries<Metadata>[] = $derived(legend_vis.resolve(series_in))

  const wrapper_text_color = resolve_computed_color(() => wrapper, `color`, {
    fallback: `#000`,
  })

  // Assign visible series by unit/axis_group while preserving every explicit y_axis.
  // Dimensionless series retain the historical y1 default. Re-running this derived after a
  // legend toggle lets the remaining visible group move back to y1. `_id` (series.id, else
  // index) keys the rendered series so reordering with stable ids doesn't remount marks;
  // duplicate ids would make Svelte's keyed each throw mid-render, so fail early here.
  // Null/undefined entries pass through untouched; every consumer skips them.
  const series_with_ids = $derived.by(() => {
    const seen_ids = new Set<string | number>()
    for (const srs of series) {
      if (!srs || typeof srs !== `object` || srs.id == null) continue
      if (seen_ids.has(srs.id)) {
        throw new Error(`ScatterPlot series ids must be unique, got duplicate id "${srs.id}"`)
      }
      seen_ids.add(srs.id)
    }
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
      if (!srs || typeof srs !== `object`) return srs
      const assigned_y = srs.y_axis ?? assignment.assignments[series_idx]
      return { ...srs, ...(assigned_y && { y_axis: assigned_y }), _id: srs.id ?? series_idx }
    })
  })

  const inferred_y_axes = $derived.by(() => {
    const valid_series = series_with_ids.filter((srs) =>
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
  const final_x_axis = $derived({ ...AXIS_DEFAULTS, ...x_axis })
  const final_y_axis = $derived({ ...AXIS_DEFAULTS, ...inferred_y_axes.y1, ...y_axis })
  const final_x2_axis = $derived({ ...X2_AXIS_DEFAULTS, ...x2_axis })
  const final_y2_axis = $derived({ ...AXIS_DEFAULTS, ...inferred_y_axes.y2, ...y2_axis })
  // Time axes only differ in range nicing; their scales are linear over epoch milliseconds
  const is_time_x = $derived(is_time_scale(final_x_axis.scale_type))
  const is_time_x2 = $derived(is_time_scale(final_x2_axis.scale_type))
  const final_display = $derived(resolve_plot_display(display, DEFAULTS.plot.display))
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
  // Control keys the user has modified; only those override authored per-series styles
  let touched = new SvelteSet<string>()

  // Fill region hover state
  let hovered_fill_key = $state<string | null>(null)

  // Interactive axis loading state
  let axis_loading = $state<`x` | `x2` | `y` | `y2` | null>(null)

  // State to hold the calculated label positions after simulation
  let label_positions = $state<Record<string, Point2D>>({})

  // Hovering a legend entry fades every other series
  const is_legend_dimmed = (series_idx: number | undefined): boolean =>
    frame.hovered_series_idx !== null && frame.hovered_series_idx !== series_idx

  // Finite extents of the visible series per axis, without materializing point objects.
  // Hidden series widen no axis, so toggling one off lets the view tighten on every axis.
  let extents_by_axis = $derived.by(() => {
    const all_x = empty_extent()
    const y1 = empty_extent()
    const y2 = empty_extent()
    const x2 = empty_extent()
    let has_x2_points = false
    let has_y2_points = false

    for (const srs of series_with_ids) {
      if (!srs || srs.visible === false) continue
      const { line_underlays = [], y_axis: series_y_axis = `y1`, x_axis: x_ax = `x1` } = srs
      for (const { x: layer_x, y: layer_y } of [srs, ...line_underlays]) {
        // x drives the point count: a y array of a different length is read through x.length
        const n_points = layer_x.length
        accumulate_extent(all_x, layer_x, n_points)
        const y_extent = series_y_axis === `y2` ? y2 : y1
        accumulate_extent(y_extent, layer_y, n_points)
        if (x_ax === `x2`) accumulate_extent(x2, layer_x, n_points)
        // Error bars reach past their point, so the axis has to reach with them or the
        // caps get clipped. Underlays carry no error of their own, hence the identity
        // check: only the series itself contributes.
        if (layer_x === srs.x) {
          const x_bounds = error_bounds(srs.x, srs.x_error, n_points)
          const y_bounds = error_bounds(srs.y, srs.y_error, n_points)
          for (const bound of [x_bounds?.lo, x_bounds?.hi]) {
            if (bound) {
              accumulate_extent(all_x, bound, n_points)
              if (x_ax === `x2`) accumulate_extent(x2, bound, n_points)
            }
          }
          for (const bound of [y_bounds?.lo, y_bounds?.hi]) {
            if (bound) accumulate_extent(y_extent, bound, n_points)
          }
        }
        const needs_axis_probe: boolean =
          (x_ax === `x2` && !has_x2_points) || (series_y_axis === `y2` && !has_y2_points)
        const has_drawable_point: boolean =
          needs_axis_probe &&
          layer_x.some(
            (x_value, point_idx) =>
              Number.isFinite(x_value) && Number.isFinite(layer_y[point_idx]),
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
  // Data-driven ranges before user overrides and pan/zoom; also the controls' reset targets
  const intrinsic_ranges = $derived({
    x: auto_range(extents_by_axis.all_x, final_x_axis, is_time_x),
    x2: auto_range(extents_by_axis.x2, final_x2_axis, is_time_x2),
    y: auto_range(extents_by_axis.y1, final_y_axis),
    y2: auto_range(extents_by_axis.y2, final_y2_axis),
  })
  const frame = create_cartesian_frame({
    axes: () => ({ x: final_x_axis, x2: final_x2_axis, y: final_y_axis, y2: final_y2_axis }),
    auto_ranges: () => intrinsic_ranges,
    // Keep the current view on an axis whose series are all hidden instead of snapping to
    // the default range, so toggling series off doesn't jump the plot
    range_sync: `expand`,
    has_data: () => ({
      x: extents_by_axis.all_x.n_finite > 0,
      x2: extents_by_axis.x2.n_finite > 0,
      y: extents_by_axis.y1.n_finite > 0,
      y2: extents_by_axis.y2.n_finite > 0,
    }),
    has_x2: () => has_x2_points,
    has_y2: () => has_y2_points,
    padding: () => padding,
    title: () => title,
    obstacles: () => obstacles_norm,
    legend: () => legend,
    legend_visible: () => should_show_legend,
    legend_items: () => legend_track_items,
    legend_footprint_fallback: { width: 120, height: 80 },
    decorations: () => colorbar.items,
    exclusion_rects: () => pinned_colorbar_rects,
    marginals: () => resolved_marginals,
    ref_lines: () => indexed_ref_lines,
    pan: () => pan,
    facet_layout: () => facet_layout,
    // Alt+drag selects instead of zooming. Hit-tested in screen space (not by inverting
    // the rect into data space) so the same test works on both axes whatever their scale
    // types, and so a point's own offset counts - the user selects what they see.
    on_rect_select: (start, current) => {
      const [x_lo, x_hi] = sorted_range(start.x, current.x)
      const [y_lo, y_hi] = sorted_range(start.y, current.y)
      const picked: InternalPoint<Metadata>[] = []
      for (const series_data of filtered_series) {
        if (!(series_data.markers ?? DEFAULT_MARKERS).includes(`points`)) continue
        const project = series_projector(series_data)
        for (const point of series_data.filtered_data) {
          const [cx, cy] = project.point(point)
          if (cx >= x_lo && cx <= x_hi && cy >= y_lo && cy <= y_hi) picked.push(point)
        }
      }
      selected_points = picked.map(({ series_idx, point_idx }) => ({ series_idx, point_idx }))
      on_select?.({
        points: picked,
        rect: { x: [x_lo, x_hi], y: [y_lo, y_hi] },
      })
    },
    // Live tooltip while rect-dragging: update for the closest point inside the plot
    // bounds, clear when the cursor leaves the svg
    on_drag_move: (coords, inside_svg) => {
      if (inside_svg) update_tooltip_point(coords.x, coords.y)
      else tooltip_point = null
    },
    clip_id_prefix: `plot-area-clip`,
  })

  // Short aliases for the frame values the marks, axes and overlays read most
  const width = $derived(frame.width)
  const height = $derived(frame.height)
  const pad = $derived(frame.pad)
  const clip_path_id = frame.clip_path_id
  const { pan_zoom } = frame
  const x_scale_fn = $derived(frame.scales.x)
  const x2_scale_fn = $derived(frame.scales.x2)
  const y_scale_fn = $derived(frame.scales.y)
  const y2_scale_fn = $derived(frame.scales.y2)
  let [x_min, x_max] = $derived(frame.ranges.current.x)
  let [x2_min, x2_max] = $derived(frame.ranges.current.x2)
  let [y_min, y_max] = $derived(frame.ranges.current.y)
  let [y2_min, y2_max] = $derived(frame.ranges.current.y2)

  $effect(() => {
    resolved_padding = frame.pad
  })

  // Two-way `view` sync. Value comparison on both legs keeps the pair from ping-ponging:
  // the frame's write lands as a fresh Vec2 per axis, and a host mirroring it back must
  // not count as a new zoom.
  $effect(() => {
    const current = frame.ranges.current
    const shown = untrack(() => view)
    const in_sync = (axis: FacetAxis) =>
      shown?.[axis] && vec2_equal(shown[axis], current[axis])
    if (FACET_AXES.every(in_sync)) return
    view = Object.fromEntries(FACET_AXES.map((axis) => [axis, [...current[axis]] as Vec2]))
  })
  $effect(() => {
    if (!view) return
    for (const axis of FACET_AXES) {
      const range = view[axis]
      const current = untrack(() => frame.ranges.current[axis])
      if (range && !vec2_equal(range, current)) {
        frame.facet.update_range(axis, [...range] as Vec2)
      }
    }
  })

  // === Colorbar: the frame owns the legend item, the colorbar is ScatterPlot's own decoration ===
  // ColorBar's orientation prop defaults to horizontal, so treat unset as horizontal too.
  const colorbar = create_colorbar_decoration({
    id: `colorbar`,
    enabled: () =>
      Boolean(color_bar && has_color_values && !color_bar.wrapper_style && width && height),
    horizontal: () => (color_bar?.orientation ?? `horizontal`) === `horizontal`,
    clearance: () => color_bar?.axis_clearance,
    dims: () => ({ width, height }),
    decoration_solution: () => frame.decoration_solution,
    responsive: () => color_bar?.responsive ?? false,
    tween: () => color_bar?.tween,
  })

  // Plot-specific immutable obstacle field: visible series points and sampled line segments in
  // normalized [0,1] coordinates (y=0 at top). Each series uses its assigned x/y scale.
  const obstacles_norm = $derived.by(() =>
    with_obstacle_frame(frame, filtered_series.length > 0, ({ base_w, base_h }) =>
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
    ),
  )

  // An explicitly styled colorbar stays outside solver ownership, but its measured
  // rectangle remains an exclusion for the automatic items (the frame does this for the legend)
  const pinned_colorbar_rects = $derived.by((): Rect[] => {
    const { element, footprint } = colorbar
    if (!element || !color_bar?.wrapper_style) return []
    const { offset_x, offset_y } = footprint
    return [
      { x: element.offsetLeft + offset_x, y: element.offsetTop + offset_y, ...footprint },
    ]
  })

  // Same rows, dedupe and series numbering as build_legend_data below, so the solver reserves
  // room for exactly the rows PlotLegend draws, without depending on frame geometry.
  const legend_track_items = $derived.by(() => {
    const first_seen = legend_row_dedupe()
    return [
      ...scatter_legend_rows(series_with_ids),
      ...fill_regions.flatMap((fill) =>
        fill.show_in_legend !== false && fill.label
          ? [{ label: fill.label, legend_group: fill.legend_group }]
          : [],
      ),
      ...error_bands.flatMap((band) =>
        band.show_in_legend !== false && band.label ? [{ label: band.label }] : [],
      ),
    ].filter(first_seen)
  })

  const resolved_marginals = $derived(
    normalize_marginals(marginals, { top: true, right: true }),
  )
  // Map series to the generic marginal input, reusing the line/legend color fallback. Skipped
  // (the default) while no strip is enabled so data changes don't pay for it.
  const marginal_series = $derived<MarginalSeriesInput[]>(
    Object.values(resolved_marginals).some(Boolean)
      ? series_with_ids.map((srs, idx) => ({
          x: srs?.x ?? [],
          y: srs?.y ?? [],
          color:
            srs?.line_style?.stroke ??
            first_point_style(srs)?.fill ??
            plot_color(srs?.orig_series_idx ?? idx),
          label: srs?.label,
          visible: srs?.visible ?? true,
          x_axis: srs?.x_axis,
          y_axis: srs?.y_axis,
        }))
      : [],
  )
  // Finite color extent and finite size values across all series, one pass. NaN/null entries
  // fall back to the series color/radius per point, so they must not widen either scale.
  const color_size_values = $derived(collect_scale_values(series_with_ids))
  const has_color_values = $derived(color_size_values.color_extent.n_finite > 0)
  const auto_color_range = $derived(color_size_values.color_range)
  let size_scale_fn = $derived(create_size_scale(size_scale, color_size_values.size_values))
  const color_scale_config = $derived<ColorScaleConfig>(
    typeof color_scale === `string` ? { scheme: color_scale } : color_scale,
  )
  let color_scale_fn = $derived(create_color_scale(color_scale_config, auto_color_range))

  // Visible series with their in-range points: InternalPoints are built once per data change
  // and only picked by range on each pan/zoom frame
  const materialized_series = $derived(materialize_series_points(series_with_ids))
  let filtered_series = $derived(
    filter_series_to_ranges(materialized_series, {
      x: [x_min, x_max],
      x2: [x2_min, x2_max],
      y: [y_min, y_max],
      y2: [y2_min, y2_max],
    }),
  )
  type FilteredSeries = (typeof filtered_series)[number]

  // Tally line series/points to budget path-morph tweens (see resolve_line_tween).
  // Disabling the morph for high-cardinality plots (e.g. phonon bands) keeps them
  // snappy; Line.svelte short-circuits the Tween when duration <= 0.
  let line_tween_load = $derived.by(() => {
    if (!styles.show_lines) return { series: 0, points: 0 }
    let [n_series, n_points] = [0, 0]
    for (const srs of filtered_series) {
      if (!(srs.markers ?? DEFAULT_MARKERS).includes(`line`)) continue
      const line_layers = [srs, ...(srs.line_underlays ?? [])]
      n_series += line_layers.length
      n_points += line_layers.reduce((sum, layer) => sum + layer.x.length, 0)
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

  // Apply controls to the selected series (by original index, which survives range filtering)
  const applies_style_controls = (series_data: { orig_series_idx?: number }): boolean =>
    show_controls &&
    (!has_multiple_series || series_data.orig_series_idx === selected_series_idx)

  const is_finite_num = (val: number | null | undefined): val is number =>
    typeof val === `number` && Number.isFinite(val)

  // Marker appearance shared by the canvas and SVG paths so they can't drift. Everything that
  // is constant across a series (control overrides, defaults, scales, the plot colour) is read
  // once here; the returned closure only touches the point's own style/colour/size. Reading
  // those reactive values per point cost more than all the geometry at 100k points. It
  // builds the CanvasMarker directly (position + opacity included) so the canvas path
  // allocates one object per point instead of an appearance object spread into a marker.
  const series_appearance = (series_data: FilteredSeries) => {
    const series_idx = series_data.orig_series_idx ?? 0
    const control_touched = applies_style_controls(series_data) ? touched : null
    const point_ctrl = styles.point
    const ctrl = <T>(key: string, value: T | null | undefined): T | null =>
      control_touched?.has(key) ? (value ?? null) : null
    const ctrl_radius = ctrl(`point.size`, point_ctrl?.size)
    const ctrl_fill = ctrl(`point.color`, point_ctrl?.color)
    const ctrl_fill_opacity = ctrl(`point.opacity`, point_ctrl?.opacity)
    const ctrl_stroke = ctrl(`point.stroke_color`, point_ctrl?.stroke_color)
    const ctrl_stroke_width = ctrl(`point.stroke_width`, point_ctrl?.stroke_width)
    const ctrl_stroke_opacity = ctrl(`point.stroke_opacity`, point_ctrl?.stroke_opacity)
    const [sparse_radius, dense_radius] = (series_data.markers ?? DEFAULT_MARKERS).includes(
      `line`,
    )
      ? [2.5, 2]
      : [3, 2.5]
    const default_radius =
      visible_marker_count >= DENSE_MARKER_COUNT ? dense_radius : sparse_radius
    const default_fill = plot_color(series_idx)
    // styles.point.symbol_type is only ever set by a caller (DEFAULTS.scatter.point has none),
    // so it needs no touched gate: it replaces the per-series cycle, never an authored style
    const default_symbol = point_ctrl?.symbol_type ?? get_series_symbol(series_idx)
    const fallback_stroke = wrapper_text_color.current
    const { stroke_width: default_stroke_width, stroke_opacity: default_stroke_opacity } =
      DEFAULTS.scatter.point
    const [size_fn, color_fn] = [size_scale_fn, color_scale_fn]
    return {
      marker_of: (
        point: InternalPoint<Metadata>,
        cx = 0,
        cy = 0,
        opacity = 1,
      ): CanvasMarker => {
        const pt = point.point_style
        const stroke = ctrl_stroke ?? pt?.stroke
        return {
          cx,
          cy,
          opacity,
          radius: is_finite_num(point.size_value)
            ? size_fn(point.size_value)
            : (ctrl_radius ?? pt?.radius ?? default_radius),
          symbol_size: pt?.symbol_size ?? undefined,
          symbol_type: pt?.symbol_type ?? default_symbol,
          fill: is_finite_num(point.color_value)
            ? color_fn(point.color_value)
            : (ctrl_fill ?? pt?.fill ?? default_fill),
          fill_opacity: ctrl_fill_opacity ?? pt?.fill_opacity ?? 1,
          stroke: stroke ?? fallback_stroke,
          stroke_width: ctrl_stroke_width ?? pt?.stroke_width ?? default_stroke_width,
          stroke_opacity:
            ctrl_stroke_opacity ??
            pt?.stroke_opacity ??
            (stroke == null ? default_stroke_opacity : 1),
        }
      },
      // Colour-scale output is always a d3 colour, so only authored paints are checked.
      // They come from a handful of strings, so the memo below makes this O(1) per point.
      canvas_safe: (point: InternalPoint<Metadata>): boolean => {
        const pt = point.point_style
        const fill = is_finite_num(point.color_value)
          ? null
          : (ctrl_fill ?? pt?.fill ?? default_fill)
        return (
          (fill == null || canvas_safe_color(fill)) &&
          canvas_safe_color(ctrl_stroke ?? pt?.stroke ?? fallback_stroke)
        )
      },
    }
  }

  // Per-series data->pixel projection, resolved once per series: `point` places a marker
  // (with its point_offset), `line` maps raw x/y for connecting lines, where a non-positive
  // value on a log y axis is held at the domain floor instead of vanishing. Time axes are
  // linear scales over epoch milliseconds, so x needs no Date wrapping.
  const series_projector = (series_data: Pick<DataSeries, `x_axis` | `y_axis`>) => {
    const use_y2 = series_data.y_axis === `y2`
    const x_scale = series_data.x_axis === `x2` ? x2_scale_fn : x_scale_fn
    const y_scale = use_y2 ? y2_scale_fn : y_scale_fn
    const y_axis_config = use_y2 ? final_y2_axis : final_y_axis
    const y_line_scale = log_floor_scale(y_scale, y_axis_config.scale_type, y_scale.domain())
    // x needs the same floor as y for error bars: a lower end at or below zero on a log
    // x axis has no finite pixel, and one non-finite end drops the whole bar
    const x_axis_config = series_data.x_axis === `x2` ? final_x2_axis : final_x_axis
    const x_line_scale = log_floor_scale(x_scale, x_axis_config.scale_type, x_scale.domain())
    return {
      x_scale,
      point: (point: InternalPoint<Metadata>): Vec2 => [
        x_scale(point.x) + (point.point_offset?.x ?? 0),
        y_scale(point.y) + (point.point_offset?.y ?? 0),
      ],
      // Error-bar ends, in the same offset frame as the point so the bar stays centred
      // on the marker the caller moved. Held at the log domain floor rather than
      // vanishing to NaN when a lower end runs non-positive on a log axis.
      error_span: (point: InternalPoint<Metadata>, axis: `x` | `y`): Vec2 | null => {
        const error = axis === `x` ? point.x_error : point.y_error
        if (!error || (error[0] === 0 && error[1] === 0)) return null
        const [value, offset] =
          axis === `x`
            ? [point.x, point.point_offset?.x ?? 0]
            : [point.y, point.point_offset?.y ?? 0]
        const scale = axis === `x` ? x_line_scale : y_line_scale
        const [lo, hi] = [scale(value - error[0]) + offset, scale(value + error[1]) + offset]
        return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null
      },
      line: (line: Pick<DataSeries, `x` | `y`>): Vec2[] => {
        const screen: Vec2[] = []
        for (let idx = 0; idx < line.x.length; idx++) {
          const screen_x = x_scale(line.x[idx])
          const screen_y = y_line_scale(line.y[idx])
          if (Number.isFinite(screen_x) && Number.isFinite(screen_y)) {
            screen.push([screen_x, screen_y])
          }
        }
        return screen
      },
    }
  }

  // Points needing labels or effects remain in an SVG overlay. `selected` is passed in so
  // per-point loops read the prop once, not per point.
  const same_logical_point = (
    point: InternalPoint<Metadata>,
    other: { series_idx: number; point_idx: number } | null,
  ): boolean => other?.series_idx === point.series_idx && other.point_idx === point.point_idx
  const needs_static_svg_overlay = (
    point: InternalPoint<Metadata>,
    selected: typeof selected_point,
  ): boolean =>
    point.point_label?.text != null ||
    same_logical_point(point, selected) ||
    // Rect-selected points get the same treatment as `selected_point`, so they must be
    // lifted out of the canvas bitmap too - otherwise a selection past the marker
    // threshold silently paints nothing
    selected_keys.has(roving_key(point.series_idx, point.point_idx)) ||
    Boolean(point.point_style?.is_highlighted && point.point_style.highlight_effect)

  // Canvas ignores invalid paint values, so restrict it to d3 colors and SVG's no-paint
  // keyword. Memoized: a plot authors only a handful of distinct paint strings.
  const canvas_color_safety = new Map<string, boolean>()
  const canvas_safe_color = (color: string): boolean => {
    let safe = canvas_color_safety.get(color)
    if (safe === undefined) {
      if (canvas_color_safety.size >= 1024) canvas_color_safety.clear()
      safe = color === `none` || d3_color(color) !== null
      canvas_color_safety.set(color, safe)
    }
    return safe
  }
  // Canvas markers for every plain point, or null when markers must be SVG: canvas not
  // requested, no points shown, DOM point handlers needed, or a paint value canvas can't
  // parse. One pass decides the mode and builds the markers.
  const canvas_markers = $derived.by((): CanvasMarker[] | null => {
    const canvas_requested =
      marker_renderer === `canvas` ||
      (marker_renderer === `auto` && visible_marker_count > CANVAS_MARKER_THRESHOLD)
    const needs_svg_events =
      on_point_click || (point_events && Object.values(point_events).some(Boolean))
    if (!canvas_requested || !styles.show_points || needs_svg_events) return null
    const selected = selected_point
    const markers: CanvasMarker[] = []
    for (const series_data of filtered_series) {
      if (!(series_data.markers ?? DEFAULT_MARKERS).includes(`points`)) continue
      const { marker_of, canvas_safe } = series_appearance(series_data)
      const project = series_projector(series_data)
      const opacity = is_legend_dimmed(series_data.orig_series_idx) ? 0.25 : 1
      for (const point of series_data.filtered_data) {
        if (!canvas_safe(point)) return null
        if (needs_static_svg_overlay(point, selected)) continue
        const [cx, cy] = project.point(point)
        markers.push(marker_of(point, cx, cy, opacity))
      }
    }
    return markers
  })
  const use_canvas_markers = $derived(canvas_markers !== null)
  // In canvas mode only labelled/selected/highlighted points get SVG nodes. Derived apart
  // from the hover below so a pointer move doesn't rescan every point.
  const static_overlay_points_by_series = $derived.by(() => {
    if (!use_canvas_markers) return []
    const selected = selected_point
    return filtered_series.map((series_data) =>
      series_data.filtered_data.filter((point) => needs_static_svg_overlay(point, selected)),
    )
  })
  // Plus the hovered point, for its hover effects. tooltip_point may come from a previous
  // filtered derivation, so it is matched by logical key rather than identity.
  const svg_overlay_points_by_series = $derived.by(() => {
    const hovered_pt = tooltip_point
    return static_overlay_points_by_series.map((points, series_pos) => {
      if (
        hovered_pt == null ||
        hovered_pt.point_label?.text != null ||
        hovered_pt.series_idx !== filtered_series[series_pos].orig_series_idx ||
        points.some((point) => same_logical_point(point, hovered_pt))
      ) {
        return points
      }
      return [...points, hovered_pt]
    })
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
    if (ctx) draw_markers(ctx, canvas_markers ?? [], { width, height, pixel_ratio })
  })

  const fill_hover_key = (
    source_type: FillSource,
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
  type FillSource = `fill_region` | `error_band`
  type ComputedFill = FillRegion & {
    idx: number
    source_type: FillSource
    source_idx: number
    hover_key: string
    path_segments: string[]
  }
  type TaggedRegion = Pick<ComputedFill, `source_type` | `source_idx` | `hover_key`> & {
    region: FillRegion | null
  }
  const tag_regions = <Item extends { id?: string | number }>(
    items: readonly Item[],
    source_type: FillSource,
    to_region: (item: Item) => FillRegion | null,
  ): TaggedRegion[] =>
    items.map((item, source_idx) => ({
      region: to_region(item),
      source_type,
      source_idx,
      hover_key: fill_hover_key(
        source_type,
        source_idx,
        item.id,
        has_duplicate_id(items, source_idx, item.id),
      ),
    }))
  let computed_fills = $derived.by((): ComputedFill[] => {
    if (fill_regions.length === 0 && error_bands.length === 0) return []
    const all_regions = [
      ...tag_regions(fill_regions, `fill_region`, (region) => region),
      ...tag_regions(error_bands, `error_band`, (band) =>
        convert_error_band_to_fill_region(band, series_with_ids),
      ),
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
      .filter((entry): entry is TaggedRegion & { region: FillRegion } => entry.region !== null)
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

  let legend_data = $derived(
    build_legend_data(
      series_with_ids,
      computed_fills,
      color_scale_fn,
      styles.point?.symbol_type,
    ),
  )
  // legend_track_items mirrors the rendered entries without depending on frame geometry,
  // avoiding a frame -> visibility -> computed fills -> frame dependency cycle.
  const should_show_legend = $derived(
    resolve_legend_visibility(show_legend, legend, legend_track_items.length),
  )

  // Group fills by z-index for ordered rendering (single pass instead of 4 filters)
  let fills_by_z = $derived.by(() => {
    // default bucket: no z_index or 'below-lines'
    const groups: Record<LayerZIndex, typeof computed_fills> = {
      [`below-grid`]: [],
      [`below-lines`]: [],
      [`below-points`]: [],
      [`above-all`]: [],
    }
    for (const fill of computed_fills) groups[fill.z_index ?? `below-lines`].push(fill)
    return groups
  })

  let indexed_ref_lines = $derived(index_ref_lines(ref_lines))

  // Panning retargets every marker and line on each pointer frame. Animating that leaves
  // them trailing the axes while hover hit-testing already uses the live scales, so snap
  // for the duration of the drag. Declared here because both read pan_zoom.
  const effective_point_tween = $derived(
    use_canvas_markers || pan_zoom.is_panning ? { duration: 0 } : point_tween,
  )
  const effective_line_tween = $derived(
    pan_zoom.is_panning ? { duration: 0 } : resolve_line_tween(line_tween, line_tween_load),
  )

  const hover_radius = $derived(hover_config.threshold_px ?? 20)

  // Screen-space grid over every visible marker so a pointer move probes nearby cells only.
  // Lazy: built on the first hover after a data/scale change, not per frame.
  const hover_index = $derived.by(() => {
    if (hover_config.mode === `x`) return null
    function* entries() {
      for (const series_data of filtered_series) {
        const project = series_projector(series_data)
        for (const point of series_data.filtered_data) {
          const [cx, cy] = project.point(point)
          yield { cx, cy, point }
        }
      }
    }
    return build_spatial_index(entries(), hover_radius)
  })

  // X-only hover binary-searches ordered series and scans unordered ones.
  const x_hover_series = $derived(
    filtered_series.map((series_data) => {
      let direction: -1 | 0 | 1 = 0
      const { filtered_data: points } = series_data
      for (let point_idx = 1; point_idx < points.length; point_idx++) {
        const delta = points[point_idx].x - points[point_idx - 1].x
        if (delta === 0) continue
        const next_direction = delta > 0 ? 1 : -1
        if (direction !== 0 && direction !== next_direction) {
          return { series_data, direction: 0 as const }
        }
        direction = next_direction
      }
      return { series_data, direction }
    }),
  )

  // Nearest point along x within the hover radius, plus that x distance for the click radius
  const x_hover_candidate = (x_rel: number, y_rel: number) => {
    let best_point: InternalPoint<Metadata> | null = null
    let best_x_distance = Number.POSITIVE_INFINITY
    let best_y_distance = Number.POSITIVE_INFINITY
    for (const { series_data, direction } of x_hover_series) {
      const { filtered_data: points } = series_data
      if (points.length === 0) continue
      const project = series_projector(series_data)
      const target_x = Number(project.x_scale.invert(x_rel))
      let [candidate_start, candidate_end] = [0, points.length]
      if (direction !== 0) {
        const lower_idx = partition_point(points, (point) =>
          direction > 0 ? point.x < target_x : point.x > target_x,
        )
        candidate_start = Math.max(0, lower_idx - 1)
        candidate_end = Math.min(points.length, lower_idx + 1)
        while (
          candidate_start > 0 &&
          points[candidate_start - 1].x === points[candidate_start].x
        ) {
          candidate_start--
        }
        while (
          candidate_end < points.length &&
          points[candidate_end].x === points[candidate_end - 1].x
        ) {
          candidate_end++
        }
      }
      for (let point_idx = candidate_start; point_idx < candidate_end; point_idx++) {
        const point = points[point_idx]
        const [cx, cy] = project.point(point)
        const x_distance = Math.abs(cx - x_rel)
        const y_distance = Math.abs(cy - y_rel)
        if (
          x_distance < best_x_distance ||
          (x_distance === best_x_distance && y_distance < best_y_distance)
        ) {
          best_point = point
          best_x_distance = x_distance
          best_y_distance = y_distance
        }
      }
    }
    return best_point && best_x_distance <= hover_radius
      ? { point: best_point, distance: best_x_distance }
      : null
  }

  // Nearest point within the hover radius and its screen distance (along x only in `x` mode)
  const closest_hit_at = (x_rel: number, y_rel: number) => {
    if (hover_config.mode === `x`) return x_hover_candidate(x_rel, y_rel)
    const hit = hover_index && query_nearest(hover_index, { x: x_rel, y: y_rel })
    return hit && { point: hit.point, distance: Math.hypot(hit.cx - x_rel, hit.cy - y_rel) }
  }
  // Point an on_plot_click at these coords would reach: the tooltip's candidate, but only
  // within the (usually tighter) click radius
  const plot_click_target = (hit: ReturnType<typeof closest_hit_at>) =>
    hit && hit.distance <= (hover_config.click_threshold_px ?? hover_radius) ? hit.point : null
  // Whether a click on the plot surface right now would reach on_plot_click, from the same
  // lookup handle_plot_click runs, so the pointer cursor promises exactly the clicks that land
  let plot_click_armed = $state(false)
  function update_tooltip_point(x_rel: number, y_rel: number, evt?: MouseEvent) {
    if (!width || !height) return

    const hit = closest_hit_at(x_rel, y_rel)
    const closest_point = hit?.point ?? null
    plot_click_armed = Boolean(on_plot_click && plot_click_target(hit))

    if (!closest_point) {
      tooltip_point = null
      on_point_hover?.(null)
      return
    }
    // Construct handler props synchronously to avoid stale derived reads
    const props = construct_handler_props(closest_point)
    tooltip_point = hover_config.show_tooltip === false ? null : closest_point
    if (evt && props) on_point_hover?.({ ...props, event: evt, point: closest_point })
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

  function handle_plot_click(evt: MouseEvent) {
    if (
      !on_plot_click ||
      pan_zoom.is_panning ||
      pan_zoom.drag_start ||
      pan_zoom.suppress_click
    ) {
      return
    }
    const coords = get_relative_coords(evt)
    if (!coords) return
    const point = plot_click_target(closest_hit_at(coords.x, coords.y))
    const props = point && construct_handler_props(point)
    if (point && props) on_plot_click({ ...props, event: evt, point })
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
  // The merged object (and an inline `label_placement_config={{...}}` prop) is a fresh
  // identity per update, so the warm start below compares by value, not reference.
  const label_config_key = $derived(JSON.stringify(actual_label_config))

  // The solver below scans every point and reruns per pan/zoom frame (it reads the scales),
  // so skip it entirely on plots with no auto-placed labels. Scans `series_with_ids` rather
  // than `filtered_series` on purpose: the latter is refiltered from the ranges, which would
  // put this scan back on every frame. Counting labels outside the visible range only means
  // the solver runs and filters them out itself.
  // series and label entries can both be null: series_with_ids passes non-objects through
  const is_auto_placed = (label: LabelStyle | null | undefined) =>
    Boolean(label?.auto_placement && label.text)
  let has_auto_placed_labels = $derived(
    series_with_ids.some((series_data) => {
      const label = series_data?.point_label
      return Array.isArray(label) ? label.some(is_auto_placed) : is_auto_placed(label)
    }),
  )

  // Solver-placed labels carry their offset from the marker; an auto-placed label the solver
  // dropped (max_neighbors budget) renders nothing
  const resolve_point_label = (point: InternalPoint<Metadata>, cx: number, cy: number) => {
    const placed = label_positions[`${point.series_idx}-${point.point_idx}`]
    const label = point.point_label ?? {}
    const style =
      label.auto_placement && actual_label_config.max_neighbors && !placed ? {} : label
    return placed ? { ...style, offset: { x: placed.x - cx, y: placed.y - cy } } : style
  }

  // Last solve's label offsets, handed back so each pan/zoom frame polishes the previous
  // layout instead of re-solving from scratch. A plain Map, not SvelteMap: the effect below
  // both reads and writes it, and tracking that would re-trigger the effect forever.
  const label_offsets = new Map<string, Point2D>()
  let previous_label_series: typeof series_with_ids | undefined
  let previous_label_config: string | undefined

  $effect(() => {
    const label_series = series_with_ids
    const label_config = actual_label_config
    const config_key = label_config_key
    if (label_series !== previous_label_series || config_key !== previous_label_config) {
      label_offsets.clear()
      previous_label_series = label_series
      previous_label_config = config_key
    }
    if (!width || !height || !has_auto_placed_labels) {
      label_positions = {}
      label_offsets.clear()
      return
    }

    label_positions = compute_label_positions(
      filtered_series,
      label_config,
      frame.scales,
      { width, height, pad },
      label_offsets,
    )
  })

  function construct_handler_props(
    point: InternalPoint<Metadata>,
  ): ScatterHandlerProps<Metadata> | null {
    const hovered_series = series_with_ids[point.series_idx]
    if (!hovered_series) return null
    const { x, y, color_value, metadata, series_idx } = point
    const [cx, cy] = series_projector(hovered_series).point(point)
    const active_x_config = hovered_series.x_axis === `x2` ? final_x2_axis : final_x_axis
    const active_y_config = hovered_series.y_axis === `y2` ? final_y2_axis : final_y_axis
    return {
      x,
      y,
      cx,
      cy,
      x_axis: active_x_config,
      x2_axis: final_x2_axis,
      y_axis: active_y_config,
      y2_axis: final_y2_axis,
      fullscreen,
      metadata,
      label: hovered_series.label ?? null,
      series_idx,
      x_formatted: format_value_or_num(x, active_x_config.format),
      y_formatted: format_value_or_num(y, active_y_config.format),
      raw_y: hovered_series.raw_y?.[point.point_idx],
      color_value: color_value ?? null,
      color_bar: {
        value: color_value ?? null,
        title: color_bar?.title ?? null,
        scale: color_scale,
        tick_format: color_bar?.tick_format ?? null,
      },
    }
  }

  function point_accessible_label(point: InternalPoint<Metadata>): string {
    const metadata_label = point.metadata?.[`aria_label`]
    if (typeof metadata_label === `string`) return metadata_label
    const series_label = series_with_ids[point.series_idx]?.label
    return `Select ${series_label ?? `series ${point.series_idx + 1}`} point ${point.point_idx + 1}`
  }

  function activate_point(point: InternalPoint<Metadata>, event: MouseEvent): void {
    event.stopPropagation()
    point_events?.onclick?.({ point, event })
    const props = construct_handler_props(point)
    tooltip_point = point
    if (props) on_point_click?.({ ...props, event, point })
  }

  let handler_props = $derived(tooltip_point ? construct_handler_props(tooltip_point) : null)

  let has_multiple_series = $derived(series_with_ids.filter(Boolean).length > 1)

  // Precompute non-click event names from point_events so we don't rebuild
  // the entries array on every point render.
  let point_event_names = $derived(
    point_events
      ? Object.keys(point_events).filter((name) => name !== `onclick` && name !== `onkeydown`)
      : [],
  )
  let points_interactive = $derived(Boolean(on_point_click || point_events?.onclick))

  // Set, not a scan per point: a rect drag can select thousands, and the membership test
  // runs once per rendered marker on every frame
  let selected_keys = $derived(
    new Set(selected_points.map((sel) => roving_key(sel.series_idx, sel.point_idx))),
  )

  // One path per series, not per point: a dense scatter with errors would otherwise
  // remount thousands of DOM nodes and undo the canvas marker threshold entirely. That
  // costs per-point coloring, so bars take the series' own color - which reads better
  // anyway, since a hairball of individually tinted bars is noise rather than signal.
  let error_bar_paths = $derived.by(() =>
    filtered_series.flatMap((series_data, series_pos) => {
      if (series_data.x_error == null && series_data.y_error == null) return []
      const project = series_projector(series_data)
      const { marker_of } = series_appearance(series_data)
      const cap = error_bar_cap
      const segments: string[] = []
      // A capped bar is the same three strokes on either axis, with the roles of the two
      // coordinates swapped, so the shape is written once and read along each axis
      const bar = (along: Vec2, across: number, vertical: boolean) => {
        const [lo, hi] = along
        const [near, far] = [across - cap, across + cap]
        return vertical
          ? `M${near},${lo}H${far}M${across},${lo}V${hi}M${near},${hi}H${far}`
          : `M${lo},${near}V${far}M${lo},${across}H${hi}M${hi},${near}V${far}`
      }
      for (const point of series_data.filtered_data) {
        const [cx, cy] = project.point(point)
        const x_span = project.error_span(point, `x`)
        if (x_span) segments.push(bar(x_span, cy, false))
        const y_span = project.error_span(point, `y`)
        if (y_span) segments.push(bar(y_span, cx, true))
      }
      if (segments.length === 0) return []
      const first = series_data.filtered_data[0]
      return [
        {
          series_pos,
          d: segments.join(``),
          stroke: first ? marker_of(first).fill : undefined,
        },
      ]
    }),
  )

  // === Canvas-mode keyboard cursor ===
  // Past CANVAS_MARKER_THRESHOLD the points stop being SVG nodes, taking their
  // tabindex, role and aria-label with them - the chart silently degrades from
  // navigable to a picture. Arrow keys therefore drive a cursor through the data
  // itself; the point it lands on becomes the hovered one, which the SVG overlay
  // draws back on top of the canvas (so it is focusable and shows a tooltip again).
  let kbd_cursor = $state<number | null>(null)

  // Per-series point lists plus the offsets that flatten them into one index space.
  // Only the offsets are materialised - flattening 100k points on every keystroke
  // would cost more than the whole canvas render it exists to compensate for.
  let kbd_nav = $derived.by(() => {
    const lists = filtered_series.map((series_data) => series_data.filtered_data ?? [])
    const offsets: number[] = []
    let total = 0
    for (const list of lists) {
      offsets.push(total)
      total += list.length
    }
    return { lists, offsets, total }
  })

  // Offsets ascend, so the first series whose run ends past the index owns it
  const kbd_point = (global_idx: number): InternalPoint<Metadata> | null => {
    const { lists, offsets } = kbd_nav
    for (const [series_pos, list] of lists.entries()) {
      const start = offsets[series_pos]
      if (global_idx < start + list.length) return list[global_idx - start] ?? null
    }
    return null
  }

  function move_kbd_cursor(event: KeyboardEvent): boolean {
    const { total } = kbd_nav
    if (total === 0) return false
    const forward = event.key === `ArrowRight` || event.key === `ArrowDown`
    const backward = event.key === `ArrowLeft` || event.key === `ArrowUp`
    let next: number
    if (event.key === `Home`) next = 0
    else if (event.key === `End`) next = total - 1
    else if (forward || backward) {
      const step = forward ? 1 : -1
      next =
        kbd_cursor == null ? (forward ? 0 : total - 1) : (kbd_cursor + step + total) % total
    } else return false
    event.preventDefault()
    kbd_cursor = next
    const point = kbd_point(next)
    if (!point) return true
    hovered = true
    tooltip_point = point
    return true
  }

  // Runs before pan/zoom's own key handling, which claims Enter/Space for reset
  function handle_plot_key_down(event: KeyboardEvent): boolean {
    if (!use_canvas_markers || event.metaKey || event.ctrlKey || event.altKey) return false
    if (event.key === `Escape` && kbd_cursor != null) {
      kbd_cursor = null
      tooltip_point = null
      hovered = false
      return true
    }
    const cursor_point = kbd_cursor == null ? null : kbd_point(kbd_cursor)
    if (cursor_point && points_interactive && is_activation_key(event)) {
      event.preventDefault()
      activate_point(cursor_point, new MouseEvent(`click`))
      return true
    }
    return move_kbd_cursor(event)
  }

  // Reads the cursor's own point, not the hovered one: `tooltip_point` also tracks the
  // mouse, so announcing that would re-announce every point the pointer swept over once
  // the cursor had been used at all.
  let live_message = $derived.by(() => {
    const point = kbd_cursor == null ? null : kbd_point(kbd_cursor)
    return point ? point_accessible_label(point) : ``
  })

  // One tab stop for the whole point cloud instead of one per point: a 10k-point
  // scatter would otherwise take 10k presses to tab past. Arrow keys walk the marks.
  const roving = create_roving_focus({
    container: () => frame.svg_element,
    marks: () => [
      filtered_series,
      use_canvas_markers,
      svg_overlay_points_by_series,
      frame.ranges.current,
    ],
  })

  const axis_state: AxisChangeState<DataSeries<Metadata>> = {
    axes: {
      x: { get: () => x_axis, set: (config) => (x_axis = config) },
      x2: { get: () => x2_axis, set: (config) => (x2_axis = config) },
      y: { get: () => y_axis, set: (config) => (y_axis = config) },
      y2: { get: () => y2_axis, set: (config) => (y2_axis = config) },
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
  const csv_series = () =>
    filtered_series.map((series_data, series_idx) => ({
      label: series_data.label ?? `series ${series_idx + 1}`,
      x: series_data.filtered_data?.map((point) => point.x) ?? [],
      y: series_data.filtered_data?.map((point) => point.y) ?? [],
      extras: {
        color_value: series_data.filtered_data?.map((point) => point.color_value ?? null),
        size_value: series_data.filtered_data?.map((point) => point.size_value ?? null),
        ...(series_data.x_error != null && {
          x_error_lower: series_data.filtered_data?.map((pt) => pt.x_error?.[0] ?? null),
          x_error_upper: series_data.filtered_data?.map((pt) => pt.x_error?.[1] ?? null),
        }),
        ...(series_data.y_error != null && {
          y_error_lower: series_data.filtered_data?.map((pt) => pt.y_error?.[0] ?? null),
          y_error_upper: series_data.filtered_data?.map((pt) => pt.y_error?.[1] ?? null),
        }),
      },
    }))
  const handle_export = create_chart_exporter(frame, () => series_to_csv_rows(csv_series()))
</script>

{#snippet fill_regions_layer(fills: typeof computed_fills)}
  {#each fills as fill (fill.hover_key)}
    {#each fill.path_segments as path_d, segment_idx (`${fill.id ?? fill.idx}-${segment_idx}`)}
      <FillArea
        region={fill}
        region_idx={fill.idx}
        is_first_segment={segment_idx === 0}
        defs_id="{clip_path_id}-fill-{fill.idx}"
        path={path_d}
        {clip_path_id}
        {x_scale_fn}
        {y_scale_fn}
        tween_options={effective_line_tween}
        is_hovered={hovered_fill_key === fill.hover_key}
        on_click={on_fill_click}
        on_hover={(event: FillHandlerEvent | null) => {
          hovered_fill_key = event ? fill.hover_key : null
          on_fill_hover?.(event)
        }}
      />
    {/each}
  {/each}
{/snippet}

{#snippet ref_lines_layer(z: LayerZIndex)}
  <ReferenceLinesLayer {frame} {z} on_click={on_ref_line_click} on_hover={on_ref_line_hover} />
{/snippet}

<CartesianFrame
  {frame}
  plot_class="scatter"
  css_prefix="scatter"
  css_var_fallbacks={{ 'min-height': `350px` }}
  aria_label="Scatter plot"
  bind:fullscreen
  bind:wrapper
  {fullscreen_toggle}
  marginals={resolved_marginals}
  {marginal_series}
  on_mouse_enter={() => (hovered = true)}
  idle_cursor={plot_click_armed ? `pointer` : `crosshair`}
  on_mouse_move={hover_config.show_tooltip !== false || on_point_hover || on_plot_click
    ? (evt) => {
        // Only find the closest point when not actively dragging
        if (!pan_zoom.drag_start && !pan_zoom.is_panning) queue_mouse_move(evt)
      }
    : undefined}
  on_mouse_click={handle_plot_click}
  on_key_down={handle_plot_key_down}
  {live_message}
  on_mouse_leave={() => {
    end_queued_mouse_move(false)
    hovered = false
    plot_click_armed = false
    tooltip_point = null
    on_point_hover?.(null)
  }}
  {header_controls}
  {user_content}
  {children}
  {...rest}
>
  {#snippet layers()}
    {@render fill_regions_layer(fills_by_z[`below-grid`])}
    {@render ref_lines_layer(`below-grid`)}

    <!-- No axis spines; the unit rides on the first y tick label -->
    <PlotAxes
      {frame}
      display={final_display}
      show_baseline={false}
      unit_on_first_tick
      {axis_loading}
      on_axis_change={handle_axis_change}
    />

    {#if current_x_value != null}
      {@const current_pos = x_scale_fn(current_x_value)}
      {#if isFinite(current_pos) && current_pos >= pad.l && current_pos <= width - pad.r}
        {@const active_tick_height = 7}
        <line
          class="current-frame-guide"
          x1={current_pos}
          x2={current_pos}
          y1={pad.t}
          y2={height - pad.b}
          stroke="var(--scatter-current-frame-color, #ff6b35)"
          stroke-opacity="0.45"
          stroke-dasharray="8 4"
          pointer-events="none"
        />
        <rect
          class="current-frame-indicator"
          x={current_pos - 1.5}
          y={height - pad.b - active_tick_height / 2}
          width="3"
          height={active_tick_height}
          fill="var(--scatter-current-frame-color, #ff6b35)"
          stroke="white"
          stroke-width="1"
        />
      {/if}
    {/if}

    <ZeroLines {frame} display={final_display} />

    {@render fill_regions_layer(fills_by_z[`below-lines`])}
    {@render ref_lines_layer(`below-lines`)}

    {#if styles.show_lines}
      {#each filtered_series as series_data (series_data._id)}
        {#if (series_data.markers ?? DEFAULT_MARKERS).includes(`line`)}
          {@const project = series_projector(series_data)}
          {@const series_default_color = plot_color(series_data.orig_series_idx ?? 0)}
          {@const apply_line_controls = applies_style_controls(series_data)}
          {@const ls = series_data.line_style}
          {@const tc = (key: string) => apply_line_controls && touched.has(key)}
          {@const color_fallback =
            ls?.stroke ??
            first_point_style(series_data)?.fill ??
            (series_data.color_values?.[0] != null
              ? color_scale_fn(series_data.color_values[0])
              : series_default_color)}
          <g
            data-series-id={series_data._id}
            clip-path="url(#{clip_path_id})"
            opacity={is_legend_dimmed(series_data.orig_series_idx) ? 0.25 : 1}
          >
            {#each series_data.line_underlays ?? [] as underlay}
              <Line
                points={project.line(underlay)}
                line_color={underlay.line_style?.stroke ?? series_default_color}
                line_width={underlay.line_style?.stroke_width ?? 1}
                line_dash={underlay.line_style?.line_dash}
                curve={underlay.line_style?.curve}
                area_color="transparent"
                line_tween={effective_line_tween}
              />
            {/each}
            <Line
              points={project.line(series_data)}
              line_color={(tc(`line.color`) ? styles.line?.color : null) ?? color_fallback}
              line_width={(tc(`line.width`) ? styles.line?.width : null) ??
                ls?.stroke_width ??
                2}
              line_dash={(tc(`line.dash`) ? styles.line?.dash : null) ?? ls?.line_dash}
              stroke-opacity={tc(`line.opacity`) ? styles.line?.opacity : undefined}
              curve={ls?.curve}
              area_color="transparent"
              line_tween={effective_line_tween}
            />
          </g>
        {/if}
      {/each}
    {/if}

    <!-- Error bars sit under the markers so a cap never hides the point it belongs to -->
    {#each error_bar_paths as { series_pos, d, stroke } (series_pos)}
      <path
        class="error-bars"
        clip-path="url(#{frame.clip_path_id})"
        opacity={is_legend_dimmed(filtered_series[series_pos]?.orig_series_idx) ? 0.25 : 1}
        {d}
        {stroke}
      />
    {/each}

    {@render fill_regions_layer(fills_by_z[`below-points`])}
    {@render ref_lines_layer(`below-points`)}

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

    <!-- Canvas mode retains only labelled/hovered/selected points here. Point centers are
         range-filtered, but marker geometry may extend beyond the plot edge: keep complete
         icons visible, only lines and area geometry are clipped. -->
    {#if styles.show_points}
      {#each filtered_series as series_data, series_pos (series_data._id)}
        {#if (series_data.markers ?? DEFAULT_MARKERS).includes(`points`)}
          {@const rendered_points = use_canvas_markers
            ? (svg_overlay_points_by_series[series_pos] ?? [])
            : series_data.filtered_data}
          {@const { marker_of } = series_appearance(series_data)}
          {@const project = series_projector(series_data)}
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <g
            data-series-id={series_data._id}
            role="group"
            onfocusin={roving.focusin}
            onkeydown={roving.handle_keydown}
          >
            {#each rendered_points as point (`${point.series_idx}-${point.point_idx}`)}
              {@const [cx, cy] = project.point(point)}
              {@const offset = point.point_offset ?? ZERO_OFFSET}
              {@const appearance = marker_of(point)}
              <ScatterPoint
                x={cx - offset.x}
                y={cy - offset.y}
                is_dimmed={is_legend_dimmed(point.series_idx)}
                is_hovered={same_logical_point(point, tooltip_point)}
                is_selected={same_logical_point(point, selected_point) ||
                  selected_keys.has(roving_key(point.series_idx, point.point_idx))}
                leader_line_threshold={actual_label_config.leader_line_threshold}
                overlay_only={use_canvas_markers &&
                  !needs_static_svg_overlay(point, selected_point)}
                style={{
                  symbol_type: appearance.symbol_type,
                  ...point.point_style,
                  radius: appearance.radius,
                  stroke_width: appearance.stroke_width,
                  stroke: appearance.stroke,
                  stroke_opacity: appearance.stroke_opacity,
                  fill_opacity: appearance.fill_opacity,
                  cursor: points_interactive ? `pointer` : undefined,
                }}
                hover={point.point_hover ?? {}}
                label={resolve_point_label(point, cx, cy)}
                {offset}
                point_tween={effective_point_tween}
                hit_padding={points_interactive ? point_hit_padding : 0}
                role={points_interactive ? `button` : undefined}
                tabindex={points_interactive
                  ? roving.tabindex(roving_key(point.series_idx, point.point_idx))
                  : undefined}
                {...points_interactive
                  ? { [ROVING_ATTR]: roving_key(point.series_idx, point.point_idx) }
                  : {}}
                aria-label={points_interactive ? point_accessible_label(point) : undefined}
                --point-fill-color={appearance.fill}
                {...point_events &&
                  Object.fromEntries(
                    point_event_names.map((name) => [
                      name,
                      (event: Event) => point_events?.[name]?.({ point, event }),
                    ]),
                  )}
                onkeydown={(event: KeyboardEvent) => {
                  point_events?.onkeydown?.({ point, event })
                  if (!points_interactive || !is_activation_key(event)) return
                  event.preventDefault()
                  event.currentTarget?.dispatchEvent(
                    new MouseEvent(`click`, { bubbles: true }),
                  )
                }}
                onclick={(event: MouseEvent) => activate_point(point, event)}
              />
            {/each}
          </g>
        {/if}
      {/each}
    {/if}

    {@render fill_regions_layer(fills_by_z[`above-all`])}
    {@render ref_lines_layer(`above-all`)}
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
      <!-- avoid_cursor off: the anchor is the projected point, not the pointer -->
      <PlotTooltip
        x={handler_props.cx}
        y={handler_props.cy}
        avoid_cursor={false}
        offset={{ x: 10, y: 5 }}
        constrain_to={{ width, height }}
        fallback_size={{ width: 120, height: 50 }}
        exclusion_rects={frame.exclusion_rects}
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

    {#if show_controls}
      <ScatterPlotControls
        on_export={handle_export}
        toggle_props={controls_toggle_props}
        pane_props={controls_pane_props}
        bind:show_controls
        bind:controls_open
        bind:x_axis
        bind:x2_axis
        bind:y_axis
        bind:y2_axis
        bind:display
        bind:styles
        auto_x_range={intrinsic_ranges.x}
        auto_x2_range={intrinsic_ranges.x2}
        auto_y_range={intrinsic_ranges.y}
        auto_y2_range={intrinsic_ranges.y2}
        bind:selected_series_idx
        series={series_with_ids}
        {has_x2_points}
        {has_y2_points}
        children={controls_extra}
        on_touch={(key, is_touched) => (is_touched ? touched.add(key) : touched.delete(key))}
      />
    {/if}

    {#if width > 0 && height > 0 && color_bar && has_color_values}
      {@const color_domain = [
        color_scale_config.value_range?.[0] ?? auto_color_range[0],
        color_scale_config.value_range?.[1] ?? auto_color_range[1],
      ] as Vec2}
      <ColorBarDecoration
        decoration={colorbar}
        wrapper_style={color_bar.wrapper_style}
        color_bar={{
          tick_labels: 4,
          tick_side: `primary`,
          scale: { fn: color_scale_fn, domain: color_domain },
          scale_type: color_scale_config.type,
          range: color_domain,
          bar_style: `width: ${COLOR_BAR_DEFAULTS.width}px; height: ${COLOR_BAR_DEFAULTS.horizontal_bar_height}px; ${color_bar.style ?? ``}`,
          ...color_bar,
          wrapper_style: color_bar.wrapper_style ? `height: 100%; width: 100%;` : ``,
        }}
      />
    {/if}

    <PlotLegendLayer
      {frame}
      {legend}
      series_data={legend_data}
      active_series_idx={tooltip_point?.series_idx ?? frame.hovered_series_idx}
      active_fill_idx={computed_fills.find((fill) => fill.hover_key === hovered_fill_key)
        ?.idx ?? null}
      on_toggle={legend_vis.on_toggle}
      on_double_click={legend_vis.on_double_click}
      on_group_toggle={legend_vis.on_group_toggle}
      on_item_hover={(item) => {
        // highlight the matching fill in the plot (same state plot fill-hover uses), but skip
        // hidden fills since they render nothing and would mark the legend item active for naught
        const fill =
          item?.item_type === `fill`
            ? computed_fills.find((entry) => entry.idx === item.fill_idx)
            : undefined
        hovered_fill_key = fill && fill.visible !== false ? fill.hover_key : null
      }}
      on_fill_toggle={(source_type: FillSource, source_idx: number) => {
        // Only fill_regions can be toggled (error_bands are not bindable)
        if (source_type !== `fill_region`) return
        fill_regions = fill_regions.map((region, idx) =>
          idx === source_idx ? { ...region, visible: region.visible === false } : region,
        )
      }}
      on_fill_double_click={(source_type: FillSource, source_idx: number) => {
        if (source_type !== `fill_region`) return
        // Isolate this fill, or show all when it is already the only visible one
        const visible = fill_regions.filter((region) => region.visible !== false)
        const show_all = visible.length === 1 && fill_regions[source_idx]?.visible !== false
        fill_regions = fill_regions.map((region, idx) => ({
          ...region,
          visible: show_all || idx === source_idx,
        }))
      }}
    />
  {/snippet}
</CartesianFrame>

<style>
  path.error-bars {
    fill: none;
    stroke-width: var(--scatter-error-bar-width, 1);
    stroke-opacity: var(--scatter-error-bar-opacity, 0.7);
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
