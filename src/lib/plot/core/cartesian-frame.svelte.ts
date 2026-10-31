// Shared reactive scaffold behind the Cartesian charts: axis range sync, auto padding,
// ticks, scales, decoration/legend placement and pan/zoom. Charts feed axis configs, auto
// ranges and obstacles and read back scales/pad/ticks. Creates $effects, so call it during
// component init. Render the returned state with CartesianFrame.svelte.

import {
  normalize_show_controls,
  shows_fullscreen_toggle,
  type ShowControlsProp,
} from '#lib/controls.js'
import { clamp, type Vec2 } from '#lib/math.js'
import type {
  DecorationItem,
  DecorationSolution,
  LegendCellSizes,
} from '#lib/plot/core/decorations/index.js'
import {
  create_legend_decoration_item,
  decoration_placement_revision,
  decoration_placement_rects,
  get_decoration_placement,
  has_explicit_position,
  measured_footprint,
  solve_decorations,
  legend_cell_sizes,
  legend_wrap_size,
} from '#lib/plot/core/decorations/index.js'
import { create_facet_plot_adapter } from '#lib/plot/core/facet-layout.svelte.js'
import { FACET_AXES, type FacetAxis, type FacetLayoutContext } from '#lib/plot/core/facets.js'
import {
  axis_ranges_equal,
  axis_transform,
  expand_range_if_needed,
  invert_rect_range,
  normalize_y2_sync,
  resolve_axis_ranges,
  snapshot_ranges,
  sync_y2_range,
  vec2_equal,
} from '#lib/plot/core/interactions.js'
import type { Rect, Sides } from '#lib/plot/core/layout.js'
import {
  calc_auto_padding,
  DEFAULT_PLOT_PADDING,
  filter_padding,
  sides_equal,
} from '#lib/plot/core/layout.js'
import type { ResolvedMarginals } from '#lib/plot/core/marginals.js'
import { reserve_marginal_pad } from '#lib/plot/core/marginals.js'
import { create_pan_zoom } from '#lib/plot/core/pan-zoom.svelte.js'
import { create_placed_tween } from '#lib/plot/core/placed-tween.svelte.js'
import type { PlotTitleProp } from '#lib/plot/core/plot-title.js'
import { normalize_plot_title, pad_for_plot_title } from '#lib/plot/core/plot-title.js'
import { index_ref_lines, solve_reference_annotations } from '#lib/plot/core/reference-line.js'
import { create_axis_scales, generate_ticks, log_floor_scale } from '#lib/plot/core/scales.js'
import type { FontSpec } from '#lib/plot/core/text-metrics.js'
import {
  arrays_equal,
  measured_axis,
  resolve_tick_layout,
} from '#lib/plot/core/tick-layout.js'
import type {
  AxisConfig,
  AxisRanges,
  LegendConfig,
  PanConfig,
  RefLine,
  RefLineEvent,
} from '#lib/plot/core/types.js'
import { unique_id } from '#lib/plot/core/utils.js'
import { untrack } from 'svelte'
import { SvelteSet } from 'svelte/reactivity'

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
  // Whether CartesianFrame draws its corner controls row, which a y2 axis's top tick avoids
  controls_row: () => boolean
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
  // Raw `ref_lines` prop and its handlers; the frame indexes and filters them itself
  ref_lines?: () => readonly RefLine[] | undefined
  on_ref_line_click?: () => ((event: RefLineEvent) => void) | undefined
  on_ref_line_hover?: () => ((event: RefLineEvent | null) => void) | undefined
  pan: () => PanConfig | undefined
  facet_layout: () => FacetLayoutContext | undefined
  // Ranges the padding pass measures against inside a facet grid. Defaults to
  // `auto_ranges`; Histogram re-bins against the reconciled x domain first.
  facet_ranges?: () => AxisRanges
  // Axis configs whose `range` overrides feed the range sync. Defaults to `axes`;
  // Histogram log-sanitizes its count axes here.
  range_sources?: () => Record<FacetAxis, Pick<AxisConfig, `range` | `scale_type`>>
  // Unset resnaps every axis whenever any changes. `per-axis` leaves a panned axis alone
  // when another axis's auto range moves; `expand` also keeps the view on an axis with no
  // data behind it (see `has_data`) so the chart doesn't jump.
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
  // Replace a shown axis's generated ticks (e.g. one per category); empty arrays are ignored
  tick_override?: (axis: FacetAxis) => number[] | undefined
  // Axis configs used only when measuring tick labels (categorical axes measure their
  // category labels rather than the numeric slot indices)
  measured_axes?: () => PerAxis<AxisConfig>
  // Prefix of the generated clip-path id
  clip_id_prefix?: string
}

export type CartesianFrame = ReturnType<typeof create_cartesian_frame>

// Whether CartesianFrame draws its corner controls row: the settings toggle or fullscreen button
export const has_controls_row = (
  show_controls: ShowControlsProp<`controls` | `fullscreen`> | undefined,
  fullscreen_toggle: boolean,
): boolean => {
  const config = normalize_show_controls(show_controls)
  return config.visible(`controls`) || shows_fullscreen_toggle(fullscreen_toggle, config)
}

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
  // One collapse set (the caller's, else the frame's) shared by PlotLegend and the solver
  const own_collapsed_groups = new SvelteSet<string>()
  const legend_collapsed_groups = $derived(
    opts.legend()?.collapsed_groups ?? own_collapsed_groups,
  )
  const clip_path_id = unique_id(opts.clip_id_prefix ?? `plot-clip`)

  // `initial` is the configured view and reset target; `current` is the live view gestures
  // edit. The frame never writes axis props, so pins survive gestures. The two must never
  // share a Vec2 or an in-place edit would rewrite the reset target (hence snapshot_ranges).

  let ranges = $state<{ initial: AxisRanges; current: AxisRanges }>({
    initial: { x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] },
    current: { x: [0, 1], x2: [0, 1], y: [0, 1], y2: [0, 1] },
  })

  // base_pad reserves space for tick labels/axis titles; `pad` adds decoration reservations
  let base_pad = $derived(filter_padding(opts.padding(), DEFAULT_PLOT_PADDING))
  // The same without the caller's padding. Outside decorations stack on this, so callers
  // padding past the axis band get the decoration inside that room rather than on top of it.
  let axis_pad = $derived(DEFAULT_PLOT_PADDING)
  // Explicit top/bottom padding stops the plot measuring its axes there: this is the axes'
  // need, floored at the explicit value, which ScatterPlot reports as resolved_padding so
  // hosts sharing one padding across plots (BandsAndDos) raise it to fit.
  let fit_pad = $derived(DEFAULT_PLOT_PADDING)
  const title_config = $derived(normalize_plot_title(opts.title()))
  const axis_shown = (axis: FacetAxis): boolean =>
    axis === `x2` ? opts.has_x2() : axis === `y2` ? opts.has_y2() : true
  const measured_axis_config = (axis: FacetAxis): AxisConfig =>
    opts.measured_axes?.()[axis] ?? opts.axes()[axis]

  // Each axis config keeps its object while its fields hold: callers rebuild them on every data
  // change, and every tick of an axis reads its config, so a new but equal one re-renders all
  let last_axes: ReturnType<typeof opts.axes> | undefined
  const stable_axes = $derived.by(() => {
    const next = opts.axes()
    const prev = last_axes
    if (!prev) return (last_axes = next)
    const same = (axis: FacetAxis): boolean => {
      const [old_config, new_config] = [prev[axis], next[axis]] as Record<string, unknown>[]
      const keys = Object.keys(new_config)
      return (
        keys.length === Object.keys(old_config).length &&
        keys.every((key) => Object.is(old_config[key], new_config[key]))
      )
    }
    if (FACET_AXES.every(same)) return prev
    last_axes = { ...next }
    for (const axis of FACET_AXES) if (same(axis)) last_axes[axis] = prev[axis]
    return last_axes
  })

  const facet = create_facet_plot_adapter({
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
      if (!width || !height || !axis_shown(axis)) return []
      const override = opts.tick_override?.(axis)
      if (override?.length) return override
      const config = opts.axes()[axis]
      return generate_ticks(
        axis_ranges[axis],
        config.scale_type ?? `linear`,
        config.ticks,
        axis_scales[axis],
        {
          default_count: opts.tick_counts?.[axis] ?? DEFAULT_TICK_COUNTS[axis],
          format: config.format,
        },
      )
    }
    return Object.fromEntries(FACET_AXES.map((axis) => [axis, axis_ticks(axis)])) as Record<
      FacetAxis,
      number[]
    >
  }

  // y2 can be tied to y ('synced' shares y's range, 'align' pins a common value to the same
  // relative height), as a post-pass over `current` so every writer lands on the same y2.
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
  // The bridge every range write goes through (incl. callers' `view`/bin-click writes), so
  // a synced y2 is never left stale until something unrelated re-runs the range effect.
  const synced_facet = {
    ...facet,
    update_range: (axis: FacetAxis, range: Vec2): void => {
      if (axis === `y2` && y2_sync.mode !== `none`) return // derived from y, not settable
      facet.update_range(axis, range)
      // via update_range so a facet grid receives the derived y2 as well
      if (axis === `y` && y2_sync.mode !== `none`) facet.update_range(`y2`, synced_y2())
    },
  }

  // Re-derive y2 as soon as the mode toggles, before the range effect reads `current`.
  // Last applied mode; plain since only this effect reads it
  let prev_sync_mode = `none`
  $effect.pre(() => {
    if (y2_sync.mode === prev_sync_mode) return
    prev_sync_mode = y2_sync.mode
    ranges.current.y2 =
      y2_sync.mode === `none` ? ([...untrack(() => ranges.initial.y2)] as Vec2) : synced_y2()
  })

  // A 'synced' y2 copies y's range, so y's auto range (and data flag) covers the y2 data too,
  // or is y2's alone while no y data backs it
  const synced_auto = $derived.by(() => {
    const [auto, has_data] = [opts.auto_ranges(), opts.has_data?.() ?? {}]
    if (y2_sync.mode !== `synced` || !opts.has_y2() || has_data.y2 === false) {
      return { auto, has_data }
    }
    const bounds = has_data.y === false ? auto.y2 : [...auto.y, ...auto.y2]
    const [lo, hi] = [Math.min(...bounds), Math.max(...bounds)]
    const y: Vec2 = auto.y[0] > auto.y[1] ? [hi, lo] : [lo, hi]
    return { auto: { ...auto, y }, has_data: { ...has_data, y: true } }
  })

  // Each axis's explicit bounds as last synced: a changed one moves a zoomed view too
  const synced_bounds: PerAxis<string> = {}
  // Sync ranges from axis.range overrides and auto ranges, skipping transient non-finite
  // bounds (NaN breaks scales and loops the effect). Runs pre-render so new data is never
  // culled against stale ranges, which would remount markers and discard their tweens.
  const sync_ranges = () => {
    const sources = opts.range_sources?.() ?? opts.axes()
    const next = resolve_axis_ranges(sources, synced_auto.auto)
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
      const { has_data } = synced_auto
      for (const axis of FACET_AXES) {
        const pinned = sources[axis].range?.some((bound) => bound != null) ?? false
        const bounds = JSON.stringify(sources[axis].range ?? null)
        const bounds_moved = bounds !== (synced_bounds[axis] ??= bounds)
        synced_bounds[axis] = bounds
        const { range, changed } = expand_range_if_needed(
          initial[axis],
          next[axis],
          (has_data[axis] ?? true) || pinned,
        )
        // A moved bound counts even when it lands on the current range (a host pinning the
        // auto range it shows to undo a zoom)
        if (!changed && !bounds_moved) continue
        // A zoomed or panned view stays put while the auto range grows (it also grows when the
        // plot shrinks: its padding is in px), and the reset target follows; a changed explicit
        // bound is the caller's new view. Copy: it must not alias the live range.
        const zoomed = !vec2_equal(
          untrack(() => ranges.current[axis]),
          initial[axis],
        )
        ranges.initial[axis] = range
        if (!zoomed || bounds_moved) ranges.current[axis] = [...range] as Vec2
      }
    } else if (!axis_ranges_equal(initial, next)) {
      ranges = { initial: { ...next }, current: snapshot_ranges(next) }
    }
    // sync after the grid reconciles, or a facet panel derives y2 from the pre-grid y
    facet.apply_ranges()
    apply_y2_sync()
  }
  // Some callers initialize auto ranges after creating the frame. The first post effect
  // resolves them before decorations place themselves; later updates precede mark rendering.
  let initialized = $state(false)
  $effect(() => {
    untrack(sync_ranges)
    initialized = true
  })
  $effect.pre(() => {
    if (initialized) sync_ranges()
  })

  // Dynamic padding from measured tick labels and the title; sides_equal stops the pad write
  // from looping when nothing moved
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
    const auto_pad = (
      padding: Sides,
      default_padding: Required<Sides> = DEFAULT_PLOT_PADDING,
    ): Required<Sides> =>
      pad_for_plot_title(
        width && height
          ? calc_auto_padding({
              padding,
              default_padding,
              width,
              height,
              controls_row: opts.controls_row(),
              ...measured_axes,
            })
          : filter_padding(padding, default_padding),
        title_config,
        width,
        height,
      )
    const explicit_pad = opts.padding()
    const new_pad = auto_pad(explicit_pad)
    if (!sides_equal(base_pad, new_pad)) base_pad = new_pad
    const { t, b, ...sides } = explicit_pad
    const new_fit_pad =
      t == null && b == null
        ? new_pad
        : auto_pad(sides, filter_padding({ t, b }, DEFAULT_PLOT_PADDING))
    if (!sides_equal(fit_pad, new_fit_pad)) fit_pad = new_fit_pad
    // without explicit sides, the axes' own need is the pad just computed
    const explicit = Object.values(explicit_pad).some((side) => side != null)
    const new_axis_pad = explicit ? auto_pad({}) : new_pad
    if (!sides_equal(axis_pad, new_axis_pad)) axis_pad = new_axis_pad
  })

  const legend_has_explicit_pos = $derived(has_explicit_position(opts.legend()?.style))
  // Legend box, measured in an effect after DOM writes (a lazy read between writes forces a
  // reflow). Re-measured on legend content resize (revision bump), plot resize (right/bottom
  // anchored legends move) and legend style changes.
  const legend_footprint_fallback = opts.legend_footprint_fallback ?? {
    width: 120,
    height: 60,
  }
  let legend_footprint = $state(legend_footprint_fallback)
  let legend_cells = $state.raw<LegendCellSizes | null>(null)
  let legend_offset = $state({ x: 0, y: 0 })
  $effect(() => {
    void [legend_size_revision, width, height, opts.legend()?.style]
    const element = legend_element
    const size = measured_footprint(element, legend_footprint_fallback)
    const cells = element ? legend_cell_sizes(element) : null
    const offset =
      element && legend_has_explicit_pos
        ? { x: element.offsetLeft, y: element.offsetTop }
        : { x: 0, y: 0 }
    untrack(() => {
      if (size.width !== legend_footprint.width || size.height !== legend_footprint.height) {
        legend_footprint = size
      }
      if (JSON.stringify(cells) !== JSON.stringify(legend_cells)) legend_cells = cells
      if (offset.x !== legend_offset.x || offset.y !== legend_offset.y) legend_offset = offset
    })
  })
  // A legend left to the frame's layout (no layout or layout_tracks) is placed by the column
  // it takes inside or beside the plot and wraps into a row below it (legend_wraps), both sized
  // from its cells, never from the layout it renders in now (see legend_cell_sizes)
  const legend_managed = $derived(
    opts.legend()?.layout == null && opts.legend()?.layout_tracks == null,
  )
  const legend_sizes = $derived.by(() => {
    if (!legend_managed || !legend_cells) return undefined
    const { l, r } = effective_base_pad // the base plot width the solver centres the strip on
    const strip_width = width - l - r - marginal_pad.l - marginal_pad.r
    return {
      column: legend_wrap_size(legend_cells, 0),
      strip: legend_wrap_size(legend_cells, strip_width),
    }
  })

  // Legend drag: a legend the user grabbed or dropped owns its position; the solver only
  // routes around it (via exclusion rects) from then on.
  let legend_is_dragging = $state(false)
  let legend_manual_position = $state<{ x: number; y: number } | null>(null)
  // Cursor offset in the legend and the SVG's client origin, captured at drag start to avoid
  // a reflow per mousemove; plain since only the handlers read them
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
    const { x: coord_x, y: coord_y } = legend_manual_position
    const constrained = constrain_legend_position(legend_manual_position, legend_footprint)
    if (constrained.x !== coord_x || constrained.y !== coord_y)
      legend_manual_position = constrained
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
  const legend_pinned_rects: Rect[] = $derived(
    legend_element && (legend_has_explicit_pos || legend_is_dragging || legend_manual_position)
      ? [{ ...(legend_manual_position ?? legend_offset), ...legend_footprint }]
      : [],
  )

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
      column_footprint: legend_sizes?.column,
      strip_footprint: legend_sizes?.strip,
      items: opts.legend_items(),
      config: {
        ...opts.legend(),
        collapsed_groups: legend_collapsed_groups,
        filter_query: legend_filter_query,
      },
    }),
  )
  const pinned_rects = $derived([...legend_pinned_rects, ...(opts.exclusion_rects?.() ?? [])])
  const marginal_pad = $derived(reserve_marginal_pad(opts.marginals()))
  // A legend drag holds the layout: re-solving per mousemove would evict and re-admit the
  // decorations it passes over, resizing the plot under the cursor. The drop re-solves once.
  // A pan holds it too: each frame would rebuild the obstacle field from every mark (most of
  // a 100k-point or many-line pan frame) only to move the legend under the cursor. The
  // gesture's end re-solves against where the data landed. A pan re-solves early only when
  // the frame's own geometry moves (tick labels widening the axis pad, a resize).
  let held_solution: DecorationSolution | undefined
  let held_geometry: { axis_pad: Required<Sides>; width: number; height: number } | undefined
  const base_decoration_solution = $derived.by(() => {
    const frame_axis_pad = facet.padding(axis_pad)
    const same_geometry =
      held_geometry !== undefined &&
      sides_equal(held_geometry.axis_pad, frame_axis_pad) &&
      held_geometry.width === width &&
      held_geometry.height === height
    if (held_solution && (legend_is_dragging || (pan_zoom.is_panning && same_geometry)))
      return held_solution
    held_geometry = { axis_pad: frame_axis_pad, width, height }
    const items = [...(legend_item ? [legend_item] : []), ...(opts.decorations?.() ?? [])]
    return (held_solution = solve_decorations({
      base_pad: effective_base_pad,
      reserved_pad: marginal_pad,
      axis_pad: frame_axis_pad,
      width,
      height,
      // only placed items dodge the data: with none, a pan frame never rebuilds the obstacles
      obstacles_norm: items.length ? opts.obstacles() : [],
      exclusion_rects: pinned_rects,
      items,
    }))
  })
  // pad, scales and ticks keep their identity while their values hold: the solver re-runs on
  // every data change (its obstacles are the data), and a new pad, scale or tick array would
  // re-project every point, line and tick of the plot even though no axis moved
  let last_pad: Required<Sides> | undefined
  const pad = $derived.by(() => {
    const next = base_decoration_solution.pad
    if (!last_pad || !sides_equal(last_pad, next)) last_pad = next
    return last_pad
  })
  const outside_pad = $derived.by(() => {
    const bands = { t: 0, b: 0, l: 0, r: 0 }
    for (const placement of base_decoration_solution.placements) {
      const { location, side, footprint } = placement
      if (location !== `outside`) continue
      if (side === `top`) bands.t = Math.max(bands.t, placement.y + footprint.height)
      else if (side === `bottom`) bands.b = Math.max(bands.b, height - placement.y)
      else if (side === `left`) bands.l = Math.max(bands.l, placement.x + footprint.width)
      else if (side === `right`) bands.r = Math.max(bands.r, width - placement.x)
    }
    return bands
  })
  const chart_width = $derived(Math.max(1, width - pad.l - pad.r))
  const chart_height = $derived(Math.max(1, height - pad.t - pad.b))

  let last_scales: { key: string; value: ReturnType<typeof create_axis_scales> } | undefined
  const scales = $derived.by(() => {
    const axes = opts.axes()
    const { current } = ranges
    const key = JSON.stringify([
      FACET_AXES.map((axis) => [axes[axis].scale_type ?? `linear`, current[axis]]),
      pad,
      width,
      height,
    ])
    if (last_scales?.key !== key) {
      last_scales = { key, value: create_axis_scales(axes, current, pad, width, height) }
    }
    return last_scales.value
  })
  // Each axis's px per unit of its transformed metric (see axis_transform). A pan keeps it up
  // to round-off, so the last record is handed back while every axis stays within 1e-9 of it:
  // layout keyed on it (density levels, swarm packing) reruns on zoom or resize, not per pan
  let last_px_per_unit: Record<FacetAxis, number> | undefined
  const px_per_unit = $derived.by(() => {
    const next = Object.fromEntries(
      FACET_AXES.map((axis) => {
        const { forward } = axis_transform(opts.axes()[axis].scale_type)
        const [[dom_lo, dom_hi], [px_lo, px_hi]] = [
          scales[axis].domain(),
          scales[axis].range(),
        ]
        return [axis, (px_hi - px_lo) / (forward(dom_hi) - forward(dom_lo))]
      }),
    ) as Record<FacetAxis, number>
    const prev = last_px_per_unit
    const near = (axis: FacetAxis) =>
      prev !== undefined && Math.abs(next[axis] - prev[axis]) <= 1e-9 * Math.abs(next[axis])
    return FACET_AXES.every(near) && prev ? prev : (last_px_per_unit = next)
  })
  let last_ticks: Record<FacetAxis, number[]> | undefined
  const ticks = $derived.by(() => {
    const next = compute_ticks(scales, ranges.current)
    const prev = last_ticks
    if (prev && FACET_AXES.every((axis) => arrays_equal(prev[axis], next[axis]))) return prev
    return (last_ticks = next)
  })
  // Ref lines on a data-less x2/y2 (whose scales are [0, 1] sentinels) resolve against the
  // primary axis, so charts without secondary axes still honour `x_axis: 'x2'`
  const ref_line_axes = $derived.by(() => {
    const coord_x = opts.has_x2() ? `x2` : `x`
    const coord_y_2 = opts.has_y2() ? `y2` : `y`
    const { current } = ranges
    return {
      ranges: { x: current.x, x2: current[coord_x], y: current.y, y2: current[coord_y_2] },
      scales: { x: scales.x, x2: scales[coord_x], y: scales.y, y2: scales[coord_y_2] },
    }
  })
  const ref_lines = $derived(index_ref_lines(opts.ref_lines?.()))
  const decoration_solution = $derived(
    ref_lines.length === 0
      ? base_decoration_solution
      : solve_reference_annotations({
          base_solution: base_decoration_solution,
          base_pad: pad,
          width,
          height,
          obstacles_norm: opts.obstacles(),
          lines: ref_lines,
          ...ref_line_axes,
        }),
  )
  const legend_placement = $derived(get_decoration_placement(decoration_solution, `legend`))
  // A managed legend below the plot wraps into a row; a dragged or dropped one keeps the wrap
  // it had (last_below: non-reactive memory of the solver's side)
  let last_below = false
  const legend_wraps = $derived.by(() => {
    if (!legend_is_dragging && !legend_manual_position) {
      last_below =
        legend_placement?.location === `outside` && legend_placement.side === `bottom`
    }
    return legend_managed && last_below
  })
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
    // A data-less x2/y2 would pan its [0, 1] sentinel and share that phantom range with a grid
    axes: () =>
      FACET_AXES.filter(
        (axis) => axis_shown(axis) && (axis !== `y2` || y2_sync.mode === `none`),
      ),
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
      // The live range keeps reversed axes reversed. Gate x2/y2 on real data: their
      // sentinel [0, 1] scales would store a phantom range.
      const zoom_axis = (axis: FacetAxis, from_px: number, to_px: number) => {
        if (!axis_shown(axis)) return null
        const range = invert_rect_range(scales[axis], from_px, to_px, ranges.current[axis])
        if (range) synced_facet.update_range(axis, range)
        return range
      }
      if (!zoom_axis(`x`, start.x, current.x)) return
      zoom_axis(`x2`, start.x, current.x)
      zoom_axis(`y`, start.y, current.y)
      // A synced y2 already followed the y zoom above; the bridge drops this one
      zoom_axis(`y2`, start.y, current.y)
    },
    on_reset: () => {
      if (facet.reset_ranges()) return
      ranges.current = snapshot_ranges(ranges.initial)
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
    get legend_collapsed_groups() {
      return legend_collapsed_groups
    },
    // Series the legend is hovering, dimmed by the charts' marks
    get hovered_series_idx() {
      return hovered_series_idx
    },
    set hovered_series_idx(idx: number | null) {
      hovered_series_idx = idx
    },
    // Opacity of a series' marks: faded while the legend hovers another series
    series_opacity: (series_idx: number): number =>
      hovered_series_idx !== null && hovered_series_idx !== series_idx ? 0.25 : 1,
    get hovered_ref_line_idx() {
      return hovered_ref_line_idx
    },
    set hovered_ref_line_idx(idx: number | null) {
      hovered_ref_line_idx = idx
    },
    get ref_lines() {
      return ref_lines
    },
    get on_ref_line_click() {
      return opts.on_ref_line_click?.()
    },
    get on_ref_line_hover() {
      return opts.on_ref_line_hover?.()
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
      return stable_axes
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
    get fit_pad() {
      return fit_pad
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
    get px_per_unit() {
      return px_per_unit
    },
    // Pixel scale of a value axis whose log floor holds bar bases and whisker lows at the
    // axis minimum instead of NaN geometry (`scales` for a tweened or facet-local set). The
    // floor is the scale's own (positive) domain: the view's range can still reach below zero
    // on a log axis (one switched to log over signed data), and a floor there maps to NaN.
    value_scale: (axis: FacetAxis, axis_scales = scales) =>
      log_floor_scale(
        axis_scales[axis],
        opts.axes()[axis].scale_type,
        axis_scales[axis].domain(),
      ),
    // Whether a pixel lies in the plot area, edges included
    in_plot: (coord_x: number, coord_y: number): boolean =>
      coord_x >= pad.l &&
      coord_x <= width - pad.r &&
      coord_y >= pad.t &&
      coord_y <= height - pad.b,
    get ticks() {
      return ticks
    },
    get tick_label_widths() {
      return tick_label_widths
    },
    get title_config() {
      return title_config
    },
    get outside_pad() {
      return outside_pad
    },
    get decoration_solution() {
      return decoration_solution
    },
    get legend_placement() {
      return legend_placement
    },
    get legend_wraps() {
      return legend_wraps
    },
    get legend_strip() {
      return legend_sizes?.strip
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
    // The controls' range reset targets: x2/y2 only while they carry data
    get controls_auto_ranges() {
      const { auto } = synced_auto
      return {
        ...auto,
        x2: opts.has_x2() ? auto.x2 : undefined,
        y2: opts.has_y2() ? auto.y2 : undefined,
      }
    },
    get legend_visible() {
      return opts.legend_visible()
    },
  }
}

// === Pan anchor ===
// A pan only translates the plot (px per unit holds, see px_per_unit), so while one runs, marks
// can keep the projection of the view the pan started from and be shifted instead of
// re-projected and re-rendered per frame. `scales` is that view's (the live ones while no pan
// runs or `enabled` is off), `shift` the px to translate marks on an x/y axis pair by (null when
// none). Marks cropped to the view are cropped `reach` px (a plot width or height) past each
// side of the anchored view along `cropped_axes`, and re-anchor once the pan travels that far.
// Call during component init.
export function create_pan_anchor(
  frame: Pick<
    CartesianFrame,
    `scales` | `px_per_unit` | `pad` | `chart_width` | `chart_height` | `pan_zoom`
  >,
  enabled: () => boolean,
  cropped_axes: readonly FacetAxis[],
) {
  type Anchor = Pick<CartesianFrame, `scales` | `px_per_unit` | `pad`>
  let anchor: Anchor | null = null
  const view = $derived.by(() => {
    const { scales, px_per_unit, pad } = frame
    // the view at rest is the anchor a pan starts from
    if (!frame.pan_zoom.is_panning || !enabled()) {
      anchor = enabled() ? { scales, px_per_unit, pad } : null
      return { scales, reach: { x: 0, y: 0 }, shift: null }
    }
    // px the live scale puts the anchor's view origin at, relative to where the anchor did
    const shift_of = (from: Anchor, axis: FacetAxis) =>
      scales[axis](from.scales[axis].domain()[0]) - from.scales[axis].range()[0]
    const reach = { x: frame.chart_width, y: frame.chart_height }
    const prev = anchor
    const valid =
      prev?.px_per_unit === px_per_unit &&
      prev.pad === pad &&
      cropped_axes.every(
        (axis) => Math.abs(shift_of(prev, axis)) <= reach[axis.startsWith(`x`) ? `x` : `y`],
      )
    const current = valid ? prev : (anchor = { scales, px_per_unit, pad })
    const shift = Object.fromEntries(
      FACET_AXES.map((axis) => [axis, shift_of(current, axis)]),
    ) as Record<FacetAxis, number>
    return { scales: current.scales, reach, shift }
  })
  // Apart, so that consumers re-run only when the anchor moves, not with the shift per frame
  const scales = $derived(view.scales)
  const reach_x = $derived(view.reach.x)
  const reach_y = $derived(view.reach.y)
  const reach = $derived({ x: reach_x, y: reach_y })
  return {
    get scales() {
      return scales
    },
    get reach() {
      return reach
    },
    // SVG transform of marks drawn on these axes (none unless anchored mid-pan)
    transform: (x_axis: `x` | `x2`, y_axis: `y` | `y2`): string | undefined => {
      const { shift } = view
      if (!shift) return undefined
      const [shift_x, shift_y] = [shift[x_axis], shift[y_axis]]
      return shift_x || shift_y ? `translate(${shift_x} ${shift_y})` : undefined
    },
  }
}
