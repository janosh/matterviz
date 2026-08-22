import { R_EV_PER_K } from '$lib/convex-hull/gas-thermodynamics'
import type { ElementSymbol } from '$lib/element'
import {
  build_free_energy_model,
  default_t_range,
  g_element_experimental,
  get_volume_per_atom,
  sisso_g_delta,
  sisso_reduced_mass,
} from '$lib/phase-diagram/ternary/free-energy'
import { G_ELEMENTS } from '$lib/phase-diagram/ternary/g-els-data'
import { describe, expect, test } from 'vitest'
import { phase } from './fixtures'

const elements: ElementSymbol[] = [`Li`, `Co`, `O`]
const li = phase({ Li: 1 }, -1.9, { entry_id: `Li` })
const co = phase({ Co: 1 }, -7, { entry_id: `Co` })
const o2 = phase({ O: 2 }, -2.45, { entry_id: `O2` })
const refs = (2 / 3) * -1.9 + (1 / 3) * -2.45 // Li2O reference energy per atom
const temps = [300, 500, 700]
const li2o_tab = phase({ Li: 2, O: 1 }, -4.5, {
  temperatures: temps,
  free_energies: [-4.5, -4.6, -4.7],
})
const li2o_vol = phase({ Li: 2, O: 1 }, -4.5, { volume_per_atom: 8, e_form_per_atom: -2.1 })
const dg = (entries: Parameters<typeof build_free_energy_model>[0], options = {}, idx = 3) =>
  build_free_energy_model(entries, elements, options).phases[idx]

test.each([
  [{ volume_per_atom: 12 }, 12],
  [{ structure: { lattice: { volume: 60 }, sites: [{}, {}, {}, {}] } }, 15],
  [{ data: { volume: 40 } }, 20],
  [{ structure: { lattice: { volume: 60 } } }, null],
  [{}, null],
])(`get_volume_per_atom(%o) = %s`, (extra, expected) => {
  expect(get_volume_per_atom({ composition: { Li: 2 }, energy: 0, ...extra })).toBe(expected)
})

test(`SISSO descriptor: reduced mass, G^delta and the elemental table`, () => {
  expect(
    sisso_reduced_mass([
      [`Li`, 2 / 3],
      [`O`, 1 / 3],
    ]),
  ).toBeCloseTo((6.94 * 15.999) / (6.94 + 15.999), 2)
  expect(sisso_reduced_mass([[`Li`, 1]])).toBeNull()
  // Bartel 2018 Eq. 4 evaluated by hand: pins all three fitted coefficients
  expect(sisso_g_delta(10, 12, 1000)).toBeCloseTo(-0.31002, 5)
  const oxygen = G_ELEMENTS.O ?? []
  expect(g_element_experimental(`O`, 300)).toBe(oxygen[0])
  expect(g_element_experimental(`O`, 350)).toBeCloseTo((oxygen[0] + oxygen[1]) / 2, 12)
  expect(g_element_experimental(`O`, 2000)).toBe(oxygen.at(-1))
  for (const [el, t_out] of [
    [`O`, 299],
    [`O`, 2001],
    [`Og`, 500],
  ] as const)
    expect(g_element_experimental(el, t_out)).toBeNaN()
})

describe(`build_free_energy_model`, () => {
  test(`static, tabulated and element references`, () => {
    const static_dg = dg([li, co, o2, phase({ Li: 2, O: 1 }, -4.5)])
    expect(static_dg.source).toBe(`static`)
    expect(static_dg.dg_form(300)).toBeCloseTo(-4.5 - refs, 10)
    expect(static_dg.dg_form(1500)).toBe(static_dg.dg_form(300))
    const tab = build_free_energy_model([li, co, o2, li2o_tab], elements)
    expect(tab.phases[3]).toMatchObject({ source: `tabulated`, t_range: [300, 700] })
    expect(tab.phases[3].dg_form(400)).toBeCloseTo(-4.55 - refs, 10)
    expect(tab.phases[3].dg_form(800)).toBeNaN()
    expect(tab.phases[0].dg_form(800)).toBe(0) // an element is its own reference
    expect(default_t_range(tab)).toEqual([300, 700])
    // A tabulated element reference bounds the diagram and enters every dG_f
    const li_tab = phase({ Li: 1 }, -1.9, {
      temperatures: temps,
      free_energies: [-1.9, -2, -2.1],
    })
    const model = build_free_energy_model(
      [li_tab, co, o2, phase({ Li: 2, O: 1 }, -4.5)],
      elements,
    )
    expect(model.reference_t_range).toEqual([300, 700])
    expect(model.phases[3].dg_form(700) - model.phases[3].dg_form(300)).toBeCloseTo(
      (2 / 3) * 0.2,
      10,
    )
    // Elements without a reference entry become dG_f = 0 synthetic references
    expect(
      Object.keys(build_free_energy_model([li2o_tab], elements).unary_refs).toSorted(),
    ).toEqual([`Co`, `Li`, `O`])
  })

  test.each([
    [`auto`, `tabulated`],
    [`static`, `static`],
    [`tabulated`, `tabulated`],
    [`sisso`, `sisso`],
  ] as const)(`mode %s picks %s for an entry with tables and a volume`, (mode, source) => {
    expect(dg([li, co, o2, { ...li2o_tab, volume_per_atom: 8 }], { mode }).source).toBe(source)
  })

  test(`sisso: dH_f + G^delta - sum x_e G_e(T); elements at their polymorph offset`, () => {
    const model = build_free_energy_model(
      [li, phase({ Li: 1 }, -1.85), co, o2, li2o_vol],
      elements,
      { mode: `sisso` },
    )
    const mass =
      sisso_reduced_mass([
        [`Li`, 2 / 3],
        [`O`, 1 / 3],
      ]) ?? NaN
    const expected =
      -2.1 +
      sisso_g_delta(8, mass, 1000) -
      ((2 / 3) * g_element_experimental(`Li`, 1000) +
        (1 / 3) * g_element_experimental(`O`, 1000))
    expect(model.phases[4]).toMatchObject({ source: `sisso`, t_range: [300, 2000] })
    expect(model.phases[4].dg_form(1000)).toBeCloseTo(expected, 10)
    expect(model.phases[4].dg_form(250)).toBeNaN()
    expect(model.phases[4].dg_form(1800)).toBeGreaterThan(model.phases[4].dg_form(300)) // O2 entropy
    expect(model.phases[0].dg_form(1000)).toBe(0)
    expect(model.phases[1].dg_form(1000)).toBeCloseTo(0.05, 10)
    expect(default_t_range(model)).toEqual([300, 2000])
    // dH_f derived from the unary references when e_form_per_atom is absent
    const derived = dg([li, co, o2, { ...li2o_vol, e_form_per_atom: undefined }], {
      mode: `sisso`,
    })
    const explicit = dg([li, co, o2, { ...li2o_vol, e_form_per_atom: -4.5 - refs }], {
      mode: `sisso`,
    })
    expect(derived.dg_form(900)).toBeCloseTo(explicit.dg_form(900), 10)
  })

  test(`gas atmosphere shifts the oxygen reference`, () => {
    const li2o = phase({ Li: 2, O: 1 }, -4.5)
    const gas_config = { enabled_gases: [`O2` as const] }
    const at = (pressure: number, extra = {}) =>
      dg([li, co, o2, li2o], { gas_config, gas_pressures: { O2: pressure }, ...extra })
    // 0 K references: the full mu(T, p) - mu(0 K, 1 bar) raises dG_f, more so at higher T
    const base = dg([li, co, o2, li2o])
    const shift_300 = at(1).dg_form(300) - base.dg_form(300)
    expect(shift_300).toBeGreaterThan(0)
    expect(at(1).dg_form(1000) - base.dg_form(1000)).toBeGreaterThan(shift_300)
    // The shift scales with the oxygen fraction (LiO2 has twice Li2O's x_O) and the
    // per-element memo must follow the temperature, not freeze at the first one asked
    const with_lio2 = [li, co, o2, li2o, phase({ Li: 1, O: 2 }, -4)]
    const shift_of = (idx: number) =>
      dg(with_lio2, { gas_config, gas_pressures: { O2: 1 } }, idx).dg_form(300) -
      dg(with_lio2, {}, idx).dg_form(300)
    expect(shift_of(4) / shift_of(3)).toBeCloseTo(2, 10)
    const one_model = at(1)
    const [g_300, g_1000] = [one_model.dg_form(300), one_model.dg_form(1000)]
    expect(g_1000 - g_300).toBeCloseTo(at(1).dg_form(1000) - at(1).dg_form(300), 10)
    expect(one_model.dg_form(300)).toBe(g_300)
    // Elements are their own reference and never shift
    expect(
      build_free_energy_model([li, co, o2, li2o], elements, { gas_config }).phases[2].dg_form(
        1000,
      ),
    ).toBe(0)
    // Lower pO2 destabilizes oxides by x_O k_B T ln(p) / 2
    expect(at(1e-10).dg_form(1000) - at(1).dg_form(1000)).toBeCloseTo(
      ((1 / 3) * R_EV_PER_K * 1000 * Math.log(1e10)) / 2,
      8,
    )
    // SISSO references already hold the 1 bar gas, so only the pressure term remains
    const sisso = (pressure?: number) =>
      dg([li, co, o2, li2o_vol], {
        mode: `sisso`,
        gas_config,
        gas_pressures: pressure === undefined ? undefined : { O2: pressure },
      }).dg_form(1000)
    const plain = dg([li, co, o2, li2o_vol], { mode: `sisso` }).dg_form(1000)
    expect(sisso(1)).toBeCloseTo(plain, 10)
    expect(sisso(1e-6) - plain).toBeCloseTo(
      ((1 / 3) * R_EV_PER_K * 1000 * Math.log(1e6)) / 2,
      8,
    )
    // A tabulated O reference already carries its own entropy: pressure term only, no matter
    // where the compound's G(T) comes from
    const o2_tab = { ...o2, temperatures: [300, 1000], free_energies: [-2.45, -2.45] }
    const tab_at = (pressure: number) =>
      dg([li, co, o2_tab, li2o], { gas_config, gas_pressures: { O2: pressure } }).dg_form(1000)
    expect(tab_at(1)).toBeCloseTo(dg([li, co, o2_tab, li2o]).dg_form(1000), 10)
    expect(tab_at(1e-6) - tab_at(1)).toBeCloseTo(
      ((1 / 3) * R_EV_PER_K * 1000 * Math.log(1e6)) / 2,
      8,
    )
  })

  test(`references: exclude_from_hull entries are skipped, disjoint tables throw`, () => {
    const li_low = phase({ Li: 1 }, -9, { exclude_from_hull: true })
    const model = build_free_energy_model(
      [li_low, li, co, o2, phase({ Li: 2, O: 1 }, -4.5)],
      elements,
    )
    expect(model.unary_refs.Li).toBe(li)
    expect(model.phases[0].dg_form(300)).toBeCloseTo(-9 + 1.9, 10)
    const o2_late = { ...o2, temperatures: [800, 1200], free_energies: [-2.45, -2.45] }
    const li_early = { ...li, temperatures: [300, 700], free_energies: [-1.9, -1.9] }
    expect(() => build_free_energy_model([li_early, co, o2_late], elements)).toThrow(
      /share no temperature range: Li 300–700 K, O 800–1200 K/,
    )
  })
})
