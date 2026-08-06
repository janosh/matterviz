export const TICK_STRATEGIES = [
  `upright`,
  `wrap`,
  `rotate`,
  `stagger`,
  `thin`,
  `ellipsis`,
] as const

export type TickStrategy = (typeof TICK_STRATEGIES)[number]
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

export interface MeasuredTickCandidate {
  candidate: TickStrategyCandidate
  measurements: {
    // Number of colliding label pairs after layout.
    collisions: number
    // Total pixels extending beyond the axis' available edge bounds.
    edge_overflow_px: number
    // Candidate's outward label band divided by the caller's available band.
    band_fraction: number
  }
}
