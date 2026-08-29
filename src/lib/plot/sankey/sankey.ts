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
import type { Orientation } from '$lib/plot/core/types'
import type { SankeyData, SankeyLink, SankeyNode, SankeyNodeAlign } from './sankey-types'
import { DEFAULTS } from '$lib/settings'

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

interface SankeyLayoutOptions {
  width: number
  height: number
  node_width?: number // px, default 24
  node_padding?: number // px vertical gap between nodes in a column, default 12
  node_align?: SankeyNodeAlign // default 'justify'
  orientation?: Orientation // default 'horizontal'
  iterations?: number // d3-sankey relaxation passes, default 6
}

interface SankeyLayoutResult {
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

// Iterative DFS over the resolved links. Returns the first cycle found as a closed
// node-index walk (first === last), or null for a DAG. d3-sankey only reports
// "circular link" without saying where, so this runs first to name the offenders.
function find_cycle(
  links: readonly { source: number; target: number }[],
  n_nodes: number,
): number[] | null {
  const out_edges: number[][] = Array.from({ length: n_nodes }, () => [])
  for (const { source, target } of links) out_edges[source].push(target)
  const state = new Uint8Array(n_nodes) // 0 = unvisited, 1 = on stack, 2 = done
  const parent = new Int32Array(n_nodes).fill(-1)
  for (let root = 0; root < n_nodes; root++) {
    if (state[root] !== 0) continue
    const stack: [number, number][] = [[root, 0]] // [node, next out-edge position]
    state[root] = 1
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      const [node, edge_pos] = frame
      if (edge_pos === out_edges[node].length) {
        state[node] = 2
        stack.pop()
        continue
      }
      frame[1] += 1
      const next = out_edges[node][edge_pos]
      if (state[next] === 1) {
        const cycle = [next]
        for (let cur = node; cur !== next; cur = parent[cur]) cycle.push(cur)
        cycle.push(next)
        return cycle.toReversed()
      }
      if (state[next] === 0) {
        state[next] = 1
        parent[next] = node
        stack.push([next, 0])
      }
    }
  }
  return null
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

// === Long-tail bucketing ===

export interface SankeyBucketOptions {
  // Fold an outgoing link carrying less than this fraction of its source's outflow
  min_fraction?: number
  // Keep at most this many outgoing links per source, largest first (0 = unlimited).
  // Not a hard cap on what is drawn, matching `max_children` on the hierarchy charts:
  // only links to terminal targets can be folded, so a node whose overflow carries flow
  // onward keeps it, and the synthetic 'Other' link is additional to the kept ones.
  max_links?: number
  other_label?: string // label of the synthetic node, default 'Other'
}

// Fold a node's small outgoing links into one link to a synthetic 'Other' node, the
// Sankey analogue of the hierarchy charts' `min_fraction`/`max_children`.
//
// Only links whose target is *terminal* (has no outgoing links of its own) are ever
// folded. Merging a target that carries flow onward would silently delete that flow
// downstream, turning a readability aid into a wrong diagram; terminal targets have
// nothing downstream to lose, and a long tail of small terminal categories is the shape
// that actually needs this. Nodes left with no links are dropped.
export function bucket_sankey_data<Metadata = Record<string, unknown>>(
  data: SankeyData<Metadata>,
  { min_fraction = 0, max_links = 0, other_label = `Other` }: SankeyBucketOptions,
): SankeyData<Metadata> {
  if (!(min_fraction > 0) && !(max_links > 0)) return data

  // Identity is `id ?? index`, matching what compute_sankey_layout emits. A label is
  // *not* identity - labels need not be unique, so keying on one would silently merge
  // two distinct nodes - but links may still reference a node by label, so lookup
  // accepts both, id first, mirroring resolve_node_ref.
  const keys: (string | number)[] = data.nodes.map((node, idx) => node.id ?? idx)
  const by_ref = new Map<string | number, number>()
  // Explicit ids claim their key across the whole graph before any label is considered:
  // otherwise an earlier node's label shadows a later node's id, and a link naming that
  // id resolves to the wrong node - which the fold would then remap or swallow.
  for (const field of [`id`, `label`] as const) {
    data.nodes.forEach((node, idx) => {
      const ref = node[field]
      if (ref !== undefined && !by_ref.has(ref)) by_ref.set(ref, idx)
    })
  }
  const in_range = (idx: number) => idx >= 0 && idx < data.nodes.length
  // -1 for a reference that names no node; such a link is left for the layout to report
  const resolve = (ref: number | string): number => {
    const found = by_ref.get(ref) ?? (typeof ref === `number` ? ref : -1)
    return in_range(found) ? found : -1
  }

  const outgoing: number[][] = data.nodes.map(() => [])
  data.links.forEach((link, link_idx) => {
    const source = resolve(link.source)
    if (source >= 0) outgoing[source]?.push(link_idx)
  })
  // A reference that resolves to nothing is not terminal, it is broken: folding those
  // links would replace them with a valid bucket and hide the error the layout reports.
  const is_terminal = (node_idx: number) =>
    in_range(node_idx) && (outgoing[node_idx]?.length ?? 0) === 0

  const folded = new Set<number>() // link indices replaced by a bucket
  const buckets: { source: number; value: number; count: number }[] = []

  const value_of = (link_idx: number) => data.links[link_idx]?.value ?? 0
  const foldable = (link_idx: number) => is_terminal(resolve(data.links[link_idx].target))

  outgoing.forEach((link_idxs, source) => {
    if (link_idxs.length < 2) return
    const outflow = link_idxs.reduce((sum, idx) => sum + value_of(idx), 0)
    if (!(outflow > 0)) return
    // A link with a non-terminal target is never a candidate, but still counts toward
    // the outflow it is measured against and toward the `max_links` budget it occupies
    const threshold = min_fraction > 0 ? min_fraction * outflow : 0
    // A Set, not a list: `max_links` below tests membership once per sibling, which on a
    // wide fan is the difference between linear and quadratic
    const small = new Set(
      link_idxs.filter((idx) => foldable(idx) && value_of(idx) < threshold),
    )
    if (max_links > 0 && link_idxs.length - small.size > max_links) {
      // Rank the survivors and demote the smallest until the cap is met; `toSorted` is
      // stable, so value ties break by input order, reproducibly
      link_idxs
        .filter((idx) => !small.has(idx))
        .toSorted((left, right) => value_of(right) - value_of(left))
        .slice(max_links)
        .filter(foldable)
        .forEach((idx) => small.add(idx))
    }
    if (small.size < 2) return // a bucket of one is that link under a worse name
    small.forEach((idx) => folded.add(idx))
    buckets.push({
      source,
      value: [...small].reduce((sum, idx) => sum + value_of(idx), 0),
      count: small.size,
    })
  })

  if (buckets.length === 0) return data

  // Targets that only ever received folded flow have nothing left to draw
  const still_referenced = new Set<number>()
  data.links.forEach((link, link_idx) => {
    if (folded.has(link_idx)) return
    for (const ref of [link.source, link.target]) still_referenced.add(resolve(ref))
  })
  for (const { source } of buckets) still_referenced.add(source)

  const nodes: SankeyNode<Metadata>[] = []
  const remapped = new Map<number, string | number>()
  data.nodes.forEach((node, idx) => {
    if (!still_referenced.has(idx)) return
    const id = keys[idx]
    remapped.set(idx, id)
    nodes.push({ ...node, id })
  })

  const links: SankeyLink<Metadata>[] = data.links
    .filter((_, link_idx) => !folded.has(link_idx))
    .map((link) => ({
      ...link,
      source: remapped.get(resolve(link.source)) ?? link.source,
      target: remapped.get(resolve(link.target)) ?? link.target,
    }))

  // Every id in the folded graph, so a synthetic one cannot collide with a real node
  // that happens to be called `src/Other` and steal its links
  const taken = new Set<string | number>(nodes.map((node) => node.id ?? ``))
  buckets.forEach(({ source, value, count }) => {
    // One bucket node per source, so two sources' tails never merge into one blob
    const base_id = `${String(keys[source])}/${other_label}`
    let bucket_id = base_id
    for (let suffix = 2; taken.has(bucket_id); suffix++) bucket_id = `${base_id}~${suffix}`
    taken.add(bucket_id)
    nodes.push({ id: bucket_id, label: other_label })
    links.push({
      source: remapped.get(source) ?? keys[source],
      target: bucket_id,
      value,
      label: `${other_label} (${count} flows)`,
    })
  })

  return { nodes, links }
}

// Compute node boxes and link ribbon paths in screen space.
// Clones input so the (reactive) user data is never mutated by d3-sankey.
export function compute_sankey_layout<Metadata = Record<string, unknown>>(
  data: SankeyData<Metadata>,
  opts: SankeyLayoutOptions,
): SankeyLayoutResult {
  // Fallbacks derive from DEFAULTS.sankey so component and helper defaults can't drift
  const {
    width,
    height,
    node_width = DEFAULTS.sankey.node_width,
    node_padding = DEFAULTS.sankey.node_padding,
    node_align = DEFAULTS.sankey.node_align,
    orientation = DEFAULTS.sankey.orientation,
    iterations = DEFAULTS.sankey.iterations,
  } = opts

  // All-zero link values would make d3-sankey divide by zero (NaN ribbon paths)
  const has_flow = data.links.some((link) => link.value > 0)
  if (!(width > 0) || !(height > 0) || data.nodes.length === 0 || !has_flow)
    return { nodes: [], links: [] }

  // Resolve ids -> indices and clone into fresh objects (d3 mutates these).
  // Links may reference a node by explicit `id`, or by `label` when no id is set,
  // or by zero-based index (handled as a fallback in resolve_node_ref). The id map is
  // only populated when some ref can't be an index, so index-only data skips the scan.
  const needs_ref_lookup =
    data.links.some(
      (link) => typeof link.source !== `number` || typeof link.target !== `number`,
    ) || data.nodes.some((node, idx) => typeof node.id === `number` && node.id !== idx)

  const id_to_idx = new Map<string | number, number>()
  if (needs_ref_lookup) {
    data.nodes.forEach((node, idx) => {
      const key = node.id ?? node.label
      if (key === undefined) return // index-only node, resolved via fallback
      if (id_to_idx.has(key)) {
        console.warn(
          `Sankey: duplicate node ${
            node.id !== undefined ? `id` : `label`
          } "${key}" — links resolve to the last occurrence. Set unique \`id\`s.`,
        )
      }
      id_to_idx.set(key, idx)
    })
  }

  const node_copies: NodeExtra[] = data.nodes.map((node, idx) => ({
    node_idx: idx,
    id: node.id ?? idx,
    label: node.label,
    color: node.color,
  }))
  const link_copies = data.links.map((link, idx) => ({
    link_idx: idx,
    color: link.color,
    label: link.label,
    source: resolve_node_ref(link.source, id_to_idx, data.nodes.length),
    target: resolve_node_ref(link.target, id_to_idx, data.nodes.length),
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
  const cycle = find_cycle(link_copies, data.nodes.length)
  if (cycle) {
    const names = cycle.map((idx) => node_copies[idx].label ?? `${node_copies[idx].id}`)
    throw new Error(
      `Sankey: links must form a DAG but contain the cycle ${names.join(` -> `)}`,
    )
  }

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

  const graph = layout({ nodes: used_nodes, links: link_copies }) as {
    nodes: PositionedNode[]
    links: PositionedLink[]
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
