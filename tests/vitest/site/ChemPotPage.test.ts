import Page from '$root/src/routes/(demos)/convex-hull/chempot-diagram/+page.svelte'
import HullPage from '$root/src/routes/(demos)/convex-hull/+page.svelte'
import type { PhaseData } from '$lib/convex-hull'
import * as fixtures from '$site/convex-hull'
import { flushSync, mount, tick, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'
import { trigger_intersection } from '../environment'

test.each([
  [`Na-Fe-P-O`, `Co-O`, `Co`],
  [`Li-Co-Ni-O`, `Fe-O`, `Fe`],
])(
  `a failed %s import leaves the other system's subsets available`,
  async (failed, title, element) => {
    vi.spyOn(IntersectionObserver.prototype, `observe`).mockImplementation(() => {})
    vi.spyOn(fixtures, `quaternary_loader`).mockImplementation(
      (system) => () =>
        system === failed
          ? Promise.reject(new Error(`Fixture unavailable`))
          : Promise.resolve({ default: [{ composition: { [element]: 1 }, energy: 0 }] }),
    )
    const component = mount(HullPage, { target: document.body })
    try {
      await vi.waitFor(() => {
        expect(document.querySelector(`[role="alert"]`)?.textContent).toContain(
          `Failed to load ${failed} subset examples: Error: Fixture unavailable`,
        )
        expect(document.querySelector(`.binary-grid [aria-label="${title}"]`)).not.toBeNull()
      })
      expect(document.querySelectorAll(`[role="status"]`)).toHaveLength(0)
    } finally {
      await unmount(component)
      vi.restoreAllMocks()
    }
  },
)

test.each([`empty`, `failed`])(`chemical potential data load: %s`, async (outcome) => {
  const pending = Promise.withResolvers<{ default: PhaseData[] }>()
  const load = vi.fn(() => pending.promise)
  const loader = vi.spyOn(fixtures, `quaternary_loader`).mockReturnValue(load)
  const component = mount(Page, { target: document.body })
  try {
    flushSync()
    const regions = [...document.querySelectorAll(`.lazy-demo`)]
    for (const region of regions) trigger_intersection(region, false)
    await tick()
    expect(load).not.toHaveBeenCalled()
    const binary = regions[0]
    trigger_intersection(binary, true)
    await tick()
    expect(binary.textContent).toContain(`Loading Li-Co-Ni-O data`)
    if (outcome === `failed`) pending.reject(new Error(`Fixture unavailable`))
    else pending.resolve({ default: [] })
    await vi.waitFor(() => {
      expect(binary.textContent).toContain(
        outcome === `failed`
          ? `Failed to load Li-Co-Ni-O: Error: Fixture unavailable`
          : `No Li-O entries found.`,
      )
    })
    expect(binary.querySelector(`.spinner`)).toBeNull()
    expect(binary.querySelectorAll(`[role="alert"]`)).toHaveLength(
      outcome === `failed` ? 1 : 0,
    )
  } finally {
    await unmount(component)
    loader.mockRestore()
  }
})
