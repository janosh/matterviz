import { serve_worker } from 'svelte-widgets/worker-serve'
import { plan_synthesis } from './plan'
import type { SynthesisPlan, SynthesisPlanRequest } from './types'

serve_worker<SynthesisPlanRequest, undefined, SynthesisPlan>(
  (request, _options, report_progress) =>
    plan_synthesis(request, { on_progress: report_progress }),
)
