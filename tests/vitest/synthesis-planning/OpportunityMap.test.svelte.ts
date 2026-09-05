import type { PhaseData } from '$lib/convex-hull/types'
import OpportunityMap from '$lib/synthesis-planning/OpportunityMap.svelte'
import { compute_opportunity_map } from '$lib/synthesis-planning/opportunity-map'
import type { OpportunityRequest } from '$lib/synthesis-planning/opportunity-map'
import { compute_opportunity_map_async } from '$lib/synthesis-planning/opportunity-map-async.svelte'
import { plan_synthesis } from '$lib/synthesis-planning/plan'
import type { SynthesisConditions } from '$lib/synthesis-planning/types'
import { mount, tick, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { expect_module_worker, install_stub_worker, load_json } from '../setup'

const entries = load_json<PhaseData[]>(`src/site/synthesis-planning/Ba-Ti-C-O.json.gz`)

test(`applies cells, preserves the sweep on condition updates, recomputes other pressures, and rejects invalid extents`, async () => {
  const stub = install_stub_worker<{ id: number; input: OpportunityRequest }>(({ input }) =>
    compute_opportunity_map(input),
  )
  const initial: SynthesisConditions = {
    temperature: 1000,
    open_species: [`CO2`, `O2`],
    partial_pressures: { O2: 0.21 },
  }
  let conditions = $state(initial)
  const plan = plan_synthesis({
    entries,
    target: `BaTiO3`,
    conditions: initial,
    max_routes: 2,
  })
  const onconditionschange = vi.fn((next: SynthesisConditions) => {
    conditions = next
  })
  const component = mount(OpportunityMap, {
    target: document.body,
    props: {
      entries: [...entries, { ...entries[0], entry_id: `invalid`, e_form_per_atom: NaN }],
      target: plan.target.id,
      routes: plan.routes,
      selected_route_id: `not-shortlisted`,
      get conditions() {
        return conditions
      },
      onconditionschange,
    },
  })
  onTestFinished(() => {
    compute_opportunity_map_async.cancel()
    return unmount(component)
  })
  await vi.waitFor(() =>
    expect(document.querySelectorAll(`.map-grid button`)).toHaveLength(81),
  )
  const first = document.querySelector<HTMLButtonElement>(`.map-grid button`)
  expect_module_worker(stub.instances, `src/lib/synthesis-planning/opportunity-map-worker.ts`)
  expect(stub.posted[0].message.input.entries.at(-1)?.e_form_per_atom).toBeNaN()
  expect(document.querySelector(`.opportunity-map`)?.textContent).toContain(
    `Selectivity shown for: ${plan.routes[0].reaction.equation}`,
  )
  expect(document.querySelector<HTMLSelectElement>(`select`)?.value).toBe(`O2`)
  first?.click()
  await tick()
  expect(onconditionschange).toHaveBeenCalledWith(
    { ...initial, temperature: 300, partial_pressures: { O2: 1e-8 } },
    undefined,
  )
  expect(first?.getAttribute(`aria-pressed`)).toBe(`true`)
  expect(stub.posted).toHaveLength(1)
  conditions = { ...initial, temperature: 300, partial_pressures: { O2: 1e-8, CO2: 0.01 } }
  await vi.waitFor(() => expect(stub.posted).toHaveLength(2))
  await vi.waitFor(() =>
    expect(document.querySelectorAll(`.map-grid button`)).toHaveLength(81),
  )
  const color = document.querySelectorAll<HTMLSelectElement>(`select`)[1]
  color.selectedIndex = 1
  color.dispatchEvent(new Event(`change`, { bubbles: true }))
  await tick()
  expect(document.querySelector(`.opportunity-map`)?.textContent).toContain(
    `weighted overall ranking`,
  )
  const max_temperature = document.querySelector<HTMLInputElement>(
    `[aria-label="Maximum map temperature"]`,
  )
  if (!max_temperature) throw new Error(`Map temperature control missing`)
  max_temperature.value = `100`
  max_temperature.dispatchEvent(new Event(`input`, { bubbles: true }))
  await tick()
  expect(document.querySelector(`[role="alert"]`)?.textContent).toContain(`minimum`)
  expect(stub.posted).toHaveLength(2)
})
