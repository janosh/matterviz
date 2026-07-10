// State/interaction helpers shared by the hierarchical part-of-whole charts
// (Sunburst, Treemap): metric coloring, hover/mute dimming, handler payloads,
// breadcrumbs and keyboard plumbing. All pure functions over the flat pre-order
// arc arrays that compute_sunburst_layout produces — each component keeps only
// its geometry-specific logic (polar projection vs squarified tiling).

import type { D3InterpolateName } from '$lib/colors'
import type { Vec2 } from '$lib/math'
import { get_relative_coords } from '$lib/plot/core/interactions'
import { create_color_scale } from '$lib/plot/core/scales'
import type { LegendItem } from '$lib/plot/core/types'
import { node_display_name, node_label_variants } from '$lib/plot/core/utils/hierarchy-labels'
import type {
  PositionedArc,
  SunburstLabelText,
  SunburstLayoutOptions,
  SunburstLayoutResult,
  SunburstNode,
  SunburstNodeHandlerProps,
} from '$lib/plot/sunburst/sunburst'
import { compute_sunburst_layout } from '$lib/plot/sunburst/sunburst'

// Degrade to an empty layout (instead of crashing the host page) on invalid data
export function safe_hierarchy_layout<Metadata>(
  data: SunburstNode<Metadata> | SunburstNode<Metadata>[],
  opts: SunburstLayoutOptions,
): SunburstLayoutResult<Metadata> {
  try {
    return compute_sunburst_layout(data, opts)
  } catch (err) {
    console.error(err)
    return { arcs: [], root: null, max_depth: 0 }
  }
}

// Continuous metric coloring: when color_values is given, nodes are colored by
// their metric on a d3 colormap (nodes returning null keep their categorical
// color). The user accessor runs exactly once per node.
export function compute_metric_colors<Metadata>(
  arcs: readonly PositionedArc<Metadata>[],
  color_values: ((arc: PositionedArc<Metadata>) => number | null) | undefined,
  color_scale: D3InterpolateName,
  color_range?: Vec2,
): { range: Vec2; colors: string[] } | null {
  if (!color_values) return null
  const vals = arcs.map((arc) => {
    const val = arc.depth === 0 ? null : color_values(arc)
    return val != null && Number.isFinite(val) ? val : null
  })
  // iterative min/max: spreading into Math.min/max overflows the call stack
  // for very large arc arrays
  let min_val = Infinity
  let max_val = -Infinity
  for (const val of vals) {
    if (val == null) continue
    if (val < min_val) min_val = val
    if (val > max_val) max_val = val
  }
  if (min_val > max_val) return null // no finite values
  const range = color_range ?? [min_val, max_val]
  const scale = create_color_scale({ scheme: color_scale, value_range: range }, range)
  return {
    range,
    colors: vals.map((val, idx) => (val == null ? arcs[idx].color : scale(val))),
  }
}

const MUTED_OPACITY = 0.12

// Legend muting + hover dimming per node, indexed by node_idx. The hovered node
// + its ancestors/descendants stay fully opaque, other nodes dim to 0.3; muted
// categories dim hardest. Pre-order indexing makes the ancestor/descendant
// tests O(1): a subtree is the contiguous index range [node_idx, subtree_end].
// Zoom-independent: recomputed only when hover/mute state changes, so during
// zoom tweens (where geometry re-evaluates per frame) this is an array lookup.
export function compute_node_dim<Metadata>(
  arcs: readonly PositionedArc<Metadata>[],
  muted_ids: ReadonlySet<string | number>,
  hovered_idx: number | null,
): { opacity: number; label_opacity: number | undefined }[] {
  const hov = hovered_idx != null ? arcs[hovered_idx] : null
  const active = (arc: PositionedArc<Metadata>): boolean =>
    !hov ||
    (arc.node_idx >= hov.node_idx && arc.node_idx <= hov.subtree_end) ||
    (hov.node_idx >= arc.node_idx && hov.node_idx <= arc.subtree_end)
  return arcs.map((arc) => {
    const muted = arc.path.length > 0 && muted_ids.has(arc.path[0])
    return {
      opacity: muted ? MUTED_OPACITY : active(arc) ? 1 : 0.3,
      // labels dim only when muted, not when hover-inactive (undefined omits the attr)
      label_opacity: muted ? MUTED_OPACITY : undefined,
    }
  })
}

// Drop muted ids that no longer exist in the current layout (e.g. after a data swap)
export function prune_muted_ids<Metadata>(
  arcs: readonly PositionedArc<Metadata>[],
  muted_ids: Set<string | number>,
): void {
  const valid = new Set(arcs.filter((arc) => arc.depth === 1).map((arc) => arc.id))
  for (const id of muted_ids) if (!valid.has(id)) muted_ids.delete(id)
}

// Toggle one depth-1 category's muted state (legend click)
export function toggle_muted(
  muted_ids: Set<string | number>,
  id: string | number | undefined,
): void {
  if (id !== undefined && !muted_ids.delete(id)) muted_ids.add(id)
}

// Legend: one item per depth-1 category; toggling mutes (dims) rather than removes
export function hierarchy_legend_items<Metadata>(
  depth1_arcs: readonly PositionedArc<Metadata>[],
  muted_ids: ReadonlySet<string | number>,
  color_for: (arc: PositionedArc<Metadata>) => string,
): LegendItem[] {
  return depth1_arcs.map((arc, idx) => ({
    series_idx: idx,
    label: node_display_name(arc),
    visible: !muted_ids.has(arc.id),
    display_style: { symbol_type: `Square` as const, symbol_color: color_for(arc) },
  }))
}

// Handler props are the node minus its layout geometry (screen coords are an
// implementation detail), plus the resolved parent id
export function node_handler_props<Metadata>(
  arcs: readonly PositionedArc<Metadata>[],
  arc: PositionedArc<Metadata>,
  color: string,
): SunburstNodeHandlerProps<Metadata> {
  const { x0: _x0, x1: _x1, y0: _y0, y1: _y1, subtree_end: _end, parent_idx, ...node } = arc
  return {
    ...node,
    type: `node`,
    color,
    parent_id: parent_idx != null ? arcs[parent_idx].id : null,
  }
}

// True while the user has an uncollapsed text selection inside the chart. Labels
// are selectable text, and the mouseup that ends a selection drag also fires a
// click — selecting a label must not zoom or fire on_node_click.
export function selection_within(wrapper: HTMLElement | undefined): boolean {
  const selection = globalThis.getSelection?.()
  return Boolean(
    selection &&
    !selection.isCollapsed &&
    selection.anchorNode &&
    wrapper?.contains(selection.anchorNode),
  )
}

// Ancestor chain from the root to the current zoom root (clickable breadcrumb trail)
export function ancestor_chain<Metadata>(
  arcs: readonly PositionedArc<Metadata>[],
  zoom_root: PositionedArc<Metadata> | null,
): PositionedArc<Metadata>[] {
  if (!zoom_root || zoom_root.depth === 0) return []
  const chain: PositionedArc<Metadata>[] = []
  let cur: PositionedArc<Metadata> | null = zoom_root
  while (cur) {
    chain.unshift(cur)
    cur = cur.parent_idx != null ? arcs[cur.parent_idx] : null
  }
  return chain
}

export interface HierarchyNodeInfo {
  // Fit-aware label fallback chain, richest first: extended -> base label ->
  // compact label_short. Rendering picks the first variant whose measured
  // width fits its node; empty when the node has no base label at all.
  variants: { text: string; width: number }[]
  aria: string
  fill: string
  label_fill: string
  clickable?: boolean
}

// Per-node label text, measured widths, fill/label colors, aria string (and
// optional clickability) — all zoom-independent, so computed once per
// layout/option change instead of per animation frame (format_value, canvas
// measureText, contrast picking and color resolution would otherwise run per
// visible node per frame during zoom tweens)
export function compute_node_infos<Metadata>(
  arcs: readonly PositionedArc<Metadata>[],
  opts: {
    label_text: SunburstLabelText
    value_format: string
    label_font: string
    color_for: (arc: PositionedArc<Metadata>) => string
    text_width: (text: string, font: string) => number
    contrast: (fill: string) => string
    clickable?: (arc: PositionedArc<Metadata>) => boolean
  },
): HierarchyNodeInfo[] {
  const { label_text, value_format, label_font } = opts
  return arcs.map((arc) => {
    const { text, extended, short } = node_label_variants(arc, label_text, value_format)
    const fill = opts.color_for(arc)
    const variants = (text ? [extended, text, short] : []).flatMap((variant) =>
      variant === undefined
        ? []
        : [{ text: variant, width: opts.text_width(variant, label_font) }],
    )
    return {
      variants,
      aria: `${node_display_name(arc)}: ${arc.value}`,
      fill,
      label_fill: opts.contrast(fill),
      ...(opts.clickable ? { clickable: opts.clickable(arc) } : {}),
    }
  })
}

// Attachment factory reporting an element's rendered height (immediately, on
// resize, and 0 on unmount) — used to reserve chart space below the cells/arcs
// for the colorbar without an extra measuring wrapper div.
export const observe_height = (on_height: (px: number) => void) => (element: Element) => {
  const observer = new ResizeObserver(() => on_height(element.clientHeight))
  observer.observe(element)
  on_height(element.clientHeight)
  return () => {
    observer.disconnect()
    on_height(0) // release the reserved space when the element unmounts
  }
}

// The font node labels actually render in (respects the chart's font-size CSS
// var instead of assuming 11px), for canvas-measured label fitting
export function svg_label_font(svg_element: SVGSVGElement | null): string {
  if (!svg_element) return `11px sans-serif`
  const { fontSize, fontFamily } = getComputedStyle(svg_element)
  return `${fontSize} ${fontFamily}`
}

// Anchor tooltips at the cursor (mouse hover) so they follow the pointer across
// wide nodes; callers fall back to the node center on keyboard focus (no cursor).
export const pointer_pos = (
  event: MouseEvent | FocusEvent | undefined,
  svg_element: SVGSVGElement | null,
): { x: number; y: number } | null =>
  event instanceof MouseEvent ? get_relative_coords(event, svg_element) : null

export const is_activation_key = (evt: KeyboardEvent): boolean =>
  [`Enter`, ` `].includes(evt.key)

// Escape zooms out one level, then exits fullscreen once at the root — but only
// when the user is interacting with this chart (pointer over it, focus inside
// it, or fullscreen)
export function handle_hierarchy_escape(
  evt: KeyboardEvent,
  ctx: {
    wrapper: HTMLElement | undefined
    fullscreen: boolean
    zoomed: boolean
    zoom_out: () => void
    exit_fullscreen: () => void
  },
): void {
  if (evt.key !== `Escape`) return
  const within =
    ctx.fullscreen ||
    (ctx.wrapper != null &&
      (ctx.wrapper.matches(`:hover`) || ctx.wrapper.contains(document.activeElement)))
  if (!within) return
  if (ctx.zoomed) {
    evt.preventDefault()
    ctx.zoom_out()
  } else if (ctx.fullscreen) {
    evt.preventDefault()
    ctx.exit_fullscreen()
  }
}
