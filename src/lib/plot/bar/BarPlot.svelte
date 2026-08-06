<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import type { D3InterpolateName } from '$lib/colors'
  import { format_value_or_num } from '$lib/labels'
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
  import type { IndexedRefLine } from '$lib/plot/core/reference-line'
  import {
    BarPlotControls,
    PlotAxis,
    PlotLegend,
    PlotMarginals,
    ScatterPoint,
  } from '$lib/plot'
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
  import { type AxisChangeState, create_axis_loader } from '$lib/plot/core/axis-utils'
  import { create_placed_tween } from '$lib/plot/core/placed-tween.svelte'
  import { create_pan_zoom } from '$lib/plot/core/pan-zoom.svelte'
  import { create_legend_visibility } from '$lib/plot/core/utils/series-visibility'
  import {
    axis_ranges_equal,
    invert_rect_range,
    resolve_axis_ranges,
  } from '$lib/plot/core/interactions'
  import { assign_axes } from '$lib/plot/core/axis-assignment'
  import {
    build_obstacles_norm,
    clip_bar,
    create_legend_decoration_item,
    decoration_placement_rects,
    get_decoration_placement,
    resolve_legend_layout_tracks,
    solve_decorations,
  } from '$lib/plot/core/decorations'
  import {
    group_ref_lines_by_z,
    index_ref_lines,
    solve_reference_annotations,
  } from '$lib/plot/core/reference-line'
  import {
    create_axis_scales,
    create_color_scale,
    create_size_scale,
    generate_ticks,
    get_tick_label,
  } from '$lib/plot/core/scales'
  import { DEFAULT_MARKERS, is_time_scale, SCALE_DEFAULTS } from '$lib/plot/core/types'
  import { DEFAULTS } from '$lib/settings'
  import { extent } from 'd3-array'
  import type { Snippet } from 'svelte'
  import { onDestroy, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import type { TweenOptions } from 'svelte/motion'
  import { has_explicit_position, measured_footprint } from '$lib/plot/core/auto-place'
  import { resolve_plot_display, sync_category_zero_display } from '$lib/plot/core/display'
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
  import PlotTooltip from '$lib/plot/core/components/PlotTooltip.svelte'
  import type { FontSpec } from '$lib/plot/core/text-metrics'
  import { normalize_plot_title, pad_for_plot_title } from '$lib/plot/core/plot-title'
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
    // Clone so controls / categorical sync never mutate shared DEFAULTS.
    display = $bindable({ ...DEFAULTS.bar.display }),
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
    label_shift: { x: 0, y: AXIS_TITLE_OFFSET },
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

  // Assign visible series without an explicit value axis by unit/group. The value axis is
  // y/y2 for vertical bars and x/x2 for horizontal bars. Keep this as an effective copy so
  // legend toggles can reassign axes without mutating bound input series.
  const axis_assigned_series = $derived.by<BarSeries<Metadata>[]>(() => {
    const assignment_inputs = series.map((srs) => ({
      ...srs,
      y_axis:
        orientation === `vertical`
          ? srs.y_axis
          : srs.x_axis === `x1`
            ? (`y1` as const)
            : srs.x_axis === `x2`
              ? (`y2` as const)
              : undefined,
    }))
    const assignment = assign_axes(assignment_inputs)
    if (assignment.status === `overflow`) {
      const axis_prop = orientation === `vertical` ? `y_axis` : `x_axis`
      throw new Error(
        `BarPlot cannot automatically assign visible value series in ${orientation} orientation: ${assignment.error.message}. Set ${axis_prop} explicitly or hide an axis group.`,
        { cause: assignment.error },
      )
    }
    return series.map((srs, series_idx) => {
      if (srs.visible === false) return srs
      const assigned_axis = assignment.assignments[series_idx]
      if (!assigned_axis) return srs
      return orientation === `vertical`
        ? { ...srs, y_axis: assigned_axis }
        : { ...srs, x_axis: assigned_axis === `y1` ? `x1` : `x2` }
    })
  })

  // === Categorical Normalization (string x values -> integer indices, see ./data) ===
  let { category_list, internal_series } = $derived(
    normalize_categorical(axis_assigned_series, x_axis.categories),
  )
  let cat_axis: `x` | `y` = $derived(orientation === `horizontal` ? `y` : `x`)

  // Keep category-axis zeros off (and settings checkboxes in sync) across orientation flips.
  let category_zero_sync: ReturnType<typeof sync_category_zero_display> = {
    axis: null,
    disabled_keys: [],
  }
  $effect.pre(() => {
    category_zero_sync = sync_category_zero_display(
      display,
      DEFAULTS.bar.display,
      category_list.length > 0 ? cat_axis : null,
      category_zero_sync,
    )
  })

  const resolved_display = $derived(
    resolve_plot_display(
      display,
      DEFAULTS.bar.display,
      category_list.length > 0 ? cat_axis : null,
    ),
  )

  let category_indices = $derived(
    category_list.length > 0 ? category_list.map((_, idx) => idx) : null,
  )

  // Keep every category available to the shared adaptive resolver. Its measured, bounded
  // thinning candidate replaces the former fixed 28px/category heuristic.
  let cat_tick_indices = $derived(category_indices ?? [])

  // Compute auto ranges from visible series
  let visible_series = $derived(internal_series.filter((srs) => srs?.visible ?? true))

  // Separate series by the orientation-dependent value axis.
  let y1_series = $derived(
    visible_series.filter((srs) =>
      orientation === `vertical`
        ? (srs.y_axis ?? `y1`) === `y1`
        : (srs.x_axis ?? `x1`) === `x1`,
    ),
  )
  let y2_series = $derived(
    visible_series.filter((srs) =>
      orientation === `vertical` ? srs.y_axis === `y2` : srs.x_axis === `x2`,
    ),
  )
  let x2_series = $derived(visible_series.filter((srs) => srs.x_axis === `x2`))
  // y2 is a vertical value axis; x2 is either a vertical category axis or horizontal value axis.
  let show_x2 = $derived(x2_series.length > 0)
  let show_y2 = $derived(y2_series.length > 0 && orientation === `vertical`)

  let auto_ranges = $derived.by(() => {
    // The shared range helper models x as the category axis. In horizontal orientation,
    // classify all series as x1 for category coverage, then reuse its y2 value range for x2.
    const range_series =
      orientation === `horizontal`
        ? visible_series.map((srs) => ({ ...srs, x_axis: `x1` as const }))
        : visible_series
    const computed = compute_bar_auto_ranges({
      visible_series: range_series,
      y1_series,
      y2_series,
      x2_series,
      mode,
      orientation,
      range_padding,
      category_count: category_list.length,
      x_range:
        orientation === `horizontal`
          ? (y_axis.range ?? [null, null])
          : (x_axis.range ?? [null, null]),
      x_scale_type:
        orientation === `horizontal`
          ? (y_axis.scale_type ?? `linear`)
          : (x_axis.scale_type ?? `linear`),
      x_is_time: is_time_scale(
        orientation === `horizontal` ? y_axis.scale_type : x_axis.scale_type,
      ),
      x2_range: x2_axis.range ?? [null, null],
      x2_scale_type: x2_axis.scale_type ?? `linear`,
      x2_is_time: is_time_scale(x2_axis.scale_type),
      y_range:
        orientation === `horizontal`
          ? (x_axis.range ?? [null, null])
          : (y_axis.range ?? [null, null]),
      y_scale_type:
        orientation === `horizontal`
          ? (x_axis.scale_type ?? `linear`)
          : (y_axis.scale_type ?? `linear`),
      y2_range:
        orientation === `horizontal`
          ? (x2_axis.range ?? [null, null])
          : (y2_axis.range ?? [null, null]),
      y2_scale_type:
        orientation === `horizontal`
          ? (x2_axis.scale_type ?? `linear`)
          : (y2_axis.scale_type ?? `linear`),
    })
    return orientation === `horizontal` ? { ...computed, x2: computed.y2 } : computed
  })

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
  let tick_font = $state<Readonly<FontSpec> | undefined>()
  let base_pad = $derived(filter_padding(padding, DEFAULT_PLOT_PADDING))
  const title_config = $derived(normalize_plot_title(title))

  // Update padding when format or ticks change
  $effect(() => {
    const padding_scales = create_axis_scales(
      { x: x_axis, x2: x2_axis, y: y_axis, y2: y2_axis },
      ranges.current,
      base_pad,
      width,
      height,
    )
    const padding_axis_ticks = (
      axis: typeof x_axis,
      range: Vec2,
      scale: typeof padding_scales.x,
      default_count: number,
      show = true,
    ) =>
      width && height && show
        ? generate_ticks(range, axis.scale_type ?? `linear`, axis.ticks, scale, {
            default_count,
          })
        : []
    const padding_ticks = {
      x:
        category_indices && cat_axis === `x` && width && height
          ? cat_tick_indices
          : padding_axis_ticks(x_axis, ranges.current.x, padding_scales.x, 8),
      y:
        category_indices && cat_axis === `y` && width && height
          ? cat_tick_indices
          : padding_axis_ticks(y_axis, ranges.current.y, padding_scales.y, 6),
      y2: padding_axis_ticks(y2_axis, ranges.current.y2, padding_scales.y2, 6, show_y2),
      x2: padding_axis_ticks(x2_axis, ranges.current.x2, padding_scales.x2, 8, show_x2),
    }
    const x_extent = { start: base_pad.l, end: width - base_pad.r }
    const y_extent = { start: height - base_pad.b, end: base_pad.t }
    const axis_pad =
      width && height
        ? calc_auto_padding({
            padding,
            default_padding: DEFAULT_PLOT_PADDING,
            width,
            height,
            x_axis: measured_axis(
              { ...x_axis, ticks: cat_axis === `x` ? effective_cat_ticks : x_axis.ticks },
              padding_ticks.x,
              padding_scales.x,
              x_extent,
              tick_font,
            ),
            x2_axis: measured_axis(
              x2_axis,
              padding_ticks.x2,
              padding_scales.x2,
              x_extent,
              tick_font,
            ),
            y_axis: measured_axis(
              { ...y_axis, ticks: cat_axis === `y` ? effective_cat_ticks : y_axis.ticks },
              padding_ticks.y,
              padding_scales.y,
              y_extent,
              tick_font,
            ),
            y2_axis: measured_axis(
              y2_axis,
              padding_ticks.y2,
              padding_scales.y2,
              y_extent,
              tick_font,
            ),
          })
        : filter_padding(padding, DEFAULT_PLOT_PADDING)
    const new_pad = pad_for_plot_title(axis_pad, title_config, width, height)

    if (!sides_equal(base_pad, new_pad)) base_pad = new_pad
  })

  let legend_element = $state<HTMLDivElement | undefined>()
  let legend_size_revision = $state(0)
  const legend_footprint = $derived.by(() => {
    void legend_size_revision
    return measured_footprint(legend_element, { width: 120, height: 60 })
  })
  const legend_has_explicit_pos = $derived(has_explicit_position(legend?.style))
  const should_show_legend = $derived(show_legend ?? series.length > 1)

  // Obstacle field in normalized [0,1] plot coords (y=0 at top). Geometry is computed
  // against the decoration-independent base plot so outside padding cannot feed back into
  // the crowding decision. Bars contribute their grouped/stacked screen rectangles and
  // line series contribute sampled polylines.
  const obstacles_norm = $derived.by(() => {
    if (!width || !height || visible_series.length === 0) return []
    const base_w = width - base_pad.l - base_pad.r
    const base_h = height - base_pad.t - base_pad.b
    if (base_w <= 0 || base_h <= 0) return []
    const obstacle_series: {
      points: { x: number; y: number }[]
      draws_line: boolean
    }[] = []
    const vertical = orientation === `vertical`
    const obstacle_scales = create_axis_scales(
      { x: x_axis, x2: x2_axis, y: y_axis, y2: y2_axis },
      ranges.current,
      base_pad,
      width,
      height,
    )
    internal_series.forEach((srs, series_idx) => {
      if (!(srs?.visible ?? true)) return
      const is_line = srs.render_mode === `line`
      const series_offsets = stacked_offsets[series_idx] ?? []
      const x_scale = srs.x_axis === `x2` ? obstacle_scales.x2 : obstacle_scales.x
      const y_scale = srs.y_axis === `y2` ? obstacle_scales.y2 : obstacle_scales.y
      const category_scale = vertical
        ? (value: number) => x_scale(value) - base_pad.l
        : (value: number) => obstacle_scales.y(value) - base_pad.t
      const value_scale = vertical
        ? (value: number) => y_scale(value) - base_pad.t
        : (value: number) => x_scale(value) - base_pad.l

      if (is_line) {
        const line_points = srs.x.map((x_val, point_idx) => {
          const y_val = srs.y[point_idx]
          const x = vertical ? category_scale(x_val) / base_w : value_scale(y_val) / base_w
          const y = vertical ? value_scale(y_val) / base_h : category_scale(x_val) / base_h
          return {
            x: Math.max(0, Math.min(1, x)),
            y: Math.max(0, Math.min(1, y)),
          }
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
        const cross_start = vertical ? rect.rect_x / base_w : rect.rect_y / base_h
        const cross_end = vertical
          ? (rect.rect_x + rect.rect_w) / base_w
          : (rect.rect_y + rect.rect_h) / base_h
        const value_start = vertical ? rect.rect_y / base_h : rect.rect_x / base_w
        const value_end = vertical
          ? (rect.rect_y + rect.rect_h) / base_h
          : (rect.rect_x + rect.rect_w) / base_w
        for (const cross of [cross_start, (cross_start + cross_end) / 2, cross_end]) {
          const segment = clip_bar(vertical, cross, value_start, value_end)
          if (segment) obstacle_series.push(segment)
        }
      })
    })
    return build_obstacles_norm(obstacle_series, base_w, base_h)
  })

  // Resolve marginals before decoration placement so both share one final plot box.
  const marginal_is_vertical = $derived(orientation === `vertical`)
  const resolved_marginals = $derived(
    normalize_marginals(
      marginals,
      marginal_is_vertical ? { top: { type: `cdf` } } : { right: { type: `cdf` } },
    ),
  )
  const legend_item = $derived(
    create_legend_decoration_item({
      enabled:
        legend != null &&
        should_show_legend &&
        legend_element != null &&
        !legend_has_explicit_pos,
      footprint: legend_footprint,
      items: series.map((series_data, series_idx) => ({
        label: series_data.label ?? `Series ${series_idx + 1}`,
        legend_group: series_data.legend_group,
      })),
      config: legend,
    }),
  )
  const base_decoration_solution = $derived(
    solve_decorations({
      base_pad,
      width,
      height,
      obstacles_norm,
      items: legend_item ? [legend_item] : [],
    }),
  )
  const pad = $derived(
    add_sides(base_decoration_solution.pad, reserve_marginal_pad(resolved_marginals)),
  )
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
  const solved_legend = $derived(get_decoration_placement(decoration_solution, `legend`))
  const decoration_exclusion_rects = $derived(decoration_placement_rects(decoration_solution))

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

  // Use the same adaptive y/y2 bands for title placement that padding and PlotAxis render.
  let tick_label_widths = $derived.by(() => {
    const y_extent = { start: height - pad.b, end: pad.t }
    return {
      y_max: resolve_tick_layout(
        measured_axis(
          { ...y_axis, ticks: cat_axis === `y` ? effective_cat_ticks : y_axis.ticks },
          ticks.y,
          scales.y,
          y_extent,
          tick_font,
        ),
        chart_height,
        `y`,
      ).band,
      y2_max: resolve_tick_layout(
        measured_axis(y2_axis, ticks.y2, scales.y2, y_extent, tick_font),
        chart_height,
        `y2`,
      ).band,
    }
  })

  // Shared pan/zoom/touch/drag-rect interaction controller
  const pan_zoom = create_pan_zoom({
    ranges: () => ranges.current,
    scale_type: (axis) =>
      ({ x: x_axis, x2: x2_axis, y: y_axis, y2: y2_axis })[axis].scale_type,
    plot_bounds: () => ({
      x: pad.l,
      y: pad.t,
      width: chart_width,
      height: chart_height,
    }),
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
    (srs) => (orientation === `vertical` ? srs.y_axis : srs.x_axis),
  )

  // Legend placement stability state (legend_element declared above for the auto-place block)
  let hovered_legend_series_idx = $state<number | null>(null)

  // Tweened legend coordinates with shared placement stability gating
  const legend_tween = create_placed_tween({
    placement: () =>
      should_show_legend && solved_legend ? { x: solved_legend.x, y: solved_legend.y } : null,
    dims: () => ({ width, height }),
    responsive: () => legend?.responsive ?? false,
    element: () => legend_element,
    tween: () => legend?.tween,
    on_element_resize: () => (legend_size_revision += 1),
    placement_revision: () => solved_legend?.location,
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

  const clear_hover = () => {
    hover_info = null
    change(null)
    on_bar_hover?.(null)
  }
  const clear_point_hover = () => {
    hover_info = null
    change(null)
    on_point_hover?.(null)
  }

  // Stack offsets (only for bar series in stacked mode, grouped by the value axis)
  let stacked_offsets = $derived(
    compute_stacked_offsets(
      orientation === `vertical`
        ? internal_series
        : internal_series.map((srs) => ({
            ...srs,
            y_axis: srs.x_axis === `x2` ? (`y2` as const) : (`y1` as const),
          })),
      mode,
    ),
  )

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
        (title_config?.text ||
          [x_axis.label, y_axis.label].filter(Boolean).join(` vs `) ||
          `Bar chart`)}
      tabindex="0"
      onfocusin={() => pan_zoom.set_focused(true)}
      onfocusout={() => pan_zoom.set_focused(false)}
      onmousedown={pan_zoom.on_mouse_down}
      ondblclick={pan_zoom.reset_view}
      onkeydown={pan_zoom.on_key_down}
      onmouseleave={() => {
        hovered = false
        clear_hover()
      }}
      onwheel={pan_zoom.on_wheel}
      ontouchstart={pan_zoom.on_touch_start}
      ontouchmove={pan_zoom.on_touch_move}
      ontouchend={pan_zoom.on_touch_end}
      ontouchcancel={pan_zoom.on_touch_end}
      style:cursor={pan_zoom.cursor}
    >
      <PlotTitle
        config={title_config}
        x={base_pad.l}
        y={decoration_solution.pad.t - base_pad.t}
        width={Math.max(0, width - base_pad.l - base_pad.r)}
      />
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
        on_tick_font={(font) => (tick_font = font)}
        domain={ranges.current.x}
        {pad}
        {width}
        {height}
        show_grid={resolved_display.x_grid}
        tick_label={(tick) =>
          get_tick_label(tick, cat_axis === `x` ? effective_cat_ticks : x_axis.ticks)}
        label_x={pad.l + chart_width / 2 + (x_axis.label_shift?.x ?? 0)}
        label_y={height - pad.b + AXIS_TITLE_OFFSET + (x_axis.label_shift?.y ?? 0)}
        axis_loading={axis_loading === `x`}
        on_axis_change={(key) => handle_axis_change(`x`, key)}
      />

      <!-- X2-axis (Top): category axis when vertical, value axis when horizontal -->
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
          show_grid={resolved_display.x2_grid}
          tick_label={(tick) => get_tick_label(tick, x2_axis.ticks)}
          label_x={pad.l + chart_width / 2 + (x2_axis.label_shift?.x ?? 0)}
          label_y={Math.max(12, pad.t - (x2_axis.label_shift?.y ?? AXIS_TITLE_OFFSET))}
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
        show_grid={resolved_display.y_grid}
        tick_label={(tick) =>
          get_tick_label(tick, cat_axis === `y` ? effective_cat_ticks : y_axis.ticks)}
        label_x={y_axis_label_x(y_axis, pad.l, tick_label_widths.y_max)}
        label_y={pad.t + chart_height / 2 + (y_axis.label_shift?.y ?? 0)}
        axis_loading={axis_loading === `y`}
        on_axis_change={(key) => handle_axis_change(`y`, key)}
      />

      <!-- Y2-axis (Right): only rendered in vertical orientation -->
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
          show_grid={resolved_display.y2_grid}
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
          display={resolved_display}
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
          x_is_time={is_time_scale(x_axis.scale_type)}
          x2_is_time={is_time_scale(x2_axis.scale_type)}
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
                {@const set_hover = (
                  pt: LineSeriesPoint | null,
                  evt: MouseEvent | FocusEvent,
                ) => {
                  if (!pt) return clear_point_hover()
                  hovered = true
                  const fill = line_point_fill(pt, color)
                  hover_info = get_bar_data(series_idx, pt.idx, fill)
                  change(hover_info)
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
                  />
                {/if}
                {#if polyline_str && !show_points && (on_point_hover || on_point_click)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <polyline
                    points={polyline_str}
                    fill="none"
                    stroke="transparent"
                    stroke-width={Math.max(10, stroke_width * 3)}
                    stroke-linejoin="round"
                    stroke-linecap="round"
                    style:cursor={on_point_click ? `pointer` : undefined}
                    onmousemove={(evt) => {
                      const pt = find_closest_point(evt, points)
                      if (pt) set_hover(pt, evt)
                    }}
                    onmouseleave={clear_point_hover}
                    onclick={(evt) => {
                      const pt = find_closest_point(evt, points)
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
                    return points.find((pt) => pt.idx === parseInt(attr ?? ``, 10))
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
                        is_vertical ? v1 > v0 : v1 < v0,
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
                      onmouseleave={clear_hover}
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
    {#if legend && should_show_legend}
      {@const solved_legend_pos = solved_legend ?? { x: pad.l + 10, y: pad.t + 10 }}
      {@const legend_pos =
        solved_legend?.location === `outside`
          ? solved_legend_pos
          : legend_tween.placed()
            ? legend_tween.coords.current
            : solved_legend_pos}
      <PlotLegend
        bind:root_element={legend_element}
        {...legend}
        layout_tracks={resolve_legend_layout_tracks(legend.layout_tracks, solved_legend)}
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
          ${legend_has_explicit_pos ? `` : `left: ${legend_pos.x}px; top: ${legend_pos.y}px;`}
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
        exclusion_rects={decoration_exclusion_rects}
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
    border-radius: var(--barplot-border-radius, 0);
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
