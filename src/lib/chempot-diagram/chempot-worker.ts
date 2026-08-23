import { serve_worker } from '$lib/worker-serve'
import { compute_chempot_diagram } from './compute'

serve_worker(compute_chempot_diagram)
