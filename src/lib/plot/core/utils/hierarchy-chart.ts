// Pure helpers shared by the hierarchical part-of-whole charts (Sunburst, Treemap):
// label strings + measured variants, metric coloring, hover/mute dimming, handler
// payloads, breadcrumbs, color-bar layout, keyboard navigation and SVG/PNG export.
// Everything operates on the flat pre-order arc arrays compute_sunburst_layout
// produces, so each chart keeps only its geometry (polar projection vs tiling).

import type { D3InterpolateName } from '$lib/colors'
import { is_opaque_color, opaque_contrast_color } from '$lib/colors'
import { format_value } from '$lib/labels'
import type { Vec2 } from '$lib/math'
import type { ResolvedPattern } from '$lib/plot/core/patterns'
import { resolve_pattern } from '$lib/plot/core/patterns'
import { create_color_scale } from '$lib/plot/core/scales'
import type { FontSpec } from '$lib/plot/core/text-metrics'
import {
  DEFAULT_FONT_SPEC,
  graphemes,
  measure_text_line,
  resolve_font_spec,
} from '$lib/plot/core/text-metrics'
import type { LegendItem } from '$lib/plot/core/types'
import type {
  PositionedArc,
  SunburstLabelText,
  SunburstNodeHandlerProps,
} from '$lib/plot/core/utils/hierarchy-layout'

// === Labels ===

// The semantic node fields label formatting needs (subset of PositionedArc)
interface LabeledNode {
  id: string | number
  label?: string
  label_short?: string
  value: number
  fraction: number
  parent_fraction?: number
}

export const node_display_name = (node: LabeledNode): string => node.label ?? `${node.id}`

// What a node's label displays, per the label_text mode (plotly textinfo
// equivalent); percent is of the root total, parent-percent of the parent node
export function node_label_str(
  node: LabeledNode,
  label_text: SunburstLabelText,
  value_format: string,
): string {
  const name = node_display_name(node)
  if (label_text === `label`) return name
  const val = format_value(node.value, value_format)
  if (label_text === `value`) return val
  if (label_text === `label+value`) return `${name} ${val}`
  if (label_text === `label+parent-percent`) {
    return `${name} (${format_value(node.parent_fraction ?? node.fraction, `.0%`)})`
  }
  const pct = format_value(node.fraction, `.1%`)
  if (label_text === `percent`) return pct
  return `${name} ${pct}` // label+percent
}

// Base + optional richer/compact variants for fit-aware rendering: compound
// modes degrade to the bare label when the full text doesn't fit its node,
// and nodes with a `label_short` degrade once more to that compact form
// before the label is hidden entirely.
export function node_label_variants(
  node: LabeledNode,
  label_text: SunburstLabelText,
  value_format: string,
): { text: string; extended?: string; short?: string } {
  const short = node.label_short
  const text = node_label_str(node, label_text, value_format)
  if (!label_text.startsWith(`label+`)) return { text, short }
  return { text: node_display_name(node), extended: text, short }
}

// `text` if it measures within `max_width` px in `font`, else its longest prefix
// that does with an ellipsis, keeping at least `min_chars` of the text so a lone
// initial does not pose as a name. Null when even that is too wide. Widths come
// from the text-metrics cache, so re-fitting the same arcs per frame costs no
// measuring.
export function ellipsize_to_width(
  text: string,
  max_width: number,
  font: Readonly<FontSpec>,
  min_chars = 2,
): string | null {
  if (measure_text_line(text, font).width <= max_width) return text
  const chars = graphemes(text)
  const width_of = (count: number) =>
    measure_text_line(`${chars.slice(0, count).join(``)}…`, font).width
  if (chars.length <= min_chars || width_of(min_chars) > max_width) return null
  // Binary search the longest fitting prefix: widths grow with the prefix.
  let fits = min_chars
  let too_wide = chars.length
  while (too_wide - fits > 1) {
    const mid = (fits + too_wide) >> 1
    if (width_of(mid) <= max_width) fits = mid
    else too_wide = mid
  }
  return `${chars.slice(0, fits).join(``)}…`
}

// Chart svgs default to 11px labels (--<chart>-font-size); text-metrics' 12px default
// would otherwise be measured whenever the svg isn't mounted yet.
const LABEL_FONT_FALLBACK: Readonly<FontSpec> = { ...DEFAULT_FONT_SPEC, font_size: 11 }

// The font node labels actually render in, for canvas-measured label fitting
export const resolve_label_font = (svg_element: SVGSVGElement | null): FontSpec =>
  resolve_font_spec(svg_element, LABEL_FONT_FALLBACK)

export interface HierarchyNodeInfo {
  // Fit-aware label fallback chain, richest first: extended -> base label ->
  // compact label_short. Rendering picks the first variant whose measured
  // width fits its node; empty when the node has no base label at all.
  variants: { text: string; width: number }[]
  aria: string
  fill: string // the node's color, also the backdrop of its pattern (label contrast keys off it)
  label_fill: string
  // Hatch/texture tile the node paints with instead of its flat `fill` (undefined: none)
  pattern?: ResolvedPattern
  // Color of the blurred halo painted behind the label so it stays legible over the
  // pattern's strokes: the tile backdrop, or the page where the pattern replaces the fill
  label_halo?: string
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
    font: Readonly<FontSpec>
    color_for: (arc: PositionedArc<Metadata>) => string
    pattern_prefix: string // scopes pattern ids to the chart instance
    clickable?: (arc: PositionedArc<Metadata>) => boolean
  },
): HierarchyNodeInfo[] {
  const { label_text, value_format, font, color_for, pattern_prefix, clickable } = opts
  // Black/white label text for opaque fills; unresolved/translucent fills inherit.
  // Memoized per fill: categorical coloring repeats a handful of fills across thousands
  // of nodes, and parsing + luminance per node would dominate this pass.
  const contrast_cache = new Map<string, string>()
  const contrast = (fill: string): string => {
    let label_fill = contrast_cache.get(fill)
    if (label_fill === undefined) {
      label_fill = opaque_contrast_color(fill)
      contrast_cache.set(fill, label_fill)
    }
    return label_fill
  }
  return arcs.map((arc) => {
    const { text, extended, short } = node_label_variants(arc, label_text, value_format)
    const fill = color_for(arc)
    const pattern = arc.pattern && resolve_pattern(arc.pattern, fill, pattern_prefix)
    const variants = (text ? [extended, text, short] : []).flatMap((variant) =>
      variant === undefined
        ? []
        : [{ text: variant, width: measure_text_line(variant, font).width }],
    )
    return {
      variants,
      // What a bucket folded away is the one thing its name can't carry, and a
      // screen reader has no tooltip to fall back on
      aria: `${node_display_name(arc)}: ${arc.value}${
        arc.other_count ? ` (${arc.other_count} grouped)` : ``
      }`,
      fill,
      // Labels sit on the tile backdrop: the node color, or the page in `replace` mode
      label_fill: contrast(pattern?.bg ?? fill),
      pattern,
      label_halo:
        pattern && (is_opaque_color(pattern.bg) ? pattern.bg : `var(--page-bg, white)`),
      ...(clickable ? { clickable: clickable(arc) } : {}),
    }
  })
}

// === Coloring + dimming ===

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

// Legend muting + hover dimming for one node. The hovered node + its ancestors/descendants stay
// fully opaque, other nodes dim to 0.3; muted categories dim hardest. Pre-order indexing makes
// the ancestor/descendant tests O(1): a subtree is the contiguous range [node_idx, subtree_end].
// An accessor, not an array: only on-screen nodes are read, so an array allocated the whole
// hierarchy on every hover move.
export function compute_node_dim<Metadata>(
  arcs: readonly PositionedArc<Metadata>[],
  muted_ids: ReadonlySet<string | number>,
  hovered_idx: number | null,
): (idx: number) => { opacity: number; label_opacity: number | undefined } {
  const hov = hovered_idx != null ? arcs[hovered_idx] : null
  const active = (arc: PositionedArc<Metadata>): boolean =>
    !hov ||
    (arc.node_idx >= hov.node_idx && arc.node_idx <= hov.subtree_end) ||
    (hov.node_idx >= arc.node_idx && hov.node_idx <= arc.subtree_end)
  return (idx) => {
    const arc = arcs[idx]
    const muted = arc.path.length > 0 && muted_ids.has(arc.path[0])
    return {
      opacity: muted ? MUTED_OPACITY : active(arc) ? 1 : 0.3,
      // labels dim only when muted, not when hover-inactive (undefined omits the attr)
      label_opacity: muted ? MUTED_OPACITY : undefined,
    }
  }
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
    display_style: {
      symbol_type: `Square` as const,
      symbol_color: color_for(arc),
      pattern: arc.pattern,
    },
  }))
}

// === Events + navigation ===

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

// Structural subset shared by every hierarchy chart's pre-order node representation.
type PreorderNode = Pick<PositionedArc, `node_idx` | `subtree_end` | `parent_idx` | `depth`>

// Arrow-key navigation over the pre-order node array: ArrowLeft/ArrowRight cycle
// through visible siblings (wrapping), ArrowDown enters the first child, ArrowUp
// returns to the parent (never the hidden root at depth 0). Visibility is delegated
// to is_visible (the component supplies screen-space collapse state). Returns the
// target node_idx, or null when the key isn't an arrow key or no target qualifies.
export function arrow_nav_target(
  nodes: readonly PreorderNode[],
  is_visible: (idx: number) => boolean,
  current_idx: number,
  key: string,
): number | null {
  const current = nodes[current_idx]
  if (!current) return null
  if (key === `ArrowDown`) {
    // pre-order: a branch's first child directly follows it
    const child = nodes[current.node_idx + 1]
    return child && child.parent_idx === current.node_idx && is_visible(child.node_idx)
      ? child.node_idx
      : null
  }
  const parent = current.parent_idx != null ? nodes[current.parent_idx] : null
  if (key === `ArrowUp`) {
    return parent && parent.depth > 0 && is_visible(parent.node_idx) ? parent.node_idx : null
  }
  if (key !== `ArrowRight` && key !== `ArrowLeft`) return null
  // Walk siblings via the contiguous pre-order subtree ranges (each sibling starts right
  // after the previous one's subtree ends) - pre-order already lists siblings in draw
  // order, so no sorting is needed and no full scan runs per keypress
  const last = parent?.subtree_end ?? nodes.length - 1
  const siblings: number[] = []
  for (let idx = (parent?.node_idx ?? 0) + 1; idx <= last; idx = nodes[idx].subtree_end + 1) {
    if (is_visible(idx)) siblings.push(idx)
  }
  if (siblings.length < 2) return null
  const current_pos = siblings.indexOf(current.node_idx)
  const step = key === `ArrowRight` ? 1 : -1
  return siblings[(current_pos + step + siblings.length) % siblings.length]
}

// === Color bar layout ===

export const COLOR_BAR_GAP = 8

// Structural subset of ColorBar's props the layout needs, so this stays a pure module.
type ColorBarLayoutProps = {
  orientation?: `horizontal` | `vertical`
  tick_side?: `primary` | `secondary` | `inside`
  tick_labels?: number | unknown[]
}

export type ColorBarSide = `left` | `right`

type ColorBarLayout = {
  side: ColorBarSide
  is_vertical: boolean
  tick_side: `primary` | `secondary` | `inside`
  tick_padding: string
  inner_width: number
  inner_height: number
  plot_left: number
  offset_px: number // inset of a vertical bar from the side it reserves
}

// Cap either reserve at half its axis so a bad measurement can't collapse the chart.
const reserve_space = (size: number, available: number): number =>
  size > 0 ? Math.min(size + 2 * COLOR_BAR_GAP, available / 2) : 0

// Vertical bars sit beside the chart and reserve width; horizontal bars sit below and
// reserve height. Shared by Sunburst and Treemap so both place color bars identically.
export function color_bar_layout(opts: {
  color_bar: ColorBarLayoutProps | null | undefined
  side: ColorBarSide
  measured: { width: number; height: number }
  avail_width: number
  avail_height: number
  pad: { l: number; r: number }
  tick_space_var: string
}): ColorBarLayout {
  const { color_bar, side, measured, avail_width, avail_height, pad, tick_space_var } = opts
  const is_vertical = color_bar?.orientation === `vertical`
  const tick_side =
    color_bar?.tick_side ?? (is_vertical && side === `left` ? `secondary` : `primary`)
  const has_ticks = Array.isArray(color_bar?.tick_labels)
    ? color_bar.tick_labels.length > 0
    : (color_bar?.tick_labels ?? 4) > 0
  const vertical_reserve = is_vertical ? reserve_space(measured.width, avail_width) : 0
  const horizontal_reserve = is_vertical ? 0 : reserve_space(measured.height, avail_height)
  return {
    side,
    is_vertical,
    tick_side,
    tick_padding:
      !has_ticks || tick_side === `inside`
        ? `0`
        : tick_side === `primary`
          ? `0 var(${tick_space_var}, 5em) 0 0`
          : `0 0 0 var(${tick_space_var}, 5em)`,
    inner_width: avail_width - vertical_reserve,
    inner_height: avail_height - horizontal_reserve,
    plot_left: pad.l + (side === `left` ? vertical_reserve : 0),
    offset_px: (side === `left` ? pad.l : pad.r) + COLOR_BAR_GAP,
  }
}

// === Export ===
