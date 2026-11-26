import { serve_worker } from 'svelte-widgets/worker-serve'
import { compute_trajectory_spectroscopy } from './trajectory-spectroscopy'

serve_worker(compute_trajectory_spectroscopy)
