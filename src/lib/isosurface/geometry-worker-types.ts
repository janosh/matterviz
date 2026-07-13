import type { Matrix3x3, Vec3 } from '$lib/math'
import type { DisplayRange } from './sampling'
import type { VolumetricData } from './types'

export type TransferableVolume = Pick<
  VolumetricData,
  `grid_dims` | `lattice` | `origin` | `periodic`
> & {
  grid_values: Float64Array
}

export interface GeometryWorkerRequest {
  volumes: {
    token: number
    volume: TransferableVolume
    range: DisplayRange | null
    reference_origin: Vec3
    surfaces: { token: string; isovalue: number }[]
  }[]
}

interface GeometryWorkerVolumeResult {
  token: number
  grid_dims: Vec3
  lattice: Matrix3x3
  origin: Vec3
  prepared_values: Float64Array
  prepare_geometry_ms: number
  surfaces: {
    token: string
    positions: Float32Array
    indices: Uint32Array
    marching_cubes_ms: number
  }[]
}

export type GeometryWorkerResponse =
  | {
      volumes: GeometryWorkerVolumeResult[]
    }
  | {
      error: string
    }
