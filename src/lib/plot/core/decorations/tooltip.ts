import { clamp } from '$lib/math'
import type { Rect } from '$lib/plot/core/layout'

const DIRECTIONS = [`right-below`, `left-below`, `right-above`, `left-above`] as const
type TooltipPlacementDirection = (typeof DIRECTIONS)[number]

export type TooltipPlacementConfig = {
  anchor: { x: number; y: number }
  tooltip_size: { width: number; height: number }
  bounds: Rect
  exclusion_rects?: readonly Rect[]
  offset?: { x: number; y: number }
}

type TooltipPlacementCandidate = {
  direction: TooltipPlacementDirection
  x: number
  y: number
  rect: Rect
  overlap_area: number
  distance_penalty: number
  flip_penalty: number
  score: number
}

// Pixel overlap dominates displacement caused by clamping, which in turn dominates flipping.
// Candidate order remains the final tie-breaker.
const OVERLAP_WEIGHT = 1_000_000
const DISTANCE_WEIGHT = 1000

const validate_rect = (rect: Rect, label: string): void => {
  const { x, y, width, height } = rect
  if (![x, y, width, height].every(Number.isFinite) || width < 0 || height < 0) {
    throw new Error(`${label} has invalid geometry: ${JSON.stringify(rect)}`)
  }
}

const clamp_axis = (value: number, size: number, start: number, extent: number): number =>
  clamp(value, start, start + Math.max(0, extent - size))

const intersection_area = (left: Rect, right: Rect): number => {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  )
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  )
  return width * height
}

// Generate the four physical quadrants in a stable order. Signed offsets only select the
// preferred quadrant; their magnitudes determine the gap from the anchor.
export function get_tooltip_placement_candidates({
  anchor,
  tooltip_size,
  bounds,
  exclusion_rects = [],
  offset = { x: 10, y: 10 },
}: TooltipPlacementConfig): TooltipPlacementCandidate[] {
  const { width, height } = tooltip_size
  if (
    ![anchor.x, anchor.y, width, height, offset.x, offset.y].every(Number.isFinite) ||
    width < 0 ||
    height < 0
  ) {
    throw new Error(
      `Tooltip placement has invalid geometry: ${JSON.stringify({
        anchor,
        tooltip_size,
        offset,
      })}`,
    )
  }
  validate_rect(bounds, `Tooltip bounds`)
  for (const [rect_idx, rect] of exclusion_rects.entries()) {
    validate_rect(rect, `Tooltip exclusion rectangle ${rect_idx}`)
  }

  const offset_x = Math.abs(offset.x)
  const offset_y = Math.abs(offset.y)
  const preferred_right = offset.x >= 0
  const preferred_below = offset.y >= 0

  return DIRECTIONS.map((direction) => {
    const right = direction.startsWith(`right`)
    const below = direction.endsWith(`below`)
    const raw_x = right ? anchor.x + offset_x : anchor.x - offset_x - width
    const raw_y = below ? anchor.y + offset_y : anchor.y - offset_y - height
    const x = clamp_axis(raw_x, width, bounds.x, bounds.width)
    const y = clamp_axis(raw_y, height, bounds.y, bounds.height)
    const rect = { x, y, width, height }
    const overlap_area = exclusion_rects.reduce(
      (total, exclusion_rect) => total + intersection_area(rect, exclusion_rect),
      0,
    )
    const distance_penalty = Math.hypot(x - raw_x, y - raw_y)
    // A flip's cost is the physical move to the opposite side. This selects the relevant
    // axis at a single edge instead of relying on quadrant order when one-axis flips tie.
    const flip_penalty =
      (right !== preferred_right ? width + 2 * offset_x : 0) +
      (below !== preferred_below ? height + 2 * offset_y : 0)
    const score = -(
      overlap_area * OVERLAP_WEIGHT +
      distance_penalty * DISTANCE_WEIGHT +
      flip_penalty
    )
    return {
      direction,
      x,
      y,
      rect,
      overlap_area,
      distance_penalty,
      flip_penalty,
      score,
    }
  })
}

export const place_tooltip = (config: TooltipPlacementConfig): TooltipPlacementCandidate =>
  get_tooltip_placement_candidates(config).reduce((best, candidate) =>
    candidate.score > best.score ? candidate : best,
  )
