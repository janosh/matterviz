import type { CompositionType } from '#lib/composition/index.js'
import { ELEMENTARY_CHARGE_C, PLANCK_J_S, SPEED_OF_LIGHT_M_S } from '#lib/constants.js'
import * as math from '#lib/math.js'
import type { Vec2 } from '#lib/math.js'
import type { RadiationType } from '#lib/scattering/index.js'
import {
  ELECTRON_FORM_FACTOR_CONST,
  form_factor_z,
  gaussian_params,
  gaussian_turning_point,
  neutron_scattering_length,
  scattering_length,
  XRAY_GAUSSIAN_PREFACTOR,
} from '#lib/scattering/index.js'
import type { AnyStructure, Crystal } from '#lib/structure/index.js'
import { is_crystal } from '#lib/structure/validation.js'
import { analyze_structure_symmetry, point_group_rotations } from '#lib/symmetry/analyze.js'
import { to_error } from 'svelte-widgets/utils'
import type { Hkl, HklObj, RecipPoint, XrdOptions, XrdPattern } from './index'

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

const is_radiation_key = (key: string): key is RadiationKey => key in WAVELENGTHS

// CODATA 2018, the vintage the frozen Mott-Bethe prefactor in #lib/scattering was evaluated at
const ELECTRON_REST_MASS_KG = 9.1093837015e-31

// Echoes the offending value so NaN from a bad parse is distinguishable from a negative literal
export function require_positive(name: string, value: number, unit = ``): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}: ${value}. Must be a finite positive number${unit}.`)
  }
  return value
}

// Relativistic electron wavelength in Å at `voltage_kv`: λ = h / sqrt(2·m0·e·V·(1 + eV/2m0c²)).
// The relativistic term shortens λ by 9% at 200 kV (0.0274 → 0.0251 Å).
export function electron_wavelength(voltage_kv: number): number {
  require_positive(`accelerating voltage`, voltage_kv, ` of kV`)
  const rest_energy_joule = ELECTRON_REST_MASS_KG * SPEED_OF_LIGHT_M_S ** 2
  const kinetic_joule = ELEMENTARY_CHARGE_C * (voltage_kv * 1000)
  const momentum = Math.sqrt(
    2 * ELECTRON_REST_MASS_KG * kinetic_joule * (1 + kinetic_joule / (2 * rest_energy_joule)),
  )
  return (PLANCK_J_S / momentum) * 1e10 // m → Å
}

// Wavelength in Å for a radiation type, rejecting nonsensical combinations (e.g. neutrons
// with a Cu anode wavelength)
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

// Miller indices transform under a direct-space rotation W (x' = W·x + w) as h' = W⁻ᵀ·h, an
// integer matrix since W is unimodular. Flat (9 row-major entries per distinct W⁻ᵀ) for the hot
// loop in get_unique_families; deduped as supercells repeat each W per lattice translation.
function reciprocal_rotations(rotations: readonly math.Matrix3x3[]): number[] {
  if (rotations.length === 0) {
    throw new Error(
      `symmetry_rotations is empty. Every point group contains the identity; omit the ` +
        `option to group Friedel pairs only.`,
    )
  }
  const flat: number[] = []
  const seen = new Set<string>()
  for (const rotation of rotations) {
    const det = math.det_3x3(rotation)
    if (!rotation.flat().every(Number.isInteger) || Math.abs(det) !== 1) {
      throw new Error(
        `symmetry_rotations must hold the integer rotation parts W (det ±1) of the ` +
          `space-group operations in the structure's fractional basis, got ` +
          `${JSON.stringify(rotation)} with det ${det}`,
      )
    }
    const inv_transposed = math
      .transpose_3x3_matrix(math.matrix_inverse_3x3(rotation))
      .flat()
      .map(Math.round)
    const key = inv_transposed.join(`,`)
    if (seen.has(key)) continue
    seen.add(key)
    flat.push(...inv_transposed)
  }
  return flat
}

const compare_hkl = (hkl_1: Hkl, hkl_2: Hkl): number =>
  hkl_1[0] - hkl_2[0] || hkl_1[1] - hkl_2[1] || hkl_1[2] - hkl_2[2]

// Point group 1: families reduce to Friedel pairs
const IDENTITY_ROTATION = [1, 0, 0, 0, 1, 0, 0, 0, 1]

// Group one peak's hkls into families: hkl ~ hkl' when hkl' = ±W⁻ᵀ·hkl for a point-group
// rotation W (± folds in Friedel pairs). Never touches intensities. Family key = smallest image,
// representative = largest member (lexicographic), families sorted by representative.
function get_unique_families(hkls: Hkl[], recip_rotations: readonly number[]): HklObj[] {
  const families = new Map<string, { hkl: Hkl; multiplicity: number }>()
  for (const hkl of hkls) {
    const [h_idx, k_idx, l_idx] = hkl
    let [min_h, min_k, min_l] = [Infinity, Infinity, Infinity]
    for (let offset = 0; offset < recip_rotations.length; offset += 9) {
      const img_h =
        recip_rotations[offset] * h_idx +
        recip_rotations[offset + 1] * k_idx +
        recip_rotations[offset + 2] * l_idx
      const img_k =
        recip_rotations[offset + 3] * h_idx +
        recip_rotations[offset + 4] * k_idx +
        recip_rotations[offset + 5] * l_idx
      const img_l =
        recip_rotations[offset + 6] * h_idx +
        recip_rotations[offset + 7] * k_idx +
        recip_rotations[offset + 8] * l_idx
      // the smaller of the image and its Friedel mate has a negative leading nonzero index
      const sign = (img_h || img_k || img_l) > 0 ? -1 : 1
      const [cand_h, cand_k, cand_l] = [sign * img_h, sign * img_k, sign * img_l]
      if ((cand_h - min_h || cand_k - min_k || cand_l - min_l) < 0) {
        ;[min_h, min_k, min_l] = [cand_h, cand_k, cand_l]
      }
    }
    const key = `${min_h},${min_k},${min_l}`
    const family = families.get(key)
    if (!family) families.set(key, { hkl, multiplicity: 1 })
    else {
      family.multiplicity++
      if (compare_hkl(hkl, family.hkl) > 0) family.hkl = hkl
    }
  }
  return [...families.values()].toSorted((fam_1, fam_2) => compare_hkl(fam_1.hkl, fam_2.hkl))
}

// SAED: only |h·u + k·v + l·w| <= max_laue can be excited; tested in the triple loop, it
// rejects the bulk of the sphere before any reciprocal vector is formed
type LaueBound = { zone_axis: math.Vec3; max_laue: number }

export function enumerate_reciprocal_points(
  recip_rows: math.Matrix3x3,
  direct_rows: math.Matrix3x3,
  max_radius: number,
  min_radius: number,
  laue_bound?: LaueBound,
): RecipPoint[] {
  const [[b1_x, b1_y, b1_z], [b2_x, b2_y, b2_z], [b3_x, b3_y, b3_z]] = recip_rows
  // Exact bound |h_i| = |g·a_i| ≤ R·|a_i|; R/|b_i| + 2 undercounts for skewed cells
  const [h_max, k_max, l_max] = direct_rows.map(
    (row) => Math.ceil(max_radius * Math.hypot(...row)) + 1,
  )
  // Cap the point count, not max(h,k,l): rocksalt TiC at 200 kV over [0, 90]° has h_max 246
  // but 6.1e7 points (~8.5 GB)
  const estimated_points =
    (4 / 3) * Math.PI * max_radius ** 3 * Math.abs(math.det_3x3(direct_rows))
  const MAX_POINTS = 2e6
  // The loops sweep the enclosing box (|a||b||c| / V times the sphere), so oblique cells need
  // their own cap
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
        // Scalars, not a Vec3: allocating g per candidate cost 11.6 MB for a 55k-point sphere
        const g_x = h_idx * b1_x + k_idx * b2_x + l_idx * b3_x
        const g_y = h_idx * b1_y + k_idx * b2_y + l_idx * b3_y
        const g_z = h_idx * b1_z + k_idx * b2_z + l_idx * b3_z
        const g_norm = Math.hypot(g_x, g_y, g_z)
        if (g_norm < min_radius || g_norm > max_radius) continue
        points.push({ hkl: [h_idx, k_idx, l_idx], g_norm })
      }
    }
  }
  // (g_norm asc, -h, -k, -l) to mimic pymatgen ordering
  points.sort(
    (point_1, point) =>
      point_1.g_norm - point.g_norm ||
      point.hkl[0] - point_1.hkl[0] ||
      point.hkl[1] - point_1.hkl[1] ||
      point.hkl[2] - point_1.hkl[2],
  )
  return points
}

// Significance floor for |F|²: 1e-16 of its upper bound (Σ_j |f_j(0)|·occu_j)², far above the
// sum's ~n·eps cancellation error, so anything below it (e.g. a systematic absence) is noise
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

// |F(hkl)|² per reflection, F = Σⱼ fⱼ(s)·occuⱼ·exp(2πi·hkl·rⱼ)·exp(−Bⱼ·s²), s = |g|/2.
// Shared by powder and SAED. Units differ per radiation (electrons², fm², Å²), which every
// consumer cancels by rescaling to a maximum of 100.
export function structure_factors_squared(
  structure: Crystal,
  radiation: RadiationType,
  debye_waller_factors: CompositionType,
  reflections: readonly RecipPoint[],
): Float64Array {
  const is_neutron = radiation === `neutron`
  const is_electron = radiation === `electron`

  // f and Debye-Waller depend only on the element, so F = Σ_e f_e·dw_e·S_e with S_e the
  // per-element geometric sum: one (f, dw) evaluation per element per reflection
  type ElementCoeffs = {
    a_coeffs: Float64Array
    b_coeffs: Float64Array
    atomic_number: number
    debye_waller: number
    // s² past which the X-ray Gaussian fit turns back up toward Z (gaussian_turning_point)
    s_sq_max: number
    b_coh: number // bound coherent neutron scattering length in fm
    coords: math.Vec3[] // fractional coords and occupancies of this element's site-species
    occus: number[]
  }
  const by_element = new Map<string, ElementCoeffs>()
  for (const site of structure.sites) {
    for (const { element: element_symbol, occu } of site.species) {
      let coeffs = by_element.get(element_symbol)
      if (coeffs === undefined) {
        // only X-rays read Z: the Mott-Bethe electron form cancels it analytically
        const atomic_number = is_neutron || is_electron ? 0 : form_factor_z(element_symbol)
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
          a_coeffs: Float64Array.from(fit, (row) => row[0]),
          b_coeffs: Float64Array.from(fit, (row) => row[1]),
          atomic_number,
          debye_waller: debye_waller_factors[element_symbol] ?? 0,
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
  // element e owns species [elem_start[e], elem_start[e + 1])
  const elem_start = new Int32Array(n_elements + 1)
  for (let elem = 0; elem < n_elements; elem++) {
    elem_start[elem + 1] = elem_start[elem] + elements[elem].coords.length
  }
  const n_species = elem_start[n_elements]
  const coords = elements.flatMap((coeffs) => coeffs.coords)
  const occus = elements.flatMap((coeffs) => coeffs.occus)

  // exp(−0·s²) is exactly 1, so skip the per-element Math.exp without Debye-Waller factors
  const has_debye_waller = elements.some((coeffs) => coeffs.debye_waller !== 0)

  // exp(2πi·hkl·r) factorizes per axis: tabulating the three factors per species turns the
  // inner loop's cos + sin into complex multiplies (2x faster for 444 sites). Occupancy rides
  // on the h table.
  let [h_max, k_max, l_max] = [0, 0, 0]
  for (const { hkl } of reflections) {
    if (!hkl.every(Number.isInteger)) {
      throw new Error(
        `structure_factors_squared: Miller indices must be finite integers, got hkl=${hkl.join(`,`)}`,
      )
    }
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
        cos_table[(miller + max_idx) * n_species + idx] = weight * Math.cos(phase)
        sin_table[(miller + max_idx) * n_species + idx] = weight * Math.sin(phase)
      }
    }
    return { cos_table, sin_table }
  }
  const { cos_table: cos_h, sin_table: sin_h } = phase_table(0, h_max, occus)
  const { cos_table: cos_k, sin_table: sin_k } = phase_table(1, k_max)
  const { cos_table: cos_l, sin_table: sin_l } = phase_table(2, l_max)

  const intensities = new Float64Array(reflections.length)
  // Real f and isotropic damping give Friedel mates identical |F|². Reuse only on equal g_norm
  // (callers may pass custom reflections); below 64 species the lookup costs more than the sum.
  const friedel_intensities =
    n_species >= 64 ? new Map<string, { g_norm: number; intensity: number }>() : undefined

  for (let point_idx = 0; point_idx < reflections.length; point_idx++) {
    const { hkl, g_norm } = reflections[point_idx]
    let reflection_key = ``
    if (friedel_intensities) {
      const friedel_sign = (hkl[0] || hkl[1] || hkl[2]) < 0 ? -1 : 1
      reflection_key = `${hkl[0] * friedel_sign},${hkl[1] * friedel_sign},${hkl[2] * friedel_sign}`
      const previous = friedel_intensities.get(reflection_key)
      if (previous?.g_norm === g_norm) {
        intensities[point_idx] = previous.intensity
        continue
      }
    }
    const h_offset = (hkl[0] + h_max) * n_species
    const k_offset = (hkl[1] + k_max) * n_species
    const l_offset = (hkl[2] + l_max) * n_species
    const s_sq_point = (g_norm / 2) ** 2

    let f_real = 0
    let f_imag = 0
    for (let elem = 0; elem < n_elements; elem++) {
      const { a_coeffs, b_coeffs, atomic_number, debye_waller, s_sq_max, b_coh } =
        elements[elem]
      // X-rays: f = Z − XRAY_GAUSSIAN_PREFACTOR·s²·Σ aᵢ·exp(−bᵢ·s²); Mott–Bethe electrons cancel
      // the s², sharing sum_terms; neutrons see the constant b_coh
      let factor = b_coh
      if (!is_neutron) {
        // Past its turning point the X-ray fit climbs back to +Z, so hold s² there and floor
        // f at 0. The electron form is a monotone Gaussian sum and needs neither.
        const s_sq = is_electron ? s_sq_point : Math.min(s_sq_point, s_sq_max)
        let sum_terms = 0
        for (let term = 0; term < a_coeffs.length; term++) {
          sum_terms += a_coeffs[term] * Math.exp(-b_coeffs[term] * s_sq)
        }
        factor = is_electron
          ? ELECTRON_FORM_FACTOR_CONST * sum_terms
          : Math.max(0, atomic_number - XRAY_GAUSSIAN_PREFACTOR * s_sq * sum_terms)
      }
      // Thermal damping is geometric, so it applies to every radiation
      if (has_debye_waller) factor *= Math.exp(-debye_waller * s_sq_point)

      // S_e = Σ occu·exp(2πi·hkl·r) over this element's species
      let sum_real = 0
      let sum_imag = 0
      for (let idx = elem_start[elem]; idx < elem_start[elem + 1]; idx++) {
        const h_at = h_offset + idx
        const k_at = k_offset + idx
        const l_at = l_offset + idx
        const re_hk = cos_h[h_at] * cos_k[k_at] - sin_h[h_at] * sin_k[k_at]
        const im_hk = cos_h[h_at] * sin_k[k_at] + sin_h[h_at] * cos_k[k_at]
        sum_real += re_hk * cos_l[l_at] - im_hk * sin_l[l_at]
        sum_imag += re_hk * sin_l[l_at] + im_hk * cos_l[l_at]
      }
      f_real += factor * sum_real
      f_imag += factor * sum_imag
    }
    intensities[point_idx] = f_real * f_real + f_imag * f_imag
    friedel_intensities?.set(reflection_key, { g_norm, intensity: intensities[point_idx] })
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
  // Without rotations, families fall back to Friedel pairs (recorded in family_grouping)
  const { symmetry_rotations } = options
  const recip_rotations = symmetry_rotations
    ? reciprocal_rotations(symmetry_rotations)
    : IDENTITY_ROTATION

  const recip_rows = math.reciprocal_lattice(structure.lattice.matrix)

  // Bragg bound |g| = 2 sin(θ) / λ. Default 90° like pymatgen: the Lorentz factor diverges as
  // 2θ → 180°, so a reflection just short of it (a = 1.000000001·λ puts one at 179.995°) takes
  // the normalization max and scales real peaks to ~0.04. Electrons default to [0, 5]: at
  // 200 kV, 90° is 6.1e7 reflections for TiC whose [200] sits at 0.68°.
  const default_range: Vec2 = radiation === `electron` ? [0, 5] : [0, 90]
  const two_theta_range: Vec2 | null =
    options.two_theta_range === null ? null : (options.two_theta_range ?? default_range)
  // |g| peaks at 180° and falls past it, so [0, 200] would silently act as a 160° cap
  if (two_theta_range !== null) {
    const [min_angle, max_angle] = two_theta_range
    if (!(min_angle >= 0 && max_angle > min_angle && max_angle <= 180)) {
      throw new Error(
        `Invalid two_theta_range [${two_theta_range}]. Expected 0 <= min < max <= 180 degrees.`,
      )
    }
  }
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

  // Merge 2θs within tolerance. Reflections arrive sorted by |g|, so 2θ is non-decreasing and
  // a reflection can only merge into the last peak (scanning all peaks cost 50 of 275 ms).
  const peaks: { two_theta: number; intensity: number; hkls: Hkl[]; d_hkl: number }[] = []
  const merge_tol = options.peak_merge_tol ?? TWO_THETA_TOL
  let max_f_squared = 0
  const scaled_tol = options.scaled_intensity_tol ?? SCALED_INTENSITY_TOL

  for (let point_idx = 0; point_idx < recip_points.length; point_idx++) {
    const { hkl, g_norm } = recip_points[point_idx]
    if (g_norm === 0) continue

    // clamp: FP error can push the asin argument past 1
    const clamped_asin_arg = math.clamp((wavelength * g_norm) / 2, -1, 1)
    // Exact back-reflection is unobservable with a zero Lorentz denominator: keeping it would
    // invent a huge intensity that takes the normalization max
    if (clamped_asin_arg >= 1) continue
    if (f_squared[point_idx] > max_f_squared) max_f_squared = f_squared[point_idx]
    const theta = Math.asin(clamped_asin_arg)

    const sin_theta = Math.sin(theta)
    // Never zero: θ = 0 and 90° are skipped above, leaving a denominator of at least 1.5e-8
    const denom = sin_theta * sin_theta * Math.abs(Math.cos(theta))
    // Only X-rays get the polarization term (1 + cos²2θ): nuclear neutron and Coulomb electron
    // scattering use the bare powder Lorentz factor 1/(sin²θ·|cosθ|)
    const polarization = radiation === `xray` ? 1 + Math.cos(2 * theta) ** 2 : 1
    const intensity_hkl = f_squared[point_idx] * (polarization / denom)
    const two_theta = math.to_degrees(2 * theta)

    // hkls stay 3-index even for hexagonal cells where pymatgen uses Miller–Bravais (hkil)
    const last = peaks.at(-1)
    if (last && Math.abs(last.two_theta - two_theta) < merge_tol) {
      last.intensity += intensity_hkl
      last.hkls.push(hkl)
    } else peaks.push({ two_theta, intensity: intensity_hkl, hkls: [hkl], d_hkl: 1 / g_norm })
  }

  // Filter and scaling are relative, so an all-extinct window would normalize cancellation
  // error to 100 (fcc Al over [20, 33]° at Cu Kα emitted a forbidden (100) from |F|² = 2e-27)
  if (peaks.length === 0 || max_f_squared < structure_factor_noise_floor(structure, radiation))
    return { x: [], y: [] }

  const max_intensity = math.array_max(peaks.map((peak) => peak.intensity))
  const x_values: number[] = []
  const y_values: number[] = []
  const hkls_out: HklObj[][] = []
  const d_out: number[] = []
  for (const peak of peaks) {
    if ((peak.intensity / max_intensity) * 100 <= scaled_tol) continue
    x_values.push(peak.two_theta)
    y_values.push(peak.intensity)
    hkls_out.push(get_unique_families(peak.hkls, recip_rotations))
    d_out.push(peak.d_hkl)
  }

  // Divide by the true max, not max(1, ...): with fm² or Å² units every peak can sit under 1
  // (Mo Kα on a 2 Å H cell topped out at 43.6, not 100)
  if (options.scaled ?? true) {
    const max_y = math.array_max(y_values)
    if (max_y > 0)
      for (let idx = 0; idx < y_values.length; idx++)
        y_values[idx] = (y_values[idx] / max_y) * 100
  }

  const family_grouping = symmetry_rotations ? `symmetry` : `friedel`
  return { x: x_values, y: y_values, hkls: hkls_out, d_hkls: d_out, family_grouping }
}

// symprec in Å. Tight on purpose: a loose one can merge reflections of different intensity,
// a too tight one only splits families.
const XRD_SYMPREC = 1e-5

// Point-group rotations for options.symmetry_rotations (async: moyo-wasm init)
export async function xrd_symmetry_rotations(structure: Crystal): Promise<math.Matrix3x3[]> {
  const { operations } = await analyze_structure_symmetry(structure, { symprec: XRD_SYMPREC })
  return point_group_rotations(operations)
}

// Pattern of a dropped structure, with its point group merging equivalent reflections.
// Throws for anything without a lattice and sites.
export async function structure_xrd_pattern(
  structure: AnyStructure,
  wavelength: number | null, // Probe wavelength in Angstrom, null for the radiation's default
  radiation: RadiationType = `xray`,
): Promise<XrdPattern> {
  if (!is_crystal(structure)) {
    throw new Error(`Cannot compute XRD: structure must have a lattice and atomic sites`)
  }
  return compute_xrd_pattern(structure, {
    wavelength: wavelength ?? undefined,
    radiation,
    symmetry_rotations: await xrd_symmetry_rotations(structure),
  })
}
