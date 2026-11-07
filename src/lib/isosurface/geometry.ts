// Isosurface geometry extraction shared by the main-thread fallback and geometry-worker.ts:
// marching cubes for every requested isovalue on each volume's finite grid, prepared by the
// caller (prepare_geometry_grid) so a worker receives at most MAX_GRID_POINTS values.
import { marching_cubes } from '#lib/marching-cubes.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import type { ScalarGrid3D } from './grid'

export interface GeometryVolumeJob {
  grid: ScalarGrid3D<Float64Array>
  lattice: Matrix3x3
  origin: Vec3
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

export interface GeometryResult {
  surfaces: GeometrySurfaceResult[]
}

export const compute_isosurface_geometries = (input: GeometryInput): GeometryResult => ({
  surfaces: input.volumes.flatMap(({ grid, lattice, origin, surfaces }) =>
    surfaces.map(({ token, isovalue }): GeometrySurfaceResult => {
      const marching_start = performance.now()
      const { positions, indices } = marching_cubes(grid, isovalue, lattice, {
        periodic: false, // finite display window in scene coordinates
        normals: false, // BufferGeometry.computeVertexNormals() on the main thread
        position_offset: origin,
      })
      // Front faces must point away from the enclosed lobe for the transparent back-then-front
      // pass and winding-derived normals; a negative lobe encloses values below the isovalue
      if (isovalue < 0) {
        for (let idx = 0; idx < indices.length; idx += 3)
          indices.subarray(idx + 1, idx + 3).reverse()
      }
      return {
        token,
        positions,
        indices,
        marching_cubes_ms: performance.now() - marching_start,
      }
    }),
  ),
})

// Buffers a worker can hand back by ownership transfer instead of copying
export const geometry_result_transferables = (result: GeometryResult): Transferable[] =>
  result.surfaces.flatMap((surface) => [surface.positions.buffer, surface.indices.buffer])
