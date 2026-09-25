// Data extraction functions for trajectory analysis and plotting
import { TRAJECTORY_ENERGY_KEYS } from '$lib/constants'
import { get_density } from '$lib/structure/density'
import { copy_numeric_fields } from './helpers'
import type { TrajectoryDataExtractor, TrajectoryFrame } from './index'

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

// SCF/electronic-convergence properties, emitted per frame by e.g. the vaspout.h5 parser
const scf_data_extractor: TrajectoryDataExtractor = make_metadata_extractor([
  `n_scf_steps`,
  `scf_energy_delta`,
  `scf_rms`,
  `scf_charge_rms`,
])

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

// Combined data extractor that extracts all common properties. Lattice parameters that never
// vary are dropped by the plot's constant-series filter, so nothing marks them here.
export const full_data_extractor: TrajectoryDataExtractor = (
  frame: TrajectoryFrame,
): Record<string, number> => ({
  ...energy_data_extractor(frame),
  ...force_stress_data_extractor(frame),
  ...scf_data_extractor(frame),
  ...structural_data_extractor(frame),
})
