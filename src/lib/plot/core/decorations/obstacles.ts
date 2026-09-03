// Obstacle fields the decoration solver routes around, plus the DOM footprint helpers the
// hosts use to size auto-placed decorations before and after first render.

import type { Rect, Sides } from '$lib/plot/core/layout'
import { sample_series_obstacle_points } from '$lib/plot/core/layout'
import type { DecorationPoint, DecorationSize } from './types'

// True when the user pinned a decoration via its style (an edge property or position:absolute),
// in which case auto-placement must leave it alone.
export const has_explicit_position = (style?: string | null): boolean =>
  /(?:^|[;{]\s*)(?:top|bottom|left|right)\s*:|position\s*:\s*absolute/.test(style ?? ``)

// A decoration's pixel footprint: its rendered box once laid out, else `fallback` (offset dims
// read 0 before first render). Used to decide crowding before the real size is known.
export const measured_footprint = (
  el: HTMLElement | null | undefined,
  fallback: DecorationSize,
): DecorationSize =>
  el?.offsetWidth && el?.offsetHeight
    ? { width: el.offsetWidth, height: el.offsetHeight }
    : fallback

// One mark's contribution: its projected points, plus whether a line is drawn through them
// (which makes the segments between them obstacles too).
export type ObstacleSeries = { points: DecorationPoint[]; draws_line?: boolean }

// Hands `build` the base plot box (frame minus decoration-independent padding) and samples
// what it returns. Measuring against the base rather than the padded plot is what keeps a
// decoration's own reservation out of the crowding decision.
export function with_obstacle_frame(
  frame: { width: number; height: number; effective_base_pad: Required<Sides> },
  has_marks: boolean,
  build: (base: { base_w: number; base_h: number }) => ObstacleSeries[],
): DecorationPoint[] {
  const { width, height, effective_base_pad: pad } = frame
  if (!has_marks || !width || !height) return []
  const [base_w, base_h] = [width - pad.l - pad.r, height - pad.t - pad.b]
  if (base_w <= 0 || base_h <= 0) return []
  return build_obstacles_norm(build({ base_w, base_h }), base_w, base_h)
}

const inside_unit_square = ({ x, y }: DecorationPoint): boolean =>
  Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1

// Liang-Barsky clipping keeps sampling proportional to the visible segment rather
// than spending the fixed sample budget on far-offscreen portions.
export const clip_segment_to_unit_square = (
  start: DecorationPoint,
  end: DecorationPoint,
): [DecorationPoint, DecorationPoint] | null => {
  const delta_x = end.x - start.x
  const delta_y = end.y - start.y
  if (!Number.isFinite(delta_x) || !Number.isFinite(delta_y)) return null
  let lower = 0
  let upper = 1
  for (const [direction, distance] of [
    [-delta_x, start.x],
    [delta_x, 1 - start.x],
    [-delta_y, start.y],
    [delta_y, 1 - start.y],
  ] as const) {
    if (direction === 0) {
      if (distance < 0) return null
      continue
    }
    const ratio = distance / direction
    if (direction < 0) lower = Math.max(lower, ratio)
    else upper = Math.min(upper, ratio)
    if (lower > upper) return null
  }
  return [
    { x: start.x + lower * delta_x, y: start.y + lower * delta_y },
    { x: start.x + upper * delta_x, y: start.y + upper * delta_y },
  ]
}

// Build normalized obstacles from data so decoration reservations cannot change the result and
// cause a reserve -> data-shift -> re-decide loop.
export function build_obstacles_norm(
  series: ObstacleSeries[],
  base_w: number,
  base_h: number,
): DecorationPoint[] {
  const step = 12 / Math.max(base_w, base_h, 1)
  const obstacles: DecorationPoint[] = []
  for (const { points, draws_line = false } of series) {
    if (!draws_line) {
      sample_series_obstacle_points(points.filter(inside_unit_square), false, step, obstacles)
      continue
    }
    let previous: DecorationPoint | null = null
    let previous_belongs_to_segment = false
    let last_appended: DecorationPoint | null = null
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        if (previous && !previous_belongs_to_segment && inside_unit_square(previous)) {
          obstacles.push(previous)
        }
        previous = null
        previous_belongs_to_segment = false
        last_appended = null
        continue
      }
      if (previous) {
        const clipped = clip_segment_to_unit_square(previous, point)
        if (clipped) {
          for (const obstacle of sample_series_obstacle_points(clipped, true, step)) {
            if (last_appended?.x !== obstacle.x || last_appended.y !== obstacle.y) {
              obstacles.push(obstacle)
              last_appended = obstacle
            }
          }
        } else last_appended = null
        previous_belongs_to_segment = true
      } else previous_belongs_to_segment = false
      previous = point
    }
    if (previous && !previous_belongs_to_segment && inside_unit_square(previous)) {
      obstacles.push(previous)
    }
  }
  return obstacles
}

// Clip bars before sampling so zoomed, off-screen spans cannot emit millions of points.
export function clip_bar(
  vertical: boolean,
  cross: number,
  span_start: number,
  span_end: number,
): ObstacleSeries | null {
  if (!(cross >= 0 && cross <= 1)) return null
  const lower = Math.max(0, Math.min(span_start, span_end))
  const upper = Math.min(1, Math.max(span_start, span_end))
  if (upper < lower) return null
  const points = vertical
    ? [
        { x: cross, y: lower },
        { x: cross, y: upper },
      ]
    : [
        { x: lower, y: cross },
        { x: upper, y: cross },
      ]
  return { points, draws_line: true }
}

// Project a decoration-independent normalized obstacle field into the final plot rectangle.
export const project_obstacles = (
  obstacles_norm: readonly DecorationPoint[],
  plot_bounds: Rect,
): DecorationPoint[] =>
  obstacles_norm.map(({ x, y }) => ({
    x: plot_bounds.x + x * plot_bounds.width,
    y: plot_bounds.y + y * plot_bounds.height,
  }))
