import type { CompositionType } from '$lib/composition'
import type { ElementSymbol } from '$lib/element'
import { element_data } from '$lib/element'
import * as math from '$lib/math'
import type { Vec2 } from '$lib/math'
import type { RadiationType } from '$lib/scattering'
import {
  ELECTRON_FORM_FACTOR_CONST,
  gaussian_turning_point,
  neutron_scattering_length,
  XRAY_GAUSSIAN_PREFACTOR,
} from '$lib/scattering'
import type { Crystal } from '$lib/structure/index'
import { parse_any_structure } from '$lib/structure/parse'
import { is_crystal } from '$lib/structure/validation'
// Single source of truth for atomic scattering params
import ATOMIC_SCATTERING_PARAMS from './atomic_scattering_params.json' with { type: 'json' }
import type { Hkl, HklObj, PatternEntry, RecipPoint, XrdOptions, XrdPattern } from './index'
import { is_xrd_data_file, parse_xrd_file } from './parse'
import { to_error } from '$lib/utils'

// JSON import yields Record<string, number[][]>; type for element-keyed scattering params
type ScatteringParamsRecord = Partial<Record<ElementSymbol, number[][]>>

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

// Type guard to safely check if a string is a valid RadiationKey
const is_radiation_key = (key: string): key is RadiationKey => key in WAVELENGTHS

// CODATA 2018 constants, SI. Kept explicit rather than folded into one fitted prefactor so the
// relativistic de Broglie formula below stays auditable against a textbook.
const PLANCK_CONSTANT = 6.62607015e-34 // J·s
const ELECTRON_REST_MASS = 9.1093837015e-31 // kg
const ELEMENTARY_CHARGE = 1.602176634e-19 // C
const SPEED_OF_LIGHT = 299792458 // m/s

// Shared guard for the numeric options of every entry point here. Names the option and echoes
// the offending value, so NaN from a bad parse is distinguishable from a negative literal.
export function require_positive(name: string, value: number, unit = ``): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}: ${value}. Must be a finite positive number${unit}.`)
  }
  return value
}

// Relativistic de Broglie wavelength of an electron accelerated through `voltage_kv` kilovolts:
//   λ = h / sqrt(2·m0·e·V·(1 + e·V/(2·m0·c²)))
// The (1 + eV/2m0c²) term matters enormously in a TEM: at 200 kV it shortens λ by 9%, from
// 0.0274 Å non-relativistically to 0.0251 Å. Returns Angstrom.
export function electron_wavelength(voltage_kv: number): number {
  require_positive(`accelerating voltage`, voltage_kv, ` of kV`)
  const voltage_volts = voltage_kv * 1000
  const rest_energy_joule = ELECTRON_REST_MASS * SPEED_OF_LIGHT * SPEED_OF_LIGHT
  const kinetic_joule = ELEMENTARY_CHARGE * voltage_volts
  const momentum = Math.sqrt(
    2 * ELECTRON_REST_MASS * kinetic_joule * (1 + kinetic_joule / (2 * rest_energy_joule)),
  )
  // h/p is in metres; 1 m = 1e10 Angstrom
  return (PLANCK_CONSTANT / momentum) * 1e10
}

// Resolve the wavelength in Angstrom for a given radiation type, rejecting nonsensical
// combinations rather than quietly diffracting neutrons with a Cu anode wavelength.
export function resolve_wavelength(
  radiation: RadiationType,
  wavelength: number | RadiationKey | undefined,
  accelerating_voltage: number | undefined,
): number {
  if (radiation === `xray`) {
    if (accelerating_voltage !== undefined) {
      throw new Error(
        `accelerating_voltage is only meaningful for radiation: 'electron', not 'xray'. ` +
          `Pass a wavelength or an anode key instead.`,
      )
    }
    const wl_input = wavelength ?? `CuKa`
    if (typeof wl_input === `number`) return require_positive(`wavelength`, wl_input)
    if (!is_radiation_key(wl_input)) throw new Error(`Unknown radiation key: ${wl_input}`)
    return WAVELENGTHS[wl_input]
  }

  // WAVELENGTHS lists X-ray tube anodes only, so an anode key is always a user mistake here
  if (typeof wavelength === `string`) {
    const voltage_hint =
      radiation === `electron` ? `, or options.accelerating_voltage in kV.` : `.`
    throw new Error(
      `${wavelength} is an X-ray anode wavelength and cannot be used for ${radiation} ` +
        `radiation. Pass options.wavelength as a number in Angstrom${voltage_hint}`,
    )
  }

  if (radiation === `neutron`) {
    if (accelerating_voltage !== undefined) {
      throw new Error(
        `accelerating_voltage is only meaningful for radiation: 'electron', not 'neutron'.`,
      )
    }
    if (wavelength === undefined) {
      throw new Error(
        `Neutron patterns require an explicit options.wavelength in Angstrom (e.g. 1.548 for ` +
          `a typical constant-wavelength reactor instrument). There is no default anode.`,
      )
    }
    return require_positive(`wavelength`, wavelength)
  }

  if (radiation === `electron`) {
    if (wavelength !== undefined && accelerating_voltage !== undefined) {
      throw new Error(
        `Pass either options.wavelength (${wavelength} Å) or options.accelerating_voltage ` +
          `(${accelerating_voltage} kV) for electron radiation, not both.`,
      )
    }
    if (wavelength !== undefined) return require_positive(`wavelength`, wavelength)
    if (accelerating_voltage !== undefined) return electron_wavelength(accelerating_voltage)
    throw new Error(
      `Electron patterns require options.accelerating_voltage in kV (e.g. 200) or an ` +
        `explicit options.wavelength in Angstrom.`,
    )
  }

  throw new Error(`Unknown radiation type ${radiation}. Expected xray, neutron or electron.`)
}

// Tolerances from pymatgen.analysis.diffraction.core
const TWO_THETA_TOL = 1e-5
const SCALED_INTENSITY_TOL = 1e-3

const ELEMENT_Z = Object.fromEntries(
  element_data.map((entry) => [entry.symbol, entry.number]),
) as CompositionType

// Sorted absolute indices, so every permutation and sign variant of a family collides.
// Spelled out arithmetically on purpose: a map/toSorted/join version allocates two arrays per
// call and benchmarked 25x slower, enough to time out the largest pymatgen parity fixture.
function hkl_family_key([h_idx, k_idx, l_idx]: Hkl): string {
  const abs_h = Math.abs(h_idx)
  const abs_k = Math.abs(k_idx)
  const abs_l = Math.abs(l_idx)
  const min_abs = Math.min(abs_h, abs_k, abs_l)
  const max_abs = Math.max(abs_h, abs_k, abs_l)
  return `${min_abs},${abs_h + abs_k + abs_l - min_abs - max_abs},${max_abs}`
}

// Port of pymatgen's get_unique_families: group Miller indices by absolute-value permutations
function get_unique_families(hkls: Hkl[]): HklObj[] {
  const key_map = new Map<string, Hkl[]>()
  for (const hkl of hkls) {
    const key = hkl_family_key(hkl)
    const group = key_map.get(key)
    if (group) group.push(hkl)
    else key_map.set(key, [hkl])
  }
  // Representative is the max tuple (lexicographic) like numpy max(val)
  return Array.from(key_map.values(), (group) => ({
    hkl: group.reduce((best, cand) =>
      (cand[0] - best[0] || cand[1] - best[1] || cand[2] - best[2]) > 0 ? cand : best,
    ),
    multiplicity: group.length,
  }))
}

// SAED restriction: only reflections whose Laue index n = h·u + k·v + l·w satisfies
// |n| <= max_laue can sit close enough to the Ewald sphere to be excited. Tested inside the
// triple loop, it rejects the bulk of the sphere before any reciprocal vector is formed.
export type LaueBound = { zone_axis: math.Vec3; max_laue: number }

export function enumerate_reciprocal_points(
  recip_rows: math.Matrix3x3,
  direct_rows: math.Matrix3x3,
  max_radius: number,
  min_radius: number,
  laue_bound?: LaueBound,
): RecipPoint[] {
  const [[b1_x, b1_y, b1_z], [b2_x, b2_y, b2_z], [b3_x, b3_y, b3_z]] = recip_rows
  // Exact index bound: |h_i| = |g·a_i| ≤ R·|a_i| (since a_i·b_j = δ_ij). Bounds from
  // reciprocal-row norms (R/|b_i| + 2) undercount for skewed cells, dropping reflections.
  const [h_max, k_max, l_max] = direct_rows.map(
    (row) => Math.ceil(max_radius * Math.hypot(...row)) + 1,
  )
  // Safety cap to avoid pathological enumeration volume
  const CAP = 512
  if (Math.max(h_max, k_max, l_max) > CAP) {
    throw new Error(`enumerate_reciprocal_points: max(h,k,l) exceeds cap ${CAP}`)
  }
  const [zone_u, zone_v, zone_w] = laue_bound?.zone_axis ?? [0, 0, 0]
  const max_laue = laue_bound?.max_laue ?? 0

  const points: RecipPoint[] = []
  for (let h_idx = -h_max; h_idx <= h_max; h_idx++) {
    for (let k_idx = -k_max; k_idx <= k_max; k_idx++) {
      for (let l_idx = -l_max; l_idx <= l_max; l_idx++) {
        if (h_idx === 0 && k_idx === 0 && l_idx === 0) continue
        const laue = h_idx * zone_u + k_idx * zone_v + l_idx * zone_w
        if (laue_bound && Math.abs(laue) > max_laue) continue
        // Scalars, not a Vec3: materialising g allocated four arrays per candidate point
        // (11.6 MB for a 55k-point sphere) that no consumer ever read back.
        const g_x = h_idx * b1_x + k_idx * b2_x + l_idx * b3_x
        const g_y = h_idx * b1_y + k_idx * b2_y + l_idx * b3_y
        const g_z = h_idx * b1_z + k_idx * b2_z + l_idx * b3_z
        const g_norm = Math.hypot(g_x, g_y, g_z)
        if (g_norm < min_radius || g_norm > max_radius) continue
        points.push({ hkl: [h_idx, k_idx, l_idx], g_norm })
      }
    }
  }
  // Sort by (g_norm asc, -h, -k, -l) to mimic pymatgen ordering. All terms are finite, so a
  // zero difference means equality and `||` falls through exactly like an explicit tie check.
  points.sort(
    (p1, p2) =>
      p1.g_norm - p2.g_norm ||
      p2.hkl[0] - p1.hkl[0] ||
      p2.hkl[1] - p1.hkl[1] ||
      p2.hkl[2] - p1.hkl[2],
  )
  return points
}

// |F(hkl)|² for every supplied reflection, where
//   F(hkl) = Σⱼ fⱼ(s)·occuⱼ·exp(2πi·hkl·rⱼ)·exp(−Bⱼ·s²),  s = |g|/2.
// Shared by the powder pattern and the SAED spot calculation so both see identical
// occupancies, Debye-Waller damping and scattering amplitudes.
//
// Units of |F|² differ per radiation — electrons² (X-ray), fm² (neutron), Å² (electron) —
// which never matters because every consumer rescales intensities to a maximum of 100.
export function structure_factors_squared(
  structure: Crystal,
  radiation: RadiationType,
  debye_waller_factors: CompositionType,
  reflections: readonly RecipPoint[],
): Float64Array {
  // Flatten species with occupancies. Scattering factors and Debye-Waller corrections depend
  // only on the element, so keep one entry per distinct element and have each site-species
  // index into it — per-atom, the 9-term exponential sum repeats identical work per site.
  type ScatteringCoeffs = {
    a: number[]
    b: number[]
    z: number
    dw: number
    // s² past which the X-ray Gaussian fit turns back up toward Z instead of decaying
    // (see gaussian_turning_point in $lib/scattering). Resolved once per element.
    s_sq_max: number
    // Bound coherent neutron scattering length in fm. Carries no s dependence whatsoever, so
    // it is resolved once here rather than re-read for every reciprocal point.
    b_coh: number
  }
  const element_coeffs: ScatteringCoeffs[] = []
  const element_ids: number[] = [] // per site-species -> index into element_coeffs
  const element_index = new Map<string, number>()
  const frac_coords: math.Vec3[] = []
  const occus: number[] = []

  for (const site of structure.sites) {
    for (const species of site.species) {
      const element_symbol = species.element
      // Only the X-ray and electron branches read z; neutrons scatter off the nucleus and
      // use b_coh alone. Gating the throw on radiation keeps a species that has a neutron
      // scattering length but no atomic number (deuterium, once Site.species can carry it
      // - ElementSymbol excludes `D` today) from being rejected before it reaches the
      // branch that would have worked.
      const z = ELEMENT_Z[element_symbol]
      if (z === undefined && radiation !== `neutron`) {
        throw new Error(`Unknown atomic number for element ${element_symbol}`)
      }
      let element_id = element_index.get(element_symbol)
      if (element_id === undefined) {
        // Neutrons scatter off nuclei and need no electron-density Gaussian fit, so only the
        // X-ray and electron paths require ATOMIC_SCATTERING_PARAMS
        const raw_coeff = (ATOMIC_SCATTERING_PARAMS as ScatteringParamsRecord)[element_symbol]
        if (!raw_coeff && radiation !== `neutron`) {
          throw new Error(
            `No atomic scattering coefficients for ${element_symbol}. Extend ATOMIC_SCATTERING_PARAMS.`,
          )
        }
        let b_coh = 0
        if (radiation === `neutron`) {
          try {
            b_coh = neutron_scattering_length(element_symbol)
          } catch (exc) {
            throw new Error(
              `Cannot compute a neutron pattern for ${element_symbol}: ${
                to_error(exc).message
              } No natural-abundance bound coherent scattering length exists for it.`,
              { cause: exc },
            )
          }
        }
        element_id = element_coeffs.length
        element_index.set(element_symbol, element_id)
        element_coeffs.push({
          a: raw_coeff ? raw_coeff.map((row) => row[0]) : [],
          b: raw_coeff ? raw_coeff.map((row) => row[1]) : [],
          z: z ?? 0, // unreachable on the x-ray/electron paths; neutrons never read it
          dw: debye_waller_factors[element_symbol] ?? 0,
          s_sq_max: raw_coeff ? gaussian_turning_point(element_symbol) : Infinity,
          b_coh,
        })
      }
      element_ids.push(element_id)
      frac_coords.push(site.abc)
      occus.push(species.occu)
    }
  }

  // Scratch reused across reciprocal points to keep the loop allocation-free
  const n_species = element_ids.length
  const n_elements = element_coeffs.length
  const f_by_element = new Float64Array(n_elements)
  const dw_by_element = new Float64Array(n_elements)

  const is_neutron = radiation === `neutron`
  const is_electron = radiation === `electron`
  // b_coh carries no s dependence at all, so the whole amplitude table is final here and the
  // per-reflection loop below never has to touch it again
  if (is_neutron) {
    for (let elem = 0; elem < n_elements; elem++) {
      f_by_element[elem] = element_coeffs[elem].b_coh
    }
  }
  // exp(−0·s²) is exactly 1 for every finite s, so with no Debye-Waller factors supplied the
  // damping table is likewise final and the per-element Math.exp can be skipped entirely
  const has_debye_waller = element_coeffs.some((coeffs) => coeffs.dw !== 0)
  if (!has_debye_waller) dw_by_element.fill(1)

  const intensities = new Float64Array(reflections.length)

  for (let point_idx = 0; point_idx < reflections.length; point_idx++) {
    const { hkl, g_norm } = reflections[point_idx]
    const [h_idx, k_idx, l_idx] = hkl
    const sin_theta_over_lambda = g_norm / 2
    const sin_theta_over_lambda_sq = sin_theta_over_lambda * sin_theta_over_lambda

    // Atomic scattering factors, once per element rather than per atom. X-rays see
    // f = Z − XRAY_GAUSSIAN_PREFACTOR·s²·Σ aᵢ·exp(−bᵢ·s²) (pymatgen fitted params); the
    // Mott–Bethe electron form cancels that s² analytically (see $lib/scattering), so both
    // share one sum_terms. Neutrons see an s-independent b_coh, leaving nothing to update.
    if (!is_neutron || has_debye_waller) {
      for (let elem = 0; elem < n_elements; elem++) {
        const { a: a_arr, b: b_arr, z: atomic_number, dw, s_sq_max } = element_coeffs[elem]
        if (!is_neutron) {
          // The X-ray fit is only valid below its turning point; past it the expression
          // climbs back to +Z instead of decaying to 0 (see xray_form_factor in
          // $lib/scattering). Hold it flat there and floor at 0. The Mott-Bethe electron
          // form has no such issue - the s² cancels, leaving a monotone Gaussian sum.
          const s_sq = is_electron
            ? sin_theta_over_lambda_sq
            : Math.min(sin_theta_over_lambda_sq, s_sq_max)
          let sum_terms = 0
          for (let term = 0; term < a_arr.length; term++) {
            sum_terms += a_arr[term] * Math.exp(-b_arr[term] * s_sq)
          }
          f_by_element[elem] = is_electron
            ? ELECTRON_FORM_FACTOR_CONST * sum_terms
            : Math.max(0, atomic_number - XRAY_GAUSSIAN_PREFACTOR * s_sq * sum_terms)
        }
        // Thermal damping is geometric, not electronic: it applies to every radiation
        if (has_debye_waller) dw_by_element[elem] = Math.exp(-dw * sin_theta_over_lambda_sq)
      }
    }

    // Structure factor sum: sum(fs * occu * exp(2πi g·r) * DW), accumulated into scalars in
    // the original order. The dot product is spelled out because math.dot re-derives its
    // operand shapes per call, which dominated runtime at millions of atom-reflection pairs.
    let f_real = 0
    let f_imag = 0
    for (let idx = 0; idx < n_species; idx++) {
      const elem = element_ids[idx]
      const frac = frac_coords[idx]
      const phase = 2 * Math.PI * (frac[0] * h_idx + frac[1] * k_idx + frac[2] * l_idx)
      const weight = f_by_element[elem] * occus[idx] * dw_by_element[elem]
      f_real += weight * Math.cos(phase)
      f_imag += weight * Math.sin(phase)
    }
    intensities[point_idx] = f_real * f_real + f_imag * f_imag
  }

  return intensities
}

export function compute_xrd_pattern(structure: Crystal, options: XrdOptions = {}): XrdPattern {
  const radiation: RadiationType = options.radiation ?? `xray`
  const wavelength = resolve_wavelength(
    radiation,
    options.wavelength,
    options.accelerating_voltage,
  )

  // Symmetry refinement (symprec > 0) is not implemented in TS version. Option retained for API parity.
  // For row-wise lattice matrix A (rows are a, b, c), reciprocal rows are inv(A)^T
  const recip_rows = math.transpose_3x3_matrix(
    math.matrix_inverse_3x3(structure.lattice.matrix),
  )

  // Bragg condition bounds: reciprocal vector length r = 2 sin(theta) / lambda.
  // Upper default is 90°, matching pymatgen's XRDCalculator: the powder Lorentz factor
  // 1/(sin²θ·|cosθ|) diverges as 2θ → 180°. The exact singularity is skipped below, but a
  // reflection landing just short of it still reports a huge intensity that becomes the
  // normalization maximum and pushes every real peak under scaled_intensity_tol — a cubic
  // cell with a = 1.000000001·λ puts one at 179.995° and scales its true 60° reflection to
  // 0.04. Only this default keeps that class out; pass an explicit range to go past 90°.
  const two_theta_range: Vec2 | null =
    options.two_theta_range === null ? null : (options.two_theta_range ?? [0, 90])
  const [min_radius, max_radius] =
    two_theta_range === null
      ? [0, 2 / wavelength]
      : two_theta_range.map(
          (angle) => (2 * Math.sin((angle / 2) * (Math.PI / 180))) / wavelength,
        )

  const recip_points = enumerate_reciprocal_points(
    recip_rows,
    structure.lattice.matrix,
    max_radius,
    min_radius,
  )

  const f_squared = structure_factors_squared(
    structure,
    radiation,
    options.debye_waller_factors ?? {},
    recip_points,
  )

  // Accumulate peaks by merging two_thetas within tolerance
  const peaks = new Map<number, { intensity: number; hkls: Hkl[]; d_hkl: number }>()
  const two_thetas: number[] = []
  const merge_tol = options.peak_merge_tol ?? TWO_THETA_TOL
  const scaled_tol = options.scaled_intensity_tol ?? SCALED_INTENSITY_TOL

  for (let point_idx = 0; point_idx < recip_points.length; point_idx++) {
    const { hkl, g_norm } = recip_points[point_idx]
    if (g_norm === 0) continue

    const asin_arg = (wavelength * g_norm) / 2
    // asin domain can exceed 1 by FP error — clamp to avoid NaN
    const clamped_asin_arg = Math.min(1, Math.max(-1, asin_arg))
    // Exact back-reflection is unobservable and its Lorentz denominator is genuinely 0, so
    // the clamp below would invent a ~2e12 intensity that then takes the normalization max
    // and drops every real reflection. Only a range reaching 180 enumerates it.
    if (clamped_asin_arg >= 1) continue
    const theta = Math.asin(clamped_asin_arg)

    const sin_theta = Math.sin(theta)
    const cos_theta = Math.cos(theta)
    // No clamp needed: theta = 0 is excluded by the g_norm check and theta = 90 by the
    // back-reflection skip, and the largest asin argument below 1 still leaves a
    // denominator of 1.5e-8, so this cannot reach zero.
    const denom = sin_theta * sin_theta * Math.abs(cos_theta)
    // Only X-rays pick up a polarization factor: the incident beam is partially polarized by
    // the scattering event itself, giving Lp = (1 + cos²2θ)/(sin²θ·|cosθ|). Nuclear neutron
    // scattering is isotropic and electron scattering off the Coulomb potential has no
    // equivalent term, so both use the bare powder Lorentz factor 1/(sin²θ·|cosθ|). Silently
    // reusing the X-ray form would over-weight low and high angles for neutrons.
    const polarization = radiation === `xray` ? 1 + Math.cos(2 * theta) ** 2 : 1
    const lorentz = polarization / denom
    const intensity_hkl = f_squared[point_idx] * lorentz
    const two_theta = math.to_degrees(2 * theta)

    // Merge peaks within tolerance. hkls stay 3-index (h, k, l) even for hexagonal
    // systems where pymatgen presents Miller–Bravais (h, k, i, l), matching consumers.
    const merge_key = two_thetas.find((angle) => Math.abs(angle - two_theta) < merge_tol)
    const existing = merge_key === undefined ? undefined : peaks.get(merge_key)
    if (existing) {
      existing.intensity += intensity_hkl
      existing.hkls.push(hkl)
    } else {
      peaks.set(two_theta, { intensity: intensity_hkl, hkls: [hkl], d_hkl: 1 / g_norm })
      two_thetas.push(two_theta)
    }
  }

  if (peaks.size === 0) return { x: [], y: [] }

  // Scale intensities so that the max intensity is 100, and filter by scaled tol.
  // Looped rather than spread: Math.max(...) over a large peak list can overflow the stack.
  let max_intensity = -Infinity
  for (const peak of peaks.values()) {
    if (peak.intensity > max_intensity) max_intensity = peak.intensity
  }

  const xs: number[] = []
  const ys: number[] = []
  const hkls_out: HklObj[][] = []
  const d_out: number[] = []

  // oxlint-disable-next-line eslint-plugin-unicorn/no-array-sort -- Array.from() returns a fresh array
  const sorted_peaks = Array.from(peaks).sort(([angle_a], [angle_b]) => angle_a - angle_b)
  for (const [angle, peak] of sorted_peaks) {
    if ((peak.intensity / max_intensity) * 100 <= scaled_tol) continue
    xs.push(angle)
    ys.push(peak.intensity)
    hkls_out.push(get_unique_families(peak.hkls))
    d_out.push(peak.d_hkl)
  }

  // Final scaling if requested. Divide by the true maximum, not max(1, ...): raw |F|² is
  // in electrons² for X-rays but fm² for neutrons and Å² for electrons, so a small b_coh
  // or a suppressed form factor puts every peak under 1 and a floor of 1 silently
  // under-scales the whole pattern (Mo Kα on a 2 Å H cell topped out at 43.6, not 100).
  // Looped rather than spread for the same stack-overflow reason as max_intensity above.
  if ((options.scaled ?? true) && ys.length > 0) {
    let max_y = -Infinity
    for (const val of ys) if (val > max_y) max_y = val
    if (max_y > 0) for (let idx = 0; idx < ys.length; idx++) ys[idx] = (ys[idx] / max_y) * 100
  }

  return { x: xs, y: ys, hkls: hkls_out, d_hkls: d_out }
}

// Process dropped file content and return an XRD pattern.
// Supports both direct XRD data files (.xy, .brml) and structure files
// (which are used to compute theoretical XRD patterns).
export async function add_xrd_pattern(
  content: string | ArrayBufferLike, // File content as string or ArrayBuffer
  filename: string, // Name of the file (used to detect format)
  wavelength: number | null, // Probe wavelength in Angstrom for structure-based calculation
  radiation: RadiationType = `xray`, // Probe particle for structure-based calculation
): Promise<{ pattern?: PatternEntry; error?: string }> {
  try {
    if (is_xrd_data_file(filename)) {
      // Convert ArrayBufferLike to ArrayBuffer if needed (handles SharedArrayBuffer)
      const buffer_content: string | ArrayBuffer =
        typeof content === `string` || content instanceof ArrayBuffer
          ? content
          : new Uint8Array(content).slice().buffer
      const pattern = await parse_xrd_file(buffer_content, filename)
      if (pattern && pattern.x.length > 0) {
        return { pattern: { label: filename || `XRD data`, pattern } }
      }
      // Strip .gz for the error message. Ternary (not ??) so an empty extension, from a
      // filename ending in `.`, also falls back to XRD.
      const last_part = filename.toLowerCase().replace(/\.gz$/, ``).split(`.`).pop()
      const ext = last_part ? last_part.toUpperCase() : `XRD`
      const format_hints: Record<string, string> = {
        XY: `Expected 2-column format: "2theta intensity" (space/tab/comma separated)`,
        XYE: `Expected 3-column format: "2theta intensity error" (space/tab/comma separated)`,
        BRML: `Expected Bruker RAW/BRML ZIP archive with RawData XML`,
        XRDML: `Expected PANalytical XRDML format with dataPoints section`,
      }
      const hint = format_hints[ext] || `Check file format and encoding`
      return { error: `Failed to parse ${ext} file: no valid data found. ${hint}` }
    }

    const text_content =
      typeof content === `string` ? content : new TextDecoder().decode(content)
    const parsed_structure = parse_any_structure(text_content, filename)
    if (is_crystal(parsed_structure)) {
      const pattern = compute_xrd_pattern(parsed_structure, {
        wavelength: typeof wavelength === `number` ? wavelength : undefined,
        radiation,
      })
      return { pattern: { label: filename || `Dropped structure`, pattern } }
    }
    return {
      error:
        `Cannot compute XRD: structure must have a lattice and atomic sites. ` +
        `Supported formats: CIF, POSCAR, JSON, XYZ`,
    }
  } catch (exc) {
    return { error: `Failed to compute XRD pattern: ${to_error(exc).message}` }
  }
}

export const AVAILABLE_RADIATION = Object.keys(WAVELENGTHS) as RadiationKey[]
