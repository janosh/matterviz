import { EV_TO_KJ_PER_MOL } from '#lib/constants'
import { point_in_polygon, polygon_signed_area, type Vec2 } from '#lib/math'
import {
  clip_to_half_plane,
  compute_pourbaix_diagram,
  energy_above_envelope,
  mix_planes,
  nernst_slope,
  parse_species,
  POURBAIX_DEFAULTS,
  pourbaix_domains,
  pourbaix_energy,
  pourbaix_plane,
  stable_plane_at,
  water_lines,
} from '#lib/pourbaix/compute'
import type { PourbaixConfig, PourbaixEntry } from '#lib/pourbaix/types'
import { pourbaix_systems, water_energy } from '#site/pourbaix'
import { expect, test } from 'vite-plus/test'

const [Fe, Cu, Zn] = [`Fe–H2O`, `Cu–H2O`, `Zn–H2O`].map(
  (name) => pourbaix_systems[name].entries,
)
const { entries: ag_te, ...ag_te_config } = pourbaix_systems[`Ag–Te–H2O (MP)`]
// The diagram and its domains over a window, by default the component's
const diagram = (
  entries: PourbaixEntry[],
  {
    ph_range = POURBAIX_DEFAULTS.ph_range,
    potential_range = POURBAIX_DEFAULTS.potential_range,
    ...config
  }: PourbaixConfig & { ph_range?: Vec2; potential_range?: Vec2 } = {},
) => {
  const data = compute_pourbaix_diagram(entries, { water_energy, ...config })
  const domains = pourbaix_domains(data.planes, ph_range, potential_range)
  return { ...data, domains, window: [ph_range, potential_range] as [Vec2, Vec2] }
}
type Diagram = ReturnType<typeof diagram>

// Formulas of the domains whose polygon holds (pH, E)
const domain_at = ({ domains }: Diagram, [ph, potential]: Vec2): string[] =>
  domains
    .filter(({ vertices }) => point_in_polygon(ph, potential, vertices))
    .map(({ plane }) => plane.label)
const plane_of = ({ planes }: Diagram, formula: string) => {
  const plane = planes.find(({ label }) => label === formula)
  if (!plane) throw new Error(`no ${formula} plane`)
  return plane
}

test.each([
  [`Fe3O4`, { Fe: 3, O: 4 }, 0, false],
  [`Fe^2+`, { Fe: 1 }, 2, true],
  [`Fe^+3`, { Fe: 1 }, 3, true],
  [`Fe³⁺`, { Fe: 1 }, 3, true],
  [`HFeO2^-`, { H: 1, Fe: 1, O: 2 }, -1, true],
  [`ZnO2^2-`, { Zn: 1, O: 2 }, -2, true],
  [`Fe(OH)2^+`, { Fe: 1, O: 2, H: 2 }, 1, true],
  [`Fe(OH)2(aq)`, { Fe: 1, O: 2, H: 2 }, 0, true],
  [`Fe^2+(aq)`, { Fe: 1 }, 2, true],
])(
  `parse_species %s → composition, charge, aqueous`,
  (formula, composition, charge, aqueous) => {
    expect(parse_species(formula)).toEqual({ composition, charge, aqueous })
  },
)

// 2Fe + 3H2O → Fe2O3 + 6H+ + 6e-: per Fe 3 protons and 3 electrons. Fe/Fe2+ at unit activity:
// Ψ_ion - Ψ_metal = ΔfG°(Fe2+) - 2E vanishes at E° = ΔfG°(Fe2+)/2F
test(`pourbaix_plane balances water, protons and electrons`, () => {
  const conditions = { log_conc: 0, temperature: 298.15, water_energy }
  const plane = pourbaix_plane({ formula: `Fe2O3`, energy: -7 }, conditions)
  expect(plane.potential_coeff).toBe(-3)
  expect(plane.offset).toBeCloseTo((-7 - 3 * water_energy) / 2, 15)
  expect(plane.ph_coeff).toBeCloseTo(-3 * nernst_slope(298.15), 15)
  const [metal, ion] = Fe.slice(0, 2).map((entry) => pourbaix_plane(entry, conditions))
  const e_standard = -78.9 / EV_TO_KJ_PER_MOL / 2
  expect(pourbaix_energy(ion, 3, e_standard)).toBeCloseTo(
    pourbaix_energy(metal, 3, e_standard),
    14,
  )
  // a dimer ion holds two Fe atoms at activity 10^log_conc / 2 (pymatgen's convention)
  const dimer = pourbaix_plane({ formula: `Fe2(OH)2^4+`, energy: -4 }, conditions)
  expect(dimer.offset).toBeCloseTo(
    (-4 - nernst_slope(298.15) * Math.LOG10E * Math.LN2 - 2 * water_energy) / 2,
    14,
  )
})

// oxfmt-ignore
const square: Vec2[] = [[0, 0], [2, 0], [2, 2], [0, 2]]
test.each([
  [[1, 0, -1], 2, 4], // x <= 1 keeps half
  [[1, 1, -2], 2, 3], // x + y <= 2 cuts through two corners: no duplicated vertices
  [[1, 0, 5], 0, 0], // x <= -5 keeps nothing
  [[0, 0, -1], 4, 4], // always true keeps all
] as const)(
  `clip_to_half_plane %o leaves area %s, %s vertices`,
  (coeffs, area, n_vertices) => {
    const clipped = clip_to_half_plane(square, coeffs)
    expect(polygon_signed_area(clipped)).toBeCloseTo(area, 14)
    expect(clipped).toHaveLength(n_vertices)
  },
)

// Domains tile the window: they are convex and disjoint, so their areas sum to the window
// (relative error at round-off) and every sample point lies in exactly one domain, the one
// stable_plane_at picks
test.each([
  [Fe, {}],
  [Fe, { ph_range: [2, 4] as Vec2, potential_range: [0, 0.5] as Vec2 }],
  [Cu, { log_conc: -8, temperature: 273.15 }], // with the thin Cu+ sliver
  [Zn, { log_conc: -4, temperature: 320 }],
  [ag_te, ag_te_config], // 152 Ag–Te pairs
  [ag_te, { ...ag_te_config, composition: { Ag: 2, Te: 1 }, element_log_conc: { Te: -4 } }],
])(`domains tile the window (%#)`, (entries, config) => {
  const data = diagram(entries, config)
  const [[ph_lo, ph_hi], [e_lo, e_hi]] = data.window
  const window_area = (ph_hi - ph_lo) * (e_hi - e_lo)
  const total = data.domains.reduce((sum, { area }) => sum + area, 0)
  expect(Math.abs(total - window_area) / window_area).toBeLessThan(1e-12)
  for (const { vertices } of data.domains)
    expect(polygon_signed_area(vertices)).toBeGreaterThan(0)
  // 41 x 31 grid, offset off grid-aligned vertices
  for (let ph_idx = 0; ph_idx < 41; ph_idx++) {
    for (let e_idx = 0; e_idx < 31; e_idx++) {
      const point: Vec2 = [
        ph_lo + (ph_hi - ph_lo) * ((ph_idx + 0.37) / 41),
        e_lo + (e_hi - e_lo) * ((e_idx + 0.61) / 31),
      ]
      const hits = domain_at(data, point)
      expect(hits, `at ${point}`).toHaveLength(1)
      expect(hits[0]).toBe(stable_plane_at(data.planes, ...point).plane.label)
    }
  }
})

// Textbook regions at 298.15 K. Fe^3+/Fe2O3 sits at pH (-21.5 - 11.42 log a)/34.25: 2.7 at
// 10^-10, -0.63 at 10^0. Cu+ disproportionates unless E(Cu/Cu+) = 0.5203 + 0.05916 log a lies
// below E(Cu+/Cu2+) = 0.1585 V, i.e. log a < -6.11.
test.each([
  [Fe, [7, -1], `Fe`, -6], // immunity
  [Fe, [3, -0.3], `Fe^2+`, -6], // acid corrosion
  [Fe, [0, 1.2], `Fe^3+`, -6],
  [Fe, [9, 0.4], `Fe2O3`, -6], // passivation
  [Fe, [12, -0.6], `Fe3O4`, -6], // between -0.80 and -0.50 V at pH 12
  [Fe, [2, 0.9], `Fe^3+`, -10], // a dilute ion's field reaches further
  [Fe, [2, 0.9], `Fe2O3`, 0],
  [Cu, [7, 0], `Cu`, -6], // noble below ~0.06 V at pH 7
  [Cu, [2, 0.6], `Cu^2+`, -6],
  [Cu, [10, 0], `Cu2O`, -6], // between -0.12 and 0.05 V at pH 10
  [Cu, [10, 0.8], `CuO`, -6],
  [Cu, [0, 0.1], `Cu`, -6], // no Cu+ sliver at 10^-6: Cu/Cu2+ at 0.161 V
  [Cu, [0, 0.156], `Cu^+`, -6.2], // sliver from 0.1535 to 0.1585 V
  [Cu, [0, 0.1], `Cu^+`, -8],
  [Zn, [4, -1.2], `Zn`, -6],
  [Zn, [4, 0], `Zn^2+`, -6],
  [Zn, [11, 0], `ZnO`, -6],
] as const)(`%#: (pH, E) = %o is %s at log a = %s`, (entries, point, formula, log_conc) => {
  expect(domain_at(diagram([...entries], { log_conc }), [...point])).toEqual([formula])
})

// Water lines: -kT ln(10)/e = -0.05916 V/pH at 298.15 K, O2 intercept -ΔfG°(H2O)/2e.
// Zn2+ + H2O → ZnO + 2H+ (no electrons) is a vertical line at pH = ΔG_rxn/(2 kT ln10) - log a/2
// with ΔG_rxn = ΔfG°(ZnO) - ΔfG°(H2O) - ΔfG°(Zn2+) = 63.7 kJ/mol, so temperature moves it.
test.each([
  [298.15, -0.05916],
  [273.15, -0.0542],
  [373.15, -0.07405],
])(`at %s K water lines have slope %s V/pH and Zn^2+/ZnO moves`, (temperature, slope) => {
  const data = diagram(Zn, { temperature })
  const { h2, o2 } = water_lines(temperature, water_energy)
  expect(h2.slope).toBeCloseTo(slope, 4)
  expect([o2.slope, h2.intercept]).toEqual([h2.slope, 0])
  expect(o2.intercept).toBeCloseTo(1.2287, 4)
  const [ion, oxide] = [plane_of(data, `Zn^2+`), plane_of(data, `ZnO`)]
  const boundary_ph = (oxide.offset - ion.offset) / (ion.ph_coeff - oxide.ph_coeff)
  const expected = 63.7 / EV_TO_KJ_PER_MOL / (2 * nernst_slope(temperature)) + 3
  expect(boundary_ph).toBeCloseTo(expected, 10)
  expect(domain_at(data, [expected - 0.05, 0])).toEqual([`Zn^2+`])
  expect(domain_at(data, [expected + 0.05, 0])).toEqual([`ZnO`])
})

// A higher ion activity raises the ion's Ψ: the Fe/Fe2+ line rises by kT ln(10)/2 per decade
test(`ion activity moves the Fe/Fe^2+ boundary up by kT ln(10)/2 per decade`, () => {
  const fe_ion_boundary = (log_conc: number, element_log_conc = {}): number => {
    const data = diagram(Fe, { log_conc, element_log_conc })
    const [metal, ion] = [plane_of(data, `Fe`), plane_of(data, `Fe^2+`)]
    return (ion.offset - metal.offset) / (metal.potential_coeff - ion.potential_coeff)
  }
  expect(fe_ion_boundary(-4) - fe_ion_boundary(-6)).toBeCloseTo(nernst_slope(298.15), 12)
  expect(fe_ion_boundary(-6, { Fe: -4 })).toBe(fe_ion_boundary(-4)) // per-element override
})

test(`coincident planes keep only the first`, () => {
  const entries = [
    { formula: `Zn`, energy: 0 },
    { formula: `ZnO`, energy: -3.3 },
    { formula: `Zn(OH)2`, energy: -3.3 + -2.4577 }, // ZnO + H2O
  ]
  const data = diagram(entries, { water_energy: -2.4577 })
  expect(data.domains.map(({ plane }) => plane.label)).toEqual([`Zn`, `ZnO`])
})

// phase overrides the formula rule: ZnO as dissolved gains RT ln a (-0.355 eV at 10^-6),
// which widens its domain
test(`phase aqueous flips a neutral species to dissolved and grows its domain`, () => {
  const zno = (phase?: PourbaixEntry[`phase`]) =>
    diagram(
      Zn.map((entry) => (entry.formula === `ZnO` ? { ...entry, phase } : entry)),
    ).domains.find(({ plane }) => plane.label === `ZnO`)
  const [solid, dissolved] = [zno(), zno(`aqueous`)]
  expect(zno(`solid`)?.vertices).toEqual(solid?.vertices)
  expect(dissolved?.plane.species[0].aqueous).toBe(true)
  expect(Number(dissolved?.plane.offset) - Number(solid?.plane.offset)).toBeCloseTo(
    -6 * nernst_slope(298.15),
    12,
  )
  expect(dissolved?.area).toBeGreaterThan(Number(solid?.area))
})

test.each([
  [[], {}, /at least one entry/],
  [Fe, { temperature: 0 }, /T > 0 K and finite/],
  [Fe, { log_conc: Number.NaN }, /T > 0 K and finite/],
  [Fe, { water_energy: Number.NaN }, /T > 0 K and finite/],
  [Fe, { ph_range: [5, 5] as Vec2 }, /must be finite with min < max/],
  [Fe, { potential_range: [0, Number.NaN] as Vec2 }, /must be finite with min < max/],
  [Fe, { element_log_conc: { Fe: Number.NaN } }, /T > 0 K and finite/],
  [[...Fe, ...Zn, ...Cu], {}, /up to two elements besides H and O, got \[Fe, Zn, Cu\]/],
  [[...Fe, ...Zn], { composition: { Fe: 1, Zn: 0 } }, /positive amount of each of \[Fe,Zn\]/],
  [Fe, { composition: { Cr: 1 } }, /positive amount/],
  [Fe, { element_log_conc: { Zn: -4 } }, /element_log_conc only those/],
  [
    [...Fe, { formula: `ZnFe2O4`, energy: -10.7 }],
    {},
    /species can't mix to \{"Fe":0.5,"Zn":0.5\}/,
  ],
  [[...Fe, Fe[4]], {}, /unique formulas.*\[Fe2O3\]/],
  [[{ formula: `H2O2(aq)`, energy: -1.4 }], {}, /needs an element besides H and O/],
  [[{ formula: `Fe`, energy: Number.NaN }], {}, /non-finite energy/],
  [[{ formula: `Fe^2+`, energy: -1, phase: `solid` as const }], {}, /solid if uncharged/],
  [
    [{ formula: `Fe`, energy: 0, phase: `gas` as PourbaixEntry[`phase`] }],
    {},
    /needs phase aqueous/,
  ],
  [[{ formula: `Fe^2+O`, energy: -1 }], {}, /one trailing suffix/],
  [[{ formula: `Fe^2`, energy: -1 }], {}, /one trailing suffix/], // unsigned charge is ambiguous
  [[{ formula: `Fe^`, energy: -1 }], {}, /Unexpected character/],
  [[{ formula: `fe2O3`, energy: -1 }], {}, /Unexpected character/],
])(`compute_pourbaix_diagram rejects invalid input (%#)`, (entries, config, message) => {
  expect(() => diagram(entries, config)).toThrow(message)
})

// 0 exactly where the species is stable among the phases at its own composition, the energy
// above the stable phase elsewhere. In Ag–Te, TeH^- is held to the Te-only phases and Ag^+
// to the Ag-only ones, not to Ag–Te mixtures (which reached -1.19 eV below TeO2).
test.each([
  [`Fe^2+`, Fe],
  [`Fe2O3`, Fe],
  [`Fe`, Fe],
  [`TeH^-`, ag_te],
  [`Ag^+`, ag_te],
])(`energy_above_envelope of %s`, (formula, entries) => {
  const data = diagram(entries, entries === ag_te ? ag_te_config : {})
  const plane = plane_of({ ...data, planes: data.species }, formula) // species, not phases
  const envelope = mix_planes(data.species, plane.metal_fractions)
  if (entries === Fe) expect(envelope).toEqual(data.planes) // one metal: its phases are its species
  const [[ph_lo, ph_hi], [e_lo, e_hi]] = data.window
  const values = energy_above_envelope(envelope, plane, data.window, [36, 27])
  expect(values).toHaveLength(36 * 27)
  expect(values).toContain(0)
  values.forEach((value, idx) => {
    const ph = ph_lo + (((idx % 36) + 0.5) / 36) * (ph_hi - ph_lo)
    const potential = e_lo + ((Math.floor(idx / 36) + 0.5) / 27) * (e_hi - e_lo)
    const stable = stable_plane_at(envelope, ph, potential)
    if (stable.plane === plane) expect(value).toBe(0)
    else {
      expect(value).toBeGreaterThan(0)
      expect(value).toBeCloseTo(pourbaix_energy(plane, ph, potential) - stable.energy, 14)
    }
  })
})
