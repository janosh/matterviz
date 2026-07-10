// Layout helpers for Treemap charts. All tree semantics (value modes, sorting,
// 'Other' bucketing, color inheritance, stable ids, pre-order indexing) are
// delegated to compute_sunburst_layout — a treemap is the same hierarchy with
// squarified pixel rects instead of polar partition coordinates, so the two
// charts share data builders (sunburst_from_paths, chem_sys_sunburst_data, …)
// and value semantics (plotly branchvalues) by construction.

import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy'
import type { Rect } from '$lib/plot/core/layout'
import type {
  PositionedArc,
  SunburstLayoutOptions,
  SunburstNode,
  SunburstNodeHandlerProps,
} from '$lib/plot/sunburst/sunburst'
import { compute_sunburst_layout } from '$lib/plot/sunburst/sunburst'
import { DEFAULTS } from '$lib/settings'

// Treemaps consume the same node trees as Sunburst (shared data builders)
export type TreemapNode<Metadata = Record<string, unknown>> = SunburstNode<Metadata>
// A semantic tree node (value/color/id/breadcrumbs resolved, pre-order indexed).
// Its x0/x1/y0/y1 partition coords are unused by the treemap — pixel rects come
// from tile_rects instead, so tiling can re-run per zoom/resize without
// recomputing tree semantics.
export type TreemapArc<Metadata = Record<string, unknown>> = PositionedArc<Metadata>
export type TreemapNodeHandlerProps<Metadata = Record<string, unknown>> =
  SunburstNodeHandlerProps<Metadata>
export type TreemapLayoutOptions = SunburstLayoutOptions

export interface TilePadding {
  padding_inner: number // px gap between sibling cells
  // px strip reserved at the top of branch cells for their label (plotly-style
  // parent headers); 0 nests children edge-to-edge over the parent
  padding_top: number
  // px inset of children within their parent's left/right/bottom edges, so the
  // parent visibly encloses its subtree (plotly marker.pad); the top inset is
  // padding_top's header strip
  padding_outer: number
}

// Fresh object per call: returned rect arrays hand these to consumers, and a
// shared constant would let mutating one zero rect corrupt every other one
const zero_rect = (): Rect => ({ x: 0, y: 0, width: 0, height: 0 })

// Squarify the subtree under arcs[root_idx] into pixel rects filling `size`.
// Returns an array aligned with `arcs` by node_idx (nodes outside the subtree
// get zero rects). Separate from tree-semantics so zooming re-tiles the new
// root's subtree to the full viewport (plotly behavior) — unlike the sunburst's
// size-independent partition, squarified tiling depends on the target aspect
// ratio, so projecting one fixed layout through a zoom window would distort
// cells and scale up the fixed-px header strips.
export function tile_rects<Metadata>(
  arcs: readonly PositionedArc<Metadata>[],
  root_idx: number,
  size: { width: number; height: number },
  pad: TilePadding,
): Rect[] {
  const rects: Rect[] = arcs.map(zero_rect)
  const root_arc = arcs[root_idx]
  if (!root_arc || !(size.width > 0) || !(size.height > 0)) return rects

  // Rebuild the (already value-resolved, sorted and bucketed) subtree from the
  // flat pre-order arcs: children of arc N are the top-level subtree ranges in
  // (N, N.subtree_end].
  const children_of = (arc: PositionedArc<Metadata>): PositionedArc<Metadata>[] => {
    const kids: PositionedArc<Metadata>[] = []
    for (let idx = arc.node_idx + 1; idx <= arc.subtree_end; idx = arcs[idx].subtree_end + 1) {
      kids.push(arcs[idx])
    }
    return kids
  }
  const root = hierarchy(root_arc, children_of)
  // Values are assigned manually (the documented d3 way to bypass .sum()) so all
  // three value modes carry over — with 'total', children summing to less than
  // their parent leave unfilled space in the parent cell, matching plotly.
  // Non-finite/negative values would make d3's tiling emit NaN/out-of-bounds
  // rects; coerce them to zero-size instead of corrupting the whole chart.
  root.each((node) => {
    const { value } = node.data
    ;(node as { value?: number }).value = Number.isFinite(value) && value >= 0 ? value : 0
  })

  const tiled = treemap<PositionedArc<Metadata>>()
    .tile(treemapSquarify)
    .size([size.width, size.height])
    .paddingInner(pad.padding_inner)
    // inset children within branch cells below the tiling root (the root fills
    // the viewport and is labeled by breadcrumbs, not a frame + header) …
    .paddingOuter((node) => (node.depth > 0 ? pad.padding_outer : 0))
    // … with the top inset enlarged into the label header strip. paddingTop is
    // applied after paddingOuter, overriding its top component.
    .paddingTop((node) =>
      node.depth > 0 && node.children ? Math.max(pad.padding_top, pad.padding_outer) : 0,
    )(root)

  // Clamp to the tiling area: with value_mode 'total', children exceeding their
  // parent's value overflow the parent rect (d3 scales children by parent value;
  // compute_sunburst_layout warns). Clamping keeps overflow inside the chart,
  // mirroring the sunburst's clamp01 window projection.
  const clamp_x = (val: number) => Math.min(Math.max(val, 0), size.width)
  const clamp_y = (val: number) => Math.min(Math.max(val, 0), size.height)
  tiled.each((node) => {
    const x = clamp_x(node.x0)
    const y = clamp_y(node.y0)
    rects[node.data.node_idx] = {
      x,
      y,
      width: Math.max(0, clamp_x(node.x1) - x),
      height: Math.max(0, clamp_y(node.y1) - y),
    }
  })
  return rects
}

// Interpolate between two tilings (zoom animation). Rects are aligned by
// node_idx; frames allocate one array but reuse rect objects at t = 0/1.
export function lerp_rects(prev: readonly Rect[], next: readonly Rect[], t: number): Rect[] {
  if (t >= 1 || prev.length !== next.length) return next as Rect[]
  if (t <= 0) return prev as Rect[]
  return next.map((to, idx) => {
    const from = prev[idx]
    return {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      width: from.width + (to.width - from.width) * t,
      height: from.height + (to.height - from.height) * t,
    }
  })
}

export interface TreemapLayoutResult<Metadata = Record<string, unknown>> {
  arcs: TreemapArc<Metadata>[] // pre-order semantic nodes, hidden root at index 0
  rects: Rect[] // pixel rects aligned with arcs by node_idx
  root: TreemapArc<Metadata> | null // arcs[0] convenience alias
  max_depth: number // deepest level (root = 0)
}

// One-shot semantic layout + root tiling (tests and non-zooming callers; the
// component calls compute_sunburst_layout and tile_rects separately so zoom
// re-tiles without recomputing tree semantics).
export function compute_treemap_layout<Metadata = Record<string, unknown>>(
  data: TreemapNode<Metadata> | TreemapNode<Metadata>[],
  size: { width: number; height: number },
  opts: TreemapLayoutOptions & Partial<TilePadding> = {},
): TreemapLayoutResult<Metadata> {
  // padding fallbacks derive from DEFAULTS.treemap to prevent drift with the component
  const {
    padding_inner = DEFAULTS.treemap.padding_inner,
    padding_top = DEFAULTS.treemap.padding_top,
    padding_outer = DEFAULTS.treemap.padding_outer,
    // descending (matching the Treemap component): squarified tiling reads best
    // with the largest cell top-left and smallest bottom-right
    sort = `descending`,
    ...tree_opts
  } = opts
  const { arcs, root, max_depth } = compute_sunburst_layout(data, { sort, ...tree_opts })
  const rects = tile_rects(arcs, 0, size, { padding_inner, padding_top, padding_outer })
  return { arcs, rects, root, max_depth }
}
