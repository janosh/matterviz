import { serve_worker } from '$lib/worker-serve'
import { plan_synthesis_with_progress } from './plan'
import type { SynthesisPlan, SynthesisPlanRequest } from './types'

serve_worker<SynthesisPlanRequest, undefined, SynthesisPlan>(
  (request, _options, report_progress) =>
    plan_synthesis_with_progress(request, { on_progress: report_progress }),
)
