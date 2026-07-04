<script module lang="ts">
  let next_clip_id = 0
</script>

<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>, PointData extends Record<string, unknown> = Record<string, unknown>"
>
  import Icon from '$lib/Icon.svelte'
  import { format_value } from '$lib/labels'
  import { FullscreenToggle, set_fullscreen_bg } from '$lib/layout'
  import type { Point2D, Vec2 } from '$lib/math'
  import { create_pulse_animation } from '$lib/effects.svelte'
  import ColorBar from '$lib/plot/core/components/ColorBar.svelte'
  import PlotAxis from '$lib/plot/core/components/PlotAxis.svelte'
  import PlotMarginals from '$lib/plot/core/components/PlotMarginals.svelte'
  import PlotTooltip from '$lib/plot/core/components/PlotTooltip.svelte'
  import ZoomRect from '$lib/plot/core/components/ZoomRect.svelte'
  import {
    compute_element_placement,
    DEFAULT_PLOT_PADDING,
    filter_padding,
  } from '$lib/plot/core/layout'
  import type { Sides } from '$lib/plot/core/layout'
  import { get_series_color } from '$lib/plot/core/data-transform'
  import type { MarginalSeriesInput, MarginalsProp } from '$lib/plot/core/marginals'
  import {
    add_sides,
    marginal_axis,
    marginal_axis_presence,
    normalize_marginals,
    reserve_marginal_pad,
  } from '$lib/plot/core/marginals'
  import {
    build_pick_index,
    bin_points,
    density_bin_at_point,
    first_point_in_bin,
    get_metadata_at,
    pick_from_index,
    range_bounds,
    scale_bin_transform,
    series_extents,
    should_render_points,
  } from '$lib/plot/scatter/adaptive-density'
  import type {
    DensityBin,
    DenseInternalPoint,
    DensePointSeries,
  } from '$lib/plot/scatter/adaptive-density'
  import {
    create_color_scale,
    create_scale,
    create_size_scale,
    generate_ticks,
  } from '$lib/plot/core/scales'
  import type {
    AxisConfig,
    DataSeries,
    InternalPoint,
    ScatterHandlerProps,
  } from '$lib/plot/core/types'
  import { COLOR_BAR_DEFAULTS, SCALE_DEFAULTS } from '$lib/plot/core/types'
  import {
    compute_label_positions,
    estimate_label_size,
    label_leader_segment,
  } from '$lib/plot/core/utils/label-placement'
  import type { LabelSize } from '$lib/plot/core/utils/label-placement'
  import type { ComponentProps, Snippet } from 'svelte'
  import { onMount, tick } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap, SvelteSet } from 'svelte/reactivity'
  import type {
    BinnedDensityConfig,
    BinnedOverlaysConfig,
    BinnedPointDataFn,
    BinnedPointLabelsConfig,
    BinnedPointPayload,
    BinnedPointTooltipPayload,
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
  type DensityZoomEvent = {
    bin: DensityBin
    event: MouseEvent
  }
  type OverlayContext = { height: number; width: number; fullscreen: boolean }
  const default_density_auto_point_mode = { max_points: 25_000, max_points_per_px: 0.12 }
  const default_density_color_bar: ComponentProps<typeof ColorBar> = { title: `Density` }
  const max_placement_bins = 500

  let {
    series,
    x_axis = {},
    y_axis = {},
    size_scale = DEFAULT_BINNED_SIZE_SCALE,
    density: density_config = {},
    overlays: overlays_config = {},
    padding: padding_config = {},
    tooltip,
    point_data,
    point_labels = {},
    selected_point_id = null,
    on_point_click,
    on_density_zoom,
    render_mode = $bindable<RenderMode>(`density`),
    wrapper = $bindable(),
    fullscreen = $bindable(false),
    fullscreen_toggle = true,
    children,
    header_controls,
    marginals = false,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `children`> & {
    series: DensePointSeries<Metadata>[]
    x_axis?: AxisConfig
    y_axis?: AxisConfig
    size_scale?: BinnedSizeScaleConfig
    density?: BinnedDensityConfig
    overlays?: BinnedOverlaysConfig
    padding?: Sides
    tooltip?: Snippet<[BinnedPointTooltipPayload<Metadata, PointData>]>
    point_data?: BinnedPointDataFn<Metadata, PointData>
    point_labels?: BinnedPointLabelsConfig<Metadata, PointData>
    selected_point_id?: string | number | null
    on_point_click?: (payload: ScatterHandlerProps<Metadata> & DensePointEvent) => void
    on_density_zoom?: (payload: DensityZoomEvent) => void
    render_mode?: RenderMode
    wrapper?: HTMLDivElement
    fullscreen?: boolean
    fullscreen_toggle?: boolean
    children?: Snippet<[OverlayContext]>
    header_controls?: Snippet<[OverlayContext]>
    marginals?: MarginalsProp
  } = $props()

  let canvas = $state<HTMLCanvasElement>()
  let width = $state(0)
  let height = $state(0)
  let x_range = $state<Vec2>([0, 1])
  let y_range = $state<Vec2>([0, 1])
  let has_user_range = $state(false)
  let drag_start = $state<Point2D | null>(null)
  let drag_current = $state<Point2D | null>(null)
  let suppress_next_click = false
  let hovered_bin = $state<DensityBin | null>(null)
  let hovered_point = $state<DenseInternalPoint<Metadata> | null>(null)
  let tooltip_pos = $state<Point2D>({ x: 0, y: 0 })
  let colorbar_element = $state<HTMLDivElement>()
  let label_measure_root = $state<HTMLDivElement>()
  let label_sizes = new SvelteMap<string, LabelSize>()
  const clip_path_id = `binned-scatter-plot-area-${next_clip_id++}`

  const resolved_marginals = $derived(
    normalize_marginals(marginals, { top: true, right: true }),
  )
  // Unlike the other 2D plots this one doesn't auto-grow padding for tick labels, so this
  // shared default is its final pad (merged with any user `padding`), not just a floor.
  let pad = $derived(
    add_sides(
      filter_padding(padding_config, DEFAULT_PLOT_PADDING),
      reserve_marginal_pad(resolved_marginals),
    ),
  )
  const marginal_series = $derived<MarginalSeriesInput[]>(
    series.map((srs, idx) => ({
      x: srs.x,
      y: srs.y,
      color: srs.color ?? get_series_color(idx),
      label: srs.label,
      visible: true,
    })),
  )
  const marginal_has_axis = marginal_axis_presence(false, false)
  let density_settings = $derived({
    bin_px: density_config.bin_px ?? 2.8,
    color_scale: density_config.color_scale ?? SCALE_DEFAULTS.color,
    color_bar:
      density_config.color_bar === undefined
        ? default_density_color_bar
        : density_config.color_bar,
    auto_point_mode:
      density_config.auto_point_mode === undefined
        ? default_density_auto_point_mode
        : density_config.auto_point_mode,
    bin_click: density_config.bin_click ?? `zoom`,
  })
  let ref_lines = $derived(overlays_config.ref_lines ?? [])
  let point_labels_settings = $derived({
    font_size: point_labels.font_size ?? `11px`,
    max_count: point_labels.max_count ?? 50,
    gap_px: point_labels.gap_px ?? 3,
    placement: point_labels.placement ?? {},
    leaders: {
      min_length_px: point_labels.leaders?.min_length_px ?? 6,
    },
    render: point_labels.render,
    measure_text: point_labels.measure_text,
  })

  $effect(() => {
    set_fullscreen_bg(wrapper, fullscreen, `--binned-scatter-fullscreen-bg`)
  })

  const selected_pulse = create_pulse_animation(
    () => selected_point_id != null && render_mode === `points`,
    { step: 0.035 },
  )

  const needs_data_range = (range: AxisConfig[`range`] | undefined): boolean =>
    range?.[0] == null || range?.[1] == null

  let needs_auto_range = $derived(
    needs_data_range(x_axis.range) || needs_data_range(y_axis.range),
  )
  let auto_ranges = $derived(
    needs_auto_range ? series_extents(series) : { x: [0, 1] as Vec2, y: [0, 1] as Vec2 },
  )
  let x_scale_type = $derived(x_axis.scale_type ?? `linear`)
  let y_scale_type = $derived(y_axis.scale_type ?? `linear`)
  let has_plot_size = $derived(width > 0 && height > 0)

  const axis_range = (axis: AxisConfig, fallback: Vec2): Vec2 => [
    axis.range?.[0] ?? fallback[0],
    axis.range?.[1] ?? fallback[1],
  ]
  const same_range = (a: Vec2, b: Vec2): boolean => a[0] === b[0] && a[1] === b[1]

  function set_auto_range() {
    const next_x_range = axis_range(x_axis, auto_ranges.x)
    const next_y_range = axis_range(y_axis, auto_ranges.y)
    // Skip non-finite ranges (e.g. a NaN bound in an axis range prop): NaN !== NaN
    // means same_range never settles, looping until effect_update_depth_exceeded
    if (![...next_x_range, ...next_y_range].every(Number.isFinite)) return
    if (!same_range(x_range, next_x_range)) x_range = next_x_range
    if (!same_range(y_range, next_y_range)) y_range = next_y_range
  }

  $effect(() => {
    if (has_user_range) return
    set_auto_range()
  })

  let plot_width = $derived(Math.max(1, width - pad.l - pad.r))
  let plot_height = $derived(Math.max(1, height - pad.t - pad.b))
  let plot_rect = $derived({
    x: pad.l,
    y: pad.t,
    width: plot_width,
    height: plot_height,
  })
  let x_scale_fn = $derived(create_scale(x_scale_type, x_range, [pad.l, width - pad.r]))
  let y_scale_fn = $derived(create_scale(y_scale_type, y_range, [height - pad.b, pad.t]))
  let x_ticks = $derived(
    generate_ticks(x_range, x_scale_type, x_axis.ticks, x_scale_fn, {
      default_count: 7,
    }),
  )
  let y_ticks = $derived(
    generate_ticks(y_range, y_scale_type, y_axis.ticks, y_scale_fn, {
      default_count: 6,
    }),
  )
  let density_bins = $derived({
    x: Math.max(8, Math.ceil(plot_width / density_settings.bin_px)),
    y: Math.max(8, Math.ceil(plot_height / density_settings.bin_px)),
  })
  // Bin in scale space so the heatmap, hover, and zoom stay aligned with log/arcsinh axes
  let bin_transforms = $derived({
    x: scale_bin_transform(x_scale_type),
    y: scale_bin_transform(y_scale_type),
  })
  let bin_series = $derived(has_plot_size ? series : [])
  let density_result = $derived(
    bin_points(bin_series, x_range, y_range, density_bins.x, density_bins.y, bin_transforms),
  )
  const bin_at = (coords: Point2D) =>
    density_bin_at_point(density_result, coords, plot_rect, x_range, y_range, bin_transforms)
  let auto_color_range = $derived<Vec2>([1, Math.max(1, density_result.max_count)])
  let color_scale_fn = $derived(
    create_color_scale(density_settings.color_scale, auto_color_range),
  )
  let hovered_bin_color = $derived(hovered_bin ? color_scale_fn(hovered_bin.count) : undefined)
  let color_scale_type = $derived(
    typeof density_settings.color_scale === `string`
      ? undefined
      : density_settings.color_scale.type,
  )
  let color_bar_props = $derived.by((): ComponentProps<typeof ColorBar> | null => {
    const color_bar = density_settings.color_bar
    if (!color_bar) return null
    return {
      ...color_bar,
      scale_type: color_bar.scale_type ?? color_scale_type,
      title: `${color_bar.title ?? `Density`} (${density_result.visible_count.toLocaleString()} points)`,
      tick_format: color_bar.tick_format ?? `.2~s`,
      tick_labels: color_bar.tick_labels ?? 4,
      tick_side: color_bar.tick_side ?? `primary`,
      bar_style:
        color_bar.bar_style ??
        `width: ${COLOR_BAR_DEFAULTS.width}px; height: ${COLOR_BAR_DEFAULTS.binned_bar_height}px; ${color_bar.style ?? ``}`,
    }
  })
  let density_placement_points = $derived.by(() => {
    const points: Point2D[] = []
    const bin_w = plot_width / density_result.x_bins
    const bin_h = plot_height / density_result.y_bins
    let occupied_count = 0
    for (const count of density_result.counts) {
      if (count) occupied_count++
    }
    const stride = Math.max(1, Math.ceil(occupied_count / max_placement_bins))
    let occupied_idx = 0
    for (let idx = 0; idx < density_result.counts.length; idx++) {
      if (!density_result.counts[idx]) continue
      if (occupied_idx++ % stride) continue
      const x_bin = idx % density_result.x_bins
      const y_bin = Math.floor(idx / density_result.x_bins)
      points.push({
        x: pad.l + (x_bin + 0.5) * bin_w,
        y: pad.t + (density_result.y_bins - y_bin - 0.5) * bin_h,
      })
    }
    return points
  })
  let color_bar_placement = $derived.by(() => {
    if (
      !color_bar_props ||
      render_mode !== `density` ||
      density_result.max_count <= 0 ||
      !width ||
      !height
    ) {
      return null
    }

    const is_vertical = color_bar_props?.orientation === `vertical`
    // Fallback sizes (incl. room for tick labels) used before the colorbar first
    // renders; compute_element_placement measures the real footprint once laid out
    const fallback_size = is_vertical
      ? { width: 56, height: 120 }
      : { width: COLOR_BAR_DEFAULTS.width, height: 50 }

    return compute_element_placement({
      plot_bounds: plot_rect,
      element: colorbar_element,
      element_size: fallback_size,
      // Small gap from the corner; the full-footprint measurement reserves the tick
      // labels, so this alone keeps the colorbar off the axes
      axis_clearance: 12,
      points: density_placement_points,
      grid_resolution: 12,
    })
  })

  let auto_render_mode = $derived.by((): RenderMode => {
    const auto_point_mode = density_settings.auto_point_mode
    if (auto_point_mode === false) return render_mode
    return should_render_points(
      density_result.visible_count,
      plot_width * plot_height,
      auto_point_mode.max_points ?? default_density_auto_point_mode.max_points,
      auto_point_mode.max_points_per_px ?? default_density_auto_point_mode.max_points_per_px,
    )
      ? `points`
      : `density`
  })
  let all_size_values = $derived.by(() => {
    const values: number[] = []
    for (const srs of series) {
      if (!srs.size_values) continue
      for (const size_value of Array.from(srs.size_values)) {
        if (size_value == null || !Number.isFinite(size_value)) continue
        values.push(size_value)
      }
    }
    return values
  })
  let size_scale_fn = $derived(create_size_scale(size_scale, all_size_values))
  let min_point_radius = $derived(
    size_scale.radius_range?.[0] ?? SCALE_DEFAULTS.binned_radius[0],
  )
  let max_point_radius = $derived(
    size_scale.radius_range?.[1] ?? SCALE_DEFAULTS.binned_radius[1],
  )
  let pick_radius_px = $derived(
    size_scale.pick_radius === `auto`
      ? max_point_radius
      : (size_scale.pick_radius ?? SCALE_DEFAULTS.binned_radius[1]),
  )

  $effect(() => {
    if (!has_plot_size) return
    if (density_settings.auto_point_mode !== false) render_mode = auto_render_mode
  })
  let pick_index = $derived(
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
  let actual_label_placement_config = $derived({
    sa_iterations: 2000,
    max_labels: 300,
    leader_line_threshold: 15,
    candidate_gap: 0,
    ...point_labels_settings.placement,
  })

  const reset_view = () => {
    has_user_range = false
    set_auto_range()
  }

  function point_radius_for_value(size_value: number | null | undefined): number {
    if (size_value == null || !Number.isFinite(size_value)) {
      return min_point_radius
    }
    return size_scale_fn(size_value)
  }

  function resize_canvas() {
    if (!canvas) return
    const dpr = globalThis.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }

  function draw_density(ctx: CanvasRenderingContext2D) {
    const bin_w = plot_width / density_result.x_bins
    const bin_h = plot_height / density_result.y_bins
    const style_cache = new Map<number, { fill: string; alpha: number }>()
    for (let y_bin = 0; y_bin < density_result.y_bins; y_bin++) {
      for (let x_bin = 0; x_bin < density_result.x_bins; x_bin++) {
        const count = density_result.counts[y_bin * density_result.x_bins + x_bin]
        if (!count) continue
        let style = style_cache.get(count)
        if (!style) {
          style = {
            fill: color_scale_fn(count),
            alpha: Math.min(
              0.95,
              0.2 + Math.log1p(count) / Math.log1p(density_result.max_count),
            ),
          }
          style_cache.set(count, style)
        }
        ctx.fillStyle = style.fill
        ctx.globalAlpha = style.alpha
        ctx.fillRect(
          pad.l + x_bin * bin_w,
          pad.t + (density_result.y_bins - y_bin - 1) * bin_h,
          Math.ceil(bin_w) + 0.5,
          Math.ceil(bin_h) + 0.5,
        )
      }
    }
    ctx.globalAlpha = 1
  }

  function draw_points(ctx: CanvasRenderingContext2D) {
    const [x_min, x_max] = range_bounds(x_range)
    const [y_min, y_max] = range_bounds(y_range)
    const pulse = selected_pulse.unit
    for (const [series_idx, srs] of series.entries()) {
      ctx.fillStyle = srs.color ?? get_series_color(series_idx)
      const n_points = Math.min(srs.x.length, srs.y.length)
      for (let point_idx = 0; point_idx < n_points; point_idx++) {
        const x = srs.x[point_idx]
        const y = srs.y[point_idx]
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        if (x < x_min || x > x_max || y < y_min || y > y_max) continue
        const cx = x_scale_fn(x)
        const cy = y_scale_fn(y)
        const point_id = srs.point_ids?.[point_idx]
        const is_selected = selected_point_id != null && point_id === selected_point_id
        const radius = point_radius_for_value(srs.size_values?.[point_idx])
        const is_hovered =
          hovered_point?.series_idx === series_idx && hovered_point?.point_idx === point_idx
        ctx.globalAlpha = is_selected || is_hovered ? 1 : 0.65
        ctx.beginPath()
        ctx.arc(cx, cy, radius * (is_selected ? 1.08 + 0.08 * pulse : 1), 0, 2 * Math.PI)
        ctx.fill()
        if (is_selected) {
          ctx.globalAlpha = 0.35 + 0.25 * pulse
          ctx.strokeStyle = srs.color ?? get_series_color(series_idx)
          ctx.lineWidth = 1.5 + pulse
          ctx.beginPath()
          ctx.arc(cx, cy, radius * (1.45 + 0.25 * pulse), 0, 2 * Math.PI)
          ctx.stroke()
        }
      }
    }
    ctx.globalAlpha = 1
  }

  $effect(() => {
    if (!canvas || width <= 0 || height <= 0) return
    resize_canvas()
    const ctx = canvas.getContext(`2d`)
    if (!ctx) return
    const dpr = globalThis.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.save()
    ctx.beginPath()
    ctx.rect(pad.l, pad.t, plot_width, plot_height)
    ctx.clip()
    if (render_mode === `points`) draw_points(ctx)
    else draw_density(ctx)
    ctx.restore()
  })

  function pointer_coords(event: PointerEvent | MouseEvent): Point2D | null {
    if (!wrapper) return null
    const rect = wrapper.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  function pick_at(coords: Point2D | null): DenseInternalPoint<Metadata> | null {
    if (!coords || !pick_index) return null
    return pick_from_index(pick_index, coords)
  }

  function clear_hover() {
    hovered_bin = null
    hovered_point = null
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
    x_formatted: format_value(point.x, x_axis.format ?? `.3~g`),
    y_formatted: format_value(point.y, y_axis.format ?? `.3~g`),
  })

  const point_color = (point: DenseInternalPoint<Metadata>): string =>
    series[point.series_idx]?.color ?? get_series_color(point.series_idx)

  const point_label_key = (point: DenseInternalPoint<Metadata>): string =>
    `${point.series_idx}-${point.point_idx}`

  function make_point(series_idx: number, point_idx: number): DenseInternalPoint<Metadata> {
    const srs = series[series_idx]
    const x = srs.x[point_idx]
    const y = srs.y[point_idx]
    return {
      x,
      y,
      cx: x_scale_fn(x),
      cy: y_scale_fn(y),
      series_idx,
      point_idx,
      metadata: get_metadata_at(srs.metadata, point_idx),
      point_id: srs.point_ids?.[point_idx],
      size_value: srs.size_values?.[point_idx],
    }
  }

  const fallback_label_text = (point: DenseInternalPoint<Metadata>): string =>
    String(point.point_id ?? point_label_key(point))

  function point_payload(
    point: DenseInternalPoint<Metadata>,
    color = point_color(point),
  ): BinnedPointPayload<Metadata, PointData> {
    const base_payload = { ...handler_props(point), point, color }
    return { ...base_payload, point_data: point_data?.(base_payload) ?? undefined }
  }

  const label_measure_text = (payload: BinnedPointPayload<Metadata, PointData>): string =>
    point_labels_settings.measure_text?.(payload) ?? fallback_label_text(payload.point)

  const label_size_for_payload = (
    payload: BinnedPointPayload<Metadata, PointData>,
  ): LabelSize =>
    label_sizes.get(point_label_key(payload.point)) ??
    estimate_label_size(label_measure_text(payload), point_labels_settings.font_size)

  let point_label_payloads = $derived.by(() => {
    if (!point_labels_settings.render || render_mode !== `points`) return []

    const [x_min, x_max] = range_bounds(x_range)
    const [y_min, y_max] = range_bounds(y_range)
    const payloads: BinnedPointPayload<Metadata, PointData>[] = []
    for (let series_idx = 0; series_idx < series.length; series_idx++) {
      const srs = series[series_idx]
      const n_points = Math.min(srs.x.length, srs.y.length)
      for (let point_idx = 0; point_idx < n_points; point_idx++) {
        const x = srs.x[point_idx]
        const y = srs.y[point_idx]
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          x < x_min ||
          x > x_max ||
          y < y_min ||
          y > y_max
        )
          continue
        payloads.push(point_payload(make_point(series_idx, point_idx)))
        if (payloads.length > point_labels_settings.max_count) return []
      }
    }
    return payloads
  })

  let point_label_positions = $derived.by(() => {
    if (point_label_payloads.length === 0) return {}

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

    return compute_label_positions(
      label_series,
      actual_label_placement_config,
      { x_scale_fn, y_scale_fn, y2_scale_fn: y_scale_fn, x_axis },
      { width, height, pad },
    )
  })

  async function measure_point_labels() {
    await tick()
    if (!label_measure_root) return

    const active_keys = new SvelteSet<string>()
    const measured_elements =
      label_measure_root.querySelectorAll<HTMLElement>(`[data-label-key]`)
    for (const element of measured_elements) {
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

  function on_pointer_move(event: PointerEvent) {
    const coords = pointer_coords(event)
    if (coords) tooltip_pos = { x: coords.x + 12, y: coords.y + 8 }

    if (!coords) {
      clear_hover()
      return
    }

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
    color = series[point.series_idx]?.color,
  ) {
    on_point_click?.({
      ...point_payload(point, color),
      event,
    })
  }

  function zoom_to_bin(bin: DensityBin, event: MouseEvent) {
    x_range = bin.x_range
    y_range = bin.y_range
    has_user_range = true
    hovered_bin = null
    on_density_zoom?.({ bin, event })
  }

  function on_click(event: MouseEvent) {
    if (suppress_next_click) {
      suppress_next_click = false
      return
    }

    const coords = pointer_coords(event)
    if (!coords) return

    if (render_mode === `density`) {
      const bin = bin_at(coords)
      if (!bin) return
      if (density_settings.bin_click === `none`) return
      if (bin.count > 1 && density_settings.bin_click === `zoom`) {
        zoom_to_bin(bin, event)
        return
      }
      if (bin.count > 1 && density_settings.bin_click !== `point`) return

      const point = first_point_in_bin(series, density_result, bin, x_scale_fn, y_scale_fn)
      if (point) emit_point_click(point, event, color_scale_fn(bin.count))
      return
    }

    const point = pick_at(coords)
    if (!point) return
    emit_point_click(point, event)
  }

  function on_pointer_down(event: PointerEvent) {
    if (event.button !== 0) return
    const coords = pointer_coords(event)
    if (!coords) return
    drag_start = coords
    drag_current = coords
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
  }

  function on_pointer_drag(event: PointerEvent) {
    if (!drag_start) {
      on_pointer_move(event)
      return
    }
    const coords = pointer_coords(event)
    if (coords) drag_current = coords
  }

  function on_pointer_up(event: PointerEvent) {
    const start = drag_start
    const end = drag_current
    drag_start = null
    drag_current = null

    if (start && end && Math.abs(end.x - start.x) > 5 && Math.abs(end.y - start.y) > 5) {
      const x0 = x_scale_fn.invert(start.x)
      const x1 = x_scale_fn.invert(end.x)
      const y0 = y_scale_fn.invert(start.y)
      const y1 = y_scale_fn.invert(end.y)
      x_range = [Math.min(x0, x1), Math.max(x0, x1)]
      y_range = [Math.min(y0, y1), Math.max(y0, y1)]
      has_user_range = true
      suppress_next_click = true
    }

    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.releasePointerCapture?.(event.pointerId)
    }
  }

  onMount(() => {
    if (!wrapper) return
    const observer = new ResizeObserver(([entry]) => {
      width = Math.round(entry.contentRect.width)
      height = Math.round(entry.contentRect.height)
    })
    observer.observe(wrapper)
    return () => observer.disconnect()
  })
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === `Escape` && fullscreen) {
      event.preventDefault()
      fullscreen = false
    }
  }}
/>

<div
  {...rest}
  bind:this={wrapper}
  class={[`binned-scatter`, rest.class]}
  class:fullscreen
  data-render-mode={render_mode}
  style:--binned-scatter-label-font-size={point_labels_settings.font_size}
  onpointermove={on_pointer_drag}
  onpointerdown={on_pointer_down}
  onpointerup={on_pointer_up}
  onmouseleave={clear_hover}
  onclick={on_click}
  ondblclick={reset_view}
>
  {#if width && height}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="header-controls"
      onpointerdown={(event) => event.stopPropagation()}
      onclick={(event) => event.stopPropagation()}
      ondblclick={(event) => event.stopPropagation()}
    >
      {@render header_controls?.({ height, width, fullscreen })}
      {#if has_user_range}
        <button
          type="button"
          class="reset-view"
          aria-label="Reset view"
          title="Reset view"
          onclick={reset_view}
        >
          <Icon icon="Reset" width="18" height="18" />
        </button>
      {/if}
      {#if fullscreen_toggle}
        <FullscreenToggle bind:fullscreen />
      {/if}
    </div>
  {/if}

  <canvas bind:this={canvas}></canvas>

  <svg {width} {height} aria-hidden="true">
    <defs>
      <clipPath id={clip_path_id}>
        <rect x={pad.l} y={pad.t} width={plot_width} height={plot_height} />
      </clipPath>
    </defs>

    <g class="reference-lines" clip-path="url(#{clip_path_id})">
      {#each ref_lines as line}
        <line
          x1={x_scale_fn(line.x1)}
          x2={x_scale_fn(line.x2)}
          y1={y_scale_fn(line.y1)}
          y2={y_scale_fn(line.y2)}
          stroke={line.color ?? `currentColor`}
          stroke-width={line.width ?? 1.5}
          stroke-dasharray={line.dash ?? `5 4`}
        />
      {/each}
    </g>
    <PlotAxis
      side="x"
      ticks={x_ticks}
      place={(tick) => x_scale_fn(tick)}
      axis={x_axis}
      {pad}
      {width}
      {height}
      show_grid
      tick_label={(tick) => format_value(tick, x_axis.format ?? `.2~g`)}
      label_x={pad.l + plot_width / 2}
      label_y={height - 12}
    />
    <PlotAxis
      side="y"
      ticks={y_ticks}
      place={(tick) => y_scale_fn(tick)}
      axis={y_axis}
      {pad}
      {width}
      {height}
      show_grid
      tick_label={(tick) => format_value(tick, y_axis.format ?? `.2~g`)}
      label_x={22}
      label_y={pad.t + plot_height / 2}
    />

    <ZoomRect start={drag_start} current={drag_current} />

    {#if point_label_payloads.length}
      <g class="point-label-leaders" clip-path="url(#{clip_path_id})">
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

    <!-- Marginal distribution strips -->
    <PlotMarginals
      marginals={resolved_marginals}
      series={marginal_series}
      {width}
      {height}
      {pad}
      has_axis={marginal_has_axis}
      axes={{
        x1: marginal_axis(x_scale_fn, x_range, x_axis),
        y1: marginal_axis(y_scale_fn, y_range, y_axis),
      }}
      id={clip_path_id}
    />
  </svg>

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
  {/if}

  {#if point_labels_settings.render && point_label_payloads.length}
    <div class="point-labels">
      {#each point_label_payloads as payload (point_label_key(payload.point))}
        {@const label_position = point_label_positions[point_label_key(payload.point)]}
        {#if label_position}
          <div
            class="point-label"
            style:left={`${label_position.x}px`}
            style:top={`${label_position.y}px`}
          >
            {@render point_labels_settings.render(payload)}
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  {#if color_bar_props && render_mode === `density` && density_result.max_count > 0 && color_bar_placement}
    <div
      bind:this={colorbar_element}
      class="color-bar"
      style:left={`${color_bar_placement.x}px`}
      style:top={`${color_bar_placement.y}px`}
    >
      <ColorBar
        {...color_bar_props}
        {color_scale_fn}
        color_scale_domain={auto_color_range}
        range={auto_color_range}
      />
    </div>
  {/if}

  {#if hovered_bin}
    <PlotTooltip
      x={tooltip_pos.x}
      y={tooltip_pos.y}
      offset={{ x: 0, y: 0 }}
      bg_color={hovered_bin_color}
    >
      {hovered_bin.count.toLocaleString()} samples<br />
      x: {format_value(hovered_bin.x_range[0], x_axis.format ?? `.3~g`)}
      - {format_value(hovered_bin.x_range[1], x_axis.format ?? `.3~g`)}<br />
      y: {format_value(hovered_bin.y_range[0], y_axis.format ?? `.3~g`)}
      - {format_value(hovered_bin.y_range[1], y_axis.format ?? `.3~g`)}
    </PlotTooltip>
  {:else if hovered_point}
    {@const props = point_payload(hovered_point)}
    <PlotTooltip x={tooltip_pos.x} y={tooltip_pos.y} offset={{ x: 0, y: 0 }}>
      {#if tooltip}
        {@render tooltip(props)}
      {:else}
        {x_axis.label ?? `x`}: {props.x_formatted}<br />
        {y_axis.label ?? `y`}: {props.y_formatted}
      {/if}
    </PlotTooltip>
  {/if}

  {@render children?.({ height, width, fullscreen })}
</div>

<style>
  .binned-scatter {
    position: relative;
    min-height: 300px;
    color: var(--text-color, CanvasText);
    touch-action: none;
    user-select: none;
  }
  .binned-scatter :global(.axis-label) {
    color: currentColor;
    font-size: 13px;
    font-weight: 600;
    height: 100%;
    line-height: 24px;
    text-align: center;
    white-space: nowrap;
    width: 100%;
  }
  .binned-scatter.fullscreen {
    background: var(
      --binned-scatter-fullscreen-bg,
      var(--binned-scatter-bg, var(--plot-bg, Canvas))
    );
    border-radius: 0;
    box-sizing: border-box;
    height: 100vh !important;
    left: 0;
    margin: 0;
    max-height: none !important;
    overflow: hidden;
    /* border-top (not padding-top): bind:clientHeight includes padding but excludes
    borders - padding made the chart overflow + clip its bottom 2em (x-axis title) */
    border-top: var(--plot-fullscreen-padding-top, 2em) solid
      var(--binned-scatter-fullscreen-bg, var(--binned-scatter-bg, var(--plot-bg, Canvas)));
    position: fixed;
    top: 0;
    width: 100vw !important;
    z-index: var(--scatter-fullscreen-z-index, var(--z-index-overlay-nav, 100000001));
  }
  .header-controls {
    align-items: center;
    display: flex;
    gap: 8px;
    opacity: 0;
    position: absolute;
    right: var(--fullscreen-btn-right, 4px);
    top: var(--ctrl-btn-top, 5pt);
    transition:
      opacity 0.2s,
      background-color 0.2s;
    z-index: var(--fullscreen-btn-z-index, 10);
  }
  .header-controls :global(.fullscreen-toggle) {
    opacity: 1;
    position: static;
  }
  .reset-view {
    align-items: center;
    background-color: transparent;
    border-radius: var(--fullscreen-btn-border-radius, var(--border-radius, 3pt));
    cursor: pointer;
    display: flex;
    justify-content: center;
    padding: var(--fullscreen-btn-padding, 2pt);
  }
  .reset-view:hover,
  .reset-view:focus {
    background-color: color-mix(in srgb, currentColor 8%, transparent);
  }
  .binned-scatter:hover .header-controls,
  .binned-scatter .header-controls:focus-within {
    opacity: 1;
  }
  canvas,
  svg {
    inset: 0;
    position: absolute;
  }
  canvas {
    background: transparent;
  }
  svg {
    overflow: visible;
    pointer-events: none;
  }
  .reference-lines line {
    opacity: 0.75;
  }
  .point-label-leaders line {
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
  .color-bar {
    pointer-events: auto;
    position: absolute;
  }
</style>
