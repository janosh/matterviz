import { serve_worker } from 'svelte-widgets/worker-serve'
import { compute_xrd_pattern } from './compute-xrd'

serve_worker(compute_xrd_pattern)
