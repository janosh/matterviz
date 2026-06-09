// Layout helpers for Sankey diagrams, wrapping d3-sankey.
// Single source of truth for node/link positioning math so the component stays
// declarative and the layout is independently unit-testable.

import {
  sankey as d3_sankey,
  sankeyCenter,
  sankeyJustify,
  sankeyLeft,
  sankeyRight,
} from 'd3-sankey'
import type { SankeyLink as D3Link, SankeyNode as D3Node } from 'd3-sankey'
import type { Vec2 } from '$lib/math'
import type {
  SankeyData,
  SankeyLink,
  SankeyNode,
  SankeyNodeAlign,
  SankeyOrientation,
} from '$lib/plot/core/types'

// User-carried node props that survive the d3-sankey layout pass
interface NodeExtra {
  node_idx: number
  id: string | number
  label?: string
  color?: string
}
interface LinkExtra {
  link_idx: number
  color?: string
  label?: string
}

// A node after layout: screen-space box (x0/x1/y0/y1) regardless of orientation
export type PositionedNode = D3Node<NodeExtra, LinkExtra> & {
  node_idx: number
  id: string | number
  x0: number
  x1: number
  y0: number
  y1: number
  value: number
  depth: number
}

// A link after layout, with a precomputed screen-space ribbon path + midpoint
export type PositionedLink = D3Link<NodeExtra, LinkExtra> & {
  link_idx: number
  width: number
  source: PositionedNode
  target: PositionedNode
  path: string // SVG path to be stroked with stroke-width = width
  mid: { x: number; y: number } // ribbon midpoint (for tooltip anchoring)
}

export interface SankeyLayoutOptions {
  width: number
  height: number
  node_width?: number // px, default 24
  node_padding?: number // px vertical gap between nodes in a column, default 12
  node_align?: SankeyNodeAlign // default 'justify'
  orientation?: SankeyOrientation // default 'horizontal'
  iterations?: number // d3-sankey relaxation passes, default 6
}

export interface SankeyLayoutResult {
  nodes: PositionedNode[]
  links: PositionedLink[]
}

const ALIGN_FNS = {
  left: sankeyLeft,
  right: sankeyRight,
  center: sankeyCenter,
  justify: sankeyJustify,
} as const

// Resolve a link source/target reference (id or index) to a node array index.
// Prefers id lookup (ids may be numeric), falls back to treating numbers as indices.
function resolve_node_ref(
  ref: number | string,
  id_to_idx: Map<string | number, number>,
  n_nodes: number,
): number {
  const by_id = id_to_idx.get(ref)
  if (by_id !== undefined) return by_id
  if (typeof ref === `number` && Number.isInteger(ref) && ref >= 0 && ref < n_nodes) {
    return ref
  }
  throw new Error(`Sankey link references unknown node: ${JSON.stringify(ref)}`)
}

function resolve_numeric_node_ref(ref: number, n_nodes: number): number {
  if (Number.isInteger(ref) && ref >= 0 && ref < n_nodes) return ref
  throw new Error(`Sankey link references unknown node: ${JSON.stringify(ref)}`)
}

// Build a SankeyData object from parallel flat arrays (e.g. the plotly/matbench
// `link.source`/`link.target`/`link.value` + `node.label` format).
export function sankey_from_links(
  source: readonly number[],
  target: readonly number[],
  value: readonly number[],
  labels?: readonly string[],
): SankeyData {
  if (source.length !== target.length || source.length !== value.length) {
    throw new Error(
      `sankey_from_links: source (${source.length}), target (${target.length}) and value (${value.length}) must have equal length`,
    )
  }
  // Single pass instead of Math.max(...source, ...target): spreading large index arrays
  // (e.g. spacegroup correspondence matrices) as call args can exceed the arg-count limit.
  let max_idx = -1
  for (const idx of source) if (idx > max_idx) max_idx = idx
  for (const idx of target) if (idx > max_idx) max_idx = idx
  // Cover the highest indexed link even when labels is shorter (missing labels fall
  // back to the index string below), so links never reference a non-existent node.
  const n_nodes = Math.max(labels?.length ?? 0, max_idx + 1)
  const nodes: SankeyNode[] = Array.from({ length: n_nodes }, (_, idx) => ({
    id: idx,
    label: labels?.[idx] ?? `${idx}`,
  }))
  const links: SankeyLink[] = source.map((src, idx) => ({
    source: src,
    target: target[idx],
    value: value[idx],
  }))
  return { nodes, links }
}

// Vertical ribbon path: mirror of d3's sankeyLinkHorizontal but flowing top->bottom.
// Reads the raw d3 layout fields (link.y0/y1 are stacking-axis centers, which in
// vertical mode map to screen x; source.x1/target.x0 are depth positions = screen y).
function vertical_link_path(link: D3Link<NodeExtra, LinkExtra>): string {
  const x0 = link.y0 ?? 0
  const x1 = link.y1 ?? 0
  const y0 = (link.source as PositionedNode).x1
  const y1 = (link.target as PositionedNode).x0
  const ym = (y0 + y1) / 2
  return `M${x0},${y0}C${x0},${ym} ${x1},${ym} ${x1},${y1}`
}

function horizontal_link_path(link: D3Link<NodeExtra, LinkExtra>): string {
  const x0 = (link.source as PositionedNode).x1
  const x1 = (link.target as PositionedNode).x0
  const y0 = link.y0 ?? 0
  const y1 = link.y1 ?? 0
  const xm = (x0 + x1) / 2
  return `M${x0},${y0}C${xm},${y0} ${xm},${y1} ${x1},${y1}`
}

// Compute node boxes and link ribbon paths in screen space.
// Clones input so the (reactive) user data is never mutated by d3-sankey.
export function compute_sankey_layout<Metadata = Record<string, unknown>>(
  data: SankeyData<Metadata>,
  opts: SankeyLayoutOptions,
): SankeyLayoutResult {
  const {
    width,
    height,
    node_width = 24,
    node_padding = 12,
    node_align = `justify`,
    orientation = `horizontal`,
    iterations = 6,
  } = opts

  // All-zero link values would make d3-sankey divide by zero (NaN ribbon paths)
  const has_flow = data.links.some((link) => link.value > 0)
  if (!(width > 0) || !(height > 0) || data.nodes.length === 0 || !has_flow)
    return { nodes: [], links: [] }

  // Resolve ids -> indices and clone into fresh objects (d3 mutates these).
  // Links may reference a node by explicit `id`, or by `label` when no id is set,
  // or by zero-based index (handled as a fallback in resolve_node_ref).
  const needs_ref_lookup =
    data.links.some(
      (link) => typeof link.source !== `number` || typeof link.target !== `number`,
    ) || data.nodes.some((node, idx) => typeof node.id === `number` && node.id !== idx)

  let id_to_idx: Map<string | number, number> | undefined
  if (needs_ref_lookup) {
    id_to_idx = new Map<string | number, number>()
    data.nodes.forEach((node, idx) => {
      const key = node.id ?? node.label
      if (key === undefined) return // index-only node, resolved via fallback
      if (id_to_idx?.has(key)) {
        console.warn(
          `Sankey: duplicate node ${
            node.id !== undefined ? `id` : `label`
          } "${key}" — links resolve to the last occurrence. Set unique \`id\`s.`,
        )
      }
      id_to_idx?.set(key, idx)
    })
  }

  const node_copies: NodeExtra[] = data.nodes.map((node, idx) => ({
    node_idx: idx,
    id: node.id ?? idx,
    label: node.label,
    color: node.color,
  }))
  // Resolve a source/target ref to a node index: id/label lookup when any link uses
  // non-numeric refs, otherwise a cheap numeric-range check (no map built).
  const resolve_ref = (ref: number | string): number =>
    needs_ref_lookup
      ? resolve_node_ref(ref, id_to_idx as Map<string | number, number>, data.nodes.length)
      : resolve_numeric_node_ref(ref as number, data.nodes.length)

  const link_copies = data.links.map((link, idx) => ({
    link_idx: idx,
    color: link.color,
    label: link.label,
    source: resolve_ref(link.source),
    target: resolve_ref(link.target),
    value: link.value,
  }))

  // Drop nodes with no incoming or outgoing links. d3-sankey gives such orphans
  // value 0 (zero height) and still stacks them with node_padding each, so extra
  // labels pile up and overflow past the plot edge. They are never referenced by a
  // link, so removing them can't break link resolution (node_idx stays stable).
  const linked_node_idxs = new Set<number>()
  for (const link of link_copies) {
    linked_node_idxs.add(link.source)
    linked_node_idxs.add(link.target)
  }
  const used_nodes = node_copies.filter((node) => linked_node_idxs.has(node.node_idx))

  const is_vertical = orientation === `vertical`
  // d3 lays out left->right (depth on x). For vertical we run in a transposed
  // extent (depth on what becomes screen y) then swap node boxes afterwards.
  const extent: [Vec2, Vec2] = is_vertical
    ? [
        [0, 0],
        [height, width],
      ]
    : [
        [0, 0],
        [width, height],
      ]

  const layout = d3_sankey<NodeExtra, LinkExtra>()
    .nodeId((node) => node.node_idx)
    .nodeWidth(node_width)
    .nodePadding(node_padding)
    .nodeAlign(ALIGN_FNS[node_align])
    .iterations(iterations)
    .extent(extent)

  let graph: { nodes: PositionedNode[]; links: PositionedLink[] }
  try {
    graph = layout({ nodes: used_nodes, links: link_copies }) as typeof graph
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Sankey layout failed (graph must be a DAG without cycles): ${msg}`, {
      cause: err,
    })
  }

  // Build link ribbon paths from raw d3 fields BEFORE transposing node boxes.
  for (const link of graph.links) {
    if (is_vertical) {
      link.path = vertical_link_path(link)
      link.mid = {
        x: ((link.y0 ?? 0) + (link.y1 ?? 0)) / 2,
        y: (link.source.x1 + link.target.x0) / 2,
      }
    } else {
      link.path = horizontal_link_path(link)
      const x = (link.source.x1 + link.target.x0) / 2
      const y = ((link.y0 ?? 0) + (link.y1 ?? 0)) / 2
      link.mid = { x, y }
    }
  }

  // Transpose node boxes into screen space for vertical orientation
  if (is_vertical) {
    for (const node of graph.nodes) {
      const { x0, x1, y0, y1 } = node
      node.x0 = y0
      node.x1 = y1
      node.y0 = x0
      node.y1 = x1
    }
  }

  return graph
}

// Map a node alignment string to the d3-sankey alignment function (exposed for tests)
export const sankey_align_fn = (align: SankeyNodeAlign) => ALIGN_FNS[align]
