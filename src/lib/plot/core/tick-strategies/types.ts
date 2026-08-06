export const TICK_STRATEGIES = [
  `upright`,
  `wrap`,
  `rotate`,
  `stagger`,
  `thin`,
  `abbreviate`,
  `ellipsis`,
] as const

export type TickStrategy = (typeof TICK_STRATEGIES)[number]
export type TickScoringMode = `auto` | `readable` | `compact`
export type TickStaggerRow = 0 | 1

// Every candidate retains the original text independently from its visual lines. Renderers can
// therefore use full_text for aria-label/title even when the visible label is shortened or hidden.
export interface TickCandidateLabel {
  tick_index: number
  full_text: string
  display_lines: readonly string[]
  visible: boolean
  stagger_row: TickStaggerRow
  // Fraction of semantic content removed from this label, in [0, 1].
  information_loss: number
}

// Upright, wrapped, and rotated layouts supplied by the caller use this same contract as the
// generated Wave 1 strategies. Geometry stays caller-owned because it depends on axis placement.
export interface TickStrategyCandidate {
  id: string
  strategy: TickStrategy
  labels: readonly TickCandidateLabel[]
  rotation_deg: number
}

export interface TickCandidateMeasurements {
  // Number of colliding label pairs after layout.
  collisions: number
  // Total pixels extending beyond the axis' available edge bounds.
  edge_overflow_px: number
  // Candidate's outward label band divided by the caller's available band.
  band_fraction: number
}

export interface MeasuredTickCandidate {
  candidate: TickStrategyCandidate
  measurements: TickCandidateMeasurements
}

export interface TickScoreWeights {
  hidden_labels: number
  information_loss: number
  band_fraction: number
  rotation_magnitude: number
  line_count: number
  stagger_rows: number
}

export interface TickScoringConfig {
  mode?: TickScoringMode
  weights?: Partial<TickScoreWeights>
}

export interface TickScorePenalties {
  hidden_labels: number
  information_loss: number
  band_fraction: number
  // Absolute rotation normalized to a quarter turn.
  rotation_magnitude: number
  // Additional lines beyond a single line.
  line_count: number
  // Additional stagger rows beyond the baseline row.
  stagger_rows: number
}

export interface TickScoreResult {
  candidate: TickStrategyCandidate
  measurements: TickCandidateMeasurements
  feasible: boolean
  penalties: TickScorePenalties
  weighted_penalties: TickScorePenalties
  // Lower is better. Infeasible candidates retain a finite score for deterministic fallback.
  score: number
}

export interface TickSelectionResult {
  // Null means every candidate violated a hard feasibility constraint.
  winner: TickScoreResult | null
  // Includes every candidate, including infeasible ones, in deterministic rank order.
  evaluated: readonly TickScoreResult[]
}
