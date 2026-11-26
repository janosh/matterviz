import { serve_worker } from 'svelte-widgets/worker-serve'
import { compute_ternary_phase_diagram } from './compute'

serve_worker(compute_ternary_phase_diagram)
