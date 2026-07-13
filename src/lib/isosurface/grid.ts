import type { Vec3 } from '$lib/math'

interface FlatGrid3D {
  values: Float64Array
  dims: Vec3
}

export const grid_dimensions = (grid: number[][][]): Vec3 => [
  grid.length,
  grid[0]?.length ?? 0,
  grid[0]?.[0]?.length ?? 0,
]

export const grid_point_count = (grid: number[][][]): number =>
  grid_dimensions(grid).reduce((product, count) => product * count, 1)

export function flatten_grid(grid: number[][][]): FlatGrid3D {
  const dims = grid_dimensions(grid)
  const values = new Float64Array(dims[0] * dims[1] * dims[2])
  let offset = 0
  for (const plane of grid) {
    for (const row of plane) {
      values.set(row, offset)
      offset += row.length
    }
  }
  return { values, dims }
}

export function inflate_grid(values: Float64Array, [nx, ny, nz]: Vec3): number[][][] {
  const grid: number[][][] = Array(nx)
  let offset = 0
  for (let x_idx = 0; x_idx < nx; x_idx++) {
    const plane: number[][] = Array(ny)
    for (let y_idx = 0; y_idx < ny; y_idx++) {
      plane[y_idx] = Array.from(values.subarray(offset, offset + nz))
      offset += nz
    }
    grid[x_idx] = plane
  }
  return grid
}
