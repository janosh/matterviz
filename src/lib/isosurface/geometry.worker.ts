import { marching_cubes_buffers } from '$lib/marching-cubes'
import { flatten_grid, inflate_grid } from './_grid'
import { prepare_geometry_grid } from './sampling'
import type { VolumetricData } from './types'
import type {
  GeometryWorkerRequest,
  GeometryWorkerResponse,
  TransferableVolume,
} from './_geometry-worker-types'

interface WorkerScope {
  addEventListener(
    type: `message`,
    listener: (event: MessageEvent<GeometryWorkerRequest>) => void,
  ): void
  postMessage(message: GeometryWorkerResponse, transfer?: Transferable[]): void
}

const worker_scope = globalThis as unknown as WorkerScope

const inflate_volume = ({ grid_values, ...metadata }: TransferableVolume): VolumetricData => ({
  ...metadata,
  grid: inflate_grid(grid_values, metadata.grid_dims),
  data_range: { min: 0, max: 0, mean: 0, abs_max: 0 },
})

worker_scope.addEventListener(`message`, ({ data: request }): void => {
  try {
    const transfer: Transferable[] = []
    const volume_results: Exclude<GeometryWorkerResponse, { error: string }>[`volumes`] = []
    for (const job of request.volumes) {
      const prepare_start = performance.now()
      const volume = inflate_volume(job.volume)
      const { grid, lattice, origin } = prepare_geometry_grid(volume, job.range)
      const { values: prepared_values, dims: grid_dims } = flatten_grid(grid)
      transfer.push(prepared_values.buffer)
      const prepare_geometry_ms = performance.now() - prepare_start
      const surfaces = job.surfaces.map(({ token, isovalue }) => {
        const marching_start = performance.now()
        const buffers = marching_cubes_buffers(grid, isovalue, lattice, {
          periodic: false,
          interpolate: true,
          centered: false,
          normals: false,
          position_offset: [
            origin[0] - job.reference_origin[0],
            origin[1] - job.reference_origin[1],
            origin[2] - job.reference_origin[2],
          ],
        })
        transfer.push(buffers.positions.buffer, buffers.indices.buffer)
        return {
          token,
          positions: buffers.positions,
          indices: buffers.indices,
          marching_cubes_ms: performance.now() - marching_start,
        }
      })
      volume_results.push({
        token: job.token,
        grid_dims,
        lattice,
        origin,
        prepared_values,
        prepare_geometry_ms,
        surfaces,
      })
    }
    worker_scope.postMessage({ volumes: volume_results }, transfer)
  } catch (error) {
    worker_scope.postMessage(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      [],
    )
  }
})
