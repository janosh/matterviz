import { serve_worker } from '#lib/worker-serve.js'
import { calc_msd } from './calc-msd'

serve_worker(calc_msd)
