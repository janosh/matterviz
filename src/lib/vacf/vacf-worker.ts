import { serve_worker } from '#lib/worker-serve.js'
import { compute_vacf } from './compute-vacf'

serve_worker(compute_vacf)
