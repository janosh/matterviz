import { serve_worker } from 'svelte-widgets/worker-serve'
import { compute_chempot_system } from './compute'

serve_worker(compute_chempot_system)
