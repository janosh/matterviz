// Web Worker entry for isosurface geometry extraction; transfers the result buffers.
import { serve_worker } from '$lib/worker-serve'
import { compute_isosurface_geometries, geometry_result_transferables } from './geometry'

serve_worker(compute_isosurface_geometries, geometry_result_transferables)
