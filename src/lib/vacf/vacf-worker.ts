import { serve_worker } from '#lib/worker-serve.js'
import { calc_vacf } from './calc-vacf'

serve_worker(calc_vacf)
