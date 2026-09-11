// Exercises the synthesis planner's Web Worker boundary. Numerical correctness and progress are
// covered by synthesis-planning.test.ts; this verifies the cloneable contract and module path.
import type { PhaseData } from '$lib/convex-hull'
import { get_default_gas_provider } from '$lib/convex-hull/gas-thermodynamics'
import { plan_synthesis } from '$lib/synthesis-planning/plan'
import type { SynthesisPlanRequest } from '$lib/synthesis-planning/types'
import { afterEach, expect, test, vi } from 'vitest'
import {
  expect_module_worker,
  expect_worker_safe_import_graph,
  install_stub_worker,
  load_json,
} from '../setup'

const entries = load_json<PhaseData[]>(`src/site/synthesis-planning/Ba-Ti-C-O.json.gz`)
const stub = install_stub_worker<{
  id: number
  input: SynthesisPlanRequest
  options: undefined
}>(({ input }) => plan_synthesis(input))
const { plan_synthesis_async } = await import(
  `$lib/synthesis-planning/plan-synthesis-async.svelte`
)
afterEach(stub.reset)

test.each([false, true])(
  `async planning preserves results and progress (custom provider=%s)`,
  async (custom_provider) => {
    const request: SynthesisPlanRequest = {
      entries,
      target: `agm003129350`,
      conditions: { temperature: 1200, open_species: [`O2`, `CO2`] },
      max_routes: 5,
    }
    if (custom_provider)
      request.conditions = { ...request.conditions, gas_provider: get_default_gas_provider() }
    const on_progress = vi.fn()
    if (custom_provider) {
      const cancelled = plan_synthesis_async(request, { on_progress })
      plan_synthesis_async.cancel()
      await expect(cancelled).rejects.toThrow(/cancelled/)
      expect(on_progress).not.toHaveBeenCalled()
    }
    const result = await plan_synthesis_async(request, { on_progress })

    expect(result).toEqual(plan_synthesis(request))
    expect(result.target.id).toBe(`agm003129350`)
    if (custom_provider) {
      expect(stub.posted).toHaveLength(0)
      expect(on_progress).toHaveBeenLastCalledWith({ stage: `ranking`, current: 1, total: 1 })
    } else {
      expect(stub.posted[0].message.input.entries[0].entry_id).toBe(entries[0].entry_id)
      expect_module_worker(
        stub.instances,
        `src/lib/synthesis-planning/plan-synthesis-worker.ts`,
      )
      // Exercise the actual worker entry point too: the result-only stub above cannot prove
      // that the worker forwards the kernel's progress reports.
      const listeners = new Map<string, (event: unknown) => void>()
      const post_message = vi.fn()
      vi.stubGlobal(`self`, {
        addEventListener: (type: string, handler: (event: unknown) => void) =>
          listeners.set(type, handler),
        postMessage: post_message,
      })
      await import(`$lib/synthesis-planning/plan-synthesis-worker`)
      listeners.get(`message`)?.({ data: { id: 7, input: request } })
      expect(post_message.mock.calls.at(-2)?.[0]).toEqual({
        id: 7,
        progress: { stage: `ranking`, current: 1, total: 1 },
      })
      expect(post_message.mock.calls.at(-1)?.[0]).toEqual({ id: 7, result, error: null })
    }
  },
)

test(`worker runtime graph excludes Svelte and browser-only sanitizer modules`, () => {
  expect.hasAssertions()
  expect_worker_safe_import_graph(
    [`src/lib/synthesis-planning/plan-synthesis-worker.ts`],
    20,
    [`dompurify`],
  )
})
