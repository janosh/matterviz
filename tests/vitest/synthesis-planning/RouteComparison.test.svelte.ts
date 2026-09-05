import type { PhaseData } from '$lib/convex-hull'
import RouteComparison from '$lib/synthesis-planning/RouteComparison.svelte'
import { plan_synthesis } from '$lib/synthesis-planning/plan'
import type { SynthesisRoute } from '$lib/synthesis-planning/types'
import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { bind_props, doc_query, load_json, trigger_resize_observer } from '../setup'

const base = plan_synthesis({
  entries: load_json<PhaseData[]>(`src/site/synthesis-planning/Ba-Ti-C-O.json.gz`),
  target: `BaTiO3`,
  max_routes: 1,
}).routes[0]
const routes: SynthesisRoute[] = Array.from({ length: 5 }, (_, idx) => ({
  ...base,
  id: `route-${idx}`,
  reaction: { ...base.reaction, equation: `Route ${idx}` },
}))

const mount_comparison = (props: ComponentProps<typeof RouteComparison>) => {
  const component = mount(RouteComparison, { target: document.body, props })
  onTestFinished(() => unmount(component))
}

test(`shortlisting is limited to four, independent of the viewed route, and survives stale ids`, async () => {
  const state = $state({
    routes,
    shortlist_ids: [`stale`, routes[0].id],
    selected_route_id: routes[4].id,
    comparison_options: {},
  })
  mount_comparison(bind_props({}, state))
  await tick()
  const comparison = doc_query(`.cell-preview`)
  expect(comparison.style.getPropertyValue(`--max-cell-lines`)).toBe(`8`)
  state.comparison_options = { max_cell_lines: 3 }
  await tick()
  expect(comparison.style.getPropertyValue(`--max-cell-lines`)).toBe(`3`)
  const select = doc_query<HTMLSelectElement>(`select`)
  for (const route of routes.slice(1, 4)) {
    select.value = route.id
    select.dispatchEvent(new Event(`change`, { bubbles: true }))
    await tick()
  }
  expect(state.shortlist_ids).toEqual(routes.slice(0, 4).map(({ id }) => id))
  expect(state.selected_route_id).toBe(routes[4].id)
  expect(select.disabled).toBe(true)
  expect(
    document.querySelector(`[id="${select.getAttribute(`aria-describedby`)}"]`)?.textContent,
  ).toContain(`Remove a route`)
  doc_query<HTMLButtonElement>(`button[aria-pressed]`).click()
  await tick()
  expect(state.selected_route_id).toBe(routes[0].id)
  doc_query<HTMLButtonElement>(`button[aria-label^="Remove"]`).click()
  await tick()
  expect(select.disabled).toBe(false)
  expect(state.selected_route_id).toBe(routes[0].id)
  expect(state.shortlist_ids).toHaveLength(3)
  state.routes = routes.slice(4)
  await tick()
  expect(document.querySelector(`table`)).toBeNull()
  expect(select.options).toHaveLength(2)
})

test(`comparison explains weighted tradeoffs, two-step adjustments, zero onset and missing guidance`, async () => {
  const better: SynthesisRoute = {
    ...routes[0],
    score: 4,
    score_breakdown: {
      selectivity: 3,
      inverse_hull: 0,
      driving_force: 0,
      competition: 0,
      practicality: 1,
      simplicity: 0,
    },
    thermodynamics: { ...base.thermodynamics, onset_temperature: 0 },
  }
  const alternative: SynthesisRoute = {
    ...routes[1],
    kind: `two_step`,
    reaction: { ...base.reaction, energy_per_atom: -0.02 },
    intermediate_step: {
      recipe: base.recipe,
      selectivity: base.selectivity,
      reaction: {
        ...base.reaction,
        reactants: [],
        equation: `Intermediate synthesis`,
        energy_per_atom: 0.01,
      },
      thermodynamics: {
        ...base.thermodynamics,
        temperature: 300,
        partial_pressures: { O2: 0.2 },
        onset_temperature: 0,
      },
    },
    score: 2,
    score_breakdown: { ...better.score_breakdown, practicality: 2 },
    thermodynamics: {
      ...base.thermodynamics,
      temperature: 1000,
      partial_pressures: { CO2: 0.01 },
      onset_temperature: null,
    },
  }
  mount_comparison({
    routes: [better, alternative],
    shortlist_ids: [better.id, alternative.id],
  })
  await tick()
  const row_values = (label: string) =>
    [...document.querySelectorAll(`tbody tr`)].find((row) =>
      row.querySelector(`th`)?.textContent?.startsWith(label),
    )?.textContent
  expect(row_values(`Weighted score`)).toContain(`Practicality adds 1 to the weighted score.`)
  expect(row_values(`Weighted score`)).toContain(
    `Multi-step adjustment subtracts 3 from the weighted score.`,
  )
  expect(row_values(`Multi-step adjustment`)).toContain(`−3.00`)
  expect(row_values(`Thermodynamic onset`)).toContain(`0 K`)
  expect(row_values(`Thermodynamic onset`)).toContain(`No onset available`)
  expect(document.querySelector(`thead`)?.textContent).toContain(
    `Step 1: Intermediate synthesis`,
  )
  expect(row_values(`Reaction energy`)).toContain(
    `Step 1: 10 — uphill\nStep 2: −20 — downhill`,
  )
  expect(row_values(`Model conditions`)).toContain(
    `Step 1: 300 K; O2: 0.2 bar\nStep 2: 1000 K; CO2: 0.01 bar`,
  )
  expect(row_values(`Handling`)).toContain(`Step 1: No handling notes in the available data.`)
  expect(row_values(`Handling`)).toContain(base.practicality.notes[0])
  expect(row_values(`Firings`)).toContain(`adjustment accounts for the first firing`)
  expect(document.querySelector(`button.cell-preview`)).toBeNull()
  const scroll_height = vi
    .spyOn(HTMLElement.prototype, `scrollHeight`, `get`)
    .mockReturnValue(200)
  const client_height = vi
    .spyOn(HTMLElement.prototype, `clientHeight`, `get`)
    .mockReturnValue(80)
  onTestFinished(() => {
    scroll_height.mockRestore()
    client_height.mockRestore()
  })
  trigger_resize_observer(doc_query(`.cell-preview`))
  await tick()
  const preview = doc_query<HTMLButtonElement>(`button.cell-preview`)
  preview.focus()
  await vi.waitFor(() => {
    const popup = document.querySelector(`[role="dialog"]`)
    expect(popup?.textContent).toBe(preview.textContent)
    expect(preview.getAttribute(`aria-expanded`)).toBe(`true`)
  })
  expect(document.querySelectorAll(`tbody tr`)).toHaveLength(16)
})

test.each([0, -2])(
  `equal %s scores identify ties even with zero or negative weighted contributions`,
  async (contribution) => {
    const tied = routes.slice(0, 2).map((route) => ({
      ...route,
      score: contribution,
      score_breakdown: {
        selectivity: contribution,
        inverse_hull: 0,
        driving_force: 0,
        competition: 0,
        practicality: 0,
        simplicity: 0,
      },
    }))
    mount_comparison({ routes: tied, shortlist_ids: tied.map(({ id }) => id) })
    await tick()
    const cells = [...document.querySelectorAll(`tbody tr:first-child td`)]
    expect(cells).toHaveLength(2)
    for (const cell of cells) expect(cell.textContent).toContain(`Tied for highest score`)
  },
)
