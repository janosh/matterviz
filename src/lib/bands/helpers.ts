// Helper utilities for band structure and DOS data processing
import { SUBSCRIPT_MAP } from '$lib/labels'
import { euclidean_dist, type Matrix3x3, type Vec3 } from '$lib/math'
import type * as types from './types'

// Physical constants for unit conversions (SI units)
const PLANCK = 6.62607015e-34 // J⋅s
const EV_TO_J = 1.602176634e-19 // J
const C_LIGHT = 299792458 // m/s
const THz_TO_HZ = 1e12
const THz_TO_EV = (PLANCK * THz_TO_HZ) / EV_TO_J
const THz_TO_MEV = THz_TO_EV * 1000
const THz_TO_HA = THz_TO_EV / 27.211386245988 // Hartree
const THz_TO_CM = THz_TO_HZ / (C_LIGHT * 100) // cm^-1 (c in cm/s)

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
          SUBSCRIPT_MAP[digit as keyof typeof SUBSCRIPT_MAP] ?? digit
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

// Type guards for pymatgen qpoint formats
const is_vec3 = (val: unknown): val is Vec3 =>
  Array.isArray(val) && val.length >= 3 && val.slice(0, 3).every(Number.isFinite)

interface PymatgenKpoint {
  frac_coords: Vec3
  label?: string | null
}
const is_kpoint = (val: unknown): val is PymatgenKpoint =>
  !!val && typeof val === `object` && `frac_coords` in val &&
  is_vec3((val as PymatgenKpoint).frac_coords)

const is_pymatgen_format = (obj: Record<string, unknown>): boolean => {
  // Check for explicit pymatgen markers
  if (typeof obj[`@class`] === `string` || typeof obj[`@module`] === `string`) {
    return true
  }
  // Check for pymatgen-style qpoints (phonon) or kpoints (electronic) without branches
  const points = obj.qpoints ?? obj.kpoints
  if (Array.isArray(points) && points.length > 0 && !Array.isArray(obj.branches)) {
    return is_vec3(points[0]) || is_kpoint(points[0])
  }
  return false
}

// Extract frac_coords/label from pymatgen qpoint, matching label from labels_dict if needed
const parse_qpoint = (
  qpt: unknown,
  labels_dict?: Record<string, Vec3>,
): types.QPoint | null => {
  const frac_coords = is_vec3(qpt)
    ? [qpt[0], qpt[1], qpt[2]] as Vec3
    : is_kpoint(qpt)
    ? qpt.frac_coords
    : null
  if (!frac_coords) return null

  const label = (is_kpoint(qpt) && typeof qpt.label === `string` && qpt.label) ||
    Object.entries(labels_dict ?? {}).find(([, c]) =>
      euclidean_dist(frac_coords, c) < 1e-4
    )
      ?.[0] ||
    null
  return { label, frac_coords }
}

// Inverse conversion factors (derived from THz_TO_* for consistency)
const EV_TO_THZ = 1 / THz_TO_EV
const CM_TO_THZ = 1 / THz_TO_CM

/**
 * Extract first spin channel from pymatgen spin-keyed data.
 * Pymatgen stores spin-polarized data as {1: [...], -1: [...]} or {"Spin.up": [...], ...}
 */
function extract_first_spin_channel<T>(data: unknown): T | null {
  if (Array.isArray(data)) return data as T
  if (data && typeof data === `object`) {
    const keys = Object.keys(data as Record<string, unknown>)
    if (keys.length > 0) {
      return (data as Record<string, T>)[keys[0]]
    }
  }
  return null
}

// Convert pymatgen PhononBandStructureSymmLine or BandStructure to matterviz format
function convert_pymatgen_band_structure(
  pmg: Record<string, unknown>,
): types.BaseBandStructure | null {
  // Support both qpoints (phonon) and kpoints (electronic)
  const raw_qpts = (pmg.qpoints ?? pmg.kpoints) as unknown[] | undefined

  // Handle bands in multiple formats:
  // 1. Standard pymatgen: bands as dict with spin keys {1: [[...], ...]}
  // 2. Custom phonon format: frequencies_cm as 2D array [[...], ...]
  // 3. Already normalized: bands as 2D array [[...], ...]
  let raw_bands = extract_first_spin_channel<number[][]>(pmg.bands)
  const has_frequencies_cm = Array.isArray(pmg.frequencies_cm)
  if (!raw_bands && has_frequencies_cm) {
    // Phonon format: frequencies_cm is [n_qpoints x n_branches] - needs transpose
    const freqs = pmg.frequencies_cm as number[][]
    if (freqs.length > 0 && Array.isArray(freqs[0])) {
      // Transpose: [n_qpoints x n_branches] -> [n_branches x n_qpoints]
      raw_bands = Array.from(
        { length: freqs[0].length },
        (_, band_idx) => freqs.map((qpt_freqs) => qpt_freqs[band_idx]),
      )
    }
  }

  const labels_dict = pmg.labels_dict as Record<string, Vec3> | undefined
  const lattice_rec = pmg.lattice_rec as { matrix?: Matrix3x3 } | undefined
  // Determine unit: cm-1 if frequencies_cm present, else check explicit unit or default to THz
  const unit = (pmg.unit as string | undefined)?.toLowerCase() ??
    (has_frequencies_cm ? `cm-1` : `thz`)

  if (
    !Array.isArray(raw_qpts) || !Array.isArray(raw_bands) ||
    !raw_qpts.length || !raw_bands.length
  ) return null

  const qpoints = raw_qpts.map((q) => parse_qpoint(q, labels_dict)).filter(
    Boolean,
  ) as types.QPoint[]
  if (!qpoints.length) return null

  // Step distances and discontinuity detection (5x median threshold)
  const steps = qpoints.slice(1).map((q, idx) =>
    euclidean_dist(qpoints[idx].frac_coords, q.frac_coords)
  )
  const sorted = steps.slice().sort((a, b) => a - b)
  const threshold = (sorted[Math.floor(sorted.length / 2)] ?? 0) * 5
  const disc_set = new Set(
    steps.map((s, idx) => s > threshold ? idx + 1 : -1).filter((i) => i >= 0),
  )

  // Cumulative distance (skip discontinuities)
  const distance = steps.reduce(
    (acc, step, idx) => [...acc, disc_set.has(idx + 1) ? acc[idx] : acc[idx] + step],
    [0],
  )

  // Branches between labeled points (skip those with discontinuities)
  const labeled = qpoints.map((q, idx) => q.label ? idx : -1).filter((i) => i >= 0)
  const branches: types.Branch[] = labeled.slice(0, -1).flatMap((start, idx) => {
    const end = labeled[idx + 1]
    if ([...disc_set].some((d) => d > start && d <= end)) return []
    return [{
      start_index: start,
      end_index: end,
      name: `${qpoints[start].label ?? `?`}-${qpoints[end].label ?? `?`}`,
    }]
  })
  if (!branches.length) {
    branches.push({ start_index: 0, end_index: qpoints.length - 1, name: `path` })
  }

  // Convert bands to THz based on input unit
  const convert_to_thz = (val: number): number => {
    if (unit === `ev`) return val * EV_TO_THZ
    if (unit === `cm-1`) return val * CM_TO_THZ
    return val // THz (default) - no conversion
  }

  return {
    qpoints,
    branches,
    distance,
    bands: raw_bands.map((band) => band.map(convert_to_thz)),
    nb_bands: raw_bands.length,
    labels_dict: labels_dict ?? {},
    recip_lattice: { matrix: lattice_rec?.matrix ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  }
}

export function normalize_band_structure(
  bs: unknown,
): types.BaseBandStructure | null {
  if (!bs || typeof bs !== `object`) return null

  const band_struct = bs as Record<string, unknown>

  // Check if this is pymatgen format and convert if so
  if (is_pymatgen_format(band_struct)) {
    return convert_pymatgen_band_structure(band_struct)
  }

  // Standard matterviz format validation
  const { qpoints, branches, bands, distance } = band_struct as Partial<
    types.BaseBandStructure
  >
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

  return band_struct as unknown as types.BaseBandStructure
}

// Validate and normalize a DOS object.
// Supports both matterviz and pymatgen formats.
// Also auto-detects and converts cm⁻¹ to THz for legacy data (disable with auto_convert_units: false).
export function normalize_dos(
  dos: unknown,
  options: { auto_convert_units?: boolean } = {},
): types.DosData | null {
  const { auto_convert_units = true } = options
  if (!dos || typeof dos !== `object`) return null

  const dos_obj = dos as Record<string, unknown>

  // Check for pymatgen format (has @class or @module)
  const is_pymatgen = typeof dos_obj[`@class`] === `string` ||
    typeof dos_obj[`@module`] === `string`

  const { frequencies, energies, spin_polarized } = dos_obj

  // Handle densities as either array or dict with spin keys (pymatgen format)
  // Pymatgen stores densities as {1: [...], -1: [...]} or {"Spin.up": [...], ...}
  const densities = extract_first_spin_channel<number[]>(dos_obj.densities)

  if (!Array.isArray(densities)) return null

  // Phonon DOS: has frequencies
  if (Array.isArray(frequencies)) {
    if (frequencies.length !== densities.length) return null

    // Auto-detect if frequencies are in cm⁻¹ instead of THz (unless disabled)
    // Typical phonon frequencies are < 50 THz for most materials
    // If max frequency > 100, it's almost certainly in cm⁻¹
    const max_freq = Math.max(...frequencies as number[])
    let final_frequencies = frequencies as number[]

    if (auto_convert_units && max_freq > 100) {
      // Likely in cm⁻¹, convert to THz
      final_frequencies = (frequencies as number[]).map((f) => f * CM_TO_THZ)
      console.info(
        `Phonon DOS frequencies appear to be in cm⁻¹ (max: ${max_freq.toFixed(1)}). ` +
          `Converting to THz (max: ${(max_freq * CM_TO_THZ).toFixed(1)} THz).`,
      )
    }

    return { type: `phonon`, frequencies: final_frequencies, densities }
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

  // For pymatgen format, log a helpful message if format wasn't recognized
  if (is_pymatgen) {
    console.warn(
      `Pymatgen DOS format detected but missing required fields. ` +
        `Expected 'frequencies' (phonon) or 'energies' (electronic) arrays.`,
    )
  }

  return null
}

// Extract k-path points from band structure and convert to reciprocal space coordinates
// Accepts a reciprocal lattice matrix (should include 2π factor for consistency with BZ)
// Handles both matterviz format (qpoints as objects) and normalized pymatgen format
export function extract_k_path_points(
  band_struct: types.BaseBandStructure,
  recip_lattice_matrix: Matrix3x3,
): Vec3[] {
  if (!band_struct?.qpoints || !recip_lattice_matrix) return []

  if (
    recip_lattice_matrix.length !== 3 ||
    recip_lattice_matrix.some((row) => row?.length !== 3)
  ) throw new Error(`reciprocal_lattice_matrix must be a 3×3 matrix`)

  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = recip_lattice_matrix

  return band_struct.qpoints.map((qpoint) => {
    const [x, y, z] = qpoint.frac_coords
    return [
      x * m00 + y * m10 + z * m20,
      x * m01 + y * m11 + z * m21,
      x * m02 + y * m12 + z * m22,
    ] as Vec3
  })
}

// Find the q-point index closest to a given distance along the band structure path
export function find_qpoint_at_distance(
  band_struct: types.BaseBandStructure,
  target: number,
): number | null {
  const { distance } = band_struct
  if (!distance?.length) return null

  return distance.reduce(
    (closest: number, dist: number, idx: number) =>
      Math.abs(dist - target) < Math.abs(distance[closest] - target) ? idx : closest,
    0,
  )
}

// Find q-point index from rescaled x-coordinate (used in band structure plots)
// This handles the case where the plot uses custom x-axis scaling per segment
export function find_qpoint_at_rescaled_x(
  band_struct: types.BaseBandStructure,
  rescaled_x: number,
  x_positions: Record<string, [number, number]>,
): number | null {
  if (!band_struct?.branches?.length || !x_positions) return null

  // Find which segment contains this x coordinate
  for (const branch of band_struct.branches) {
    const start_idx = branch.start_index
    const end_idx = branch.end_index
    const start_label = band_struct.qpoints[start_idx]?.label ?? undefined
    const end_label = band_struct.qpoints[end_idx]?.label ?? undefined
    const segment_key = get_segment_key(start_label, end_label)

    const segment_range = x_positions[segment_key]
    if (!segment_range) continue

    const [x_start, x_end] = segment_range

    // Check if discontinuity (zero-length segment)
    const is_discontinuity = Math.abs(x_end - x_start) < 1e-6
    if (is_discontinuity) {
      // For discontinuities, check if x is exactly at this point
      if (Math.abs(rescaled_x - x_start) < 1e-6) {
        return start_idx
      }
      continue
    }

    // Check if x is within this segment (with small tolerance for edges)
    if (rescaled_x >= x_start - 1e-6 && rescaled_x <= x_end + 1e-6) {
      // Map from rescaled x back to original distance
      const segment_distances = band_struct.distance.slice(start_idx, end_idx + 1)
      const dist_min = segment_distances[0]
      const dist_max = segment_distances[segment_distances.length - 1]
      const dist_range = dist_max - dist_min

      // Handle zero-length segments
      if (dist_range === 0) {
        return start_idx
      }

      // Inverse of the scaling: x = x_start + ((dist - dist_min) / dist_range) * (x_end - x_start)
      // Solving for dist: dist = dist_min + ((x - x_start) / (x_end - x_start)) * dist_range
      const normalized_x = (rescaled_x - x_start) / (x_end - x_start)
      const target_dist = dist_min + normalized_x * dist_range

      // Find closest qpoint in this branch to the target distance
      let closest_idx = start_idx
      let min_diff = Math.abs(band_struct.distance[start_idx] - target_dist)

      for (let idx = start_idx; idx <= end_idx; idx++) {
        const diff = Math.abs(band_struct.distance[idx] - target_dist)
        if (diff < min_diff) {
          min_diff = diff
          closest_idx = idx
        }
      }

      return closest_idx
    }
  }

  // Fallback: find closest labeled point
  let closest_idx = 0
  let min_dist = Infinity

  for (const branch of band_struct.branches) {
    const start_idx = branch.start_index
    const end_idx = branch.end_index
    const start_label = band_struct.qpoints[start_idx]?.label ?? undefined
    const end_label = band_struct.qpoints[end_idx]?.label ?? undefined
    const segment_key = get_segment_key(start_label, end_label)
    const segment_range = x_positions[segment_key]

    if (!segment_range) continue

    const [x_start, x_end] = segment_range

    for (
      const [x_pos, idx] of [
        [x_start, start_idx],
        [x_end, end_idx],
      ] as const
    ) {
      const dist = Math.abs(rescaled_x - x_pos)
      if (dist < min_dist) {
        min_dist = dist
        closest_idx = idx
      }
    }
  }

  return closest_idx
}

// Type definitions for pymatgen DOS formats
// Densities can be spin-keyed: {1: number[], -1: number[]} or {"Spin.up": number[], ...}
type SpinDensities = Record<string, number[]>

/** Pymatgen Dos base class format */
export interface PymatgenDos {
  '@class': string
  '@module': string
  energies: number[]
  densities: SpinDensities | number[]
  efermi: number
}

/** Pymatgen CompleteDos format (includes projected DOS) */
export interface PymatgenCompleteDos extends PymatgenDos {
  '@class': `CompleteDos` | `LobsterCompleteDos`
  structure?: Record<string, unknown>
  pdos?: Record<string, SpinDensities>[]
  atom_dos?: Record<string, PymatgenDos>
  spd_dos?: Record<string, PymatgenDos>
}

/** Shift a single DOS object's energies by the given amount */
function shift_dos_energies<T extends PymatgenDos>(dos: T, shift: number): T {
  return {
    ...dos,
    efermi: dos.efermi - shift,
    energies: dos.energies.map((energy) => energy - shift),
  }
}

/** Shift DOS energies relative to Fermi energy so E_F = 0
 * Recursively shifts nested DOS in atom_dos and spd_dos for consistency */
export function shift_to_fermi(dos: PymatgenCompleteDos): PymatgenCompleteDos {
  const shift = dos.efermi

  // Shift nested atom_dos if present
  const atom_dos = dos.atom_dos
    ? Object.fromEntries(
      Object.entries(dos.atom_dos).map(([key, nested_dos]) => [
        key,
        shift_dos_energies(nested_dos, shift),
      ]),
    )
    : undefined

  // Shift nested spd_dos if present
  const spd_dos = dos.spd_dos
    ? Object.fromEntries(
      Object.entries(dos.spd_dos).map(([key, nested_dos]) => [
        key,
        shift_dos_energies(nested_dos, shift),
      ]),
    )
    : undefined

  return {
    ...dos,
    efermi: 0,
    energies: dos.energies.map((energy) => energy - shift),
    ...(atom_dos && { atom_dos }),
    ...(spd_dos && { spd_dos }),
  }
}
