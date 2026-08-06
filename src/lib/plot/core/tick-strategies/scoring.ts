import { TICK_GEOMETRY_EPSILON } from '$lib/plot/core/tick-geometry'
import type { MeasuredTickCandidate } from './types'

const STRATEGY_TIE_ORDER = [
  `upright`,
  `wrap`,
  `stagger`,
  `rotate`,
  `ellipsis`,
  `thin`,
] as const

const score_candidate = <Candidate extends MeasuredTickCandidate>(measured: Candidate) => {
  const { candidate, measurements } = measured
  const visible_labels = candidate.labels.filter(({ visible }) => visible)
  let max_line_count = 1
  for (const { display_lines } of visible_labels)
    max_line_count = Math.max(max_line_count, display_lines.length)
  const feasible =
    measurements.collisions === 0 && measurements.edge_overflow_px <= TICK_GEOMETRY_EPSILON
  return {
    measured,
    feasible,
    // A finite fallback score preserves readable text when every candidate violates a constraint.
    score:
      (candidate.labels.length - visible_labels.length) * 100 +
      visible_labels.reduce((total, { information_loss }) => total + information_loss, 0) *
        80 +
      measurements.band_fraction * 12 +
      (Math.abs(candidate.rotation_deg) / 90) * 5 +
      Math.max(0, max_line_count - 1) * 4 +
      Number(visible_labels.some(({ stagger_row }) => stagger_row === 1)) * 6,
  }
}
type ScoredCandidate = ReturnType<typeof score_candidate>

const compare_scores = (left: ScoredCandidate, right: ScoredCandidate): number => {
  const { candidate: left_candidate, measurements: left_measurements } = left.measured
  const { candidate: right_candidate, measurements: right_measurements } = right.measured
  const fallback_order = left.feasible
    ? 0
    : left_measurements.collisions - right_measurements.collisions ||
      left_measurements.edge_overflow_px - right_measurements.edge_overflow_px
  return (
    Number(right.feasible) - Number(left.feasible) ||
    fallback_order ||
    left.score - right.score ||
    STRATEGY_TIE_ORDER.indexOf(left_candidate.strategy) -
      STRATEGY_TIE_ORDER.indexOf(right_candidate.strategy) ||
    Math.abs(left_candidate.rotation_deg) - Math.abs(right_candidate.rotation_deg)
  )
}

export const select_tick_candidate = <Candidate extends MeasuredTickCandidate>(
  measured_candidates: readonly Candidate[],
): Candidate | undefined => {
  // oxlint-disable-next-line eslint-plugin-unicorn/no-array-sort -- map returns a fresh array and `toSorted` is unavailable in ES2022
  return measured_candidates.map(score_candidate).sort(compare_scores)[0]?.measured
}
