import { serve_worker } from '#lib/worker-serve.js'
import { compute_saed_pattern } from './saed'

serve_worker(compute_saed_pattern)
