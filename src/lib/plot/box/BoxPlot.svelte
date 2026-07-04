<script
  lang="ts"
  generics="Metadata extends Record<string, unknown> = Record<string, unknown>"
>
  import { format_value } from '$lib/labels'
  import { FullscreenToggle, set_fullscreen_bg } from '$lib/layout'
  import type { Vec2 } from '$lib/math'
  import type {
    BandwidthOption,
    BasePlotProps,
    BoxHandlerProps,
    BoxPlotSeries,
    LegendConfig,
    LegendItem,
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
  import {
    BoxPlotControls,
    compute_element_placement,
    PlotAxis,
    PlotLegend,
    PlotMarginals,
    ReferenceLine,
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
    clip_bar,
    has_explicit_position,
    measured_footprint,
    place_decorations,
    placed_coords,
  } from '$lib/plot/core/auto-place'
  import { compute_box_stats } from '$lib/plot/box/box-plot'
  import { gaussian_kde, type KdeResult } from '$lib/plot/box/kde'
  import { create_placed_tween } from '$lib/plot/core/placed-tween.svelte'
  import { create_pan_zoom } from '$lib/plot/core/pan-zoom.svelte'
  import { create_legend_visibility } from '$lib/plot/core/utils/series-visibility'
  import {
    axis_ranges_equal,
    invert_rect_range,
    resolve_axis_ranges,
  } from '$lib/plot/core/interactions'
  import {
    calc_auto_padding,
    DEFAULT_PLOT_PADDING,
    filter_padding,
    LABEL_GAP_DEFAULT,
    y2_axis_label_x,
    measure_max_tick_width,
  } from '$lib/plot/core/layout'
  import { LOG_EPS } from '$lib/math'
  import type { IndexedRefLine } from '$lib/plot/core/reference-line'
  import { group_ref_lines_by_z, index_ref_lines } from '$lib/plot/core/reference-line'
  import {
    create_axis_scales,
    generate_ticks,
    get_nice_data_range,
    get_tick_label,
  } from '$lib/plot/core/scales'
  import { DEFAULT_SERIES_COLORS } from '$lib/plot/core/types'
  import { unique_id } from '$lib/plot/core/utils'
  import { DEFAULTS } from '$lib/settings'
  import type { Snippet } from 'svelte'
  import { onDestroy, untrack } from 'svelte'
  import type { HTMLAttributes } from 'svelte/elements'
  import { SvelteMap } from 'svelte/reactivity'
  import PlotTooltip from '$lib/plot/core/components/PlotTooltip.svelte'
  import { violin_path } from '$lib/plot/core/svg'
  import ZeroLines from '$lib/plot/core/components/ZeroLines.svelte'
  import ZoomRect from '$lib/plot/core/components/ZoomRect.svelte'

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
    display = $bindable(DEFAULTS.box.display),
    range_padding = 0.05,
    padding = DEFAULT_PLOT_PADDING,
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
    value_label_format = `.3~s`,
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
    ...rest
  }: HTMLAttributes<HTMLDivElement> &
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

  let [width, height] = $state([0, 0])
  let wrapper: HTMLDivElement | undefined = $state()
  let svg_element: SVGElement | null = $state(null)
  const clip_path_id = unique_id(`box-clip`) // stable, collision-resistant (see unique_id)

  let hovered_ref_line_idx = $state<number | null>(null)

  let ref_lines_by_z = $derived(group_ref_lines_by_z(index_ref_lines(ref_lines)))

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
  let slot_lookup = $derived(new Map(slot_list.map((slot, idx) => [slot, idx])))
  const slot_of = (idx: number): number =>
    use_categories ? (slot_lookup.get(slot_key(series[idx], idx)) ?? idx) : idx
  let slot_indices = $derived(slot_list.map((_, idx) => idx))
  // A slot's tick label is colored only when a single series occupies it. Precompute
  // slot -> color in one pass so the PlotAxis tick_color callback stays O(1) per tick.
  let slot_colors = $derived.by(() => {
    const by_slot = new SvelteMap<number, number[]>()
    series.forEach((_srs, idx) => {
      const slot = slot_of(idx)
      const idxs = by_slot.get(slot)
      if (idxs) idxs.push(idx)
      else by_slot.set(slot, [idx])
    })
    const colors = new SvelteMap<number, string | undefined>()
    for (const [slot, idxs] of by_slot) {
      colors.set(slot, idxs.length === 1 ? box_color(idxs[0]) : undefined)
    }
    return colors
  })
  let cat_axis = $derived(orientation === `horizontal` ? `y` : `x`)

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

  // KDE per visible violin series, keyed by series index (bandwidth from the full sample)
  let violin_kdes = $derived.by(() => {
    const map = new SvelteMap<number, KdeResult>()
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
      map.set(
        box_item.idx,
        gaussian_kde(samples, {
          bandwidth: box_item.series.bandwidth ?? bandwidth,
          n_points: kde_points,
          cut: kde_cut,
          clip,
          max_samples: kde_max_samples,
        }),
      )
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

  // Peak density per violin, computed once on data change (avoids spreading kde.density into
  // Math.max — unsafe for large kde_points — and re-deriving it on every render/hover).
  let violin_max_density = $derived.by(() => {
    const map = new SvelteMap<number, number>()
    for (const [idx, kde] of violin_kdes) {
      let max = 0
      for (const den of kde.density) if (den > max) max = den
      map.set(idx, max)
    }
    return map
  })

  // Which boxes live on the secondary value axis (y2 for vertical, x2 for horizontal)
  const is_secondary = (srs: BoxPlotSeries<Metadata>): boolean =>
    orientation === `vertical` ? srs.y_axis === `y2` : srs.x_axis === `x2`
  let secondary_boxes = $derived(
    visible_boxes.filter((box_item) => is_secondary(box_item.series)),
  )
  let has_secondary = $derived(secondary_boxes.length > 0)
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

    const primary_boxes = visible_boxes.filter((box_item) => !is_secondary(box_item.series))
    const calc_value_range = (
      boxes: Box[],
      limit: [number | null, number | null],
      scale_type: ScaleType,
    ): Vec2 => {
      const pts = value_points(boxes)
      if (pts.length === 0) return [0, 1]
      return get_nice_data_range(pts, (pt) => pt.y, limit, scale_type, range_padding, false)
    }
    const vertical = orientation === `vertical`
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

  let ranges = $state<{
    initial: { x: Vec2; x2: Vec2; y: Vec2; y2: Vec2 }
    current: { x: Vec2; x2: Vec2; y: Vec2; y2: Vec2 }
  }>({
    initial: { x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] },
    current: { x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] },
  })

  $effect(() => {
    // sync ranges from axis.range overrides / auto ranges
    // resolve_axis_ranges returns null for transient non-finite bounds (skip: writing
    // NaN breaks scales and, since NaN !== NaN, loops the effect)
    const next = resolve_axis_ranges(
      { x: x_axis, x2: x2_axis, y: y_axis, y2: y2_axis },
      auto_ranges,
    )
    if (!next) return
    // untrack the read of `ranges` so the assignment can't re-trigger this effect
    // (reading + writing the same state otherwise causes effect_update_depth_exceeded).
    const init = untrack(() => ranges.initial)
    if (!axis_ranges_equal(init, next)) {
      ranges = { initial: { ...next }, current: { ...next } }
    }
  })

  let base_pad = $derived(filter_padding(padding, DEFAULT_PLOT_PADDING))

  $effect(() => {
    // dynamic padding from tick label widths
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
    if (width && height && show_y2 && ticks.y2.length > 0) {
      const inside = y2_axis.tick?.label?.inside ?? false
      const tick_shift = inside ? 0 : (y2_axis.tick?.label?.shift?.x ?? 0) + 8
      const tick_width_contribution = inside ? 0 : tick_label_widths.y2_max
      const label_space = y2_axis.label ? 20 : 0
      new_pad.r = Math.max(new_pad.r, tick_shift + tick_width_contribution + 30 + label_space)
    }
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

  // Obstacle field in normalized [0,1] coords: each box modeled as a whisker-spanning segment
  const obstacles_norm = $derived.by(() => {
    if (!width || !height || visible_boxes.length === 0) return []
    const base_w = width - base_pad.l - base_pad.r
    const base_h = height - base_pad.t - base_pad.b
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

  const should_show_legend = $derived(show_legend ?? false)
  const decor = $derived.by(() =>
    place_decorations({
      base_pad,
      width,
      height,
      obstacles_norm,
      legend:
        legend != null &&
        should_show_legend &&
        legend_element != null &&
        !legend_has_explicit_pos
          ? { footprint: legend_footprint, clearance: legend?.axis_clearance }
          : null,
    }),
  )
  // Marginals are opt-in (default prop `false`) and bind to the VALUE axis, pooling each box's
  // raw samples. The default side follows orientation (value axis = y when vertical, x when
  // horizontal) so the `marginals` boolean / type-string shorthand land on a meaningful side.
  // Each box is tagged with its value axis so a primary-axis marginal ignores secondary boxes.
  const marginal_vertical = $derived(orientation === `vertical`)
  const resolved_marginals = $derived(
    normalize_marginals(marginals, marginal_vertical ? { right: true } : { top: true }),
  )
  const pad = $derived(add_sides(decor.pad, reserve_marginal_pad(resolved_marginals)))
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

  // Value scale for a box (vertical -> y/y2, horizontal -> x/x2), made log-safe: on a
  // log value axis, stats at values <= 0 (whisker_low is often exactly 0; negative
  // outliers) have no finite pixel. Clamp to LOG_EPS so whiskers/boxes/labels draw
  // toward the plot edge (the clip group crops the overshoot) instead of NaN coords.
  const box_val_scale = (srs: BoxPlotSeries<Metadata>): ((val: number) => number) => {
    const vertical = orientation === `vertical`
    const secondary = is_secondary(srs)
    const scale = vertical
      ? secondary
        ? scales.y2
        : scales.y
      : secondary
        ? scales.x2
        : scales.x
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
    // categorical axes show one tick per slot instead of generated numeric ticks
    return {
      x:
        cat_axis === `x` && width && height
          ? slot_indices
          : axis_ticks(x_axis, ranges.current.x, scales.x, 8),
      y:
        cat_axis === `y` && width && height
          ? slot_indices
          : axis_ticks(y_axis, ranges.current.y, scales.y, 6),
      y2: axis_ticks(y2_axis, ranges.current.y2, scales.y2, 6, show_y2),
      x2: axis_ticks(x2_axis, ranges.current.x2, scales.x2, 8, show_x2),
    }
  })

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
      const next_x = invert_rect_range(scales.x, start.x, current.x)
      if (!next_x) return
      x_axis = { ...x_axis, range: next_x }
      // the secondary value axis is x2 only in horizontal mode, y2 only in vertical
      // (is_secondary keys off orientation); writing the off-orientation axis would
      // store a phantom range from its [0, 1] sentinel scale into the bound prop
      const next_x2 = show_x2 ? invert_rect_range(scales.x2, start.x, current.x) : null
      if (next_x2) x2_axis_prop = { ...x2_axis_prop, range: next_x2 }
      const next_y = invert_rect_range(scales.y, start.y, current.y)
      if (next_y) y_axis = { ...y_axis, range: next_y }
      const next_y2 = show_y2 ? invert_rect_range(scales.y2, start.y, current.y) : null
      if (next_y2) y2_axis_prop = { ...y2_axis_prop, range: next_y2 }
    },
    on_reset: () => {
      ranges.current = {
        x: [...ranges.initial.x] as Vec2,
        x2: [...ranges.initial.x2] as Vec2,
        y: [...ranges.initial.y] as Vec2,
        y2: [...ranges.initial.y2] as Vec2,
      }
      x_axis = { ...x_axis, range: [null, null] }
      x2_axis_prop = { ...x2_axis_prop, range: [null, null] }
      y_axis = { ...y_axis, range: [null, null] }
      y2_axis_prop = { ...y2_axis_prop, range: [null, null] }
    },
  })
  onDestroy(() => pan_zoom.destroy())

  // === Legend ===
  let legend_data = $derived<LegendItem[]>(
    series.map((srs, idx) => ({
      series_idx: idx,
      label: srs.label ?? `Box ${idx + 1}`,
      visible: srs.visible ?? true,
      legend_group: srs.legend_group,
      display_style: { symbol_type: `Square` as const, symbol_color: box_color(idx) },
    })),
  )

  const legend_vis = create_legend_visibility(
    () => series,
    (next) => (series = next),
  )

  let box_points_for_placement = $derived.by(() => {
    if (!width || !height || visible_boxes.length === 0) return []
    const vertical = orientation === `vertical`
    return visible_boxes
      .map((box_item) => {
        const val_scale = box_val_scale(box_item.series)
        const cat_scale = vertical ? scales.x : scales.y
        const cc = cat_scale(box_item.slot)
        const vc = val_scale(box_item.stats.median)
        return vertical ? { x: cc, y: vc } : { x: vc, y: cc }
      })
      .filter(({ x, y }) => isFinite(x) && isFinite(y))
  })

  let hovered_legend_series_idx = $state<number | null>(null)

  let legend_placement = $derived.by(() => {
    if (!should_show_legend || !width || !height) return null
    return compute_element_placement({
      plot_bounds: { x: pad.l, y: pad.t, width: chart_width, height: chart_height },
      element: legend_element,
      element_size: { width: 120, height: 60 },
      axis_clearance: legend?.axis_clearance,
      exclude_rects: [],
      points: box_points_for_placement,
    })
  })

  // Tweened legend coordinates with shared placement stability gating
  const legend_tween = create_placed_tween({
    placement: () => legend_placement,
    dims: () => ({ width, height }),
    responsive: () => legend?.responsive ?? false,
    element: () => legend_element,
    tween: () => legend?.tween,
  })

  // === Tooltip / hover ===
  let hover_info = $state<BoxHover | null>(null)

  function get_box_data(box_item: Box, color: string): BoxHover {
    const vertical = orientation === `vertical`
    const val_scale = box_val_scale(box_item.series)
    const cat_scale = vertical ? scales.x : scales.y
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
    const rect = svg_element?.getBoundingClientRect()
    if (rect) {
      data.cx = event.clientX - rect.left
      data.cy = event.clientY - rect.top
    }
    hover_info = data
    change(hover_info)
    on_box_hover?.({ ...hover_info, event })
  }

  // Set theme-aware background when entering fullscreen
  $effect(() => set_fullscreen_bg(wrapper, fullscreen, `--boxplot-fullscreen-bg`))

  // Value label helper
  const value_label_for = (stats: Box[`stats`]): string =>
    format_value(value_label_stat === `mean` ? stats.mean : stats.median, value_label_format)
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
  class={[`box-plot`, rest.class]}
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
        ([x_axis.label, y_axis.label].filter(Boolean).join(` vs `) || `Box plot`)}
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
        on_box_hover?.(null)
      }}
      onwheel={pan_zoom.on_wheel}
      ontouchstart={pan_zoom.on_touch_start}
      ontouchmove={pan_zoom.on_touch_move}
      ontouchend={pan_zoom.on_touch_end}
      ontouchcancel={pan_zoom.on_touch_end}
      style:cursor={pan_zoom.cursor}
    >
      <ZoomRect start={pan_zoom.drag_start} current={pan_zoom.drag_current} />

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

      {@render ref_lines_layer(ref_lines_by_z.below_grid)}

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
        tick_color={cat_axis === `x` ? (tick) => slot_colors.get(tick) : undefined}
        label_x={pad.l + chart_width / 2 + (x_axis.label_shift?.x ?? 0)}
        label_y={height - pad.b / 3 + (x_axis.label_shift?.y ?? 0)}
      />

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
        />
      {/if}

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
        tick_color={cat_axis === `y` ? (tick) => slot_colors.get(tick) : undefined}
        label_x={Math.max(
          12,
          pad.l -
            (y_axis.tick?.label?.inside ? 0 : tick_label_widths.y_max) -
            LABEL_GAP_DEFAULT,
        ) + (y_axis.label_shift?.x ?? 0)}
        label_y={pad.t + chart_height / 2 + (y_axis.label_shift?.y ?? 0)}
      />

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
        />
      {/if}

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
          has_x2={show_x2}
          has_y2={show_y2}
          {width}
          {height}
          {pad}
        />
      </g>

      {@render ref_lines_layer(ref_lines_by_z.below_lines)}

      <!-- Boxes -->
      <g clip-path="url(#{clip_path_id})">
        {#each visible_boxes as box_item (box_item.series.id ?? box_item.idx)}
          {@const stats = box_item.stats}
          {#if Number.isFinite(stats.median)}
            {@const vertical = orientation === `vertical`}
            {@const cat_scale = vertical ? scales.x : scales.y}
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
            {@const max_density = kde ? (violin_max_density.get(box_item.idx) ?? 0) : 0}
            <!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
            <g
              class="box-series"
              data-box-idx={box_item.idx}
              role="button"
              tabindex="0"
              aria-label={`box ${box_item.idx + 1}: ${box_item.series.label ?? ``}`}
              style:cursor={on_box_click ? `pointer` : undefined}
              opacity={hovered_legend_series_idx !== null &&
              hovered_legend_series_idx !== box_item.idx
                ? 0.25
                : 1}
              onmousemove={handle_box_hover(box_item, color)}
              onmouseleave={() => {
                hover_info = null
                change(null)
                on_box_hover?.(null)
              }}
              onclick={(evt) =>
                on_box_click?.({ ...get_box_data(box_item, color), event: evt })}
              onkeydown={(evt) => {
                if (evt.key === `Enter` || evt.key === ` `) {
                  evt.preventDefault()
                  on_box_click?.({ ...get_box_data(box_item, color), event: evt })
                }
              }}
            >
              <!-- violin (KDE density) -->
              {#if kde && max_density > 0}
                {@const grid_px = kde.grid.map((g_val) => val_scale(g_val))}
                {@const offsets = kde.density.map((den) => (den / max_density) * violin_half)}
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

      <!-- Marginal distribution strips -->
      <PlotMarginals
        marginals={resolved_marginals}
        series={marginal_series}
        {width}
        {height}
        {pad}
        has_axis={marginal_has_axis}
        axes={{
          x1: marginal_axis(scales.x, ranges.current.x, x_axis),
          x2: marginal_axis(scales.x2, ranges.current.x2, x2_axis),
          y1: marginal_axis(scales.y, ranges.current.y, y_axis),
          y2: marginal_axis(scales.y2, ranges.current.y2, y2_axis),
        }}
        id={clip_path_id}
      />
    </svg>

    {#if legend && should_show_legend}
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
        style={`position: absolute; left: ${legend_pos.x}px; top: ${legend_pos.y}px; pointer-events: auto; ${
          legend?.style || ``
        }`}
      />
    {/if}

    {#if hover_info && hovered}
      <PlotTooltip
        x={hover_info.cx}
        y={hover_info.cy}
        offset={{ x: 10, y: 5 }}
        constrain_to={{ width, height }}
        fallback_size={{ width: 140, height: 50 }}
        bg_color={hover_info.color}
      >
        {#if tooltip}
          {@render tooltip({ ...hover_info, fullscreen })}
        {:else}
          {@const fmt = (orientation === `vertical` ? y_axis.format : x_axis.format) || `.3~s`}
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
            <div>{label}: {format_value(value, fmt)}</div>
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
  {/if}

  {@render children?.({ height, width, fullscreen })}
</div>

<style>
  .box-plot {
    position: relative;
    width: 100%;
    height: var(--boxplot-height, auto);
    min-height: var(--boxplot-min-height, 300px);
    container-type: size;
    z-index: var(--boxplot-z-index, auto);
    border-radius: var(--boxplot-border-radius, var(--border-radius, 3pt));
    flex: var(--boxplot-flex, 1);
    display: var(--boxplot-display, flex);
    flex-direction: column;
    background: var(--boxplot-bg, var(--plot-bg));
  }
  .box-plot.fullscreen {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw !important;
    height: 100vh !important;
    z-index: var(--boxplot-fullscreen-z-index, var(--z-index-overlay-nav, 100000001));
    margin: 0;
    border-radius: 0;
    background: var(--boxplot-fullscreen-bg, var(--boxplot-bg, var(--plot-bg)));
    max-height: none !important;
    overflow: hidden;
    /* border-top (not padding-top): bind:clientHeight includes padding but excludes
    borders - padding made the chart overflow + clip its bottom 2em (x-axis title) */
    border-top: var(--plot-fullscreen-padding-top, 2em) solid
      var(--boxplot-fullscreen-bg, var(--boxplot-bg, var(--plot-bg, transparent)));
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
    position: static;
    opacity: 1;
  }
  .box-plot :global(.pane-toggle),
  .box-plot .header-controls {
    opacity: 0;
    transition:
      opacity 0.2s,
      background-color 0.2s;
  }
  .box-plot:hover :global(.pane-toggle),
  .box-plot:hover .header-controls,
  .box-plot :global(.pane-toggle:focus-visible),
  .box-plot :global(.pane-toggle[aria-expanded='true']),
  .box-plot .header-controls:focus-within {
    opacity: 1;
  }
  svg {
    width: var(--boxplot-svg-width, 100%);
    height: var(--boxplot-svg-height, 100%);
    flex: var(--boxplot-svg-flex, 1);
    overflow: var(--boxplot-svg-overflow, visible);
    fill: var(--text-color);
    font-weight: var(--scatter-font-weight);
    font-size: var(--scatter-font-size);
  }
  .value-label {
    font-size: 11px;
  }
</style>
