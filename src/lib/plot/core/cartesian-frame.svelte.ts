// Shared reactive scaffold behind the Cartesian charts (BarPlot, BoxPlot, Histogram):
// axis range sync, auto padding, tick generation, scales, decoration/legend placement
// and the pan/zoom controller. Each chart keeps its own marks, hover state and controls
// pane; it feeds the frame merged axis configs, data-driven ranges and an obstacle field
// and reads back scales/pad/ticks. Creates $effects, so it must be called during
// component init. Render the returned state with CartesianFrame.svelte.

import type { Vec2 } from '$lib/math'
import {
  create_legend_decoration_item,
  decoration_placement_revision,
  decoration_placement_rects,
  type DecorationItem,
  get_decoration_placement,
  has_explicit_position,
  measured_footprint,
  solve_decorations,
} from '$lib/plot/core/decorations'
import { create_facet_plot_adapter } from '$lib/plot/core/facet-layout.svelte'
import { FACET_AXES, type FacetAxis, type FacetLayoutContext } from '$lib/plot/core/facets'
import {
  axis_ranges_equal,
  expand_range_if_needed,
  invert_rect_range,
  normalize_y2_sync,
  resolve_axis_ranges,
  sync_y2_range,
  vec2_equal,
} from '$lib/plot/core/interactions'
import {
  calc_auto_padding,
  DEFAULT_PLOT_PADDING,
  filter_padding,
  measured_axis,
  type Rect,
  resolve_tick_layout,
  sides_equal,
  type Sides,
} from '$lib/plot/core/layout'
import {
  add_sides,
  reserve_marginal_pad,
  type ResolvedMarginals,
} from '$lib/plot/core/marginals'
import { create_pan_zoom } from '$lib/plot/core/pan-zoom.svelte'
import { create_placed_tween } from '$lib/plot/core/placed-tween.svelte'
import {
  normalize_plot_title,
  pad_for_plot_title,
  type PlotTitleProp,
} from '$lib/plot/core/plot-title'
import type { IndexedRefLine } from '$lib/plot/core/reference-line'
import { solve_reference_annotations } from '$lib/plot/core/reference-line'
import { create_axis_scales, generate_ticks } from '$lib/plot/core/scales'
import type { FontSpec } from '$lib/plot/core/text-metrics'
import type { AxisConfig, AxisRanges, LegendConfig, PanConfig } from '$lib/plot/core/types'
import { unique_id } from '$lib/plot/core/utils'
import { untrack } from 'svelte'

type FrameAxes = Record<FacetAxis, AxisConfig>
type PerAxis<Value> = Partial<Record<FacetAxis, Value>>

// Tick counts each axis asks for when the axis config leaves `ticks` unset
const DEFAULT_TICK_COUNTS: Record<FacetAxis, number> = { x: 8, x2: 8, y: 5, y2: 5 }

export interface CartesianFrameOptions {
  // Axis configs with component defaults already merged in. Drive scales, ticks,
  // range resolution and pan/zoom.
  axes: () => FrameAxes
  // Data-driven ranges before user overrides and pan/zoom
  auto_ranges: () => AxisRanges
  // Secondary axes only render, generate ticks and accept range writes with data behind
  // them; their scales are [0, 1] sentinels otherwise.
  has_x2: () => boolean
  has_y2: () => boolean
  padding: () => Sides
  title: () => PlotTitleProp | null | undefined
  // Normalized [0, 1] obstacle field (mark geometry) the decoration solver avoids
  obstacles: () => readonly { x: number; y: number }[]
  // Read during construction (initial filter text, create_placed_tween's tween config), so
  // unlike the other thunks it can't close over a binding declared after the call.
  legend: () => LegendConfig | null | undefined
  legend_visible: () => boolean
  legend_items: () => readonly { label: string; legend_group?: string }[]
  // Extra decorations solved alongside the legend (ScatterPlot's colorbar)
  decorations?: () => readonly DecorationItem[]
  // Measured rects the solver must route around but doesn't own: decorations the user
  // positioned explicitly or is currently dragging
  exclusion_rects?: () => readonly Rect[]
  // Extra gate on the legend joining automatic placement, beyond the frame's own checks.
  // False while the user drags the legend or has pinned it to a manual position.
  legend_auto_placed?: () => boolean
  // Freeze the legend's tweened coords mid-drag
  legend_suspended?: () => boolean
  // Position a dragged legend keeps once the user lets go, overriding the solver
  legend_manual_position?: () => { x: number; y: number } | null
  // Estimated legend size used until the element has been measured
  legend_footprint_fallback?: { width: number; height: number }
  marginals: () => ResolvedMarginals
  ref_lines: () => readonly IndexedRefLine[]
  pan: () => PanConfig | undefined
  facet_layout: () => FacetLayoutContext | undefined
  // Write a resolved range back to the chart's (bindable) axis prop. `[null, null]`
  // clears the override so later data changes recompute the auto range.
  write_range: (axis: FacetAxis, range: Vec2 | [null, null]) => void
  // Ranges the padding pass measures against inside a facet grid. Defaults to
  // `auto_ranges`; Histogram re-bins against the reconciled x domain first.
  facet_ranges?: () => AxisRanges
  // Axis configs whose `range` overrides feed the range sync. Defaults to `axes`;
  // Histogram log-sanitizes its count axes here.
  range_sources?: () => Record<FacetAxis, Pick<AxisConfig, `range`>>
  // `per-axis` leaves a panned axis alone when a different axis's auto range moves,
  // `all-axes` resnaps every axis whenever any of them changes, `expand` additionally
  // keeps the current view when the auto range collapses to the [0, 1] "no data"
  // sentinel (every series hidden) so the chart doesn't jump.
  range_sync?: `per-axis` | `all-axes` | `expand`
  // Tick counts per axis when the axis config leaves `ticks` unset
  tick_counts?: PerAxis<number>
  // Forwarded to the pan/zoom controller so charts can track a live rect drag
  on_drag_move?: (coords: { x: number; y: number }, inside_svg: boolean) => void
  // Replace an axis's generated ticks (categorical axes plot one tick per category). An
  // empty array falls back to generated ticks, since a categorical axis with no categories
  // has nothing to label.
  tick_override?: (axis: FacetAxis) => number[] | undefined
  // Axis configs used only when measuring tick labels (categorical axes measure their
  // category labels rather than the numeric slot indices)
  measured_axes?: () => PerAxis<AxisConfig>
  // Prefix of the generated clip-path id
  clip_id_prefix?: string
}

export type CartesianFrame = ReturnType<typeof create_cartesian_frame>

export function create_cartesian_frame(opts: CartesianFrameOptions) {
  let width = $state(0)
  let height = $state(0)
  let svg_element = $state<SVGElement | null>(null)
  let tick_font = $state<Readonly<FontSpec> | undefined>()
  let legend_element = $state<HTMLDivElement | undefined>()
  let legend_size_revision = $state(0)
  let hovered_series_idx = $state<number | null>(null)
  // PlotLegendLayer binds this, so the frame owns the text and the legend config only seeds
  // it: a $derived would discard what the user typed on every new legend object.
  let legend_filter_query = $state(opts.legend()?.filter_query ?? ``)
  const clip_path_id = unique_id(opts.clip_id_prefix ?? `plot-clip`)

  // `initial` and `current` must never share a Vec2: on_reset restores current from initial,
  // so one in-place edit of a current range would silently rewrite the reset target too.
  const copy_axis_ranges = (src: AxisRanges): AxisRanges =>
    Object.fromEntries(FACET_AXES.map((axis) => [axis, [...src[axis]] as Vec2])) as AxisRanges

  let ranges = $state<{ initial: AxisRanges; current: AxisRanges }>({
    initial: { x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] },
    current: { x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] },
  })

  // base_pad reserves space for tick labels/axis titles; `pad` adds decoration reservations
  let base_pad = $derived(filter_padding(opts.padding(), DEFAULT_PLOT_PADDING))
  const title_config = $derived(normalize_plot_title(opts.title()))
  const axis_shown = (axis: FacetAxis): boolean =>
    axis === `x2` ? opts.has_x2() : axis === `y2` ? opts.has_y2() : true
  const measured_axis_config = (axis: FacetAxis): AxisConfig =>
    opts.measured_axes?.()[axis] ?? opts.axes()[axis]

  const facet = create_facet_plot_adapter({
    axes: FACET_AXES,
    facet_layout: opts.facet_layout,
    intrinsic_padding: () => base_pad,
    intrinsic_ranges: () => opts.facet_ranges?.() ?? opts.auto_ranges(),
    ranges: () => ranges.current,
  })
  const effective_base_pad = $derived(facet.padding(base_pad))

  const compute_ticks = (
    axis_scales: ReturnType<typeof create_axis_scales>,
    axis_ranges: AxisRanges,
  ): Record<FacetAxis, number[]> => {
    const axis_ticks = (axis: FacetAxis): number[] => {
      if (!width || !height) return []
      const override = opts.tick_override?.(axis)
      if (override?.length) return override
      if (!axis_shown(axis)) return []
      const config = opts.axes()[axis]
      return generate_ticks(
        axis_ranges[axis],
        config.scale_type ?? `linear`,
        config.ticks,
        axis_scales[axis],
        { default_count: opts.tick_counts?.[axis] ?? DEFAULT_TICK_COUNTS[axis] },
      )
    }
    return Object.fromEntries(FACET_AXES.map((axis) => [axis, axis_ticks(axis)])) as Record<
      FacetAxis,
      number[]
    >
  }

  // y2 can be tied to y ('synced' shares y's range, 'align' pins a common value to the
  // same relative height). The sync is a post-pass over `current` so every writer —
  // the range effect, panning and rect zoom — lands on the same derived y2.
  const y2_sync = $derived(normalize_y2_sync(opts.axes().y2.sync))
  // Untracked throughout: every caller writes ranges.current.y2 right after, and a
  // tracked read of the ranges it is about to overwrite would loop the effect.
  const synced_y2 = (): Vec2 =>
    untrack(() => sync_y2_range(ranges.current.y, ranges.initial.y2, y2_sync))
  const apply_y2_sync = () => {
    if (y2_sync.mode !== `none`) ranges.current.y2 = synced_y2()
  }

  // Re-derive y2 the moment the mode is toggled rather than waiting for the next data
  // change. $effect.pre so it lands before the range effect reads `current`.
  let prev_sync_mode = $state<string>(`none`)
  $effect.pre(() => {
    if (y2_sync.mode === prev_sync_mode) return
    prev_sync_mode = y2_sync.mode
    ranges.current.y2 =
      y2_sync.mode === `none` ? ([...untrack(() => ranges.initial.y2)] as Vec2) : synced_y2()
  })

  // Sync ranges from axis.range overrides and auto ranges. resolve_axis_ranges returns
  // null for transient non-finite bounds (skip: writing NaN breaks scales and, since
  // NaN !== NaN, loops the effect).
  $effect(() => {
    const next = resolve_axis_ranges(opts.range_sources?.() ?? opts.axes(), opts.auto_ranges())
    if (!next) return
    // untrack the read of `ranges` so the writes below can't re-trigger this effect
    // (reading + writing the same state otherwise causes effect_update_depth_exceeded).
    const initial = untrack(() => ranges.initial)
    if (opts.range_sync === `per-axis`) {
      // Update only changed axes, preserving each unchanged axis's panned current view
      for (const axis of FACET_AXES) {
        if (vec2_equal(initial[axis], next[axis])) continue
        ranges.initial[axis] = next[axis]
        ranges.current[axis] = [...next[axis]] as Vec2
      }
    } else if (opts.range_sync === `expand`) {
      // Adopt each axis's new range unless it collapsed to the "no data" sentinel
      for (const axis of FACET_AXES) {
        const { range, changed } = expand_range_if_needed(initial[axis], next[axis])
        if (!changed) continue
        // copy: initial is the reset target, so it must not alias the live current range
        ranges.initial[axis] = range
        ranges.current[axis] = [...range] as Vec2
      }
    } else if (!axis_ranges_equal(initial, next)) {
      ranges = { initial: { ...next }, current: copy_axis_ranges(next) }
    }
    apply_y2_sync()
    facet.apply_ranges()
  })

  // Dynamic padding from measured tick labels and the plot title. Tracks tick values so
  // x auto-rotation / bottom pad recompute when ticks change; sides_equal stops the pad
  // write from looping when nothing moved.
  $effect(() => {
    const padding_ranges = opts.facet_layout()
      ? (opts.facet_ranges?.() ?? opts.auto_ranges())
      : ranges.current
    const padding_scales = create_axis_scales(
      opts.axes(),
      padding_ranges,
      base_pad,
      width,
      height,
    )
    const padding_ticks = compute_ticks(padding_scales, padding_ranges)
    const x_extent = { start: base_pad.l, end: width - base_pad.r }
    const y_extent = { start: height - base_pad.b, end: base_pad.t }
    const measure = (axis: FacetAxis) =>
      measured_axis(
        axis_shown(axis) ? measured_axis_config(axis) : {},
        padding_ticks[axis],
        padding_scales[axis],
        axis === `x` || axis === `x2` ? x_extent : y_extent,
        tick_font,
      )
    const axis_pad =
      width && height
        ? calc_auto_padding({
            padding: opts.padding(),
            default_padding: DEFAULT_PLOT_PADDING,
            width,
            height,
            x_axis: measure(`x`),
            x2_axis: measure(`x2`),
            y_axis: measure(`y`),
            y2_axis: measure(`y2`),
          })
        : filter_padding(opts.padding(), DEFAULT_PLOT_PADDING)
    const new_pad = pad_for_plot_title(axis_pad, title_config, width, height)
    if (!sides_equal(base_pad, new_pad)) base_pad = new_pad
  })

  const legend_footprint = $derived.by(() => {
    void legend_size_revision
    return measured_footprint(
      legend_element,
      opts.legend_footprint_fallback ?? { width: 120, height: 60 },
    )
  })
  const legend_has_explicit_pos = $derived(has_explicit_position(opts.legend()?.style))
  const legend_item = $derived(
    create_legend_decoration_item({
      enabled:
        opts.legend() != null &&
        opts.legend_visible() &&
        legend_element != null &&
        !legend_has_explicit_pos &&
        (opts.legend_auto_placed?.() ?? true),
      footprint: legend_footprint,
      items: opts.legend_items(),
      config: { ...opts.legend(), filter_query: legend_filter_query },
    }),
  )
  const base_decoration_solution = $derived(
    solve_decorations({
      base_pad: effective_base_pad,
      width,
      height,
      obstacles_norm: opts.obstacles(),
      exclusion_rects: opts.exclusion_rects?.(),
      items: [...(legend_item ? [legend_item] : []), ...(opts.decorations?.() ?? [])],
    }),
  )
  const marginal_pad = $derived(reserve_marginal_pad(opts.marginals()))
  const pad = $derived(add_sides(base_decoration_solution.pad, marginal_pad))
  const chart_width = $derived(Math.max(1, width - pad.l - pad.r))
  const chart_height = $derived(Math.max(1, height - pad.t - pad.b))

  const scales = $derived(create_axis_scales(opts.axes(), ranges.current, pad, width, height))
  const ticks = $derived(compute_ticks(scales, ranges.current))
  const decoration_solution = $derived(
    solve_reference_annotations({
      base_solution: base_decoration_solution,
      base_pad: pad,
      width,
      height,
      obstacles_norm: opts.obstacles(),
      lines: opts.ref_lines(),
      ranges: ranges.current,
      scales,
    }),
  )
  const legend_placement = $derived(get_decoration_placement(decoration_solution, `legend`))
  const exclusion_rects = $derived(decoration_placement_rects(decoration_solution))

  // Use the same adaptive y/y2 bands for title placement that padding and PlotAxis render
  const tick_label_widths = $derived.by(() => {
    const extent = { start: height - pad.b, end: pad.t }
    const band = (axis: FacetAxis) =>
      resolve_tick_layout(
        measured_axis(
          measured_axis_config(axis),
          ticks[axis],
          scales[axis],
          extent,
          tick_font,
        ),
        chart_height,
        axis,
      ).band
    return { y_max: band(`y`), y2_max: band(`y2`) }
  })

  const legend_tween = create_placed_tween({
    placement: () =>
      opts.legend_visible() && legend_placement
        ? { x: legend_placement.x, y: legend_placement.y }
        : null,
    dims: () => ({ width, height }),
    responsive: () => opts.legend()?.responsive ?? false,
    element: () => legend_element,
    tween: () => opts.legend()?.tween,
    on_element_resize: () => (legend_size_revision += 1),
    // Re-tween whenever the solved rect moves, not just when it changes side
    placement_revision: () => decoration_placement_revision(legend_placement),
    suspended: opts.legend_suspended,
    manual_position: opts.legend_manual_position,
  })

  const pan_zoom = create_pan_zoom({
    ranges: () => ranges.current,
    scale_type: (axis) => opts.axes()[axis].scale_type,
    // Clamp to at least 1 to avoid Infinity deltas when padding equals container size
    plot_bounds: () => ({ x: pad.l, y: pad.t, width: chart_width, height: chart_height }),
    pan: opts.pan,
    // y is written before y2, so the sync reads the just-updated y range
    set_range: (axis, range) =>
      facet.update_range(axis, axis === `y2` && y2_sync.mode !== `none` ? synced_y2() : range),
    svg: () => svg_element,
    on_drag_move: opts.on_drag_move,
    on_rect_zoom: (start, current) => {
      // Write the inverted rect back into the axis props so the range sync effect can't
      // override it. Gate x2/y2 on real data: their scales are [0, 1] sentinels
      // otherwise, so inverting would store a phantom range in the bindable prop.
      const commit = (axis: FacetAxis, range: Vec2 | null) => {
        if (range && !facet.update_range(axis, range)) opts.write_range(axis, range)
      }
      const next_x = invert_rect_range(scales.x, start.x, current.x)
      if (!next_x) return
      commit(`x`, next_x)
      commit(`x2`, opts.has_x2() ? invert_rect_range(scales.x2, start.x, current.x) : null)
      commit(`y`, invert_rect_range(scales.y, start.y, current.y))
      // A synced y2 is derived from y, so let the sync pass set it instead of the rect
      const zoom_y2 = opts.has_y2() && y2_sync.mode === `none`
      commit(`y2`, zoom_y2 ? invert_rect_range(scales.y2, start.y, current.y) : null)
      apply_y2_sync()
    },
    on_reset: () => {
      if (facet.reset_ranges()) return
      // Undo any pan/zoom, then clear the axis range overrides so future data
      // changes recalculate auto ranges
      ranges.current = copy_axis_ranges(ranges.initial)
      apply_y2_sync()
      for (const axis of FACET_AXES) opts.write_range(axis, [null, null])
    },
  })

  return {
    get width() {
      return width
    },
    set width(value: number) {
      width = value
    },
    get height() {
      return height
    },
    set height(value: number) {
      height = value
    },
    get svg_element() {
      return svg_element
    },
    set svg_element(element: SVGElement | null) {
      svg_element = element
    },
    get tick_font() {
      return tick_font
    },
    set tick_font(font: Readonly<FontSpec> | undefined) {
      tick_font = font
    },
    get legend_element() {
      return legend_element
    },
    set legend_element(element: HTMLDivElement | undefined) {
      legend_element = element
    },
    get legend_filter_query() {
      return legend_filter_query
    },
    set legend_filter_query(query: string) {
      legend_filter_query = query
    },
    // Series the legend is hovering, dimmed by the charts' marks
    get hovered_series_idx() {
      return hovered_series_idx
    },
    set hovered_series_idx(idx: number | null) {
      hovered_series_idx = idx
    },
    clip_path_id,
    facet,
    pan_zoom,
    legend_tween,
    get axes() {
      return opts.axes()
    },
    get ranges() {
      return ranges
    },
    get effective_base_pad() {
      return effective_base_pad
    },
    get pad() {
      return pad
    },
    get chart_width() {
      return chart_width
    },
    get chart_height() {
      return chart_height
    },
    get scales() {
      return scales
    },
    get ticks() {
      return ticks
    },
    get tick_label_widths() {
      return tick_label_widths
    },
    get title_config() {
      return title_config
    },
    get decoration_solution() {
      return decoration_solution
    },
    get legend_placement() {
      return legend_placement
    },
    get legend_footprint() {
      return legend_footprint
    },
    get exclusion_rects() {
      return exclusion_rects
    },
    get has_x2() {
      return opts.has_x2()
    },
    get has_y2() {
      return opts.has_y2()
    },
    get legend_visible() {
      return opts.legend_visible()
    },
  }
}
