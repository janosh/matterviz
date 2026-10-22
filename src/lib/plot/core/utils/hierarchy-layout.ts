// Hierarchy layout shared by Sunburst and Treemap, wrapping d3-hierarchy's partition: value
// modes, sorting, 'Other' bucketing, color inheritance, stable ids, pre-order indexing. The
// partition is in normalized coordinates (angle fraction in [0, 1], y0 === depth) independent
// of pixel size and zoom: Sunburst maps it to screen space per frame, Treemap re-tiles it.

import { hsl } from 'd3-color'
import type { HierarchyNode, HierarchyRectangularNode } from 'd3-hierarchy'
import { hierarchy, partition } from 'd3-hierarchy'
import { PLOT_COLORS } from '#lib/colors/index.js'
import type { FillPattern } from '#lib/plot/core/patterns.js'
import { DEFAULTS } from '#lib/settings.js'

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
  // Compact last-resort label tried when the full label doesn't fit (else it's hidden)
  label_short?: string
  value?: number // required on leaves ('leaf-sum') / authoritative on all nodes ('total')
  color?: string // explicit color, inherited by descendants without their own
  // Hatch/texture over this node's fill (not inherited): a shape name (`diagonal`, `dots`,
  // …), a plotly-style shorthand (`/`, `x`, `.`, …) or full PatternOptions
  pattern?: FillPattern
  // Exempt from its parent's 'Other' bucketing: takes no `max_children` slot and ignores
  // `min_fraction` (e.g. a small idle-capacity branch next to many big users). It still
  // moves into a bucket along with its parent if that folds (kept there too).
  keep?: boolean
  children?: SunburstNode<Metadata>[]
  metadata?: Metadata
}

// Event payload for hover/click/zoom callbacks: a PositionedArc minus geometry, plus parent id
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
  // Pre-order index of the last descendant: subtrees are contiguous [node_idx, subtree_end]
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
  // Synthetic arc for folded siblings; its descendants are theirs, merged by label
  is_other?: boolean
  other_count?: number // siblings folded into an `is_other` arc (undefined elsewhere)
  pattern?: FillPattern // hatch/texture from SunburstNode.pattern (not inherited)
  x0: number // angular extent as fraction of the full circle, in [0, 1]
  x1: number
  y0: number // radial extent in ring units: y0 === depth, y1 === depth + 1
  y1: number
  metadata?: Metadata
}

// Intrinsic arc fields passed to push_arc(), which derives the rest from the parent
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
  // Brighten inherited colors by depth: hsl.brighter(level_lighten * (depth - 1)).
  // 0 (default) keeps every descendant its depth-1 ancestor's color (plotly-style).
  level_lighten?: number
  // Fold sibling arcs below this fraction of the (view) root total into one 'Other' bucket
  // per parent (only when >= 2 qualify), keeping their descendants merged by label and any
  // shared pattern. 0 (default) disables. Evenly-split children may all fold together.
  min_fraction?: number
  // Keep this many children per parent, largest first, bucketing the rest (0 = unlimited).
  // A child must clear both this and `min_fraction`. Not a hard cap: the >= 2 rule wins, so
  // `max_children: 3` shows all four children of a four-child parent. Nodes flagged
  // `keep` are exempt from both and don't count toward this cap.
  max_children?: number
  // Id of the current view root (null = data root). Only picks what `min_fraction`
  // measures against; the layout always covers the whole tree.
  zoom_root_id?: string | number | null
  // Ids of parents exempt from bucketing. Needed since `max_children` re-applies identically
  // at every zoom, as does any bucket whose parent already is the view root.
  expanded_parents?: ReadonlySet<string | number>
  // Label for bucketed arcs, default 'Other'. A function is called per bucket (e.g. '312
  // smaller jobs') for display only: id and `label_short` stay 'Other' so ids stay stable.
  other_label?: string | ((bucket: OtherBucketInfo) => string)
}

// Id segment (and compact label) for buckets whose `other_label` is callable
const OTHER_ID_SEGMENT = `Other`

// What a bucketed arc stands for, passed to a callable `other_label`.
export interface OtherBucketInfo {
  count: number // siblings folded in (always >= 2)
  value: number // their summed value
  depth: number // ring the bucket sits on
  parent_label?: string // label of the parent whose children were folded
}

export interface SunburstLayoutResult<Metadata = Record<string, unknown>> {
  arcs: PositionedArc<Metadata>[] // pre-order, includes the root at index 0
  root: PositionedArc<Metadata> | null // arcs[0] convenience alias
  max_depth: number // deepest ring (root = 0)
}

// Compute normalized arc extents, resolved colors and breadcrumbs for a node tree.
// Never mutates user data: derived fields are written onto the returned arcs only.
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
    max_children = 0,
    zoom_root_id = null,
    expanded_parents,
    other_label = `Other`,
  } = opts
  // Fresh object each call (not a shared constant) so callers can't corrupt each other
  if (Array.isArray(data) ? data.length === 0 : !data) {
    return { arcs: [], root: null, max_depth: 0 }
  }

  // Single root node is used directly; arrays get a synthetic invisible root
  const root_data: SunburstNode<Metadata> = Array.isArray(data) ? { children: data } : data
  const root = hierarchy<SunburstNode<Metadata>>(root_data, (node) => node.children)

  // Coerce non-finite/negative input values to 0 so nothing downstream sees NaN
  const clean_value = (val: number | undefined | null): number =>
    typeof val === `number` && Number.isFinite(val) && val >= 0 ? val : 0

  // 'remainder' is d3's .sum(); 'leaf-sum' ignores parent values; 'total' treats explicit
  // values as authoritative (else the children's sum). Children under-summing leave a gap;
  // over-summing warns (plotly errors) and the component clamps angles.
  if (value_mode === `remainder`) root.sum((node) => clean_value(node.value))
  else if (value_mode === `total`) {
    root.eachAfter((node) => {
      const child_sum = node.children?.reduce((sum, child) => sum + (child.value ?? 0), 0) ?? 0
      // HierarchyNode.value is typed readonly, but manual assignment is documented d3 usage
      const own = node.data.value
      ;(node as { value?: number }).value = own != null ? clean_value(own) : child_sum
      // Against the coerced value: a NaN parent renders as 0, collapsing its subtree
      if (node.children && own != null && child_sum > (node.value ?? 0) + 1e-9) {
        console.warn(
          `Sunburst: children of "${
            node.data.label ?? node.data.id ?? `root`
          }" sum to ${child_sum}, exceeding its value of ${own} (value_mode='total')`,
        )
      }
    })
  } else root.sum((node) => (node.children?.length ? 0 : clean_value(node.value)))

  // Sibling index in the caller's order, captured before `sort`/bucketing rewrite
  // `node.children`: unlabeled ids fall back to it and must not move with those options
  // (that would re-point a persisted `zoom_root_id`). Only built when something reorders.
  const input_idx = new Map<HierarchyNode<SunburstNode<Metadata>>, number>()
  if (sort !== `none` || min_fraction > 0 || max_children > 0) {
    root.each((node) => node.children?.forEach((kid, idx) => input_idx.set(kid, idx)))
  }

  type Node = HierarchyNode<SunburstNode<Metadata>>
  // Resolve the view root before bucketing (which decides what the arcs are), mirroring
  // flatten's id rule while children are still in caller order. Only the zoomed subtree
  // re-measures: an unrelated branch unfolding would add empty rings to the view.
  let zoom_node: Node | null = null
  const exempt = new Set<Node>()
  const in_zoom_subtree = new Set<Node>()
  const node_ids = new Map<Node, string | number>()
  const has_lookups =
    (min_fraction > 0 || max_children > 0) &&
    (zoom_root_id != null || Boolean(expanded_parents?.size))
  const resolve_ids = (node: Node, parent_id: string | number, segment: string): void => {
    const own =
      node.data.id ??
      (node.depth === 0
        ? (node.data.label ?? ``)
        : `${parent_id !== `` ? `${parent_id}/` : ``}${segment}`)
    node_ids.set(node, own)
    if (own === zoom_root_id) {
      zoom_node = node
      node.each((member) => in_zoom_subtree.add(member))
    }
    if (expanded_parents?.has(own)) exempt.add(node)
    node.children?.forEach((kid, idx) => resolve_ids(kid, own, `${kid.data.label ?? idx}`))
  }
  if (has_lookups) resolve_ids(root, ``, ``)

  const sign = sort === `descending` ? -1 : 1
  const by_value = (node_a: Node, node_b: Node) =>
    sign * ((node_a.value ?? 0) - (node_b.value ?? 0))
  if (sort !== `none`) root.sort(by_value)

  // The value every member of `group` shares for `field`, or undefined if they disagree
  const shared_field = <Field extends `color` | `pattern`>(
    group: Node[],
    field: Field,
  ): SunburstNode<Metadata>[Field] => {
    const first = group[0].data[field]
    const first_json = JSON.stringify(first)
    return group.every((member) => JSON.stringify(member.data[field]) === first_json)
      ? first
      : undefined
  }
  // The children of folded siblings as one child list, merged by label. A group of one
  // keeps its data verbatim; a merged group is synthetic (no metadata, color/pattern only
  // where members agree). Every node carries its summed value, so no re-aggregation.
  const merge_children = (members: Node[]): SunburstNode<Metadata>[] | undefined => {
    const groups = new Map<string | number, Node[]>()
    let child_idx = 0
    for (const member of members) {
      for (const kid of member.children ?? []) {
        const key = kid.data.label ?? kid.data.id ?? `#${child_idx}`
        child_idx++
        const group = groups.get(key)
        if (group) group.push(kid)
        else groups.set(key, [kid])
      }
    }
    if (groups.size === 0) return undefined
    return [...groups.values()].map((group) => {
      const value = group.reduce((sum, kid) => sum + (kid.value ?? 0), 0)
      const children = merge_children(group)
      if (group.length === 1) return { ...group[0].data, value, children }
      return {
        label: group[0].data.label,
        value,
        children,
        color: shared_field(group, `color`),
        pattern: shared_field(group, `pattern`),
        // One kept member is enough: it marks a branch the caller always wants shown
        keep: group.some((kid) => kid.data.keep) || undefined,
      }
    })
  }

  // 'Other' bucketing (after sorting, before partition): the folded children become one
  // trailing bucket node holding their merged descendants and shared pattern. Decided once
  // here and read back in flatten, since `max_children` ranks siblings against each other.
  const buckets = new Map<Node, number>() // synthetic bucket node -> siblings folded
  if (min_fraction > 0 || max_children > 0) {
    // Rewriting `node.children` inside `each` is safe: d3's generator reads children only
    // after yielding a node, so the queue picks up the new array (incl. the bucket's merged
    // subtree, bucketing it recursively) and each node is still visited exactly once.
    root.each((node) => {
      const kids = node.children
      // An explicitly expanded parent keeps every child under its own name
      if (!kids || exempt.has(node)) return
      // Measured against the view root's total, so drilling in dissolves a bucket. Guarded
      // so a non-finite `min_fraction` can't fold every child and drop `max_children` ranking.
      const basis = (in_zoom_subtree.has(node) ? zoom_node?.value : root.value) ?? 0
      const threshold = min_fraction > 0 ? min_fraction * basis : 0
      // `keep`-flagged children bypass both rules and leave the ranking to the rest
      const eligible = kids.filter((kid) => !kid.data.keep && (kid.value ?? 0) >= threshold)
      // Only a cap that bites pays for the sort; `toSorted` is stable so ties keep input order
      const ranked = new Set(
        max_children > 0 && eligible.length > max_children
          ? eligible
              .toSorted((left, right) => (right.value ?? 0) - (left.value ?? 0))
              .slice(0, max_children)
          : eligible,
      )
      const is_small = (kid: Node) => !kid.data.keep && !ranked.has(kid)
      const smalls = kids.filter(is_small)
      // A bucket of one is just that child under a worse name.
      if (smalls.length < 2) return
      const bucket = hierarchy<SunburstNode<Metadata>>(
        {
          value: smalls.reduce((sum, kid) => sum + (kid.value ?? 0), 0),
          children: merge_children(smalls),
          pattern: shared_field(smalls, `pattern`),
        },
        (entry) => entry.children,
      )
      // Graft the bucket in as `node`'s last child (merged data carries summed values)
      bucket.parent = node
      bucket.each((member) => {
        // Both typed readonly (d3 sets them from its own root) but plain fields
        const writable = member as { depth: number; value?: number }
        writable.depth += node.depth + 1
        writable.value = member.data.value
        if (in_zoom_subtree.has(node)) in_zoom_subtree.add(member)
      })
      if (sort !== `none`) bucket.sort(by_value)
      // Resolve synthetic node ids (a caller may zoom to/expand `Other/gpu`) after the sort
      // fixes index segments and before `each` reaches them, so they behave like real nodes
      const parent_id = node_ids.get(node)
      if (parent_id !== undefined) {
        resolve_ids(
          bucket,
          parent_id,
          typeof other_label === `function` ? OTHER_ID_SEGMENT : other_label,
        )
      }
      // Kept children stay in caller order; only the folded run moves to the end
      node.children = [...kids.filter((kid) => !is_small(kid)), bucket]
      buckets.set(bucket, smalls.length)
    })
  }

  // x in [0, 1] (angle fraction), y in ring units (y0 === depth, y1 === depth + 1)
  const part_root = partition<SunburstNode<Metadata>>().size([1, root.height + 1])(root)

  const arcs: PositionedArc<Metadata>[] = []
  const seen_ids = new Set<string | number>()
  const root_value = root.value ?? 0
  const palette_len = PLOT_COLORS.length
  let depth1_count = 0 // running index among depth-1 nodes, for palette cycling
  const inherited_colors = new Map<string, Map<number, string>>()

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
        ? PLOT_COLORS[depth1_count++ % palette_len]
        : (parent_base ?? `transparent`))
    let color = base
    if (!explicit && depth > 1 && level_lighten > 0) {
      let colors = inherited_colors.get(base)
      if (!colors) inherited_colors.set(base, (colors = new Map()))
      color =
        colors.get(depth) ??
        hsl(base)
          .brighter(level_lighten * (depth - 1))
          .formatHex()
      colors.set(depth, color)
    }
    return { base, color }
  }

  // Construct + append an arc, deriving indices, breadcrumbs and fractions from the parent
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
    const value = node.value ?? 0
    const explicit = node.data.color
    const { base, color } = resolve_color(depth, explicit, parent_base)

    // Stable id: explicit, else slash-joined label path (e.g. "cubic/Fm-3m")
    const parent_prefix = parent && parent.id !== `` ? `${parent.id}/` : ``
    const other_count = buckets.get(node)
    let { label, label_short } = node.data
    let segment = label ?? `${child_idx}`
    if (other_count) {
      const callable = typeof other_label === `function`
      label = callable
        ? other_label({ count: other_count, value, depth, parent_label: parent?.label })
        : other_label
      // Ids are lookup keys that must hold still while data moves: only literal labels enter
      segment = callable ? OTHER_ID_SEGMENT : label
      // Generated names rarely fit thin rings, hence the compact form
      label_short = callable ? OTHER_ID_SEGMENT : undefined
    }
    const identifier =
      node.data.id ?? (depth === 0 ? (label ?? ``) : `${parent_prefix}${segment}`)

    const arc = push_arc(parent, {
      id: identifier,
      label,
      label_short,
      value,
      color,
      depth,
      is_leaf: !node.children?.length,
      ...(other_count && { is_other: true, other_count }),
      pattern: node.data.pattern,
      x0: node.x0,
      x1: node.x1,
      y0: node.y0,
      y1: node.y1,
      metadata: node.data.metadata,
    })
    node.children?.forEach((child, idx) => {
      flatten(child, arc, explicit ?? base, input_idx.get(child) ?? idx)
    })
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
    let identifier = ``
    for (const segment of row.path) {
      identifier = identifier ? `${identifier}/${segment}` : `${segment}`
      trie = level.get(segment)
      if (!trie) {
        trie = { node: { id: identifier, label: `${segment}` }, children: new Map() }
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

// Build a nested node tree from plotly trace arrays (labels/parents/values [+ ids]); pair
// branchvalues='total' exports with value_mode 'total'. ''/null/undefined parents mark
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

  // O(n) cycle detection: walk each unvisited parent chain once; reaching an in-progress
  // node means a cycle, a done one means the chain is already verified acyclic
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
    for (let mark: number | null = idx; mark != null && state[mark] === 1;) {
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
