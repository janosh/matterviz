// Reactive shell state shared by the hierarchical part-of-whole charts
// (Sunburst, Treemap): hierarchy ingestion, zoom/breadcrumb navigation, hover +
// tooltip state, legend muting, metric coloring, color-bar layout and keyboard
// plumbing. Everything here is geometry-agnostic — each chart keeps its own
// projection/tiling and hands it back through the `visible`, `node_center` and
// `legend_points` hooks. HierarchyShell.svelte renders the markup around it.

import type { D3InterpolateName } from '$lib/colors'
import type { Vec2 } from '$lib/math'
import { is_modifier_chord } from 'svelte-widgets/utils'
import type ColorBar from '$lib/plot/core/components/ColorBar.svelte'
import { closest_data_idx, is_activation_key, pointer_pos } from '$lib/plot/core/interactions'
import type { Sides } from '$lib/plot/core/layout'
import { filter_padding } from '$lib/plot/core/layout'
import { invalidate_text_metrics_after_fonts_ready } from '$lib/plot/core/text-metrics'
import type { LegendConfig, LegendItem } from '$lib/plot/core/types'
import type { ColorBarSide } from '$lib/plot/core/utils/hierarchy-chart'
import {
  ancestor_chain,
  arrow_nav_target,
  color_bar_layout,
  compute_metric_colors,
  compute_node_dim,
  compute_node_infos,
  hierarchy_legend_items,
  node_handler_props,
  resolve_label_font,
  selection_within,
  toggle_muted,
} from '$lib/plot/core/utils/hierarchy-chart'
import { export_chart_image } from '$lib/plot/core/utils/chart-export'
import { resolve_legend_visibility } from '$lib/plot/core/utils/series-visibility'
import type {
  OtherBucketInfo,
  PositionedArc,
  SunburstLabelText,
  SunburstLayoutOptions,
  SunburstNode,
  SunburstNodeHandlerProps,
  SunburstSort,
  SunburstValueMode,
} from '$lib/plot/core/utils/hierarchy-layout'
import { compute_sunburst_layout } from '$lib/plot/core/utils/hierarchy-layout'
import type { ComponentProps, Snippet } from 'svelte'
import { tick, untrack } from 'svelte'
import { SvelteSet } from 'svelte/reactivity'

type Point = { x: number; y: number }
type NodeProps<Metadata extends Record<string, unknown>> = SunburstNodeHandlerProps<Metadata>

// Shared public props; geometry options and content snippets stay on each component.
export interface HierarchyChartProps<Metadata extends Record<string, unknown>> {
  data?: SunburstNode<Metadata> | SunburstNode<Metadata>[]
  value_mode?: SunburstValueMode
  sort?: SunburstSort
  level_lighten?: number
  // Aggregate sibling nodes below this fraction of the total into one 'Other'
  // node per parent (only when >= 2 qualify); 0 disables
  min_fraction?: number
  // Children kept per parent, largest first; 0 (default) is unlimited. Unlike
  // `min_fraction` it guarantees a populated ring at any depth. Not a hard cap: a
  // parent one child over the limit keeps it rather than bucket a single sibling
  max_children?: number
  other_label?: string | ((bucket: OtherBucketInfo) => string)
  max_depth?: number // levels shown below the current zoom root (0 = all)
  show_labels?: boolean
  label_text?: SunburstLabelText // what labels display (plotly textinfo equivalent)
  zoom_on_click?: boolean
  zoom_root_id?: string | number | null // id of the node the view is rooted on
  show_breadcrumbs?: boolean // clickable ancestor trail when zoomed
  // Color nodes by a numeric metric (continuous colormap) instead of categorical
  // inheritance; return null to keep a node's categorical color
  color_values?: (node: PositionedArc<Metadata>) => number | null
  color_scale?: D3InterpolateName
  color_range?: Vec2 // defaults to the metric's [min, max]
  color_bar?: ComponentProps<typeof ColorBar> | null // null hides it
  color_bar_side?: ColorBarSide // side reserved for vertical color bars
  export_buttons?: boolean // SVG/PNG download buttons in the controls pane
  export_filename?: string
  value_format?: string
  padding?: Sides
  legend?: LegendConfig | null
  show_legend?: boolean
  tooltip?: Snippet<[NodeProps<Metadata>]>
  on_node_click?: (data: NodeProps<Metadata> & { event: MouseEvent | KeyboardEvent }) => void
  on_node_hover?: (
    data: (NodeProps<Metadata> & { event: MouseEvent | FocusEvent }) | null,
  ) => void
  on_zoom?: (data: { root: NodeProps<Metadata> | null }) => void
  header_controls?: Snippet<[{ height: number; width: number; fullscreen: boolean }]>
  controls_extra?: Snippet<[{ zoom_root_id: string | number | null }]>
}

// Every reactive input arrives as a thunk (rather than a value) so the chart can
// forward one of its `$props()` per line and each derived below only tracks what
// it actually reads.
interface HierarchyChartOptions<Metadata extends Record<string, unknown>> {
  // Picks the `data-<chart>-node-idx` attribute and CSS variable namespace.
  readonly chart: `sunburst` | `treemap`
  readonly uid: string
  readonly default_padding: Required<Sides>
  // Elements whose double-click must not reset the zoom because they run their
  // own click action, as a selector passed to Element.closest
  readonly dblclick_ignore?: string

  readonly data: () => SunburstNode<Metadata> | SunburstNode<Metadata>[]
  readonly layout_options: () => SunburstLayoutOptions
  readonly label_text: () => SunburstLabelText
  readonly value_format: () => string
  readonly width: () => number
  readonly height: () => number
  readonly padding: () => Sides
  readonly color_values: () => ((arc: PositionedArc<Metadata>) => number | null) | undefined
  readonly color_scale: () => D3InterpolateName
  readonly color_range: () => Vec2 | undefined
  readonly color_bar: () => ComponentProps<typeof ColorBar> | null
  readonly color_bar_side: () => ColorBarSide
  readonly legend: () => LegendConfig | null
  readonly show_legend: () => boolean | undefined
  readonly zoom_on_click: () => boolean
  readonly export_filename: () => string
  // Only charts that gate focusability on clickability pass this (Sunburst);
  // its presence is what puts `clickable` on the computed node infos
  readonly clickable?: (arc: PositionedArc<Metadata>) => boolean
  // Whether node_dim dims the nodes outside the hovered subtree/ancestry (Treemap, per
  // cell). Sunburst draws one veil path over its arcs instead, so its node_dim only
  // changes on legend muting and a hover never rewrites thousands of arcs.
  readonly per_node_hover_dim: boolean

  readonly zoom_root_id: () => string | number | null
  readonly set_zoom_root_id: (value: string | number | null) => void
  readonly set_hovered: (value: boolean) => void
  readonly fullscreen: () => boolean
  readonly set_fullscreen: (value: boolean) => void

  readonly on_node_click: NonNullable<HierarchyChartProps<Metadata>[`on_node_click`]>
  readonly on_node_hover: NonNullable<HierarchyChartProps<Metadata>[`on_node_hover`]>
  readonly on_zoom: NonNullable<HierarchyChartProps<Metadata>[`on_zoom`]>

  // Geometry hooks supplied by the chart
  readonly visible: (idx: number) => boolean // is this node currently rendered?
  readonly node_center: (idx: number) => Point | null // container (pad-offset) px
  readonly legend_points: () => Point[] // settled node centers the legend avoids
  readonly focus_after_zoom: () => void // keyboard zoom left the focused node unmounted
}

export class HierarchyChartState<
  Metadata extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly #opts: HierarchyChartOptions<Metadata>
  readonly chart: `sunburst` | `treemap`
  readonly node_attr: string
  // Unique per instance so multiple charts on one page don't collide on pattern SVG ids
  readonly uid: string
  // Depth-1 category ids muted via legend toggle (dimmed, not removed - keeps
  // the layout stable). Ids of nodes absent from the current data are inert.
  readonly muted_ids = new SvelteSet<string | number>()

  svg_element: SVGSVGElement | null = $state(null)
  wrapper: HTMLDivElement | undefined = $state()
  hovered_idx: number | null = $state(null)
  hover_info: NodeProps<Metadata> | null = $state(null)
  hover_pos: Point = $state({ x: 0, y: 0 })
  // Parents whose bucket the user opened. Read by the layout, which then leaves that
  // parent's children unbucketed; cleared on a reset so the chart returns to its
  // configured thresholds rather than staying permanently unfolded.
  expanded_parents = new SvelteSet<string | number>()
  // Whether `hover_pos` is a live cursor or a node center (keyboard focus). Only the
  // former has a pointer glyph for the tooltip to keep clear of.
  hover_at_pointer = $state(false)
  focused_idx: number | null = $state(null)
  colorbar_size: { width: number; height: number } = $state({ width: 0, height: 0 })
  // Bumped once webfonts resolve so labels measured against fallback fonts re-fit
  #font_metrics_revision = $state(0)

  // Must be constructed during component init: the layout-change effect below
  // needs an owner.
  constructor(opts: HierarchyChartOptions<Metadata>) {
    this.#opts = opts
    this.chart = opts.chart
    this.node_attr = `data-${opts.chart}-node-idx`
    this.uid = opts.uid
    // Data changed: clear the index-based hover/focus state, which would otherwise
    // leave a stale tooltip and highlight whatever unrelated node now occupies the
    // old index. untrack: writing hover state must not re-trigger this effect.
    $effect(() => {
      void this.arcs
      untrack(() => {
        this.set_hover(null)
        this.focused_idx = null
      })
    })
    $effect(() => {
      let mounted = true
      // fonts that never resolve keep the fallback measurements, which is fine
      void invalidate_text_metrics_after_fonts_ready().then(
        (revision) => {
          if (mounted) this.#font_metrics_revision = revision
        },
        () => {},
      )
      return () => {
        mounted = false
      }
    })
  }

  // `$derived.by` throughout: `#opts` is only assigned in the constructor, so a
  // bare `$derived(...)` expression referencing it reads as a use-before-init
  layout = $derived.by(() =>
    compute_sunburst_layout(this.#opts.data(), this.#opts.layout_options()),
  )
  arcs = $derived(this.layout.arcs)
  // Resolve the zoom root; stale ids (e.g. after a data swap) fall back to the root
  zoom_root = $derived.by(
    () => this.arcs.find((arc) => arc.id === this.#opts.zoom_root_id()) ?? this.layout.root,
  )
  zoomed = $derived((this.zoom_root?.depth ?? 0) > 0)
  breadcrumb_arcs = $derived(ancestor_chain(this.arcs, this.zoom_root))

  pad = $derived.by(() => filter_padding(this.#opts.padding(), this.#opts.default_padding))
  // Vertical color bars sit beside the chart and reserve width; horizontal ones
  // sit below and reserve height, so neither ever overlaps the geometry.
  cbar = $derived.by(() =>
    color_bar_layout({
      color_bar: this.color_bar,
      side: this.#opts.color_bar_side(),
      measured: this.colorbar_size,
      avail_width: Math.max(0, this.width - this.pad.l - this.pad.r),
      avail_height: Math.max(0, this.height - this.pad.t - this.pad.b),
      pad: this.pad,
      tick_space_var: `--${this.chart}-colorbar-tick-space`,
    }),
  )
  inner_width = $derived(this.cbar.inner_width)
  inner_height = $derived(this.cbar.inner_height)
  plot_left = $derived(this.cbar.plot_left)

  // Continuous metric coloring: when color_values is given, nodes are colored by
  // their metric on a d3 colormap (nodes returning null keep their categorical color)
  metric = $derived.by(() =>
    compute_metric_colors(
      this.arcs,
      this.#opts.color_values(),
      this.color_scale,
      this.#opts.color_range(),
    ),
  )
  color_for = (arc: PositionedArc<Metadata>): string =>
    this.metric?.colors[arc.node_idx] ?? arc.color
  // Legend muting per node, plus hover dimming (hovered node + ancestors/descendants stay
  // fully opaque, others dim) for charts that dim per node
  node_dim = $derived.by(() =>
    compute_node_dim(
      this.arcs,
      this.muted_ids,
      this.#opts.per_node_hover_dim ? this.hovered_idx : null,
    ),
  )

  label_font = $derived(resolve_label_font(this.svg_element))
  // Per-node label text, measured width, fill/label colors, aria string (and
  // clickability where the chart cares) - all zoom-independent, so computed once
  // per layout/option change instead of per animation frame
  node_infos = $derived.by(() => {
    void this.#font_metrics_revision
    return compute_node_infos(this.arcs, {
      label_text: this.#opts.label_text(),
      value_format: this.value_format,
      font: this.label_font,
      color_for: this.color_for,
      pattern_prefix: `${this.chart}-${this.uid}`,
      clickable: this.#opts.clickable,
    })
  })
  // Legend: one item per depth-1 category, toggling mutes (dims) rather than
  // removes. Nodes are labelled in place, so a legend stays opt-in here.
  depth1_arcs = $derived(this.arcs.filter((arc) => arc.depth === 1))
  legend_visible = $derived.by(() =>
    resolve_legend_visibility(
      this.#opts.show_legend(),
      this.legend,
      this.depth1_arcs.length,
      false,
    ),
  )
  legend_items: LegendItem[] = $derived(
    hierarchy_legend_items(this.depth1_arcs, this.muted_ids, this.color_for),
  )

  // Inputs HierarchyShell and the charts read back verbatim
  width = $derived.by(() => this.#opts.width())
  height = $derived.by(() => this.#opts.height())
  value_format = $derived.by(() => this.#opts.value_format())
  color_bar = $derived.by(() => this.#opts.color_bar())
  color_scale = $derived.by(() => this.#opts.color_scale())
  legend = $derived.by(() => this.#opts.legend())
  // Not a $derived: the setter has to reach the chart's own bindable prop
  get fullscreen(): boolean {
    return this.#opts.fullscreen()
  }
  set fullscreen(value: boolean) {
    this.#opts.set_fullscreen(value)
  }

  legend_points = (): Point[] => this.#opts.legend_points()

  readonly #node_props = (arc: PositionedArc<Metadata>): NodeProps<Metadata> =>
    node_handler_props(this.arcs, arc, this.color_for(arc))

  set_hover(idx: number | null, event?: MouseEvent | FocusEvent): void {
    if (idx == null) {
      // Both the svg and chart group report mouseleave; clear callbacks only once.
      if (this.hovered_idx == null && this.hover_info == null) return
      this.#opts.set_hovered(false)
      this.hovered_idx = null
      this.hover_info = null
      this.#opts.on_node_hover(null)
      return
    }
    // null for a FocusEvent (keyboard), where the node center stands in below
    const pointer = pointer_pos(event, this.svg_element)
    this.hover_at_pointer = Boolean(pointer)
    // Same node as before: only the cursor anchor moves - skip rebuilding the
    // handler payload and re-firing on_node_hover on every mousemove
    // within a node. Requires hover_info: legend item hover sets hovered_idx
    // alone (for dimming), and skipping then would leave the node's own tooltip
    // permanently suppressed.
    if (idx === this.hovered_idx && this.hover_info) {
      // Keyboard focus on the node the mouse last hovered has no pointer of its own;
      // keeping the old cursor position would anchor the tooltip wherever the mouse
      // happened to leave it, so fall back to the node's center as a fresh focus does
      this.hover_pos = pointer ?? this.#opts.node_center(idx) ?? this.hover_pos
      return
    }
    this.#opts.set_hovered(true)
    this.hovered_idx = idx
    this.hover_info = this.#node_props(this.arcs[idx])
    this.hover_pos = pointer ?? this.#opts.node_center(idx) ?? this.hover_pos
    if (event) this.#opts.on_node_hover({ ...this.hover_info, event })
  }

  clear_hover = (): void => this.set_hover(null)

  // Node idx carried by the event's nearest [data-<chart>-node-idx] element
  readonly #node_idx_from_event = (event: Event): number | null => {
    const idx = closest_data_idx(event, this.node_attr, this.svg_element)
    return idx != null && this.arcs[idx] ? idx : null
  }

  handle_hover_event = (event: MouseEvent | FocusEvent): void => {
    const idx = this.#node_idx_from_event(event)
    // roving tabindex follows keyboard focus
    if (event.type === `focusin` && idx != null) this.focused_idx = idx
    this.set_hover(idx, event)
  }

  // Re-root the view on the given node (or the data root when null) and notify
  zoom_to = (arc: PositionedArc<Metadata> | null): void => {
    const root = arc && arc.depth > 0 ? arc : null
    // Returning to the data root drops every manual expansion with it
    if (!root) this.expanded_parents.clear()
    this.#opts.set_zoom_root_id(root?.id ?? null)
    // The clicked node collapses into the hole / expands to fill the viewport -
    // drop the now-stale hover/tooltip
    this.set_hover(null)
    this.#opts.on_zoom({ root: root && this.#node_props(root) })
  }

  zoom_out = (event?: Event): void => {
    if (event instanceof MouseEvent && selection_within(this.wrapper)) return
    if (!this.zoomed) return
    this.zoom_to(this.breadcrumb_arcs.at(-2) ?? null)
  }

  handle_click = (event: MouseEvent | KeyboardEvent): void => {
    if (event instanceof MouseEvent && selection_within(this.wrapper)) return
    const idx = this.#node_idx_from_event(event)
    if (idx == null) return
    const arc = this.arcs[idx]
    this.#opts.on_node_click({ ...this.#node_props(arc), event })
    if (!this.#opts.zoom_on_click()) return
    // A bucket stands for nodes it does not itself contain, so zooming into it shows
    // one meaningless cell (Treemap did) or nothing at all (Sunburst, which refuses to
    // zoom leaves). Zoom to its parent instead: with the threshold measured against the
    // view root, that re-measures its siblings and dissolves the bucket into the real
    // nodes it stood for - clicking 'Other' shows you what is inside it.
    if (arc.is_other) {
      const parent = arc.parent_idx == null ? null : (this.arcs[arc.parent_idx] ?? null)
      // Exempt the parent as well as zooming to it. Re-measuring against the new view
      // root dissolves a `min_fraction` bucket, but `max_children` is a rank cap that
      // re-applies identically at any zoom, and a parent that is already the view root
      // does not move at all - in both cases the click would otherwise do nothing.
      if (parent) this.expanded_parents.add(parent.id)
      this.zoom_to(parent)
      return
    }
    if (this.chart === `sunburst`) {
      if (!arc.is_leaf && arc.id !== this.zoom_root?.id) this.zoom_to(arc)
    } else if (arc.id === this.zoom_root?.id) this.zoom_out()
    else this.zoom_to(arc)
  }

  // Double-clicking empty chart background resets the zoom to the root (double-
  // clicking a node or label is click-to-zoom/text-selection territory, not a reset)
  handle_dblclick = (event: MouseEvent): void => {
    if (this.#node_idx_from_event(event) != null || selection_within(this.wrapper)) return
    const ignore = this.#opts.dblclick_ignore
    if (ignore && (event.target as Element | null)?.closest?.(ignore)) return
    if (this.zoomed) this.zoom_to(null)
  }

  focus_node = (idx: number | null): void => {
    if (idx == null) return
    this.svg_element
      ?.querySelector<SVGGraphicsElement>(`[${this.node_attr}="${idx}"]`)
      ?.focus()
  }

  // Arrow-key navigation: left/right cycle through visible siblings (wrapping),
  // down enters the first child, up returns to the parent. The pre-order walk
  // lives in hierarchy-chart.ts (arrow_nav_target); this supplies the event's
  // node and the chart's current screen-space visibility.
  handle_keydown = (event: KeyboardEvent): void => {
    if (is_modifier_chord(event)) return // Cmd/Ctrl+Arrow scrolls the page
    const current_idx = this.#node_idx_from_event(event)
    const navigation_target =
      current_idx == null
        ? null
        : arrow_nav_target(this.arcs, this.#opts.visible, current_idx, event.key)
    if (navigation_target != null) {
      event.preventDefault()
      this.focus_node(navigation_target)
      return
    }
    if (!is_activation_key(event)) return
    event.preventDefault()
    const previous_root = this.#opts.zoom_root_id()
    this.handle_click(event)
    // Zooming via keyboard unmounts the focused node - hand focus to whatever
    // the chart nominates so keyboard users stay inside it
    if (this.#opts.zoom_root_id() !== previous_root) {
      void tick().then(() => this.#opts.focus_after_zoom())
    }
  }

  // Escape zooms out one level, then exits fullscreen at the root, but only
  // while the user is interacting with this chart.
  handle_escape = (event: KeyboardEvent): void => {
    if (event.key !== `Escape`) return
    const within =
      this.fullscreen ||
      (this.wrapper != null &&
        (this.wrapper.matches(`:hover`) || this.wrapper.contains(document.activeElement)))
    if (!within) return
    if (this.zoomed) this.zoom_out()
    else if (this.fullscreen) this.fullscreen = false
    else return
    event.preventDefault()
  }

  // Roving tabindex: the last-focused node while still rendered, else `first_visible`. Without
  // it, tabbing a large chart would visit every arc/cell.
  roving_idx = (first_visible: number | null): number | null =>
    this.focused_idx != null && this.#opts.visible(this.focused_idx)
      ? this.focused_idx
      : first_visible

  toggle_category = (series_idx: number): void =>
    toggle_muted(this.muted_ids, this.depth1_arcs[series_idx]?.id)

  legend_hover = (item: { series_idx: number } | null): void => {
    this.hovered_idx =
      item != null && item.series_idx >= 0
        ? (this.depth1_arcs[item.series_idx]?.node_idx ?? null)
        : null
  }

  export_chart = (format: `svg` | `png`): void =>
    export_chart_image(this.svg_element, this.#opts.export_filename(), format)
}

// zoom_root_id reaches the layout only while bucketing measures against the view root; else a
// zoom would rebuild the layout (re-measuring every label) for an identical result.
export const hierarchy_layout_options = (
  opts: SunburstLayoutOptions & { min_fraction: number; max_children: number },
): SunburstLayoutOptions => ({
  ...opts,
  zoom_root_id: opts.min_fraction > 0 || opts.max_children > 0 ? opts.zoom_root_id : null,
})
