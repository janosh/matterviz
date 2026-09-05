import type { PhaseData } from '$lib/convex-hull/types'
import { compute_opportunity_map } from '$lib/synthesis-planning/opportunity-map'
import type { OpportunityRequest } from '$lib/synthesis-planning/opportunity-map'
import { plan_synthesis } from '$lib/synthesis-planning/plan'
import * as thermo from '$lib/synthesis-planning/thermo'
import { expect, test, vi } from 'vitest'
import { load_json } from '../setup'

const entries = load_json<PhaseData[]>(`src/site/synthesis-planning/Ba-Ti-C-O.json.gz`)
const conditions = { temperature: 1000, open_species: [`O2`, `CO2`] as (`O2` | `CO2`)[] }
const plan = plan_synthesis({ entries, target: `BaTiO3`, conditions, max_routes: 4 })
const request: OpportunityRequest = {
  entries,
  target: plan.target.id,
  conditions,
  gas: `CO2`,
  temperatures: [0, 1000, 2000],
  log_pressures: [-8, 0],
  routes: plan.routes.slice(0, 2).map(({ id, reaction }) => ({
    id,
    precursor_ids: reaction.reactants
      .filter(({ phase }) => !phase.is_gas)
      .map(({ phase }) => phase.id),
  })),
}

test(`cached sweep matches planner hull and selectivity at temperature/pressure extremes without rebalancing cells`, () => {
  const spy = vi.spyOn(thermo, `balance_reaction`)
  const cells = compute_opportunity_map(request)
  const sweep_calls = spy.mock.calls.length
  expect(sweep_calls).toBeGreaterThan(0)
  // Each invocation prepares its own balances; grid size must not multiply that work.
  compute_opportunity_map({ ...request, temperatures: [1000], log_pressures: [0] })
  expect(spy.mock.calls.length - sweep_calls).toBe(sweep_calls)
  spy.mockRestore()
  let max_absolute = 0
  let max_relative = 0
  let n_compared = 0
  for (const cell of cells) {
    const expected = plan_synthesis({
      entries,
      target: request.target,
      conditions: {
        ...conditions,
        temperature: cell.temperature,
        partial_pressures: { CO2: cell.pressure },
      },
      max_routes: 100,
    })
    expect(cell.e_above_hull).toBeCloseTo(expected.target_stability.e_above_hull, 12)
    for (const actual of cell.routes) {
      const route = expected.routes.find(({ id }) => id === actual.id)
      // The map intentionally retains fixed-shortlist routes when the planner excludes them as uphill.
      if (!route) {
        expect(actual.driving_force).toBeGreaterThanOrEqual(0)
        continue
      }
      for (const key of [`driving_force`, `selectivity_margin`] as const) {
        const reference =
          key === `driving_force`
            ? route.reaction.driving_force
            : route.selectivity.selectivity_margin
        const error = Math.abs(actual[key] - reference)
        max_absolute = Math.max(max_absolute, error)
        max_relative = Math.max(
          max_relative,
          reference === 0 ? error : error / Math.abs(reference),
        )
        // 1e-12 eV/atom allows LP arithmetic well below the planner's 1e-9 energy decision threshold.
        expect(error).toBeLessThanOrEqual(1e-12)
        n_compared++
      }
    }
  }
  expect(n_compared).toBeGreaterThanOrEqual(12)
  expect(max_absolute).toBe(0)
  expect(max_relative).toBe(0)
})

test.each([0.01, 0.1, 1])(
  `keeps the ground state for a polymorph %s eV/atom higher`,
  (offset) => {
    const polymorph = {
      composition: plan.target.composition,
      energy: (plan.target.energy_per_atom + offset) * plan.target.n_atoms_per_fu,
      e_form_per_atom: plan.target.energy_per_atom + offset,
      entry_id: `metastable-target`,
    }
    const augmented = [...entries, polymorph]
    const expected = plan_synthesis({
      entries: augmented,
      target: polymorph.entry_id,
      conditions,
    })
    const [cell] = compute_opportunity_map({
      ...request,
      entries: augmented,
      target: polymorph.entry_id,
      temperatures: [1000],
      log_pressures: [Math.log10(3.95e-4)],
    })
    expect(cell.e_above_hull).toBeGreaterThanOrEqual(offset - 1e-12)
    expect(cell.e_above_hull).toBe(expected.target_stability.e_above_hull)
  },
)

test.each([
  { conditions: { ...conditions, partial_pressures: { O2: 0 } } },
  { conditions: { ...conditions, partial_pressures: { O2: NaN } } },
  { routes: [request.routes[0], request.routes[0]] },
  { routes: [{ id: `empty`, precursor_ids: [] }] },
  { temperatures: [] },
  { temperatures: [-1] },
  { temperatures: [2001] },
  { log_pressures: [NaN] },
  { log_pressures: [-13] },
  { temperatures: Array.from({ length: 226 }, () => 1000) },
  { routes: [] },
  { routes: Array.from({ length: 5 }, () => request.routes[0]) },
  { gas: `H2` as const },
  { target: `missing` },
  { routes: [{ id: `bad`, precursor_ids: [`missing`] }] },
])(`rejects invalid sweep inputs %j`, (invalid) => {
  expect(() => compute_opportunity_map({ ...request, ...invalid })).toThrow(
    /Scan|plan_synthesis/,
  )
})
