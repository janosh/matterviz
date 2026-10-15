// Web Worker entry for Fermi surface extraction (marching cubes + zone folding per band)
import { serve_worker } from '#lib/worker-serve.js'
import { extract_fermi_surface } from './compute'
import type { ExtractPayload } from './extract-job'
import { create_grid_store, fermi_surface_transferables } from './extract-job'
import type { FermiSurfaceOptions } from './types'

const grid_of = create_grid_store()
serve_worker(
  (payload: ExtractPayload, options: FermiSurfaceOptions | undefined) =>
    extract_fermi_surface(grid_of(payload), options),
  fermi_surface_transferables,
)
