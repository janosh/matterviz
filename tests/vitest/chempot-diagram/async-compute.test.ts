import type { PhaseData } from '$lib/convex-hull/types'
import { afterEach, describe, expect, test, vi } from 'vitest'

const entries: PhaseData[] = [
  { composition: { Li: 1 }, energy: -1 },
  { composition: { O: 1 }, energy: -2 },
]

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe(`compute_chempot_async`, () => {
  test(`rejects instead of throwing synchronously when Worker construction fails`, async () => {
    // Must be constructable (`new Worker()`); arrow functions are not.
    function FailingWorker() {
      throw new Error(`worker blocked by CSP`)
    }
    vi.stubGlobal(`Worker`, FailingWorker)
    vi.resetModules()
    const { compute_chempot_async } = await import(`$lib/chempot-diagram/async-compute.svelte`)

    // Must not throw synchronously; errors surface only via promise rejection
    const promise = compute_chempot_async(entries)
    await expect(promise).rejects.toThrow(`worker blocked by CSP`)
  })

  test(`falls back to main-thread compute without a Worker global`, async () => {
    vi.stubGlobal(`Worker`, undefined)
    vi.resetModules()
    const { compute_chempot_async } = await import(`$lib/chempot-diagram/async-compute.svelte`)

    const data = await compute_chempot_async(entries, { elements: [`Li`, `O`] })
    expect(Object.keys(data.domains).length).toBeGreaterThan(0)
  })
})
