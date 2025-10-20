// Helper utilities for band structure and DOS data processing
import { subscript_map } from '$lib/labels'
import { Vec3 } from '../math'
import type * as types from './types'

// Physical constants for unit conversions (SI units)
const PLANCK = 6.62607015e-34 // J⋅s
const EV_TO_J = 1.602176634e-19 // J
const C_LIGHT = 299792458 // m/s
const THz_TO_HZ = 1e12
const THz_TO_EV = (PLANCK * THz_TO_HZ) / EV_TO_J
const THz_TO_MEV = THz_TO_EV * 1000
const THz_TO_HA = THz_TO_EV / 27.211386245988 // Hartree
const THz_TO_CM = (THz_TO_HZ / C_LIGHT) * 100 // cm^-1

// Band structure constants
export const N_ACOUSTIC_MODES = 3 // Number of acoustic modes in typical 3D crystals

// Convert symmetry point symbols to pretty-printed versions.
// Handles Greek letters and subscripts.
export function pretty_sym_point(symbol: string): string {
  if (!symbol) return ``

  // Remove underscores (htmlify maps S0 → S<sub>0</sub> but leaves S_0 as is)
  // Replace common symmetry point names with Greek letters
  // Handle subscripts: convert S0 to S₀, K1 to K₁, Γ1 to Γ₁, etc.
  // Use \p{L} to match any Unicode letter (not just ASCII A-Z)
  return symbol
    .replace(/_/g, ``)
    .replace(/GAMMA/gi, `Γ`)
    .replace(/DELTA/gi, `Δ`)
    .replace(/SIGMA/gi, `Σ`)
    .replace(/LAMBDA/gi, `Λ`)
    .replace(
      /(\p{L})(\d+)/gu,
      (_, letter, num) =>
        letter +
        num.split(``).map((digit: string) =>
          subscript_map[digit as keyof typeof subscript_map] ?? digit
        ).join(``),
    )
}

// Create segment key from start and end labels
export const get_segment_key = (start_label?: string, end_label?: string) =>
  `${start_label ?? `null`}_${end_label ?? `null`}`

// Get ordered segment keys from a band structure, preserving physical path order.
export const get_ordered_segments = (
  band_struct: types.BaseBandStructure | null,
  segments: Set<string>,
) => {
  if (!band_struct) return Array.from(segments)

  const ordered = band_struct.branches.map((br) =>
    get_segment_key(
      band_struct.qpoints[br.start_index]?.label ?? undefined,
      band_struct.qpoints[br.end_index]?.label ?? undefined,
    )
  )
  const remaining = Array.from(segments).filter((seg) => !ordered.includes(seg))
  return [...ordered, ...remaining]
}

// Extract tick positions and labels for a band structure plot.
export function get_band_xaxis_ticks(
  band_struct: types.BaseBandStructure,
  branches: string[] | Set<string> = [],
): [number[], string[]] {
  const ticks_x_pos: number[] = []
  const tick_labels: string[] = []
  let prev_label = band_struct.qpoints[0]?.label || null
  let prev_branch = band_struct.branches[0]?.name || null

  // Convert branches to Set for consistent handling
  const branches_set = Array.isArray(branches) ? new Set(branches) : branches

  for (let idx = 0; idx < band_struct.qpoints.length; idx++) {
    const point = band_struct.qpoints[idx]
    if (point.label === null) continue

    // Find which branch this point belongs to
    const branch_names = band_struct.branches
      .filter(
        (branch) => branch.start_index <= idx && idx <= branch.end_index,
      )
      .map((b) => b.name)
    const this_branch = branch_names[0] || null

    if (point.label !== prev_label && prev_branch !== this_branch) {
      // Branch transition - combine labels
      tick_labels[tick_labels.length - 1] = `${prev_label || ``}|${point.label}`
      ticks_x_pos[ticks_x_pos.length - 1] = band_struct.distance[idx]
    } else if (
      branches_set.size === 0 || (this_branch && branches_set.has(this_branch))
    ) {
      tick_labels.push(point.label)
      ticks_x_pos.push(band_struct.distance[idx])
    }

    prev_label = point.label
    prev_branch = this_branch
  }

  return [ticks_x_pos, tick_labels.map(pretty_sym_point)]
}

// Convert frequencies from THz to specified units.
export function convert_frequencies(
  frequencies: number[],
  unit: types.FrequencyUnit = `THz`,
): number[] {
  const conversion_factors: Record<types.FrequencyUnit, number> = {
    'THz': 1,
    'eV': THz_TO_EV,
    'meV': THz_TO_MEV,
    'Ha': THz_TO_HA,
    'cm-1': THz_TO_CM,
  }

  const factor = conversion_factors[unit]
  if (!factor) {
    const valid_units = Object.keys(conversion_factors).join(`, `)
    throw new Error(`Invalid unit: ${unit}. Must be one of ${valid_units}`)
  }

  return frequencies.map((freq) => freq * factor)
}

// Normalize DOS densities according to specified mode.
export function normalize_densities(
  densities: number[],
  freqs_or_energies: number[],
  mode: types.NormalizationMode,
): number[] {
  if (!mode) return densities

  const normalized = [...densities]

  if (mode === `max`) {
    const max_val = Math.max(...normalized)
    if (max_val === 0) return normalized
    return normalized.map((dens) => dens / max_val)
  } else if (mode === `sum`) {
    const sum = normalized.reduce((acc, d) => acc + d, 0)
    if (sum === 0) return normalized
    return normalized.map((dens) => dens / sum)
  } else if (mode === `integral`) {
    if (freqs_or_energies.length < 2) return normalized
    const bin_width = freqs_or_energies[1] - freqs_or_energies[0]
    if (bin_width === 0) return normalized
    const sum = normalized.reduce((acc, d) => acc + d, 0)
    if (sum === 0) return normalized
    return normalized.map((dens) => dens / (sum * bin_width))
  }

  return normalized
}

// Apply Gaussian smearing to DOS densities.
// Uses truncated Gaussian (±4σ) for O(n·w) complexity instead of O(n²).
export function apply_gaussian_smearing(
  freqs_or_energies: number[],
  densities: number[],
  sigma: number,
): number[] {
  const orig_sum = densities.reduce((acc, d) => acc + d, 0)
  if (sigma <= 0 || orig_sum === 0) return densities

  const smeared = new Array(densities.length).fill(0)
  const truncation_width = 4 // Truncate Gaussian at ±4σ (contribution < 0.01%)

  for (let idx = 0; idx < freqs_or_energies.length; idx++) {
    const energy = freqs_or_energies[idx]
    const cutoff = truncation_width * sigma

    for (let jdx = 0; jdx < freqs_or_energies.length; jdx++) {
      const e_j = freqs_or_energies[jdx]
      const delta = Math.abs(energy - e_j)

      // Skip points beyond truncation width
      if (delta > cutoff) continue

      const gaussian = Math.exp(-((energy - e_j) ** 2) / (2 * sigma ** 2))
      smeared[idx] += densities[jdx] * gaussian
    }
  }

  // Normalize to preserve integral
  const smeared_sum = smeared.reduce((acc, d) => acc + d, 0)
  if (smeared_sum === 0) return densities
  const normalization = orig_sum / smeared_sum
  return smeared.map((dens) => dens * normalization)
}

export function normalize_band_structure(
  bs: unknown,
): types.BaseBandStructure | null {
  if (!bs || typeof bs !== `object`) return null

  const band_struct = bs as Partial<types.BaseBandStructure>

  // Check required fields exist and are arrays
  const { qpoints, branches, bands, distance } = band_struct
  if (
    !Array.isArray(qpoints) ||
    !Array.isArray(branches) ||
    !Array.isArray(bands) ||
    !Array.isArray(distance)
  ) return null

  // Validate array lengths and branch indices
  const n_qpts = qpoints.length
  if (
    distance.length !== n_qpts ||
    bands.some((band) => !Array.isArray(band) || band.length !== n_qpts) ||
    branches.some(
      (br) =>
        typeof br.start_index !== `number` ||
        typeof br.end_index !== `number` ||
        br.start_index < 0 ||
        br.end_index >= n_qpts ||
        br.start_index > br.end_index,
    )
  ) return null

  return band_struct as types.BaseBandStructure
}

// Validate and normalize a DOS object.
export function normalize_dos(dos: unknown): types.DosData | null {
  if (!dos || typeof dos !== `object`) return null

  const { densities, frequencies, energies, spin_polarized } = dos as Partial<
    Record<string, unknown>
  >

  if (!Array.isArray(densities)) return null

  // Phonon DOS: has frequencies
  if (Array.isArray(frequencies)) {
    if (frequencies.length !== densities.length) return null
    return { type: `phonon`, frequencies, densities }
  }

  // Electronic DOS: has energies
  if (Array.isArray(energies)) {
    if (energies.length !== densities.length) return null
    return {
      type: `electronic`,
      energies,
      densities,
      spin_polarized: spin_polarized as boolean | undefined,
    }
  }

  return null
}

// Extract k-path points from band structure and convert to reciprocal space coordinates
// Accepts a reciprocal lattice matrix (should include 2π factor for consistency with BZ)
export function extract_k_path_points(
  band_struct: types.BaseBandStructure,
  recip_lattice_matrix: number[][],
): Vec3[] {
  if (!band_struct?.qpoints || !recip_lattice_matrix) return []

  if (
    recip_lattice_matrix.length !== 3 ||
    recip_lattice_matrix.some((row) => row?.length !== 3)
  ) throw new Error(`reciprocal_lattice_matrix must be a 3×3 matrix`)

  const [[a, b, c], [d, e, f], [g, h, i]] = recip_lattice_matrix

  return band_struct.qpoints.map(({ frac_coords: [x, y, z] }) => [
    x * a + y * d + z * g,
    x * b + y * e + z * h,
    x * c + y * f + z * i,
  ])
}

// Find the q-point index closest to a given distance along the band structure path
export function find_qpoint_at_distance(
  band_struct: types.BaseBandStructure,
  target: number,
): number | null {
  const { distance } = band_struct
  if (!distance?.length) return null

  return distance.reduce(
    (closest, dist, idx) =>
      Math.abs(dist - target) < Math.abs(distance[closest] - target) ? idx : closest,
    0,
  )
}
