import { array_extent, array_max, type Point2D } from '$lib/math'
import type { FacetAxis } from '$lib/plot/core/facets'
import type { PlotScaleFn } from '$lib/plot/core/scales'
import type { FontSpec } from '$lib/plot/core/text-metrics'
import {
  DEFAULT_FONT_SPEC,
  measure_text_line,
  resolve_font_size_css,
} from '$lib/plot/core/text-metrics'
import type {
  DataSeries,
  LabelPlacementConfig,
  LabelPlacementWeights,
} from '$lib/plot/core/types'

// Anneal budget and start temperature for a re-solve that inherits the previous layout. Far
// below the cold defaults (2000, 1): the layout is good, so the pass only nudges what moved.
const WARM_SA_ITERATIONS = 12
const WARM_START_TEMP = 0.05

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

interface PlotBounds {
  min_x: number
  min_y: number
  max_x: number
  max_y: number
}

// Both appear in compute_delta_energy's signature, so callers (and its tests) need them.
export interface AnchorInfo {
  x: number
  y: number
  radius: number
}

export interface LabelState extends Rect {
  anchor_idx: number
}

// Collected data for a single label before SA begins
interface LabelInfo {
  id: string
  anchor: AnchorInfo
  width: number
  height: number
  candidates: Point2D[]
}

export interface LabelSize {
  width: number
  height: number
}

interface LeaderLineSegment {
  x1: number
  y1: number
  x2: number
  y2: number
}

interface LeaderLineOptions {
  point: Point2D
  point_radius: number
  label_center: Point2D
  label_size: LabelSize
  min_length?: number
  label_padding?: number
}

const DEFAULT_WEIGHTS: Required<LabelPlacementWeights> = {
  overlap: 30,
  marker: 100,
  leader_cross: 10,
  leader_text: 8,
  distance: 0.5,
  bounds: 100,
}
const NEIGHBOR_CELL_OFFSETS = [-1, 0, 1] as const

const copy_state = (target: LabelState, source: LabelState) => {
  target.x = source.x
  target.y = source.y
  target.w = source.w
  target.h = source.h
  target.anchor_idx = source.anchor_idx
}

// Measures each line with the shared canvas-backed text metrics (deterministic 0.6 em per
// code point when no canvas is available). The +10 px breathing room and 1.2 line height are
// layout constants the candidate geometry was tuned against.
export function estimate_label_size(text: string, font_size_str?: string): LabelSize {
  const font_size = resolve_font_size_css(font_size_str)
  const font: FontSpec = { ...DEFAULT_FONT_SPEC, font_size, line_height: font_size * 1.2 }
  const label_lines = text.split(/\r?\n/)
  const max_line_width = array_max(
    label_lines.map((line) => measure_text_line(line, font).width),
  )
  return { width: max_line_width + 10, height: label_lines.length * font.line_height }
}

// === Geometry helpers ===

export function rect_overlap_area(rect_a: Rect, rect_b: Rect): number {
  const ox = Math.max(
    0,
    Math.min(rect_a.x + rect_a.w, rect_b.x + rect_b.w) - Math.max(rect_a.x, rect_b.x),
  )
  const oy = Math.max(
    0,
    Math.min(rect_a.y + rect_a.h, rect_b.y + rect_b.h) - Math.max(rect_a.y, rect_b.y),
  )
  return ox * oy
}

export function rect_circle_overlap(
  rect: Rect,
  cx: number,
  cy: number,
  radius: number,
): number {
  // Inflate rect by radius to create an exclusion zone around the marker
  const left = rect.x - radius
  const top = rect.y - radius
  const right = rect.x + rect.w + radius
  const bottom = rect.y + rect.h + radius
  if (cx < left || cx > right || cy < top || cy > bottom) return 0
  // Penalty proportional to how deep the marker center is inside the exclusion zone
  const dx = Math.min(cx - left, right - cx)
  const dy = Math.min(cy - top, bottom - cy)
  return Math.min(dx, dy) + radius
}

export function segments_intersect(
  ax1: number,
  ay1: number,
  ax2: number,
  ay2: number,
  bx1: number,
  by1: number,
  bx2: number,
  by2: number,
): boolean {
  const d1x = ax2 - ax1,
    d1y = ay2 - ay1
  const d2x = bx2 - bx1,
    d2y = by2 - by1
  const cross = d1x * d2y - d1y * d2x
  if (Math.abs(cross) < 1e-10) return false
  const t_val = ((bx1 - ax1) * d2y - (by1 - ay1) * d2x) / cross
  const u_val = ((bx1 - ax1) * d1y - (by1 - ay1) * d1x) / cross
  return t_val > 0 && t_val < 1 && u_val > 0 && u_val < 1
}

export function segment_rect_intersects(
  sx1: number,
  sy1: number,
  sx2: number,
  sy2: number,
  rect: Rect,
): boolean {
  const rx = rect.x,
    ry = rect.y,
    rx2 = rx + rect.w,
    ry2 = ry + rect.h
  return (
    segments_intersect(sx1, sy1, sx2, sy2, rx, ry, rx2, ry) ||
    segments_intersect(sx1, sy1, sx2, sy2, rx2, ry, rx2, ry2) ||
    segments_intersect(sx1, sy1, sx2, sy2, rx, ry2, rx2, ry2) ||
    segments_intersect(sx1, sy1, sx2, sy2, rx, ry, rx, ry2)
  )
}

export function rect_out_of_bounds_area(rect: Rect, bounds: PlotBounds): number {
  let penalty = 0
  if (rect.x < bounds.min_x) penalty += (bounds.min_x - rect.x) * rect.h
  if (rect.y < bounds.min_y) penalty += (bounds.min_y - rect.y) * rect.w
  if (rect.x + rect.w > bounds.max_x) penalty += (rect.x + rect.w - bounds.max_x) * rect.h
  if (rect.y + rect.h > bounds.max_y) penalty += (rect.y + rect.h - bounds.max_y) * rect.w
  return penalty
}

export function label_leader_segment({
  point,
  point_radius,
  label_center,
  label_size,
  min_length = 6,
  label_padding = 1,
}: LeaderLineOptions): LeaderLineSegment | null {
  const delta_x = label_center.x - point.x
  const delta_y = label_center.y - point.y
  const center_distance = Math.hypot(delta_x, delta_y)
  if (center_distance <= 0) return null

  const unit_x = delta_x / center_distance
  const unit_y = delta_y / center_distance
  const start_x = point.x + unit_x * point_radius
  const start_y = point.y + unit_y * point_radius
  const half_width = label_size.width / 2 + label_padding
  const half_height = label_size.height / 2 + label_padding
  const edge_distance = Math.min(
    Math.abs(unit_x) > 0.001 ? half_width / Math.abs(unit_x) : Infinity,
    Math.abs(unit_y) > 0.001 ? half_height / Math.abs(unit_y) : Infinity,
  )
  const visible_length = center_distance - point_radius - edge_distance
  if (visible_length <= min_length) return null

  const end_x = label_center.x - unit_x * edge_distance
  const end_y = label_center.y - unit_y * edge_distance
  return { x1: start_x, y1: start_y, x2: end_x, y2: end_y }
}

// 8 candidate positions around anchor: R, TR, T, TL, L, BL, B, BR
// Positions are top-left corner of the label bounding box.
// All positions keep a full `offset` gap from the marker edge.
export function generate_candidates(
  ax: number,
  ay: number,
  point_radius: number,
  label_w: number,
  label_h: number,
  gap: number,
): Point2D[] {
  const offset = point_radius + gap
  return [
    { x: ax + offset, y: ay - label_h + offset / 2 }, // R  (baseline just below center)
    { x: ax + offset, y: ay - label_h - offset / 2 }, // TR
    { x: ax - label_w / 2, y: ay - label_h - offset }, // T
    { x: ax - label_w - offset, y: ay - label_h - offset / 2 }, // TL
    { x: ax - label_w - offset, y: ay - label_h + offset / 2 }, // L  (baseline just below center)
    { x: ax - label_w - offset, y: ay + offset / 2 }, // BL
    { x: ax - label_w / 2, y: ay + offset }, // B
    { x: ax + offset, y: ay + offset / 2 }, // BR
  ]
}

// Anchors never move, so bucketing them once serves a whole SA run. Labels do move, but each
// one is bucketed by its own anchor and queries grow by `reach`, the furthest any rect now
// sits from its anchor, so a bucket that could contribute is never skipped. Hits go into a
// bitset rather than a list purely to keep candidates in ascending index order: the sums in
// compute_delta_energy must stay float-identical to the unpruned scan. Requires
// labels[idx].anchor_idx === idx, which the SA loop below guarantees.
// Exported only so the equivalence test can score a move the same way the solver does.
type NeighborIndex = ReturnType<typeof create_neighbor_index>

export function create_neighbor_index(anchors: AnchorInfo[]) {
  // `far_*` rather than max_x/max_y so `collect`'s query box below doesn't shadow them
  const [origin_x, far_x] = array_extent(anchors.map(({ x }) => x))
  const [origin_y, far_y] = array_extent(anchors.map(({ y }) => y))
  // ~1 anchor per cell measured fastest; the dominant-extent floor caps collinear grids.
  const extent_x = far_x - origin_x
  const extent_y = far_y - origin_y
  const size = Math.max(
    1,
    Math.sqrt((extent_x * extent_y) / anchors.length),
    Math.max(extent_x, extent_y) / anchors.length,
  )
  const cols = Math.floor(extent_x / size) + 1
  const rows = Math.floor(extent_y / size) + 1
  const lists: number[][] = Array.from({ length: cols * rows }, () => [])
  anchors.forEach(({ x, y }, idx) =>
    lists[Math.floor((y - origin_y) / size) * cols + Math.floor((x - origin_x) / size)].push(
      idx,
    ),
  )
  const buckets = lists.map((bucket) => Int32Array.from(bucket))
  const bits = new Uint32Array((anchors.length + 31) >>> 5)
  const candidates = new Int32Array(anchors.length)
  let reach = 0

  // Grows `reach` to cover `label`, which every moved label needs before the next query
  const widen = (label: LabelState) => {
    const { x, y } = anchors[label.anchor_idx]
    reach = Math.max(
      reach,
      Math.abs(label.x - x),
      Math.abs(label.x + label.w - x),
      Math.abs(label.y - y),
      Math.abs(label.y + label.h - y),
    )
  }

  return {
    candidates,
    widen,
    // Re-derives `reach` from scratch, which callers must do once before their first query.
    // Widening alone never shrinks, so one label that wandered and came back would inflate
    // every later query; call this periodically to undo that. In between an over-estimate
    // only costs extra candidates, it can never drop a neighbour.
    reset(labels: LabelState[]) {
      // Marker circles reach `radius` past their anchor, so that is the floor
      reach = anchors.reduce((widest, { radius }) => Math.max(widest, radius), 0)
      for (const label of labels) widen(label)
    },
    // Fills `candidates` with the anchors whose bucket the box can reach, ascending
    collect(min_x: number, max_x: number, min_y: number, max_y: number): number {
      const col_lo = Math.max(0, Math.floor((min_x - reach - origin_x) / size))
      const col_hi = Math.min(cols - 1, Math.floor((max_x + reach - origin_x) / size))
      const row_lo = Math.max(0, Math.floor((min_y - reach - origin_y) / size))
      const row_hi = Math.min(rows - 1, Math.floor((max_y + reach - origin_y) / size))
      for (let row = row_lo; row <= row_hi; row++) {
        for (let col = col_lo; col <= col_hi; col++) {
          for (const idx of buckets[row * cols + col]) bits[idx >>> 5] |= 1 << (idx & 31)
        }
      }
      let count = 0
      for (let word = 0; word < bits.length; word++) {
        let mask = bits[word]
        bits[word] = 0
        while (mask !== 0) {
          candidates[count++] = (word << 5) | (31 - Math.clz32(mask & -mask))
          mask &= mask - 1
        }
      }
      return count
    },
  }
}

// Compute energy delta when only label at `changed_idx` moves
export function compute_delta_energy(
  labels: LabelState[],
  anchors: AnchorInfo[],
  changed_idx: number,
  old_state: LabelState,
  new_state: LabelState,
  weights: Required<LabelPlacementWeights>,
  bounds: PlotBounds,
  neighbors: NeighborIndex,
): number {
  let delta = 0
  const anchor = anchors[new_state.anchor_idx]

  const old_cx = old_state.x + old_state.w / 2,
    old_cy = old_state.y + old_state.h / 2
  const new_cx = new_state.x + new_state.w / 2,
    new_cy = new_state.y + new_state.h / 2

  delta +=
    weights.distance *
    (Math.hypot(new_cx - anchor.x, new_cy - anchor.y) -
      Math.hypot(old_cx - anchor.x, old_cy - anchor.y))

  delta +=
    weights.bounds *
    (rect_out_of_bounds_area(new_state, bounds) - rect_out_of_bounds_area(old_state, bounds))

  // Every term below is confined to the box spanned by the two rectangles and the anchor
  // (the latter for the leader lines), so anything disjoint from it contributes exactly zero
  // and four comparisons can reject it before the geometry routines run. Measured 98-99% of
  // markers rejected on scenes of 50-500 labels.
  const box_min_x = Math.min(old_state.x, new_state.x, anchor.x)
  const box_max_x = Math.max(old_state.x + old_state.w, new_state.x + new_state.w, anchor.x)
  const box_min_y = Math.min(old_state.y, new_state.y, anchor.y)
  const box_max_y = Math.max(old_state.y + old_state.h, new_state.y + new_state.h, anchor.y)
  const misses_box = (min_x: number, max_x: number, min_y: number, max_y: number) =>
    max_x < box_min_x || min_x > box_max_x || max_y < box_min_y || min_y > box_max_y

  // Everything outside the box contributes zero, so the index skips most of it up front and
  // the box test only has to reject what survives its buckets.
  const { candidates } = neighbors
  const count = neighbors.collect(box_min_x, box_max_x, box_min_y, box_max_y)

  for (let pos = 0; pos < count; pos++) {
    const { x, y, radius } = anchors[candidates[pos]]
    if (misses_box(x - radius, x + radius, y - radius, y + radius)) continue
    delta +=
      weights.marker *
      (rect_circle_overlap(new_state, x, y, radius) -
        rect_circle_overlap(old_state, x, y, radius))
  }

  // Pairwise interactions with all other labels, each reaching over its rect and its anchor
  for (let pos = 0; pos < count; pos++) {
    const jdx = candidates[pos]
    if (jdx === changed_idx) continue
    const other = labels[jdx]
    const peer = anchors[other.anchor_idx] // the other label's anchor
    if (
      misses_box(
        Math.min(other.x, peer.x),
        Math.max(other.x + other.w, peer.x),
        Math.min(other.y, peer.y),
        Math.max(other.y + other.h, peer.y),
      )
    )
      continue
    const other_cx = other.x + other.w / 2,
      other_cy = other.y + other.h / 2

    delta +=
      weights.overlap *
      (rect_overlap_area(new_state, other) - rect_overlap_area(old_state, other))

    // Leader line crossing delta (changed label's leader vs other's leader)
    // shared tail of both crossing tests, so each call still fits on one line
    const peer_leader = [peer.x, peer.y, other_cx, other_cy] as const
    const old_cross = segments_intersect(anchor.x, anchor.y, old_cx, old_cy, ...peer_leader)
    const new_cross = segments_intersect(anchor.x, anchor.y, new_cx, new_cy, ...peer_leader)
    if (new_cross !== old_cross) delta += (new_cross ? 1 : -1) * weights.leader_cross

    // Changed label's leader crossing other label's rect
    const old_text = segment_rect_intersects(anchor.x, anchor.y, old_cx, old_cy, other)
    const new_text = segment_rect_intersects(anchor.x, anchor.y, new_cx, new_cy, other)
    if (new_text !== old_text) delta += (new_text ? 1 : -1) * weights.leader_text

    // Other label's leader crossing changed label's rect
    const old_other = segment_rect_intersects(peer.x, peer.y, other_cx, other_cy, old_state)
    const new_other = segment_rect_intersects(peer.x, peer.y, other_cx, other_cy, new_state)
    if (new_other !== old_other) delta += (new_other ? 1 : -1) * weights.leader_text
  }

  return delta
}

function cull_dense_labels(
  label_infos: LabelInfo[],
  max_neighbors: number,
  radius: number,
): LabelInfo[] {
  if (radius <= 0 || label_infos.length <= max_neighbors + 1) return label_infos
  const radius_squared = radius * radius
  const get_cell = (value: number) => Math.floor(value / radius)
  const grid: Record<string, number[]> = {}
  label_infos.forEach(({ anchor }, label_idx) => {
    const key = `${get_cell(anchor.x)},${get_cell(anchor.y)}`
    const bucket = grid[key] ?? (grid[key] = [])
    bucket.push(label_idx)
  })

  return label_infos.filter(({ anchor }, label_idx) => {
    const cell_x = get_cell(anchor.x)
    const cell_y = get_cell(anchor.y)
    let neighbors = 0
    for (const cell_x_offset of NEIGHBOR_CELL_OFFSETS) {
      for (const cell_y_offset of NEIGHBOR_CELL_OFFSETS) {
        const bucket = grid[`${cell_x + cell_x_offset},${cell_y + cell_y_offset}`]
        if (!bucket) continue
        for (const neighbor_idx of bucket) {
          if (neighbor_idx === label_idx) continue
          const delta_x = anchor.x - label_infos[neighbor_idx].anchor.x
          const delta_y = anchor.y - label_infos[neighbor_idx].anchor.y
          if (delta_x * delta_x + delta_y * delta_y <= radius_squared) neighbors += 1
          if (neighbors > max_neighbors) return false
        }
      }
    }
    return true
  })
}

// === Main export ===
export function compute_label_positions(
  filtered_series: DataSeries[],
  config: LabelPlacementConfig,
  // Per-axis pixel scales; each point anchors to its series' x/x2 and y/y2 scale
  scales: Record<FacetAxis, PlotScaleFn>,
  bounds: {
    width: number
    height: number
    pad: { t: number; b: number; l: number; r: number }
  },
  // In/out: last solve's per-label offset from its anchor. Supplying it polishes that layout
  // instead of searching afresh. Overwritten here, so pass one Map per plot and reuse it.
  warm_start?: Map<string, Point2D>,
): Record<string, Point2D> {
  const { width, height, pad } = bounds

  const plot_bounds: PlotBounds = {
    min_x: pad.l,
    min_y: pad.t,
    max_x: width - pad.r,
    max_y: height - pad.b,
  }

  // Collect all label data in a single pass
  let label_infos: LabelInfo[] = []
  const candidate_gap = config.candidate_gap ?? 4

  for (const series of filtered_series) {
    for (const pt of series.filtered_data ?? []) {
      if (!pt.point_label?.auto_placement || !pt.point_label.text) continue

      const x_scale = series.x_axis === `x2` ? scales.x2 : scales.x
      const y_scale = series.y_axis === `y2` ? scales.y2 : scales.y
      const anchor_x = x_scale(pt.x) + (pt.point_offset?.x ?? 0)
      const anchor_y = y_scale(pt.y) + (pt.point_offset?.y ?? 0)
      const label_size =
        pt.point_label.size ??
        estimate_label_size(pt.point_label.text, pt.point_label.font_size)
      const label_w = Math.max(0, label_size.width)
      const label_h = Math.max(0, label_size.height)
      const radius = Math.max(0, pt.point_style?.radius ?? 3)
      // A non-finite anchor (log scale on a non-positive value, say) has nothing to place a
      // label against, and keeping it would make every delta NaN -- so every SA move loses to
      // `delta < 0` and the whole scene silently freezes at its greedy positions, not just
      // this label. Degenerate `plot_bounds` (max < min) is separate and not handled here.
      if (![anchor_x, anchor_y, label_w, label_h, radius].every(Number.isFinite)) continue

      label_infos.push({
        id: `${pt.series_idx}-${pt.point_idx}`,
        anchor: { x: anchor_x, y: anchor_y, radius },
        width: label_w,
        height: label_h,
        candidates: generate_candidates(
          anchor_x,
          anchor_y,
          radius,
          label_w,
          label_h,
          candidate_gap,
        ),
      })
    }
  }

  if (config.max_neighbors) {
    label_infos = cull_dense_labels(
      label_infos,
      config.max_neighbors.count,
      config.max_neighbors.radius,
    )
  }

  const num_labels = label_infos.length
  if (num_labels === 0) {
    warm_start?.clear()
    return {}
  }

  // Fallback: too many labels, just offset to the right with bounds clamping
  if (config.max_labels && num_labels > config.max_labels) {
    warm_start?.clear() // positions below are a pure function of the anchors, nothing to carry
    return Object.fromEntries(
      label_infos.map((info) => [
        info.id,
        {
          x: Math.min(
            Math.max(info.anchor.x + 5, plot_bounds.min_x),
            plot_bounds.max_x - info.width,
          ),
          y: Math.min(
            Math.max(info.anchor.y, plot_bounds.min_y),
            plot_bounds.max_y - info.height,
          ),
        },
      ]),
    )
  }

  const weights: Required<LabelPlacementWeights> = { ...DEFAULT_WEIGHTS, ...config.weights }
  const anchors = label_infos.map((info) => info.anchor)

  // Carried-over labels keep their offset from the anchor. A pan moves every anchor by the
  // same vector, so replaying offsets reproduces the previous layout exactly and the anneal
  // only fixes what changed: zoom crowding, plot edges, labels that just scrolled in.
  const labels: LabelState[] = Array.from({ length: num_labels })
  const placed: LabelState[] = []
  const cold_labels: number[] = []
  for (let idx = 0; idx < num_labels; idx++) {
    const { id, width: lw, height: lh, anchor } = label_infos[idx]
    const offset = warm_start?.get(id)
    if (!offset) {
      cold_labels.push(idx)
      continue
    }
    labels[idx] = {
      x: anchor.x + offset.x - lw / 2,
      y: anchor.y + offset.y - lh / 2,
      w: lw,
      h: lh,
      anchor_idx: idx,
    }
    placed.push(labels[idx])
  }

  // Greedy initialization for the rest: pick best candidate per label. With nothing carried
  // over this runs over every label in order, scoring against those already placed.
  for (const idx of cold_labels) {
    const { candidates, width: lw, height: lh, anchor } = label_infos[idx]
    let best_candidate = candidates[0]
    let best_score = Infinity

    for (const candidate of candidates) {
      const test_rect: Rect = { x: candidate.x, y: candidate.y, w: lw, h: lh }
      let score = weights.bounds * rect_out_of_bounds_area(test_rect, plot_bounds)

      for (const other of placed) {
        score += weights.overlap * rect_overlap_area(test_rect, other)
      }
      for (const marker of anchors) {
        score +=
          weights.marker * rect_circle_overlap(test_rect, marker.x, marker.y, marker.radius)
      }
      score +=
        weights.distance *
        Math.hypot(candidate.x + lw / 2 - anchor.x, candidate.y + lh / 2 - anchor.y)

      if (score < best_score) {
        best_score = score
        best_candidate = candidate
      }
    }

    labels[idx] = { x: best_candidate.x, y: best_candidate.y, w: lw, h: lh, anchor_idx: idx }
    placed.push(labels[idx])
  }

  // Simulated annealing. A warm re-solve polishes rather than searches: a fraction of the step
  // budget, started cool, since full heat would shake a good layout apart before it cooled
  // again. Only when most labels carried over, though — one restored label must not put all
  // the new ones on a polish budget and leave the frame after a data change badly laid out.
  const is_warm = cold_labels.length * 4 <= num_labels
  const cold_iterations = config.sa_iterations ?? 2000
  const warm_iterations = config.warm_sa_iterations ?? WARM_SA_ITERATIONS
  // `> 0` so a caller that disabled annealing with sa_iterations: 0 keeps it off when warm
  const sa_iterations = is_warm && cold_iterations > 0 ? warm_iterations : cold_iterations
  const start_temp = is_warm ? WARM_START_TEMP : 1
  const total_steps = sa_iterations * num_labels
  const cooling_rate = 1 / total_steps

  // Seeded pseudo-random for deterministic results
  let rng_state = 42
  const next_random = (): number => {
    rng_state = (rng_state * 1664525 + 1013904223) & 0x7fffffff
    return rng_state / 0x7fffffff
  }

  // Reusable scratch objects to avoid allocations in the hot loop
  const old_scratch: LabelState = { x: 0, y: 0, w: 0, h: 0, anchor_idx: 0 }
  const new_scratch: LabelState = { x: 0, y: 0, w: 0, h: 0, anchor_idx: 0 }

  const neighbors = create_neighbor_index(anchors)

  for (let step = 0; step < total_steps; step++) {
    // once per sweep, which also seeds the reach on step 0
    if (step % num_labels === 0) neighbors.reset(labels)
    const temperature = Math.max(0.001, start_temp * (1.0 - step * cooling_rate))
    const label_idx = Math.floor(next_random() * num_labels)
    const current = labels[label_idx]
    copy_state(old_scratch, current)
    copy_state(new_scratch, current)

    // 70% try a candidate position, 30% small perturbation
    if (next_random() < 0.7) {
      const candidate =
        label_infos[label_idx].candidates[
          Math.floor(next_random() * label_infos[label_idx].candidates.length)
        ]
      new_scratch.x = candidate.x
      new_scratch.y = candidate.y
    } else {
      const max_shift = 30 * temperature + 5
      new_scratch.x += (next_random() - 0.5) * 2 * max_shift
      new_scratch.y += (next_random() - 0.5) * 2 * max_shift
    }

    const delta = compute_delta_energy(
      labels,
      anchors,
      label_idx,
      old_scratch,
      new_scratch,
      weights,
      plot_bounds,
      neighbors,
    )

    if (delta < 0 || next_random() < Math.exp(-delta / (temperature * 10 + 0.1))) {
      current.x = new_scratch.x
      current.y = new_scratch.y
      neighbors.widen(current)
    }
  }

  // Label centre positions (the existing API) and, alongside them, the anchor-relative
  // offsets that warm-start the next solve. Those are rebuilt rather than merged: labels that
  // scrolled out of view or got culled must not linger in the map.
  warm_start?.clear()
  const positions: Record<string, Point2D> = {}
  for (const [idx, { id, anchor }] of label_infos.entries()) {
    const label = labels[idx]
    const center = { x: label.x + label.w / 2, y: label.y + label.h / 2 }
    positions[id] = center
    warm_start?.set(id, { x: center.x - anchor.x, y: center.y - anchor.y })
  }
  return positions
}
