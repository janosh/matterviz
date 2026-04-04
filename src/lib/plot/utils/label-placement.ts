import type { AxisConfig, DataSeries, XyObj } from '$lib/plot'
import type { PlotScaleFn } from '$lib/plot/scales'
import type { LabelPlacementConfig, LabelPlacementWeights } from '$lib/plot/types'
import { is_time_scale } from '$lib/plot/types'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface PlotBounds {
  min_x: number
  min_y: number
  max_x: number
  max_y: number
}

interface AnchorInfo {
  x: number
  y: number
  radius: number
}

interface LabelState extends Rect {
  anchor_idx: number
}

// Collected data for a single label before SA begins
interface LabelInfo {
  id: string
  anchor: AnchorInfo
  width: number
  height: number
  candidates: XyObj[]
}

const DEFAULT_WEIGHTS: Required<LabelPlacementWeights> = {
  overlap: 30,
  marker: 100,
  leader_cross: 10,
  leader_text: 8,
  distance: 0.5,
  bounds: 100,
}

export function parse_font_size(size_str?: string): number {
  if (!size_str) return 12
  const match = /^(\d+(?:\.\d+)?)(px|em|rem)?$/.exec(size_str)
  if (!match) return 12
  const value = parseFloat(match[1])
  return match[2] === `em` || match[2] === `rem` ? value * 16 : value
}

// === Geometry helpers ===

export function rect_overlap_area(a: Rect, b: Rect): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
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
): XyObj[] {
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

// Compute energy delta when only label at `changed_idx` moves
export function compute_delta_energy(
  labels: LabelState[],
  anchors: AnchorInfo[],
  changed_idx: number,
  old_state: LabelState,
  new_state: LabelState,
  weights: Required<LabelPlacementWeights>,
  bounds: PlotBounds,
): number {
  let delta = 0
  const anchor = anchors[new_state.anchor_idx]

  const old_cx = old_state.x + old_state.w / 2,
    old_cy = old_state.y + old_state.h / 2
  const new_cx = new_state.x + new_state.w / 2,
    new_cy = new_state.y + new_state.h / 2

  // Distance penalty change
  delta +=
    weights.distance *
    (Math.hypot(new_cx - anchor.x, new_cy - anchor.y) -
      Math.hypot(old_cx - anchor.x, old_cy - anchor.y))

  // Bounds penalty change
  delta +=
    weights.bounds *
    (rect_out_of_bounds_area(new_state, bounds) - rect_out_of_bounds_area(old_state, bounds))

  // Marker overlap change (all markers)
  for (const marker of anchors) {
    delta +=
      weights.marker *
      (rect_circle_overlap(new_state, marker.x, marker.y, marker.radius) -
        rect_circle_overlap(old_state, marker.x, marker.y, marker.radius))
  }

  // Pairwise interactions with all other labels
  for (let jdx = 0; jdx < labels.length; jdx++) {
    if (jdx === changed_idx) continue
    const other = labels[jdx]
    const anchor_j = anchors[other.anchor_idx]
    const other_cx = other.x + other.w / 2,
      other_cy = other.y + other.h / 2

    // Label-label overlap delta
    delta +=
      weights.overlap *
      (rect_overlap_area(new_state, other) - rect_overlap_area(old_state, other))

    // Leader line crossing delta (changed label's leader vs other's leader)
    const old_cross = segments_intersect(
      anchor.x,
      anchor.y,
      old_cx,
      old_cy,
      anchor_j.x,
      anchor_j.y,
      other_cx,
      other_cy,
    )
    const new_cross = segments_intersect(
      anchor.x,
      anchor.y,
      new_cx,
      new_cy,
      anchor_j.x,
      anchor_j.y,
      other_cx,
      other_cy,
    )
    if (new_cross !== old_cross) delta += (new_cross ? 1 : -1) * weights.leader_cross

    // Changed label's leader crossing other label's rect
    const old_text = segment_rect_intersects(anchor.x, anchor.y, old_cx, old_cy, other)
    const new_text = segment_rect_intersects(anchor.x, anchor.y, new_cx, new_cy, other)
    if (new_text !== old_text) delta += (new_text ? 1 : -1) * weights.leader_text

    // Other label's leader crossing changed label's rect
    const old_other = segment_rect_intersects(
      anchor_j.x,
      anchor_j.y,
      other_cx,
      other_cy,
      old_state,
    )
    const new_other = segment_rect_intersects(
      anchor_j.x,
      anchor_j.y,
      other_cx,
      other_cy,
      new_state,
    )
    if (new_other !== old_other) delta += (new_other ? 1 : -1) * weights.leader_text
  }

  return delta
}

// === Main export ===
export function compute_label_positions(
  filtered_series: DataSeries[],
  config: LabelPlacementConfig,
  scales: {
    x_scale_fn: PlotScaleFn
    y_scale_fn: PlotScaleFn
    y2_scale_fn: PlotScaleFn
    x_axis: AxisConfig
  },
  bounds: {
    width: number
    height: number
    pad: { t: number; b: number; l: number; r: number }
  },
): Record<string, XyObj> {
  const { x_scale_fn, y_scale_fn, y2_scale_fn, x_axis } = scales
  const { width, height, pad } = bounds

  const plot_bounds: PlotBounds = {
    min_x: pad.l,
    min_y: pad.t,
    max_x: width - pad.r,
    max_y: height - pad.b,
  }

  // Collect all label data in a single pass
  const label_infos: LabelInfo[] = []

  for (const series of filtered_series) {
    for (const pt of series.filtered_data ?? []) {
      if (!pt.point_label?.auto_placement || !pt.point_label.text) continue

      const ax = is_time_scale(x_axis.scale_type, x_axis.format)
        ? x_scale_fn(new Date(pt.x))
        : x_scale_fn(pt.x)
      const ay = (series.y_axis === `y2` ? y2_scale_fn : y_scale_fn)(pt.y)
      const font_size = parse_font_size(pt.point_label.font_size)
      const label_w = pt.point_label.text.length * font_size * 0.6 + 10
      const label_h = font_size * 1.2
      const radius = pt.point_style?.radius ?? 3

      label_infos.push({
        id: `${pt.series_idx}-${pt.point_idx}`,
        anchor: { x: ax, y: ay, radius },
        width: label_w,
        height: label_h,
        candidates: generate_candidates(ax, ay, radius, label_w, label_h, 4),
      })
    }
  }

  const num_labels = label_infos.length
  if (num_labels === 0) return {}

  // Fallback: too many labels, just offset to the right with bounds clamping
  if (config.max_labels && num_labels > config.max_labels) {
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

  // Greedy initialization: pick best candidate per label
  const labels: LabelState[] = []
  for (let idx = 0; idx < num_labels; idx++) {
    const { candidates, width: lw, height: lh, anchor } = label_infos[idx]
    let best_candidate = candidates[0]
    let best_score = Infinity

    for (const candidate of candidates) {
      const test_rect: Rect = { x: candidate.x, y: candidate.y, w: lw, h: lh }
      let score = weights.bounds * rect_out_of_bounds_area(test_rect, plot_bounds)

      for (const placed of labels) {
        score += weights.overlap * rect_overlap_area(test_rect, placed)
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

    labels.push({ x: best_candidate.x, y: best_candidate.y, w: lw, h: lh, anchor_idx: idx })
  }

  // Simulated annealing
  const sa_iterations = config.sa_iterations ?? 2000
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
  const copy_state = (dst: LabelState, src: LabelState) => {
    dst.x = src.x
    dst.y = src.y
    dst.w = src.w
    dst.h = src.h
    dst.anchor_idx = src.anchor_idx
  }

  for (let step = 0; step < total_steps; step++) {
    const temperature = Math.max(0.001, 1.0 - step * cooling_rate)
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
    )

    if (delta < 0 || next_random() < Math.exp(-delta / (temperature * 10 + 0.1))) {
      current.x = new_scratch.x
      current.y = new_scratch.y
    }
  }

  // Return label center positions (matching existing API)
  return Object.fromEntries(
    labels.map((label, idx) => [
      label_infos[idx].id,
      { x: label.x + label.w / 2, y: label.y + label.h / 2 },
    ]),
  )
}
