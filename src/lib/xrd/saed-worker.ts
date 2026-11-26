import { serve_worker } from 'svelte-widgets/worker-serve'
import { compute_saed_pattern } from './saed'

serve_worker(compute_saed_pattern)
