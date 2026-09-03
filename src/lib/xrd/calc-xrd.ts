import type { CompositionType } from '$lib/composition'
import { ELEMENTARY_CHARGE_C, PLANCK_J_S, SPEED_OF_LIGHT_M_S } from '$lib/constants'
import * as math from '$lib/math'
import type { Vec2 } from '$lib/math'
import type { RadiationType } from '$lib/scattering'
import {
  ELECTRON_FORM_FACTOR_CONST,
  form_factor_z,
  gaussian_params,
  gaussian_turning_point,
  neutron_scattering_length,
  scattering_length,
  XRAY_GAUSSIAN_PREFACTOR,
} from '$lib/scattering'
import type { Crystal } from '$lib/structure/index'
import { parse_structure_file } from '$lib/structure/parse'
import { is_crystal } from '$lib/structure/validation'
import { to_error } from '$lib/utils'
import type { Hkl, HklObj, PatternEntry, RecipPoint, XrdOptions, XrdPattern } from './index'
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

// Type guard to safely check if a string is a valid RadiationKey
const is_radiation_key = (key: string): key is RadiationKey => key in WAVELENGTHS

// Only consumer is electron_wavelength below, so it stays local. CODATA 2018, matching the
// vintage the frozen Mott-Bethe prefactor in $lib/scattering was evaluated at.
const ELECTRON_REST_MASS_KG = 9.1093837015e-31 // kg

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
  const rest_energy_joule = ELECTRON_REST_MASS_KG * SPEED_OF_LIGHT_M_S ** 2
  const kinetic_joule = ELEMENTARY_CHARGE_C * voltage_volts
  const momentum = Math.sqrt(
    2 * ELECTRON_REST_MASS_KG * kinetic_joule * (1 + kinetic_joule / (2 * rest_energy_joule)),
  )
  // h/p is in metres; 1 m = 1e10 Angstrom
  return (PLANCK_J_S / momentum) * 1e10
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
type LaueBound = { zone_axis: math.Vec3; max_laue: number }

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
  // Cap the point count, not max(h,k,l): the old index cap let electron wavelengths through
  // (rocksalt TiC over [0, 90]° gives h_max 246 but 6.1e7 points, ~8.5 GB)
  const estimated_points =
    (4 / 3) * Math.PI * max_radius ** 3 * Math.abs(math.det_3x3(direct_rows))
  const MAX_POINTS = 2e6
  // The loops sweep the enclosing BOX, whose ratio to the sphere is |a||b||c| / V, so an
  // oblique cell can pass the sphere cap while iterating orders of magnitude more
  const box_points = (2 * h_max + 1) * (2 * k_max + 1) * (2 * l_max + 1)
  const MAX_BOX_POINTS = 10 * MAX_POINTS
  if (estimated_points > MAX_POINTS || box_points > MAX_BOX_POINTS) {
    const over =
      estimated_points > MAX_POINTS
        ? `~${estimated_points.toPrecision(3)} reciprocal lattice points, past the ${MAX_POINTS} cap`
        : `an h/k/l box of ${box_points.toPrecision(3)} candidates, past the ${MAX_BOX_POINTS} cap`
    throw new Error(
      `enumerate_reciprocal_points: a sphere of radius ${max_radius.toPrecision(4)} 1/Å holds ` +
        `${over}. Narrow options.two_theta_range (or max_g) or use a longer options.wavelength.`,
    )
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

// Absolute significance floor for |F(g)|²: 1e-16 of (Σ_j |f_j(0)|·occu_j)², the largest |F|²
// any reflection can reach. Far above the sum's ~n·eps cancellation error, so a reflection
// under it (a systematic absence, say) carries no physically meaningful intensity.
export function structure_factor_noise_floor(
  structure: Crystal,
  radiation: RadiationType,
): number {
  let forward_sum = 0
  for (const { species } of structure.sites) {
    for (const { element, occu } of species) {
      forward_sum += Math.abs(scattering_length(element, radiation, 0)) * occu
    }
  }
  return 1e-16 * forward_sum ** 2
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
  const is_neutron = radiation === `neutron`
  const is_electron = radiation === `electron`

  // Scattering factors and Debye-Waller damping depend only on the element, so the sum is
  // F = Σ_e f_e(s)·dw_e(s)·S_e with S_e = Σ_{j∈e} occu_j·exp(2πi·hkl·r_j) the per-element
  // geometric sum. Species are therefore grouped by element: one (f, dw) evaluation per
  // element per reflection and an inner loop that is a bare complex multiply-accumulate.
  type ElementCoeffs = {
    a: Float64Array
    b: Float64Array
    z: number
    dw: number
    // s² past which the X-ray Gaussian fit turns back up toward Z instead of decaying
    // (see gaussian_turning_point in $lib/scattering)
    s_sq_max: number
    // Bound coherent neutron scattering length in fm (s-independent)
    b_coh: number
    // site-species of this element: fractional coords and occupancies
    coords: math.Vec3[]
    occus: number[]
  }
  const by_element = new Map<string, ElementCoeffs>()
  for (const site of structure.sites) {
    for (const { element: element_symbol, occu } of site.species) {
      let coeffs = by_element.get(element_symbol)
      if (coeffs === undefined) {
        // only X-rays read Z: neutrons scatter off the nucleus and the Mott-Bethe electron
        // form cancels it analytically
        const z = is_neutron || is_electron ? 0 : form_factor_z(element_symbol)
        const fit = is_neutron ? [] : gaussian_params(element_symbol)
        let b_coh = 0
        if (is_neutron) {
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
        coeffs = {
          a: Float64Array.from(fit, (row) => row[0]),
          b: Float64Array.from(fit, (row) => row[1]),
          z,
          dw: debye_waller_factors[element_symbol] ?? 0,
          s_sq_max: is_neutron ? Infinity : gaussian_turning_point(element_symbol),
          b_coh,
          coords: [],
          occus: [],
        }
        by_element.set(element_symbol, coeffs)
      }
      coeffs.coords.push(site.abc)
      coeffs.occus.push(occu)
    }
  }
  const elements = [...by_element.values()]
  const n_elements = elements.length
  // species laid out element by element: element e owns [elem_start[e], elem_start[e + 1])
  const elem_start = new Int32Array(n_elements + 1)
  for (let elem = 0; elem < n_elements; elem++) {
    elem_start[elem + 1] = elem_start[elem] + elements[elem].coords.length
  }
  const n_species = elem_start[n_elements]
  const coords = elements.flatMap((coeffs) => coeffs.coords)
  const occus = elements.flatMap((coeffs) => coeffs.occus)

  // exp(−0·s²) is exactly 1 for every finite s, so with no Debye-Waller factors supplied the
  // per-element Math.exp is skipped entirely
  const has_debye_waller = elements.some((coeffs) => coeffs.dw !== 0)

  // exp(2πi·hkl·r) = exp(2πi·h·x)·exp(2πi·k·y)·exp(2πi·l·z): tabulate the three factors per
  // species over the index range the reflections span, so the inner loop below does three
  // complex multiplies instead of a cos and a sin. Halves the time of a 444-site pattern.
  // The occupancy rides on the h-axis table, so the inner loop carries no weights at all.
  let [h_max, k_max, l_max] = [0, 0, 0]
  for (const { hkl } of reflections) {
    h_max = Math.max(h_max, Math.abs(hkl[0]))
    k_max = Math.max(k_max, Math.abs(hkl[1]))
    l_max = Math.max(l_max, Math.abs(hkl[2]))
  }
  const phase_table = (axis: number, max_idx: number, weights?: readonly number[]) => {
    const span = 2 * max_idx + 1
    const cos_table = new Float64Array(n_species * span)
    const sin_table = new Float64Array(n_species * span)
    for (let idx = 0; idx < n_species; idx++) {
      const weight = weights?.[idx] ?? 1
      for (let miller = -max_idx; miller <= max_idx; miller++) {
        const phase = 2 * Math.PI * miller * coords[idx][axis]
        cos_table[idx * span + miller + max_idx] = weight * Math.cos(phase)
        sin_table[idx * span + miller + max_idx] = weight * Math.sin(phase)
      }
    }
    return { cos_table, sin_table, span }
  }
  const { cos_table: cos_h, sin_table: sin_h, span: span_h } = phase_table(0, h_max, occus)
  const { cos_table: cos_k, sin_table: sin_k, span: span_k } = phase_table(1, k_max)
  const { cos_table: cos_l, sin_table: sin_l, span: span_l } = phase_table(2, l_max)

  const intensities = new Float64Array(reflections.length)

  for (let point_idx = 0; point_idx < reflections.length; point_idx++) {
    const { hkl, g_norm } = reflections[point_idx]
    const h_offset = hkl[0] + h_max
    const k_offset = hkl[1] + k_max
    const l_offset = hkl[2] + l_max
    const s_sq_point = (g_norm / 2) ** 2

    let f_real = 0
    let f_imag = 0
    for (let elem = 0; elem < n_elements; elem++) {
      const { a: a_arr, b: b_arr, z: atomic_number, dw, s_sq_max, b_coh } = elements[elem]
      // Atomic scattering factor. X-rays see f = Z − XRAY_GAUSSIAN_PREFACTOR·s²·Σ aᵢ·exp(−bᵢ·s²)
      // (pymatgen fitted params); the Mott–Bethe electron form cancels that s² analytically
      // (see $lib/scattering), so both share one sum_terms. Neutrons see the constant b_coh.
      let factor = b_coh
      if (!is_neutron) {
        // The X-ray fit is only valid below its turning point; past it the expression climbs
        // back to +Z instead of decaying to 0 (see xray_form_factor in $lib/scattering). Hold it
        // flat there and floor at 0. The Mott-Bethe electron form has no such issue - the s²
        // cancels, leaving a monotone Gaussian sum.
        const s_sq = is_electron ? s_sq_point : Math.min(s_sq_point, s_sq_max)
        let sum_terms = 0
        for (let term = 0; term < a_arr.length; term++) {
          sum_terms += a_arr[term] * Math.exp(-b_arr[term] * s_sq)
        }
        factor = is_electron
          ? ELECTRON_FORM_FACTOR_CONST * sum_terms
          : Math.max(0, atomic_number - XRAY_GAUSSIAN_PREFACTOR * s_sq * sum_terms)
      }
      // Thermal damping is geometric, not electronic: it applies to every radiation
      if (has_debye_waller) factor *= Math.exp(-dw * s_sq_point)

      // S_e = Σ occu·exp(2πi·hkl·r) over this element's species, phase factor assembled from
      // the per-axis tables (occupancy already folded into the h table)
      let sum_real = 0
      let sum_imag = 0
      for (let idx = elem_start[elem]; idx < elem_start[elem + 1]; idx++) {
        const h_at = idx * span_h + h_offset
        const k_at = idx * span_k + k_offset
        const l_at = idx * span_l + l_offset
        const re_hk = cos_h[h_at] * cos_k[k_at] - sin_h[h_at] * sin_k[k_at]
        const im_hk = cos_h[h_at] * sin_k[k_at] + sin_h[h_at] * cos_k[k_at]
        sum_real += re_hk * cos_l[l_at] - im_hk * sin_l[l_at]
        sum_imag += re_hk * sin_l[l_at] + im_hk * cos_l[l_at]
      }
      f_real += factor * sum_real
      f_imag += factor * sum_imag
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

  const recip_rows = math.reciprocal_lattice(structure.lattice.matrix)

  // Bragg condition bounds: reciprocal vector length r = 2 sin(theta) / lambda.
  // Upper default is 90°, matching pymatgen's XRDCalculator: the powder Lorentz factor
  // 1/(sin²θ·|cosθ|) diverges as 2θ → 180°. The exact singularity is skipped below, but a
  // reflection landing just short of it still reports a huge intensity that becomes the
  // normalization maximum and pushes every real peak under scaled_intensity_tol — a cubic
  // cell with a = 1.000000001·λ puts one at 179.995° and scales its true 60° reflection to
  // 0.04. Only this default keeps that class out; pass an explicit range to go past 90°.
  // Electrons need their own default: at 200 kV λ = 0.0251 Å, 90° is 6.1e7 reflections for
  // rocksalt TiC, while a TEM pattern lives at a few degrees (TiC [200] sits at 0.68°).
  const default_range: Vec2 = radiation === `electron` ? [0, 5] : [0, 90]
  const two_theta_range: Vec2 | null =
    options.two_theta_range === null ? null : (options.two_theta_range ?? default_range)
  const [min_radius, max_radius] =
    two_theta_range === null
      ? [0, 2 / wavelength]
      : two_theta_range.map((angle) => (2 * Math.sin(math.to_radians(angle / 2))) / wavelength)

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

  // Accumulate peaks by merging two_thetas within tolerance. Reflections arrive sorted by
  // |g|, so 2θ is non-decreasing and a reflection can only ever merge into the LAST peak:
  // consecutive peak keys are ≥ merge_tol apart, so anything within tolerance of an earlier
  // peak would be even closer to the last one. Scanning every peak was O(reflections × peaks)
  // and took 50 ms of a 275 ms pattern for a 444-site cell.
  const peaks: { two_theta: number; intensity: number; hkls: Hkl[]; d_hkl: number }[] = []
  const merge_tol = options.peak_merge_tol ?? TWO_THETA_TOL
  let max_f_squared = 0
  const scaled_tol = options.scaled_intensity_tol ?? SCALED_INTENSITY_TOL

  for (let point_idx = 0; point_idx < recip_points.length; point_idx++) {
    const { hkl, g_norm } = recip_points[point_idx]
    if (g_norm === 0) continue

    const asin_arg = (wavelength * g_norm) / 2
    // asin domain can exceed 1 by FP error — clamp to avoid NaN
    const clamped_asin_arg = math.clamp(asin_arg, -1, 1)
    // Exact back-reflection is unobservable and its Lorentz denominator is genuinely 0, so
    // the clamp below would invent a ~2e12 intensity that then takes the normalization max
    // and drops every real reflection. Only a range reaching 180 enumerates it.
    if (clamped_asin_arg >= 1) continue
    if (f_squared[point_idx] > max_f_squared) max_f_squared = f_squared[point_idx]
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

    // hkls stay 3-index (h, k, l) even for hexagonal systems where pymatgen presents
    // Miller–Bravais (h, k, i, l), matching consumers.
    const last = peaks.at(-1)
    if (last && Math.abs(last.two_theta - two_theta) < merge_tol) {
      last.intensity += intensity_hkl
      last.hkls.push(hkl)
    } else peaks.push({ two_theta, intensity: intensity_hkl, hkls: [hkl], d_hkl: 1 / g_norm })
  }

  if (peaks.length === 0) return { x: [], y: [] }
  // Tolerance filter and scaling are both relative, so a window in which every reflection is
  // extinct normalizes cancellation error to 100% (fcc Al over [20, 33]° at Cu Kα emitted a
  // forbidden (100) at y = 100 from a raw |F|² of 2.1e-27)
  if (max_f_squared < structure_factor_noise_floor(structure, radiation))
    return { x: [], y: [] }

  // Scale intensities so that the max intensity is 100, and filter by scaled tol
  const max_intensity = math.array_max(peaks.map((peak) => peak.intensity))

  const xs: number[] = []
  const ys: number[] = []
  const hkls_out: HklObj[][] = []
  const d_out: number[] = []

  // Already in ascending 2θ: peaks were appended in |g| order
  for (const peak of peaks) {
    if ((peak.intensity / max_intensity) * 100 <= scaled_tol) continue
    xs.push(peak.two_theta)
    ys.push(peak.intensity)
    hkls_out.push(get_unique_families(peak.hkls))
    d_out.push(peak.d_hkl)
  }

  // Final scaling if requested. Divide by the true maximum, not max(1, ...): raw |F|² is
  // in electrons² for X-rays but fm² for neutrons and Å² for electrons, so a small b_coh
  // or a suppressed form factor puts every peak under 1 and a floor of 1 silently
  // under-scales the whole pattern (Mo Kα on a 2 Å H cell topped out at 43.6, not 100).
  if (options.scaled ?? true) {
    const max_y = math.array_max(ys)
    if (max_y > 0) for (let idx = 0; idx < ys.length; idx++) ys[idx] = (ys[idx] / max_y) * 100
  }

  return { x: xs, y: ys, hkls: hkls_out, d_hkls: d_out }
}

// Dropped file content as a plot entry: measured data files (.xy, .brml, …) are parsed,
// structure files (CIF, POSCAR, JSON, …) get a computed pattern. Throws on anything it cannot
// read; the drop handler that calls this reports the error with the filename.
export async function add_xrd_pattern(
  content: string | ArrayBufferLike,
  filename: string,
  wavelength: number | null, // Probe wavelength in Angstrom for structure-based calculation
  radiation: RadiationType = `xray`, // Probe particle for structure-based calculation
): Promise<PatternEntry> {
  if (is_xrd_data_file(filename)) {
    // SharedArrayBuffer-backed content is copied into a plain ArrayBuffer
    const buffer_content: string | ArrayBuffer =
      typeof content === `string` || content instanceof ArrayBuffer
        ? content
        : new Uint8Array(content).slice().buffer
    return { label: filename, pattern: await parse_xrd_file(buffer_content, filename) }
  }

  const text_content =
    typeof content === `string` ? content : new TextDecoder().decode(content)
  const parsed_structure = parse_structure_file(text_content, filename)
  if (!is_crystal(parsed_structure)) {
    throw new Error(
      `Cannot compute XRD: structure must have a lattice and atomic sites. ` +
        `Supported formats: CIF, POSCAR, JSON, XYZ`,
    )
  }
  const pattern = compute_xrd_pattern(parsed_structure, {
    wavelength: typeof wavelength === `number` ? wavelength : undefined,
    radiation,
  })
  return { label: filename || `Dropped structure`, pattern }
}
