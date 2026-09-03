// Helper utilities for band structure and DOS data processing
import { SUBSCRIPT_MAP } from '$lib/labels'
import { is_plain_object } from '$lib/utils'
import {
  array_extent,
  array_max,
  euclidean_dist,
  mat3x3_vec3_multiply,
  subtract,
  transpose_3x3_matrix,
} from '$lib/math'
import type { Matrix3x3, Vec2, Vec3 } from '$lib/math'
import type { FrequencyUnit } from './frequency-units'
import { frequency_unit_per_thz, parse_frequency_unit } from './frequency-units'
import type * as types from './types'

const is_subscript_key = (key: string): key is keyof typeof SUBSCRIPT_MAP =>
  key in SUBSCRIPT_MAP

// Fractional reciprocal coordinates are equivalent when they differ by a lattice vector.
export const are_qpoints_equivalent = (first: Vec3, second: Vec3, tolerance = 1e-6): boolean =>
  first.every((coordinate, axis) => {
    const delta = coordinate - second[axis]
    return Math.abs(delta - Math.round(delta)) < tolerance
  })

export const phonon_explorer_views = (
  data: types.PhononModeData,
  spectrum?: types.VibrationalSpectrum,
): types.PhononExplorerView[] => [
  ...(data.path_segments.length ? ([`bands`] as const) : []),
  ...(spectrum ? ([`ir`] as const) : []),
  ...(spectrum?.has_raman ? ([`raman`] as const) : []),
  `modes`,
]

// Band structure constants
export const IMAGINARY_MODE_NOISE_THRESHOLD = 0.005 // Clamp negatives < 0.5% as noise

// Pretty-print a symmetry point symbol: Greek names (plain GAMMA or LaTeX \Gamma) become
// Greek letters and trailing digits become subscripts (S_0 and S0 both give S₀)
export function pretty_sym_point(symbol: string): string {
  if (!symbol) return ``
  return symbol
    .replaceAll('_', ``)
    .replaceAll(/\\?GAMMA/gi, `Γ`)
    .replaceAll(/\\?DELTA/gi, `Δ`)
    .replaceAll(/\\?SIGMA/gi, `Σ`)
    .replaceAll(/\\?LAMBDA/gi, `Λ`)
    .replaceAll(
      /(?<letter>\p{L})(?<num>\d+)/gu,
      (_, letter, num) =>
        letter +
        num
          .split(``)
          .map((digit: string) => (is_subscript_key(digit) ? SUBSCRIPT_MAP[digit] : digit))
          .join(``),
    )
}

// One key per branch, aligned with `bs.branches`. Labels identify the same path across
// structures; a repeated labeled pair gets `#n` and unlabeled branches are keyed by
// position, so producer-specific branch names never matter.
export function branch_segment_keys(band_struct: types.BaseBandStructure): string[] {
  const seen = new Map<string, number>()
  return band_struct.branches.map((branch, branch_idx) => {
    const start_label = band_struct.qpoints[branch.start_index]?.label
    const end_label = band_struct.qpoints[branch.end_index]?.label
    if (!start_label && !end_label) return `branch:${branch_idx}`
    const key = `${start_label ?? `null`}_${end_label ?? `null`}`
    const occurrence = (seen.get(key) ?? 0) + 1
    seen.set(key, occurrence)
    return occurrence === 1 ? key : `${key}#${occurrence}`
  })
}

export const is_discontinuity_branch = (branch: types.Branch): boolean =>
  branch.is_discontinuity ?? branch.end_index - branch.start_index === 1

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

// array_max, not Math.max(...densities): DOS grids reach 1e7 points, past the argument limit
export function normalize_densities(
  densities: number[],
  freqs_or_energies: number[],
  mode: types.NormalizationMode,
): number[] {
  let divisor = 0
  if (mode === `max`) divisor = array_max(densities)
  else if (mode === `sum`) divisor = densities.reduce((acc, dens) => acc + dens, 0)
  else if (mode === `integral` && freqs_or_energies.length >= 2) {
    // trapezoid, not a left-Riemann sum off x[1] - x[0]: the latter assumed a uniform grid
    // and dropped half an endpoint bin
    const weights = trapezoid_weights(freqs_or_energies)
    divisor = densities.reduce((acc, dens, idx) => acc + dens * weights[idx], 0)
  }
  return divisor === 0 ? densities : densities.map((dens) => dens / divisor)
}

// Trapezoid quadrature weights for an arbitrary 1D grid: each point covers half the gap to
// each neighbour. Read off the SORTED grid so a descending DOS grid gets the same measure.
export function trapezoid_weights(grid: readonly number[]): number[] {
  const last = grid.length - 1
  const weights = Array(grid.length).fill(0)
  if (last < 1) return weights
  const order = grid.map((_, idx) => idx).toSorted((a_idx, b_idx) => grid[a_idx] - grid[b_idx])
  for (const [pos, idx] of order.entries()) {
    const lo = grid[order[Math.max(pos - 1, 0)]]
    weights[idx] = (grid[order[Math.min(pos + 1, last)]] - lo) / 2
  }
  return weights
}

// One ±4σ-windowed Gaussian pass (contribution < 0.01% beyond). On an ascending grid the
// window only moves forward, so two pointers bound the inner loop at O(n·w) not O(n²).
// `measure` non-null gives the convolution ∫y(x')K(x−x')dx'; null the local average Σwy/Σw.
function gaussian_pass(
  grid: readonly number[],
  values: readonly number[],
  sigma: number,
  measure: readonly number[] | null,
): number[] {
  const n_pts = grid.length
  const out = Array(values.length).fill(0)
  const cutoff = 4 * sigma
  const inv_two_sigma_sq = 1 / (2 * sigma ** 2)
  // a normalized Gaussian integrates to 1, so the convolution preserves ∫y dx on its own
  const prefactor = measure ? 1 / (sigma * Math.sqrt(2 * Math.PI)) : 1
  const ascending = grid.every((value, idx) => idx === 0 || value >= grid[idx - 1])

  let window_start = 0
  let window_end = 0
  for (let idx = 0; idx < n_pts; idx++) {
    const center = grid[idx]
    if (ascending) {
      while (window_start < n_pts && center - grid[window_start] > cutoff) window_start++
      while (window_end < n_pts && grid[window_end] - center <= cutoff) window_end++
    } else window_end = n_pts

    let sum = 0
    let kernel_sum = 0
    for (let jdx = window_start; jdx < window_end; jdx++) {
      const delta = center - grid[jdx]
      // Exact bounds on ascending grids; the fallback range is the whole array
      if (Math.abs(delta) > cutoff) continue
      const kernel = Math.exp(-(delta ** 2) * inv_two_sigma_sq)
      sum += values[jdx] * (measure ? measure[jdx] : 1) * kernel
      kernel_sum += kernel
    }
    // jdx = idx is always inside its own window, so kernel_sum ≥ 1
    out[idx] = measure ? sum * prefactor : sum / kernel_sum
  }
  return out
}

// Gaussian smearing of DOS densities: the convolution ∫ g(E')·K(E − E') dE' over trapezoid
// weights. Summing g(E')·K with no measure weights by POINT DENSITY instead, swinging a flat
// DOS over 0.235-1.950 on a clustered grid. Mass leaks out at the grid ends, as the continuum
// convolution does.
export function apply_gaussian_smearing(
  freqs_or_energies: number[],
  densities: number[],
  sigma: number,
): number[] {
  if (sigma <= 0) return densities
  const weights = trapezoid_weights(freqs_or_energies)
  // A grid with no extent (one point, or all-identical values) carries no trapezoid measure,
  // so the convolution would return all zeros instead of leaving the input alone
  if (weights.every((weight) => weight === 0)) return densities
  return gaussian_pass(freqs_or_energies, densities, sigma, weights)
}

// Nadaraya-Watson Gaussian smoother Σ w·y / Σ w for a scattered (x, y) series. Unlike the DOS
// convolution above it estimates a FUNCTION, not a density: exact on constants, no end droop.
export const gaussian_kernel_smooth = (
  x_values: number[],
  y_values: number[],
  sigma: number,
): number[] => (sigma <= 0 ? y_values : gaussian_pass(x_values, y_values, sigma, null))

// Type guards for pymatgen qpoint formats
const is_vec3 = (val: unknown): val is Vec3 =>
  Array.isArray(val) && val.length >= 3 && val.slice(0, 3).every(Number.isFinite)

interface PymatgenKpoint {
  frac_coords: Vec3
  label?: string | null
}
const is_kpoint = (val: unknown): val is PymatgenKpoint =>
  val !== null && typeof val === `object` && `frac_coords` in val && is_vec3(val.frac_coords)

const is_pymatgen_format = (obj: Record<string, unknown>): boolean => {
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

// Extract frac_coords/label from pymatgen qpoint, matching label from labels_dict if needed.
// `label_entries` is Object.entries(labels_dict), hoisted by the caller since it is the same
// for every qpoint.
const parse_qpoint = (qpt: unknown, label_entries: [string, Vec3][]): types.QPoint | null => {
  const frac_coords = is_vec3(qpt)
    ? ([qpt[0], qpt[1], qpt[2]] as Vec3)
    : is_kpoint(qpt)
      ? qpt.frac_coords
      : null
  if (!frac_coords) return null

  const label =
    ((is_kpoint(qpt) && typeof qpt.label === `string` && qpt.label) ||
      label_entries.find(([, c]) => euclidean_dist(frac_coords, c) < 1e-4)?.[0]) ??
    null
  return { label, frac_coords }
}

// Extract both spin channels from pymatgen spin-keyed data.
// Returns { up: T, down: T | null } where down is null for non-spin-polarized data.
export function extract_spin_channels<T>(data: unknown): { up: T; down: T | null } | null {
  if (Array.isArray(data)) return { up: data as T, down: null }
  if (!data || typeof data !== `object`) return null

  const record = data as Record<string, T>
  // pymatgen spin keys: `1`/`Spin.up`, `-1`/`Spin.down`
  const up_key = [`1`, `Spin.up`].find((key) => key in record)
  const down_key = [`-1`, `Spin.down`].find((key) => key in record)
  // No spin-up key: do not fall back to Object.keys()[0] (could be spin-down)
  if (up_key === undefined) return null
  return { up: record[up_key], down: down_key !== undefined ? record[down_key] : null }
}

const is_matrix3x3 = (val: unknown): val is Matrix3x3 =>
  Array.isArray(val) &&
  val.length === 3 &&
  val.every((row) => is_vec3(row) && row.length === 3)

// pymatgen's `as_dict()` stores the reciprocal lattice as `lattice_rec` in the physics
// convention (2π included), the phonon JSON dumped by phonopy/atomate2-style workflows as
// `recip_lattice` in phonopy's crystallographic convention (no 2π). Both are producer formats,
// so both are read, and the latter is scaled so the returned matrix always includes 2π. A band
// structure that is recognisably pymatgen-shaped but lacks either cannot measure its k-path:
// unlike an unrecognised shape (null) this is a named, fixable defect in the input, so it
// throws and Bands shows the message in place of the generic empty state.
const read_recip_lattice = (pmg: Record<string, unknown>): Matrix3x3 => {
  const scale = is_plain_object(pmg.lattice_rec) ? 1 : 2 * Math.PI
  const lattice = [pmg.lattice_rec, pmg.recip_lattice].find(is_plain_object)
  const matrix = lattice?.matrix
  if (is_matrix3x3(matrix)) {
    return matrix.map((row) => row.map((val) => val * scale)) as Matrix3x3
  }
  throw new Error(
    `pymatgen band structure needs a finite 3x3 reciprocal lattice under 'lattice_rec.matrix' (or 'recip_lattice.matrix') to measure k-path distances; got keys [${Object.keys(pmg).join(`, `)}]`,
  )
}

// Convert pymatgen PhononBandStructureSymmLine or BandStructure to matterviz format.
// `PhononBandStructure` only adds the optional `has_nac`/`has_imaginary_modes` flags to
// `BaseBandStructure`; electronic input simply leaves them unset.
function convert_pymatgen_band_structure(
  pmg: Record<string, unknown>,
): types.PhononBandStructure | null {
  // Support both qpoints (phonon) and kpoints (electronic)
  const raw_qpts = (pmg.qpoints ?? pmg.kpoints) as unknown[] | undefined

  // Handle bands in multiple formats:
  // 1. Standard pymatgen: bands as dict with spin keys {1: [[...], ...]}
  // 2. Custom phonon format: frequencies_cm as 2D array [[...], ...]
  // 3. Already normalized: bands as 2D array [[...], ...]
  const spin_channels = extract_spin_channels<number[][]>(pmg.bands)
  let raw_bands = spin_channels?.up ?? null
  let raw_spin_down_bands = spin_channels?.down ?? null
  const has_frequencies_cm = Array.isArray(pmg.frequencies_cm)
  if (!raw_bands && has_frequencies_cm) {
    // Phonon format: frequencies_cm is [n_qpoints x n_branches] - needs transpose
    const freqs = pmg.frequencies_cm as number[][]
    if (freqs.length > 0 && Array.isArray(freqs[0])) {
      raw_bands = Array.from({ length: freqs[0].length }, (_, band_idx) =>
        freqs.map((qpt_freqs) => qpt_freqs[band_idx]),
      )
      raw_spin_down_bands = null
    }
  }

  const labels_dict = pmg.labels_dict as Record<string, Vec3> | undefined
  // Bands are stored in THz. Electronic pymatgen objects carry no `unit`, so their eV values
  // pass through untouched; an unrecognised declared unit is a malformed input, not THz.
  // `unit: null` counts as undeclared, as it does for normalize_dos.
  const source_unit =
    pmg.unit == null ? (has_frequencies_cm ? `cm^-1` : `THz`) : parse_frequency_unit(pmg.unit)
  if (!source_unit) return null

  if (
    !Array.isArray(raw_qpts) ||
    !Array.isArray(raw_bands) ||
    raw_qpts.length === 0 ||
    raw_bands.length === 0
  )
    return null

  const label_entries = Object.entries(labels_dict ?? {})
  const qpoints = raw_qpts
    .map((qpoint) => parse_qpoint(qpoint, label_entries))
    .filter((qpoint): qpoint is types.QPoint => qpoint !== null)
  if (qpoints.length === 0) return null

  // Step lengths are Cartesian reciprocal-space distances |Mᵀ·Δq| (like pymatgen/phonopy);
  // a fractional metric would distort every non-cubic path. Transpose once, not per step.
  const recip_lattice = read_recip_lattice(pmg)
  const recip_T = transpose_3x3_matrix(recip_lattice)
  const steps = qpoints
    .slice(1)
    .map((qpoint, idx) =>
      Math.hypot(
        ...mat3x3_vec3_multiply(
          recip_T,
          subtract(qpoint.frac_coords, qpoints[idx].frac_coords),
        ),
      ),
    )
  // Discontinuity detection (5x median step)
  const sorted = steps.toSorted((a, b) => a - b)
  const threshold = (sorted[Math.floor(sorted.length / 2)] ?? 0) * 5
  // Ascending indices of the q-points that start a new segment after a path jump
  const disc_indices = steps.flatMap((step, idx) => (step > threshold ? [idx + 1] : []))
  const disc_set = new Set(disc_indices)

  // Cumulative distance, not advanced across discontinuities
  const distance = [0]
  for (const [idx, step] of steps.entries()) {
    distance.push(disc_set.has(idx + 1) ? distance[idx] : distance[idx] + step)
  }

  // Use pymatgen's branches if valid; otherwise infer them from the path itself
  const pmg_branches = pmg.branches as types.Branch[] | undefined
  let branches = (Array.isArray(pmg_branches) ? pmg_branches : []).filter(
    (branch) =>
      typeof branch.start_index === `number` &&
      typeof branch.end_index === `number` &&
      branch.start_index >= 0 &&
      branch.end_index < qpoints.length &&
      branch.start_index <= branch.end_index,
  )
  // No valid branches is the normal case, not a degraded one: pymatgen's phonon band
  // structures never serialise `branches` (only the electronic one does), so infer them.
  if (branches.length === 0) {
    // Branch boundaries are the path ends, every labeled q-point (Bands only draws tick labels
    // at branch ends, so a label mid-branch would vanish) and both sides of every jump. The
    // jump itself (the two-point span ending on a discontinuity index) is not a branch.
    const boundaries = [
      ...new Set([
        0,
        ...qpoints.flatMap((qpoint, idx) => (qpoint.label ? [idx] : [])),
        ...disc_indices.flatMap((idx) => [idx - 1, idx]),
        qpoints.length - 1,
      ]),
    ].toSorted((a, b) => a - b)
    branches = boundaries.slice(1).flatMap((end_index, idx) => {
      const start_index = boundaries[idx]
      if (disc_set.has(end_index)) return []
      const start_label = qpoints[start_index].label ?? `?`
      const end_label = qpoints[end_index].label ?? `?`
      return [{ start_index, end_index, name: `${start_label}-${end_label}` }]
    })
  }

  const thz_per_source_unit = 1 / frequency_unit_per_thz(source_unit)
  const to_thz = (band: number[]): number[] =>
    thz_per_source_unit === 1 ? band : band.map((val) => val * thz_per_source_unit)

  const valid_spin_down_bands =
    Array.isArray(raw_spin_down_bands) &&
    raw_spin_down_bands.length === raw_bands.length &&
    raw_spin_down_bands.every(
      (band, band_idx) => Array.isArray(band) && band.length === raw_bands[band_idx]?.length,
    )
      ? raw_spin_down_bands
      : null

  return {
    qpoints,
    recip_lattice,
    branches,
    distance,
    bands: raw_bands.map(to_thz),
    spin_down_bands: valid_spin_down_bands?.map(to_thz),
    nb_bands: raw_bands.length,
    labels_dict: labels_dict ?? {},
    ...(typeof pmg.has_nac === `boolean` && { has_nac: pmg.has_nac }),
    ...(typeof pmg.has_imaginary_modes === `boolean` && {
      has_imaginary_modes: pmg.has_imaginary_modes,
    }),
  }
}

// Returns null for shapes that are not a band structure at all. A pymatgen-shaped input that
// lacks its reciprocal lattice throws an Error naming the missing key (see read_recip_lattice).
export function normalize_band_structure(
  band_struct: unknown,
): types.BaseBandStructure | null {
  if (!is_plain_object(band_struct)) return null

  // Check if this is pymatgen format and convert if so
  if (is_pymatgen_format(band_struct)) {
    return convert_pymatgen_band_structure(band_struct)
  }

  const { qpoints, branches, bands, distance } =
    band_struct as Partial<types.BaseBandStructure>
  if (
    !Array.isArray(qpoints) ||
    !Array.isArray(branches) ||
    !Array.isArray(bands) ||
    !Array.isArray(distance)
  )
    return null

  const n_qpts = qpoints.length
  if (
    n_qpts === 0 ||
    bands.length === 0 ||
    distance.length !== n_qpts ||
    bands.some((band) => !Array.isArray(band) || band.length !== n_qpts) ||
    branches.some(
      (branch) =>
        typeof branch.start_index !== `number` ||
        typeof branch.end_index !== `number` ||
        branch.start_index < 0 ||
        branch.end_index >= n_qpts ||
        branch.start_index > branch.end_index,
    )
  )
    return null

  // Fill the defaults (labels_dict/nb_bands) not covered above so the cast below is sound
  return {
    ...band_struct,
    nb_bands: typeof band_struct.nb_bands === `number` ? band_struct.nb_bands : bands.length,
    labels_dict: band_struct.labels_dict ?? {},
  } as unknown as types.BaseBandStructure
}

// Electronic DOS record. Spin-polarized when the input says so, else when a same-length
// spin-down channel exists; the spin-down channel is only kept for spin-polarized data.
const electronic_dos = (
  energies: number[],
  densities: number[],
  spin_down: number[] | null,
  { spin_polarized, efermi }: { spin_polarized?: boolean; efermi?: number } = {},
): types.ElectronicDos => {
  const is_spin_polarized =
    spin_polarized ?? (spin_down !== null && spin_down.length === densities.length)
  return {
    type: `electronic`,
    energies,
    densities,
    spin_down_densities: is_spin_polarized ? (spin_down ?? undefined) : undefined,
    spin_polarized: is_spin_polarized,
    ...(efermi !== undefined && { efermi }),
  }
}

// Validate and normalize a DOS object. Phonon frequencies are normalized to THz so
// Dos.svelte can safely treat its default axis unit as THz.
export function normalize_dos(dos: unknown): types.DosData | null {
  if (!is_plain_object(dos)) return null

  const is_pymatgen = typeof dos[`@class`] === `string` || typeof dos[`@module`] === `string`

  const { frequencies, energies, spin_polarized } = dos

  // Handle densities as either array or dict with spin keys (pymatgen format)
  // Pymatgen stores densities as {1: [...], -1: [...]} or {"Spin.up": [...], ...}
  const spin_channels = extract_spin_channels<number[]>(dos.densities)
  if (!spin_channels) return null

  const densities = spin_channels.up
  // Use extracted spin-down or fallback to explicit field (for already-normalized DosData)
  const spin_down_densities =
    spin_channels.down ?? (dos.spin_down_densities as number[] | undefined) ?? null

  if (!Array.isArray(densities)) return null

  // Phonon DOS: has frequencies
  if (Array.isArray(frequencies)) {
    if (frequencies.length !== densities.length) return null
    const declared_unit = dos.frequency_unit ?? dos.unit
    const source_unit = declared_unit == null ? `THz` : parse_frequency_unit(declared_unit)
    if (!source_unit) return null
    const numeric_frequencies = frequencies as number[]
    const source_unit_per_thz = frequency_unit_per_thz(source_unit)
    const normalized_frequencies =
      source_unit === `THz`
        ? numeric_frequencies
        : numeric_frequencies.map((frequency) => frequency / source_unit_per_thz)
    return { type: `phonon`, frequencies: normalized_frequencies, densities }
  }

  // Electronic DOS: has energies
  if (Array.isArray(energies)) {
    if (energies.length !== densities.length) return null
    return electronic_dos(energies, densities, spin_down_densities, {
      spin_polarized: spin_polarized as boolean | undefined,
    })
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

// Fractional k-point -> Cartesian reciprocal coordinates (the lattice should carry the 2π
// factor to match the rendered BZ), by default folded into the first (Wigner-Seitz) BZ so
// the point lands inside the rendered zone. Folding in Cartesian space (vs per-axis on the
// fractional coords, which only yields the parallelepiped cell) handles non-orthogonal
// lattices and preserves path continuity: points already inside the zone are left untouched.
export function frac_k_to_cartesian(
  frac_coords: Vec3,
  recip_lattice_matrix: Matrix3x3,
  wrap_to_bz = true,
): Vec3 {
  // k = Σ f_i b_i, i.e. Bᵀ·f with the b_i as rows of B
  const cart = mat3x3_vec3_multiply(transpose_3x3_matrix(recip_lattice_matrix), frac_coords)
  return wrap_to_bz ? fold_to_first_bz(cart, recip_lattice_matrix) : cart
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
  )
    throw new Error(`reciprocal_lattice_matrix must be a 3×3 matrix`)

  return band_struct.qpoints.map((qpoint) =>
    frac_k_to_cartesian(qpoint.frac_coords, recip_lattice_matrix, wrap_to_bz),
  )
}

// Labeled k-path points for BrillouinZone's `k_path_labels`, aligned with extract_k_path_points
export const k_path_labels = (
  band_struct: types.BaseBandStructure,
  k_path_points: Vec3[],
): { position: Vec3; label: string | null }[] =>
  k_path_points.map((position, idx) => {
    const label = band_struct.qpoints[idx]?.label
    return { position, label: label ? pretty_sym_point(label) : null }
  })

// Fold a Cartesian reciprocal-space point into the first (Wigner-Seitz) Brillouin zone
// by choosing the periodic image with the smallest norm (minimum-image convention).
// The ±1 search (27 images) suffices for typical reciprocal lattices; extremely skewed
// cells could in principle need a wider search.
function fold_to_first_bz(cart: Vec3, recip: Matrix3x3): Vec3 {
  let best = cart
  let best_norm = cart[0] ** 2 + cart[1] ** 2 + cart[2] ** 2
  for (let n1 = -1; n1 <= 1; n1++) {
    for (let n2 = -1; n2 <= 1; n2++) {
      for (let n3 = -1; n3 <= 1; n3++) {
        if (n1 === 0 && n2 === 0 && n3 === 0) continue
        const cand: Vec3 = [
          cart[0] + n1 * recip[0][0] + n2 * recip[1][0] + n3 * recip[2][0],
          cart[1] + n1 * recip[0][1] + n2 * recip[1][1] + n3 * recip[2][1],
          cart[2] + n1 * recip[0][2] + n2 * recip[1][2] + n3 * recip[2][2],
        ]
        const norm = cand[0] ** 2 + cand[1] ** 2 + cand[2] ** 2
        if (norm < best_norm - 1e-9) [best, best_norm] = [cand, norm]
      }
    }
  }
  return best
}

// Branches that have a plot x-range, paired with it (Bands.svelte's x_positions output)
const plotted_branches = (
  band_struct: types.BaseBandStructure,
  x_positions: Record<string, Vec2>,
): [types.Branch, Vec2][] => {
  const segment_keys = branch_segment_keys(band_struct)
  return band_struct.branches.flatMap((branch, branch_idx) => {
    const range = x_positions[segment_keys[branch_idx]]
    return range ? [[branch, range] as [types.Branch, Vec2]] : []
  })
}

// Rescaled x-position of a q-point index along the band plot path. Inverse of
// find_qpoint_at_rescaled_x, used to highlight a q-point hovered in the Brillouin zone.
// Returns null if the index doesn't fall on a plotted (non-discontinuity) branch.
export function qpoint_x_position(
  band_struct: types.BaseBandStructure,
  qpoint_index: number,
  x_positions: Record<string, Vec2>,
): number | null {
  if (!band_struct?.branches?.length || !x_positions) return null
  for (const [branch, [x_start, x_end]] of plotted_branches(band_struct, x_positions)) {
    if (qpoint_index < branch.start_index || qpoint_index > branch.end_index) continue
    const d_start = band_struct.distance[branch.start_index]
    const d_end = band_struct.distance[branch.end_index]
    if (d_end === d_start) return x_start // discontinuity / zero-length segment
    const ratio = (band_struct.distance[qpoint_index] - d_start) / (d_end - d_start)
    return x_start + ratio * (x_end - x_start)
  }
  return null
}

// Find q-point index from rescaled x-coordinate (used in band structure plots)
// This handles the case where the plot uses custom x-axis scaling per segment
export function find_qpoint_at_rescaled_x(
  band_struct: types.BaseBandStructure,
  rescaled_x: number,
  x_positions: Record<string, Vec2>,
): number | null {
  if (!band_struct?.branches?.length || !x_positions) return null
  const branches = plotted_branches(band_struct, x_positions)

  // Find which segment contains this x coordinate
  for (const [{ start_index: start_idx, end_index: end_idx }, [x_start, x_end]] of branches) {
    // Discontinuity (zero-length segment): match only if x is exactly at this point
    if (Math.abs(x_end - x_start) < 1e-6) {
      if (Math.abs(rescaled_x - x_start) < 1e-6) return start_idx
      continue
    }
    // Check if x is within this segment (with small tolerance for edges)
    if (rescaled_x >= x_start - 1e-6 && rescaled_x <= x_end + 1e-6) {
      // Map from rescaled x back to original distance
      const dist_min = band_struct.distance[start_idx]
      const dist_range = band_struct.distance[end_idx] - dist_min
      if (dist_range === 0) return start_idx
      // Inverse of the scaling: x = x_start + ((dist - dist_min) / dist_range) * (x_end - x_start)
      const target_dist = dist_min + ((rescaled_x - x_start) / (x_end - x_start)) * dist_range
      // Closest q-point in this branch to the target distance
      let [closest_idx, min_diff] = [start_idx, Infinity]
      for (let idx = start_idx; idx <= end_idx; idx++) {
        const diff = Math.abs(band_struct.distance[idx] - target_dist)
        if (diff < min_diff) [closest_idx, min_diff] = [idx, diff]
      }
      return closest_idx
    }
  }

  // Fallback: closest plotted segment endpoint
  let [closest_idx, min_dist] = [0, Infinity]
  for (const [branch, [x_start, x_end]] of branches) {
    for (const [x_pos, idx] of [
      [x_start, branch.start_index],
      [x_end, branch.end_index],
    ] as const) {
      const dist = Math.abs(rescaled_x - x_pos)
      if (dist < min_dist) [closest_idx, min_dist] = [idx, dist]
    }
  }
  return closest_idx
}

// Type definitions for pymatgen DOS formats
// Densities can be spin-keyed: {1: number[], -1: number[]} or {"Spin.up": number[], ...}
type SpinDensities = Record<string, number[]>

// Pymatgen Dos base class format
interface PymatgenDos {
  // pymatgen MSONable markers - optional since hand-built/partial DOS may omit them,
  // but the format detectors (normalize_dos, is_pymatgen_format) key on them
  '@class'?: string
  '@module'?: string
  energies: number[]
  densities: SpinDensities | number[]
  efermi: number
}

// Pymatgen CompleteDos format (includes projected DOS)
export interface PymatgenCompleteDos extends PymatgenDos {
  '@class'?: `CompleteDos` | `LobsterCompleteDos`
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
  if (!is_plain_object(dos)) return null

  // Get the appropriate projected DOS dict
  const pdos_dict =
    pdos_type === `atom`
      ? (dos.atom_dos as Record<string, PymatgenDos> | undefined)
      : (dos.spd_dos as Record<string, PymatgenDos> | undefined)

  if (!pdos_dict || typeof pdos_dict !== `object`) return null

  const result: Record<string, types.ElectronicDos> = {}
  for (const [key, nested_dos] of Object.entries(pdos_dict)) {
    if (filter_keys?.length && !filter_keys.includes(key)) continue
    if (!nested_dos || typeof nested_dos !== `object`) continue
    const { energies, efermi } = nested_dos
    const spin_channels = extract_spin_channels<number[]>(nested_dos.densities)
    if (!spin_channels || !Array.isArray(energies)) continue
    const densities = spin_channels.up
    if (!Array.isArray(densities) || energies.length !== densities.length) continue
    result[key] = electronic_dos(energies, densities, spin_channels.down, { efermi })
  }
  return Object.keys(result).length > 0 ? result : null
}

const shift_dos_energies = <T extends PymatgenDos>(dos: T, shift: number): T => ({
  ...dos,
  efermi: dos.efermi - shift,
  energies: dos.energies.map((energy) => energy - shift),
})

// Shift DOS energies relative to Fermi energy so E_F = 0
// Recursively shifts nested DOS in atom_dos and spd_dos for consistency
export function shift_to_fermi(dos: PymatgenCompleteDos): PymatgenCompleteDos {
  const shift = dos.efermi
  const shift_nested = (nested?: Record<string, PymatgenDos>) =>
    nested &&
    Object.fromEntries(
      Object.entries(nested).map(([key, nested_dos]) => [
        key,
        shift_dos_energies(nested_dos, shift),
      ]),
    )

  const atom_dos = shift_nested(dos.atom_dos)
  const spd_dos = shift_nested(dos.spd_dos)
  return {
    ...shift_dos_energies(dos, shift),
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
  const max_width_val = array_max(finite_positive_widths)

  const upper_points: string[] = []
  const lower_points: string[] = []

  for (let idx = 0; idx < x_values.length; idx++) {
    const x_px = x_scale_fn(x_values[idx])
    const y_data = y_values[idx]
    const raw_width = width_values[idx] ?? 0
    const width_normalized =
      Number.isFinite(raw_width) && raw_width > 0 ? raw_width / max_width_val : 0
    const half_width_px = width_normalized * max_width_px * scale

    // In SVG, y increases downward, so upper edge has smaller y value
    const y_upper_px = y_scale_fn(y_data) - half_width_px
    const y_lower_px = y_scale_fn(y_data) + half_width_px

    upper_points.push(`${x_px.toFixed(2)},${y_upper_px.toFixed(2)}`)
    lower_points.push(`${x_px.toFixed(2)},${y_lower_px.toFixed(2)}`)
  }

  return closed_edge_path(upper_points, lower_points)
}

// SVG path tracing the upper edge forward and the lower edge backward, closed (edge points
// are pre-formatted `x,y` pixel pairs)
export const closed_edge_path = (upper_points: string[], lower_points: string[]): string =>
  [
    `M${upper_points[0]}`,
    ...upper_points.slice(1).map((pt) => `L${pt}`),
    ...lower_points.toReversed().map((pt) => `L${pt}`),
    `Z`,
  ].join(` `)

// Extract efermi from a data source (band structure or DOS).
// Handles both single objects with an efermi field and dicts of objects.
// Returns undefined if no valid efermi is found or if the source is empty.
export function extract_efermi(data: unknown): number | undefined {
  if (!is_plain_object(data)) return undefined

  if (typeof data.efermi === `number`) return data.efermi

  // Dict of objects - try to get efermi from first value
  const first_val: unknown = Object.values(data)[0]
  if (is_plain_object(first_val) && typeof first_val.efermi === `number`) {
    return first_val.efermi
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

// Whether raw band structure input carries electronic markers: an efermi field, pymatgen
// kpoints (phonon input has qpoints), a BandStructure* (not Phonon*) @class or an
// electronic_structure @module. Must run on the raw input: normalization strips these fields.
export function is_electronic_band_struct(band_struct: unknown): boolean {
  if (!is_plain_object(band_struct)) return false
  if (typeof band_struct.efermi === `number`) return true
  if (Array.isArray(band_struct.kpoints) && band_struct.kpoints.length > 0) return true
  const py_class = band_struct[`@class`]
  const py_module = band_struct[`@module`]
  return (
    (typeof py_class === `string` &&
      py_class.startsWith(`BandStructure`) &&
      !py_class.includes(`Phonon`)) ||
    (typeof py_module === `string` && py_module.includes(`electronic_structure`))
  )
}

// Band structure / DOS props take one object or a dict of them keyed by label. A single
// object is recognised by a marker key on the object itself and gets the empty label;
// anything that is not an object yields no entries.
const single_or_dict_entries = (
  input: unknown,
  marker_keys: string[],
): [label: string, value: unknown][] => {
  if (typeof input !== `object` || input === null) return []
  return marker_keys.some((key) => key in input) ? [[``, input]] : Object.entries(input)
}
// matterviz and pymatgen phonon band structures carry `qpoints`, electronic pymatgen `kpoints`
export const band_struct_entries = (input: unknown) =>
  single_or_dict_entries(input, [`qpoints`, `kpoints`])
export const dos_entries = (input: unknown) => single_or_dict_entries(input, [`densities`])

// Min/max of the finite `values` padded by `padding_factor` of the span; a phonon range whose
// negatives are numerical noise (< IMAGINARY_MODE_NOISE_THRESHOLD) is clamped to start at 0
export function padded_frequency_range(
  values: readonly number[],
  is_phonon: boolean,
  padding_factor = 0.02,
): Vec2 | undefined {
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) return undefined
  let [min_val, max_val] = array_extent(finite)
  if (is_phonon && min_val < 0 && negative_fraction(finite) < IMAGINARY_MODE_NOISE_THRESHOLD) {
    min_val = 0
  }
  const padding = (max_val - min_val) * padding_factor
  return [min_val === 0 ? 0 : min_val - padding, max_val + padding]
}

// Shared frequency/energy range of bands and DOS, see padded_frequency_range
export function compute_frequency_range(
  band_structs: unknown,
  doses: unknown,
  padding_factor = 0.02,
): Vec2 | undefined {
  const frequency_lists: (readonly number[])[] = []

  // Electronic markers are read from the raw input: normalization strips them (every
  // normalized structure has qpoints). Bands that aren't electronic are phonon bands.
  const raw_band_structs = band_struct_entries(band_structs).map(([, raw]) => raw)
  // A malformed pymatgen entry throws from normalization; Bands reports it, the range just
  // skips it. The raw input rides along for is_electronic_band_struct's sake.
  const normalized = raw_band_structs.flatMap((raw) => {
    try {
      const bs = normalize_band_structure(raw)
      return bs ? [{ raw, bs }] : []
    } catch {
      return []
    }
  })
  // any, not every: an electronic entry alongside a phonon one must not clear the flag that
  // drives the imaginary-mode clamp, matching the `||=` the DOS loop below uses
  let is_phonon = normalized.some(({ raw }) => !is_electronic_band_struct(raw))
  for (const { bs } of normalized) frequency_lists.push(...bs.bands)

  for (const [, raw] of dos_entries(doses)) {
    const dos = normalize_dos(raw)
    if (!dos) continue
    // `||=`, not `=`: a later electronic entry must not clear a phonon flag set above
    is_phonon ||= dos.type === `phonon`
    frequency_lists.push(dos.type === `phonon` ? dos.frequencies : dos.energies)
  }
  return padded_frequency_range(frequency_lists.flat(), is_phonon, padding_factor)
}

// Parse axis label: "Frequency (THz)" → { name: "Frequency", unit: "THz" }
export function parse_axis_label(label: string): { name: string; unit?: string } {
  const match = /^(?<name>.+?)\s*\((?<unit>[^)]+)\)$/.exec(label)
  return match ? { name: match[1], unit: match[2] } : { name: label }
}

const format_tooltip_line = (name: string, value: string, unit?: string) =>
  `${name}: ${value}${unit ? ` ${unit}` : ``}`

// DOS tooltip content from the axis labels and the hovered point's formatted values. The
// series label is the title only when several DOS are plotted.
export function format_dos_tooltip(opts: {
  x_formatted: string
  y_formatted: string
  label: string | null
  is_horizontal: boolean // frequency/energy on y and density on x
  is_phonon: boolean
  units: FrequencyUnit
  x_axis_label: string
  y_axis_label: string
  num_series: number
}): { title?: string; lines: string[] } {
  const { x_formatted, y_formatted, label, is_horizontal, is_phonon, units } = opts
  const [x_parsed, y_parsed] = [opts.x_axis_label, opts.y_axis_label].map(parse_axis_label)
  const freq_line = (parsed: { name: string; unit?: string }, value: string) =>
    format_tooltip_line(
      parsed.name || (is_phonon ? `Frequency` : `Energy`),
      value,
      parsed.unit ?? (is_phonon ? units : `eV`),
    )
  const density_line = (parsed: { name: string }, value: string) =>
    format_tooltip_line(parsed.name || `Density`, value)
  // the frequency/energy line always comes first
  const lines = is_horizontal
    ? [freq_line(y_parsed, y_formatted), density_line(x_parsed, x_formatted)]
    : [density_line(y_parsed, y_formatted), freq_line(x_parsed, x_formatted)]
  return { title: opts.num_series > 1 && label ? label : undefined, lines }
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

// Validate sigma_range: ensures min < max, returns [0, 1] if invalid
export const validate_sigma_range = ([min, max]: Vec2): Vec2 =>
  Number.isFinite(min) && Number.isFinite(max) && min < max ? [min, max] : [0, 1]

// Calculate slider step: 1/100th of range, or 0.01 fallback
export function calculate_sigma_step(range: Vec2): number {
  const [min, max] = validate_sigma_range(range)
  return (max - min) / 100 || 0.01
}

// === Band Tooltip Helpers ===

// Per-point metadata for band tooltip display
export interface BandPointMeta extends Record<string, unknown> {
  aria_label: string
  band_idx: number
  qpoint_idx: number
  spin: `up` | `down`
  is_acoustic: boolean | null
  nb_bands: number
  frac_coords: Vec3 | null
  qpoint_label: string | null
  band_width: number | null
  slope: number | null
}

// Local slope (dω/dk or dE/dk): central difference for interior points, one-sided at the ends
const compute_slope = (x_vals: number[], y_vals: number[], idx: number): number | null => {
  const lo = Math.max(0, idx - 1)
  const hi = Math.min(x_vals.length - 1, idx + 1)
  const dx = x_vals[hi] - x_vals[lo]
  return dx ? (y_vals[hi] - y_vals[lo]) / dx : null
}

// A q-point counts as Gamma when every fractional coordinate is within 0.01 of an integer
export const is_gamma_point = (frac_coords: Vec3): boolean =>
  frac_coords.every((coord) => Math.abs(coord - Math.round(coord)) < 0.01)

// Indices of the Gamma points (q ≈ integer lattice point) in a band structure
export const find_gamma_indices = (bs: types.BaseBandStructure): number[] =>
  bs.qpoints.flatMap(({ frac_coords }, q_idx) => (is_gamma_point(frac_coords) ? [q_idx] : []))

// Threshold below which a band's frequency at Gamma is considered acoustic (THz).
// Assumes bands are stored in THz (normalize_band_structure converts to THz).
export const ACOUSTIC_FREQ_THRESHOLD = 0.5

// Classify a band as acoustic based on near-zero frequency at Gamma points.
// Returns true (acoustic), false (optical), or null (no Gamma points → can't determine).
export function classify_acoustic(
  bs: types.BaseBandStructure,
  band_idx: number,
  gamma_indices: number[],
  threshold = ACOUSTIC_FREQ_THRESHOLD,
): boolean | null {
  if (gamma_indices.length === 0) return null
  return gamma_indices.some(
    (gamma_idx) => Math.abs(bs.bands[band_idx]?.[gamma_idx] ?? Infinity) < threshold,
  )
}

// Build per-point metadata array for a band series in the tooltip.
export function build_point_metadata(opts: {
  x_vals: number[]
  y_vals: number[]
  band_idx: number
  spin: `up` | `down`
  is_acoustic: boolean | null
  bs: types.BaseBandStructure
  start_idx: number
}): BandPointMeta[] {
  const { x_vals, y_vals, band_idx, spin, is_acoustic, bs, start_idx } = opts
  return x_vals.map((_, pt_idx) => {
    const global_idx = start_idx + pt_idx
    const qpoint = bs.qpoints[global_idx]
    return {
      aria_label: `Select band ${band_idx + 1}, q-point ${global_idx + 1}`,
      band_idx,
      qpoint_idx: global_idx,
      spin,
      is_acoustic,
      nb_bands: bs.nb_bands,
      frac_coords: qpoint?.frac_coords ?? null,
      qpoint_label: qpoint?.label ?? null,
      band_width: bs.band_widths?.[band_idx]?.[global_idx] ?? null,
      slope: compute_slope(x_vals, y_vals, pt_idx),
    }
  })
}
