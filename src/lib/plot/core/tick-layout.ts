// Tick-label layout: decides how an axis's labels are drawn (upright, wrapped, rotated,
// thinned, staggered or ellipsized) from their measured pixel geometry. Shared by
// calc_auto_padding (to reserve the label band) and PlotAxis (to render the winning layout).
// Pure geometry lives at the top; text measurement goes through the text-metrics cache.

import { format_tick_values } from '$lib/labels'
import { array_max, array_min, clamp } from '$lib/math'
import { get_tick_label } from '$lib/plot/core/scales'
import {
  DEFAULT_FONT_SPEC,
  get_text_metrics_revision,
  measure_text_line,
  graphemes,
} from '$lib/plot/core/text-metrics'
import type { FontSpec } from '$lib/plot/core/text-metrics'
import type { AxisConfig, TickAutoLayoutConfig } from '$lib/plot/core/types'

// Deterministic pre-mount height. PlotAxis replaces this font with the resolved computed font.
export const TICK_LABEL_HEIGHT = 16
export const TICK_LABEL_GAP = 1
const TICK_STAGGER_GAP = 4
const TICK_ROTATION_LADDER = [30, 45, 60, 90] as const
const DEFAULT_TICK_LABEL_MAX_LINES = 3
const DEFAULT_AUTO_LABEL_BAND = 80
// Sub-pixel float dust from AABB corner math; reused for feasibility edge checks.
const TICK_GEOMETRY_EPSILON = Number.EPSILON * 16

export const TICK_STRATEGIES = [
  `upright`,
  `wrap`,
  `rotate`,
  `stagger`,
  `thin`,
  `ellipsis`,
] as const
export type TickStrategy = (typeof TICK_STRATEGIES)[number]
// Ellipsis is opt-in; default staggering is only generated when upright labels collide.
const DEFAULT_STRATEGY_ORDER = [`upright`, `wrap`, `rotate`, `thin`, `stagger`] as const
const STRATEGY_TIE_ORDER = [
  `upright`,
  `wrap`,
  `stagger`,
  `rotate`,
  `ellipsis`,
  `thin`,
] as const

export type TickLayoutSide = `x` | `x2` | `y` | `y2`
type TickLabelAnchor = `start` | `middle` | `end`
const ANCHORS = [`start`, `middle`, `end`] as const
const is_horizontal_side = (side: TickLayoutSide): boolean => side === `x` || side === `x2`

// === Text measurement ===

// Width via the shared text-metrics cache, in the FontSpec resolved off a rendered tick
export const measure_text_width = (
  text: string,
  font: Readonly<FontSpec> = DEFAULT_FONT_SPEC,
): number => measure_text_line(text, font).width

const tick_texts = (
  ticks: readonly (string | number)[],
  format?: string,
  tick_labels?: AxisConfig[`ticks`],
): string[] => {
  const numeric_texts = format_tick_values(
    ticks.filter((tick): tick is number => typeof tick === `number`),
    format,
  )
  let numeric_idx = 0
  return ticks.map((tick) => {
    if (typeof tick === `string`) return tick
    const text = numeric_texts[numeric_idx++]
    return get_tick_label(tick, tick_labels) ?? text
  })
}

// === Label geometry ===

// `axis` is x for x/x2 and y for y/y2. `cross_axis` is the actual label origin after
// tick offset, configured shifts, and staggering have been applied.
interface TickLabelPosition {
  axis: number
  cross_axis: number
}
interface TickAxisExtent {
  start: number
  end: number
}
export interface TickLabelDimensions {
  line_widths: readonly number[]
  line_height: number
}
interface TickAabb {
  min_x: number
  min_y: number
  max_x: number
  max_y: number
  width: number
  height: number
}
export interface TickLabelItem {
  id: string | number
  lines: readonly string[]
  position: TickLabelPosition
  dimensions: TickLabelDimensions
  rotation?: number
  anchor?: TickLabelAnchor
  stagger_row?: number
}
interface TickLabelGeometry extends Required<TickLabelItem> {
  item_idx: number
  side: TickLayoutSide
  aabb: TickAabb
}
interface TickGeometrySummary {
  labels: readonly TickLabelGeometry[]
  collisions: { colliding_indices: readonly number[]; count: number }
  edge_overflow_px: number
}

const normalized_rotation = (rotation: number): number => {
  const wrapped = ((rotation % 360) + 360) % 360
  return wrapped > 180 ? wrapped - 360 : wrapped
}

// Match SVG text-anchor conventions used by PlotAxis: horizontal unrotated labels center on
// their ticks; rotated labels trail inward; y/y2 labels point toward their axis spine.
export const default_tick_label_anchor = (
  side: TickLayoutSide,
  rotation: number,
): TickLabelAnchor => {
  if (side === `y`) return `end`
  if (side === `y2`) return `start`
  const normalized = normalized_rotation(rotation)
  if (normalized === 0) return `middle`
  return (side === `x2`) === normalized > 0 ? `end` : `start`
}

const anchor_x_bounds = (width: number, anchor: TickLabelAnchor): [number, number] =>
  anchor === `start` ? [0, width] : anchor === `end` ? [-width, 0] : [-width / 2, width / 2]

const block_y_bounds = (height: number, side: TickLayoutSide): [number, number] =>
  side === `x` ? [0, height] : side === `x2` ? [-height, 0] : [-height / 2, height / 2]

const snap_near_zero = (value: number): number =>
  Math.abs(value) <= TICK_GEOMETRY_EPSILON ? 0 : value

const block_width = ({ line_widths }: TickLabelDimensions): number => {
  let width = 0
  for (const line_width of line_widths) if (line_width > width) width = line_width
  return width
}

// Union of all text lines as one block, rotated around the label origin. Summing the per-axis
// extremes of each local edge is exact for the block AABB even when line widths differ.
// Hot path: every candidate layout builds one of these per label, so it stays allocation-free.
export const tick_label_aabb = ({
  position,
  side,
  anchor,
  rotation,
  dimensions,
}: {
  position: TickLabelPosition
  side: TickLayoutSide
  anchor: TickLabelAnchor
  rotation: number
  dimensions: TickLabelDimensions
}): TickAabb => {
  const block_height = dimensions.line_widths.length * dimensions.line_height
  const [local_min_x, local_max_x] = anchor_x_bounds(block_width(dimensions), anchor)
  const [local_min_y, local_max_y] = block_y_bounds(block_height, side)
  const radians = (normalized_rotation(rotation) * Math.PI) / 180
  const cosine = snap_near_zero(Math.cos(radians))
  const sine = snap_near_zero(Math.sin(radians))
  const horizontal = is_horizontal_side(side)
  const origin_x = horizontal ? position.axis : position.cross_axis
  const origin_y = horizontal ? position.cross_axis : position.axis
  const x_left = local_min_x * cosine
  const x_right = local_max_x * cosine
  const x_top = -(local_min_y * sine)
  const x_bottom = -(local_max_y * sine)
  const y_left = local_min_x * sine
  const y_right = local_max_x * sine
  const y_top = local_min_y * cosine
  const y_bottom = local_max_y * cosine
  const min_x = origin_x + Math.min(x_left, x_right) + Math.min(x_top, x_bottom)
  const max_x = origin_x + Math.max(x_left, x_right) + Math.max(x_top, x_bottom)
  const min_y = origin_y + Math.min(y_left, y_right) + Math.min(y_top, y_bottom)
  const max_y = origin_y + Math.max(y_left, y_right) + Math.max(y_top, y_bottom)
  return { min_x, min_y, max_x, max_y, width: max_x - min_x, height: max_y - min_y }
}

// Overflow past each end of the axis extent (in the extent's own direction, so reversed axes
// report start/end consistently), plus the total.
export const axis_edge_overflow = (
  aabb: TickAabb,
  side: TickLayoutSide,
  axis_extent: TickAxisExtent,
  edge_gap = 0,
): { start: number; end: number; total: number } => {
  const horizontal = is_horizontal_side(side)
  const interval_min = horizontal ? aabb.min_x : aabb.min_y
  const interval_max = horizontal ? aabb.max_x : aabb.max_y
  const forward = axis_extent.end >= axis_extent.start
  const start = forward
    ? Math.max(0, axis_extent.start + edge_gap - interval_min)
    : Math.max(0, interval_max - (axis_extent.start - edge_gap))
  const end = forward
    ? Math.max(0, interval_max - (axis_extent.end - edge_gap))
    : Math.max(0, axis_extent.end + edge_gap - interval_min)
  return { start, end, total: start + end }
}

// Least-overflowing anchor together with its box. Ties keep the default anchor, so an anchor
// that already fits wins outright and the common case costs one box instead of three.
const best_anchor = (
  side: TickLayoutSide,
  position: TickLabelPosition,
  rotation: number,
  dimensions: TickLabelDimensions,
  axis_extent: TickAxisExtent,
  edge_gap: number,
): { anchor: TickLabelAnchor; aabb: TickAabb } => {
  let anchor = default_tick_label_anchor(side, rotation)
  let aabb = tick_label_aabb({ position, side, anchor, rotation, dimensions })
  // An anchor can only trade overflow along the axis when the text runs along it: upright on
  // x/x2, rotated on y/y2. A rotated x label trails away from the plot only with its default
  // anchor (flipping it sends the text up through the bars); an upright y anchor points at
  // the spine and never changes the vertical extent.
  const rotated = normalized_rotation(rotation) !== 0
  if (is_horizontal_side(side) === rotated) return { anchor, aabb }
  let least_overflow = axis_edge_overflow(aabb, side, axis_extent, edge_gap).total
  if (least_overflow === 0) return { anchor, aabb }
  for (const candidate of ANCHORS) {
    if (candidate === anchor) continue
    const candidate_aabb = tick_label_aabb({
      position,
      side,
      anchor: candidate,
      rotation,
      dimensions,
    })
    const { total } = axis_edge_overflow(candidate_aabb, side, axis_extent, edge_gap)
    if (total < least_overflow)
      [anchor, aabb, least_overflow] = [candidate, candidate_aabb, total]
  }
  return { anchor, aabb }
}

const aabbs_collide = (first: TickAabb, second: TickAabb, gap: number): boolean =>
  !(first.max_x + gap <= second.min_x || second.max_x + gap <= first.min_x) &&
  !(first.max_y + gap <= second.min_y || second.max_y + gap <= first.min_y)

const intervals_collide = (
  first: readonly [number, number],
  second: readonly [number, number],
  second_offset: number,
  gap: number,
): boolean =>
  first[1] + gap > second[0] + second_offset && second[1] + second_offset + gap > first[0]

// Every label on an axis shares one rotation, so tilted labels sit on parallel baselines and
// their axis-aligned boxes overlap long before the text does. Compare oriented bounds after the
// AABB broad phase so labels separated along either text axis do not force extra rotation.
const labels_collide = (
  first: TickLabelGeometry,
  second: TickLabelGeometry,
  gap: number,
): boolean => {
  if (!aabbs_collide(first.aabb, second.aabb, gap)) return false
  const rotation = normalized_rotation(first.rotation)
  if (rotation === 0 || rotation !== normalized_rotation(second.rotation)) return true
  const radians = (rotation * Math.PI) / 180
  const horizontal = is_horizontal_side(first.side)
  const delta_along = second.position.axis - first.position.axis
  const delta_cross = second.position.cross_axis - first.position.cross_axis
  const delta_x = horizontal ? delta_along : delta_cross
  const delta_y = horizontal ? delta_cross : delta_along
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const offset_x = delta_x * cosine + delta_y * sine
  const offset_y = -delta_x * sine + delta_y * cosine
  const local_bounds = (label: TickLabelGeometry) =>
    [
      anchor_x_bounds(block_width(label.dimensions), label.anchor),
      block_y_bounds(label.lines.length * label.dimensions.line_height, label.side),
    ] as const
  const [first_x, first_y] = local_bounds(first)
  const [second_x, second_y] = local_bounds(second)
  return (
    intervals_collide(first_x, second_x, offset_x, gap) &&
    intervals_collide(first_y, second_y, offset_y, gap)
  )
}

// Sweep along x: each label is only tested against the active set whose boxes reach it.
const detect_collisions = (
  labels: readonly TickLabelGeometry[],
  gap: number,
): TickGeometrySummary[`collisions`] => {
  const spatially_sorted = labels.toSorted(
    (first, second) =>
      first.aabb.min_x - second.aabb.min_x ||
      first.aabb.max_x - second.aabb.max_x ||
      first.item_idx - second.item_idx,
  )
  const active: TickLabelGeometry[] = []
  const is_colliding = Array<boolean>(labels.length).fill(false)
  let count = 0
  for (const current of spatially_sorted) {
    for (let active_idx = active.length - 1; active_idx >= 0; active_idx--) {
      if (active[active_idx].aabb.max_x + gap <= current.aabb.min_x)
        active.splice(active_idx, 1)
    }
    for (const candidate of active) {
      if (!labels_collide(candidate, current, gap)) continue
      is_colliding[candidate.item_idx] = true
      is_colliding[current.item_idx] = true
      count += 1
    }
    active.push(current)
  }
  const colliding_indices = is_colliding.flatMap((collides, idx) => (collides ? [idx] : []))
  return { colliding_indices, count }
}

// Resolve each label's anchor and box, then count pairwise collisions and edge overflow.
export const analyze_tick_label_geometry = ({
  items,
  side,
  axis_extent,
  gap = 0,
  edge_gap = 0,
}: {
  items: readonly TickLabelItem[]
  side: TickLayoutSide
  axis_extent: TickAxisExtent
  gap?: number
  edge_gap?: number
}): TickGeometrySummary => {
  let edge_overflow_px = 0
  const labels = items.map((item, item_idx): TickLabelGeometry => {
    const rotation = item.rotation ?? 0
    const { anchor, aabb } = item.anchor
      ? {
          anchor: item.anchor,
          aabb: tick_label_aabb({ ...item, side, anchor: item.anchor, rotation }),
        }
      : best_anchor(side, item.position, rotation, item.dimensions, axis_extent, edge_gap)
    edge_overflow_px += axis_edge_overflow(aabb, side, axis_extent, edge_gap).total
    return {
      ...item,
      item_idx,
      side,
      anchor,
      rotation,
      stagger_row: item.stagger_row ?? 0,
      aabb,
    }
  })
  return { labels, collisions: detect_collisions(labels, gap), edge_overflow_px }
}

// === Tick density ===

// Conservative first-pass tick count from the widest measured label: room for gap_pixels
// between labels, both endpoints reserved whenever they exist.
export const suggest_tick_count = (
  axis_pixels: number,
  label_widths: readonly number[],
  gap_pixels: number,
): number => {
  const label_count = label_widths.length
  if (label_count <= 1) return label_count
  const widest_label = Math.max(0, ...label_widths)
  const largest = Math.max(axis_pixels, widest_label, gap_pixels)
  if (largest === 0) return label_count
  // Normalize before adding so valid but very large measurements cannot overflow to Infinity.
  const available = axis_pixels / largest + gap_pixels / largest
  const slot = widest_label / largest + gap_pixels / largest
  return clamp(Math.floor(available / slot), 2, label_count)
}

// Evenly spaced source indices retaining both endpoints.
export const thin_tick_indices = (item_count: number, requested_count: number): number[] => {
  const target_count = clamp(requested_count, 2, item_count)
  if (target_count >= item_count) return Array.from({ length: item_count }, (_, idx) => idx)
  return Array.from({ length: target_count }, (_, idx) =>
    Math.round((idx * (item_count - 1)) / (target_count - 1)),
  )
}

// Interior representatives (bin centers) instead of endpoints, deduplicated.
const adaptive_thin_indices = (item_count: number, requested_count: number): number[] =>
  Array.from({ length: requested_count }, (_, visible_idx) =>
    Math.min(item_count - 1, Math.floor(((visible_idx + 0.5) * item_count) / requested_count)),
  ).filter((tick_idx, selected_idx, selected) => tick_idx !== selected[selected_idx - 1])

// === Candidates ===

// Every candidate retains the original text independently from its visual lines, so renderers
// can use full_text for aria-label/title even when the visible label is shortened or hidden.
interface CandidateLabel {
  tick_index: number
  full_text: string
  display_lines: readonly string[]
  visible: boolean
  stagger_row: 0 | 1
  // Fraction of semantic content removed from this label (ellipsis), in [0, 1]
  information_loss: number
}

interface Candidate {
  id: string
  strategy: TickStrategy
  rotation_deg: number
  labels: readonly CandidateLabel[]
}

type LabelInput = { full_text: string; display_lines?: readonly string[]; visible?: boolean }

const create_candidate = (
  id: string,
  strategy: TickStrategy,
  labels: readonly LabelInput[],
  rotation_deg = 0,
): Candidate => ({
  id,
  strategy,
  rotation_deg,
  labels: labels.map((label, tick_index) => ({
    tick_index,
    full_text: label.full_text,
    display_lines: label.display_lines ?? [label.full_text],
    visible: label.visible ?? true,
    stagger_row: 0,
    information_loss: 0,
  })),
})

const with_labels = (
  candidate: Candidate,
  id: string,
  strategy: TickStrategy,
  labels: readonly CandidateLabel[],
): Candidate => ({ id, strategy, rotation_deg: candidate.rotation_deg, labels })

// Alternate visible labels between two rows without moving their tick slots
const stagger_candidate = (candidate: Candidate, id: string): Candidate => {
  let visible_order = 0
  return with_labels(
    candidate,
    id,
    `stagger`,
    candidate.labels.map((label) => ({
      ...label,
      stagger_row: label.visible && visible_order++ % 2 === 1 ? 1 : 0,
    })),
  )
}

const thinned_candidate = (
  candidate: Candidate,
  visible_indices: ReadonlySet<number>,
  id: string,
): Candidate =>
  with_labels(
    candidate,
    id,
    `thin`,
    candidate.labels.map((label) => ({
      ...label,
      visible: label.visible && visible_indices.has(label.tick_index),
    })),
  )

const MIN_RETAINED_INFORMATION_FRACTION = 0.25
const information_count = (text: string): number =>
  graphemes(text).filter((character) => /[\p{L}\p{N}]/u.test(character)).length

// Longest grapheme prefix that fits with an ellipsis, unless too little information survives
const ellipsize_line = (
  text: string,
  max_width_px: number,
  measure_text: (text: string) => number,
): string => {
  if (measure_text(text) <= max_width_px || measure_text(`…`) > max_width_px) return text
  let longest_fitting = ``
  let prefix = ``
  for (const character of graphemes(text)) {
    prefix += character
    const trimmed = prefix.replace(/[ \t]+$/u, ``)
    if (measure_text(`${trimmed}…`) <= max_width_px) longest_fitting = trimmed
  }
  const source_information = information_count(text)
  return source_information > 0 &&
    information_count(longest_fitting) / source_information >=
      MIN_RETAINED_INFORMATION_FRACTION
    ? `${longest_fitting}…`
    : text
}

const ellipsis_candidate = (
  candidate: Candidate,
  id: string,
  max_width_px: number | readonly number[],
  measure_text: (text: string) => number,
): Candidate =>
  with_labels(
    candidate,
    id,
    `ellipsis`,
    candidate.labels.map((label) => {
      const label_max_width =
        typeof max_width_px === `number` ? max_width_px : max_width_px[label.tick_index]
      const display_lines = label.display_lines.map((line) =>
        ellipsize_line(line, label_max_width, measure_text),
      )
      const before_text = label.display_lines.join(`\n`)
      const after_text = display_lines.join(`\n`)
      const before = information_count(before_text)
      const after = Math.min(before, information_count(after_text))
      const loss = after_text === before_text ? 0 : before === 0 ? 1 : 1 - after / before
      return { ...label, display_lines, information_loss: loss }
    }),
  )

// === Candidate measurement and scoring ===

interface MeasuredCandidate {
  candidate: Candidate
  labels: readonly TickLabelGeometry[]
  colliding_label_count: number
  band: number
  stagger_step: number
  // Colliding label pairs plus endpoint / minimum-count policy violations
  collisions: number
  // Pixels beyond the axis extent plus any band overflow past max_band
  edge_overflow_px: number
  // Outward label band divided by the available band
  band_fraction: number
}

// How far labels reach away from their baseline: x/x2 measure vertically, y/y2 horizontally,
// and x2/y grow toward negative coordinates so their band is the negated minimum.
const BAND_AABB_KEY = { x: `max_y`, x2: `min_y`, y: `min_x`, y2: `max_x` } as const

const outward_band = (labels: readonly TickLabelGeometry[], side: TickLayoutSide): number => {
  const sign = side === `x2` || side === `y` ? -1 : 1
  let band = 0
  for (const { aabb } of labels) {
    const reach = sign * aabb[BAND_AABB_KEY[side]]
    if (reach > band) band = reach
  }
  return band
}

interface MeasureConfig {
  side: TickLayoutSide
  positions: readonly number[]
  axis_extent: TickAxisExtent
  font: Readonly<FontSpec>
  edge_gap: number
  max_band?: number
  min_visible_ticks: number
  preserve_endpoints: boolean
  renderable_indices: readonly number[]
}

const measure_candidate = (candidate: Candidate, config: MeasureConfig): MeasuredCandidate => {
  const { side, positions, axis_extent, font, edge_gap, max_band } = config
  const visible_labels = candidate.labels.filter(({ visible }) => visible)
  const items = (cross_axis_of: (label: CandidateLabel) => number): TickLabelItem[] =>
    visible_labels.map((label) => ({
      id: label.tick_index,
      lines: label.display_lines,
      position: { axis: positions[label.tick_index], cross_axis: cross_axis_of(label) },
      rotation: candidate.rotation_deg,
      stagger_row: label.stagger_row,
      dimensions: {
        line_widths: label.display_lines.map((line) => measure_text_width(line, font)),
        line_height: font.line_height,
      },
    }))
  const analyze = (cross_axis_of: (label: CandidateLabel) => number) =>
    analyze_tick_label_geometry({
      items: items(cross_axis_of),
      side,
      axis_extent,
      gap: TICK_LABEL_GAP,
      edge_gap,
    })
  const baseline = analyze(() => 0)
  const stagger_step = outward_band(baseline.labels, side) + TICK_STAGGER_GAP
  const outward_direction = side === `x` || side === `y2` ? 1 : -1
  // Only the stagger candidate moves labels off the baseline row
  const geometry = visible_labels.some(({ stagger_row }) => stagger_row !== 0)
    ? analyze((label) => outward_direction * label.stagger_row * stagger_step)
    : baseline
  const band = outward_band(geometry.labels, side)
  const first_idx = config.renderable_indices[0]
  const last_idx = config.renderable_indices.at(-1)
  const endpoint_violation =
    config.preserve_endpoints &&
    first_idx != null &&
    last_idx != null &&
    (!candidate.labels[first_idx].visible || !candidate.labels[last_idx].visible)
  const band_overflow = max_band == null ? 0 : Math.max(0, band - max_band)
  return {
    candidate,
    labels: geometry.labels,
    stagger_step,
    colliding_label_count: geometry.collisions.colliding_indices.length,
    band,
    collisions:
      geometry.collisions.count +
      Number(endpoint_violation) +
      Number(visible_labels.length < config.min_visible_ticks),
    edge_overflow_px: geometry.edge_overflow_px + band_overflow,
    band_fraction: band / Math.max(1, max_band ?? DEFAULT_AUTO_LABEL_BAND),
  }
}

// Lower is better. Hidden labels cost most, then lost text, band use, rotation, extra lines and
// staggering. A finite score keeps text readable when every candidate violates a constraint.
const score_candidate = ({ candidate, band_fraction }: MeasuredCandidate): number => {
  const visible_labels = candidate.labels.filter(({ visible }) => visible)
  const max_line_count = Math.max(
    1,
    ...visible_labels.map(({ display_lines }) => display_lines.length),
  )
  return (
    (candidate.labels.length - visible_labels.length) * 100 +
    visible_labels.reduce((total, { information_loss }) => total + information_loss, 0) * 80 +
    band_fraction * 12 +
    (Math.abs(candidate.rotation_deg) / 90) * 5 +
    (max_line_count - 1) * 4 +
    Number(visible_labels.some(({ stagger_row }) => stagger_row === 1)) * 6
  )
}

// Feasible candidates win; among infeasible ones fewer collisions, then less overflow. Ties go
// to the lower score, then the strategy order, then the smaller rotation, then input order.
const select_candidate = (
  measured_candidates: readonly MeasuredCandidate[],
): MeasuredCandidate => {
  const scored = measured_candidates.map((measured) => ({
    measured,
    feasible: measured.collisions === 0 && measured.edge_overflow_px <= TICK_GEOMETRY_EPSILON,
    score: score_candidate(measured),
  }))
  return scored.toSorted((left, right) => {
    const fallback_order = left.feasible
      ? 0
      : left.measured.collisions - right.measured.collisions ||
        left.measured.edge_overflow_px - right.measured.edge_overflow_px
    return (
      Number(right.feasible) - Number(left.feasible) ||
      fallback_order ||
      left.score - right.score ||
      STRATEGY_TIE_ORDER.indexOf(left.measured.candidate.strategy) -
        STRATEGY_TIE_ORDER.indexOf(right.measured.candidate.strategy) ||
      Math.abs(left.measured.candidate.rotation_deg) -
        Math.abs(right.measured.candidate.rotation_deg)
    )
  })[0].measured
}

// === Label wrapping ===

// Split on semantic boundaries without changing the displayed text. Whitespace, separators,
// and lower-to-upper camel-case transitions are useful wrap points; ordinary words stay intact.
// Camel case splits after two lowercase letters, or after one when the capital itself starts a
// word (`xAxis`). A bare one-letter rule would tear unit strings apart, since the `V` of `10 eV`
// looks exactly like the `A` of `xAxis` until you check whether lowercase follows it.
const TICK_WRAP_BOUNDARY =
  /(?<=[\p{L}\p{N}][_‐–—-])(?=[\p{L}\p{N}])|(?<=[^_‐–—-] )|(?<=[a-z]{2})(?=[A-Z])|(?<=[a-z])(?=[A-Z][a-z])/u

const explicit_tick_lines = (text: string): string[] =>
  text.replaceAll(/^(?:\r?\n)+|(?:\r?\n)+$/g, ``).split(/\r?\n/)

type WrapChoice = { lines: string[]; max_width: number; balance: number }

// Wrap at semantic boundaries into the fewest lines that fit max_width. If no partition fits,
// return the narrowest partition within max_lines so the caller can compare it to rotation.
const wrap_tick_label = (
  text: string,
  max_width: number,
  max_lines: number,
  font: Readonly<FontSpec>,
): string[] => {
  const explicit_lines = explicit_tick_lines(text)
  if (explicit_lines.length > 1) return explicit_lines
  const normalized = text.trim().replaceAll(/[^\S\u00A0\u202F]+/gu, ` `)
  if (measure_text_width(normalized, font) <= max_width) return [normalized]
  const segments = normalized.split(TICK_WRAP_BOUNDARY)
  const line_limit = Math.min(max_lines, segments.length)
  if (line_limit < 2) return [normalized]
  // metrics[start][end] is the line made of segments[start, end) and its width
  const metrics = segments.map((_segment, start_idx) =>
    Array.from({ length: segments.length + 1 }, (_, end_idx) => {
      const line =
        end_idx > start_idx ? segments.slice(start_idx, end_idx).join(``).trim() : ``
      return { line, width: line ? measure_text_width(line, font) : 0 }
    }),
  )
  let previous_choices: (WrapChoice | null)[] = metrics[0].map(({ line, width }, end_idx) =>
    end_idx === 0 ? null : { lines: [line], max_width: width, balance: width ** 2 },
  )
  let narrowest = [normalized]
  for (let line_count = 2; line_count <= line_limit; line_count++) {
    const choices = Array<WrapChoice | null>(segments.length + 1).fill(null)
    for (let end_idx = line_count; end_idx <= segments.length; end_idx++) {
      for (let start_idx = line_count - 1; start_idx < end_idx; start_idx++) {
        const previous = previous_choices[start_idx]
        if (!previous) continue
        const { line, width } = metrics[start_idx][end_idx]
        const candidate = {
          lines: [...previous.lines, line],
          max_width: Math.max(previous.max_width, width),
          balance: previous.balance + width ** 2,
        }
        const current = choices[end_idx]
        if (
          !current ||
          candidate.max_width < current.max_width ||
          (candidate.max_width === current.max_width && candidate.balance < current.balance)
        ) {
          choices[end_idx] = candidate
        }
      }
    }
    const choice = choices[segments.length]
    if (choice) {
      narrowest = choice.lines
      if (choice.max_width <= max_width) return choice.lines
    }
    previous_choices = choices
  }
  return narrowest
}

// === Layout ===

// An axis plus the labels it will actually draw, so layout can measure them. Categorical
// axes pass their category names here, not the numeric indices behind them.
export type MeasuredAxis = AxisConfig & {
  tick_values?: (string | number)[]
  // Rendered pixel coordinates in tick_values order. Required: layout is decided from real
  // geometry, so a caller without a scale must project one rather than get an equal-slot guess.
  tick_positions: number[]
  axis_extent?: TickAxisExtent
  tick_font?: Readonly<FontSpec>
}

// Build the measured form of an axis for `calc_auto_padding`. Generic over the tick type so
// band axes (string categories) and continuous axes (numbers) both infer their own scale.
export const measured_axis = <Tick extends string | number>(
  axis: AxisConfig,
  tick_values: Tick[],
  scale: (tick: Tick) => number,
  axis_extent: TickAxisExtent,
  tick_font?: Readonly<FontSpec>,
): MeasuredAxis => ({
  ...axis,
  tick_values,
  tick_positions: tick_values.map(scale),
  axis_extent,
  tick_font,
})

interface ResolvedTickLabel {
  tick_index: number
  full_text: string
  lines: readonly string[]
  visible: boolean
  anchor: TickLabelAnchor
  rotation: number
  stagger_row: 0 | 1
}

interface ResolvedTickLayout {
  rotation: number
  band: number
  labels: ResolvedTickLabel[]
  visible_tick_indices: number[]
  strategy: TickStrategy
  stagger_step: number
}

const finite_nonnegative = (value: number, name: string): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number, got ${value}`)
  }
  return value
}

const positive_integer = (value: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer, got ${value}`)
  }
  return value
}

const resolved_strategies = (config: TickAutoLayoutConfig): readonly TickStrategy[] => {
  const strategies = config.strategies ?? DEFAULT_STRATEGY_ORDER
  if (strategies.length === 0) throw new Error(`tick auto_layout.strategies must not be empty`)
  for (const strategy of strategies) {
    if (!TICK_STRATEGIES.includes(strategy)) {
      throw new Error(`Unknown tick auto_layout strategy "${strategy}"`)
    }
  }
  return strategies
}

// Inside labels render on the opposite side of the axis line
const OPPOSITE_SIDE: Record<TickLayoutSide, TickLayoutSide> = {
  x: `x2`,
  x2: `x`,
  y: `y2`,
  y2: `y`,
}
const effective_side = (side: TickLayoutSide, inside: boolean): TickLayoutSide =>
  inside ? OPPOSITE_SIDE[side] : side

const resolve_axis_extent = (
  axis: MeasuredAxis,
  axis_size: number,
  positions: readonly number[],
): TickAxisExtent => {
  if (axis.axis_extent) return axis.axis_extent
  const finite = positions.filter(Number.isFinite)
  return { start: array_min([0, ...finite]), end: array_max([axis_size, ...finite]) }
}

// Width available to each label: half the distance to each spatial neighbour, minus the gap
const local_axis_widths = (positions: readonly number[], extent: TickAxisExtent): number[] => {
  const extent_min = Math.min(extent.start, extent.end)
  const extent_max = Math.max(extent.start, extent.end)
  const spatial_order = positions
    .map((position, tick_idx) => ({ position, tick_idx }))
    .filter(({ position }) => Number.isFinite(position))
    .toSorted(
      (left, right) => left.position - right.position || left.tick_idx - right.tick_idx,
    )
  const widths = Array<number>(positions.length).fill(0)
  for (const [spatial_idx, { position, tick_idx }] of spatial_order.entries()) {
    const previous = spatial_order[spatial_idx - 1]?.position
    const next = spatial_order[spatial_idx + 1]?.position
    const slot_start = previous == null ? extent_min : (previous + position) / 2
    const slot_end = next == null ? extent_max : (position + next) / 2
    widths[tick_idx] = Math.max(0, slot_end - slot_start - TICK_LABEL_GAP)
  }
  return widths
}

const rotation_angles = (max_angle: number): number[] => {
  if (max_angle === 0) return []
  const angles: number[] = TICK_ROTATION_LADDER.filter((angle) => angle <= max_angle)
  if (!angles.includes(max_angle)) angles.push(max_angle)
  return angles
}

// Plain upright labels, every one visible. Used when there is no geometry worth scoring.
const upright_layout = (
  axis: MeasuredAxis,
  side: TickLayoutSide,
  full_texts: readonly string[],
): ResolvedTickLayout => {
  const font = axis.tick_font ?? DEFAULT_FONT_SPEC
  const anchor = default_tick_label_anchor(
    effective_side(side, axis.tick_label?.inside ?? false),
    0,
  )
  const lines = full_texts.map(explicit_tick_lines)
  // Band is the reach away from the axis: line stack for x/x2, text width for y/y2.
  let band = 0
  for (const label_lines of lines) {
    if (is_horizontal_side(side)) band = Math.max(band, label_lines.length * font.line_height)
    else for (const line of label_lines) band = Math.max(band, measure_text_width(line, font))
  }
  return {
    rotation: 0,
    band,
    labels: full_texts.map((full_text, tick_index) => ({
      tick_index,
      full_text,
      lines: lines[tick_index],
      visible: true,
      stagger_row: 0,
      anchor,
      rotation: 0,
    })),
    visible_tick_indices: full_texts.map((_, tick_index) => tick_index),
    strategy: `upright`,
    stagger_step: 0,
  }
}

const finalize_layout = (
  winner: MeasuredCandidate,
  side: TickLayoutSide,
): ResolvedTickLayout => {
  const anchor_by_idx = new Map(winner.labels.map((label) => [label.id, label.anchor]))
  const labels = winner.candidate.labels.map((label): ResolvedTickLabel => ({
    tick_index: label.tick_index,
    full_text: label.full_text,
    lines: label.display_lines,
    visible: label.visible,
    stagger_row: label.stagger_row,
    anchor: anchor_by_idx.get(label.tick_index) ?? default_tick_label_anchor(side, 0),
    rotation: winner.candidate.rotation_deg,
  }))
  return {
    rotation: winner.candidate.rotation_deg,
    band: winner.band,
    labels,
    visible_tick_indices: labels
      .filter(({ visible }) => visible)
      .map(({ tick_index }) => tick_index),
    strategy: winner.candidate.strategy,
    stagger_step: winner.stagger_step,
  }
}

const compute_tick_layout = (
  axis: MeasuredAxis,
  axis_size: number,
  side: TickLayoutSide,
  full_texts: string[],
): ResolvedTickLayout => {
  const ticks = axis.tick_values ?? []
  if (axis.tick_positions.length !== ticks.length) {
    throw new Error(
      `tick_positions has ${axis.tick_positions.length} entries for ${ticks.length} ticks`,
    )
  }
  const label_config = axis.tick_label
  const configured = label_config?.rotation ?? `auto`
  const auto_layout = label_config?.auto_layout ?? {}
  const strategies = configured === `auto` ? resolved_strategies(auto_layout) : []
  if (full_texts.length === 0) return upright_layout(axis, side, full_texts)
  // No axis and no spread between ticks means there is no arrangement to improve: every label
  // projects to one point, and the scorer would "fix" that pile-up by rotating labels nobody
  // can see. Real positions still get scored even when the caller omitted a plot size.
  if (configured === `auto` && !(axis_size > 0)) {
    const span = Math.max(...axis.tick_positions) - Math.min(...axis.tick_positions)
    if (!(span > 0)) return upright_layout(axis, side, full_texts)
  }
  const is_horizontal = is_horizontal_side(side)
  const inside = label_config?.inside ?? false
  const font = axis.tick_font ?? DEFAULT_FONT_SPEC
  const shift = (is_horizontal ? label_config?.shift?.x : label_config?.shift?.y) ?? 0
  const positions = axis.tick_positions.map((position) => position + shift)
  const renderable_indices = positions.flatMap((position, idx) =>
    Number.isFinite(position) ? [idx] : [],
  )
  const axis_extent = resolve_axis_extent(axis, axis_size, positions)
  const explicit_labels = full_texts.map((full_text, tick_idx) => ({
    full_text,
    visible: Number.isFinite(positions[tick_idx]),
    display_lines: explicit_tick_lines(full_text),
  }))
  const base_config: MeasureConfig = {
    side: effective_side(side, inside),
    positions,
    axis_extent,
    font,
    edge_gap: 0,
    min_visible_ticks: Math.min(1, renderable_indices.length),
    preserve_endpoints: false,
    renderable_indices,
  }
  if (configured !== `auto`) {
    const explicit = create_candidate(
      `explicit`,
      configured === 0 ? `upright` : `rotate`,
      explicit_labels,
      configured,
    )
    return finalize_layout(measure_candidate(explicit, base_config), side)
  }

  const max_angle = finite_nonnegative(auto_layout.max_angle ?? 90, `auto_layout.max_angle`)
  if (max_angle > 90)
    throw new Error(`auto_layout.max_angle must not exceed 90, got ${max_angle}`)
  const max_band =
    auto_layout.max_band == null
      ? undefined
      : finite_nonnegative(auto_layout.max_band, `auto_layout.max_band`)
  const min_visible_ticks = Math.min(
    renderable_indices.length,
    positive_integer(
      auto_layout.min_visible_ticks ?? Math.min(2, ticks.length),
      `auto_layout.min_visible_ticks`,
    ),
  )
  const config: MeasureConfig = {
    ...base_config,
    edge_gap: finite_nonnegative(auto_layout.edge_gap ?? 0, `auto_layout.edge_gap`),
    max_band,
    min_visible_ticks,
    preserve_endpoints: (auto_layout.endpoint_policy ?? `preserve`) === `preserve`,
  }
  const candidates: Candidate[] = []
  // Density estimation and the final scoring pass both want the upright geometry; measuring
  // it is the single most expensive step here, so whichever needs it first pays for both.
  let upright_geometry: MeasuredCandidate | undefined
  const upright = create_candidate(`upright`, `upright`, explicit_labels)
  if (strategies.includes(`upright`)) candidates.push(upright)

  const slot_widths = local_axis_widths(positions, axis_extent)
  const max_lines = positive_integer(
    Math.max(1, Math.floor(label_config?.max_lines ?? DEFAULT_TICK_LABEL_MAX_LINES)),
    `tick_label.max_lines`,
  )
  let wrapped: Candidate | undefined
  if (strategies.includes(`wrap`) && max_lines > 1) {
    // The band cap is the wrap target for every label on the side. Folding the measured label
    // widths into this Math.min made the NARROWEST label the target for all of them, so one
    // short tick over-wrapped every long one next to it.
    const vertical_wrap_width = max_band ?? DEFAULT_AUTO_LABEL_BAND
    wrapped = create_candidate(
      `wrap`,
      `wrap`,
      explicit_labels.map((label, tick_idx) => ({
        ...label,
        display_lines: wrap_tick_label(
          label.full_text,
          is_horizontal ? slot_widths[tick_idx] : vertical_wrap_width,
          max_lines,
          font,
        ),
      })),
    )
    candidates.push(wrapped)
  }
  // Vertical sides stagger only under an explicit band cap: a second column of y labels grows
  // outward into room the padding pass never reserved (it measured upright labels against the
  // plot height before outside decorations shrank it), so it spills past the frame edge.
  if (
    strategies.includes(`stagger`) &&
    renderable_indices.length > 1 &&
    (is_horizontal || max_band != null)
  ) {
    upright_geometry ??= measure_candidate(upright, config)
    if (upright_geometry.colliding_label_count > 0) {
      candidates.push(stagger_candidate(upright, `stagger`))
    }
  }
  // Horizontal only: rotating a y label trades width for vertical extent, which the scorer
  // reads as fewer collisions, so short numeric ticks came out sideways. Vertical crowding is
  // a job for thin/wrap. Wrapped blocks can also tilt as a unit.
  const rotation_sign = (side === `x2` || side === `y2`) !== inside ? 1 : -1
  const rotated: Candidate[] =
    strategies.includes(`rotate`) && is_horizontal && renderable_indices.length > 1
      ? rotation_angles(max_angle).flatMap((angle) =>
          [upright, ...(wrapped ? [wrapped] : [])].map((source) =>
            create_candidate(
              `${source === upright ? `rotate` : `wrap-rotate`}-${angle}`,
              source === upright ? `rotate` : `wrap`,
              source.labels,
              rotation_sign * angle,
            ),
          ),
        )
      : []
  candidates.push(...rotated)
  if (strategies.includes(`ellipsis`)) {
    candidates.push(
      ellipsis_candidate(
        upright,
        `ellipsis`,
        is_horizontal ? slot_widths : (max_band ?? DEFAULT_AUTO_LABEL_BAND),
        (text) => measure_text_width(text, font),
      ),
    )
  }

  // One bounded density pass: estimate a target once from measured labels, then score that
  // stable subset with the other candidates. No reactive feedback from selected labels occurs.
  if (strategies.includes(`thin`) && renderable_indices.length > min_visible_ticks) {
    upright_geometry ??= measure_candidate(upright, config)
    const label_sizes = renderable_indices.map((tick_idx) => {
      const { display_lines } = upright.labels[tick_idx]
      return is_horizontal
        ? Math.max(...display_lines.map((line) => measure_text_width(line, font)))
        : display_lines.length * font.line_height
    })
    const extent_size = Math.abs(axis_extent.end - axis_extent.start)
    const density_count = suggest_tick_count(extent_size, label_sizes, TICK_LABEL_GAP)
    // Labels outside every collision can remain. When every label collides, that count is zero,
    // so fall back to the independent density estimate instead of collapsing to the minimum.
    const non_colliding_count =
      renderable_indices.length - upright_geometry.colliding_label_count
    const requested_count = Math.max(
      min_visible_ticks,
      Math.min(
        renderable_indices.length,
        density_count,
        non_colliding_count > 0 ? non_colliding_count : density_count,
      ),
    )
    const selected = (
      auto_layout.endpoint_policy === `adaptive` ? adaptive_thin_indices : thin_tick_indices
    )(renderable_indices.length, requested_count)
    const selected_indices = new Set(selected.map((idx) => renderable_indices[idx]))
    // Compose thinning only with fixed rotations, avoiding arbitrary strategy combinations.
    candidates.push(
      ...[upright, ...rotated].map((source) =>
        thinned_candidate(
          source,
          selected_indices,
          source === upright ? `thin` : `thin-${source.id}`,
        ),
      ),
    )
  }

  if (candidates.length === 0) candidates.push(upright)
  const measured = candidates.map((candidate) =>
    candidate === upright && upright_geometry
      ? upright_geometry
      : measure_candidate(candidate, config),
  )
  return finalize_layout(select_candidate(measured), side)
}

// === Memoisation ===

const MAX_CACHED_LAYOUTS_PER_SIDE = 4
type CacheEntry = {
  key: string
  full_texts: readonly string[]
  tick_positions: readonly number[]
  value: ResolvedTickLayout
}
// Small per-side LRU so interleaved plots do not evict one another's padding/render lookup,
// while still bounding geometry retained across resizes and zooms.
const cached_layouts: Partial<Record<TickLayoutSide, CacheEntry[]>> = {}

const arrays_equal = (
  left: readonly (number | string)[],
  right: readonly (number | string)[],
): boolean =>
  left.length === right.length && left.every((value, idx) => Object.is(value, right[idx]))

// calc_auto_padding and PlotAxis call this same resolver. Memo keys include every geometric and
// strategy input plus the text-metrics revision, so a resize, font change or web-font load
// (clear_text_metrics_cache) cannot reuse a stale label decision.
export const resolve_tick_layout = (
  axis: MeasuredAxis,
  axis_size: number,
  side: TickLayoutSide,
): ResolvedTickLayout => {
  finite_nonnegative(axis_size, `axis_size`)
  const full_texts = tick_texts(axis.tick_values ?? [], axis.format, axis.ticks)
  const label = axis.tick_label
  const auto_layout = label?.auto_layout
  const font = axis.tick_font ?? DEFAULT_FONT_SPEC
  const key = [
    get_text_metrics_revision(),
    axis_size,
    label?.rotation ?? ``,
    label?.max_lines ?? ``,
    label?.inside ?? ``,
    label?.shift?.x ?? ``,
    label?.shift?.y ?? ``,
    auto_layout?.strategies?.join(`,`) ?? ``,
    auto_layout?.max_angle ?? ``,
    auto_layout?.max_band ?? ``,
    auto_layout?.min_visible_ticks ?? ``,
    auto_layout?.edge_gap ?? ``,
    auto_layout?.endpoint_policy ?? ``,
    axis.axis_extent ? `${axis.axis_extent.start},${axis.axis_extent.end}` : ``,
    `${font.font_family},${font.font_size},${font.font_style},${font.font_variant},${font.font_weight},${font.font_stretch},${font.line_height}`,
  ].join(`|`)
  const side_cache = cached_layouts[side] ?? []
  const cached_idx = side_cache.findIndex(
    (entry) =>
      entry.key === key &&
      arrays_equal(entry.full_texts, full_texts) &&
      arrays_equal(entry.tick_positions, axis.tick_positions),
  )
  if (cached_idx !== -1) {
    const [cached] = side_cache.splice(cached_idx, 1)
    side_cache.unshift(cached)
    return cached.value
  }
  const resolved = compute_tick_layout(axis, axis_size, side, full_texts)
  side_cache.unshift({
    key,
    full_texts,
    tick_positions: [...axis.tick_positions],
    value: resolved,
  })
  cached_layouts[side] = side_cache.slice(0, MAX_CACHED_LAYOUTS_PER_SIDE)
  return resolved
}
