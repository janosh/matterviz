// Pourbaix (E–pH) diagrams of one or two metals in water. Every species gets its formation
// free energy from the metals and water as a plane over (pH, E), normalized per metal atom;
// with two metals, species mix pairwise to the given composition. The lower envelope of
// those planes splits the window into convex domains, each found by clipping the window
// rectangle with the half-planes where its phase beats every other.
// (The N-D Chebyshev-centre/quickhull machinery of chempot-diagram/compute.ts assumes
// non-negative composition normals; Pourbaix planes have signed slopes and need only 2D.)
import {
  normalize_formula_unicode,
  parse_formula_with_oxidation,
} from '#lib/composition/parse.js'
import { BOLTZMANN_EV_PER_K, EV_TO_KJ_PER_MOL } from '#lib/constants.js'
import { lerp_vec2, polygon_signed_area, type Vec2 } from '#lib/math.js'
import type {
  PourbaixConditions,
  PourbaixConfig,
  PourbaixDiagramData,
  PourbaixDomain,
  PourbaixEntry,
  PourbaixPlane,
} from './types'

export const POURBAIX_DEFAULTS = {
  log_conc: -6,
  temperature: 298.15,
  ph_range: [-2, 16] as Vec2,
  potential_range: [-2, 2.5] as Vec2,
  // ΔfG°(H2O, l) = -237.14 kJ/mol (CODATA Key Values for Thermodynamics, Cox, Wagman &
  // Medvedev 1989), in eV per H2O
  water_energy: -237.14 / EV_TO_KJ_PER_MOL,
} as const

// Planes or offsets closer than this (eV per metal atom) count as equal
const PLANE_TOL = 1e-12
// Metal fractions closer than this count as the same composition
const FRACTION_TOL = 1e-9
// Domains below this fraction of the window area are tie lines or points, not regions
const MIN_AREA_FRACTION = 1e-9

// kT·ln(10) in eV: the Nernst slope (V per pH unit, per decade of activity) at `temperature`
export const nernst_slope = (temperature: number): number =>
  BOLTZMANN_EV_PER_K * temperature * Math.LN10

// Trailing signed caret charge (an unsigned `Fe^2` is ambiguous)
const CHARGE_SUFFIX_RE = /\^(?<charge>[+-]\d+|\d+[+-]|[+-])$/

// Composition and charge of a species formula with an optional trailing charge (`Fe^3+`,
// `Fe³⁺`, `HFeO2^-`) or `(aq)` mark; dissolved means charged or marked. A charge anywhere
// else (`Fe^2+O`) is an error, not an oxidation state: a species carries one net charge.
export function parse_species(formula: string) {
  const normalized = normalize_formula_unicode(formula)
  const marked_aq = normalized.endsWith(`(aq)`)
  const unmarked = marked_aq ? normalized.slice(0, -4) : normalized
  const match = CHARGE_SUFFIX_RE.exec(unmarked)
  const charge_str = match?.groups?.charge
  const charge = charge_str
    ? (charge_str.includes(`-`) ? -1 : 1) * Number(charge_str.replaceAll(/[+-]/g, ``) || 1)
    : 0
  const composition: Record<string, number> = {}
  for (const token of parse_formula_with_oxidation(unmarked.slice(0, match?.index))) {
    if (token.oxidation_state !== undefined) {
      throw new Error(
        `Species ${formula} must give its charge as one trailing suffix like ^2+`,
      )
    }
    composition[token.element] = (composition[token.element] ?? 0) + token.amount
  }
  return { composition, charge, aqueous: marked_aq || charge !== 0 }
}

// Pourbaix energy plane of one species per metal atom (see PourbaixPlane). Formation from
// the metal and water, n_M M + n_O H2O → species + n_p H+ + n_e e-, with n_p = 2n_O - n_H and
// n_e = n_p + charge, costs ΔfG° + RT ln a - n_O ΔfG°(H2O) - n_p RT ln(10) pH - n_e E.
export function pourbaix_plane(
  entry: PourbaixEntry,
  { log_conc, temperature, water_energy, element_log_conc = {} }: PourbaixConditions,
): PourbaixPlane {
  const { formula, energy, phase } = entry
  if (!Number.isFinite(energy)) {
    throw new TypeError(`Pourbaix entry ${formula} has non-finite energy ${energy}`)
  }
  const { composition, charge, ...parsed } = parse_species(formula)
  if (
    ![undefined, `aqueous`, `solid`].includes(phase) ||
    (phase === `solid` && charge !== 0)
  ) {
    throw new Error(`Pourbaix entry ${formula} needs phase aqueous, or solid if uncharged`)
  }
  const aqueous = phase ? phase === `aqueous` : parsed.aqueous
  const metals = Object.keys(composition).filter((el) => el !== `H` && el !== `O`)
  if (metals.length === 0) {
    throw new Error(`Pourbaix entry ${formula} needs an element besides H and O`)
  }
  const n_metal = metals.reduce((sum, el) => sum + composition[el], 0)
  const n_o = composition.O ?? 0
  const n_protons = 2 * n_o - (composition.H ?? 0)
  const slope = nernst_slope(temperature)
  const species_log_conc =
    (metals.length === 1 ? element_log_conc[metals[0]] : null) ?? log_conc
  // the element's activity spreads over the species' metal atoms (pymatgen's convention)
  const activity_term = aqueous ? slope * (species_log_conc - Math.log10(n_metal)) : 0
  return {
    species: [{ entry, aqueous, weight: 1 }],
    label: formula,
    metal_fractions: Object.fromEntries(metals.map((el) => [el, composition[el] / n_metal])),
    offset: (energy + activity_term - n_o * water_energy) / n_metal,
    ph_coeff: (-n_protons * slope) / n_metal,
    potential_coeff: -(n_protons + charge) / n_metal,
  }
}

// Phases at the metal fractions of a one- or two-element diagram: each species of that
// composition, and each pair on either side of it mixed by the lever rule (pymatgen's
// MultiEntry). At any (pH, E) the lowest phase is one of these, as the lower convex hull of
// Ψ over the fraction is made of segments between two species. One element gives back the
// species.
export function mix_planes(
  species: readonly PourbaixPlane[],
  metal_fractions: Record<string, number>,
): PourbaixPlane[] {
  const [[element, fraction]] = Object.entries(metal_fractions)
  const x_of = (plane: PourbaixPlane) => plane.metal_fractions[element] ?? 0
  const side = (plane: PourbaixPlane) =>
    Math.abs(x_of(plane) - fraction) <= FRACTION_TOL ? 0 : Math.sign(x_of(plane) - fraction)
  const pairs = species.flatMap((first, idx) =>
    species.slice(idx + 1).flatMap((second) => {
      if (side(first) * side(second) >= 0) return []
      // first's share of the metal atoms; species planes hold one species each
      const weight = (fraction - x_of(second)) / (x_of(first) - x_of(second))
      const mixed = (key: `offset` | `ph_coeff` | `potential_coeff`) =>
        weight * first[key] + (1 - weight) * second[key]
      return [
        {
          species: [
            { ...first.species[0], weight },
            { ...second.species[0], weight: 1 - weight },
          ],
          label: `${first.label} + ${second.label}`,
          metal_fractions,
          offset: mixed(`offset`),
          ph_coeff: mixed(`ph_coeff`),
          potential_coeff: mixed(`potential_coeff`),
        },
      ]
    }),
  )
  return [...species.filter((plane) => side(plane) === 0), ...pairs]
}

// Pourbaix energy Ψ (eV per metal atom) of a species at (pH, E)
export const pourbaix_energy = (plane: PourbaixPlane, ph: number, potential: number): number =>
  plane.offset + plane.ph_coeff * ph + plane.potential_coeff * potential

// Lowest plane at (pH, E) and its energy; ties go to the earlier plane, as in the domains
export const stable_plane_at = (
  planes: readonly PourbaixPlane[],
  ph: number,
  potential: number,
) =>
  planes.reduce(
    (best, plane) => {
      const energy = pourbaix_energy(plane, ph, potential)
      return energy < best.energy ? { plane, energy } : best
    },
    { plane: planes[0], energy: Infinity },
  )

// Clip a convex polygon to the half-plane a·x + b·y + c <= 0 (one Sutherland–Hodgman pass).
// Vertices on the line stay once: only strict sign changes add a crossing point.
export function clip_to_half_plane(
  vertices: readonly Vec2[],
  [a, b, c]: readonly [number, number, number],
): Vec2[] {
  const value = ([x, y]: Vec2) => a * x + b * y + c
  const clipped: Vec2[] = []
  vertices.forEach((current, idx) => {
    const prev = vertices[(idx + vertices.length - 1) % vertices.length]
    const [v_prev, v_cur] = [value(prev), value(current)]
    if (v_prev * v_cur < 0) clipped.push(lerp_vec2(prev, current, v_prev / (v_prev - v_cur)))
    if (v_cur <= 0) clipped.push(current)
  })
  return clipped
}

// Stable domains of `planes` inside the (pH, E) window, dropping zero-area ones. Each is the
// window clipped by Ψ_own - Ψ_other <= 0 for every other plane; coincident planes go to the
// first.
export function pourbaix_domains(
  planes: readonly PourbaixPlane[],
  ph_range: Vec2,
  potential_range: Vec2,
): PourbaixDomain[] {
  const [[ph_lo, ph_hi], [e_lo, e_hi]] = [ph_range, potential_range]
  if (!(ph_lo < ph_hi && e_lo < e_hi && [ph_lo, ph_hi, e_lo, e_hi].every(Number.isFinite))) {
    throw new Error(`Pourbaix ph_range and potential_range must be finite with min < max`)
  }
  // oxfmt-ignore
  const window: Vec2[] = [[ph_lo, e_lo], [ph_hi, e_lo], [ph_hi, e_hi], [ph_lo, e_hi]]
  const min_area = MIN_AREA_FRACTION * (ph_hi - ph_lo) * (e_hi - e_lo)
  return planes.flatMap((own, idx) => {
    let vertices = window
    for (const [other_idx, other] of planes.entries()) {
      if (other_idx === idx) continue
      const coeffs: [number, number, number] = [
        own.ph_coeff - other.ph_coeff,
        own.potential_coeff - other.potential_coeff,
        own.offset - other.offset,
      ]
      const coincident = coeffs.every((coeff) => Math.abs(coeff) <= PLANE_TOL)
      if (coincident && other_idx < idx) return []
      if (!coincident) vertices = clip_to_half_plane(vertices, coeffs)
      if (vertices.length < 3) return []
    }
    const area = polygon_signed_area(vertices)
    return area > min_area ? [{ plane: own, vertices, area }] : []
  })
}

// Energy (eV per metal atom) of `plane` above the stable envelope at the centres of an
// n_ph × n_e grid over the window, row-major from the top (highest E) row down: 0 where its
// species is stable, the driving force to transform into the stable one elsewhere
export function energy_above_envelope(
  planes: readonly PourbaixPlane[],
  plane: PourbaixPlane,
  [[ph_lo, ph_hi], [e_lo, e_hi]]: [Vec2, Vec2],
  [n_ph, n_e]: Vec2,
): Float64Array {
  const values = new Float64Array(n_ph * n_e)
  for (let row = 0; row < n_e; row++) {
    const potential = e_hi - ((row + 0.5) / n_e) * (e_hi - e_lo)
    for (let col = 0; col < n_ph; col++) {
      const ph = ph_lo + ((col + 0.5) / n_ph) * (ph_hi - ph_lo)
      let envelope = Infinity // stable_plane_at without its per-cell allocations
      for (const other of planes)
        envelope = Math.min(envelope, pourbaix_energy(other, ph, potential))
      values[row * n_ph + col] = pourbaix_energy(plane, ph, potential) - envelope
    }
  }
  return values
}

// H2 and O2 evolution lines E = intercept + slope·pH (V vs SHE): E = -kT ln(10)/e · pH at
// 1 bar H2 and E = -ΔfG°(H2O)/2e - kT ln(10)/e · pH at 1 bar O2
export const water_lines = (temperature: number, water_energy: number) => ({
  h2: { slope: -nernst_slope(temperature), intercept: 0 },
  o2: { slope: -nernst_slope(temperature), intercept: -water_energy / 2 },
})

// Species planes and phase planes of a Pourbaix diagram of one or two elements besides H and
// O; pourbaix_domains turns the phases into the domains of a (pH, E) window
export function compute_pourbaix_diagram(
  entries: readonly PourbaixEntry[],
  config: PourbaixConfig = {},
): PourbaixDiagramData {
  // destructuring defaults, so a config key set to undefined still takes its default
  const {
    temperature = POURBAIX_DEFAULTS.temperature,
    water_energy = POURBAIX_DEFAULTS.water_energy,
    log_conc = POURBAIX_DEFAULTS.log_conc,
    element_log_conc = {},
    composition,
  } = config
  const conditions = { log_conc, temperature, water_energy, element_log_conc }
  const log_concs = [log_conc, ...Object.values(element_log_conc)]
  if (
    !(temperature > 0 && Number.isFinite(water_energy) && log_concs.every(Number.isFinite))
  ) {
    throw new Error(
      `Pourbaix needs T > 0 K and finite log_conc, water_energy, got ${JSON.stringify(conditions)}`,
    )
  }
  if (entries.length === 0) throw new Error(`Pourbaix diagram needs at least one entry`)
  const formulas = entries.map(({ formula }) => normalize_formula_unicode(formula))
  const duplicates = formulas.filter((formula, idx) => formulas.indexOf(formula) !== idx)
  if (duplicates.length > 0) {
    throw new Error(
      `Pourbaix entries need unique formulas, got duplicates [${duplicates}] (keep the most stable polymorph, mark a dissolved neutral species with (aq))`,
    )
  }
  const species = entries.map((entry) => pourbaix_plane(entry, conditions))
  const elements = [...new Set(species.flatMap((plane) => Object.keys(plane.metal_fractions)))]
  if (elements.length > 2) {
    throw new Error(
      `Pourbaix diagram supports up to two elements besides H and O, got [${elements.join(`, `)}]`,
    )
  }
  const unknown = Object.keys({ ...composition, ...element_log_conc }).filter(
    (el) => !elements.includes(el),
  )
  const amounts = elements.map((el) => (composition ? composition[el] : 1))
  if (unknown.length > 0 || !amounts.every((amount) => amount > 0 && amount < Infinity)) {
    throw new Error(
      `Pourbaix composition needs a positive amount of each of [${elements}] and element_log_conc only those, got ${JSON.stringify({ composition, element_log_conc })}`,
    )
  }
  const total = amounts.reduce((sum, amount) => sum + amount, 0)
  const metal_fractions = Object.fromEntries(
    elements.map((el, idx) => [el, amounts[idx] / total]),
  )
  const planes = mix_planes(species, metal_fractions)
  if (planes.length === 0)
    throw new Error(`Pourbaix species can't mix to ${JSON.stringify(metal_fractions)}`)
  return { elements, species, planes }
}
