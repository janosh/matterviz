<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>, PointData extends Record<string, unknown> = Record<string, unknown>"
>
  // Dense scatter for 10^5-10^6 points: a canvas density heatmap that switches to individual
  // canvas markers once the visible count is small enough, with spatial-index picking,
  // solver-placed colorbar/annotation and optional point labels. Axes, ranges, padding,
  // pan/zoom, marginals and the title come from the shared Cartesian frame.
  import { format_value } from '$lib/labels'
  import type { Point2D, Vec2 } from '$lib/math'
  import { create_pulse_animation } from '$lib/effects.svelte'
  import type ColorBar from '$lib/plot/core/components/ColorBar.svelte'
  import ColorBarDecoration from '$lib/plot/core/components/ColorBarDecoration.svelte'
  import PlotAxes from '$lib/plot/core/components/PlotAxes.svelte'
  import PlotTooltip from '$lib/plot/core/components/PlotTooltip.svelte'
  import CartesianFrame from '$lib/plot/core/components/CartesianFrame.svelte'
  import ReferenceLinesLayer from '$lib/plot/core/components/ReferenceLinesLayer.svelte'
  import { create_cartesian_frame } from '$lib/plot/core/cartesian-frame.svelte'
  import { create_colorbar_decoration } from '$lib/plot/core/colorbar-decoration.svelte'
  import type { DecorationItem } from '$lib/plot/core/decorations'
  import { decoration_data_attrs, get_decoration_placement } from '$lib/plot/core/decorations'
  import type { FacetLayoutContext } from '$lib/plot/core/facets'
  import { get_relative_coords, range_bounds } from '$lib/plot/core/interactions'
  import { query_nearest } from '$lib/plot/core/spatial-index'
  import { create_placed_tween } from '$lib/plot/core/placed-tween.svelte'
  import { element_position_for_footprint, full_footprint_or } from '$lib/plot/core/layout'
  import { plot_color } from '$lib/colors'
  import type { MarginalSeriesInput, MarginalsProp } from '$lib/plot/core/marginals'
  import {
    add_sides,
    normalize_marginals,
    reserve_marginal_pad,
  } from '$lib/plot/core/marginals'
  import {
    build_pick_index,
    bin_points,
    density_bin_at_point,
    density_screen_cell,
    first_point_in_bin,
    scale_bin_transform,
    series_extents,
    should_render_points,
    visible_points,
  } from '$lib/plot/scatter/adaptive-density'
  import type {
    DensityBin,
    DenseInternalPoint,
    DensePointSeries,
  } from '$lib/plot/scatter/adaptive-density'
  import {
    collect_size_values,
    create_color_scale,
    create_size_scale,
  } from '$lib/plot/core/scales'
  import type {
    AxisConfig,
    BasePlotProps,
    DataSeries,
    InternalPoint,
    PanConfig,
    ScatterHandlerProps,
  } from '$lib/plot/core/types'
  import { COLOR_BAR_DEFAULTS, SCALE_DEFAULTS } from '$lib/plot/core/types'
  import { index_ref_lines } from '$lib/plot/core/reference-line'
  import {
    compute_label_positions,
    estimate_label_size,
    label_leader_segment,
  } from '$lib/plot/core/utils/label-placement'
  import type { LabelSize } from '$lib/plot/core/utils/label-placement'
  import type { ComponentProps, Snippet } from 'svelte'
  import { tick } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import type {
    BinnedDensityConfig,
    BinnedOverlaysConfig,
    BinnedPointDataFn,
    BinnedPointLabelsConfig,
    BinnedPointPayload,
    BinnedSizeScaleConfig,
  } from '$lib/plot/scatter/binned-scatter-types'
  import { DEFAULT_BINNED_SIZE_SCALE } from '$lib/plot/scatter/binned-scatter-types'

  type RenderMode = `density` | `points`
  type DensePointEvent = {
    point: DenseInternalPoint<Metadata>
    event: MouseEvent
    color?: string
    point_data?: PointData
  }
  type OverlayContext = { height: number; width: number; fullscreen: boolean }
  const default_density_auto_point_mode = { max_points: 25_000, max_points_per_px: 0.12 }
  const max_placement_bins = 500
  const unit_range: Vec2 = [0, 1]
  const empty_axis: AxisConfig = {}

  let {
    series,
    x_axis = $bindable({}),
    y_axis = $bindable({}),
    size_scale = DEFAULT_BINNED_SIZE_SCALE,
    color_bar = {},
    density: density_config = {},
    overlays: overlays_config = {},
    padding = {},
    range_padding = 0.05,
    title,
    tooltip,
    point_data,
    point_labels = {},
    selected_point_id = null,
    on_point_click,
    on_density_zoom,
    render_mode = $bindable<RenderMode>(`density`),
    wrapper = $bindable(),
    hovered = $bindable(false),
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    pan = {},
    children,
    header_controls,
    annotation,
    marginals = false,
    facet_layout,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `children` | `title`> &
    // `range_padding` defaults to 0.05 (the historical density-bin framing pad) rather than
    // ScatterPlot's 0. No controls pane; hover is reported via on_point_click / the tooltip.
    Pick<
      BasePlotProps,
      `padding` | `range_padding` | `title` | `hovered` | `fullscreen` | `fullscreen_toggle`
    > & {
      series: DensePointSeries<Metadata>[]
      x_axis?: AxisConfig
      y_axis?: AxisConfig
      size_scale?: BinnedSizeScaleConfig
      color_bar?: ComponentProps<typeof ColorBar> | null
      density?: BinnedDensityConfig
      overlays?: BinnedOverlaysConfig
      tooltip?: Snippet<[BinnedPointPayload<Metadata, PointData>]>
      point_data?: BinnedPointDataFn<Metadata, PointData>
      point_labels?: BinnedPointLabelsConfig<Metadata, PointData>
      selected_point_id?: string | number | null
      on_point_click?: (payload: ScatterHandlerProps<Metadata> & DensePointEvent) => void
      on_density_zoom?: (payload: { bin: DensityBin; event: MouseEvent }) => void
      render_mode?: RenderMode
      wrapper?: HTMLDivElement
      pan?: PanConfig
      children?: Snippet<[OverlayContext]>
      header_controls?: Snippet<[OverlayContext]>
      // auto-placed badge (e.g. MAE/R² stats): rendered inside the plot area wherever it
      // overlaps the least data, while also avoiding the auto-placed colorbar
      annotation?: Snippet<[OverlayContext]>
      marginals?: MarginalsProp
      facet_layout?: FacetLayoutContext
    } = $props()

  let hovered_bin = $state<DensityBin | null>(null)
  let hovered_point = $state<DenseInternalPoint<Metadata> | null>(null)
  let tooltip_pos = $state<Point2D>({ x: 0, y: 0 })
  let annotation_element = $state<HTMLDivElement>()
  let annotation_size_revision = $state(0)
  let label_measure_root = $state<HTMLDivElement>()
  let label_sizes = new SvelteMap<string, LabelSize>()

  const grid_display = { x_grid: true, y_grid: true }
  const x_scale_type = $derived(x_axis.scale_type ?? `linear`)
  const y_scale_type = $derived(y_axis.scale_type ?? `linear`)
  const resolved_marginals = $derived(
    normalize_marginals(marginals, { top: true, right: true }),
  )
  const marginal_series = $derived<MarginalSeriesInput[]>(
    series.map((srs, idx) => ({
      x: srs.x,
      y: srs.y,
      color: srs.color ?? plot_color(idx),
      label: srs.label,
      visible: true,
    })),
  )
  const density_settings = $derived({
    bin_px: density_config.bin_px ?? 2.8,
    color_scale: density_config.color_scale ?? SCALE_DEFAULTS.color,
    auto_point_mode: density_config.auto_point_mode ?? default_density_auto_point_mode,
    bin_click: density_config.bin_click ?? `zoom`,
  })
  const indexed_ref_lines = $derived(index_ref_lines(overlays_config.ref_lines))
  const point_labels_settings = $derived({
    font_size: point_labels.font_size ?? `11px`,
    max_count: point_labels.max_count ?? 50,
    gap_px: point_labels.gap_px ?? 3,
    placement: point_labels.placement ?? {},
    leaders: { min_length_px: point_labels.leaders?.min_length_px ?? 6 },
    render: point_labels.render,
    measure_text: point_labels.measure_text,
  })

  // Only scan the data for extents when an axis range bound is left to auto. Explicit
  // bounds are merged in per bound so a facet grid receives the pinned range as this panel's
  // intrinsic range (never the [0, 1] no-scan sentinel) and the facet padding pass measures
  // the ticks that actually render.
  const needs_data_range = (range: AxisConfig[`range`]): boolean =>
    range?.[0] == null || range?.[1] == null
  const pin_range = (axis: AxisConfig, fallback: Vec2): Vec2 => [
    axis.range?.[0] ?? fallback[0],
    axis.range?.[1] ?? fallback[1],
  ]
  const auto_ranges = $derived.by(() => {
    const data_ranges =
      needs_data_range(x_axis.range) || needs_data_range(y_axis.range)
        ? series_extents(series, x_scale_type, y_scale_type, range_padding)
        : { x: unit_range, y: unit_range }
    return { x: pin_range(x_axis, data_ranges.x), y: pin_range(y_axis, data_ranges.y) }
  })

  const frame = create_cartesian_frame({
    // No default tick format: format_tick_values short-circuits its whole duplicate-avoidance
    // escalation the moment a formatter is supplied, so a hardcoded `.2~g` here labelled six
    // ticks over [1000, 1010] as `1e+3` six times, and six `1`s after a density bin_click zoom.
    // ScatterPlot supplies none either; a caller wanting a fixed format still passes one in.
    axes: () => ({ x: x_axis, x2: empty_axis, y: y_axis, y2: empty_axis }),
    auto_ranges: () => ({
      x: auto_ranges.x,
      x2: unit_range,
      y: auto_ranges.y,
      y2: unit_range,
    }),
    has_x2: () => false,
    has_y2: () => false,
    padding: () => padding,
    title: () => title,
    obstacles: () => bin_obstacles_norm,
    legend: () => null,
    legend_visible: () => false,
    legend_items: () => [],
    decorations: () => decoration_items,
    marginals: () => resolved_marginals,
    ref_lines: () => indexed_ref_lines,
    pan: () => pan,
    facet_layout: () => facet_layout,
    tick_counts: { x: 7, y: 5 },
    clip_id_prefix: `binned-scatter-plot-area`,
  })
  const width = $derived(frame.width)
  const height = $derived(frame.height)
  const pad = $derived(frame.pad)
  const { facet, pan_zoom } = frame
  const x_scale_fn = $derived(frame.scales.x)
  const y_scale_fn = $derived(frame.scales.y)
  const x_range = $derived(frame.ranges.current.x)
  const y_range = $derived(frame.ranges.current.y)
  const has_plot_size = $derived(width > 0 && height > 0)
  const plot_rect = $derived({
    x: pad.l,
    y: pad.t,
    width: frame.chart_width,
    height: frame.chart_height,
  })

  // Density bins depend only on the decoration-independent base padding (plus the fixed
  // marginal strips, so bins stay `bin_px` wide): their occupied cells are the obstacle field
  // the decoration solver routes around, so deriving them from the solved pad would feed
  // each reservation back into the next solve.
  const density_bin_count = (total: number, start: number, end: number): number =>
    Math.max(8, Math.ceil(Math.max(1, total - start - end) / density_settings.bin_px))
  const density_bins = $derived.by(() => {
    const base = add_sides(frame.effective_base_pad, reserve_marginal_pad(resolved_marginals))
    return {
      x: density_bin_count(width, base.l, base.r),
      y: density_bin_count(height, base.t, base.b),
    }
  })
  // Bin in scale space so the heatmap, hover, and zoom stay aligned with log/arcsinh axes
  const bin_transforms = $derived({
    x: scale_bin_transform(x_scale_type),
    y: scale_bin_transform(y_scale_type),
  })
  // Bin only once the container is measured, so a plot with explicit ranges scans its data
  // exactly once rather than for a placeholder size too
  const density_result = $derived(
    bin_points(
      has_plot_size ? series : [],
      x_range,
      y_range,
      density_bins.x,
      density_bins.y,
      bin_transforms,
    ),
  )
  const bin_at = (coords: Point2D) =>
    density_bin_at_point(density_result, coords, plot_rect, x_range, y_range, bin_transforms)
  const auto_color_range = $derived<Vec2>([1, Math.max(1, density_result.max_count)])
  const color_scale_fn = $derived(
    create_color_scale(density_settings.color_scale, auto_color_range),
  )
  const color_bar_props = $derived.by((): ComponentProps<typeof ColorBar> | null => {
    if (!color_bar) return null
    return {
      ...color_bar,
      scale_type:
        color_bar.scale_type ??
        (typeof density_settings.color_scale === `string`
          ? undefined
          : density_settings.color_scale.type),
      title: `${color_bar.title ?? `Density`} (${density_result.visible_count.toLocaleString()} points)`,
      tick_format: color_bar.tick_format ?? `.2~s`,
      tick_labels: color_bar.tick_labels ?? 4,
      tick_side: color_bar.tick_side ?? `primary`,
      bar_style:
        color_bar.bar_style ??
        `width: ${COLOR_BAR_DEFAULTS.width}px; height: ${COLOR_BAR_DEFAULTS.binned_bar_height}px; ${color_bar.style ?? ``}`,
    }
  })
  // Occupied bin centres in normalized plot coordinates (y down), thinned to a fixed budget
  const bin_obstacles_norm = $derived.by(() => {
    const { counts, x_bins, y_bins } = density_result
    let occupied_count = 0
    for (const count of counts) if (count) occupied_count++
    const stride = Math.max(1, Math.ceil(occupied_count / max_placement_bins))
    const points: Point2D[] = []
    let occupied_idx = 0
    for (let idx = 0; idx < counts.length; idx++) {
      if (!counts[idx]) continue
      if (occupied_idx++ % stride) continue
      // canonical bin -> screen cell, same as draw_density: without it the obstacle field is
      // mirrored on a reversed range and the solver drops decorations onto the dense cloud
      const [col, row] = density_screen_cell(
        idx % x_bins,
        Math.floor(idx / x_bins),
        x_bins,
        y_bins,
        x_range,
        y_range,
      )
      points.push({ x: (col + 0.5) / x_bins, y: (row + 0.5) / y_bins })
    }
    return points
  })
  const show_colorbar = $derived(
    has_plot_size &&
      color_bar_props !== null &&
      render_mode === `density` &&
      density_result.max_count > 0,
  )
  // Orientation comes off the prop, not color_bar_props (whose title changes with the
  // visible count), so data changes don't trigger a layout read.
  const colorbar = create_colorbar_decoration({
    id: `density-colorbar`,
    enabled: () => show_colorbar,
    horizontal: () => color_bar?.orientation !== `vertical`,
    dims: () => ({ width, height }),
    decoration_solution: () => frame.decoration_solution,
  })
  const annotation_footprint = $derived.by(() => {
    void annotation_size_revision
    return full_footprint_or(annotation_element, { width: 120, height: 50 })
  })
  const decoration_items = $derived.by((): DecorationItem[] => {
    const items: DecorationItem[] = [...colorbar.items]
    if (annotation && has_plot_size) {
      items.push({
        id: `free-annotation`,
        kind: `free-annotation`,
        footprint: annotation_footprint,
        clearance: 12,
      })
    }
    return items
  })
  const annotation_placement = $derived(
    get_decoration_placement(frame.decoration_solution, `free-annotation`),
  )
  const annotation_tween = create_placed_tween({
    placement: () =>
      element_position_for_footprint(annotation_placement, annotation_footprint),
    dims: () => ({ width, height }),
    responsive: () => false,
    element: () => annotation_element,
    on_element_resize: () => (annotation_size_revision += 1),
    placement_revision: () =>
      annotation_placement &&
      `${annotation_placement.x}:${annotation_placement.y}:${colorbar.size_revision}`,
  })

  // Switch to individual markers once few enough points are visible (unless disabled)
  $effect(() => {
    const { auto_point_mode } = density_settings
    if (!has_plot_size || auto_point_mode === false) return
    render_mode = should_render_points(
      density_result.visible_count,
      plot_rect.width * plot_rect.height,
      auto_point_mode.max_points ?? default_density_auto_point_mode.max_points,
      auto_point_mode.max_points_per_px ?? default_density_auto_point_mode.max_points_per_px,
    )
      ? `points`
      : `density`
  })
  const size_scale_fn = $derived(create_size_scale(size_scale, collect_size_values(series)))
  const min_point_radius = $derived(
    size_scale.radius_range?.[0] ?? SCALE_DEFAULTS.binned_radius[0],
  )
  const pick_radius_px = $derived(
    size_scale.pick_radius === `auto`
      ? (size_scale.radius_range?.[1] ?? SCALE_DEFAULTS.binned_radius[1])
      : (size_scale.pick_radius ?? SCALE_DEFAULTS.binned_radius[1]),
  )
  const pick_index = $derived(
    render_mode === `points`
      ? build_pick_index(series, {
          x_range,
          y_range,
          x_scale: x_scale_fn,
          y_scale: y_scale_fn,
          radius_px: pick_radius_px,
        })
      : null,
  )
  const actual_label_placement_config = $derived({
    sa_iterations: 2000,
    max_labels: 300,
    leader_line_threshold: 15,
    candidate_gap: 0,
    ...point_labels_settings.placement,
  })
  // See ScatterPlot: compared by value, the merged object being a fresh identity per update
  const label_config_key = $derived(JSON.stringify(actual_label_placement_config))

  const point_radius_for_value = (size_value: number | null | undefined): number =>
    size_value == null || !Number.isFinite(size_value)
      ? min_point_radius
      : size_scale_fn(size_value)

  // Located per selection change, not per pulse frame, and by index so it stays independent
  // of the scales (which move every pan frame).
  const selected_point = $derived.by(() => {
    if (selected_point_id == null) return null
    for (const [series_idx, srs] of series.entries()) {
      // scanned rather than indexOf: point_ids is ArrayLike, so it may be a typed array
      const ids = srs.point_ids ?? []
      for (let point_idx = 0; point_idx < ids.length; point_idx++) {
        if (ids[point_idx] === selected_point_id) return { series_idx, point_idx }
      }
    }
    return null
  })
  const selected_pulse = create_pulse_animation(
    () => selected_point !== null && render_mode === `points`,
    { step: 0.035, element: () => wrapper },
  )

  // Shared by both layers so a marker looks the same whichever one draws it. `pulse` is the
  // animation phase for the selected marker, or null for a plain one.
  function draw_marker(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    radius: number,
    color: string,
    alpha: number,
    pulse: number | null,
  ) {
    if (color === `none`) return
    ctx.fillStyle = color
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.arc(cx, cy, radius * (pulse == null ? 1 : 1.08 + 0.08 * pulse), 0, 2 * Math.PI)
    ctx.fill()
    if (pulse == null) return
    ctx.globalAlpha = 0.35 + 0.25 * pulse
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5 + pulse
    ctx.beginPath()
    ctx.arc(cx, cy, radius * (1.45 + 0.25 * pulse), 0, 2 * Math.PI)
    ctx.stroke()
  }

  function draw_density(ctx: CanvasRenderingContext2D) {
    const { counts, x_bins, y_bins, max_count } = density_result
    const bin_w = plot_rect.width / x_bins
    const bin_h = plot_rect.height / y_bins
    const style_cache = new Map<number, { fill: string; alpha: number }>()
    for (let y_bin = 0; y_bin < y_bins; y_bin++) {
      for (let x_bin = 0; x_bin < x_bins; x_bin++) {
        const count = counts[y_bin * x_bins + x_bin]
        if (!count) continue
        let style = style_cache.get(count)
        if (!style) {
          style = {
            fill: color_scale_fn(count),
            alpha: Math.min(0.95, 0.2 + Math.log1p(count) / Math.log1p(max_count)),
          }
          style_cache.set(count, style)
        }
        ctx.fillStyle = style.fill
        ctx.globalAlpha = style.alpha
        // bins are canonical (bin 0 = data minimum) while this grid is positional, so a
        // descending range paints them mirrored against its own axis
        const [col, row] = density_screen_cell(x_bin, y_bin, x_bins, y_bins, x_range, y_range)
        ctx.fillRect(
          pad.l + col * bin_w,
          pad.t + row * bin_h,
          Math.ceil(bin_w) + 0.5,
          Math.ceil(bin_h) + 0.5,
        )
      }
    }
    ctx.globalAlpha = 1
  }

  // NaN fails every comparison, so this also rejects non-finite coords. Derived, not a plain
  // function, so draw_points resolves the bounds once rather than per point.
  const in_view = $derived.by(() => {
    const [x_min, x_max] = range_bounds(x_range)
    const [y_min, y_max] = range_bounds(y_range)
    return (x: number, y: number) => x >= x_min && x <= x_max && y >= y_min && y <= y_max
  })

  // Every point except the selected one, which pulses and so lives on the overlay. Reads
  // neither the pulse nor the hover, so this layer only repaints when the data or view move.
  function draw_points(ctx: CanvasRenderingContext2D) {
    for (const [series_idx, srs] of series.entries()) {
      const color = srs.color ?? plot_color(series_idx)
      const n_points = srs.x.length
      for (let point_idx = 0; point_idx < n_points; point_idx++) {
        const x = srs.x[point_idx]
        const y = srs.y[point_idx]
        if (!in_view(x, y)) continue
        if (
          selected_point?.series_idx === series_idx &&
          selected_point.point_idx === point_idx
        ) {
          continue
        }
        const radius = point_radius_for_value(srs.size_values?.[point_idx])
        draw_marker(ctx, x_scale_fn(x), y_scale_fn(y), radius, color, 0.65, null)
      }
    }
    ctx.globalAlpha = 1
  }

  // The two markers that change at interaction rate. Repainting these on their own canvas is
  // what keeps a pulse tick or a pointer move off the O(all points) path above.
  function draw_marked_points(ctx: CanvasRenderingContext2D) {
    if (render_mode !== `points`) return // density mode has no per-point markers
    for (const [mark, pulse] of [
      [hovered_point, null],
      // selected last, so its ring sits over the hover. Don't subscribe this paint effect to
      // pulse ticks when the selected ID does not resolve to a point.
      [selected_point, selected_point ? selected_pulse.unit : null],
    ] as const) {
      if (!mark) continue
      const { series_idx, point_idx } = mark
      const srs = series[series_idx]
      const [x, y] = [srs?.x[point_idx], srs?.y[point_idx]]
      if (!in_view(x, y)) continue
      const radius = point_radius_for_value(srs.size_values?.[point_idx])
      const color = srs.color ?? plot_color(series_idx)
      draw_marker(ctx, x_scale_fn(x), y_scale_fn(y), radius, color, 1, pulse)
    }
    ctx.globalAlpha = 1
  }

  // Density bins are continuous geometry and clip to the plot area. Point centers are
  // range-filtered before drawing, so leave their complete marker glyphs visible at the edges.
  const paint = (
    node: HTMLCanvasElement | undefined,
    draw: (ctx: CanvasRenderingContext2D) => void,
    clip_to_plot = false,
  ) => {
    if (!node || !has_plot_size) return
    const dpr = globalThis.devicePixelRatio || 1
    const backing_width = Math.max(1, Math.round(width * dpr))
    const backing_height = Math.max(1, Math.round(height * dpr))
    if (node.width !== backing_width) node.width = backing_width
    if (node.height !== backing_height) node.height = backing_height
    if (node.style.width !== `${width}px`) node.style.width = `${width}px`
    if (node.style.height !== `${height}px`) node.style.height = `${height}px`
    const ctx = node.getContext(`2d`)
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.save()
    if (clip_to_plot) {
      ctx.beginPath()
      ctx.rect(plot_rect.x, plot_rect.y, plot_rect.width, plot_rect.height)
      ctx.clip()
    }
    draw(ctx)
    ctx.restore()
  }

  // Canvases live in <foreignObject>s inside the frame's SVG so they sit in SVG paint order:
  // under the axes, reference lines and marginals, above the title background.
  let base_canvas = $state<HTMLCanvasElement>()
  let overlay_canvas = $state<HTMLCanvasElement>()
  const attach_canvas =
    (class_name: string, assign: (canvas: HTMLCanvasElement | undefined) => void) =>
    (foreign_object: SVGForeignObjectElement) => {
      const canvas = document.createElement(`canvas`)
      canvas.className = class_name
      canvas.style.display = `block`
      foreign_object.append(canvas)
      assign(canvas)
      return () => {
        assign(undefined)
        canvas.remove()
      }
    }
  $effect(() =>
    paint(
      base_canvas,
      render_mode === `points` ? draw_points : draw_density,
      render_mode === `density`,
    ),
  )
  $effect(() => paint(overlay_canvas, draw_marked_points))

  const pick_at = (coords: Point2D): DenseInternalPoint<Metadata> | null =>
    pick_index ? query_nearest(pick_index, coords) : null

  function clear_hover() {
    hovered_bin = null
    hovered_point = null
    hovered = false
  }

  const handler_props = (
    point: DenseInternalPoint<Metadata>,
  ): ScatterHandlerProps<Metadata> => ({
    x: point.x,
    y: point.y,
    cx: point.cx,
    cy: point.cy,
    metadata: point.metadata,
    label: series[point.series_idx]?.label ?? null,
    series_idx: point.series_idx,
    x_axis,
    y_axis,
    x_formatted: fmt_x(point.x),
    y_formatted: fmt_y(point.y),
  })

  const fmt_x = (val: number): string => format_value(val, x_axis.format ?? `.3~g`)
  const fmt_y = (val: number): string => format_value(val, y_axis.format ?? `.3~g`)

  const point_color = (point: DenseInternalPoint<Metadata>): string =>
    series[point.series_idx]?.color ?? plot_color(point.series_idx)

  const point_label_key = (point: DenseInternalPoint<Metadata>): string =>
    `${point.series_idx}-${point.point_idx}`

  function point_payload(
    point: DenseInternalPoint<Metadata>,
    color = point_color(point),
  ): BinnedPointPayload<Metadata, PointData> {
    const base_payload = { ...handler_props(point), point, color }
    return { ...base_payload, point_data: point_data?.(base_payload) ?? undefined }
  }

  const label_measure_text = (payload: BinnedPointPayload<Metadata, PointData>): string =>
    point_labels_settings.measure_text?.(payload) ??
    String(payload.point.point_id ?? point_label_key(payload.point))

  const label_size_for_payload = (
    payload: BinnedPointPayload<Metadata, PointData>,
  ): LabelSize =>
    label_sizes.get(point_label_key(payload.point)) ??
    estimate_label_size(label_measure_text(payload), point_labels_settings.font_size)

  const point_label_payloads = $derived.by(() => {
    if (!point_labels_settings.render || render_mode !== `points`) return []
    const payloads: BinnedPointPayload<Metadata, PointData>[] = []
    for (const point of visible_points(series, x_range, y_range, x_scale_fn, y_scale_fn)) {
      payloads.push(point_payload(point))
      if (payloads.length > point_labels_settings.max_count) return []
    }
    return payloads
  })

  // See ScatterPlot: carried between solves so a pan/zoom frame polishes the previous layout
  const label_offsets = new Map<string, Point2D>()
  let previous_label_series: typeof series | undefined
  let previous_label_config: string | undefined

  // An effect, not $derived: the solve mutates `label_offsets`, and a lazy derived is skipped
  // while the template renders no labels, leaving stale offsets to warm-start the next solve.
  let point_label_positions = $state<Record<string, Point2D>>({})
  $effect(() => {
    // Warm keys are index-based, so a data swap must search cold, not polish the old layout
    if (series !== previous_label_series || label_config_key !== previous_label_config) {
      label_offsets.clear()
      previous_label_series = series
      previous_label_config = label_config_key
    }
    if (point_label_payloads.length === 0) {
      label_offsets.clear()
      point_label_positions = {}
      return
    }
    const filtered_data: InternalPoint<Metadata>[] = point_label_payloads.map((payload) => ({
      ...payload.point,
      point_label: {
        text: label_measure_text(payload),
        auto_placement: true,
        font_size: point_labels_settings.font_size,
        size: label_sizes.get(point_label_key(payload.point)),
      },
      point_style: {
        radius:
          point_radius_for_value(payload.point.size_value) + point_labels_settings.gap_px,
      },
    }))
    const label_series: DataSeries<Metadata>[] = [{ x: [], y: [], filtered_data }]
    point_label_positions = compute_label_positions(
      label_series,
      actual_label_placement_config,
      frame.scales,
      { width, height, pad },
      label_offsets,
    )
  })

  // Measure the rendered label snippets (hidden copies) so placement uses real sizes
  async function measure_point_labels() {
    await tick()
    if (!label_measure_root) return
    const active_keys = new SvelteSet<string>()
    for (const element of label_measure_root.querySelectorAll<HTMLElement>(
      `[data-label-key]`,
    )) {
      const label_key = element.dataset.labelKey
      if (!label_key) continue
      const { width: label_width, height: label_height } = element.getBoundingClientRect()
      if (label_width <= 0 || label_height <= 0) continue
      active_keys.add(label_key)
      const current_size = label_sizes.get(label_key)
      if (current_size?.width === label_width && current_size.height === label_height) continue
      label_sizes.set(label_key, { width: label_width, height: label_height })
    }
    for (const label_key of label_sizes.keys()) {
      if (!active_keys.has(label_key)) label_sizes.delete(label_key)
    }
  }
  $effect(() => {
    if (!label_measure_root || point_label_payloads.length === 0) return
    void measure_point_labels()
  })

  function label_leader_line(
    payload: BinnedPointPayload<Metadata, PointData>,
    label_position: Point2D,
  ): { x1: number; y1: number; x2: number; y2: number } | null {
    const displacement = Math.hypot(
      label_position.x - payload.cx,
      label_position.y - payload.cy,
    )
    if (displacement <= (actual_label_placement_config.leader_line_threshold ?? 15)) {
      return null
    }
    return label_leader_segment({
      point: { x: payload.cx, y: payload.cy },
      point_radius: point_radius_for_value(payload.point.size_value),
      label_center: label_position,
      label_size: label_size_for_payload(payload),
      min_length: point_labels_settings.leaders.min_length_px,
    })
  }

  function on_pointer_move(event: MouseEvent) {
    if (pan_zoom.drag_start || pan_zoom.is_panning) return
    const coords = get_relative_coords(event)
    if (!coords) {
      clear_hover()
      return
    }
    // The raw cursor, not a pre-offset point: PlotTooltip needs the true anchor to
    // flip and to keep the pointer glyph clear (see its `offset`/`avoid_cursor`).
    tooltip_pos = coords
    hovered = true
    if (render_mode === `density`) {
      hovered_point = null
      const bin = bin_at(coords)
      if (
        hovered_bin?.x_bin !== bin?.x_bin ||
        hovered_bin?.y_bin !== bin?.y_bin ||
        hovered_bin?.count !== bin?.count
      )
        hovered_bin = bin
      return
    }
    hovered_bin = null
    const point = pick_at(coords)
    if (
      hovered_point?.series_idx !== point?.series_idx ||
      hovered_point?.point_idx !== point?.point_idx
    )
      hovered_point = point
  }

  function emit_point_click(
    point: DenseInternalPoint<Metadata>,
    event: MouseEvent,
    color?: string,
  ) {
    on_point_click?.({ ...point_payload(point, color), event })
  }

  function on_click(event: MouseEvent) {
    // A rect-zoom drag ends in a click the frame flags; don't also zoom the bin under it
    if (pan_zoom.suppress_click || pan_zoom.drag_start || pan_zoom.is_panning) return
    const coords = get_relative_coords(event)
    if (!coords) return
    if (render_mode === `points`) {
      const point = pick_at(coords)
      if (point) emit_point_click(point, event)
      return
    }
    const bin = bin_at(coords)
    if (!bin || density_settings.bin_click === `none`) return
    if (bin.count > 1 && density_settings.bin_click === `zoom`) {
      facet.update_range(`x`, bin.x_range)
      facet.update_range(`y`, bin.y_range)
      hovered_bin = null
      on_density_zoom?.({ bin, event })
      return
    }
    if (bin.count > 1 && density_settings.bin_click !== `point`) return
    const point = first_point_in_bin(series, density_result, bin, x_scale_fn, y_scale_fn)
    if (point) emit_point_click(point, event, color_scale_fn(bin.count))
  }
</script>

<CartesianFrame
  {frame}
  plot_class="binned-scatter"
  css_prefix="binned-scatter"
  aria_label="Binned scatter plot"
  bind:fullscreen
  bind:wrapper
  {fullscreen_toggle}
  marginals={resolved_marginals}
  {marginal_series}
  on_mouse_move={on_pointer_move}
  on_mouse_click={on_click}
  on_mouse_leave={clear_hover}
  {header_controls}
  {children}
  {...rest}
  data-render-mode={render_mode}
  style="--binned-scatter-label-font-size: {point_labels_settings.font_size}; {rest.style ??
    ``}"
>
  {#snippet layers()}
    <foreignObject
      x="0"
      y="0"
      {width}
      {height}
      pointer-events="none"
      {@attach attach_canvas(`density-canvas`, (canvas) => (base_canvas = canvas))}
    ></foreignObject>
    <foreignObject
      x="0"
      y="0"
      {width}
      {height}
      pointer-events="none"
      {@attach attach_canvas(`marked-points`, (canvas) => (overlay_canvas = canvas))}
    ></foreignObject>

    <!-- Overlay ref lines ignore z-order: every level renders here, below the axes -->
    <g class="reference-lines">
      {#each [`below-grid`, `below-lines`, `below-points`, `above-all`] as const as z (z)}
        <ReferenceLinesLayer {frame} {z} />
      {/each}
    </g>
    <PlotAxes {frame} display={grid_display} />

    {#if point_label_payloads.length}
      <g class="point-label-leaders" clip-path="url(#{frame.clip_path_id})">
        {#each point_label_payloads as payload (point_label_key(payload.point))}
          {@const label_position = point_label_positions[point_label_key(payload.point)]}
          {@const leader_line = label_position
            ? label_leader_line(payload, label_position)
            : null}
          {#if leader_line}
            <line
              x1={leader_line.x1}
              y1={leader_line.y1}
              x2={leader_line.x2}
              y2={leader_line.y2}
            />
          {/if}
        {/each}
      </g>
    {/if}
  {/snippet}

  {#snippet overlays()}
    {#if point_labels_settings.render && point_label_payloads.length}
      <div bind:this={label_measure_root} class="point-label-measurements" aria-hidden="true">
        {#each point_label_payloads as payload (point_label_key(payload.point))}
          <div
            class="point-label point-label-measure"
            data-label-key={point_label_key(payload.point)}
          >
            {@render point_labels_settings.render(payload)}
          </div>
        {/each}
      </div>
      <div class="point-labels">
        {#each point_label_payloads as payload (point_label_key(payload.point))}
          {@const label_position = point_label_positions[point_label_key(payload.point)]}
          {#if label_position}
            <div
              class="point-label"
              style="left: {label_position.x}px; top: {label_position.y}px"
            >
              {@render point_labels_settings.render(payload)}
            </div>
          {/if}
        {/each}
      </div>
    {/if}

    {#if show_colorbar && color_bar_props}
      <ColorBarDecoration
        decoration={colorbar}
        color_bar={{
          ...color_bar_props,
          scale: { fn: color_scale_fn, domain: auto_color_range },
          range: auto_color_range,
        }}
      />
    {/if}

    {#if has_plot_size && annotation}
      <div
        bind:this={annotation_element}
        class="annotation"
        {...decoration_data_attrs(annotation_placement)}
        style="left: {annotation_tween.coords.current.x}px; top: {annotation_tween.coords
          .current.y}px"
      >
        {@render annotation({ height, width, fullscreen })}
      </div>
    {/if}

    {#if hovered_bin}
      <PlotTooltip
        x={tooltip_pos.x}
        y={tooltip_pos.y}
        offset={{ x: 12, y: 8 }}
        constrain_to={{ width, height }}
        exclusion_rects={frame.exclusion_rects}
        fallback_size={{ width: 150, height: 64 }}
        bg_color={color_scale_fn(hovered_bin.count)}
      >
        {hovered_bin.count.toLocaleString()} samples<br />
        x: {fmt_x(hovered_bin.x_range[0])} - {fmt_x(hovered_bin.x_range[1])}<br />
        y: {fmt_y(hovered_bin.y_range[0])} - {fmt_y(hovered_bin.y_range[1])}
      </PlotTooltip>
    {:else if hovered_point}
      {@const props = point_payload(hovered_point)}
      <PlotTooltip
        x={tooltip_pos.x}
        y={tooltip_pos.y}
        offset={{ x: 12, y: 8 }}
        constrain_to={{ width, height }}
        exclusion_rects={frame.exclusion_rects}
        fallback_size={{ width: 120, height: 44 }}
      >
        {#if tooltip}
          {@render tooltip(props)}
        {:else}
          {x_axis.label ?? `x`}: {props.x_formatted}<br />
          {y_axis.label ?? `y`}: {props.y_formatted}
        {/if}
      </PlotTooltip>
    {/if}
  {/snippet}
</CartesianFrame>

<style>
  :global(.binned-scatter) {
    touch-action: none;
    user-select: none;
  }
  :global(.binned-scatter .axis-label) {
    color: currentColor;
    font-size: 13px;
    font-weight: 600;
    height: 100%;
    line-height: 24px;
    text-align: center;
    white-space: nowrap;
    width: 100%;
  }
  :global(.binned-scatter .reference-lines line) {
    opacity: 0.75;
  }
  :global(.binned-scatter .point-label-leaders line) {
    stroke: var(
      --binned-scatter-label-leader-color,
      color-mix(in srgb, currentColor 60%, transparent)
    );
    stroke-dasharray: var(--binned-scatter-label-leader-dash, 2 2);
    stroke-width: var(--binned-scatter-label-leader-width, 0.8);
  }
  .point-labels {
    inset: 0;
    pointer-events: none;
    position: absolute;
    z-index: 1;
  }
  .point-label-measurements {
    contain: layout style;
    inset: 0;
    pointer-events: none;
    position: absolute;
    visibility: hidden;
    z-index: -1;
  }
  .point-label {
    background: var(--binned-scatter-label-bg, color-mix(in srgb, Canvas 84%, transparent));
    border: 0 !important;
    border-radius: var(--binned-scatter-label-radius, 3px);
    box-shadow: none;
    color: var(--binned-scatter-label-color, currentColor);
    font-size: var(--binned-scatter-label-font-size, 11px);
    line-height: 1.2;
    outline: 0;
    padding: var(--binned-scatter-label-padding, 1px 3px);
    position: absolute;
    text-align: center;
    transform: translate(-50%, -50%);
    white-space: nowrap;
  }
  .point-label-measure {
    left: 0;
    top: 0;
    transform: none;
  }
  .annotation {
    pointer-events: none;
    position: absolute;
    width: max-content;
  }
</style>
