import { serve_worker } from '#lib/worker-serve.js'
import { compute_chempot_system } from './compute'

serve_worker(compute_chempot_system)
