// Surface energies of elemental crystals from the Materials Project surface-property database
// of Tran et al., "Surface energies of elemental crystals", Sci. Data 3, 160080 (2016),
// doi:10.1038/sdata.2016.80, as distributed with pymatgen
// (test-files/analysis/wulff/surface_samples.json, the data pymatgen's WulffShape tests use).
// wulff/mp-*.json are MP's documents from there, trimmed to the fields used: they keep MP's own
// Wulff area fractions and shape statistics, so tests/vitest/wulff/compute.test.ts checks
// compute_wulff_shape against them.
import { cell_to_lattice_matrix, type Matrix3x3, type Vec2, type Vec3 } from '#lib/math.js'
import type { Crystal } from '#lib/structure/index.js'
import { parse_poscar } from '#lib/structure/parse.js'
import { parse_surface_energies, type WulffFacetInput } from '#lib/wulff/index.js'
import ir_doc from './wulff/mp-101.json'
import ti_doc from './wulff/mp-72.json'

export type WulffExample = {
  label: string
  description: string
  url: string // the MP surface document, a FilePicker can drag it onto the viewer
  lattice: Matrix3x3 // rows a, b, c in Å
  // the conventional cell's crystal, so moyo finds its own point group
  structure: Crystal
  facets: WulffFacetInput[] // read from `mp` by parse_surface_energies
  mp: typeof ir_doc // MP's document, with its area fractions and shape statistics
  // largest |area fraction - MP's| compute_wulff_shape reaches (asserted in the tests)
  mp_tolerance: number
  energy_range: Vec2 // demo slider bounds, J/m²
}

// oxfmt-ignore
const crystal = (title: string, lattice: Matrix3x3, element: string, frac: string[]) =>
  parse_poscar([title, `1.0`, ...lattice.map((row) => row.join(` `)), element, frac.length, `Direct`, ...frac].join(`\n`))

// Ir mp-101, Fm-3m, a = 3.8312 Å (the cell pymatgen's tests pair with these energies)
const ir_lattice = cell_to_lattice_matrix(3.8312, 3.8312, 3.8312, 90, 90, 90)
// ω-Ti mp-72 (P6/mmm, not hcp α-Ti): a = 4.5783 Å, c = 2.8303 Å read off the in-plane vectors
// of MP's (0001) and (112̄0) slab cells (MP lists Miller-Bravais (h k i l) indices)
const ti_lattice = cell_to_lattice_matrix(4.5783, 4.5783, 2.8303, 90, 90, 120)

export const wulff_examples: WulffExample[] = [
  {
    label: `Ir (fcc)`,
    description: `Ir mp-101, Fm-3m: 13 families up to index 3, 6 on the shape`,
    lattice: ir_lattice,
    mp_tolerance: 1e-12, // MP's own cell
    energy_range: [1.5, 4],
    structure: crystal(`Ir mp-101`, ir_lattice, `Ir`, [
      `0 0 0`,
      `0 0.5 0.5`,
      `0.5 0 0.5`,
      `0.5 0.5 0`,
    ]),
    url: `/wulff/mp-101.json`,
    facets: parse_surface_energies(ir_doc).facets,
    mp: ir_doc,
  },
  {
    label: `ω-Ti (hexagonal)`,
    description: `Ti mp-72, P6/mmm: 12 families, 8 on the shape`,
    lattice: ti_lattice,
    mp_tolerance: 1e-4, // the cell is rebuilt from MP slab cells to 4 decimals
    energy_range: [1.5, 3],
    // the 3-fold positions to 10 digits, within moyo's tolerance
    structure: crystal(`Ti mp-72`, ti_lattice, `Ti`, [
      `0 0 0`,
      `0.3333333333 0.6666666667 0.5`,
      `0.6666666667 0.3333333333 0.5`,
    ]),
    url: `/wulff/mp-72.json`,
    facets: parse_surface_energies(ti_doc).facets,
    mp: ti_doc,
  },
]

// Illustrative γ(Δμ_O) of a rutile-type oxide: made-up energies and slopes on rutile TiO2's
// cell. Stoichiometric terminations keep their γ, an O-terminated (001) (slope < 0: excess O)
// wins under O-rich conditions (Δμ_O = 0) and a reduced (111) (slope > 0) under O-poor ones.
export const oxide_example = {
  label: `Rutile-type oxide vs Δμ_O (illustrative)`,
  description: `Made-up γ(Δμ_O) = γ₀ + slope·Δμ_O on rutile's cell (a = 4.594, c = 2.959 Å): drag Δμ_O from O-rich (0) to O-poor (-3 eV) to trade the O-terminated {001} caps for reduced {111} ones`,
  lattice: cell_to_lattice_matrix(4.594, 4.594, 2.959, 90, 90, 90),
  // oxfmt-ignore
  facets: [
    { miller: [1, 1, 0], energy: 0.5, slope: 0 },
    { miller: [1, 0, 1], energy: 0.6, slope: 0 },
    { miller: [1, 0, 0], energy: 0.65, slope: 0 },
    { miller: [0, 0, 1], energy: 0.45, slope: -0.15 },
    { miller: [1, 1, 1], energy: 1.2, slope: 0.25 },
  ] satisfies WulffFacetInput[],
  energy_range: [0.2, 1.5] as Vec2,
  delta_mu_range: [-3, 0] as Vec2,
}

// Edits of an example's facets as a compact ?facets= value: each family `h.k.l` (keeping the
// example's γ for that plane) or `h.k.l*γ`, joined by `_`, in order (so removed and added
// families round-trip). Null when the facets equal the example's.
export const encode_facets = (
  facets: WulffFacetInput[],
  defaults: WulffFacetInput[],
): string | null => {
  if (JSON.stringify(facets) === JSON.stringify(defaults)) return null
  const default_energy = new Map(
    defaults.map(({ miller, energy }) => [miller.join(`.`), energy]),
  )
  return facets
    .map(({ miller, energy }) => {
      const key = miller.join(`.`)
      return default_energy.get(key) === energy ? key : `${key}*${energy}`
    })
    .join(`_`)
}

// Inverse of encode_facets: a plane of the example keeps its slope (and γ unless given)
export const decode_facets = (
  encoded: string,
  defaults: WulffFacetInput[],
): WulffFacetInput[] =>
  encoded.split(`_`).map((token) => {
    const [key, energy_str, ...extra] = token.split(`*`)
    const miller = key.split(`.`).map(Number)
    const listed = defaults.find((facet) => facet.miller.join(`.`) === key)
    const energy = energy_str === undefined ? listed?.energy : Number(energy_str)
    if (miller.length !== 3 || !miller.every(Number.isInteger) || extra.length > 0) {
      throw new Error(`?facets=: expected h.k.l or h.k.l*γ, got ${token}`)
    }
    if (energy === undefined || !(energy > 0)) {
      throw new Error(
        `?facets=: ${token} needs a positive γ (only the example's planes may omit it)`,
      )
    }
    return { ...listed, miller: miller as Vec3, energy }
  })
