// Shared utilities for trajectory parsing
import { ATOMIC_NUMBER_TO_SYMBOL } from '$lib/composition/parse'
import { is_elem_symbol } from '$lib/element'
import type { ElementSymbol } from '$lib/element/types'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure } from '$lib/structure/index'
import type { Pbc } from '$lib/structure/pbc'
import { make_site } from '$lib/structure/site'
import type { TrajectoryFrame } from './index'

const is_valid_row = (row: unknown): boolean => {
  if (!(Array.isArray(row) || (ArrayBuffer.isView(row) && `length` in row))) return false
  return math.is_finite_vec3_like(row as ArrayLike<unknown>)
}

const is_valid_vec3 = (coords: unknown): coords is Vec3 =>
  Array.isArray(coords) && math.is_finite_vec3_like(coords)

// Validate that data is a proper 3x3 matrix
// Accepts both regular arrays and typed arrays (Float32Array, Float64Array, etc.)
export function validate_3x3_matrix(data: unknown): math.Matrix3x3 {
  if (!Array.isArray(data) || data.length !== 3) {
    throw new Error(
      `Expected 3x3 matrix, got array of length ${Array.isArray(data) ? data.length : `non-array`}`,
    )
  }

  if (!data.every(is_valid_row)) {
    throw new Error(`Invalid 3x3 matrix structure`)
  }
  return data as math.Matrix3x3
}

export const convert_atomic_numbers = (numbers: number[]): ElementSymbol[] =>
  numbers.map((num) => {
    const symbol = ATOMIC_NUMBER_TO_SYMBOL[num]
    if (!symbol || !is_elem_symbol(symbol)) {
      throw new Error(`Unknown atomic number in trajectory data: ${num}`)
    }
    return symbol
  })

export const create_structure = (
  positions: number[][],
  elements: ElementSymbol[],
  lattice_matrix?: math.Matrix3x3,
  pbc?: Pbc,
  force_data?: number[][],
): AnyStructure => {
  if (positions.length !== elements.length) {
    throw new Error(
      `create_structure requires matching positions and elements lengths, got positions=${positions.length}, elements=${elements.length}`,
    )
  }
  const cart_to_frac = lattice_matrix ? math.create_cart_to_frac(lattice_matrix) : null

  const sites = positions.map((pos, idx) => {
    if (!is_valid_vec3(pos)) {
      throw new Error(`Invalid position at index ${idx}: expected 3 finite coordinates`)
    }

    const xyz = pos
    const abc = cart_to_frac ? cart_to_frac(xyz) : ([0, 0, 0] as Vec3)

    const force = force_data?.[idx]
    const properties = is_valid_vec3(force) ? { force } : {}

    return make_site(elements[idx], abc, xyz, `${elements[idx]}${idx + 1}`, properties)
  })

  return lattice_matrix
    ? {
        sites,
        lattice: {
          matrix: lattice_matrix,
          ...math.calc_lattice_params(lattice_matrix),
          pbc: pbc ?? ([true, true, true] satisfies Pbc),
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
    throw new Error(`Invalid array_offset: expected non-negative integer, got ${array_offset}`)
  }

  const bytes_needed = total * reader_config.bytes_per_element
  if (array_offset + bytes_needed > view.byteLength) {
    throw new Error(`Out-of-bounds read: array_offset + bytesNeeded exceeds view.byteLength`)
  }

  for (let idx = 0; idx < total; idx++) data.push(reader_config.read())

  return shape.length === 1
    ? [data]
    : shape.length === 2
      ? Array.from({ length: shape[0] }, (_, idx) =>
          data.slice(idx * shape[1], (idx + 1) * shape[1]),
        )
      : (() => {
          throw new Error(`Unsupported shape`)
        })()
}

// Copy listed fields from source to target when they hold numbers
export const copy_numeric_fields = (
  target: Record<string, number>,
  source: Record<string, unknown>,
  fields: readonly string[],
): void => {
  for (const field of fields) {
    if (field in source && typeof source[field] === `number`) target[field] = source[field]
  }
}

// Max and RMS of per-atom force magnitudes, or null when no forces present. Loop-based
// rather than Math.max(...spread) to avoid call-stack overflow on very large frames.
export function calc_force_stats(
  forces: number[][],
): { force_max: number; force_norm: number } | null {
  if (forces.length === 0) return null
  let force_max = -Infinity
  let sum_sq = 0
  for (const force of forces) {
    const magnitude = Math.hypot(...force)
    if (magnitude > force_max) force_max = magnitude
    sum_sq += magnitude ** 2
  }
  return { force_max, force_norm: Math.sqrt(sum_sq / forces.length) }
}

// Walk concatenated (ext)XYZ frames in `lines`, yielding each frame's atom-count line
// True when a whitespace-split line looks like an XYZ atom line: a short
// non-numeric element token followed by three numeric coordinates. Shared by
// trajectory frame iteration and structure-format sniffing so both stay in sync.
export const is_xyz_atom_line = (parts: string[] | undefined): boolean =>
  parts !== undefined &&
  parts.length >= 4 &&
  isNaN(parseInt(parts[0], 10)) &&
  parts[0].length <= 3 &&
  parts.slice(1, 4).every((coord) => !isNaN(parseFloat(coord)))

// index, parsed atom count, and comment line. A candidate frame is accepted only when its
// first few atom lines look like "<element> <x> <y> <z>"; otherwise we advance one line and
// rescan. That validation doubles as content sniffing so numeric-leading non-XYZ formats
// (e.g. VASP XDATCAR) aren't misread as frames, and keeps count_xyz_frames consistent with
// the actual parse/index walk (both go through this single source of truth).
export function* iter_xyz_frames(
  lines: string[],
): Generator<{ start: number; num_atoms: number; comment: string }> {
  let line_idx = 0
  while (line_idx < lines.length) {
    const num_atoms = parseInt(lines[line_idx]?.trim(), 10)
    if (isNaN(num_atoms) || num_atoms <= 0 || line_idx + num_atoms + 2 > lines.length) {
      line_idx++ // skip blank/invalid lines until the next frame's atom-count line
      continue
    }
    let valid_coords = 0
    const sample = Math.min(num_atoms, 3)
    for (let idx = 0; idx < sample; idx++) {
      if (is_xyz_atom_line(lines[line_idx + 2 + idx]?.trim().split(/\s+/))) valid_coords++
    }
    if (valid_coords < sample) {
      line_idx++ // count line looks valid but atom lines don't — likely non-XYZ content
      continue
    }
    yield { start: line_idx, num_atoms, comment: lines[line_idx + 1] || `` }
    line_idx += num_atoms + 2
  }
}

// Count XYZ frames via iter_xyz_frames so total_frames matches what gets indexed/loaded
export function count_xyz_frames(data: string): number {
  if (!data || typeof data !== `string`) return 0
  const frames = iter_xyz_frames(data.trim().split(/\r?\n/))
  let frame_count = 0
  while (!frames.next().done) frame_count += 1
  return frame_count
}
