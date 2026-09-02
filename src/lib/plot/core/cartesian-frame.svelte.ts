// Shared reactive scaffold behind the Cartesian charts (BarPlot, BoxPlot, Histogram):
// axis range sync, auto padding, tick generation, scales, decoration/legend placement
// and the pan/zoom controller. Each chart keeps its own marks, hover state and controls
// pane; it feeds the frame merged axis configs, data-driven ranges and an obstacle field
// and reads back scales/pad/ticks. Creates $effects, so it must be called during
// component init. Render the returned state with CartesianFrame.svelte.

import { clamp, type Vec2 } from '$lib/math'
import type { DecorationItem } from '$lib/plot/core/decorations'
import {
  create_legend_decoration_item,
  decoration_placement_revision,
  decoration_placement_rects,
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
import type { Rect, Sides } from '$lib/plot/core/layout'
import {
  calc_auto_padding,
  DEFAULT_PLOT_PADDING,
  filter_padding,
  sides_equal,
} from '$lib/plot/core/layout'
import type { ResolvedMarginals } from '$lib/plot/core/marginals'
import { add_sides, reserve_marginal_pad } from '$lib/plot/core/marginals'
import { create_pan_zoom } from '$lib/plot/core/pan-zoom.svelte'
import { create_placed_tween } from '$lib/plot/core/placed-tween.svelte'
import type { PlotTitleProp } from '$lib/plot/core/plot-title'
import { normalize_plot_title, pad_for_plot_title } from '$lib/plot/core/plot-title'
import type { IndexedRefLine } from '$lib/plot/core/reference-line'
import { solve_reference_annotations } from '$lib/plot/core/reference-line'
import { create_axis_scales, generate_ticks } from '$lib/plot/core/scales'
import type { FontSpec } from '$lib/plot/core/text-metrics'
import { measured_axis, resolve_tick_layout } from '$lib/plot/core/tick-layout'
import type { AxisConfig, AxisRanges, LegendConfig, PanConfig } from '$lib/plot/core/types'
import { unique_id } from '$lib/plot/core/utils'
import { untrack } from 'svelte'

type FrameAxes = Record<FacetAxis, AxisConfig>
type PerAxis<Value> = Partial<Record<FacetAxis, Value>>

// Tick counts each axis asks for when the axis config leaves `ticks` unset
const DEFAULT_TICK_COUNTS: Record<FacetAxis, number> = { x: 8, x2: 8, y: 5, y2: 5 }

interface CartesianFrameOptions {
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
  // positioned explicitly (the dragged legend is handled by the frame itself)
  exclusion_rects?: () => readonly Rect[]
  // Estimated legend size used until the element has been measured
  legend_footprint_fallback?: { width: number; height: number }
  marginals: () => ResolvedMarginals
  ref_lines: () => readonly IndexedRefLine[]
  pan: () => PanConfig | undefined
  facet_layout: () => FacetLayoutContext | undefined
  // Ranges the padding pass measures against inside a facet grid. Defaults to
  // `auto_ranges`; Histogram re-bins against the reconciled x domain first.
  facet_ranges?: () => AxisRanges
  // Axis configs whose `range` overrides feed the range sync. Defaults to `axes`;
  // Histogram log-sanitizes its count axes here.
  range_sources?: () => Record<FacetAxis, Pick<AxisConfig, `range`>>
  // Unset resnaps every axis whenever any of them changes. `per-axis` leaves a panned
  // axis alone when a different axis's auto range moves; `expand` additionally keeps the
  // current view on an axis whose auto range has no data behind it (every series hidden,
  // see `has_data`) so the chart doesn't jump.
  range_sync?: `per-axis` | `expand`
  // Whether each axis's auto range is backed by finite visible data (default: all true).
  // Only consulted by `expand`; an axis with a pinned bound always adopts its new range.
  has_data?: () => PerAxis<boolean>
  // Tick counts per axis when the axis config leaves `ticks` unset
  tick_counts?: PerAxis<number>
  // Forwarded to the pan/zoom controller so charts can track a live rect drag
  on_drag_move?: (coords: { x: number; y: number }, inside_svg: boolean) => void
  // Alt+drag rect, in svg pixel space. Charts that can enumerate their marks implement
  // this to turn the gesture into a selection; omitting it leaves Alt+drag as a zoom.
  on_rect_select?: (start: { x: number; y: number }, current: { x: number; y: number }) => void
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
  // Shared across the z-ordered ReferenceLinesLayer instances so one hover highlights one line
  let hovered_ref_line_idx = $state<number | null>(null)
  // PlotLegendLayer binds this, so the frame owns the text and the legend config only seeds
  // it: a $derived would discard what the user typed on every new legend object.
  let legend_filter_query = $state(opts.legend()?.filter_query ?? ``)
  const clip_path_id = unique_id(opts.clip_id_prefix ?? `plot-clip`)

  // `initial` is what the caller configured (axis.range pins over auto ranges) and doubles as
  // the reset target; `current` is the live view every gesture (pan, wheel, rect zoom) edits.
  // The frame never writes the chart's axis props, so a pinned range survives any gesture and
  // a reset lands back on it. The two must never share a Vec2: on_reset restores current from
  // initial, so one in-place edit of a current range would silently rewrite the reset target.
  const copy_axis_ranges = (src: AxisRanges): AxisRanges =>
    Object.fromEntries(FACET_AXES.map((axis) => [axis, [...src[axis]] as Vec2])) as AxisRanges

  let ranges = $state<{ initial: AxisRanges; current: AxisRanges }>({
    initial: { x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] },
    current: { x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] },
  })

  // base_pad reserves space for tick labels/axis titles; `pad` adds decoration reservations
  let base_pad = $derived(filter_padding(opts.padding(), DEFAULT_PLOT_PADDING))
  // The same without the caller's padding: what the axes themselves need. Outside decorations
  // stack on this, so a caller who pads past the axis band (BandsAndDos matching a sibling
  // panel's legend room) gets the decoration inside that room rather than on top of it.
  let axis_pad = $derived(DEFAULT_PLOT_PADDING)
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
  // In-place recompute, for the writers that replace `current` wholesale (the range effect,
  // reset). The bridge below goes through update_range instead so the grid sees the new y2.
  const apply_y2_sync = () => {
    if (y2_sync.mode !== `none`) ranges.current.y2 = synced_y2()
  }
  // The bridge every range write goes through, so a synced y2 cannot be left behind. The raw
  // `facet` is handed to callers (ScatterPlot's `view` prop, BinnedScatterPlot's bin click)
  // whose writes would otherwise skip the sync, and y2 would stay stale until something
  // unrelated — new data, a tick-count edit — re-ran the range effect and snapped it over.
  const synced_facet = {
    ...facet,
    update_range: (axis: FacetAxis, range: Vec2): void => {
      if (axis === `y2` && y2_sync.mode !== `none`) return // derived from y, not settable
      facet.update_range(axis, range)
      // via update_range so a facet grid receives the derived y2 as well
      if (axis === `y` && y2_sync.mode !== `none`) facet.update_range(`y2`, synced_y2())
    },
  }

  // Re-derive y2 the moment the mode is toggled rather than waiting for the next data
  // change. $effect.pre so it lands before the range effect reads `current`.
  // Last applied mode; plain since only this effect reads it
  let prev_sync_mode = `none`
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
    const sources = opts.range_sources?.() ?? opts.axes()
    const next = resolve_axis_ranges(sources, opts.auto_ranges())
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
      // Adopt each axis's new range unless nothing backs it (no data, no pinned bound)
      const has_data = opts.has_data?.() ?? {}
      for (const axis of FACET_AXES) {
        const pinned = sources[axis].range?.some((bound) => bound != null) ?? false
        const { range, changed } = expand_range_if_needed(
          initial[axis],
          next[axis],
          (has_data[axis] ?? true) || pinned,
        )
        if (!changed) continue
        // copy: initial is the reset target, so it must not alias the live current range
        ranges.initial[axis] = range
        ranges.current[axis] = [...range] as Vec2
      }
    } else if (!axis_ranges_equal(initial, next)) {
      ranges = { initial: { ...next }, current: copy_axis_ranges(next) }
    }
    // sync after the grid reconciles, or a facet panel derives y2 from the pre-grid y
    facet.apply_ranges()
    apply_y2_sync()
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
    const measured_axes = {
      x_axis: measure(`x`),
      x2_axis: measure(`x2`),
      y_axis: measure(`y`),
      y2_axis: measure(`y2`),
    }
    const auto_pad = (padding: Sides): Required<Sides> =>
      pad_for_plot_title(
        width && height
          ? calc_auto_padding({
              padding,
              default_padding: DEFAULT_PLOT_PADDING,
              width,
              height,
              ...measured_axes,
            })
          : filter_padding(padding, DEFAULT_PLOT_PADDING),
        title_config,
        width,
        height,
      )
    const new_pad = auto_pad(opts.padding())
    if (!sides_equal(base_pad, new_pad)) base_pad = new_pad
    const new_axis_pad = auto_pad({})
    if (!sides_equal(axis_pad, new_axis_pad)) axis_pad = new_axis_pad
  })

  const legend_has_explicit_pos = $derived(has_explicit_position(opts.legend()?.style))
  // Legend box, measured in an effect (after the flush's DOM writes) rather than lazily in
  // the derivations that consume it, where an offset read landing between two DOM writes
  // forces a reflow. Re-measured when the legend's content resizes (placed-tween's
  // ResizeObserver bumps the revision), when the plot resizes (an explicitly styled legend
  // anchored `right:`/`bottom:` moves with it) and when the legend style changes.
  const legend_footprint_fallback = opts.legend_footprint_fallback ?? {
    width: 120,
    height: 60,
  }
  let legend_footprint = $state(legend_footprint_fallback)
  let legend_offset = $state({ x: 0, y: 0 })
  $effect(() => {
    void [legend_size_revision, width, height, opts.legend()?.style]
    const element = legend_element
    const size = measured_footprint(element, legend_footprint_fallback)
    const offset =
      element && legend_has_explicit_pos
        ? { x: element.offsetLeft, y: element.offsetTop }
        : { x: 0, y: 0 }
    untrack(() => {
      if (size.width !== legend_footprint.width || size.height !== legend_footprint.height) {
        legend_footprint = size
      }
      if (offset.x !== legend_offset.x || offset.y !== legend_offset.y) legend_offset = offset
    })
  })

  // Legend drag: a legend the user grabbed or dropped owns its position; the solver only
  // routes around it (via exclusion rects) from then on.
  let legend_is_dragging = $state(false)
  let legend_manual_position = $state<{ x: number; y: number } | null>(null)
  // Cursor offset inside the legend and the SVG's client origin, both captured at drag start
  // (the SVG doesn't move during a drag, and measuring it after every position write would
  // force a reflow per mousemove); plain since only the handlers read them
  let legend_drag_offset = { x: 0, y: 0 }
  let legend_drag_origin = { x: 0, y: 0 }
  const constrain_legend_position = (
    position: { x: number; y: number },
    footprint: { width: number; height: number },
  ): { x: number; y: number } => ({
    x: clamp(position.x, 0, Math.max(0, width - footprint.width)),
    y: clamp(position.y, 0, Math.max(0, height - footprint.height)),
  })
  // Keep a dropped legend inside the plot when the plot or the legend resizes
  $effect(() => {
    if (!legend_manual_position || legend_is_dragging) return
    const { x, y } = legend_manual_position
    const constrained = constrain_legend_position(legend_manual_position, legend_footprint)
    if (constrained.x !== x || constrained.y !== y) legend_manual_position = constrained
  })
  const legend_drag_start = (event: MouseEvent): void => {
    const legend_el = event.currentTarget
    if (!svg_element || !(legend_el instanceof HTMLElement)) return
    legend_is_dragging = true
    // Offset from the cursor to the legend's rendered corner (accounts for transforms)
    const legend_rect = legend_el.getBoundingClientRect()
    const svg_rect = svg_element.getBoundingClientRect()
    legend_drag_offset = {
      x: event.clientX - legend_rect.left,
      y: event.clientY - legend_rect.top,
    }
    legend_drag_origin = { x: svg_rect.left, y: svg_rect.top }
  }
  const legend_drag = (event: MouseEvent): void => {
    if (!legend_is_dragging || !svg_element || !legend_element) return
    legend_manual_position = constrain_legend_position(
      {
        x: event.clientX - legend_drag_origin.x - legend_drag_offset.x,
        y: event.clientY - legend_drag_origin.y - legend_drag_offset.y,
      },
      legend_footprint,
    )
  }
  const legend_drag_end = (): void => {
    legend_is_dragging = false
  }
  // An explicitly styled or dragged legend stays outside solver ownership, but its measured
  // rectangle remains an exclusion for the automatic items
  const legend_pinned_rects = $derived.by((): Rect[] => {
    if (
      !legend_element ||
      !(legend_has_explicit_pos || legend_is_dragging || legend_manual_position)
    ) {
      return []
    }
    return [{ ...(legend_manual_position ?? legend_offset), ...legend_footprint }]
  })

  const legend_item = $derived(
    create_legend_decoration_item({
      enabled:
        opts.legend() != null &&
        opts.legend_visible() &&
        legend_element != null &&
        !legend_has_explicit_pos &&
        !legend_is_dragging &&
        !legend_manual_position,
      footprint: legend_footprint,
      items: opts.legend_items(),
      config: { ...opts.legend(), filter_query: legend_filter_query },
    }),
  )
  const pinned_rects = $derived([...legend_pinned_rects, ...(opts.exclusion_rects?.() ?? [])])
  const base_decoration_solution = $derived(
    solve_decorations({
      base_pad: effective_base_pad,
      axis_pad: facet.padding(axis_pad),
      width,
      height,
      obstacles_norm: opts.obstacles(),
      exclusion_rects: pinned_rects,
      items: [...(legend_item ? [legend_item] : []), ...(opts.decorations?.() ?? [])],
    }),
  )
  const marginal_pad = $derived(reserve_marginal_pad(opts.marginals()))
  const pad = $derived(add_sides(base_decoration_solution.pad, marginal_pad))
  const chart_width = $derived(Math.max(1, width - pad.l - pad.r))
  const chart_height = $derived(Math.max(1, height - pad.t - pad.b))

  const scales = $derived(create_axis_scales(opts.axes(), ranges.current, pad, width, height))
  const ticks = $derived(compute_ticks(scales, ranges.current))
  // Reference lines on x2/y2 resolve against the primary axis while no series carries data
  // there (their ranges/scales are [0, 1] sentinels, which would drop or misplace the line),
  // so charts without secondary axes (BinnedScatterPlot) still honour `x_axis: 'x2'`
  const ref_line_axes = $derived.by(() => {
    const x2 = opts.has_x2() ? `x2` : `x`
    const y2 = opts.has_y2() ? `y2` : `y`
    const { current } = ranges
    return {
      ranges: { x: current.x, x2: current[x2], y: current.y, y2: current[y2] },
      scales: { x: scales.x, x2: scales[x2], y: scales.y, y2: scales[y2] },
    }
  })
  const decoration_solution = $derived(
    solve_reference_annotations({
      base_solution: base_decoration_solution,
      base_pad: pad,
      width,
      height,
      obstacles_norm: opts.obstacles(),
      lines: opts.ref_lines(),
      ...ref_line_axes,
    }),
  )
  const legend_placement = $derived(get_decoration_placement(decoration_solution, `legend`))
  // Everything a tooltip must dodge: solver placements plus the pinned/dragged decorations
  const exclusion_rects = $derived([
    ...pinned_rects,
    ...decoration_placement_rects(decoration_solution),
  ])

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
    // Freeze the tweened coords mid-drag; a dropped legend snaps to where it was left
    suspended: () => legend_is_dragging,
    manual_position: () => legend_manual_position,
  })

  const pan_zoom = create_pan_zoom({
    ranges: () => ranges.current,
    scale_type: (axis) => opts.axes()[axis].scale_type,
    // Clamp to at least 1 to avoid Infinity deltas when padding equals container size
    plot_bounds: () => ({ x: pad.l, y: pad.t, width: chart_width, height: chart_height }),
    pan: opts.pan,
    set_range: synced_facet.update_range,
    svg: () => svg_element,
    on_drag_move: opts.on_drag_move,
    on_rect_select: opts.on_rect_select,
    on_rect_zoom: (start, current) => {
      // Passing the live range keeps each axis pointing the way it already does, so zooming a
      // reversed axis does not silently flip the plot. Gate x2/y2 on real data: their scales
      // are [0, 1] sentinels otherwise, so inverting would store a phantom range.
      const zoom_axis = (axis: FacetAxis, from_px: number, to_px: number) => {
        const range = invert_rect_range(scales[axis], from_px, to_px, ranges.current[axis])
        if (range) synced_facet.update_range(axis, range)
        return range
      }
      if (!zoom_axis(`x`, start.x, current.x)) return
      if (opts.has_x2()) zoom_axis(`x2`, start.x, current.x)
      zoom_axis(`y`, start.y, current.y)
      // A synced y2 already followed the y zoom above; the bridge drops this one
      if (opts.has_y2()) zoom_axis(`y2`, start.y, current.y)
    },
    on_reset: () => {
      if (facet.reset_ranges()) return
      ranges.current = copy_axis_ranges(ranges.initial)
      apply_y2_sync()
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
    get hovered_ref_line_idx() {
      return hovered_ref_line_idx
    },
    set hovered_ref_line_idx(idx: number | null) {
      hovered_ref_line_idx = idx
    },
    get ref_lines() {
      return opts.ref_lines()
    },
    // Ranges/scales the reference lines resolve against (x2/y2 alias x/y until they carry data)
    get ref_line_axes() {
      return ref_line_axes
    },
    clip_path_id,
    facet: synced_facet,
    pan_zoom,
    legend_tween,
    legend_drag_start,
    legend_drag,
    legend_drag_end,
    get legend_is_dragging() {
      return legend_is_dragging
    },
    // Where a dragged legend was dropped (null while the solver owns its position)
    get legend_manual_position() {
      return legend_manual_position
    },
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
