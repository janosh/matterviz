// Hierarchy layout shared by the part-of-whole charts (Sunburst, Treemap), wrapping
// d3-hierarchy's partition. Single source of truth for the tree semantics (value modes,
// sorting, 'Other' bucketing, color inheritance, stable ids, pre-order indexing) so the
// components stay declarative and the layout is independently unit-testable. The partition
// is computed in normalized coordinates (angle as fraction of full circle in [0, 1], radius
// in integer ring units where y0 === depth) independent of pixel size and zoom — Sunburst
// maps these to screen space per frame (zoomable-sunburst trick), Treemap re-tiles them.

import { hsl } from 'd3-color'
import type { HierarchyNode, HierarchyRectangularNode } from 'd3-hierarchy'
import { hierarchy, partition } from 'd3-hierarchy'
import { PLOT_COLORS } from '$lib/colors'
import type { FillPattern } from '$lib/plot/core/patterns'
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
  // Hatch/texture over this node's fill (not inherited), e.g. to mark a categorical flag
  // like preemptible jobs: a shape name (`diagonal`, `dots`, …), a plotly-style shorthand
  // (`/`, `x`, `.`, …) or full PatternOptions
  pattern?: FillPattern
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
  // Synthetic arc standing for folded siblings (min_fraction/max_children bucketing);
  // its descendants are theirs, merged by label
  is_other?: boolean
  other_count?: number // siblings folded into an `is_other` arc (undefined elsewhere)
  pattern?: FillPattern // hatch/texture from SunburstNode.pattern (not inherited)
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
  // synthetic 'Other' bucket per parent (only when >= 2 qualify). The bucket keeps
  // the folded siblings' descendants under it, merged by label, so the rings below
  // stay populated; it takes the pattern its members share. A node's angular
  // width IS its fraction of the root, so this reads directly as "hide arcs thinner
  // than X". 0 (default) disables bucketing. It cannot promise survivors, though —
  // evenly-split children all fail one threshold together; `max_children` can.
  min_fraction?: number
  // Keep this many children per parent, largest first, bucketing the rest. Unlike
  // `min_fraction` it guarantees a populated ring however the values are
  // distributed. 0 (default) is unlimited. Applied with `min_fraction`: a child has
  // to clear both to be kept. Not a hard cap — the >= 2 rule wins, so a parent with
  // one child over the limit keeps it under its own name rather than as a bucket of
  // one (`max_children: 3` shows all four children of a four-child parent).
  max_children?: number
  // Id of the node the view is currently rooted at, or null at the data root. Only
  // read to pick what `min_fraction` measures against; the layout itself always covers
  // the whole tree and zoom is applied downstream.
  zoom_root_id?: string | number | null
  // Ids of parents whose children are exempt from bucketing. `max_children` is a rank
  // cap, not a threshold, so it re-applies identically at every zoom and re-creates the
  // bucket just drilled into; the same holds for a bucket whose parent is already the
  // view root. Naming the parent explicitly is what lets those open at all.
  expanded_parents?: ReadonlySet<string | number>
  // Label for bucketed arcs, default 'Other'. A function is called once per bucket,
  // so it can name what was folded away ('312 smaller jobs'); its result is display
  // text only — a callable leaves the bucket's id (and `label_short`) at 'Other', so
  // ids stay stable across data updates.
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

  // Sibling index in the caller's own order, captured before `sort` and bucketing
  // rewrite `node.children`. An unlabeled node's id falls back to this index, so
  // reading it off the live array instead would move ids whenever those options
  // change — silently re-pointing a persisted `zoom_root_id` at a different node.
  // Only built when something actually reorders; the map is one entry per node.
  const input_idx = new Map<HierarchyNode<SunburstNode<Metadata>>, number>()
  if (sort !== `none` || min_fraction > 0 || max_children > 0) {
    root.each((node) => node.children?.forEach((kid, idx) => input_idx.set(kid, idx)))
  }

  // The node the view is rooted at, resolved here rather than read off the finished
  // arcs because bucketing decides what those arcs are - the lookup has to come first.
  // Mirrors flatten's id rule below; children are still in the caller's order at this
  // point, which is what makes the ids it derives match the ones flatten will assign.
  let zoom_node: HierarchyNode<SunburstNode<Metadata>> | null = null
  const exempt = new Set<HierarchyNode<SunburstNode<Metadata>>>()
  if (
    (min_fraction > 0 || max_children > 0) &&
    (zoom_root_id != null || expanded_parents?.size)
  ) {
    const walk = (
      node: HierarchyNode<SunburstNode<Metadata>>,
      parent_id: string,
      child_idx: number,
    ): void => {
      const segment = node.data.label ?? `${child_idx}`
      const own =
        node.data.id ??
        (node.depth === 0
          ? (node.data.label ?? ``)
          : `${parent_id !== `` ? `${parent_id}/` : ``}${segment}`)
      if (own === zoom_root_id) zoom_node = node
      if (expanded_parents?.has(own)) exempt.add(node)
      node.children?.forEach((kid, idx) => walk(kid, `${own}`, idx))
    }
    walk(root, ``, 0)
  }
  // Only the zoomed subtree re-measures. Bucketing elsewhere must not move, or an
  // unrelated branch unfolding would deepen the tree and add empty rings to the view.
  const in_zoom_subtree = new Set<HierarchyNode<SunburstNode<Metadata>>>()
  if (zoom_node)
    (zoom_node as HierarchyNode<SunburstNode<Metadata>>).each((node) =>
      in_zoom_subtree.add(node),
    )

  if (sort !== `none`) {
    const sign = sort === `descending` ? -1 : 1
    root.sort((node_a, node_b) => sign * ((node_a.value ?? 0) - (node_b.value ?? 0)))
  }

  type Node = HierarchyNode<SunburstNode<Metadata>>
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
  // The children of several folded siblings as one child list, merged where they
  // share a label (a partition every folded user runs on becomes one arc holding
  // all their jobs). A group of one keeps its data verbatim - id, color, pattern,
  // metadata - since the node it copies is never emitted itself; a merged group is
  // synthetic: no metadata, and color/pattern only where the members agree. Every
  // node carries its summed value so the subtree needs no re-aggregation.
  const merge_children = (members: Node[]): SunburstNode<Metadata>[] | undefined => {
    const kids = members.flatMap((member) => member.children ?? [])
    if (kids.length === 0) return undefined
    const groups = new Map<string | number, Node[]>()
    kids.forEach((kid, idx) => {
      const key = kid.data.label ?? kid.data.id ?? `#${idx}`
      groups.set(key, [...(groups.get(key) ?? []), kid])
    })
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
      }
    })
  }

  // 'Other' bucketing: replace the bucketed children at the end of each sibling
  // list (after sorting, before partition) with one synthetic bucket node that
  // holds their merged descendants, so the rings below a bucket stay as populated
  // as they were under the nodes it stands for. The bucket's own pattern is the one
  // its members share (a hatch marking a whole subtree survives folding), else none.
  //
  // Which children fold is decided once, here, and read back during flatten.
  // Re-deriving it there from a value threshold only worked while the rule was a
  // pure comparison; `max_children` ranks siblings against each other, so the cut
  // is no longer a property any single child carries.
  const buckets = new Map<Node, number>() // synthetic bucket node -> siblings folded
  if (min_fraction > 0 || max_children > 0) {
    const sign = sort === `descending` ? -1 : 1
    // Rewriting `node.children` from inside `each` is safe: d3's traversal is a
    // generator that reads a node's children only after yielding it, so the
    // callback runs first and the queue picks up the new array - including the
    // bucket's merged subtree, which is what buckets it recursively. Each node is
    // still visited exactly once, and the decision below depends only on that
    // node's own values, so the visit order among siblings cannot change it.
    root.each((node) => {
      const kids = node.children
      // An explicitly expanded parent keeps every child under its own name
      if (!kids || exempt.has(node)) return
      // Guarded, not just multiplied: a non-finite `min_fraction` would make every
      // `value >= threshold` false and collapse the parent's whole child list into
      // one bucket, silently discarding a `max_children` ranking that still works.
      // Measured against the total of whatever the view is rooted at, so drilling in
      // re-measures a parent's children against the smaller total - which is what
      // dissolves a bucket into the real nodes it stood for. At the data root this is
      // the root total, so an unzoomed chart buckets exactly as it did before.
      const basis = (in_zoom_subtree.has(node) ? zoom_node?.value : root.value) ?? 0
      const threshold = min_fraction > 0 ? min_fraction * basis : 0
      const eligible = kids.filter((kid) => (kid.value ?? 0) >= threshold)
      // `min_fraction` measures each child on its own, but `max_children` ranks them
      // against each other — so only a cap that actually bites pays for the sort.
      // `toSorted` is stable, so value ties break by input order, reproducibly.
      const keep = new Set(
        max_children > 0 && eligible.length > max_children
          ? eligible
              .toSorted((left, right) => (right.value ?? 0) - (left.value ?? 0))
              .slice(0, max_children)
          : eligible,
      )
      // A bucket of one is just that child under a worse name.
      if (kids.length - keep.size < 2) return
      const smalls = kids.filter((kid) => !keep.has(kid))
      const bucket = hierarchy<SunburstNode<Metadata>>(
        {
          value: smalls.reduce((sum, kid) => sum + (kid.value ?? 0), 0),
          children: merge_children(smalls),
          pattern: shared_field(smalls, `pattern`),
        },
        (entry) => entry.children,
      )
      // Graft the bucket in as `node`'s last child: partition positions by depth and
      // value, and the merged data already carries every summed value.
      bucket.parent = node
      bucket.each((member) => {
        // Both typed readonly (d3 sets them from its own root) but plain fields
        const writable = member as { depth: number; value?: number }
        writable.depth += node.depth + 1
        writable.value = member.data.value
        if (in_zoom_subtree.has(node)) in_zoom_subtree.add(member)
      })
      if (sort !== `none`) {
        bucket.sort((node_a, node_b) => sign * ((node_a.value ?? 0) - (node_b.value ?? 0)))
      }
      // The children that stay keep the caller's order however they were ranked;
      // only the folded run moves to the end, as the bucket.
      node.children = [...kids.filter((kid) => keep.has(kid)), bucket]
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
      color = hsl(base)
        .brighter(level_lighten * (depth - 1))
        .formatHex()
    }
    return { base, color }
  }

  // Construct + append an arc, deriving indices, breadcrumbs and fractions from the
  // parent
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
      // Ids are lookup keys (zoom root, legend muting, the `zoom_root_id` a caller
      // may persist), so they must hold still while the data moves. A callable
      // label can encode the count, so only a literal one is allowed into the id.
      segment = callable ? OTHER_ID_SEGMENT : label
      // A generated name ('312 smaller jobs') rarely fits a thin outer ring, and
      // without a compact form the label is dropped rather than shortened.
      label_short = callable ? OTHER_ID_SEGMENT : undefined
    }
    const id = node.data.id ?? (depth === 0 ? (label ?? ``) : `${parent_prefix}${segment}`)

    const { x0, x1, y0, y1 } = node
    const arc = push_arc(parent, {
      id,
      label,
      label_short,
      value,
      color,
      depth,
      is_leaf: !node.children?.length,
      ...(other_count && { is_other: true, other_count }),
      pattern: node.data.pattern,
      x0,
      x1,
      y0,
      y1,
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
