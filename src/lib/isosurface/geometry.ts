// Isosurface geometry extraction shared by the main-thread fallback and geometry-worker.ts:
// prepares each volume's finite marching-cubes grid (display-range extraction or budget
// downsampling) and extracts every requested isovalue on it.
import { marching_cubes } from '$lib/marching-cubes'
import type { Matrix3x3, Vec3 } from '$lib/math'
import type { ScalarGrid3D } from './grid'
import { type DisplayRange, prepare_geometry_grid } from './sampling'
import type { VolumeGrid } from './types'

export interface GeometryVolumeJob {
  token: number
  volume: VolumeGrid
  range: DisplayRange | null
  // Scene origin (first volume's origin); vertices are shifted into that frame
  reference_origin: Vec3
  surfaces: { token: string; isovalue: number }[]
}

export interface GeometryInput {
  volumes: GeometryVolumeJob[]
}

interface GeometrySurfaceResult {
  token: string
  positions: Float32Array
  indices: Uint32Array
  marching_cubes_ms: number
}

interface GeometryVolumeResult {
  token: number
  // The prepared grid, returned so the caller can cache it for later sync extractions
  grid: ScalarGrid3D<Float64Array>
  lattice: Matrix3x3
  origin: Vec3
  prepare_geometry_ms: number
  surfaces: GeometrySurfaceResult[]
}

export interface GeometryResult {
  volumes: GeometryVolumeResult[]
}

// Marching-cubes options for a finite display window in scene coordinates
const finite_grid_options = (vertex_shift: Vec3) =>
  ({
    periodic: false,
    normals: false, // BufferGeometry.computeVertexNormals() on the main thread
    position_offset: vertex_shift,
  }) as const

export function compute_isosurface_geometries(input: GeometryInput): GeometryResult {
  const volumes = input.volumes.map((job): GeometryVolumeResult => {
    const prepare_start = performance.now()
    // Returns the source grid itself when there is no range and it is within budget
    const { grid, lattice, origin } = prepare_geometry_grid(job.volume, job.range)
    const prepare_geometry_ms = performance.now() - prepare_start
    const vertex_shift: Vec3 = [
      origin[0] - job.reference_origin[0],
      origin[1] - job.reference_origin[1],
      origin[2] - job.reference_origin[2],
    ]
    const surfaces = job.surfaces.map(({ token, isovalue }): GeometrySurfaceResult => {
      const marching_start = performance.now()
      const { positions, indices } = marching_cubes(
        grid,
        isovalue,
        lattice,
        finite_grid_options(vertex_shift),
      )
      return {
        token,
        positions,
        indices,
        marching_cubes_ms: performance.now() - marching_start,
      }
    })
    return { token: job.token, grid, lattice, origin, prepare_geometry_ms, surfaces }
  })
  return { volumes }
}

// Buffers a worker can hand back by ownership transfer instead of copying
export const geometry_result_transferables = (result: GeometryResult): Transferable[] =>
  result.volumes.flatMap((volume) => [
    volume.grid.values.buffer,
    ...volume.surfaces.flatMap((surface) => [
      surface.positions.buffer,
      surface.indices.buffer,
    ]),
  ])
