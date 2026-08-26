// Exercises the synthesis planner's Web Worker boundary. Numerical correctness and progress are
// covered by synthesis-planning.test.ts; this verifies the cloneable contract and module path.
import type { PhaseData } from '$lib/convex-hull'
import { plan_synthesis } from '$lib/synthesis-planning/plan'
import type { SynthesisPlanRequest } from '$lib/synthesis-planning/types'
import { afterEach, expect, test } from 'vitest'
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

test(`worker result exactly matches the pure kernel and preserves entry ids`, async () => {
  const request: SynthesisPlanRequest = {
    entries,
    target: `agm003129350`,
    conditions: { temperature: 1200, open_species: [`O2`, `CO2`] },
    max_routes: 5,
  }
  const result = await plan_synthesis_async(request)

  expect(result).toEqual(plan_synthesis(request))
  expect(result.target.id).toBe(`agm003129350`)
  expect(stub.posted[0].message.input.entries[0].entry_id).toBe(entries[0].entry_id)
  expect_module_worker(stub.instances, `src/lib/synthesis-planning/plan-synthesis-worker.ts`)
})

test(`worker runtime graph excludes Svelte and browser-only sanitizer modules`, () => {
  expect.hasAssertions()
  expect_worker_safe_import_graph(
    [`src/lib/synthesis-planning/plan-synthesis-worker.ts`],
    20,
    [`dompurify`],
  )
})
