// Data extraction functions for trajectory analysis and plotting
import { get_density } from '#lib/structure/density.js'
import type { TrajectoryDataExtractor, TrajectoryFrame, TrajectoryMetadata } from './index'

const LATTICE_PARAMS = [`a`, `b`, `c`, `alpha`, `beta`, `gamma`] as const

export const structural_data_extractor: TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
): Record<string, number> => {
  const data: Record<string, number> = { Step: frame.step }
  const { metadata, structure } = frame
  const lattice = `lattice` in structure ? structure.lattice : null
  if (lattice) {
    data.volume = lattice.volume
    for (const param of LATTICE_PARAMS) data[param] = lattice[param]
  }
  // Finite numbers only (not truthiness, so a density of 0 is kept): a NaN/Infinity reached
  // the plot rows, where its NaN spread dropped the whole series
  for (const key of lattice
    ? [`temperature`, `density`]
    : [`temperature`, `density`, `volume`]) {
    const value = metadata?.[key]
    if (typeof value === `number` && Number.isFinite(value)) data[key] = value
  }
  if (data.density === undefined && `lattice` in structure) {
    try {
      data.density = get_density(structure)
    } catch (error) {
      console.warn(`Failed to calculate density for frame ${frame.step}:`, error)
    }
  }
  return data
}

// Frame bookkeeping rather than per-frame physics: the step is the row's own axis
export const BOOKKEEPING_METADATA_KEYS = new Set([`step`, `frame_number`, `total_atoms`])

// The canonical plot row: every finite numeric scalar in the frame's metadata (not an
// allowlist, so file-specific keys survive) plus the lattice geometry and density. Lattice
// parameters that never vary are dropped by the plot's constant-series filter.
export const full_data_extractor: TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
): Record<string, number> => {
  const data: Record<string, number> = { Step: frame.step }
  for (const [key, value] of Object.entries(frame.metadata ?? {})) {
    if (
      typeof value === `number` &&
      Number.isFinite(value) &&
      !BOOKKEEPING_METADATA_KEYS.has(key)
    )
      data[key] = value
  }
  return { ...data, ...structural_data_extractor(frame) }
}

// One frame's plot row, shared by in-memory and indexed runs so the reader a file's byte
// size picks cannot change its plot
export const frame_property_row = (
  frame: TrajectoryFrame,
  frame_number: number,
): TrajectoryMetadata => ({
  frame_number,
  step: frame.step,
  properties: full_data_extractor(frame),
})
