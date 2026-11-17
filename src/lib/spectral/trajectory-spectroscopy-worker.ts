import { serve_worker } from '#lib/worker-serve.js'
import { compute_trajectory_spectroscopy } from './trajectory-spectroscopy'

serve_worker(compute_trajectory_spectroscopy)
