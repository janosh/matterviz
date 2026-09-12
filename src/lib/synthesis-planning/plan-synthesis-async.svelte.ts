// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Async synthesis planning through a persistent worker. Requests with a custom gas provider stay
// on the main thread because provider methods are not structured-cloneable.
import { create_worker_client, type WorkerRequestOptions } from '$lib/worker-client.svelte'
import { plan_synthesis } from './plan'
import type { SynthesisPlan, SynthesisPlanProgress, SynthesisPlanRequest } from './types'

const run_plan = create_worker_client<
  SynthesisPlanRequest,
  undefined,
  SynthesisPlan,
  SynthesisPlanProgress
>({
  label: `Synthesis planner`,
  create_worker: () =>
    new Worker(new URL(`./plan-synthesis-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: (request, _options, on_progress) => plan_synthesis(request, { on_progress }),
  build_payload: (request) => $state.snapshot(request),
  requires_main_thread: (request) => Boolean(request.conditions?.gas_provider),
})

export const plan_synthesis_async = Object.assign(
  (
    request: SynthesisPlanRequest,
    options: WorkerRequestOptions<SynthesisPlanProgress> = {},
  ): Promise<SynthesisPlan> => run_plan(request, undefined, options),
  { cancel: run_plan.cancel, release: run_plan.release },
)

export type PlanSynthesisAsync = typeof plan_synthesis_async
