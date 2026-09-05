import type { PhaseData } from '$lib/convex-hull'
import SynthesisPlanner from '$lib/synthesis-planning/SynthesisPlanner.svelte'
import { plan_synthesis } from '$lib/synthesis-planning/plan'
import type { SynthesisPlanRequest } from '$lib/synthesis-planning/types'
import { type ComponentProps, mount, tick, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { install_stub_worker, load_json } from '../setup'

const entries = load_json<PhaseData[]>(`src/site/synthesis-planning/Ba-Ti-C-O.json.gz`)
const mount_planner = (props: Partial<ComponentProps<typeof SynthesisPlanner>> = {}): void => {
  const component = mount(SynthesisPlanner, {
    target: document.body,
    props: { entries, target: `BaTiO3`, ...props },
  })
  onTestFinished(() => unmount(component))
}

// First mount pays for planning plus the 3D hull's threlte setup: ~1.3 s locally but ~5 s on
// a loaded CI runner, so the default 5 s test timeout is not enough headroom
test(
  `renders the selected route hull inside the detail-left pane`,
  { timeout: 20_000 },
  async () => {
    mount_planner()

    await vi.waitFor(
      () => {
        const hull = document.querySelector<HTMLElement>(`.detail-left > [role="application"]`)
        expect(hull).not.toBeNull()
        expect(hull?.style.flexGrow).toBe(`1`)
        expect(hull?.style.minHeight).toBe(`520px`)
      },
      { timeout: 15_000 },
    )
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

test(`rescales recipes without replanning or hiding routes`, async () => {
  const stub = install_stub_worker<{
    id: number
    input: SynthesisPlanRequest
    options: undefined
  }>(({ input }) => plan_synthesis(input))
  mount_planner({ show_hull: false })
  await vi.waitFor(() => {
    expect(stub.posted).toHaveLength(1)
    expect(document.querySelector(`.detail`)).not.toBeNull()
  })

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
