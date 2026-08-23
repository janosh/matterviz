import { serve_worker } from '$lib/worker-serve'
import { calc_msd } from './calc-msd'

serve_worker(calc_msd)
