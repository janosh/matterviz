// Data extraction functions for trajectory analysis and plotting
import { TRAJECTORY_ENERGY_KEYS } from '$lib/constants'
import { get_density } from '$lib/structure/density'
import { copy_numeric_fields } from './helpers'
import type { TrajectoryDataExtractor, TrajectoryFrame, TrajectoryMetadata } from './index'

// Build an extractor that copies the listed numeric metadata fields (plus Step)
const make_metadata_extractor =
  (fields: readonly string[]): TrajectoryDataExtractor =>
  (frame: TrajectoryFrame): Record<string, number> => {
    const data: Record<string, number> = { Step: frame.step }
    if (frame.metadata) copy_numeric_fields(data, frame.metadata, fields)
    return data
  }

export const energy_data_extractor = make_metadata_extractor(TRAJECTORY_ENERGY_KEYS)

// Force statistics as the parser recorded them (per-atom vectors live on the sites as
// `force`, never in frame metadata). A relaxed structure legitimately has force_max 0.
export const force_stress_data_extractor: TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
): Record<string, number> => {
  const data: Record<string, number> = { Step: frame.step }
  const { metadata } = frame
  if (!metadata) return data
  copy_numeric_fields(data, metadata, [`force_max`, `force_norm`])
  // pressure lives here, not in structural_data_extractor, so full_data_extractor gets it once
  copy_numeric_fields(data, metadata, [`stress_max`, `stress_frobenius`, `pressure`])
  return data
}

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
  if (metadata) {
    copy_numeric_fields(data, metadata, [`temperature`])
    // Finite-number check (not truthiness) so a legitimate density of 0 is kept
    if (typeof metadata.density === `number` && Number.isFinite(metadata.density)) {
      data.density = metadata.density
    }
    if (!lattice) copy_numeric_fields(data, metadata, [`volume`])
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
const BOOKKEEPING_METADATA_KEYS = new Set([`step`, `frame_number`, `total_atoms`])

// The canonical plot row: every finite numeric scalar the frame's metadata carries (energies,
// forces, SCF residuals, bandgap, temperature, file-specific keys, ...) plus the lattice
// geometry and density derived from its structure. A fixed allowlist here silently lost every
// series it did not name. Lattice parameters that never vary are dropped by the plot's
// constant-series filter, so nothing marks them here.
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

// One frame's plot row. The single definition of per-frame plot values: in-memory runs map it
// over their frames and indexed runs over each frame as they decode it (ASE via a reduced
// decode that skips positions and sites, see create_plot_row_frame), so which reader a
// file's byte size picks cannot change its plot.
export const frame_property_row = (
  frame: TrajectoryFrame,
  frame_number: number,
  data_extractor: TrajectoryDataExtractor = full_data_extractor,
): TrajectoryMetadata => ({
  frame_number,
  step: frame.step,
  properties: data_extractor(frame),
})
