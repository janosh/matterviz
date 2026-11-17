import { serve_worker } from '#lib/worker-serve.js'
import { compute_msd } from './compute-msd'

serve_worker(compute_msd)
