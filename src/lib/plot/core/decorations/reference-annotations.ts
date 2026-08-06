import { pad_rect, point_in_rect, rects_overlap, type Rect } from '$lib/plot/core/layout'
import type {
  DecorationPoint,
  ReferenceAnnotationCandidate,
  ReferenceAnnotationDecorationItem,
} from './types'

const EXCLUSION_PENALTY = 1_000_000
const OBSTACLE_PENALTY = 10_000
const PREFERENCE_PENALTY = 0.001

export type ReferenceAnnotationPlacementConfig = {
  item: ReferenceAnnotationDecorationItem
  obstacles?: readonly DecorationPoint[]
  exclusion_rects?: readonly Rect[]
}

export type ReferenceAnnotationPlacementResult = {
  candidate: ReferenceAnnotationCandidate
  score: number
}

const validate_candidate = (
  candidate: ReferenceAnnotationCandidate,
  item_id: string,
  candidate_idx: number,
): void => {
  const values = [
    candidate.x,
    candidate.y,
    candidate.rect.x,
    candidate.rect.y,
    candidate.rect.width,
    candidate.rect.height,
  ]
  if (
    values.some((value) => !Number.isFinite(value)) ||
    candidate.rect.width < 0 ||
    candidate.rect.height < 0
  ) {
    throw new Error(
      `Reference annotation "${item_id}" candidate ${candidate_idx} has invalid geometry: ${JSON.stringify(candidate)}`,
    )
  }
}

// Higher is better. Rectangle collisions dominate point collisions, and candidate order is the
// final deterministic tie-breaker so an obstacle-free annotation keeps its legacy anchor.
export const score_reference_annotation_candidate = ({
  candidate,
  candidate_idx,
  clearance = 0,
  obstacles = [],
  exclusion_rects = [],
}: {
  candidate: ReferenceAnnotationCandidate
  candidate_idx: number
  clearance?: number
  obstacles?: readonly DecorationPoint[]
  exclusion_rects?: readonly Rect[]
}): number => {
  const collision_rect = clearance > 0 ? pad_rect(candidate.rect, clearance) : candidate.rect
  const exclusion_count = exclusion_rects.filter((rect) =>
    rects_overlap(collision_rect, rect),
  ).length
  const obstacle_count = obstacles.filter((point) =>
    point_in_rect(point, collision_rect),
  ).length
  return (
    -exclusion_count * EXCLUSION_PENALTY -
    Math.min(obstacle_count * OBSTACLE_PENALTY, EXCLUSION_PENALTY / 2) -
    candidate_idx * PREFERENCE_PENALTY
  )
}

// Select one of a reference annotation's line-anchored candidates. Pinned items intentionally
// retain candidate zero; their score still reports any collision for diagnostics.
export function place_reference_annotation({
  item,
  obstacles = [],
  exclusion_rects = [],
}: ReferenceAnnotationPlacementConfig): ReferenceAnnotationPlacementResult {
  if (item.candidates.length === 0) {
    throw new Error(`Reference annotation "${item.id}" requires at least one candidate`)
  }
  for (const [candidate_idx, candidate] of item.candidates.entries()) {
    validate_candidate(candidate, item.id, candidate_idx)
  }

  const score_at = (candidate: ReferenceAnnotationCandidate, candidate_idx: number): number =>
    score_reference_annotation_candidate({
      candidate,
      candidate_idx,
      clearance: item.clearance,
      obstacles,
      exclusion_rects,
    })

  if (item.pinned) {
    return { candidate: item.candidates[0], score: score_at(item.candidates[0], 0) }
  }

  let best_candidate = item.candidates[0]
  let best_score = score_at(best_candidate, 0)
  for (let candidate_idx = 1; candidate_idx < item.candidates.length; candidate_idx++) {
    const candidate = item.candidates[candidate_idx]
    const score = score_at(candidate, candidate_idx)
    if (score > best_score) {
      best_candidate = candidate
      best_score = score
    }
  }
  return { candidate: best_candidate, score: best_score }
}
