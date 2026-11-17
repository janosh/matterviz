import { serve_worker } from '#lib/worker-serve.js'
import { compute_xrd_pattern } from './compute-xrd'

serve_worker(compute_xrd_pattern)
