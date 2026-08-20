import type { Vec3 } from '$lib/math'

export type ScalarGridArray = Float32Array | Float64Array
export type ScalarGridOrder = `x_fastest` | `z_fastest`

// Contiguous scalar storage with explicit dimensions and linearization order.
// `z_fastest` is C order: index = (ix * ny + iy) * nz + iz. `x_fastest` is the
// Fortran/VASP layout: index = (iz * ny + iy) * nx + ix.
export interface ScalarGrid3D<ArrayType extends ScalarGridArray = ScalarGridArray> {
  values: ArrayType
  dims: Vec3
  order: ScalarGridOrder
}

// Nested [x][y][z] arrays are accepted at JSON boundaries and by marching cubes
export type ScalarGridLike = ScalarGrid3D | number[][][]

const is_scalar_grid = (grid: unknown): grid is ScalarGrid3D =>
  typeof grid === `object` &&
  grid !== null &&
  !Array.isArray(grid) &&
  `values` in grid &&
  `dims` in grid &&
  `order` in grid

export const grid_dimensions = (grid: ScalarGridLike): Vec3 => {
  if (Array.isArray(grid)) {
    return [grid.length, grid[0]?.length ?? 0, grid[0]?.[0]?.length ?? 0]
  }
  if (!is_scalar_grid(grid)) {
    throw new TypeError(`Scalar grid must define values, dims, and order`)
  }
  const dimensions: Vec3 = [...grid.dims]
  if (
    dimensions.length !== 3 ||
    dimensions.some((count) => !Number.isInteger(count) || count < 0)
  ) {
    throw new RangeError(`Scalar grid dimensions must contain three non-negative integers`)
  }
  if (grid.order !== `x_fastest` && grid.order !== `z_fastest`) {
    throw new RangeError(`Unsupported scalar grid order: ${String(grid.order)}`)
  }
  if (!(grid.values instanceof Float32Array || grid.values instanceof Float64Array)) {
    throw new TypeError(`Scalar grid values must be a Float32Array or Float64Array`)
  }
  const expected_length = dimensions[0] * dimensions[1] * dimensions[2]
  if (grid.values.length !== expected_length) {
    throw new RangeError(
      `Scalar grid values length ${grid.values.length} does not match dimensions ${dimensions.join(`×`)}`,
    )
  }
  return dimensions
}

export const grid_point_count = (grid: ScalarGridLike): number =>
  grid_dimensions(grid).reduce((product, count) => product * count, 1)

export function scalar_grid_strides({ dims: [nx, ny, nz], order }: ScalarGrid3D): Vec3 {
  if (order === `x_fastest`) return [1, nx, nx * ny]
  if (order === `z_fastest`) return [ny * nz, nz, 1]
  throw new RangeError(`Unsupported scalar grid order: ${String(order)}`)
}

// Copy a nested [x][y][z] array into a z-fastest Float64Array. Rows must all have the
// same length; ragged input throws instead of silently producing a misaligned grid.
export function flatten_grid(grid: number[][][]): ScalarGrid3D<Float64Array> {
  const dims = grid_dimensions(grid)
  const [, ny, nz] = dims
  const values = new Float64Array(dims[0] * ny * nz)
  let offset = 0
  for (const plane of grid) {
    if (plane.length !== ny) {
      throw new RangeError(`Ragged grid: expected ${ny} rows per plane, got ${plane.length}`)
    }
    for (const row of plane) {
      if (row.length !== nz) {
        throw new RangeError(`Ragged grid: expected ${nz} values per row, got ${row.length}`)
      }
      values.set(row, offset)
      offset += nz
    }
  }
  return { values, dims, order: `z_fastest` }
}
