// Helper utilities for band structure and DOS data processing
import { SUBSCRIPT_MAP } from '$lib/labels'
import { centered_frac, euclidean_dist, type Matrix3x3, type Vec3 } from '$lib/math'
import type * as types from './types'
import type { RibbonConfig } from './types'

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
export const IMAGINARY_MODE_NOISE_THRESHOLD = 0.005 // Clamp negatives < 0.5% as noise

// Convert symmetry point symbols to pretty-printed versions.
// Handles Greek letters (both plain and LaTeX backslash-prefixed) and subscripts.
export function pretty_sym_point(symbol: string): string {
  if (!symbol) return ``

  // Remove underscores (htmlify maps S0 → S<sub>0</sub> but leaves S_0 as is)
  // Replace common symmetry point names with Greek letters
  // Handle both plain names (GAMMA) and LaTeX notation (\Gamma) from pymatgen
  // Handle subscripts: convert S0 to S₀, K1 to K₁, Γ1 to Γ₁, etc.
  // Use \p{L} to match any Unicode letter (not just ASCII A-Z)
  return symbol
    .replace(/_/g, ``)
    .replace(/\\?GAMMA/gi, `Γ`)
    .replace(/\\?DELTA/gi, `Δ`)
    .replace(/\\?SIGMA/gi, `Σ`)
    .replace(/\\?LAMBDA/gi, `Λ`)
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

// Scale segment distances to a target x-axis range [x_start, x_end].
// Used by both band line series and fat band ribbons for consistent x-axis positioning.
export function scale_segment_distances(
  segment_distances: number[],
  x_start: number,
  x_end: number,
): number[] {
  if (segment_distances.length === 0) return []

  const dist_min = segment_distances[0]
  const dist_range = (segment_distances.at(-1) ?? dist_min) - dist_min

  if (dist_range === 0) {
    // All points at same distance - place at midpoint
    return segment_distances.map(() => (x_start + x_end) / 2)
  }

  return segment_distances.map(
    (dist) => x_start + ((dist - dist_min) / dist_range) * (x_end - x_start),
  )
}

// Get ribbon config for a specific band structure label.
// Supports both single global config (with primitive keys like opacity, max_width, scale, color)
// and per-structure config (keyed by structure label).
// Distinguishes between a global config and a per-structure config by checking if any
// primitive-typed keys (opacity, max_width, scale, color) exist at the top level.
export function get_ribbon_config(
  ribbon_config: RibbonConfig | Record<string, RibbonConfig>,
  label: string,
): RibbonConfig {
  const defaults: RibbonConfig = { opacity: 0.3, max_width: 6, scale: 1 }

  // Check for primitive config values (not objects) to distinguish single vs per-structure config
  const cfg = ribbon_config as Record<string, unknown>
  const has_primitive = [`opacity`, `max_width`, `scale`, `color`].some(
    (key) => cfg[key] !== undefined && typeof cfg[key] !== `object`,
  )

  if (has_primitive) {
    // Single global config with primitive values - apply to all structures
    return { ...defaults, ...ribbon_config }
  }

  // Otherwise, treat as Record<string, RibbonConfig> and look up by label
  // Empty label skips lookup and uses defaults only
  const per_struct = ribbon_config as Record<string, RibbonConfig>
  return { ...defaults, ...(label ? per_struct[label] : {}) }
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

// Simple LRU cache for Gaussian smearing results
// Key: hash of (frequencies, densities, sigma), Value: smeared densities
const SMEARING_CACHE_MAX_SIZE = 10
const smearing_cache = new Map<string, number[]>()

// FNV-1a hash for number arrays (fast, good distribution, O(n))
function fnv1a_hash(arr: number[]): number {
  let hash = 2166136261 // FNV offset basis
  for (const val of arr) {
    // Convert float to int32 bits for consistent hashing
    const bits = new Float64Array([val])
    const int_view = new Uint32Array(bits.buffer)
    hash ^= int_view[0]
    hash = Math.imul(hash, 16777619) // FNV prime
    hash ^= int_view[1]
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0 // Ensure unsigned
}

// Generate cache key using FNV-1a hash over full arrays (O(n), low collision risk)
function generate_smearing_cache_key(
  freqs_or_energies: number[],
  densities: number[],
  sigma: number,
): string {
  const len = freqs_or_energies.length
  if (len === 0) return `0:${sigma.toFixed(6)}:0:0`
  return `${len}:${sigma.toFixed(6)}:${fnv1a_hash(freqs_or_energies).toString(16)}:${
    fnv1a_hash(densities).toString(16)
  }`
}

// Core Gaussian smearing computation (unmemoized)
function apply_gaussian_smearing_core(
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

// Apply Gaussian smearing to DOS densities with memoization.
// Uses truncated Gaussian (±4σ) for O(n·w) complexity instead of O(n²).
// Results are cached using an LRU cache to avoid recomputation on reactive updates.
export function apply_gaussian_smearing(
  freqs_or_energies: number[],
  densities: number[],
  sigma: number,
): number[] {
  // Fast path: no smearing needed
  if (sigma <= 0) return densities

  const cache_key = generate_smearing_cache_key(freqs_or_energies, densities, sigma)

  // Check cache
  const cached = smearing_cache.get(cache_key)
  if (cached) {
    // Move to end (LRU behavior: most recently used last)
    smearing_cache.delete(cache_key)
    smearing_cache.set(cache_key, cached)
    return cached
  }

  // Compute and cache
  const result = apply_gaussian_smearing_core(freqs_or_energies, densities, sigma)

  // Evict oldest entry if cache is full (LRU: first entry is oldest)
  if (smearing_cache.size >= SMEARING_CACHE_MAX_SIZE) {
    const oldest_key = smearing_cache.keys().next().value
    if (oldest_key !== undefined) smearing_cache.delete(oldest_key)
  }

  smearing_cache.set(cache_key, result)
  return result
}

// Clear the smearing cache (useful for testing or memory management)
export function clear_smearing_cache(): void {
  smearing_cache.clear()
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

// Spin key constants for pymatgen spin-polarized data
const SPIN_UP_KEYS = [`1`, `Spin.up`]
const SPIN_DOWN_KEYS = [`-1`, `Spin.down`]

// Extract first spin channel from pymatgen spin-keyed data.
// Thin wrapper around extract_spin_channels for backwards compatibility.
function extract_first_spin_channel<T>(data: unknown): T | null {
  return extract_spin_channels<T>(data)?.up ?? null
}

// Extract both spin channels from pymatgen spin-keyed data.
// Returns { up: T, down: T | null } where down is null for non-spin-polarized data.
export function extract_spin_channels<T>(
  data: unknown,
): { up: T; down: T | null } | null {
  if (Array.isArray(data)) return { up: data as T, down: null }
  if (data && typeof data === `object`) {
    const record = data as Record<string, T>
    let spin_up: T | null = null
    let spin_down: T | null = null

    // Extract spin-up channel
    for (const key of SPIN_UP_KEYS) {
      if (key in record) {
        spin_up = record[key]
        break
      }
    }
    // Extract spin-down channel
    for (const key of SPIN_DOWN_KEYS) {
      if (key in record) {
        spin_down = record[key]
        break
      }
    }

    // Fall back to first key if no spin-up key found
    if (spin_up === null) {
      const keys = Object.keys(record)
      if (keys.length > 0) spin_up = record[keys[0]]
    }

    if (spin_up === null) return null
    return { up: spin_up, down: spin_down }
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

  // Use pymatgen's branches if available - they correctly handle discontinuities
  // Otherwise, infer branches from discontinuities (robust fallback covering all qpoints)
  const pmg_branches = pmg.branches as types.Branch[] | undefined
  let branches: types.Branch[] = []

  if (Array.isArray(pmg_branches) && pmg_branches.length > 0) {
    // Validate and use pymatgen branches directly
    branches = pmg_branches.filter((br) =>
      typeof br.start_index === `number` &&
      typeof br.end_index === `number` &&
      br.start_index >= 0 &&
      br.end_index < qpoints.length &&
      br.start_index <= br.end_index
    )
  }

  // Fallback: infer branches from discontinuities when none provided or all invalid
  if (branches.length === 0) {
    console.info(
      `Band structure missing 'branches' field - inferring from path discontinuities`,
    )
    // Discontinuity indices mark points where the path jumps (disc before that index)
    // Create continuous segments between discontinuities
    const disc_indices = [...disc_set].sort((a, b) => a - b)
    // Segment boundaries: [0, first_disc), [first_disc, second_disc), ..., [last_disc, end]
    const segment_starts = [0, ...disc_indices]
    const segment_ends = [...disc_indices.map((idx) => idx - 1), qpoints.length - 1]

    branches = segment_starts
      .map((start, idx) => {
        const end = segment_ends[idx]
        const start_label = qpoints[start]?.label ?? `?`
        const end_label = qpoints[end]?.label ?? `?`
        return {
          start_index: start,
          end_index: end,
          name: `${start_label}-${end_label}`,
        }
      })
      .filter((br) => br.start_index <= br.end_index)
  }

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
  const spin_channels = extract_spin_channels<number[]>(dos_obj.densities)
  if (!spin_channels) return null

  const densities = spin_channels.up
  // Use extracted spin-down or fallback to explicit field (for already-normalized DosData)
  const spin_down_densities = spin_channels.down ??
    (dos_obj.spin_down_densities as number[] | undefined) ?? null

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
    // Detect spin-polarized from data if not explicitly set
    const is_spin_polarized = (spin_polarized as boolean | undefined) ??
      (spin_down_densities !== null && spin_down_densities.length === densities.length)
    return {
      type: `electronic`,
      energies,
      densities,
      spin_down_densities: is_spin_polarized
        ? spin_down_densities ?? undefined
        : undefined,
      spin_polarized: is_spin_polarized,
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
// Optionally wraps fractional coordinates to first BZ (default: true)
export function extract_k_path_points(
  band_struct: types.BaseBandStructure,
  recip_lattice_matrix: Matrix3x3,
  options: { wrap_to_bz?: boolean } = {},
): Vec3[] {
  const { wrap_to_bz = true } = options
  if (!band_struct?.qpoints || !recip_lattice_matrix) return []

  if (
    recip_lattice_matrix.length !== 3 ||
    recip_lattice_matrix.some((row) => row?.length !== 3)
  ) throw new Error(`reciprocal_lattice_matrix must be a 3×3 matrix`)

  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = recip_lattice_matrix

  return band_struct.qpoints.map((qpoint) => {
    let [x, y, z] = qpoint.frac_coords
    // Wrap to first BZ if enabled (handles [0,1] vs [-0.5,0.5] convention difference)
    if (wrap_to_bz) {
      x = centered_frac(x)
      y = centered_frac(y)
      z = centered_frac(z)
    }
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
      const dist_max = segment_distances.at(-1) ?? dist_min
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
      const [x_pos, idx] of [[x_start, start_idx], [x_end, end_idx]] as const
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

// Pymatgen Dos base class format
export interface PymatgenDos {
  '@class': string
  '@module': string
  energies: number[]
  densities: SpinDensities | number[]
  efermi: number
}

// Pymatgen CompleteDos format (includes projected DOS)
export interface PymatgenCompleteDos extends PymatgenDos {
  '@class': `CompleteDos` | `LobsterCompleteDos`
  structure?: Record<string, unknown>
  pdos?: Record<string, SpinDensities>[]
  atom_dos?: Record<string, PymatgenDos>
  spd_dos?: Record<string, PymatgenDos>
}

// Extract projected DOS from pymatgen CompleteDos format.
// Returns a dict of label → DosData for each atom or orbital.
// filter_keys: optional list of keys to include (e.g., ["Fe", "O"] for atoms or ["s", "p", "d"] for orbitals)
export function extract_pdos(
  dos: unknown,
  pdos_type: types.PdosType,
  filter_keys?: string[],
): Record<string, types.ElectronicDos> | null {
  if (!dos || typeof dos !== `object`) return null

  const dos_obj = dos as Record<string, unknown>

  // Get the appropriate projected DOS dict
  const pdos_dict = pdos_type === `atom`
    ? (dos_obj.atom_dos as Record<string, PymatgenDos> | undefined)
    : (dos_obj.spd_dos as Record<string, PymatgenDos> | undefined)

  if (!pdos_dict || typeof pdos_dict !== `object`) return null

  const result: Record<string, types.ElectronicDos> = {}

  for (const [key, nested_dos] of Object.entries(pdos_dict)) {
    // Apply filter if provided
    if (filter_keys && filter_keys.length > 0 && !filter_keys.includes(key)) continue

    if (!nested_dos || typeof nested_dos !== `object`) continue

    const energies = nested_dos.energies
    const spin_channels = extract_spin_channels<number[]>(nested_dos.densities)

    if (!Array.isArray(energies) || !spin_channels) continue

    const densities = spin_channels.up
    if (!Array.isArray(densities) || energies.length !== densities.length) continue

    const is_spin_polarized = spin_channels.down !== null &&
      spin_channels.down.length === densities.length

    result[key] = {
      type: `electronic`,
      energies,
      densities,
      spin_down_densities: is_spin_polarized
        ? spin_channels.down ?? undefined
        : undefined,
      spin_polarized: is_spin_polarized,
      efermi: nested_dos.efermi,
    }
  }

  return Object.keys(result).length > 0 ? result : null
}

// Shift a single DOS object's energies by the given amount
const shift_dos_energies = <T extends PymatgenDos>(dos: T, shift: number): T => ({
  ...dos,
  efermi: dos.efermi - shift,
  energies: dos.energies.map((energy) => energy - shift),
})

// Shift DOS energies relative to Fermi energy so E_F = 0
// Recursively shifts nested DOS in atom_dos and spd_dos for consistency
export function shift_to_fermi(dos: PymatgenCompleteDos): PymatgenCompleteDos {
  const shift = dos.efermi

  // Shift root DOS energies using the shared helper
  const shifted_root = shift_dos_energies(dos, shift)

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
    ...shifted_root,
    efermi: 0, // Explicitly set to 0 (shift_dos_energies would give efermi - shift)
    ...(atom_dos && { atom_dos }),
    ...(spd_dos && { spd_dos }),
  }
}

// Generate an SVG path for a fat band ribbon.
// Creates a closed polygon by tracing the upper edge (y - half_width) forward,
// then tracing the lower edge (y + half_width) backward.
// Non-finite or non-positive widths are clamped to 0.
export function generate_ribbon_path(
  x_values: number[],
  y_values: number[],
  width_values: number[],
  x_scale_fn: (x: number) => number,
  y_scale_fn: (y: number) => number,
  max_width_px: number,
  scale: number = 1,
): string {
  const len = x_values.length
  if (len < 2 || len !== y_values.length || len !== width_values.length) return ``

  // Normalize width values to [0, 1] range based on the max positive finite value
  const finite_positive_widths = width_values.filter(
    (width) => Number.isFinite(width) && width > 0,
  )
  if (finite_positive_widths.length === 0) return ``
  const max_width_val = Math.max(...finite_positive_widths)

  // Build upper edge path (forward direction)
  const upper_points: string[] = []
  const lower_points: string[] = []

  for (let idx = 0; idx < x_values.length; idx++) {
    const x_px = x_scale_fn(x_values[idx])
    const y_data = y_values[idx]
    const raw_width = width_values[idx] ?? 0
    const width_normalized = Number.isFinite(raw_width) && raw_width > 0
      ? raw_width / max_width_val
      : 0
    const half_width_px = width_normalized * max_width_px * scale

    // In SVG, y increases downward, so upper edge has smaller y value
    const y_upper_px = y_scale_fn(y_data) - half_width_px
    const y_lower_px = y_scale_fn(y_data) + half_width_px

    upper_points.push(`${x_px.toFixed(2)},${y_upper_px.toFixed(2)}`)
    lower_points.push(`${x_px.toFixed(2)},${y_lower_px.toFixed(2)}`)
  }

  // Combine: upper edge forward, lower edge backward, close path
  const path_parts = [
    `M${upper_points[0]}`,
    ...upper_points.slice(1).map((pt) => `L${pt}`),
    ...lower_points.reverse().map((pt) => `L${pt}`),
    `Z`,
  ]

  return path_parts.join(` `)
}

// Extract efermi from a data source (band structure or DOS).
// Handles both single objects with an efermi field and dicts of objects.
// Returns undefined if no valid efermi is found or if the source is empty.
export function extract_efermi(data: unknown): number | undefined {
  if (!data || typeof data !== `object`) return undefined

  const obj = data as Record<string, unknown>

  // Direct efermi field on the object
  if (`efermi` in obj && typeof obj.efermi === `number`) return obj.efermi

  // Dict of objects - try to get efermi from first value
  const values = Object.values(obj)
  if (values.length === 0) return undefined

  const first_val = values[0]
  if (first_val && typeof first_val === `object`) {
    const efermi = (first_val as Record<string, unknown>).efermi
    if (typeof efermi === `number`) return efermi
  }

  return undefined
}

// Calculate fraction of |values| that are negative. Used to detect imaginary phonon modes.
export function negative_fraction(values: number[]): number {
  let [neg, total] = [0, 0]
  for (const val of values) {
    if (!Number.isFinite(val)) continue
    const abs_val = Math.abs(val)
    total += abs_val
    if (val < 0) neg += abs_val
  }
  return total > 0 ? neg / total : 0
}

// Check if raw band structure input has electronic markers (efermi, kpoints, or electronic @class).
// Must be called on raw input before normalization since these fields aren't preserved.
function is_electronic_band_struct(bs: unknown): boolean {
  if (!bs || typeof bs !== `object`) return false
  const obj = bs as Record<string, unknown>
  // Electronic band structures have efermi field
  if (`efermi` in obj && typeof obj.efermi === `number`) return true
  // Pymatgen electronic format uses kpoints (not qpoints)
  if (`kpoints` in obj && Array.isArray(obj.kpoints) && obj.kpoints.length > 0) {
    return true
  }
  // Pymatgen @class: BandStructure* but not Phonon*
  const class_name = String(obj[`@class`] ?? ``)
  if (class_name.startsWith(`BandStructure`) && !class_name.includes(`Phonon`)) {
    return true
  }
  return false
}

// Compute frequency/energy range from bands and DOS. Clamps phonon min to 0 if noise < 0.5%.
export function compute_frequency_range(
  band_structs: unknown,
  doses: unknown,
  padding_factor = 0.02,
): [number, number] | undefined {
  let [min_val, max_val, is_phonon] = [Infinity, -Infinity, false]
  const all_freqs: number[] = []

  // Check raw band_structs for electronic markers before normalization
  // (normalized structures always have qpoints, so we can't detect from them)
  let has_electronic_bs = false
  // Support both qpoints (phonon) and kpoints (electronic) to detect single vs dict
  const is_single_bs = band_structs && typeof band_structs === `object` &&
    (`qpoints` in band_structs || `kpoints` in band_structs)
  if (band_structs && typeof band_structs === `object`) {
    // Single structure check
    if (is_electronic_band_struct(band_structs)) {
      has_electronic_bs = true
    } else if (!is_single_bs) {
      // Dict of band structures - check each value
      for (const bs_val of Object.values(band_structs)) {
        if (is_electronic_band_struct(bs_val)) {
          has_electronic_bs = true
          break
        }
      }
    }
  }

  const bs_list = band_structs
    ? is_single_bs
      ? [normalize_band_structure(band_structs)]
      : Object.values(band_structs as object).map(normalize_band_structure)
    : []

  // If band structures exist and aren't electronic, mark as phonon
  const has_band_structs = bs_list.some(Boolean)
  if (has_band_structs && !has_electronic_bs) is_phonon = true

  for (const bs of bs_list) {
    if (!bs) continue
    for (const band of bs.bands) {
      for (const val of band) {
        if (!Number.isFinite(val)) continue
        all_freqs.push(val)
        min_val = Math.min(min_val, val)
        max_val = Math.max(max_val, val)
      }
    }
  }

  const dos_list = doses
    ? `densities` in (doses as object)
      ? [normalize_dos(doses)]
      : Object.values(doses as object).map((dos) => normalize_dos(dos))
    : []
  for (const dos of dos_list) {
    if (!dos) continue
    // DOS type detection: explicit type field is authoritative
    if (dos.type === `phonon`) is_phonon = true
    if (dos.type === `electronic`) is_phonon = false
    for (const val of dos.type === `phonon` ? dos.frequencies : dos.energies) {
      if (!Number.isFinite(val)) continue
      all_freqs.push(val)
      min_val = Math.min(min_val, val)
      max_val = Math.max(max_val, val)
    }
  }

  if (!Number.isFinite(min_val) || !Number.isFinite(max_val)) return undefined
  const clamp_min = is_phonon && min_val < 0 && // clamp phonon noise to 0
    negative_fraction(all_freqs) < IMAGINARY_MODE_NOISE_THRESHOLD
  if (clamp_min) min_val = 0
  // Calculate padding from (possibly clamped) range for consistency with Bands.svelte
  const padding = (max_val - min_val) * padding_factor
  return [min_val === 0 ? 0 : min_val - padding, max_val + padding]
}

// Parse axis label: "Frequency (THz)" → { name: "Frequency", unit: "THz" }
function parse_axis_label(label: string): { name: string; unit?: string } {
  const match = label.match(/^(.+?)\s*\(([^)]+)\)$/)
  return match ? { name: match[1], unit: match[2] } : { name: label }
}

// Format DOS tooltip content from axis labels and values
export function format_dos_tooltip(
  x_formatted: string,
  y_formatted: string,
  label: string | null,
  is_horizontal: boolean,
  is_phonon: boolean,
  units: types.FrequencyUnit,
  x_axis_label: string,
  y_axis_label: string,
  num_series: number,
): { title?: string; lines: string[] } {
  const x_parsed = parse_axis_label(x_axis_label)
  const y_parsed = parse_axis_label(y_axis_label)
  const freq_defaults = {
    name: is_phonon ? `Frequency` : `Energy`,
    unit: is_phonon ? units : `eV`,
  }

  const format_line = (name: string, value: string, unit?: string) =>
    `${name}: ${value}${unit ? ` ${unit}` : ``}`

  const lines = is_horizontal
    ? [
      format_line(
        y_parsed.name || freq_defaults.name,
        y_formatted,
        y_parsed.unit || freq_defaults.unit,
      ),
      format_line(x_parsed.name || `Density`, x_formatted),
    ]
    : [
      format_line(y_parsed.name || `Density`, y_formatted),
      format_line(
        x_parsed.name || freq_defaults.name,
        x_formatted,
        x_parsed.unit || freq_defaults.unit,
      ),
    ]

  return { title: num_series > 1 && label ? label : undefined, lines }
}

// Spin mode options for DOS visualization
export const SPIN_MODES = [
  { value: `mirror`, label: `↕`, title: `Mirror: spin-up above, spin-down below zero` },
  { value: `overlay`, label: `≡`, title: `Overlay: both spins on same axis` },
  { value: `up_only`, label: `↑`, title: `Show spin-up only` },
  { value: `down_only`, label: `↓`, title: `Show spin-down only` },
] as const satisfies readonly { value: types.SpinMode; label: string; title: string }[]

// Normalization mode options
export const NORMALIZATION_MODES = [
  { value: null, label: `None` },
  { value: `max`, label: `Max=1` },
  { value: `sum`, label: `Sum=1` },
  { value: `integral`, label: `∫=1` },
] as const satisfies readonly { value: types.NormalizationMode; label: string }[]

// Available frequency units for phonon DOS
export const FREQUENCY_UNITS: types.FrequencyUnit[] = [`THz`, `eV`, `meV`, `cm-1`, `Ha`]

// Default values for DOS controls
export const DEFAULT_SPIN_MODE: types.SpinMode = `mirror`
export const DEFAULT_SIGMA = 0
export const DEFAULT_NORMALIZE: types.NormalizationMode = null
export const DEFAULT_UNITS: types.FrequencyUnit = `THz`

// Format sigma with adaptive precision: 0→"0", <0.01→exp, <1→3dp, else→2dp
export function format_sigma(val: number): string {
  if (val === 0) return `0`
  if (val < 0.01) return val.toExponential(1)
  return val.toFixed(val < 1 ? 3 : 2)
}

// Validate sigma_range: ensures min < max, returns [0, 1] if invalid
export function validate_sigma_range([min, max]: [number, number]): [number, number] {
  return Number.isFinite(min) && Number.isFinite(max) && min < max ? [min, max] : [0, 1]
}

// Calculate slider step: 1/100th of range, or 0.01 fallback
export function calculate_sigma_step(range: [number, number]): number {
  const [min, max] = validate_sigma_range(range)
  return (max - min) / 100 || 0.01
}
