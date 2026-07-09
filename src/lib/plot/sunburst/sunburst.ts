// Layout helpers for Sunburst charts, wrapping d3-hierarchy's partition.
// Single source of truth for the hierarchy/angle math so the component stays
// declarative and the layout is independently unit-testable. The partition is
// computed in normalized coordinates (angle as fraction of full circle in [0, 1],
// radius in integer ring units where y0 === depth) independent of pixel size and
// zoom — the component maps these to screen space per frame (zoomable-sunburst trick).

import { hsl } from 'd3-color'
import type { HierarchyRectangularNode } from 'd3-hierarchy'
import { hierarchy, partition } from 'd3-hierarchy'
import { DEFAULT_SERIES_COLORS } from '$lib/plot/core/types'
import { DEFAULTS } from '$lib/settings'

// === Sunburst chart types ===
// How node values are interpreted (plotly `branchvalues` semantics):
// 'leaf-sum'  - parent values ignored, computed as sum of leaf values (d3 .sum default)
// 'total'     - every node's value is authoritative; children should sum <= parent
//               (plotly branchvalues='total'; a shortfall leaves an angular gap)
// 'remainder' - a node's own value is added on top of its children's sum
export type SunburstValueMode = `leaf-sum` | `total` | `remainder`
// Arc label orientation: 'auto' picks radial/tangential per arc based on available space
export type SunburstLabelRotation = `auto` | `radial` | `tangential` | `horizontal`
// Sibling ordering: 'none' preserves input order (e.g. spacegroup number order)
export type SunburstSort = `descending` | `ascending` | `none`
// What arc labels display (plotly textinfo equivalent); percent is of the root total
export type SunburstLabelText =
  | `label`
  | `value`
  | `percent`
  | `label+value`
  | `label+percent`
  | `label+parent-percent`
// Chart geometry: polar rings (sunburst) or stacked horizontal rows (icicle)
export type SunburstShape = `sunburst` | `icicle`

export interface SunburstNode<Metadata = Record<string, unknown>> {
  id?: string | number // stable id (defaults to slash-joined label path, e.g. "cubic/Fm-3m")
  label?: string
  // Compact last-resort label (e.g. a bare percentage) tried when the full
  // label doesn't fit the node; without it the label is hidden entirely.
  label_short?: string
  value?: number // required on leaves ('leaf-sum') / authoritative on all nodes ('total')
  color?: string // explicit color, inherited by descendants without their own
  // Overlay a diagonal-hatch texture on this node's arc (not inherited), e.g. to
  // mark a categorical flag like preemptible jobs. Styled via the
  // --sunburst-hatch-* CSS vars.
  hatch?: boolean
  children?: SunburstNode<Metadata>[]
  metadata?: Metadata
}

// Event payload for hover/click/zoom callbacks: a PositionedArc minus its geometry
// (screen coords are an implementation detail), plus the resolved parent id
export interface SunburstNodeHandlerProps<Metadata = Record<string, unknown>> extends Omit<
  PositionedArc<Metadata>,
  `x0` | `x1` | `y0` | `y1` | `subtree_end` | `parent_idx`
> {
  type: `node`
  parent_id: string | number | null
}

// An arc after layout, in normalized partition coordinates (pixel mapping at render)
export interface PositionedArc<Metadata = Record<string, unknown>> {
  node_idx: number // pre-order index (root = 0)
  // Pre-order index of this node's last descendant (= node_idx for leaves). Descendants
  // occupy the contiguous range [node_idx, subtree_end] -> O(1) ancestor/descendant tests.
  subtree_end: number
  parent_idx: number | null
  id: string | number
  label?: string
  label_short?: string // compact fallback from SunburstNode.label_short
  value: number
  color: string // resolved: explicit > inherited > depth-1 palette (root: transparent)
  depth: number // 0 = root; equals y0
  is_leaf: boolean
  path: (string | number)[] // id breadcrumb from depth-1 ancestor to self (empty for root)
  label_path: string[] // display labels along the same chain
  fraction: number // value / root total
  parent_fraction: number // value / parent value (1 for root)
  is_other?: boolean // synthetic arc aggregating small siblings (min_fraction bucketing)
  hatch?: boolean // diagonal-hatch overlay from SunburstNode.hatch (not inherited)
  x0: number // angular extent as fraction of the full circle, in [0, 1]
  x1: number
  y0: number // radial extent in ring units: y0 === depth, y1 === depth + 1
  y1: number
  metadata?: Metadata
}

// Intrinsic arc fields passed to push_arc(); it derives the rest (pre-order indices,
// breadcrumbs and fractions) from the parent and tree position.
type ArcSeed<Metadata = Record<string, unknown>> = Omit<
  PositionedArc<Metadata>,
  | `node_idx`
  | `subtree_end`
  | `parent_idx`
  | `path`
  | `label_path`
  | `fraction`
  | `parent_fraction`
>

export interface SunburstLayoutOptions {
  value_mode?: SunburstValueMode // default 'leaf-sum'
  sort?: SunburstSort // default 'none' (preserve input order)
  // Brighten inherited (non-explicit) colors by depth: hsl.brighter(level_lighten * (depth - 1)).
  // 0 (default) keeps every descendant exactly its depth-1 ancestor's color (plotly-style).
  level_lighten?: number
  // Aggregate sibling arcs smaller than this fraction of the root total into one
  // synthetic 'Other' leaf per parent (only when >= 2 qualify). Keeps long-tail
  // distributions readable. 0 (default) disables bucketing.
  min_fraction?: number
  other_label?: string // label for bucketed arcs, default 'Other'
}

export interface SunburstLayoutResult<Metadata = Record<string, unknown>> {
  arcs: PositionedArc<Metadata>[] // pre-order, includes the root at index 0
  root: PositionedArc<Metadata> | null // arcs[0] convenience alias
  max_depth: number // deepest ring (root = 0)
}

// Compute normalized arc extents, resolved colors and breadcrumbs for a node tree.
// Never mutates user data: d3-hierarchy wraps inputs in HierarchyNodes and all derived
// fields (value overrides, ids, colors) are written onto the returned arcs only.
export function compute_sunburst_layout<Metadata = Record<string, unknown>>(
  data: SunburstNode<Metadata> | SunburstNode<Metadata>[],
  opts: SunburstLayoutOptions = {},
): SunburstLayoutResult<Metadata> {
  const {
    // value_mode/min_fraction fallbacks derive from DEFAULTS.sunburst to prevent drift
    value_mode = DEFAULTS.sunburst.value_mode,
    sort = `none`,
    level_lighten = 0,
    min_fraction = DEFAULTS.sunburst.min_fraction,
    other_label = `Other`,
  } = opts
  // Fresh object each call (not a shared constant) so callers can't corrupt each other
  if (Array.isArray(data) ? data.length === 0 : !data) {
    return { arcs: [], root: null, max_depth: 0 }
  }

  // Single root node is used directly; arrays get a synthetic invisible root
  const root_data: SunburstNode<Metadata> = Array.isArray(data) ? { children: data } : data
  const root = hierarchy<SunburstNode<Metadata>>(root_data, (node) => node.children)

  // Coerce non-finite/negative input values to 0 at the source so downstream
  // consumers (partition angles, treemap tiling, fractions in aria/hover labels)
  // never see NaN or negative values.
  const clean_value = (val: number | undefined | null): number =>
    typeof val === `number` && Number.isFinite(val) && val >= 0 ? val : 0

  // 'remainder': d3's .sum() adds the node's own value on top of its children's sum,
  // which is exactly plotly's branchvalues='remainder'. 'leaf-sum' ignores parent values.
  // 'total': every explicitly set value is authoritative (plotly branchvalues='total');
  // nodes without one get their children's sum. Children summing to less than their
  // parent leave a trailing angular gap; more than the parent overflows (plotly errors
  // here; we warn and the component clamps angles).
  if (value_mode === `remainder`) root.sum((node) => clean_value(node.value))
  else if (value_mode === `total`) {
    root.eachAfter((node) => {
      const child_sum = node.children?.reduce((sum, child) => sum + (child.value ?? 0), 0) ?? 0
      // HierarchyNode.value is typed readonly (normally set via .sum()), but manual
      // assignment is the documented d3 way to provide values without aggregation
      ;(node as { value?: number }).value =
        node.data.value != null ? clean_value(node.data.value) : child_sum
      if (node.children && node.data.value != null && child_sum > node.data.value + 1e-9) {
        console.warn(
          `Sunburst: children of "${
            node.data.label ?? node.data.id ?? `root`
          }" sum to ${child_sum}, exceeding its value of ${node.data.value} (value_mode='total')`,
        )
      }
    })
  } else root.sum((node) => (node.children?.length ? 0 : clean_value(node.value)))

  if (sort !== `none`) {
    const sign = sort === `descending` ? -1 : 1
    root.sort((node_a, node_b) => sign * ((node_a.value ?? 0) - (node_b.value ?? 0)))
  }

  // 'Other' bucketing: move sub-threshold children to the end of each sibling list
  // (after sorting, before partition) so the smalls occupy one contiguous angular run
  // that flatten() below can merge into a single synthetic arc.
  const bucket_threshold = min_fraction > 0 ? min_fraction * (root.value ?? 0) : 0
  if (bucket_threshold > 0) {
    root.each((node) => {
      if (!node.children) return
      const small = node.children.filter((child) => (child.value ?? 0) < bucket_threshold)
      if (small.length >= 2) {
        const kept = node.children.filter((child) => (child.value ?? 0) >= bucket_threshold)
        node.children = [...kept, ...small]
      }
    })
  }

  // x in [0, 1] (angle fraction), y in ring units (y0 === depth, y1 === depth + 1)
  const part_root = partition<SunburstNode<Metadata>>().size([1, root.height + 1])(root)

  const arcs: PositionedArc<Metadata>[] = []
  const seen_ids = new Set<string | number>()
  const root_value = root.value ?? 0
  const palette_len = DEFAULT_SERIES_COLORS.length
  let depth1_count = 0 // running index among depth-1 nodes, for palette cycling

  // Resolved fill for a node: explicit > depth-1 palette > inherited, optionally
  // lightened by depth. base = unlightened color descendants inherit.
  const resolve_color = (
    depth: number,
    explicit: string | undefined,
    parent_base: string | null,
  ): { base: string; color: string } => {
    const base =
      explicit ??
      (depth === 1
        ? DEFAULT_SERIES_COLORS[depth1_count++ % palette_len]
        : (parent_base ?? `transparent`))
    let color = base
    if (!explicit && depth > 1 && level_lighten > 0) {
      color = hsl(base)
        .brighter(level_lighten * (depth - 1))
        .formatHex()
    }
    return { base, color }
  }

  // Construct + append an arc, deriving indices, breadcrumbs and fractions from the
  // parent (shared by regular nodes and synthetic 'Other' arcs)
  const push_arc = (
    parent: PositionedArc<Metadata> | null,
    fields: ArcSeed<Metadata>,
  ): PositionedArc<Metadata> => {
    if (seen_ids.has(fields.id)) {
      console.warn(
        `Sunburst: duplicate node id "${fields.id}" — set unique \`id\`s or labels.`,
      )
    }
    seen_ids.add(fields.id)
    const arc: PositionedArc<Metadata> = {
      node_idx: arcs.length,
      subtree_end: arcs.length, // leaves keep this; branches update after recursion
      parent_idx: parent?.node_idx ?? null,
      path: parent ? [...parent.path, fields.id] : [],
      label_path: parent ? [...parent.label_path, fields.label ?? `${fields.id}`] : [],
      fraction: root_value > 0 ? fields.value / root_value : 0,
      parent_fraction: parent ? (parent.value > 0 ? fields.value / parent.value : 0) : 1,
      ...fields,
    }
    arcs.push(arc)
    return arc
  }

  // Pre-order DFS so each subtree occupies a contiguous node_idx range
  const flatten = (
    node: HierarchyRectangularNode<SunburstNode<Metadata>>,
    parent: PositionedArc<Metadata> | null,
    parent_base: string | null, // unlightened color descendants inherit
    child_idx: number, // index among siblings (fallback id segment for unlabeled nodes)
  ): void => {
    const { depth } = node
    const explicit = node.data.color
    const { base, color } = resolve_color(depth, explicit, parent_base)

    // Stable id: explicit, else slash-joined label path (e.g. "cubic/Fm-3m")
    const parent_prefix = parent && parent.id !== `` ? `${parent.id}/` : ``
    const segment = node.data.label ?? `${child_idx}`
    const id =
      node.data.id ?? (depth === 0 ? (node.data.label ?? ``) : `${parent_prefix}${segment}`)

    const { x0, x1, y0, y1 } = node
    const arc = push_arc(parent, {
      id,
      label: node.data.label,
      label_short: node.data.label_short,
      value: node.value ?? 0,
      color,
      depth,
      is_leaf: !node.children?.length,
      hatch: node.data.hatch,
      x0,
      x1,
      y0,
      y1,
      metadata: node.data.metadata,
    })

    // Children below the bucket threshold form a contiguous trailing run (reordered
    // above); merge runs of >= 2 into one synthetic 'Other' leaf instead of recursing
    const kids = node.children ?? []
    let cut = kids.length
    if (bucket_threshold > 0) {
      const first_small = kids.findLastIndex((kid) => (kid.value ?? 0) >= bucket_threshold) + 1
      if (kids.length - first_small >= 2) cut = first_small
    }
    kids.forEach((child, idx) => {
      if (idx < cut) flatten(child, arc, explicit ?? base, idx)
    })
    if (cut < kids.length) {
      const smalls = kids.slice(cut)
      push_arc(arc, {
        id: `${arc.id !== `` ? `${arc.id}/` : ``}${other_label}`,
        label: other_label,
        value: smalls.reduce((sum, child) => sum + (child.value ?? 0), 0),
        color: resolve_color(depth + 1, undefined, explicit ?? base).color,
        depth: depth + 1,
        is_leaf: true,
        is_other: true,
        x0: smalls[0].x0,
        x1: smalls[smalls.length - 1].x1,
        y0: depth + 1,
        y1: depth + 2,
      })
    }
    arc.subtree_end = arcs.length - 1
  }
  flatten(part_root, null, null, 0)

  return { arcs, root: arcs[0], max_depth: root.height }
}

// Build a nested node tree from flat path rows (plotly-express style), e.g.
// { path: ['cubic', 'Fm-3m'], value: 12 }. Rows sharing a full path accumulate their
// values; rows whose path is a proper prefix of others set that interior node's own
// value (meaningful with value_mode 'total'/'remainder').
export function sunburst_from_paths<Metadata = Record<string, unknown>>(
  rows: readonly {
    path: readonly (string | number)[]
    value: number
    color?: string
    metadata?: Metadata
  }[],
): SunburstNode<Metadata>[] {
  interface TrieNode {
    node: SunburstNode<Metadata>
    children: Map<string | number, TrieNode>
  }
  const roots = new Map<string | number, TrieNode>()

  rows.forEach((row, row_idx) => {
    if (!row.path || row.path.length === 0) {
      throw new Error(`sunburst_from_paths: row ${row_idx} has an empty path`)
    }
    let level = roots
    let trie: TrieNode | undefined
    let id = ``
    for (const segment of row.path) {
      id = id ? `${id}/${segment}` : `${segment}`
      trie = level.get(segment)
      if (!trie) {
        trie = { node: { id, label: `${segment}` }, children: new Map() }
        level.set(segment, trie)
      }
      level = trie.children
    }
    const node = (trie as TrieNode).node
    node.value = (node.value ?? 0) + row.value
    if (row.color != null) node.color = row.color
    if (row.metadata != null) node.metadata = row.metadata
  })

  const to_nodes = (level: Map<string | number, TrieNode>): SunburstNode<Metadata>[] =>
    [...level.values()].map(({ node, children }) =>
      children.size ? { ...node, children: to_nodes(children) } : node,
    )
  return to_nodes(roots)
}

// Build a nested node tree from plotly trace arrays (labels/parents/values [+ ids]),
// the format pymatviz/matbench-discovery sunburst exports use (with branchvalues
// 'total' -> pair with value_mode 'total'). parents entries of ''/null/undefined mark
// root-level nodes; parents reference ids when given, else labels.
export function sunburst_from_labels_parents<Metadata = Record<string, unknown>>(
  labels: readonly string[],
  parents: readonly (string | null | undefined)[],
  values?: readonly number[],
  opts: {
    ids?: readonly (string | number)[]
    colors?: readonly (string | undefined)[]
    metadata?: readonly (Metadata | undefined)[]
  } = {},
): SunburstNode<Metadata>[] {
  const { ids, colors, metadata } = opts
  for (const [name, arr] of [
    [`parents`, parents],
    [`values`, values],
    [`ids`, ids],
    [`colors`, colors],
    [`metadata`, metadata],
  ] as const) {
    if (arr && arr.length !== labels.length) {
      throw new Error(
        `sunburst_from_labels_parents: labels (${labels.length}) and ${name} (${arr.length}) must have equal length`,
      )
    }
  }

  const key_to_idx = new Map<string | number, number>()
  const nodes: SunburstNode<Metadata>[] = labels.map((label, idx) => {
    const key = ids?.[idx] ?? label
    if (key_to_idx.has(key)) {
      throw new Error(
        `sunburst_from_labels_parents: duplicate node ${
          ids ? `id` : `label`
        } "${key}"${ids ? `` : ` — pass opts.ids to disambiguate`}`,
      )
    }
    key_to_idx.set(key, idx)
    const node: SunburstNode<Metadata> = { id: key, label }
    if (values?.[idx] != null) node.value = values[idx]
    if (colors?.[idx] != null) node.color = colors[idx]
    if (metadata?.[idx] != null) node.metadata = metadata[idx]
    return node
  })

  // Resolve all parent references up front (one map lookup per node)
  const parent_idxs: (number | null)[] = labels.map((_, idx) => {
    const ref = parents[idx]
    if (ref == null || ref === ``) return null
    const found = key_to_idx.get(ref)
    if (found === undefined) {
      throw new Error(
        `sunburst_from_labels_parents: node "${
          ids?.[idx] ?? labels[idx]
        }" references unknown parent "${ref}"`,
      )
    }
    return found
  })

  // O(n) cycle detection: walk each unvisited parent chain once, marking nodes
  // 'in-progress' on the way up. Hitting an in-progress node = cycle; hitting a
  // 'done' node = chain already verified acyclic.
  const state = new Uint8Array(nodes.length) // 0 = unvisited, 1 = in progress, 2 = done
  for (let idx = 0; idx < nodes.length; idx++) {
    if (state[idx] !== 0) continue
    let cur: number | null = idx
    while (cur != null && state[cur] === 0) {
      state[cur] = 1
      cur = parent_idxs[cur]
    }
    if (cur != null && state[cur] === 1) {
      throw new Error(
        `sunburst_from_labels_parents: cycle detected involving node "${
          ids?.[cur] ?? labels[cur]
        }"`,
      )
    }
    // Mark the walked chain as verified
    for (let mark: number | null = idx; mark != null && state[mark] === 1; ) {
      state[mark] = 2
      mark = parent_idxs[mark]
    }
  }

  const roots: SunburstNode<Metadata>[] = []
  nodes.forEach((node, idx) => {
    const parent = parent_idxs[idx]
    if (parent == null) roots.push(node)
    else (nodes[parent].children ??= []).push(node)
  })
  return roots
}
