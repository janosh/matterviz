import { serve_worker } from 'svelte-widgets/worker-serve'
import { compute_vacf } from './compute-vacf'

serve_worker(compute_vacf)
