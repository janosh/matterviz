import { serve_worker } from '$lib/worker-serve'
import { calc_vacf } from './calc-vacf'

serve_worker(calc_vacf)
