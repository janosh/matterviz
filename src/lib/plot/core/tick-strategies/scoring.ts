import { TICK_GEOMETRY_EPSILON } from '$lib/plot/core/tick-geometry'
import { validate_tick_candidate_once } from './candidates'
import {
  MIN_RETAINED_INFORMATION_FRACTION,
  type MeasuredTickCandidate,
  type TickCandidateMeasurements,
  type TickScorePenalties,
  type TickScoreResult,
  type TickScoreWeights,
  type TickScoringConfig,
  type TickScoringMode,
  type TickSelectionResult,
  type TickStrategy,
  type TickStrategyCandidate,
} from './types'

export const TICK_SCORE_PRESETS = {
  auto: {
    hidden_labels: 100,
    information_loss: 80,
    band_fraction: 12,
    rotation_magnitude: 5,
    line_count: 4,
    stagger_rows: 6,
  },
  readable: {
    hidden_labels: 250,
    information_loss: 200,
    band_fraction: 6,
    rotation_magnitude: 10,
    line_count: 3,
    stagger_rows: 4,
  },
  compact: {
    hidden_labels: 30,
    information_loss: 25,
    band_fraction: 60,
    rotation_magnitude: 3,
    line_count: 10,
    stagger_rows: 12,
  },
} as const satisfies Readonly<Record<TickScoringMode, TickScoreWeights>>

const WEIGHT_KEYS = [
  `hidden_labels`,
  `information_loss`,
  `band_fraction`,
  `rotation_magnitude`,
  `line_count`,
  `stagger_rows`,
] as const satisfies readonly (keyof TickScoreWeights)[]

// The record enforces exhaustive strategy coverage while preferring unchanged text and geometry.
const STRATEGY_TIE_PRIORITY = {
  upright: 0,
  wrap: 1,
  stagger: 2,
  rotate: 3,
  ellipsis: 5,
  thin: 6,
} as const satisfies Readonly<Record<TickStrategy, number>>

const is_score_mode = (mode: string): mode is TickScoringMode =>
  Object.hasOwn(TICK_SCORE_PRESETS, mode)

const validate_nonnegative = (value: number, context: string): void => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${context} must be a finite non-negative number, got ${value}`)
  }
}

export const resolve_tick_score_weights = (
  config: TickScoringConfig = {},
): TickScoreWeights => {
  const mode = config.mode ?? `auto`
  if (!is_score_mode(mode)) throw new Error(`unknown tick scoring mode "${mode}"`)

  const custom_weights = config.weights ?? {}
  const unknown_keys = Object.keys(custom_weights).filter(
    (key) => !WEIGHT_KEYS.some((weight_key) => weight_key === key),
  )
  if (unknown_keys.length > 0) {
    throw new Error(`unknown tick scoring weight(s): ${unknown_keys.join(`, `)}`)
  }

  const resolved = { ...TICK_SCORE_PRESETS[mode], ...custom_weights }
  for (const key of WEIGHT_KEYS) {
    validate_nonnegative(resolved[key], `tick scoring weight "${key}"`)
  }
  return resolved
}

const validate_measurements = (
  measurements: TickCandidateMeasurements,
  candidate_id: string,
): void => {
  if (!Number.isInteger(measurements.collisions)) {
    throw new TypeError(
      `candidate "${candidate_id}" collisions must be an integer, got ${measurements.collisions}`,
    )
  }
  validate_nonnegative(measurements.collisions, `candidate "${candidate_id}" collisions`)
  validate_nonnegative(
    measurements.edge_overflow_px,
    `candidate "${candidate_id}" edge_overflow_px`,
  )
  validate_nonnegative(measurements.band_fraction, `candidate "${candidate_id}" band_fraction`)
}

const penalties_for = (
  candidate: TickStrategyCandidate,
  measurements: TickCandidateMeasurements,
): TickScorePenalties => {
  const visible_labels = candidate.labels.filter(({ visible }) => visible)
  const max_line_count = visible_labels.reduce(
    (count, { display_lines }) => Math.max(count, display_lines.length),
    1,
  )
  return {
    hidden_labels: candidate.labels.length - visible_labels.length,
    information_loss: visible_labels.reduce(
      (total, { information_loss }) => total + information_loss,
      0,
    ),
    band_fraction: measurements.band_fraction,
    rotation_magnitude: Math.abs(candidate.rotation_deg) / 90,
    line_count: Math.max(0, max_line_count - 1),
    stagger_rows: visible_labels.some(({ stagger_row }) => stagger_row === 1) ? 1 : 0,
  }
}

const multiply_penalties = (
  penalties: TickScorePenalties,
  weights: TickScoreWeights,
): TickScorePenalties => ({
  hidden_labels: penalties.hidden_labels * weights.hidden_labels,
  information_loss: penalties.information_loss * weights.information_loss,
  band_fraction: penalties.band_fraction * weights.band_fraction,
  rotation_magnitude: penalties.rotation_magnitude * weights.rotation_magnitude,
  line_count: penalties.line_count * weights.line_count,
  stagger_rows: penalties.stagger_rows * weights.stagger_rows,
})

const sum_penalties = (penalties: TickScorePenalties): number =>
  WEIGHT_KEYS.reduce((total, key) => total + penalties[key], 0)

const retains_meaningful_content = (candidate: TickStrategyCandidate): boolean =>
  candidate.labels.some(({ visible }) => visible) &&
  candidate.labels.every(
    ({ visible, full_text, display_lines, information_loss }) =>
      !visible ||
      (information_loss <= 1 - MIN_RETAINED_INFORMATION_FRACTION &&
        (!/[\p{L}\p{N}]/u.test(full_text) ||
          display_lines.some((line) => /[\p{L}\p{N}]/u.test(line)))),
  )

const score_with_weights = (
  { candidate, measurements }: MeasuredTickCandidate,
  weights: TickScoreWeights,
): TickScoreResult => {
  validate_tick_candidate_once(candidate)
  validate_measurements(measurements, candidate.id)
  const penalties = penalties_for(candidate, measurements)
  const weighted_penalties = multiply_penalties(penalties, weights)
  const readable = retains_meaningful_content(candidate)
  const feasible =
    measurements.collisions === 0 &&
    measurements.edge_overflow_px <= TICK_GEOMETRY_EPSILON &&
    readable
  return {
    candidate,
    measurements,
    readable,
    feasible,
    penalties,
    weighted_penalties,
    // Keep a finite readability score for hard-constraint failures. If no candidate is fully
    // feasible, the layout fallback can still prefer readable text over total information loss.
    score: sum_penalties(weighted_penalties),
  }
}

export const score_tick_candidate = (
  measured_candidate: MeasuredTickCandidate,
  config: TickScoringConfig = {},
): TickScoreResult =>
  score_with_weights(measured_candidate, resolve_tick_score_weights(config))

const lexical_compare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0

const compare_scores = (left: TickScoreResult, right: TickScoreResult): number => {
  if (left.feasible !== right.feasible) return left.feasible ? -1 : 1
  if (!left.feasible) {
    if (left.readable !== right.readable) return left.readable ? -1 : 1
    if (left.readable) {
      const collision_order = left.measurements.collisions - right.measurements.collisions
      if (collision_order !== 0) return collision_order
      const overflow_order =
        left.measurements.edge_overflow_px - right.measurements.edge_overflow_px
      if (overflow_order !== 0) return overflow_order
    }
  }
  if (left.score !== right.score) return left.score - right.score
  const strategy_order =
    STRATEGY_TIE_PRIORITY[left.candidate.strategy] -
    STRATEGY_TIE_PRIORITY[right.candidate.strategy]
  if (strategy_order !== 0) return strategy_order
  const rotation_order =
    Math.abs(left.candidate.rotation_deg) - Math.abs(right.candidate.rotation_deg)
  if (rotation_order !== 0) return rotation_order
  return lexical_compare(left.candidate.id, right.candidate.id)
}

export const select_tick_candidate = (
  measured_candidates: readonly MeasuredTickCandidate[],
  config: TickScoringConfig = {},
): TickSelectionResult => {
  const candidate_ids = measured_candidates.map(({ candidate }) => candidate.id)
  const duplicate_id = candidate_ids.find(
    (candidate_id, candidate_idx) => candidate_ids.indexOf(candidate_id) !== candidate_idx,
  )
  if (duplicate_id !== undefined) {
    throw new Error(`tick candidate ids must be unique, found duplicate "${duplicate_id}"`)
  }

  const weights = resolve_tick_score_weights(config)
  // Score the complete set before ranking: auto mode is an exhaustive comparison, not first-fit.
  const evaluated = measured_candidates.map((measured_candidate) =>
    score_with_weights(measured_candidate, weights),
  )
  // oxlint-disable-next-line eslint-plugin-unicorn/no-array-sort -- map returns a fresh array and `toSorted` is unavailable in ES2022
  evaluated.sort(compare_scores)
  return {
    winner: evaluated.find(({ feasible }) => feasible) ?? null,
    evaluated,
  }
}
