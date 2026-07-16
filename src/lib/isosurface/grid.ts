import type { Vec3 } from '$lib/math'

type ScalarGridArray = Float32Array | Float64Array
export type ScalarGridOrder = `x_fastest` | `z_fastest`

// Contiguous scalar storage with explicit dimensions and linearization order.
// Nested [x][y][z] grids remain supported through ScalarGridLike.
export interface ScalarGrid3D {
  data: ScalarGridArray
  dimensions: Vec3
  order: ScalarGridOrder
}

export type ScalarGridLike = ScalarGrid3D | number[][][]

interface FlatGrid3D {
  values: Float64Array
  dims: Vec3
}

export const is_scalar_grid = (grid: ScalarGridLike): grid is ScalarGrid3D =>
  !Array.isArray(grid)

export const grid_dimensions = (grid: ScalarGridLike): Vec3 => {
  if (!is_scalar_grid(grid)) {
    return [grid.length, grid[0]?.length ?? 0, grid[0]?.[0]?.length ?? 0]
  }
  const dimensions: Vec3 = [...grid.dimensions]
  if (dimensions.some((count) => !Number.isInteger(count) || count < 0)) {
    throw new RangeError(`Scalar grid dimensions must be non-negative integers`)
  }
  if (grid.order !== `x_fastest` && grid.order !== `z_fastest`) {
    throw new RangeError(`Unsupported scalar grid order: ${String(grid.order)}`)
  }
  if (!(grid.data instanceof Float32Array || grid.data instanceof Float64Array)) {
    throw new TypeError(`Scalar grid data must be a Float32Array or Float64Array`)
  }
  const expected_length = dimensions[0] * dimensions[1] * dimensions[2]
  if (grid.data.length !== expected_length) {
    const shape = dimensions.join(`×`)
    throw new RangeError(
      `Scalar grid data length ${grid.data.length} does not match dimensions ${shape}`,
    )
  }
  return dimensions
}

export const grid_point_count = (grid: ScalarGridLike): number =>
  grid_dimensions(grid).reduce((product, count) => product * count, 1)

const flat_index = (
  [nx, ny, nz]: Vec3,
  order: ScalarGridOrder,
  x_idx: number,
  y_idx: number,
  z_idx: number,
): number =>
  order === `x_fastest` ? x_idx + nx * (y_idx + ny * z_idx) : z_idx + nz * (y_idx + ny * x_idx)

export function grid_value(
  grid: ScalarGridLike,
  x_idx: number,
  y_idx: number,
  z_idx: number,
): number {
  if (is_scalar_grid(grid)) {
    return grid.data[flat_index(grid.dimensions, grid.order, x_idx, y_idx, z_idx)]
  }
  return grid[x_idx][y_idx][z_idx]
}

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
