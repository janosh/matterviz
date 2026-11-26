import {
  compute_pourbaix_diagram,
  pourbaix_domains,
  stable_plane_at,
} from '#lib/pourbaix/compute'
import { import_pymatgen_pourbaix, PYMATGEN_WATER_ENERGY } from '#lib/pourbaix/pymatgen'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { expect, test } from 'vite-plus/test'

// pymatgen's binary Pourbaix test data, as PourbaixDiagram(comp_dict={Ag: 0.5, Te: 0.5},
// conc_dict={Ag: 1e-8, Te: 1e-8}).as_dict() of pymatgen 2026.10.31
const path = `${import.meta.dirname}/../../../src/site/pourbaix/Ag-Te-mp.json.gz`
const diagram_dict = JSON.parse(gunzipSync(readFileSync(path)).toString())
const imported = import_pymatgen_pourbaix(diagram_dict)
const energy_of = (formula: string) =>
  imported.entries.find((entry) => entry.formula === formula)?.energy

// The solids pymatgen's filter_solids keeps, each its lowest polymorph scaled to the reduced
// formula (AgO: mp-499 Ag2O2 at -1.1845 eV, TeO2: mp-2125 Te8O16 at -31.1561 eV), and the
// ions as named by charge suffix or (aq)
test(`imports a PourbaixDiagram dict with its composition and activity`, () => {
  const { entries, ...config } = imported
  expect(config).toEqual({
    water_energy: PYMATGEN_WATER_ENERGY,
    composition: { Ag: 0.5, Te: 0.5 },
    log_conc: -8,
  })
  const solids = entries.filter(({ formula }) => !/[\^(]/.test(formula))
  expect(solids.map(({ formula }) => formula).toSorted()).toEqual(
    // oxfmt-ignore
    [`Ag`, `Ag2O`, `Ag2Te`, `Ag2Te2O7`, `Ag2TeO4`, `Ag4TeO5`, `AgO`, `AgTeO3`, `Te`, `Te2O5`, `TeO2`, `TeO3`],
  )
  expect(entries).toHaveLength(12 + 15)
  expect(energy_of(`AgO`)).toBeCloseTo(-1.1845 / 2, 4)
  expect(energy_of(`TeO2`)).toBeCloseTo(-31.1561 / 8, 4)
  expect(energy_of(`Ag^+`)).toBeCloseTo(0.52, 4)
  expect(energy_of(`TeO3^2-`)).toBeCloseTo(-5.1603, 4)
  expect(energy_of(`TeH2O4(aq)`)).toBeCloseTo(-6.8025, 4) // pymatgen's Te(HO2)2(aq)
})

// pymatgen.find_stable_entry at the same points: 30 stable MultiEntries at 1:1, 24 at 2:1
// (its test_multicomponent asserts 30 and mp-499 AgO at pH 8, 2 V)
test.each([
  [{ Ag: 1, Te: 1 }, 30, [8, 2], `AgO + TeHO4^-`],
  [{ Ag: 1, Te: 1 }, 30, [0, 0], `Ag2Te + TeH2(aq)`],
  [{ Ag: 1, Te: 1 }, 30, [2, 1], `Ag^+ + TeH2O4(aq)`],
  [{ Ag: 1, Te: 1 }, 30, [5, -3], `Ag + TeH^-`],
  [{ Ag: 2, Te: 1 }, 24, [0, 0], `Ag2Te`], // the composition of Ag2Te itself
  [{ Ag: 2, Te: 1 }, 24, [8, 2], `AgO + TeHO4^-`],
] as const)(
  `at Ag:Te %o, %s domains as in pymatgen and %o is %s`,
  (composition, count, point, label) => {
    const data = compute_pourbaix_diagram(imported.entries, { ...imported, composition })
    // pymatgen's window for stable_entries
    expect(pourbaix_domains(data.planes, [-2, 16], [-4, 4])).toHaveLength(count)
    const { plane } = stable_plane_at(data.planes, point[0], point[1])
    const plane_of = (formula: string) => data.species.find((sp) => sp.label === formula)
    expect(plane.label).toBe(label)
    // lever rule: the species' metal shares add up to the composition (Ag2Te at 0.75 at pH 0, 0 V)
    const x_ag = (formula: string) => plane_of(formula)?.metal_fractions.Ag ?? 0
    const mixed = plane.species.reduce(
      (sum, { entry, weight }) => sum + weight * x_ag(entry.formula),
      0,
    )
    expect(mixed).toBeCloseTo(composition.Ag / (composition.Ag + composition.Te), 14)
  },
)

// The same species however they are wrapped: PourbaixEntry, or its bare IonEntry / PDEntry
test(`entry lists import like the diagram, filtered unless the diagram says not to`, () => {
  const { entries } = diagram_dict
  expect(import_pymatgen_pourbaix(entries)).toEqual({
    entries: imported.entries,
    water_energy: PYMATGEN_WATER_ENERGY,
  })
  const bare = entries.map(({ entry }: { entry: unknown }) => entry)
  expect(import_pymatgen_pourbaix(bare).entries).toEqual(imported.entries)
  const unfiltered = import_pymatgen_pourbaix({ ...diagram_dict, filter_solids: false })
  expect(unfiltered.entries.map(({ formula }) => formula)).toContain(`Ag2O3`)
  const per_element = { ...diagram_dict, conc_dict: { Ag: 1e-6, Te: 1e-4 } }
  expect(import_pymatgen_pourbaix(per_element).element_log_conc).toEqual({ Ag: -6, Te: -4 })
})

// ComputedEntry dicts store their uncorrected energy and the summed correction apart
test(`ComputedEntry energies include their correction`, () => {
  const computed = {
    '@class': `ComputedEntry`,
    composition: { Zn: 2, O: 2 },
    energy: -6,
    correction: -0.5,
  }
  const ion = { ion: { Zn: 1, charge: 2 }, energy: -1.48, name: `Zn[2+]` }
  const metal = { composition: { Zn: 1 }, energy: 0 }
  const json = [metal, computed, { entry_type: `Ion`, entry: ion }]
  expect(import_pymatgen_pourbaix(json).entries).toEqual([
    { formula: `Zn`, energy: 0 },
    { formula: `ZnO`, energy: -3.25 },
    { formula: `Zn^2+`, energy: -1.48 },
  ])
  // the solid filter's hull needs the element's own solid
  expect(() => import_pymatgen_pourbaix(json.slice(1))).toThrow(/a solid of each element/)
})

test.each([
  [{}, /non-empty list of pymatgen PourbaixEntry/],
  [[], /non-empty list/],
  [[{ composition: { Zn: 1 } }], /entry 0 needs a numeric energy/],
  [[{ ion: { Zn: 1, charge: 0.5 }, energy: 1 }], /entry 0 needs an integer charge/],
  [[{ entry_list: [], weights: [], energy: 0 }], /ion or a composition \(no MultiEntry\)/],
])(`rejects unsupported shapes (%#)`, (json, message) => {
  expect(() => import_pymatgen_pourbaix(json)).toThrow(message)
})
