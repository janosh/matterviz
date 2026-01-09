import type { CompositionType } from '$lib/composition'
import type { ElementSymbol } from '$lib/element'
import { element_data } from '$lib/element'
import * as math from '$lib/math'
import type { Crystal } from '$lib/structure/index'
import { parse_any_structure } from '$lib/structure/parse'
import { is_crystal } from '$lib/structure/validation'
// copied from pymatgen/analysis/diffraction/atomic_scattering_params.json
import { ATOMIC_SCATTERING_PARAMS } from './atomic-scattering-params'
import type {
  Hkl,
  HklObj,
  PatternEntry,
  RecipPoint,
  XrdOptions,
  XrdPattern,
} from './index'
import { is_xrd_data_file, parse_xrd_file } from './parse'

// XRD wavelengths in Angstrom (Å)
export const WAVELENGTHS = {
  CuKa: 1.54184,
  CuKa2: 1.54439,
  CuKa1: 1.54056,
  CuKb1: 1.39222,
  MoKa: 0.71073,
  MoKa2: 0.71359,
  MoKa1: 0.7093,
  MoKb1: 0.63229,
  CrKa: 2.291,
  CrKa2: 2.29361,
  CrKa1: 2.2897,
  CrKb1: 2.08487,
  FeKa: 1.93735,
  FeKa2: 1.93998,
  FeKa1: 1.93604,
  FeKb1: 1.75661,
  CoKa: 1.79026,
  CoKa2: 1.79285,
  CoKa1: 1.78896,
  CoKb1: 1.63079,
  AgKa: 0.560885,
  AgKa2: 0.563813,
  AgKa1: 0.559421,
  AgKb1: 0.497082,
} as const

export type RadiationKey = keyof typeof WAVELENGTHS

// Tolerances from pymatgen.analysis.diffraction.core
const TWO_THETA_TOL = 1e-5
const SCALED_INTENSITY_TOL = 1e-3

const ELEMENT_Z = Object.fromEntries(
  element_data.map((entry) => [entry.symbol as ElementSymbol, entry.number]),
) as CompositionType

function get_unique_families(hkls: Hkl[]): Map<string, number> {
  // Port of pymatgen's get_unique_families: group Miller indices by absolute-value permutations
  const key_map = new Map<string, Hkl[]>()
  for (const hkl of hkls) {
    const abs_sorted = [...hkl.map((v) => Math.abs(v))].sort((x, y) => x - y)
    const key = abs_sorted.join(`,`)
    const list = key_map.get(key)
    if (list) list.push(hkl)
    else key_map.set(key, [hkl])
  }
  // Choose representative with max tuple (lexicographic) like numpy max(val)
  const family_map = new Map<string, number>()
  for (const group of key_map.values()) {
    let representative: Hkl = group[0]
    for (const candidate of group) {
      const better = candidate[0] > representative[0] ||
        (candidate[0] === representative[0] &&
          (candidate[1] > representative[1] ||
            (candidate[1] === representative[1] && candidate[2] > representative[2])))
      if (better) representative = candidate
    }
    family_map.set(representative.join(`,`), group.length)
  }
  return family_map
}

function compute_reciprocal_lattice_rows(structure: Crystal): number[][] {
  // For row-wise lattice matrix A (rows are a, b, c), reciprocal rows are inv(A)^T
  const direct = structure.lattice.matrix
  const inv = math.matrix_inverse_3x3(direct)
  const recip = math.transpose_3x3_matrix(inv)
  return recip
}

function enumerate_reciprocal_points(
  recip_rows: number[][],
  max_radius: number,
  min_radius: number,
): RecipPoint[] {
  const recip_b1 = recip_rows[0]
  const recip_b2 = recip_rows[1]
  const recip_b3 = recip_rows[2]
  const n1 = Math.max(Math.hypot(...recip_b1), 1e-12)
  const n2 = Math.max(Math.hypot(...recip_b2), 1e-12)
  const n3 = Math.max(Math.hypot(...recip_b3), 1e-12)
  const h_max = Math.ceil((max_radius / n1) + 2)
  const k_max = Math.ceil((max_radius / n2) + 2)
  const l_max = Math.ceil((max_radius / n3) + 2)
  // Safety cap to avoid pathological enumeration volume
  const CAP = 512
  if (Math.max(h_max, k_max, l_max) > CAP) {
    throw new Error(
      `enumerate_reciprocal_points: max(h,k,l) exceeds cap ${CAP}`,
    )
  }

  const points: RecipPoint[] = []
  for (let h_idx = -h_max; h_idx <= h_max; h_idx++) {
    for (let k_idx = -k_max; k_idx <= k_max; k_idx++) {
      for (let l_idx = -l_max; l_idx <= l_max; l_idx++) {
        if (h_idx === 0 && k_idx === 0 && l_idx === 0) continue
        const h_mul_b1 = math.scale(recip_b1, h_idx)
        const k_mul_b2 = math.scale(recip_b2, k_idx)
        const l_mul_b3 = math.scale(recip_b3, l_idx)
        const g_vec = math.add(h_mul_b1, k_mul_b2, l_mul_b3)
        const g_norm = Math.hypot(...g_vec)
        if (g_norm < min_radius || g_norm > max_radius) continue
        points.push({ hkl: [h_idx, k_idx, l_idx], g_norm })
      }
    }
  }
  // Sort by (g_norm asc, -h, -k, -l) to mimic pymatgen ordering
  points.sort((p1, p2) =>
    p1.g_norm !== p2.g_norm
      ? p1.g_norm - p2.g_norm
      : p2.hkl[0] !== p1.hkl[0]
      ? p2.hkl[0] - p1.hkl[0]
      : p2.hkl[1] !== p1.hkl[1]
      ? p2.hkl[1] - p1.hkl[1]
      : p2.hkl[2] - p1.hkl[2]
  )
  return points
}

export function compute_xrd_pattern(
  structure: Crystal,
  options: XrdOptions = {},
): XrdPattern {
  const wl_input = options.wavelength ?? `CuKa`
  let wavelength: number
  if (typeof wl_input === `number`) {
    wavelength = wl_input
  } else {
    const looked_up = WAVELENGTHS[wl_input as RadiationKey]
    if (looked_up === undefined) {
      throw new Error(`Unknown radiation key: ${wl_input}`)
    }
    wavelength = looked_up
  }

  // Symmetry refinement (symprec > 0) is not implemented in TS version.
  // Option retained for API parity.
  // const symprec = options.symprec ?? 0

  const recip_rows = compute_reciprocal_lattice_rows(structure)

  // Bragg condition bounds: reciprocal vector length r = 2 sin(theta) / lambda
  const two_theta_range = options.two_theta_range === null
    ? null
    : options.two_theta_range ?? [0, 180]
  const [min_radius, max_radius] = two_theta_range === null
    ? [0, 2 / wavelength]
    : (([t_min, t_max]: [number, number]) => {
      const r_min = (2 * Math.sin((t_min / 2) * (Math.PI / 180))) / wavelength
      const r_max = (2 * Math.sin((t_max / 2) * (Math.PI / 180))) / wavelength
      return [r_min, r_max]
    })(two_theta_range)

  const recip_points = enumerate_reciprocal_points(recip_rows, max_radius, min_radius)

  // Flatten species with occupancies; gather coeffs, frac coords, occu, DW factors.
  type ScatteringCoeffs = { a: number[]; b: number[]; c?: number }
  const coeffs: ScatteringCoeffs[] = []
  const frac_coords: math.Vec3[] = []
  const occus: number[] = []
  const dw_factors: number[] = []

  const debye_waller_factors = options.debye_waller_factors ?? {}

  for (const site of structure.sites) {
    for (const species of site.species) {
      const element_symbol = species.element as ElementSymbol
      if (ELEMENT_Z[element_symbol] === undefined) {
        throw new Error(`Unknown atomic number for element ${element_symbol}`)
      }
      // Cast needed: imported JSON has different type structure than our union type
      const raw_coeff = (
        ATOMIC_SCATTERING_PARAMS as unknown as Partial<
          Record<
            ElementSymbol,
            [number, number][] | { a: number[]; b: number[]; c?: number }
          >
        >
      )[element_symbol]
      if (!raw_coeff) {
        throw new Error(
          `No atomic scattering coefficients for ${element_symbol}. Extend ATOMIC_SCATTERING_PARAMS.`,
        )
      }
      let coeff_entry: ScatteringCoeffs
      if (Array.isArray(raw_coeff)) {
        const a_arr = raw_coeff.map(([a]) => a)
        const b_arr = raw_coeff.map(([_, b]) => b)
        coeff_entry = { a: a_arr, b: b_arr }
      } else {
        coeff_entry = { a: raw_coeff.a.slice(), b: raw_coeff.b.slice(), c: raw_coeff.c }
      }
      coeffs.push(coeff_entry)
      frac_coords.push(site.abc)
      occus.push(species.occu)
      dw_factors.push(debye_waller_factors[element_symbol] ?? 0)
    }
  }

  // Accumulate peaks by merging two_thetas within tolerance
  const peaks = new Map<number, { intensity: number; hkls: Hkl[]; d_hkl: number }>()
  const two_thetas: number[] = []
  const merge_tol = options.peak_merge_tol ?? TWO_THETA_TOL
  const scaled_tol = options.scaled_intensity_tol ?? SCALED_INTENSITY_TOL

  for (const entry of recip_points) {
    const hkl = entry.hkl
    const g_norm = entry.g_norm
    if (g_norm === 0) continue

    const asin_arg = (wavelength * g_norm) / 2
    // asin domain can exceed 1 by FP error — clamp to avoid NaN
    const clamped_asin_arg = Math.min(1, Math.max(-1, asin_arg))
    const theta = Math.asin(clamped_asin_arg)
    const sin_theta_over_lambda = g_norm / 2
    const sin_theta_over_lambda_sq = sin_theta_over_lambda * sin_theta_over_lambda

    // g.r for all fractional coords
    const g_dot_r_all = frac_coords.map((frac_coord) =>
      math.dot(frac_coord, hkl) as number
    )

    // Atomic scattering factors (vectorized style)
    const f_scattering: number[] = coeffs.map((coeff_entry) => {
      const { a: a_arr, b: b_arr } = coeff_entry
      const num_terms = Math.min(a_arr.length, b_arr.length)
      const sum_terms = a_arr
        .slice(0, num_terms)
        .reduce(
          (sum, a_i, term_idx) =>
            sum + a_i * Math.exp(-b_arr[term_idx] * sin_theta_over_lambda_sq),
          0,
        )
      return sum_terms + (coeff_entry.c ?? 0)
    })

    const dw_corr: number[] = dw_factors.map((dw_b) =>
      Math.exp(-dw_b * sin_theta_over_lambda_sq)
    )

    // Structure factor sum: sum(fs * occu * exp(2πi g·r) * DW)
    const { real: f_real, imag: f_imag } = f_scattering.reduce(
      (acc, fs, idx) => {
        const phase = 2 * Math.PI * g_dot_r_all[idx]
        const weight = fs * occus[idx] * dw_corr[idx]
        const real = acc.real + weight * Math.cos(phase)
        const imag = acc.imag + weight * Math.sin(phase)
        return { real, imag }
      },
      { real: 0, imag: 0 },
    )

    const sin_theta = Math.sin(theta)
    const cos_theta = Math.cos(theta)
    const denom_raw = (sin_theta * sin_theta) * Math.abs(cos_theta)
    // Clamp denominator away from zero to avoid Inf/NaN when 2θ → 180° (cosθ → 0)
    const denom = Math.max(denom_raw, 1e-12)
    const lorentz = (1 + Math.cos(2 * theta) ** 2) / denom
    const intensity_hkl = (f_real * f_real + f_imag * f_imag) * lorentz
    const two_theta = math.to_degrees(2 * theta)

    // Use (h, k, l) always. For hexagonal systems, pymatgen presents Miller–Bravais (h, k, i, l),
    // but downstream components expect 3-index HKL. Keep 3-index form to match types/consumers.
    const hkl_to_store: Hkl = [hkl[0], hkl[1], hkl[2]]

    // Merge peaks within tolerance
    let found_index: number | null = null
    for (let idx = 0; idx < two_thetas.length; idx++) {
      if (Math.abs(two_thetas[idx] - two_theta) < merge_tol) {
        found_index = idx
        break
      }
    }

    if (found_index !== null) {
      const key = two_thetas[found_index]
      const item = peaks.get(key)
      if (item) {
        item.intensity += intensity_hkl
        item.hkls.push(hkl_to_store)
      }
    } else {
      const d_hkl = 1 / g_norm
      peaks.set(two_theta, { intensity: intensity_hkl, hkls: [hkl_to_store], d_hkl })
      two_thetas.push(two_theta)
    }
  }

  if (peaks.size === 0) return { x: [], y: [] }

  // Scale intensities so that the max intensity is 100, and filter by scaled tol
  const max_intensity = Math.max(...Array.from(peaks.values()).map((p) => p.intensity))

  const xs: number[] = []
  const ys: number[] = []
  const hkls_out: HklObj[][] = []
  const d_out: number[] = []

  const sorted_two_thetas = Array.from(peaks.keys()).sort((a, b) => a - b)
  for (const angle of sorted_two_thetas) {
    const item = peaks.get(angle)
    if (!item) continue
    const scaled_val = (item.intensity / max_intensity) * 100
    if (scaled_val > scaled_tol) {
      xs.push(angle)
      ys.push(item.intensity)
      const fam = get_unique_families(item.hkls)
      const fam_array: HklObj[] = []
      for (const [repr_key, multiplicity] of fam.entries()) {
        const repr = repr_key.split(`,`).map((n) => parseInt(n, 10)) as Hkl
        fam_array.push({ hkl: repr, multiplicity })
      }
      hkls_out.push(fam_array)
      d_out.push(item.d_hkl)
    }
  }

  // Final scaling if requested
  if (options.scaled ?? true) {
    const max_y = Math.max(1, ...ys)
    for (let idx = 0; idx < ys.length; idx++) ys[idx] = (ys[idx] / max_y) * 100
  }

  return { x: xs, y: ys, hkls: hkls_out, d_hkls: d_out }
}

// Process dropped file content and return an XRD pattern.
// Supports both direct XRD data files (.xy, .brml) and structure files
// (which are used to compute theoretical XRD patterns).
export async function add_xrd_pattern(
  content: string | ArrayBufferLike, // File content as string or ArrayBuffer
  filename: string, // Name of the file (used to detect format)
  wavelength: number | null, // X-ray wavelength for structure-based XRD calculation
): Promise<{ pattern?: PatternEntry; error?: string }> { // Object with pattern entry or error message
  try {
    // Check if file is a direct XRD data file (.xy, .brml)
    if (is_xrd_data_file(filename)) {
      // Convert ArrayBufferLike to ArrayBuffer if needed (handles SharedArrayBuffer)
      let buffer_content: string | ArrayBuffer
      if (typeof content === `string`) {
        buffer_content = content
      } else {
        buffer_content = new Uint8Array(content).buffer as ArrayBuffer
      }
      const pattern = await parse_xrd_file(buffer_content, filename)
      if (pattern && pattern.x.length > 0) {
        return { pattern: { label: filename || `XRD data`, pattern } }
      }
      // Get base extension (strip .gz if present) for error message
      const base_name = filename.toLowerCase().replace(/\.gz$/, ``)
      const ext = base_name.split(`.`).pop()?.toUpperCase() || `XRD`
      const format_hints: Record<string, string> = {
        XY: `Expected 2-column format: "2theta intensity" (space/tab/comma separated)`,
        XYE:
          `Expected 3-column format: "2theta intensity error" (space/tab/comma separated)`,
        BRML: `Expected Bruker RAW/BRML ZIP archive with RawData XML`,
        XRDML: `Expected PANalytical XRDML format with dataPoints section`,
      }
      const hint = format_hints[ext] || `Check file format and encoding`
      return { error: `Failed to parse ${ext} file: no valid data found. ${hint}` }
    }

    // Otherwise, try to parse as a structure file and compute XRD pattern
    const text_content = typeof content === `string`
      ? content
      : new TextDecoder().decode(content as BufferSource)
    const parsed_structure = parse_any_structure(text_content, filename)
    if (is_crystal(parsed_structure)) {
      const pattern = compute_xrd_pattern(parsed_structure, {
        wavelength: typeof wavelength === `number` ? wavelength : undefined,
      })
      return { pattern: { label: filename || `Dropped structure`, pattern } }
    }
    return {
      error: `Cannot compute XRD: structure must have a lattice and atomic sites. ` +
        `Supported formats: CIF, POSCAR, JSON, XYZ`,
    }
  } catch (exc) {
    return {
      error: `Failed to compute XRD pattern: ${
        exc instanceof Error ? exc.message : String(exc)
      }`,
    }
  }
}

export const AVAILABLE_RADIATION = Object.keys(WAVELENGTHS) as RadiationKey[]
