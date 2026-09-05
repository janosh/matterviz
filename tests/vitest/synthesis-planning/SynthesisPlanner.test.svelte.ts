import type { PhaseData } from '$lib/convex-hull'
import RecipeCard from '$lib/synthesis-planning/RecipeCard.svelte'
import * as hull_thermo from '$lib/convex-hull/thermodynamics'
import SynthesisPlanner from '$lib/synthesis-planning/SynthesisPlanner.svelte'
import { plan_synthesis } from '$lib/synthesis-planning/plan'
import type {
  SynthesisConditions,
  SynthesisPlan,
  SynthesisPlanRequest,
} from '$lib/synthesis-planning/types'
import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { bind_props, doc_query, install_stub_worker, load_json } from '../setup'

const entries = load_json<PhaseData[]>(`src/site/synthesis-planning/Ba-Ti-C-O.json.gz`)
const mount_planner = (props: Partial<ComponentProps<typeof SynthesisPlanner>> = {}): void => {
  const component = mount(SynthesisPlanner, {
    target: document.body,
    props: bind_props({ entries, target: `BaTiO3` }, props),
  })
  onTestFinished(() => unmount(component))
}

// First mount pays for planning plus the 3D hull's threlte setup: ~1.3 s locally but ~5 s on
// a loaded CI runner, so the default 5 s test timeout is not enough headroom
test(
  `opens the system hull on demand and keeps the reaction title above its plot`,
  { timeout: 20_000 },
  async () => {
    const hull_compute = vi.spyOn(hull_thermo, `compute_lower_hull_nd`)
    onTestFinished(() => hull_compute.mockRestore())
    mount_planner()
    await vi.waitFor(() => expect(document.querySelector(`.system-hull`)).not.toBeNull())
    expect(document.querySelector(`.system-hull > [role="application"]`)).toBeNull()
    const details = doc_query<HTMLDetailsElement>(`.system-hull`)
    details.open = true
    details.dispatchEvent(new Event(`toggle`))
    await vi.waitFor(
      () => {
        const hull = document.querySelector<HTMLElement>(`.system-hull > [role="application"]`)
        expect(hull).not.toBeNull()
        expect(hull?.style.flexGrow).toBe(`1`)
        expect(hull?.style.minHeight).toBe(`520px`)
        const slice = document.querySelector<HTMLElement>(`.detail-left .convex-hull-2d`)
        expect(slice?.style.getPropertyValue(`--hull-title-top`)).toBe(`0`)
      },
      { timeout: 15_000 },
    )
    const calls = hull_compute.mock.calls.length
    const choice = doc_query<HTMLInputElement>(`.recipe-card fieldset input`)
    choice.value = `1100`
    choice.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()
    expect(hull_compute).toHaveBeenCalledTimes(calls)
  },
)

test.each([
  [{ max_routes: 0 }, `max_routes`],
  [{ target_mass_g: 0 }, `target_mass_g`],
] as const)(`renders %s validation errors instead of throwing`, async (props, message) => {
  mount_planner({ ...props, show_hull: false })

  await vi.waitFor(() =>
    expect(document.querySelector(`.error`)?.textContent).toContain(message),
  )
})

test(`preserves experiment choices and shortlist through rescaling and replanning`, async () => {
  const stub = install_stub_worker<{
    id: number
    input: SynthesisPlanRequest
    options: undefined
  }>(({ input }) => plan_synthesis(input))
  const state = $state({
    plan: null as SynthesisPlan | null,
    conditions: { temperature: 0, open_species: [`CO2`, `O2`] } satisfies SynthesisConditions,
    shortlist_ids: [] as string[],
    selected_route_id: null as string | null,
  })
  mount_planner(
    bind_props({ show_hull: false, show_opportunity_map: false, max_routes: 1 }, state),
  )
  await vi.waitFor(() => {
    expect(stub.posted).toHaveLength(1)
    expect(document.querySelector(`.detail`)).not.toBeNull()
  })
  const temperature = doc_query<HTMLInputElement>(`.recipe-card fieldset input`)
  temperature.value = `1100`
  temperature.dispatchEvent(new Event(`input`, { bubbles: true }))
  await tick()
  const route_id = state.plan?.routes[0].id
  expect(state.plan?.routes[0].recipe.assumptions.temperature_K).toBe(`1100`)
  const mass_input = document.querySelector<HTMLInputElement>(`.recipe-card header input`)
  expect(mass_input).not.toBeNull()
  if (!mass_input) return
  mass_input.value = `2`
  mass_input.dispatchEvent(new Event(`input`, { bubbles: true }))
  await tick()

  expect(stub.posted).toHaveLength(1)
  expect(document.querySelector(`.detail`)).not.toBeNull()
  expect(document.querySelector(`.recipe-card tr.target td:nth-child(3)`)?.textContent).toBe(
    `2`,
  )
  const detail = document.querySelector(`.detail`)
  const alternative = plan_synthesis({
    entries,
    target: `BaTiO3`,
    conditions: state.conditions,
  }).routes[1]
  const shortlist = [alternative.id, ...state.shortlist_ids]
  state.shortlist_ids = shortlist
  state.conditions = { ...state.conditions, temperature: 1000 }
  state.selected_route_id = alternative.id
  await vi.waitFor(() => expect(state.plan?.conditions.temperature).toBe(1000))
  expect(stub.posted).toHaveLength(2)
  expect(document.querySelector(`.detail`)).toBe(detail)
  expect(state.shortlist_ids).toEqual(shortlist)
  expect(state.selected_route_id).toBe(alternative.id)
  const recipe = state.plan?.routes.find(({ id }) => id === route_id)?.recipe
  expect(recipe?.assumptions.temperature_K).toBe(`1100`)
  expect(recipe?.target_mass_g).toBe(2)
  expect(JSON.stringify(state.plan)).toContain(`"temperature_K":"1100"`)
})

test(`unmount aborts pending work before releasing the replacement worker`, async () => {
  const stub = install_stub_worker<{
    id: number
    input: SynthesisPlanRequest
    options: undefined
  }>()
  const component = mount(SynthesisPlanner, {
    target: document.body,
    props: { entries, target: `BaTiO3`, show_hull: false },
  })
  await vi.waitFor(() => expect(stub.posted).toHaveLength(1))

  await unmount(component)
  expect(stub.instances.map((worker) => worker.terminated)).toEqual([1, 1])
})

test(`experiment cards edit and copy each firing without losing quantities or assumptions`, async () => {
  const plan = plan_synthesis({
    entries,
    target: `BaTiO3`,
    two_step: true,
    conditions: { temperature: 1000, open_species: [`CO2`, `O2`] },
  })
  const route = plan.routes.find((candidate) => candidate.intermediate_step)
  if (!route) throw new Error(`No two-step route`)
  const props = $state({
    route,
    target_mass_g: 1,
    onassumptionschange: (
      step: `final` | `intermediate`,
      assumptions: typeof route.recipe.assumptions,
    ) => {
      const recipe =
        step === `intermediate` ? props.route.intermediate_step?.recipe : props.route.recipe
      if (recipe) recipe.assumptions = assumptions
    },
  })
  const component = mount(RecipeCard, { target: document.body, props: bind_props({}, props) })
  onTestFinished(() => unmount(component))
  await tick()
  expect(document.querySelectorAll(`.recipe-step`)).toHaveLength(2)
  const holds = [...document.querySelectorAll(`fieldset label`)].filter((label) =>
    label.textContent?.includes(`Hold (h)`),
  )
  for (const [idx, label] of holds.entries()) {
    const input = label.querySelector(`input`)
    if (!input) throw new Error(`Missing hold field`)
    input.value = `${idx + 4}`
    input.dispatchEvent(new Event(`input`, { bubbles: true }))
  }
  await tick()
  expect(props.route.intermediate_step?.recipe.assumptions.hold_hours).toBe(`4`)
  expect(props.route.recipe.assumptions.hold_hours).toBe(`5`)
  const original_mass = Number(doc_query(`.recipe-step tr.target td:nth-child(3)`).textContent)
  const mass_input = doc_query<HTMLInputElement>(`input[aria-label="Target mass (g)"]`)
  for (const value of [``, `0`, `-1`]) {
    mass_input.value = value
    mass_input.dispatchEvent(new Event(`input`, { bubbles: true }))
    await tick()
    expect(props.target_mass_g).toBe(1)
    expect(document.querySelectorAll(`.recipe-step`)).toHaveLength(2)
    expect(doc_query(`[role="alert"]`).textContent).toContain(`greater than zero`)
  }
  mass_input.value = `2`
  mass_input.dispatchEvent(new Event(`input`, { bubbles: true }))
  await tick()
  expect(Number(doc_query(`.recipe-step tr.target td:nth-child(3)`).textContent)).toBeCloseTo(
    original_mass * 2,
    3,
  )
  expect(props.route.recipe.target_mass_g).toBe(1)
  expect(document.querySelector(`[role="alert"]`)).toBeNull()
  const write_text = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal(`navigator`, { clipboard: { writeText: write_text } })
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  document
    .querySelector<HTMLButtonElement>(`button[title="Copy experiment card as text"]`)
    ?.click()
  await tick()
  expect(write_text).toHaveBeenCalledWith(expect.stringContaining(`Hold (h): 4`))
  expect(write_text).toHaveBeenCalledWith(expect.stringContaining(`Hold (h): 5`))
  expect(write_text).toHaveBeenCalledWith(expect.stringContaining(`Step 2:`))
  expect(write_text).toHaveBeenCalledWith(expect.stringContaining(`Calculated recipe for 2 g`))
})
