// Shared utilities for trajectory parsing
import { ATOMIC_NUMBER_TO_SYMBOL } from '$lib/composition/parse'
import type { ElementSymbol } from '$lib/element'
import { ELEM_SYMBOLS } from '$lib/labels'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure, Pbc } from '$lib/structure'
import type { TrajectoryFrame } from './index'

const element_symbol_set = new Set<string>(ELEM_SYMBOLS)

export function is_valid_element_symbol(symbol: string): symbol is ElementSymbol {
  return element_symbol_set.has(symbol)
}

export function coerce_element_symbol(
  symbol: string,
): ElementSymbol | undefined {
  return is_valid_element_symbol(symbol) ? symbol : undefined
}

// Validate that data is a proper 3x3 matrix
// Accepts both regular arrays and typed arrays (Float32Array, Float64Array, etc.)
export function validate_3x3_matrix(data: unknown): math.Matrix3x3 {
  if (!Array.isArray(data) || data.length !== 3) {
    throw new Error(
      `Expected 3x3 matrix, got array of length ${
        Array.isArray(data) ? data.length : `non-array`
      }`,
    )
  }
  const is_valid_row = (row: unknown): boolean => {
    if (Array.isArray(row)) return row.length === 3
    if (!ArrayBuffer.isView(row)) return false
    return `length` in row && typeof row.length === `number` && row.length === 3
  }

  if (!data.every(is_valid_row)) {
    throw new Error(`Invalid 3x3 matrix structure`)
  }
  return data as math.Matrix3x3
}

export const convert_atomic_numbers = (numbers: number[]): ElementSymbol[] =>
  numbers.map((num) => ATOMIC_NUMBER_TO_SYMBOL[num] || `X`)

// Cache inverse matrices by original matrix reference for performance
// IMPORTANT: This cache assumes lattice matrices are immutable. Mutating a cached
// matrix in place yields incorrect inverses. Always create new matrix instances
// if modifications are needed.
const matrix_cache = new WeakMap<math.Matrix3x3, math.Matrix3x3>()
export const get_inverse_matrix = (matrix: math.Matrix3x3): math.Matrix3x3 => {
  const cached = matrix_cache.get(matrix)
  if (cached) return cached
  const inverse = math.matrix_inverse_3x3(matrix)
  matrix_cache.set(matrix, inverse)
  return inverse
}

export const create_structure = (
  positions: number[][],
  elements: ElementSymbol[],
  lattice_matrix?: math.Matrix3x3,
  pbc?: Pbc,
  force_data?: number[][],
): AnyStructure => {
  const inv_matrix = lattice_matrix ? get_inverse_matrix(lattice_matrix) : null

  const is_valid_vec3 = (coords: unknown): coords is Vec3 =>
    Array.isArray(coords) &&
    coords.length === 3 &&
    coords.every((value) => typeof value === `number` && Number.isFinite(value))

  const sites = positions.map((pos, idx) => {
    if (!is_valid_vec3(pos)) {
      throw new Error(`Invalid position at index ${idx}: expected 3 finite coordinates`)
    }

    const xyz = pos
    const abc = inv_matrix
      ? math.mat3x3_vec3_multiply(inv_matrix, xyz)
      : [0, 0, 0] as Vec3

    const force = force_data?.[idx]
    const properties = is_valid_vec3(force) ? { force } : {}

    return {
      species: [{ element: elements[idx], occu: 1, oxidation_state: 0 }],
      abc,
      xyz,
      label: `${elements[idx]}${idx + 1}`,
      properties,
    }
  })

  return lattice_matrix
    ? {
      sites,
      lattice: {
        matrix: lattice_matrix,
        ...math.calc_lattice_params(lattice_matrix),
        pbc: pbc || [true, true, true] satisfies Pbc,
      },
    }
    : { sites }
}

export const create_trajectory_frame = (
  positions: number[][],
  elements: ElementSymbol[],
  lattice_matrix: math.Matrix3x3 | undefined,
  pbc: Pbc | undefined,
  step: number,
  metadata: Record<string, unknown> = {},
): TrajectoryFrame => ({
  structure: create_structure(positions, elements, lattice_matrix, pbc),
  step,
  metadata,
})

// Shared utility to read ndarray data from binary format
export const read_ndarray_from_view = (
  view: DataView,
  ref: { ndarray: unknown[] },
): number[][] => {
  const [shape, dtype, array_offset] = ref.ndarray as [number[], string, number]
  const total = shape.reduce((product, dim_size) => product * dim_size, 1)
  const data: number[] = []
  let pos = array_offset

  const readers = {
    int64: {
      bytes_per_element: 8,
      read: () => {
        const value = Number(view.getBigInt64(pos, true))
        pos += 8
        return value
      },
    },
    int32: {
      bytes_per_element: 4,
      read: () => {
        const value = view.getInt32(pos, true)
        pos += 4
        return value
      },
    },
    float64: {
      bytes_per_element: 8,
      read: () => {
        const value = view.getFloat64(pos, true)
        pos += 8
        return value
      },
    },
    float32: {
      bytes_per_element: 4,
      read: () => {
        const value = view.getFloat32(pos, true)
        pos += 4
        return value
      },
    },
  }

  const reader_config = readers[dtype as keyof typeof readers]
  if (!reader_config) throw new Error(`Unsupported dtype: ${dtype}`)

  if (!Number.isInteger(array_offset) || array_offset < 0) {
    throw new Error(
      `Invalid array_offset: expected non-negative integer, got ${array_offset}`,
    )
  }

  const bytes_needed = total * reader_config.bytes_per_element
  if (array_offset + bytes_needed > view.byteLength) {
    throw new Error(
      `Out-of-bounds read: array_offset + bytesNeeded exceeds view.byteLength`,
    )
  }

  for (let idx = 0; idx < total; idx++) data.push(reader_config.read())

  return shape.length === 1
    ? [data]
    : shape.length === 2
    ? Array.from({ length: shape[0] }, (_, idx) =>
      data.slice(idx * shape[1], (idx + 1) * shape[1]))
    : (() => {
      throw new Error(`Unsupported shape`)
    })()
}

// Unified frame counting for XYZ
export function count_xyz_frames(data: string): number {
  if (!data || typeof data !== `string`) return 0
  const lines = data.trim().split(/\r?\n/)
  let frame_count = 0
  let line_idx = 0

  while (line_idx < lines.length) {
    if (!lines[line_idx]?.trim()) {
      line_idx++
      continue
    }

    const num_atoms = parseInt(lines[line_idx].trim(), 10)
    if (isNaN(num_atoms) || num_atoms <= 0 || line_idx + num_atoms + 1 >= lines.length) {
      line_idx++
      continue
    }

    // Quick validation of first few atom lines
    let valid_coords = 0
    for (let idx = 0; idx < Math.min(num_atoms, 3); idx++) {
      const parts = lines[line_idx + 2 + idx]?.trim().split(/\s+/)
      if (parts?.length >= 4 && isNaN(parseInt(parts[0])) && parts[0].length <= 3) {
        if (parts.slice(1, 4).every((coord) => !isNaN(parseFloat(coord)))) valid_coords++
      }
    }

    if (valid_coords >= Math.min(num_atoms, 3)) {
      frame_count++
      line_idx += 2 + num_atoms
    } else {
      line_idx++
    }
  }

  return frame_count
}
