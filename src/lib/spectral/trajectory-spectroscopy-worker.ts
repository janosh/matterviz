import { serve_worker } from '$lib/worker-serve'
import { calc_trajectory_spectroscopy } from './trajectory-spectroscopy'

serve_worker(calc_trajectory_spectroscopy)
