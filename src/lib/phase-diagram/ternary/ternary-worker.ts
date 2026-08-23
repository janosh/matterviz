import { serve_worker } from '$lib/worker-serve'
import { compute_ternary_phase_diagram } from './compute'

serve_worker(compute_ternary_phase_diagram)
