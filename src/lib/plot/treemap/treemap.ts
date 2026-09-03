// Layout helpers for Treemap charts. All tree semantics (value modes, sorting,
// 'Other' bucketing, color inheritance, stable ids, pre-order indexing) are
// delegated to compute_sunburst_layout — a treemap is the same hierarchy with
// squarified pixel rects instead of polar partition coordinates, so the two
// charts share data builders (sunburst_from_paths, chem_sys_sunburst_data, …)
// and value semantics (plotly branchvalues) by construction.

import { hierarchy, treemap, treemapSquarify } from 'd3-hierarchy'
import { clamp } from '$lib/math'
import type { Rect } from '$lib/plot/core/layout'
import type { PositionedArc, SunburstNode } from '$lib/plot/core/utils/hierarchy-layout'

// Treemaps consume the same node trees as Sunburst (shared data builders)
export type TreemapNode<Metadata = Record<string, unknown>> = SunburstNode<Metadata>
// A semantic tree node (value/color/id/breadcrumbs resolved, pre-order indexed).
// Its x0/x1/y0/y1 partition coords are unused by the treemap — pixel rects come
// from tile_rects instead, so tiling can re-run per zoom/resize without
// recomputing tree semantics.
export type TreemapArc<Metadata = Record<string, unknown>> = PositionedArc<Metadata>
interface TilePadding {
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

// Height of a branch's label header strip: d3 applies paddingTop after paddingOuter, so the
// reserved strip is the larger of the two. Label fitting and clipping read it too.
export const header_strip = (padding_top: number, padding_outer: number): number =>
  Math.max(padding_top, padding_outer)

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
      node.depth > 0 && node.children ? header_strip(pad.padding_top, pad.padding_outer) : 0,
    )(root)

  // Clamp to the tiling area: with value_mode 'total', children exceeding their
  // parent's value overflow the parent rect (d3 scales children by parent value;
  // compute_sunburst_layout warns). Clamping keeps overflow inside the chart,
  // mirroring the sunburst's clamp01 window projection.
  tiled.each((node) => {
    const x = clamp(node.x0, 0, size.width)
    const y = clamp(node.y0, 0, size.height)
    rects[node.data.node_idx] = {
      x,
      y,
      width: Math.max(0, clamp(node.x1, 0, size.width) - x),
      height: Math.max(0, clamp(node.y1, 0, size.height) - y),
    }
  })
  return rects
}

// A tiling plus the arcs it was computed from, so the two can be realigned when the
// arc set changes between them.
export interface Tiling {
  rects: readonly Rect[]
  arcs: readonly { id: string | number; parent_idx: number | null }[]
}

// Re-express `prev`'s rects in `next`'s index space, matching arcs by id.
//
// Position is not a stable identity across a zoom: bucketing measures its threshold
// against the zoom root, so drilling in can dissolve an 'Other' cell into the nodes it
// stood for, shifting every later index. Interpolating positionally would then morph
// unrelated cells into each other, and bailing out instead (what a plain length check
// does) drops the animation entirely - including for the cells that *do* correspond.
//
// A cell with no counterpart in `prev` starts from its nearest ancestor that had one, so
// nodes revealed by a dissolved bucket unfold out of the region that bucket occupied
// rather than appearing from nowhere. Cells that vanish simply aren't in the new space.
export function align_tiling(prev: Tiling, next: Tiling): Rect[] {
  const by_id = new Map<string | number, Rect>()
  prev.arcs.forEach((arc, idx) => {
    const rect = prev.rects[idx]
    if (rect) by_id.set(arc.id, rect)
  })
  return next.arcs.map((arc, idx) => {
    const own = by_id.get(arc.id)
    if (own) return own
    // Walk `next`'s parent chain; parents precede children in pre-order, so this
    // terminates without a visited set
    let parent_idx = arc.parent_idx
    while (parent_idx != null) {
      const ancestor = next.arcs[parent_idx]
      if (!ancestor) break
      const ancestor_rect = by_id.get(ancestor.id)
      if (ancestor_rect) return ancestor_rect
      parent_idx = ancestor.parent_idx
    }
    return next.rects[idx] // nothing to animate from: start where it lands
  })
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
