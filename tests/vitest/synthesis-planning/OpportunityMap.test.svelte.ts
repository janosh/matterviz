import type { PhaseData } from '#lib/convex-hull/types.js'
import OpportunityMap from '#lib/synthesis-planning/OpportunityMap.svelte'
import { compute_opportunity_map } from '#lib/synthesis-planning/opportunity-map.js'
import type { OpportunityRequest } from '#lib/synthesis-planning/opportunity-map.js'
import { compute_opportunity_map_async } from '#lib/synthesis-planning/opportunity-map-async.svelte.js'
import { plan_synthesis } from '#lib/synthesis-planning/plan.js'
import type { SynthesisConditions } from '#lib/synthesis-planning/types.js'
import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vite-plus/test'
import {
  doc_query,
  expect_module_worker,
  expect_tooltip_paint,
  install_stub_worker,
  set_input,
} from '../setup'
import { load_json } from '../test-fixtures'

const entries = load_json<PhaseData[]>(`src/site/synthesis-planning/Ba-Ti-C-O.json.gz`)
const mount_map = (props: ComponentProps<typeof OpportunityMap>): void => {
  const component = mount(OpportunityMap, { target: document.body, props })
  onTestFinished(() => {
    compute_opportunity_map_async.cancel()
    return unmount(component)
  })
}
const n_cells = () => document.querySelectorAll(`.map-grid button`).length

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
  const plan_opts = { entries, target: `BaTiO3`, conditions: initial, max_routes: 2 }
  const plan = plan_synthesis(plan_opts)
  const on_conditions_change = vi.fn((next: SynthesisConditions) => (conditions = next))
  mount_map({
    entries: [...entries, { ...entries[0], entry_id: `invalid`, e_form_per_atom: NaN }],
    target: plan.target.id,
    routes: plan.routes,
    selected_route_id: `not-shortlisted`,
    get conditions() {
      return conditions
    },
    on_conditions_change,
  })
  await vi.waitFor(() => expect(n_cells()).toBe(81))
  const first = doc_query<HTMLButtonElement>(`.map-grid button`)
  first.focus()
  await tick()
  const tooltip = doc_query(`.plot-tooltip`)
  // the tooltip wears the focused cell's fill with contrasting text
  expect_tooltip_paint(tooltip, first.style.background)
  // trailing zeros trimmed: 1e-8 bar, not 1.0e-8
  const labels = [`Temperature: 300 K`, `O2: 1e-8 bar`, `Target above hull:`, `Route 1`]
  for (const label of [...labels, `Driving force:`, `Selectivity:`])
    expect(tooltip.textContent).toContain(label)
  const units = [...tooltip.querySelectorAll(`small`)].map((node) => node.textContent)
  expect(units).toEqual([`K`, `bar`, `meV/atom`, `meV/atom`, `meV/atom`])
  first.blur()
  expect_module_worker(stub.instances, `src/lib/synthesis-planning/opportunity-map-worker.ts`)
  expect(stub.posted[0].message.input.entries.at(-1)?.e_form_per_atom).toBeNaN()
  expect(document.querySelector(`.opportunity-map`)?.textContent).toContain(
    `Selectivity shown for: ${plan.routes[0].reaction.equation}`,
  )
  expect(document.querySelector<HTMLSelectElement>(`select`)?.value).toBe(`O2`)
  first.click()
  await tick()
  expect(on_conditions_change).toHaveBeenCalledWith(
    { ...initial, temperature: 300, partial_pressures: { O2: 1e-8 } },
    undefined,
  )
  expect(first.getAttribute(`aria-pressed`)).toBe(`true`)
  expect(stub.posted).toHaveLength(1)
  conditions = { ...initial, temperature: 300, partial_pressures: { O2: 1e-8, CO2: 0.01 } }
  await vi.waitFor(() => expect(stub.posted).toHaveLength(2))
  await vi.waitFor(() => expect(n_cells()).toBe(81))
  const color = document.querySelectorAll<HTMLSelectElement>(`select`)[1]
  color.selectedIndex = 1
  color.dispatchEvent(new Event(`change`, { bubbles: true }))
  await tick()
  expect(document.querySelector(`.opportunity-map`)?.textContent).toContain(
    `weighted overall ranking`,
  )
  set_input(doc_query<HTMLInputElement>(`[aria-label="Maximum map temperature"]`), `100`)
  await tick()
  expect(document.querySelector(`[role="alert"]`)?.textContent).toContain(`minimum`)
  expect(stub.posted).toHaveLength(2)
})

// Best-route colours cycle the 4-colour palette (route 5 wears route 1's), and a cell whose
// best route is not shortlisted (stale sweep) stays neutral and unnumbered, tooltip included
test(`preferred-route colours wrap past 4 routes and leave unknown routes neutral`, async () => {
  const conditions: SynthesisConditions = {
    temperature: 1000,
    open_species: [`O2`],
    partial_pressures: { O2: 0.21 },
  }
  const plan = plan_synthesis({ entries, target: `BaTiO3`, conditions, max_routes: 1 })
  const [route] = plan.routes
  const routes = [1, 2, 3, 4, 5].map((num) => ({
    ...route,
    id: `route-${num}`,
    reaction: { ...route.reaction, equation: `equation ${num}` },
  }))
  // one cell per best route (lowest selectivity margin among downhill ones), then a ghost
  const cells = [...routes.map(({ id }) => id), `ghost`].map((id, idx) => ({
    temperature: 300 + idx,
    pressure: 1e-8,
    e_above_hull: 0,
    routes: [
      { id, driving_force: -0.5, selectivity_margin: -0.2 },
      { id: `route-1`, driving_force: 0.1, selectivity_margin: -0.9 }, // uphill: ignored
    ],
  }))
  install_stub_worker(() => cells)
  const on_conditions_change = vi.fn()
  mount_map({ entries, target: plan.target.id, routes, conditions, on_conditions_change })
  await vi.waitFor(() => expect(n_cells()).toBe(6))
  const color = document.querySelectorAll<HTMLSelectElement>(`select`)[1]
  color.value = `preferred`
  color.dispatchEvent(new Event(`change`, { bubbles: true }))
  await tick()
  const buttons = [...document.querySelectorAll<HTMLButtonElement>(`.map-grid button`)]
  const fills = buttons.map(({ style }) => style.background)
  expect(buttons.map(({ textContent }) => textContent)).toEqual([`1`, `2`, `3`, `4`, `5`, `–`])
  expect(buttons[0].getAttribute(`aria-label`)).toMatch(/^300 K; O2 = 1e-8 bar; target /)
  expect(buttons[5].getAttribute(`aria-label`)).toMatch(/; best route outside the shortlist$/)
  expect(new Set(fills.slice(0, 4)).size).toBe(4)
  expect([fills[4], fills[5]]).toEqual([fills[0], ``])
  const legend = [...document.querySelectorAll<HTMLLIElement>(`.opportunity-map ol li`)]
  expect(legend.map(({ style }) => style.borderColor)).toEqual(fills.slice(0, 5))
  for (const [idx, fill, text] of [
    [4, fills[0], `Route 5`],
    [5, null, `Best route outside the shortlist`],
  ] as const) {
    buttons[idx].focus()
    await tick()
    const tooltip = doc_query(`.plot-tooltip`)
    expect_tooltip_paint(tooltip, fill)
    expect(tooltip.textContent).toContain(text)
    expect(tooltip.textContent).not.toContain(`Route 0`)
    buttons[idx].blur()
  }
})
