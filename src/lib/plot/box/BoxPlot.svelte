<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import { format_value_or_num } from '$lib/labels'
  import type { Vec2 } from '$lib/math'
  import type {
    BandwidthOption,
    BasePlotProps,
    BoxHandlerProps,
    BoxPlotSeries,
    LegendConfig,
    Orientation,
    PanConfig,
    PlotConfig,
    RefLine,
    RefLineEvent,
    ScaleType,
    UserContentProps,
    ViolinKind,
    ViolinSide,
    WhiskerMode,
  } from '$lib/plot'
  import { BoxPlotControls } from '$lib/plot'
  import CartesianFrame from '$lib/plot/core/components/CartesianFrame.svelte'
  import PlotAxes from '$lib/plot/core/components/PlotAxes.svelte'
  import PlotLegendLayer from '$lib/plot/core/components/PlotLegendLayer.svelte'
  import ReferenceLinesLayer from '$lib/plot/core/components/ReferenceLinesLayer.svelte'
  import type { MarginalSeriesInput, MarginalsProp } from '$lib/plot/core/marginals'
  import { normalize_marginals } from '$lib/plot/core/marginals'
  import { build_obstacles_norm, clip_bar } from '$lib/plot/core/decorations'
  import { build_legend_items } from '$lib/plot/core/data-transform'
  import { compute_box_stats } from '$lib/plot/box/box-plot'
  import { gaussian_kde, type KdeResult } from '$lib/plot/box/kde'
  import { create_cartesian_frame } from '$lib/plot/core/cartesian-frame.svelte'
  import type { FacetLayoutContext } from '$lib/plot/core/facets'
  import {
    create_legend_visibility,
    resolve_legend_visibility,
  } from '$lib/plot/core/utils/series-visibility'
  import { DEFAULT_PLOT_PADDING, filter_padding } from '$lib/plot/core/layout'
  import { LOG_EPS } from '$lib/math'
  import type { IndexedRefLine } from '$lib/plot/core/reference-line'
  import { group_ref_lines_by_z, index_ref_lines } from '$lib/plot/core/reference-line'
  import { get_nice_data_range } from '$lib/plot/core/scales'
  import { DEFAULT_SERIES_COLORS } from '$lib/plot/core/types'
  import { resolve_plot_display, sync_category_zero_display } from '$lib/plot/core/display'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap } from 'svelte/reactivity'
  import PlotTooltip from '$lib/plot/core/components/PlotTooltip.svelte'
  import { violin_path } from '$lib/plot/core/svg'
  import ZeroLines from '$lib/plot/core/components/ZeroLines.svelte'

  // Box style props
  interface BoxStyle {
    color?: string
    opacity?: number
    stroke_width?: number
    stroke_color?: string
    border_radius?: number
  }
  interface WhiskerStyle {
    width?: number
    color?: string
    cap_fraction?: number
  }
  interface BoxLineStyle {
    width?: number
    color?: string
  }
  interface OutlierStyle {
    radius?: number
    opacity?: number
    stroke_width?: number
  }
  interface ViolinStyle {
    opacity?: number
    stroke_width?: number
  }

  // Hover state carries the box payload plus the pixel anchor for the tooltip
  type BoxHover = BoxHandlerProps<Metadata> & { cx: number; cy: number }

  let {
    series = $bindable([]),
    orientation = $bindable(`vertical`),
    x_axis = $bindable({}),
    x2_axis: x2_axis_prop = $bindable({}),
    y_axis = $bindable({}),
    y2_axis: y2_axis_prop = $bindable({}),
    // Clone so controls / categorical sync never mutate shared DEFAULTS.
    display = $bindable({ ...DEFAULTS.box.display }),
    range_padding = 0,
    padding = {},
    title,
    legend = {},
    show_legend,
    box = {},
    whisker = {},
    median_style = {},
    outlier_style = {},
    whisker_mode = $bindable(DEFAULTS.box.whisker_mode),
    whisker_range = 1.5,
    whisker_percentiles = [5, 95],
    show_outliers = $bindable(DEFAULTS.box.show_outliers),
    show_mean = $bindable(DEFAULTS.box.show_mean),
    show_value_labels = false,
    value_label_stat = `median`,
    value_label_format = ``,
    kind = $bindable(DEFAULTS.box.kind),
    side = $bindable(DEFAULTS.box.side),
    bandwidth = DEFAULTS.box.bandwidth,
    violin_width = DEFAULTS.box.violin_width,
    violin_style = {},
    kde_points = 100,
    kde_cut = 2,
    kde_max_samples = 5000,
    kde_clip = undefined,
    tooltip,
    user_content,
    hovered = $bindable(false),
    change = () => {},
    on_box_click,
    on_box_hover,
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
    pan = {},
    marginals = false,
    facet_layout,
    ...rest
  }: Omit<HTMLAttributes<HTMLDivElement>, `title`> &
    BasePlotProps &
    PlotConfig & {
      series?: BoxPlotSeries<Metadata>[]
      orientation?: Orientation
      legend?: LegendConfig | null
      show_legend?: boolean
      box?: BoxStyle
      whisker?: WhiskerStyle
      median_style?: BoxLineStyle
      outlier_style?: OutlierStyle
      whisker_mode?: WhiskerMode
      whisker_range?: number
      whisker_percentiles?: Vec2
      show_outliers?: boolean
      show_mean?: boolean
      show_value_labels?: boolean
      value_label_stat?: `median` | `mean`
      value_label_format?: string
      kind?: ViolinKind
      side?: ViolinSide
      bandwidth?: BandwidthOption
      violin_width?: number
      violin_style?: ViolinStyle
      kde_points?: number
      kde_cut?: number
      kde_max_samples?: number
      kde_clip?: [number | null, number | null]
      tooltip?: Snippet<[BoxHandlerProps<Metadata>]>
      user_content?: Snippet<[UserContentProps]>
      header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
      controls_extra?: Snippet<[{ orientation: Orientation } & Required<PlotConfig>]>
      change?: (data: BoxHandlerProps<Metadata> | null) => void
      on_box_click?: (
        data: BoxHandlerProps<Metadata> & { event: MouseEvent | KeyboardEvent },
      ) => void
      on_box_hover?: (
        data:
          | (BoxHandlerProps<Metadata> & { event: MouseEvent | FocusEvent | KeyboardEvent })
          | null,
      ) => void
      ref_lines?: RefLine[]
      on_ref_line_click?: (event: RefLineEvent) => void
      on_ref_line_hover?: (event: RefLineEvent | null) => void
      pan?: PanConfig
      marginals?: MarginalsProp
      facet_layout?: FacetLayoutContext
    } = $props()

  let box_state = $derived({ ...DEFAULTS.box.box, ...box })
  let whisker_state = $derived({ ...DEFAULTS.box.whisker, ...whisker })
  let median_state = $derived({ ...DEFAULTS.box.median, ...median_style })
  let outlier_state = $derived({ ...DEFAULTS.box.outlier, ...outlier_style })
  let violin_state = $derived({ ...DEFAULTS.box.violin, ...violin_style })

  // Merge secondary-axis defaults as deriveds instead of assigning back into the
  // $bindable props (which would push library defaults into the parent's bound state)
  let y2_axis = $derived({
    format: ``,
    scale_type: `linear`,
    ticks: 5,
    range: [null, null],
    ...y2_axis_prop,
  } as typeof y2_axis_prop)
  let x2_axis = $derived({
    format: ``,
    scale_type: `linear`,
    ticks: 5,
    range: [null, null],
    ...x2_axis_prop,
  } as typeof x2_axis_prop)

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
    legend_items: () =>
      series.map((series_data, series_idx) => ({
        label: series_data.label ?? `Box ${series_idx + 1}`,
        legend_group: series_data.legend_group,
      })),
    marginals: () => resolved_marginals,
    ref_lines: () => indexed_ref_lines,
    pan: () => pan,
    facet_layout: () => facet_layout,
    // Categorical axes plot one tick per slot and label it with the category name
    tick_override: (axis) => (axis === cat_axis ? slot_indices : undefined),
    measured_axes: () => ({
      [cat_axis]: { ...plot_axes[cat_axis], ticks: effective_cat_ticks },
    }),
    // Secondary axes write the raw $bindable props so library defaults aren't pushed
    // into the parent's bound state
    write_range: (axis, range) => {
      if (axis === `x`) x_axis = { ...x_axis, range }
      else if (axis === `x2`) x2_axis_prop = { ...x2_axis_prop, range }
      else if (axis === `y`) y_axis = { ...y_axis, range }
      else y2_axis_prop = { ...y2_axis_prop, range }
    },
    clip_id_prefix: `box-clip`,
  })

  let hovered_ref_line_idx = $state<number | null>(null)

  let indexed_ref_lines = $derived(index_ref_lines(ref_lines))
  let ref_lines_by_z = $derived(group_ref_lines_by_z(indexed_ref_lines))

  // === Box stats + slot model ===
  const box_color = (idx: number): string =>
    series[idx]?.color ?? DEFAULT_SERIES_COLORS[idx % DEFAULT_SERIES_COLORS.length]

  // Which glyph(s) a series draws (per-series kind overrides the component default)
  const effective_kind = (srs: BoxPlotSeries<Metadata>): ViolinKind => srs.kind ?? kind
  const draws_violin = (srs: BoxPlotSeries<Metadata>): boolean => effective_kind(srs) !== `box`
  const draws_box = (srs: BoxPlotSeries<Metadata>): boolean => effective_kind(srs) !== `violin`

  let box_stats = $derived(
    series.map((srs) =>
      compute_box_stats(srs.y ?? [], {
        whisker_mode: srs.whisker_mode ?? whisker_mode,
        whisker_range: srs.whisker_range ?? whisker_range,
        whisker_percentiles: srs.whisker_percentiles ?? whisker_percentiles,
        collect_outliers: show_outliers && draws_box(srs) && (srs.visible ?? true),
      }),
    ),
  )

  // Slots position boxes/violins along the category axis. Series sharing a `category` occupy
  // one slot (split/grouped violins). Without `category`, each series gets its own slot —
  // byte-identical to the original one-box-per-series behavior. Override tick labels via
  // x_axis.ticks (a Record).
  let use_categories = $derived(series.some((srs) => srs.category != null))
  const slot_key = (srs: BoxPlotSeries<Metadata>, idx: number): string =>
    srs.category ?? `${idx}`
  let slot_list = $derived(
    use_categories
      ? [...new Set(series.map(slot_key))]
      : series.map((srs, idx) => srs.label ?? `${idx}`),
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
      DEFAULTS.box.display,
      slot_list.length > 0 ? cat_axis : null,
      category_zero_sync,
    )
  })

  const resolved_display = $derived(
    resolve_plot_display(
      display,
      DEFAULTS.box.display,
      slot_list.length > 0 ? cat_axis : null,
    ),
  )

  let slot_lookup = $derived(new SvelteMap(slot_list.map((slot, idx) => [slot, idx])))
  const slot_of = (idx: number): number =>
    use_categories ? (slot_lookup.get(slot_key(series[idx], idx)) ?? idx) : idx
  let slot_indices = $derived(slot_list.map((_, idx) => idx))
  // A slot's tick label is colored only when a single series occupies it. Precompute
  // slot -> color in one pass so the PlotAxis tick_color callback stays O(1) per tick.
  let slot_colors = $derived.by(() => {
    const colors = new SvelteMap<number, string | undefined>()
    for (const [idx] of series.entries()) {
      const slot = slot_of(idx)
      colors.set(slot, colors.has(slot) ? undefined : box_color(idx))
    }
    return colors
  })

  type Box = {
    series: BoxPlotSeries<Metadata>
    idx: number
    slot: number
    stats: (typeof box_stats)[number]
  }
  let visible_boxes = $derived<Box[]>(
    series
      .map((srs, idx) => ({ series: srs, idx, slot: slot_of(idx), stats: box_stats[idx] }))
      .filter((box_item) => box_item.series.visible ?? true),
  )

  type ViolinKde = KdeResult & { max_density: number }
  // KDE per visible violin series, keyed by series index (bandwidth from the full sample)
  let violin_kdes = $derived.by(() => {
    const map = new SvelteMap<number, ViolinKde>()
    const [val_axis, val_axis2] =
      orientation === `vertical` ? [y_axis, y2_axis] : [x_axis, x2_axis]
    for (const box_item of visible_boxes) {
      if (!draws_violin(box_item.series)) continue
      const samples = box_item.series.y ?? []
      let clip = box_item.series.clip ?? kde_clip
      // On a log value axis the KDE grid tail (data_min - cut*bandwidth) is usually <= 0 →
      // NaN pixels + LOG_EPS range pollution. Clamp the grid to the smallest positive sample.
      if ((is_secondary(box_item.series) ? val_axis2 : val_axis).scale_type === `log`) {
        const min_pos = samples.reduce(
          (min, val) => (val > 0 && val < min ? val : min),
          Infinity,
        )
        // Guard: no positive samples → min_pos is Infinity; leave clip unchanged so the KDE
        // never receives a non-finite lower bound
        if (Number.isFinite(min_pos)) {
          clip = [Math.max(clip?.[0] ?? -Infinity, min_pos), clip?.[1] ?? null]
        }
      }
      const kde = gaussian_kde(samples, {
        bandwidth: box_item.series.bandwidth ?? bandwidth,
        n_points: kde_points,
        cut: kde_cut,
        clip,
        max_samples: kde_max_samples,
      })
      let max_density = 0
      for (const density of kde.density) {
        if (density > max_density) max_density = density
      }
      map.set(box_item.idx, { ...kde, max_density })
    }
    return map
  })

  // The horizontal category pixel axis is inverted, so flip the half-violin side to keep
  // `positive` meaning "above the center line" (vertical/`both` pass through unchanged)
  const to_screen_side = (eff_side: ViolinSide, vertical: boolean): ViolinSide =>
    vertical || eff_side === `both`
      ? eff_side
      : eff_side === `positive`
        ? `negative`
        : `positive`

  // Which boxes live on the secondary value axis (y2 for vertical, x2 for horizontal)
  const is_secondary = (srs: BoxPlotSeries<Metadata>): boolean =>
    orientation === `vertical` ? srs.y_axis === `y2` : srs.x_axis === `x2`
  let secondary_boxes = $derived(
    visible_boxes.filter((box_item) => is_secondary(box_item.series)),
  )
  let has_secondary = $derived(
    secondary_boxes.some(({ stats }) => Number.isFinite(stats.median)),
  )
  // The secondary value axis renders transposed by orientation: x2 (top) when horizontal, y2
  // (right) when vertical. Derive once so axis rendering, ticks, range writes, point picking, and
  // marginal placement all stay provably in sync.
  let show_x2 = $derived(has_secondary && orientation === `horizontal`)
  let show_y2 = $derived(has_secondary && orientation === `vertical`)

  // Collect value-axis points (whiskers, quartiles, outliers, KDE tails) for auto-range
  const value_points = (boxes: Box[]): { x: number; y: number }[] =>
    boxes.flatMap((box_item) => {
      const { whisker_low, whisker_high, q1, q3, median, mean, outliers } = box_item.stats
      const vals = [whisker_low, whisker_high, q1, q3, median]
      // keep the drawn mean line in range even when hidden outliers drag it past the whiskers
      if (show_mean) vals.push(mean)
      // outliers are sorted ascending; auto-range only needs their extremes (avoids
      // spreading a potentially huge array as call args)
      if (show_outliers && outliers.length > 0) {
        vals.push(outliers[0], outliers[outliers.length - 1])
      }
      const kde = violin_kdes.get(box_item.idx)
      if (kde && kde.grid.length > 0) vals.push(kde.grid[0], kde.grid[kde.grid.length - 1])
      return vals.filter(Number.isFinite).map((val) => ({ x: 0, y: val }))
    })

  let auto_ranges = $derived.by(() => {
    const cat_count = slot_list.length
    const cat_range: Vec2 = cat_count > 0 ? [-0.5, cat_count - 0.5] : [0, 1]
    const vertical = orientation === `vertical`
    const initial_pad = filter_padding(padding, DEFAULT_PLOT_PADDING)
    const value_axis_pixels = vertical
      ? frame.height - initial_pad.t - initial_pad.b
      : frame.width - initial_pad.l - initial_pad.r
    const outlier_extent = outlier_state.radius + outlier_state.stroke_width / 2
    const outlier_range_padding =
      value_axis_pixels > 2 * outlier_extent
        ? outlier_extent / (value_axis_pixels - 2 * outlier_extent)
        : 0.05
    const primary_boxes = visible_boxes.filter((box_item) => !is_secondary(box_item.series))
    const calc_value_range = (
      boxes: Box[],
      limit: [number | null, number | null],
      scale_type: ScaleType,
    ): Vec2 => {
      const pts = value_points(boxes)
      if (pts.length === 0) return [0, 1]
      const has_outliers =
        show_outliers && boxes.some((box_item) => box_item.stats.outliers.length > 0)
      return get_nice_data_range(
        pts,
        (point) => point.y,
        limit,
        scale_type,
        has_outliers ? Math.max(range_padding, outlier_range_padding) : range_padding,
        false,
      )
    }
    const value_primary = calc_value_range(
      primary_boxes,
      (vertical ? y_axis.range : x_axis.range) ?? [null, null],
      (vertical ? y_axis.scale_type : x_axis.scale_type) ?? `linear`,
    )
    const value_secondary = calc_value_range(
      secondary_boxes,
      (vertical ? y2_axis.range : x2_axis.range) ?? [null, null],
      (vertical ? y2_axis.scale_type : x2_axis.scale_type) ?? `linear`,
    )

    return vertical
      ? { x: cat_range, x2: [0, 1] as Vec2, y: value_primary, y2: value_secondary }
      : { x: value_primary, x2: value_secondary, y: cat_range, y2: [0, 1] as Vec2 }
  })

  // Obstacle field in normalized [0,1] coords: each box modeled as a whisker-spanning segment
  const obstacles_norm = $derived.by(() => {
    const { width, height, effective_base_pad, ranges } = frame
    if (!width || !height || visible_boxes.length === 0) return []
    const base_w = width - effective_base_pad.l - effective_base_pad.r
    const base_h = height - effective_base_pad.t - effective_base_pad.b
    if (base_w <= 0 || base_h <= 0) return []
    const vertical = orientation === `vertical`
    const segs: { points: { x: number; y: number }[]; draws_line: boolean }[] = []
    for (const box_item of visible_boxes) {
      const { whisker_low, whisker_high, median } = box_item.stats
      if (!Number.isFinite(median)) continue
      const secondary = is_secondary(box_item.series)
      const cat_rng = vertical ? ranges.current.x : ranges.current.y
      const val_rng = vertical
        ? secondary
          ? ranges.current.y2
          : ranges.current.y
        : secondary
          ? ranges.current.x2
          : ranges.current.x
      const cat_span = cat_rng[1] - cat_rng[0]
      const val_span = val_rng[1] - val_rng[0]
      if (cat_span === 0 || val_span === 0) continue
      const cross = (box_item.slot - cat_rng[0]) / cat_span
      const lo = (whisker_low - val_rng[0]) / val_span
      const hi = (whisker_high - val_rng[0]) / val_span
      const seg = vertical
        ? clip_bar(true, cross, 1 - hi, 1 - lo)
        : clip_bar(false, 1 - cross, lo, hi)
      if (seg) segs.push(seg)
    }
    return build_obstacles_norm(segs, base_w, base_h)
  })

  const should_show_legend = $derived(
    resolve_legend_visibility(show_legend, legend, series.length),
  )
  // Marginals are opt-in and bind to the value axis.
  const marginal_vertical = $derived(orientation === `vertical`)
  const resolved_marginals = $derived(
    normalize_marginals(marginals, marginal_vertical ? { right: true } : { top: true }),
  )
  const marginal_series = $derived<MarginalSeriesInput[]>(
    visible_boxes.map((box_item) => {
      const secondary = is_secondary(box_item.series)
      return {
        x: marginal_vertical ? undefined : (box_item.series.y ?? []),
        y: marginal_vertical ? (box_item.series.y ?? []) : undefined,
        color: box_color(box_item.idx),
        label: box_item.series.label,
        visible: true,
        x_axis: marginal_vertical ? `x1` : secondary ? `x2` : `x1`,
        y_axis: marginal_vertical ? (secondary ? `y2` : `y1`) : `y1`,
      }
    }),
  )
  // Value scale for a box (vertical -> y/y2, horizontal -> x/x2), made log-safe: on a
  // log value axis, stats at values <= 0 (whisker_low is often exactly 0; negative
  // outliers) have no finite pixel. Clamp to LOG_EPS so whiskers/boxes/labels draw
  // toward the plot edge (the clip group crops the overshoot) instead of NaN coords.
  const box_val_scale = (srs: BoxPlotSeries<Metadata>): ((val: number) => number) => {
    const vertical = orientation === `vertical`
    const secondary = is_secondary(srs)
    const scale = vertical
      ? secondary
        ? frame.scales.y2
        : frame.scales.y
      : secondary
        ? frame.scales.x2
        : frame.scales.x
    const axis = vertical ? (secondary ? y2_axis : y_axis) : secondary ? x2_axis : x_axis
    return axis.scale_type === `log` ? (val) => scale(Math.max(val, LOG_EPS)) : scale
  }

  // Categorical tick labels (slot index -> category name) unless user provides a label mapping
  let effective_cat_ticks = $derived.by(() => {
    if (slot_list.length === 0) return undefined
    const user_ticks = cat_axis === `x` ? x_axis.ticks : y_axis.ticks
    if (user_ticks != null && typeof user_ticks === `object` && !Array.isArray(user_ticks)) {
      return user_ticks
    }
    return Object.fromEntries(slot_list.map((cat, idx) => [idx, cat]))
  })

  // === Legend ===
  let legend_data = $derived(
    build_legend_items(
      series,
      (_srs, idx) => ({ symbol_type: `Square` as const, symbol_color: box_color(idx) }),
      { default_label: (idx) => `Box ${idx + 1}` },
    ),
  )

  const legend_vis = create_legend_visibility(
    () => series,
    (next) => (series = next),
  )

  // === Tooltip / hover ===
  let hover_info = $state<BoxHover | null>(null)

  function get_box_data(box_item: Box, color: string): BoxHover {
    const vertical = orientation === `vertical`
    const val_scale = box_val_scale(box_item.series)
    const cat_scale = vertical ? frame.scales.x : frame.scales.y
    const cc = cat_scale(box_item.slot)
    const v_hi = val_scale(box_item.stats.whisker_high)
    const v_lo = val_scale(box_item.stats.whisker_low)
    const [cx, cy] = vertical ? [cc, Math.min(v_hi, v_lo)] : [Math.max(v_hi, v_lo), cc]
    const active_y_axis = (vertical ? (box_item.series.y_axis ?? `y1`) : `y1`) as `y1` | `y2`
    const active_x_axis = (vertical ? `x1` : (box_item.series.x_axis ?? `x1`)) as `x1` | `x2`
    return {
      x: vertical ? box_item.slot : box_item.stats.median,
      y: vertical ? box_item.stats.median : box_item.slot,
      stats: box_item.stats,
      color,
      label: box_item.series.label ?? null,
      category_label: slot_list[box_item.slot],
      metadata: box_item.series.metadata,
      series_idx: box_item.idx,
      box_idx: box_item.idx,
      active_x_axis,
      active_y_axis,
      x_axis: active_x_axis === `x2` ? x2_axis : x_axis,
      x2_axis,
      y_axis: active_y_axis === `y2` ? y2_axis : y_axis,
      y2_axis,
      cx,
      cy,
    }
  }

  const handle_box_hover = (box_item: Box, color: string) => (event: MouseEvent) => {
    hovered = true
    const data = get_box_data(box_item, color)
    // Anchor the tooltip at the cursor (cx/cy default to the box center) so it follows the
    // mouse — boxes/violins are wide, and a center anchor lands far from the pointer.
    const rect = frame.svg_element?.getBoundingClientRect()
    if (rect) {
      data.cx = event.clientX - rect.left
      data.cy = event.clientY - rect.top
    }
    hover_info = data
    change(hover_info)
    on_box_hover?.({ ...hover_info, event })
  }

  const clear_hover = () => {
    hover_info = null
    change(null)
    on_box_hover?.(null)
  }

  // Value label helper
  const value_label_for = (stats: Box[`stats`]): string =>
    format_value_or_num(
      value_label_stat === `mean` ? stats.mean : stats.median,
      value_label_format,
    )
</script>

{#snippet seg(p1: Vec2, p2: Vec2, stroke: string, sw: number, dash?: string)}
  <line
    x1={p1[0]}
    y1={p1[1]}
    x2={p2[0]}
    y2={p2[1]}
    {stroke}
    stroke-width={sw}
    stroke-dasharray={dash}
  />
{/snippet}

{#snippet ref_lines_layer(lines: readonly IndexedRefLine[])}
  <ReferenceLinesLayer
    {lines}
    ranges={frame.ranges.current}
    scales={frame.scales}
    clip_path_id={frame.clip_path_id}
    decoration_solution={frame.decoration_solution}
    bind:hovered_line_idx={hovered_ref_line_idx}
    on_click={on_ref_line_click}
    on_hover={on_ref_line_hover}
  />
{/snippet}

<CartesianFrame
  {frame}
  plot_class="box-plot"
  css_prefix="boxplot"
  css_var_fallbacks={{
    'font-weight': `var(--scatter-font-weight)`,
    'font-size': `var(--scatter-font-size)`,
  }}
  aria_label={frame.title_config?.text ||
    [x_axis.label, y_axis.label].filter(Boolean).join(` vs `) ||
    `Box plot`}
  bind:fullscreen
  {fullscreen_toggle}
  marginals={resolved_marginals}
  {marginal_series}
  on_mouse_leave={() => {
    hovered = false
    clear_hover()
  }}
  {header_controls}
  {children}
  {...rest}
>
  {#snippet layers()}
    {@const pad = frame.pad}
    {@render user_content?.({
      height: frame.height,
      width: frame.width,
      x_scale_fn: frame.scales.x,
      x2_scale_fn: frame.scales.x2,
      y_scale_fn: frame.scales.y,
      y2_scale_fn: frame.scales.y2,
      pad,
      x_range: frame.ranges.current.x,
      x2_range: frame.ranges.current.x2,
      y_range: frame.ranges.current.y,
      y2_range: frame.ranges.current.y2,
      fullscreen,
    })}

    {@render ref_lines_layer(ref_lines_by_z.below_grid)}

    <PlotAxes
      {frame}
      display={resolved_display}
      label_ticks={{ [cat_axis]: effective_cat_ticks }}
      tick_color={{ [cat_axis]: (tick: number) => slot_colors.get(tick) }}
    />

    <!-- Chart content is clipped in two groups so reference lines can interleave
         at their z positions while staying outside the chart clip: each line still
         self-clips to the plot area inside ReferenceLine, only its annotation text
         is allowed to overflow the plot edges. -->
    <g clip-path="url(#{frame.clip_path_id})">
      <ZeroLines
        display={resolved_display}
        x_scale_fn={frame.scales.x}
        x2_scale_fn={frame.scales.x2}
        y_scale_fn={frame.scales.y}
        y2_scale_fn={frame.scales.y2}
        x_range={frame.ranges.current.x}
        x2_range={frame.ranges.current.x2}
        y_range={frame.ranges.current.y}
        y2_range={frame.ranges.current.y2}
        x_scale_type={x_axis.scale_type}
        x2_scale_type={x2_axis.scale_type}
        y_scale_type={y_axis.scale_type}
        y2_scale_type={y2_axis.scale_type}
        has_x2={show_x2}
        has_y2={show_y2}
        width={frame.width}
        height={frame.height}
        {pad}
      />
    </g>

    {@render ref_lines_layer(ref_lines_by_z.below_lines)}

    <!-- Boxes -->
    <g clip-path="url(#{frame.clip_path_id})">
      {#each visible_boxes as box_item (box_item.series.id ?? box_item.idx)}
        {@const stats = box_item.stats}
        {#if Number.isFinite(stats.median)}
          {@const vertical = orientation === `vertical`}
          {@const cat_scale = vertical ? frame.scales.x : frame.scales.y}
          {@const val_scale = box_val_scale(box_item.series)}
          {@const color = box_color(box_item.idx)}
          {@const draw_box = draws_box(box_item.series)}
          {@const kde = violin_kdes.get(box_item.idx)}
          {@const eff_side = box_item.series.side ?? side}
          {@const bw =
            box_item.series.box_width ??
            (kde ? DEFAULTS.box.violin_box_width : DEFAULTS.box.box_width)}
          {@const c_lo = cat_scale(box_item.slot - bw / 2)}
          {@const c_hi = cat_scale(box_item.slot + bw / 2)}
          {@const c_center = cat_scale(box_item.slot)}
          {@const cap = (Math.abs(c_hi - c_lo) * (whisker_state.cap_fraction ?? 0.5)) / 2}
          {@const cap_lo = c_center - cap}
          {@const cap_hi = c_center + cap}
          {@const v_q1 = val_scale(stats.q1)}
          {@const v_q3 = val_scale(stats.q3)}
          {@const v_med = val_scale(stats.median)}
          {@const v_wl = val_scale(stats.whisker_low)}
          {@const v_wh = val_scale(stats.whisker_high)}
          {@const v_mean = val_scale(stats.mean)}
          {@const pt = (cross: number, val: number): Vec2 =>
            vertical ? [cross, val] : [val, cross]}
          {@const [q1x, q1y] = pt(c_lo, v_q1)}
          {@const [q3x, q3y] = pt(c_hi, v_q3)}
          {@const [wlx, wly] = pt(c_lo, v_wl)}
          {@const [whx, why] = pt(c_hi, v_wh)}
          {@const box_x = Math.min(q1x, q3x)}
          {@const box_y = Math.min(q1y, q3y)}
          {@const box_w = Math.abs(q3x - q1x)}
          {@const box_h = Math.abs(q3y - q1y)}
          {@const hit_x = Math.min(wlx, whx)}
          {@const hit_y = Math.min(wly, why)}
          {@const hit_w = Math.abs(whx - wlx)}
          {@const hit_h = Math.abs(why - wly)}
          {@const [label_x, label_y] = vertical
            ? [c_center, Math.min(v_wh, v_wl) - 6]
            : [Math.max(v_wh, v_wl) + 6, c_center]}
          {@const violin_half = Math.abs(
            cat_scale(box_item.slot + (box_item.series.violin_width ?? violin_width) / 2) -
              c_center,
          )}
          <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
          <g
            class="box-series"
            data-box-idx={box_item.idx}
            role="button"
            tabindex="0"
            aria-label={`box ${box_item.idx + 1}: ${box_item.series.label ?? ``}`}
            style:cursor={on_box_click ? `pointer` : undefined}
            opacity={frame.hovered_series_idx !== null &&
            frame.hovered_series_idx !== box_item.idx
              ? 0.25
              : 1}
            onmousemove={handle_box_hover(box_item, color)}
            onmouseleave={clear_hover}
            onclick={(evt) => on_box_click?.({ ...get_box_data(box_item, color), event: evt })}
            onkeydown={(evt) => {
              if (evt.key === `Enter` || evt.key === ` `) {
                evt.preventDefault()
                on_box_click?.({ ...get_box_data(box_item, color), event: evt })
              }
            }}
          >
            <!-- violin (KDE density) -->
            {#if kde && kde.max_density > 0}
              {@const grid_px = kde.grid.map((g_val) => val_scale(g_val))}
              {@const offsets = kde.density.map(
                (density) => (density / kde.max_density) * violin_half,
              )}
              {@const screen_side = to_screen_side(eff_side, vertical)}
              <path
                class="violin-area"
                d={violin_path(grid_px, offsets, c_center, screen_side, pt)}
                fill={color}
                fill-opacity={violin_state.opacity}
                stroke={color}
                stroke-width={violin_state.stroke_width}
              />
            {/if}
            {#if draw_box}
              {@const wc = whisker_state.color}
              {@const ww = whisker_state.width}
              <!-- whiskers + caps -->
              {@render seg(pt(c_center, v_q1), pt(c_center, v_wl), wc, ww)}
              {@render seg(pt(c_center, v_q3), pt(c_center, v_wh), wc, ww)}
              {#if cap > 0}
                {@render seg(pt(cap_lo, v_wl), pt(cap_hi, v_wl), wc, ww)}
                {@render seg(pt(cap_lo, v_wh), pt(cap_hi, v_wh), wc, ww)}
              {/if}
              <!-- IQR box -->
              <rect
                class="iqr-box"
                x={box_x}
                y={box_y}
                width={Math.max(1, box_w)}
                height={Math.max(1, box_h)}
                rx={box_state.border_radius}
                ry={box_state.border_radius}
                fill={color}
                fill-opacity={box_state.opacity}
                stroke={box_state.stroke_color}
                stroke-width={box_state.stroke_width}
              />
              <!-- median (solid) and mean (dashed) -->
              {@render seg(
                pt(c_lo, v_med),
                pt(c_hi, v_med),
                median_state.color,
                median_state.width,
              )}
              {#if show_mean}
                {@render seg(
                  pt(c_lo, v_mean),
                  pt(c_hi, v_mean),
                  median_state.color,
                  median_state.width,
                  `3 2`,
                )}
              {/if}
              <!-- outliers -->
              {#if show_outliers}
                {#each stats.outliers as outlier, out_idx (out_idx)}
                  {@const [ox, oy] = pt(c_center, val_scale(outlier))}
                  <circle
                    cx={ox}
                    cy={oy}
                    r={outlier_state.radius}
                    fill={color}
                    fill-opacity={outlier_state.opacity}
                    stroke={box_state.stroke_color}
                    stroke-width={outlier_state.stroke_width}
                  />
                {/each}
              {/if}
            {/if}
            <!-- value label -->
            {#if show_value_labels}
              <text
                x={label_x}
                y={label_y}
                text-anchor={vertical ? `middle` : `start`}
                dominant-baseline={vertical ? `auto` : `central`}
                class="value-label"
                style="font-size: 11px"
                fill={color}
              >
                {value_label_for(stats)}
              </text>
            {/if}
            <!-- transparent backing so the box/whisker region is hoverable (the violin
              path is a painted child and bubbles to the group's pointer handlers too) -->
            <rect
              class="hover-target"
              x={hit_x}
              y={hit_y}
              width={Math.max(1, hit_w)}
              height={Math.max(1, hit_h)}
              fill="transparent"
            />
          </g>
        {/if}
      {/each}
    </g>

    {@render ref_lines_layer(ref_lines_by_z.below_points)}
    {@render ref_lines_layer(ref_lines_by_z.above_all)}
  {/snippet}

  {#snippet overlays()}
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
      <PlotTooltip
        x={hover_info.cx}
        y={hover_info.cy}
        offset={{ x: 10, y: 5 }}
        constrain_to={{ width: frame.width, height: frame.height }}
        exclusion_rects={frame.exclusion_rects}
        fallback_size={{ width: 140, height: 50 }}
        bg_color={hover_info.color}
      >
        {#if tooltip}
          {@render tooltip({ ...hover_info, fullscreen })}
        {:else}
          {@const fmt = orientation === `vertical` ? y_axis.format : x_axis.format}
          {@const stat = hover_info.stats}
          {@const rows = [
            [`max`, stat.whisker_high],
            [`q3`, stat.q3],
            [`median`, stat.median],
            [`q1`, stat.q1],
            [`min`, stat.whisker_low],
            ...(show_mean ? [[`mean`, stat.mean] as const] : []),
          ] as const}
          {#if hover_info.category_label}
            <div><strong>{hover_info.category_label}</strong></div>
          {/if}
          {#each rows as [label, value] (label)}
            <div>{label}: {format_value_or_num(value, fmt)}</div>
          {/each}
          {#if show_outliers && stat.outliers.length > 0}
            <div>outliers: {stat.outliers.length}</div>
          {/if}
        {/if}
      </PlotTooltip>
    {/if}

    {#if show_controls}
      <BoxPlotControls
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
        bind:whisker_mode
        bind:show_outliers
        bind:show_mean
        bind:kind
        bind:side
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
