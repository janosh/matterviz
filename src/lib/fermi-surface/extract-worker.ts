// Web Worker entry for Fermi surface extraction (marching cubes + zone folding per band).
// serve_worker hands back one grid object per retained input, so compute.ts's upsampled
// grids (cached by identity) persist between extractions
import { serve_worker } from '#lib/worker-serve.js'
import { extract_fermi_surface } from './compute'
import { fermi_surface_transferables } from './extract-job'

serve_worker(extract_fermi_surface, fermi_surface_transferables)
