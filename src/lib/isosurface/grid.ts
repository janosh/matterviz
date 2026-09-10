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

const is_scalar_grid = (grid: unknown): grid is ScalarGrid3D =>
  typeof grid === `object` &&
  grid !== null &&
  !Array.isArray(grid) &&
  `values` in grid &&
  `dims` in grid &&
  `order` in grid

// Validated copy of a grid's dims; throws on anything that is not a well-formed ScalarGrid3D
export function grid_dimensions(grid: ScalarGrid3D): Vec3 {
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

export function scalar_grid_strides({
  dims: [size_x, size_y, size_z],
  order,
}: ScalarGrid3D): Vec3 {
  if (order === `x_fastest`) return [1, size_x, size_x * size_y]
  if (order === `z_fastest`) return [size_y * size_z, size_z, 1]
  throw new RangeError(`Unsupported scalar grid order: ${String(order)}`)
}

// Copy a nested [x][y][z] array into a z-fastest Float64Array. Rows must all have the
// same length; ragged input throws instead of silently producing a misaligned grid.
export function flatten_grid(grid: number[][][]): ScalarGrid3D<Float64Array> {
  const [size_x, size_y, size_z] = [
    grid.length,
    grid[0]?.length ?? 0,
    grid[0]?.[0]?.length ?? 0,
  ]
  const dims: Vec3 = [size_x, size_y, size_z]
  const values = new Float64Array(size_x * size_y * size_z)
  let offset = 0
  for (const plane of grid) {
    if (plane.length !== size_y) {
      throw new RangeError(
        `Ragged grid: expected ${size_y} rows per plane, got ${plane.length}`,
      )
    }
    for (const row of plane) {
      if (row.length !== size_z) {
        throw new RangeError(
          `Ragged grid: expected ${size_z} values per row, got ${row.length}`,
        )
      }
      values.set(row, offset)
      offset += size_z
    }
  }
  return { values, dims, order: `z_fastest` }
}

// Reorder an x-fastest (Fortran/VASP) value block into a z-fastest Float64Array,
// dividing by `divisor` on the way. The block must hold exactly nx·ny·nz values.
export function transpose_x_fastest(
  data: ArrayLike<number>,
  [size_x, size_y, size_z]: Vec3,
  divisor: number,
): Float64Array {
  const values = new Float64Array(size_x * size_y * size_z)
  if (data.length !== values.length) {
    throw new RangeError(
      `transpose_x_fastest: got ${data.length} values for a ${size_x}×${size_y}×${size_z} grid (${values.length})`,
    )
  }
  const ny_nz = size_y * size_z
  let flat_idx = 0
  for (let idx_z = 0; idx_z < size_z; idx_z++) {
    for (let idx_y = 0; idx_y < size_y; idx_y++) {
      const out_base = idx_y * size_z + idx_z
      for (let idx_x = 0; idx_x < size_x; idx_x++) {
        values[idx_x * ny_nz + out_base] = data[flat_idx++] / divisor
      }
    }
  }
  return values
}
