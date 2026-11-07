// Isosurface geometry extraction shared by the main-thread fallback and geometry-worker.ts:
// prepares each volume's finite marching-cubes grid (display-range extraction or budget
// downsampling) and extracts every requested isovalue on it.
import { GeometryMemoryBudget } from './memory'
import { marching_cubes } from '#lib/marching-cubes.js'
import type { Matrix3x3, Vec3 } from '#lib/math.js'
import type { ScalarGrid3D } from './grid'
import { type DisplayRange, prepare_geometry_grid } from './sampling'
import type { VolumeGrid } from './types'

export interface GeometryVolumeJob {
  token: number
  volume: VolumeGrid
  range: DisplayRange | null
  surfaces: { token: string; isovalue: number }[]
}

export interface GeometryInput {
  // Request working set: inputs (copied in a worker), preparation, scratch and outputs.
  // Callers deduct their resident scene buffers before supplying this optional limit.
  memory_budget_bytes?: number
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

// Structured clone copies a whole backing buffer, including storage outside a subview.
export const geometry_input_bytes = (input: GeometryInput): number =>
  [...new Set(input.volumes.map(({ volume }) => volume.values.buffer))].reduce(
    (bytes, buffer) => bytes + buffer.byteLength,
    0,
  )

export function admit_geometry_input(input: GeometryInput): GeometryMemoryBudget {
  const memory = new GeometryMemoryBudget(input.memory_budget_bytes)
  memory.reserve(geometry_input_bytes(input))
  return memory
}

export function compute_isosurface_geometries(input: GeometryInput): GeometryResult {
  const memory = admit_geometry_input(input)
  const volumes = input.volumes.map((job): GeometryVolumeResult => {
    const prepare_start = performance.now()
    // An endpoint-inclusive grid (a periodic cell gains its wrap-around samples)
    const { grid, lattice, origin } = prepare_geometry_grid(job.volume, job.range, memory)
    const prepare_geometry_ms = performance.now() - prepare_start
    const surfaces = job.surfaces.map(({ token, isovalue }): GeometrySurfaceResult => {
      const marching_start = performance.now()
      const { positions, indices } = marching_cubes(grid, isovalue, lattice, {
        memory_budget: memory,
        periodic: false, // finite display window in scene coordinates
        normals: false, // BufferGeometry.computeVertexNormals() on the main thread
        position_offset: origin,
      })
      // Reserve the main-thread normals, optional RGB colors and sampled scalar buffer.
      // Keeping this allowance even for uncolored surfaces permits later recoloring.
      memory.reserve(positions.byteLength * 2 + (positions.length / 3) * 4)
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
