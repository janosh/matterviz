import { serve_worker } from 'svelte-widgets/worker-serve'
import { compute_msd } from './compute-msd'

serve_worker(compute_msd)
