import type { PhaseData } from '$lib/convex-hull'
import {
  analyze_selectivity,
  assign_e_above_hull,
  balance_reaction,
  DEFAULT_SCORE_WEIGHTS,
  format_plan_text,
  hull_at,
  lookup_precursor_info,
  make_reaction,
  onset_temperature,
  plan_synthesis,
  PRECURSOR_LIBRARY,
  precursor_key,
  prepare_phase_set,
  reaction_energy_at_temperature,
  resolve_phase,
  score_route,
  SYNTHESIS_PLAN_REQUEST_SCHEMA,
  SYNTHESIS_PLANNER_TOOL,
} from '$lib/synthesis-planning'
import type {
  CompetingPhase,
  PlannerPhase,
  SynthesisPlanProgress,
  SynthesisPlanRequest,
  SynthesisReaction,
} from '$lib/synthesis-planning'
import { plan_synthesis_with_progress } from '$lib/synthesis-planning/plan'
import { create_thermo_cache } from '$lib/synthesis-planning/thermo'
import { get_default_gas_provider } from '$lib/convex-hull/gas-thermodynamics'
import * as math from '$lib/math'
import { describe, expect, test, vi } from 'vitest'
import { make_phase, read_maybe_gz } from '../setup'
import pymatgen_reference from './fixtures/ba_ti_o_pymatgen_reference.json' with { type: 'json' }

const load_system = (path: string): PhaseData[] => JSON.parse(read_maybe_gz(path))
const ba_ti_c_o = load_system(`src/site/synthesis-planning/Ba-Ti-C-O.json.gz`)
const li_co_c_o = load_system(`src/site/synthesis-planning/Li-Co-C-O.json.gz`)
const ca_c_o = load_system(`src/site/phase-diagrams/ternary/Ca-C-O.json.gz`)
const ba_ti_o = load_system(`src/site/phase-diagrams/ternary/Ba-Ti-O.json.gz`)

// Toy A-B-O system: stable AO, BO2, ABO3 (target), metastable A2BO4 polymorphs, elemental refs
const toy_entries: PhaseData[] = [
  make_phase({ Li: 1 }, 0, { entry_id: `Li` }),
  make_phase({ Ti: 1 }, 0, { entry_id: `Ti` }),
  make_phase({ O: 1 }, 0, { entry_id: `O` }),
  make_phase({ Li: 2, O: 1 }, -2, { entry_id: `Li2O` }),
  make_phase({ Ti: 1, O: 2 }, -3, { entry_id: `TiO2` }),
  make_phase({ Li: 2, Ti: 1, O: 3 }, -2.8, { entry_id: `Li2TiO3` }),
  make_phase({ Li: 4, Ti: 1, O: 4 }, -2.3, { entry_id: `Li4TiO4-a` }),
  make_phase({ Li: 8, Ti: 2, O: 8 }, -2.35, { entry_id: `Li4TiO4-b` }),
]

const find = (phases: PlannerPhase[], formula: string): PlannerPhase => {
  const phase = phases.find((candidate) => candidate.formula === formula)
  if (!phase) throw new Error(`${formula} missing from phase set`)
  return phase
}

describe(`prepare_phase_set`, () => {
  test(`collapses polymorphs to the lowest-energy entry and keeps all ids resolvable`, () => {
    const phase_set = prepare_phase_set(toy_entries)
    const li4tio4 = find(phase_set.phases, `Li4TiO4`)
    expect(li4tio4.id).toBe(`Li4TiO4-b`)
    expect(li4tio4.energy_per_atom).toBeCloseTo(-2.35, 12)
    expect(resolve_phase(phase_set, `Li4TiO4-a`)?.energy_per_atom).toBeCloseTo(-2.3, 12)
    expect(resolve_phase(phase_set, `Li2 Ti O3`)?.id).toBe(`Li2TiO3`)
    expect(resolve_phase(phase_set, `not a formula`)).toBeNull()
    expect(phase_set.elements).toEqual([`Li`, `O`, `Ti`])
  })

  test(`adds missing elemental references at 0 eV/atom and gas species at μ(T, p)`, () => {
    const without_refs = toy_entries.filter(
      (entry) => Object.keys(entry.composition).length > 1,
    )
    const phase_set = prepare_phase_set(without_refs, {
      temperature: 1000,
      open_species: [`O2`, `CO2`],
      partial_pressures: { CO2: 1 },
    })
    expect(phase_set.elements).toEqual([`C`, `Li`, `O`, `Ti`])
    expect(find(phase_set.phases, `Li`).energy_per_atom).toBe(0)
    expect(find(phase_set.phases, `C`).id).toBe(`ref:C`)
    const o2 = find(phase_set.phases, `O2`)
    expect(o2.is_gas).toBe(true)
    expect(o2.n_atoms_per_fu).toBe(2)
    // The O2 gas replaces the elemental O reference and sits below it by T·S
    expect(phase_set.phases.some((phase) => phase.formula === `O`)).toBe(false)
    expect(o2.energy_per_atom).toBeLessThan(-1)
    const co2 = find(phase_set.phases, `CO2`)
    expect(co2.molar_mass).toBeCloseTo(44.01, 1)
    expect(co2.energy_per_atom).toBeLessThan(-1.6)
  })

  test(`uses conventional formula units and names for library precursors`, () => {
    const phase_set = prepare_phase_set([
      make_phase({ Li: 1 }, 0),
      make_phase({ O: 1 }, 0),
      make_phase({ Li: 4, O: 4 }, -1.5, { entry_id: `peroxide` }),
    ])
    const li2o2 = find(phase_set.phases, `Li2O2`)
    expect(li2o2.common_name).toBe(`lithium peroxide`)
    expect(li2o2.n_atoms_per_fu).toBe(4)
  })

  test(`skips entries without a computable formation energy and warns`, () => {
    const phase_set = prepare_phase_set([
      make_phase({ Li: 1 }, 0),
      make_phase({ Li: 1, O: 1 }, -1),
    ])
    expect(phase_set.warnings).toHaveLength(1)
    expect(phase_set.warnings[0]).toMatch(/Skipped 1 entries/)
    // The skipped LiO entry still contributes O to the element list, so an O reference is added
    expect(phase_set.phases.map((phase) => phase.formula).toSorted()).toEqual([`Li`, `O`])
  })
})

describe(`hull_at and assign_e_above_hull`, () => {
  test(`returns the decomposition and hull energy at a composition`, () => {
    const { phases } = prepare_phase_set(toy_entries)
    assign_e_above_hull(phases)
    const li4tio4 = find(phases, `Li4TiO4`)
    // Li4TiO4 (-2.35) vs Li2O + Li2TiO3 mixture: (3·-2 + 6·-2.8)/9 = -2.5333
    expect(li4tio4.e_above_hull).toBeCloseTo(2.5333333 - 2.35, 6)
    const hull = hull_at(
      li4tio4.fractions,
      phases.filter((phase) => phase.id !== li4tio4.id),
    )
    expect(hull?.energy).toBeCloseTo(-2.5333333, 6)
    expect(hull?.decomposition.map(({ phase }) => phase.formula).toSorted()).toEqual([
      `Li2O`,
      `Li2TiO3`,
    ])
    expect(find(phases, `Li2TiO3`).e_above_hull).toBe(0)
    expect(hull_at([0.5, 0.5, 0], [find(phases, `Li`)])).toBeNull()
  })

  test(`matches pymatgen PhaseDiagram hull distances for every Ba-Ti-O entry`, () => {
    const { phases, by_id } = prepare_phase_set(ba_ti_o)
    assign_e_above_hull(phases)
    const reference: Record<string, number> = pymatgen_reference.e_above_hull
    // Polymorph representatives only: the planner keeps one phase per formula
    let max_abs_diff = 0
    let n_compared = 0
    for (const phase of phases) {
      const expected = reference[phase.id]
      if (expected === undefined || !by_id.has(phase.id)) continue
      n_compared++
      max_abs_diff = Math.max(max_abs_diff, Math.abs(phase.e_above_hull - expected))
    }
    expect(n_compared).toBeGreaterThan(50)
    expect(max_abs_diff).toBeLessThan(1e-8)
    const stable = phases
      .filter((phase) => phase.e_above_hull === 0)
      .map((phase) => phase.formula)
    // pymatgen lists O2 for the elemental reference; the planner names the reference O
    expect(stable.map((formula) => (formula === `O` ? `O2` : formula)).toSorted()).toEqual(
      pymatgen_reference.stable_formulas,
    )
  })
})

describe(`balance_reaction`, () => {
  const conditions = { temperature: 1000, open_species: [`O2`, `CO2`] as const }
  const phase_set = prepare_phase_set(ba_ti_c_o, {
    ...conditions,
    open_species: [...conditions.open_species],
  })
  const gases = phase_set.phases.filter((phase) => phase.is_gas)
  const target = find(phase_set.phases, `BaTiO3`)

  test(`balances carbonate + oxide with CO2 release and scales to integers`, () => {
    const precursors = [find(phase_set.phases, `BaCO3`), find(phase_set.phases, `TiO2`)]
    const balanced = balance_reaction(precursors, target, gases, true)
    if (typeof balanced === `string`) throw new Error(balanced)
    expect(balanced.coefficients).toEqual([1, 1])
    const co2_idx = gases.findIndex((gas) => gas.formula === `CO2`)
    expect(balanced.gas_exchange[co2_idx]).toBeCloseTo(1, 9)
    expect(balanced.reactant_atoms).toBe(8)
    const reaction = make_reaction(precursors, target, gases, balanced)
    expect(reaction.equation).toBe(`BaCO3 + TiO2 → BaTiO3 + CO2`)
    expect(reaction.driving_force).toBeCloseTo(reaction.energy_per_fu / 8, 12)
    expect(reaction.energy_per_atom).toBeCloseTo(reaction.energy_per_fu / 5, 12)
  })

  test(`consumes O2 from the atmosphere when precursors are oxygen-poor`, () => {
    const precursors = [find(phase_set.phases, `BaO`), find(phase_set.phases, `Ti`)]
    const balanced = balance_reaction(precursors, target, gases, true)
    if (typeof balanced === `string`) throw new Error(balanced)
    const o2_idx = gases.findIndex((gas) => gas.formula === `O2`)
    expect(balanced.gas_exchange[o2_idx]).toBeCloseTo(-1, 9)
    // 2 BaO atoms + 1 Ti + 2 O from O2 consumed
    expect(balanced.reactant_atoms).toBeCloseTo(5, 9)
    const reaction = make_reaction(precursors, target, gases, balanced)
    expect(reaction.equation).toBe(`BaO + Ti + O2 → BaTiO3`)
    expect(reaction.reactants.find(({ phase }) => phase.is_gas)?.coefficient).toBeCloseTo(1, 9)
  })

  test.each([
    [[`BaO`, `TiO2`, `BaCO3`], `redundant_precursor`],
    [[`BaO`, `BaCO3`], `unbalanced`],
  ])(`rejects %j as %s`, (formulas, reason) => {
    const precursors = formulas.map((formula) => find(phase_set.phases, formula))
    expect(balance_reaction(precursors, target, gases, true)).toBe(reason)
  })

  test(`closed system cannot balance a carbonate route`, () => {
    const closed = prepare_phase_set(ba_ti_c_o)
    const precursors = [find(closed.phases, `BaCO3`), find(closed.phases, `TiO2`)]
    expect(balance_reaction(precursors, find(closed.phases, `BaTiO3`), [], true)).toBe(
      `unbalanced`,
    )
  })
})

describe(`analyze_selectivity`, () => {
  test(`finds competitors on the slice, their driving forces and the inverse hull energy`, () => {
    const entries = [
      ...toy_entries,
      make_phase({ Li: 2, Ti: 2, O: 5 }, -3.1, { entry_id: `Li2Ti2O5` }),
    ]
    const { phases } = prepare_phase_set(entries)
    assign_e_above_hull(phases)
    const precursors = [find(phases, `Li2O`), find(phases, `TiO2`)]
    const target = find(phases, `Li2TiO3`)
    const balanced = balance_reaction(precursors, target, [], true)
    if (typeof balanced === `string`) throw new Error(balanced)
    // Li2O (3 atoms, -2) + TiO2 (3 atoms, -3) → Li2TiO3 (6 atoms, -2.8): ΔE = -16.8 + 15 = -1.8 eV
    expect(balanced.energy_per_fu).toBeCloseTo(-1.8, 9)
    const target_force = balanced.energy_per_fu / balanced.reactant_atoms
    const selectivity = analyze_selectivity(precursors, target, [], phases, target_force)
    const cache = create_thermo_cache()
    const solver = vi.spyOn(math, `solve_linear_program`)
    for (const product of [target, find(phases, `Li2Ti2O5`)]) {
      for (const pair of [precursors, precursors.toReversed()]) {
        const expected = analyze_selectivity(pair, product, [], phases, target_force)
        solver.mockClear()
        const cold = analyze_selectivity(pair, product, [], phases, target_force, cache)
        expect(cold).toEqual(expected)
        const cold_calls = solver.mock.calls.length
        solver.mockClear()
        const warm = analyze_selectivity(pair, product, [], phases, target_force, cache)
        expect(warm).toEqual(expected)
        expect(warm.interfaces[0]).not.toBe(cold.interfaces[0])
        expect(solver.mock.calls.length).toBeLessThan(cold_calls)
      }
    }
    solver.mockRestore()
    // 2 Li2O + TiO2 → Li4TiO4 (9 atoms): -21.15 + 21 = -0.15 eV, a weak competitor
    expect(selectivity.competitors.map((comp) => comp.phase.formula)).toEqual([
      `Li2Ti2O5`,
      `Li4TiO4`,
    ])
    expect(selectivity.competitors[1].driving_force).toBeCloseTo(-0.15 / 9, 9)
    expect(selectivity.competitors[1].more_favorable_than_target).toBe(false)
    // Li2O + 2 TiO2 → Li2Ti2O5: 9·-3.1 - (-6 - 18) = -3.9 eV over 9 reactant atoms
    expect(selectivity.competitors[0].driving_force).toBeCloseTo(-3.9 / 9, 9)
    expect(selectivity.competitors[0].more_favorable_than_target).toBe(true)
    expect(selectivity.target_is_most_favorable).toBe(false)
    expect(selectivity.selectivity_margin).toBeCloseTo(-0.3 + 3.9 / 9, 9)
    // Inverse hull: lowest mixture of {Li2O, TiO2, Li2Ti2O5} at the Li2TiO3 composition is
    // Li2O + Li2Ti2O5 = 2 Li2TiO3 at (-6 - 27.9) / 12 = -2.825 eV/atom, i.e. below the target
    expect(selectivity.inverse_hull_energy).toBeCloseTo(-2.825 + 2.8, 9)
    expect(selectivity.interfaces).toHaveLength(1)
    expect(selectivity.interfaces[0].first_product?.phase.formula).toBe(`Li2Ti2O5`)
    expect(selectivity.interfaces[0].forms_target).toBe(false)
  })

  test(`driving forces along BaO-TiO2 match pymatgen InterfacialReactivity kinks`, () => {
    const { phases } = prepare_phase_set(ba_ti_o)
    assign_e_above_hull(phases)
    const precursors = [find(phases, `BaO`), find(phases, `TiO2`)]
    const target = find(phases, `BaTiO3`)
    const balanced = balance_reaction(precursors, target, [], true)
    if (typeof balanced === `string`) throw new Error(balanced)
    const target_force = balanced.energy_per_fu / balanced.reactant_atoms
    const selectivity = analyze_selectivity(precursors, target, [], phases, target_force)
    const forces = new Map(
      selectivity.competitors.map((comp) => [comp.phase.formula, comp.driving_force]),
    )
    forces.set(`BaTiO3`, target_force)
    const kinks = pymatgen_reference.bao_tio2_kinks.filter(
      (kink) => kink.reaction.includes(`->`) && !/^(?:TiO2|BaO) -> /.test(kink.reaction),
    )
    expect(kinks.length).toBeGreaterThanOrEqual(4)
    for (const kink of kinks) {
      const product = kink.reaction.split(`-> `)[1].replace(/^[\d.]+ /, ``)
      expect(forces.get(product), product).toBeCloseTo(kink.reaction_energy_per_atom, 9)
    }
    expect(selectivity.competitors[0].phase.formula).toBe(`Ba2TiO4`)
  })

  test(`equals the negative reaction energy when nothing competes`, () => {
    const { phases } = prepare_phase_set(
      toy_entries.filter((entry) => !entry.entry_id?.startsWith(`Li4TiO4`)),
    )
    assign_e_above_hull(phases)
    const precursors = [find(phases, `Li2O`), find(phases, `TiO2`)]
    const target = find(phases, `Li2TiO3`)
    const selectivity = analyze_selectivity(precursors, target, [], phases, -0.3)
    expect(selectivity.competitors).toEqual([])
    expect(selectivity.inverse_hull_energy).toBeCloseTo(1.8 / 6, 9)
    expect(selectivity.target_is_most_favorable).toBe(true)
    expect(selectivity.selectivity_margin).toBeCloseTo(-0.3, 12)
  })

  // with no competitors selectivity_margin collapses to the target driving force, so saturating
  // it would echo the driving_force term; an empty list is perfect selectivity and scores 1
  test(`score_route: no competitors is perfect selectivity, not a driving-force echo`, () => {
    const reaction = {
      reactants: [{ phase: { formula: `AO`, is_gas: false } }],
      equation: `AO → A`,
      energy_per_atom: -0.1,
      driving_force: -0.005,
    } as unknown as SynthesisReaction
    const rivals = [
      { phase: { formula: `A2O3` }, driving_force: -0.001 },
    ] as unknown as CompetingPhase[]
    const selectivity_of = (competitors: CompetingPhase[], selectivity_margin: number) =>
      score_route(
        reaction,
        {
          target_driving_force: -0.005,
          inverse_hull_energy: 0.05,
          competitors,
          selectivity_margin,
          n_more_favorable: 0,
          target_is_most_favorable: true,
          interfaces: [],
        },
        { score: 0.8, notes: [] },
        DEFAULT_SCORE_WEIGHTS,
      ).breakdown.selectivity
    expect(selectivity_of([], -0.005)).toBeCloseTo(3, 12)
    expect(selectivity_of(rivals, -0.004)).toBeCloseTo(3 * (0.004 / 0.104), 12)
  })
})

describe(`temperature dependence`, () => {
  const decomposition_onset = (
    pressure: number,
    cache: ReturnType<typeof create_thermo_cache>,
  ): number | null => {
    const conditions = {
      temperature: 300,
      open_species: [`CO2` as const],
      partial_pressures: { CO2: pressure },
    }
    const phase_set = prepare_phase_set(ca_c_o, conditions)
    const gases = phase_set.phases.filter((phase) => phase.is_gas)
    const balanced = balance_reaction(
      [find(phase_set.phases, `CaCO3`)],
      find(phase_set.phases, `CaO`),
      gases,
      true,
    )
    if (typeof balanced === `string`) throw new Error(balanced)
    const energy_at = reaction_energy_at_temperature(balanced, gases, [`CO2`], conditions)
    const cached = reaction_energy_at_temperature(balanced, gases, [`CO2`], conditions, cache)
    const temperatures = Array.from({ length: 2001 }, (_, idx) => idx)
    expect(temperatures.map(cached)).toEqual(temperatures.map(energy_at))
    expect(energy_at(300)).toBeCloseTo(balanced.energy_per_fu, 9)
    return onset_temperature(energy_at)
  }

  test(`CaCO3 decomposition onset drops with CO2 partial pressure`, () => {
    const cache = create_thermo_cache()
    const onset_1bar = decomposition_onset(1, cache)
    const onset_air = decomposition_onset(4e-4, cache)
    expect(onset_1bar).not.toBeNull()
    expect(onset_air).not.toBeNull()
    if (onset_1bar === null || onset_air === null) return
    expect(onset_air).toBeLessThan(onset_1bar)
    // Experiment: ~1170 K at 1 bar CO2; raw PBE formation energies put it a few hundred K lower
    expect(onset_1bar).toBeGreaterThan(600)
    expect(onset_1bar).toBeLessThan(1500)
  })

  test(`onset_temperature handles the trivial cases`, () => {
    expect(onset_temperature(() => -1)).toBe(0)
    expect(onset_temperature(() => 1)).toBeNull()
    expect(onset_temperature((temperature) => 500 - temperature)).toBe(501)
    expect(onset_temperature((temperature) => 500 - temperature, 400)).toBeNull()
  })
})

describe(`plan_synthesis`, () => {
  const base_request: SynthesisPlanRequest = {
    entries: ba_ti_c_o,
    target: `BaTiO3`,
    conditions: { temperature: 1200, open_species: [`O2`, `CO2`] },
    max_routes: 100,
  }

  test(`ranks the textbook BaCO3 + TiO2 route first and flags Ba2TiO4 on the BaO + TiO2 line`, () => {
    const provider = get_default_gas_provider()
    const mu = vi.spyOn(provider, `get_standard_chemical_potential`)
    const plan = plan_synthesis(base_request)
    const cached_calls = mu.mock.calls.length
    mu.mockClear()
    expect(
      plan_synthesis({
        ...base_request,
        conditions: { ...base_request.conditions, gas_provider: provider },
      }),
    ).toEqual(plan)
    expect(mu.mock.calls.length).toBeGreaterThan(cached_calls)
    mu.mockRestore()
    expect(plan.chemical_system).toBe(`Ba-C-O-Ti`)
    expect(plan.target.formula).toBe(`BaTiO3`)
    expect(plan.target_stability.is_stable).toBe(true)
    expect(plan.precursor_pool.map((phase) => phase.formula)).toEqual(
      expect.arrayContaining([`BaCO3`, `BaO`, `TiO2`]),
    )
    const [best] = plan.routes
    expect(best.reaction.equation).toBe(`BaCO3 + TiO2 → BaTiO3 + CO2`)
    expect(best.thermodynamics.gas_exchange.CO2).toBeCloseTo(1, 9)
    expect(best.thermodynamics.onset_temperature).toBeGreaterThan(0)
    // Ba2TiO4 is the experimentally observed intermediate of this reaction
    expect(best.selectivity.competitors[0].phase.formula).toBe(`Ba2TiO4`)
    expect(best.recipe.temperature_window.min_K).toBeGreaterThanOrEqual(1000)

    const oxide_route = plan.routes.find(
      (route) => route.reaction.equation === `BaO + TiO2 → BaTiO3`,
    )
    expect(oxide_route?.selectivity.competitors[0].phase.formula).toBe(`Ba2TiO4`)
    expect(oxide_route?.selectivity.competitors[0].more_favorable_than_target).toBe(true)
    expect(oxide_route?.rationale.join(` `)).toMatch(/Ba2TiO4/)

    // Every candidate set is either a route or counted in exactly one rejection bucket
    const n_rejected = Object.values(plan.rejected).reduce((sum, count) => sum + count, 0)
    expect(plan.routes.length + n_rejected).toBe(plan.n_candidates)
    // Scores are sorted and the breakdown sums to the score
    for (const [idx, route] of plan.routes.entries()) {
      if (idx > 0) expect(route.score).toBeLessThanOrEqual(plan.routes[idx - 1].score)
      const total = Object.values(route.score_breakdown).reduce((sum, value) => sum + value, 0)
      expect(total).toBeCloseTo(route.score, 9)
    }
  })

  test(`recipe masses balance and scale with target mass`, () => {
    const plan = plan_synthesis({ ...base_request, target_mass_g: 2.5 })
    const { recipe } = plan.routes[0]
    expect(recipe.target_mass_g).toBe(2.5)
    const mass = (role: string): number =>
      recipe.items
        .filter((item) => item.role === role)
        .reduce((sum, item) => sum + item.mass_g, 0)
    expect(mass(`precursor`) + mass(`atmosphere`)).toBeCloseTo(
      mass(`target`) + mass(`byproduct`),
      9,
    )
    expect(mass(`target`)).toBe(2.5)
    expect(recipe.mass_loss_percent).toBeCloseTo(
      (100 * mass(`byproduct`)) / mass(`precursor`),
      9,
    )
    expect(recipe.procedure.some((step) => step.includes(`g BaCO3`))).toBe(true)
    expect(recipe.procedure.some((step) => step.includes(`releases CO2`))).toBe(true)
    expect(plan.routes[0].thermodynamics.atmosphere).toBe(`air, open crucible (releases CO2)`)
  })

  test(`closed 0 K planning of LiCoO2 only finds oxide routes; carbonates need open species`, () => {
    const closed = plan_synthesis({ entries: li_co_c_o, target: `LiCoO2`, max_routes: 100 })
    expect(closed.routes.every((route) => !route.reaction.equation.includes(`CO3`))).toBe(true)
    expect(closed.conditions.open_species).toEqual([])
    const open = plan_synthesis({
      entries: li_co_c_o,
      target: `LiCoO2`,
      conditions: { temperature: 1100, open_species: [`O2`, `CO2`] },
      max_routes: 100,
    })
    const carbonate = open.routes.find((route) =>
      route.reaction.equation.startsWith(`4 CoO + 2 Li2CO3`),
    )
    expect(carbonate?.reaction.equation).toBe(`4 CoO + 2 Li2CO3 + O2 → 4 LiCoO2 + 2 CO2`)
    expect(carbonate?.recipe.mass_loss_percent).toBeGreaterThan(10)
  })

  test(`two_step adds routes through intermediates with both steps reported`, () => {
    const plan = plan_synthesis({ ...base_request, two_step: true })
    const two_step = plan.routes.filter((route) => route.kind === `two_step`)
    expect(two_step.length).toBeGreaterThan(0)
    for (const route of two_step) {
      expect(route.intermediate_step).toBeDefined()
      // The intermediate made in step 1 is consumed in step 2
      const intermediate = route.intermediate_step?.products[0].phase.formula
      expect(route.reaction.reactants.map(({ phase }) => phase.formula)).toContain(
        intermediate,
      )
      expect(route.rationale[0]).toMatch(/Two-step route via/)
    }
  })

  test(`precursor filters: allow, block, only_common, max_precursors`, () => {
    const allowed = plan_synthesis({ ...base_request, precursors: { allow: [`BaO`, `TiO2`] } })
    expect(allowed.precursor_pool.map((phase) => phase.formula).toSorted()).toEqual([
      `BaO`,
      `TiO2`,
    ])
    expect(allowed.routes.map((route) => route.reaction.equation)).toEqual([
      `BaO + TiO2 → BaTiO3`,
    ])

    const blocked = plan_synthesis({ ...base_request, precursors: { block: [`BaCO3`] } })
    expect(blocked.routes.every((route) => !route.reaction.equation.includes(`BaCO3`))).toBe(
      true,
    )

    const everything = plan_synthesis({ ...base_request, precursors: { only_common: false } })
    expect(everything.precursor_pool.length).toBeGreaterThan(allowed.precursor_pool.length + 2)

    const single = plan_synthesis({ ...base_request, max_precursors: 1 })
    expect(
      single.routes.every(
        (route) => route.reaction.reactants.filter(({ phase }) => !phase.is_gas).length === 1,
      ),
    ).toBe(true)
    expect(single.warnings.some((warning) => warning.includes(`matches no phase`))).toBe(false)
    const bogus = plan_synthesis({ ...base_request, precursors: { allow: [`Xx9`] } })
    expect(bogus.warnings.some((warning) => warning.includes(`matches no phase`))).toBe(true)
  })

  test(`polymorph targets and metastable targets are warned about`, () => {
    const { by_id, phases } = prepare_phase_set(ba_ti_c_o)
    const ground = phases.find((phase) => phase.formula === `BaTiO3`)
    const polymorph = [...by_id.values()].find(
      (phase) => phase.formula === `BaTiO3` && phase.id !== ground?.id,
    )
    if (!polymorph) throw new Error(`fixture has no BaTiO3 polymorph`)
    const plan = plan_synthesis({ ...base_request, target: polymorph.id })
    expect(plan.target.id).toBe(polymorph.id)
    expect(plan.warnings.join(` `)).toMatch(/higher-energy polymorph/)
    expect(plan.target_stability.is_stable).toBe(false)
    expect(plan.target_stability.decomposition.map(({ phase }) => phase.formula)).toEqual([
      `BaTiO3`,
    ])
  })

  test.each([
    [{ entries: [] }, /entries must be/],
    [{ target: `` }, /target must be a non-empty string/],
    [{ max_precursors: 7 }, /max_precursors/],
    [{ target: `NaCl` }, /matches no entry id or formula/],
    [{ conditions: { temperature: -1 } }, /conditions.temperature/],
    [{ conditions: { temperature: 2001 } }, /conditions.temperature/],
    [{ conditions: { open_species: [`Ar`] } }, /unsupported Ar/],
    [{ conditions: { partial_pressures: { O2: 0 } } }, /partial_pressures.O2/],
    [{ conditions: { partial_pressures: { Ar: 1 } } }, /unknown property Ar/],
    [{ precursors: { max_e_above_hull: -0.1 } }, /max_e_above_hull/],
    [{ precursors: { max_elements: 1.5 } }, /max_elements must be an integer/],
    [{ scoring: { selectivity: -1 } }, /scoring.selectivity/],
    [{ scoring: { mystery: 1 } }, /unknown property mystery/],
    [{ max_routes: 0 }, /max_routes/],
    [{ max_routes: 201 }, /max_routes/],
    [{ max_routes: 1.5 }, /max_routes must be an integer/],
    [{ target_mass_g: 0 }, /target_mass_g/],
    [{ two_step: `yes` }, /two_step must be a boolean/],
    [{ mystery: true }, /unknown property mystery/],
  ])(`rejects invalid request override %o`, (override, message) => {
    expect(() =>
      plan_synthesis({ ...base_request, ...override } as SynthesisPlanRequest),
    ).toThrow(message)
  })

  test(`progress-capable kernel preserves the exact synchronous result`, () => {
    const progress: SynthesisPlanProgress[] = []
    const result = plan_synthesis_with_progress(base_request, {
      on_progress: (update) => progress.push(update),
    })
    expect(result).toEqual(plan_synthesis(base_request))
    expect(progress[0]).toEqual({ stage: `preparing`, current: 0, total: 1 })
    expect(progress.some((update) => update.stage === `direct_routes`)).toBe(true)
    expect(progress.at(-1)).toEqual({ stage: `ranking`, current: 1, total: 1 })
  })
})

describe(`agent surface`, () => {
  test(`format_plan_text is compact and carries the decisive numbers`, () => {
    const plan = plan_synthesis({
      entries: ba_ti_c_o,
      target: `BaTiO3`,
      conditions: { temperature: 1200, open_species: [`O2`, `CO2`] },
    })
    const text = format_plan_text(plan, 3)
    expect(text).toContain(`Synthesis plan for BaTiO3`)
    expect(text).toContain(`1. BaCO3 + TiO2 → BaTiO3 + CO2`)
    expect(text).toMatch(/inverse hull \d+ meV\/atom/)
    expect(text).toMatch(/recipe for 1 g: [\d.]+ g BaCO3 \+ [\d.]+ g TiO2/)
    expect(text).toContain(`more routes in the structured result`)
    expect(text.length).toBeLessThan(6000)
  })

  test(`request schema covers the request type and the tool definition is well-formed`, () => {
    const request_keys: (keyof Omit<SynthesisPlanRequest, `entries`>)[] = [
      `target`,
      `precursors`,
      `conditions`,
      `max_precursors`,
      `two_step`,
      `scoring`,
      `max_routes`,
      `target_mass_g`,
    ]
    expect(Object.keys(SYNTHESIS_PLAN_REQUEST_SCHEMA.properties).toSorted()).toEqual(
      request_keys.toSorted(),
    )
    expect(SYNTHESIS_PLANNER_TOOL.name).toBe(`plan_synthesis`)
    expect(SYNTHESIS_PLANNER_TOOL.input_schema).toBe(SYNTHESIS_PLAN_REQUEST_SCHEMA)
    expect(structuredClone(SYNTHESIS_PLAN_REQUEST_SCHEMA)).toEqual(
      SYNTHESIS_PLAN_REQUEST_SCHEMA,
    )
  })
})

describe(`precursor library`, () => {
  test(`formulas parse, keys are unique and lookups ignore ordering and formula-unit multiples`, () => {
    const keys = PRECURSOR_LIBRARY.map((info) => precursor_key(info.formula))
    expect(new Set(keys).size).toBe(keys.length)
    expect(lookup_precursor_info(`HLiO`)?.formula).toBe(`LiOH`)
    expect(lookup_precursor_info(`LiO`)?.formula).toBe(`Li2O2`)
    expect(lookup_precursor_info(`O2Ti`)?.name).toBe(`titanium dioxide`)
    expect(lookup_precursor_info(`Xx9`)).toBeNull()
    expect(lookup_precursor_info(`BaTiO3`)).toBeNull()
  })
})
