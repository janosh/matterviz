import type { PhaseData } from '$lib/convex-hull'
import SynthesisPlanner from '$lib/synthesis-planning/SynthesisPlanner.svelte'
import { type ComponentProps, mount, unmount } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'
import { load_json } from '../setup'

const entries = load_json<PhaseData[]>(`src/site/synthesis-planning/Ba-Ti-C-O.json.gz`)
const mount_planner = (props: Partial<ComponentProps<typeof SynthesisPlanner>> = {}): void => {
  const component = mount(SynthesisPlanner, {
    target: document.body,
    props: { entries, target: `BaTiO3`, ...props },
  })
  onTestFinished(() => unmount(component))
}

test(`renders the selected route hull inside the detail-left pane`, async () => {
  mount_planner()

  await vi.waitFor(
    () => expect(document.querySelector(`.detail-left > [role="application"]`)).not.toBeNull(),
    { timeout: 5000 },
  )
})

test(`renders request validation errors instead of throwing from the component`, async () => {
  mount_planner({ max_routes: 0, show_hull: false })

  await vi.waitFor(() =>
    expect(document.querySelector(`.error`)?.textContent).toContain(`max_routes`),
  )
})
