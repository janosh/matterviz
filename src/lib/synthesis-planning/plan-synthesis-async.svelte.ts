// oxlint-disable eslint-plugin-unicorn/relative-url-style -- Vite worker detection needs the `./` prefix
// Async synthesis planning through a persistent worker. Requests with a custom gas provider stay
// on the main thread because provider methods are not structured-cloneable.
import type { WorkerRequestOptions } from '$lib/worker-client.svelte'
import { abort_error, create_worker_client } from '$lib/worker-client.svelte'
import { to_error } from '$lib/utils'
import { plan_synthesis_with_progress } from './plan'
import type { SynthesisPlan, SynthesisPlanProgress, SynthesisPlanRequest } from './types'
import { validate_synthesis_plan_request } from './validation'

const run_plan = create_worker_client<
  SynthesisPlanRequest,
  undefined,
  SynthesisPlan,
  SynthesisPlanProgress
>({
  label: `Synthesis planner`,
  create_worker: () =>
    new Worker(new URL(`./plan-synthesis-worker.js`, import.meta.url), { type: `module` }),
  compute_sync: (request, _options, on_progress) =>
    plan_synthesis_with_progress(request, { on_progress }),
  build_payload: (request) => $state.snapshot(request),
})

export interface PlanSynthesisAsync {
  (
    request: SynthesisPlanRequest,
    options?: WorkerRequestOptions<SynthesisPlanProgress>,
  ): Promise<SynthesisPlan>
  cancel: (reason?: string) => void
  release: () => void
}

export const plan_synthesis_async: PlanSynthesisAsync = Object.assign(
  (
    request: SynthesisPlanRequest,
    options: WorkerRequestOptions<SynthesisPlanProgress> = {},
  ): Promise<SynthesisPlan> => {
    try {
      validate_synthesis_plan_request(request)
    } catch (error) {
      return Promise.reject(to_error(error))
    }
    const { signal, on_progress } = options
    if (request.conditions?.gas_provider) {
      if (signal?.aborted) {
        return Promise.reject(abort_error(signal, `Synthesis planner`))
      }
      return Promise.resolve().then(() => {
        if (signal?.aborted) throw abort_error(signal, `Synthesis planner`)
        return plan_synthesis_with_progress(request, { on_progress })
      })
    }
    return run_plan(request, undefined, options)
  },
  { cancel: run_plan.cancel, release: run_plan.release },
)
