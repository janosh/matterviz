import { ELEM_SYMBOLS, type ElementSymbol } from '$lib/element/types'
import type { Vec3 } from '$lib/math'
import type * as math from '$lib/math'
import type { AnyStructure } from '$lib/structure/index'
import {
  cart_to_frac_with_fallback,
  make_lattice,
  matrix3x3_from_rows,
  parse_float_token,
} from '$lib/structure/parsers/shared'
import type { Pbc } from '$lib/structure/pbc'
import { make_site } from '$lib/structure/site'
import type { TrajectoryFrame, TrajectoryPositionStream } from './index'
import type { WarnFn } from './parse/shared'

// Numeric/element helpers shared with the structure parsers live in structure/parsers/shared
export { count_elements, parse_float_token } from '$lib/structure/parsers/shared'

// Number of values in one sample of the given shape (1 for a scalar)
export const values_per_sample = (shape: number[]): number =>
  shape.reduce((product, size) => product * size, 1)

export const is_supported_trajectory_signal_shape = (
  sample_shape: number[],
  n_atoms: number,
): boolean =>
  sample_shape.length === 0 ||
  (sample_shape.length === 1 && (sample_shape[0] === 3 || sample_shape[0] === n_atoms)) ||
  (sample_shape.length === 2 &&
    ((sample_shape[0] === 3 && sample_shape[1] === 3) ||
      (sample_shape[0] === n_atoms && sample_shape[1] === 3)))

export const validate_3x3_matrix = (data: unknown): math.Matrix3x3 =>
  matrix3x3_from_rows(data, `lattice matrix`)

export const convert_atomic_numbers = (numbers: number[]): ElementSymbol[] =>
  numbers.map((num) => {
    const symbol = Number.isInteger(num) ? ELEM_SYMBOLS[num - 1] : undefined
    if (!symbol) throw new Error(`Unknown atomic number in trajectory data: ${num}`)
    return symbol
  })

export const create_structure = (
  positions: number[][],
  elements: ElementSymbol[],
  lattice_matrix?: math.Matrix3x3,
  pbc?: Pbc,
  // One property bag per site, stored as-is (no copy) so hot parsers can build it in place
  site_properties?: Record<string, unknown>[],
  warn?: WarnFn,
): AnyStructure => {
  if (positions.length !== elements.length) {
    throw new Error(
      `create_structure requires matching positions and elements lengths, got positions=${positions.length}, elements=${elements.length}`,
    )
  }
  if (site_properties && site_properties.length !== positions.length) {
    throw new Error(
      `create_structure got ${site_properties.length} site property bags for ${positions.length} positions`,
    )
  }
  // Singular cells (a 2D slab with a zero c vector, a molecule written with a zero Lattice)
  // cannot be inverted for fractional coordinates; the per-axis-length fallback keeps one
  // degenerate frame from making the whole trajectory unloadable
  const cart_to_frac = lattice_matrix
    ? cart_to_frac_with_fallback(lattice_matrix, {
        context: `lattice ${JSON.stringify(lattice_matrix)}`,
        warn: warn ?? console.warn,
      }).convert
    : null

  const sites = positions.map((pos, idx) => {
    if (
      pos.length !== 3 ||
      !Number.isFinite(pos[0]) ||
      !Number.isFinite(pos[1]) ||
      !Number.isFinite(pos[2])
    ) {
      throw new Error(`Invalid position at index ${idx}: expected 3 finite coordinates`)
    }
    const xyz = pos as Vec3
    const abc = cart_to_frac ? cart_to_frac(xyz) : ([0, 0, 0] as Vec3)
    return make_site(
      elements[idx],
      abc,
      xyz,
      `${elements[idx]}${idx + 1}`,
      site_properties?.[idx],
    )
  })

  return lattice_matrix ? { sites, lattice: make_lattice(lattice_matrix, pbc) } : { sites }
}

export const create_trajectory_frame = (
  positions: number[][],
  elements: ElementSymbol[],
  lattice_matrix: math.Matrix3x3 | undefined,
  pbc: Pbc | undefined,
  step: number,
  metadata: Record<string, unknown> = {},
  site_properties?: Record<string, unknown>[],
  warn?: WarnFn,
): TrajectoryFrame => ({
  structure: create_structure(positions, elements, lattice_matrix, pbc, site_properties, warn),
  step,
  metadata,
})

// Buffers backing a position stream, for zero-copy postMessage out of a worker
export const position_stream_transferables = (
  data: TrajectoryPositionStream,
): ArrayBuffer[] => {
  const buffers = new Set<ArrayBuffer>()
  const add = (values: Float64Array) => buffers.add(values.buffer as ArrayBuffer)
  add(data.positions)
  for (const values of Object.values(data.vectors ?? {})) add(values)
  for (const signal of Object.values(data.signals ?? {})) add(signal.values)
  return [...buffers]
}

export const read_ndarray_from_view = (
  view: DataView,
  ref: { ndarray: unknown[] },
  base_offset: number = 0,
): number[][] => {
  const [shape, dtype, absolute_offset] = ref.ndarray as [number[], string, number]
  const array_offset = absolute_offset - base_offset
  const total = values_per_sample(shape)

  const readers: Record<string, { bytes: number; read: (pos: number) => number }> = {
    int64: { bytes: 8, read: (pos) => Number(view.getBigInt64(pos, true)) },
    int32: { bytes: 4, read: (pos) => view.getInt32(pos, true) },
    float64: { bytes: 8, read: (pos) => view.getFloat64(pos, true) },
    float32: { bytes: 4, read: (pos) => view.getFloat32(pos, true) },
  }
  const reader = readers[dtype]
  if (!reader) throw new Error(`Unsupported dtype: ${dtype}`)

  if (!Number.isInteger(array_offset) || array_offset < 0) {
    throw new Error(
      `Invalid array_offset: expected non-negative integer, got ${array_offset}${base_offset ? ` (absolute ${absolute_offset} minus base ${base_offset})` : ``}`,
    )
  }
  if (array_offset + total * reader.bytes > view.byteLength) {
    throw new Error(`Out-of-bounds read: array_offset + bytesNeeded exceeds view.byteLength`)
  }

  const data: number[] = []
  for (let idx = 0; idx < total; idx++) {
    data.push(reader.read(array_offset + idx * reader.bytes))
  }

  if (shape.length === 1) return [data]
  if (shape.length === 2) {
    return Array.from({ length: shape[0] }, (_, idx) =>
      data.slice(idx * shape[1], (idx + 1) * shape[1]),
    )
  }
  throw new Error(`Unsupported shape`)
}

export const copy_numeric_fields = (
  target: Record<string, number>,
  source: Record<string, unknown>,
  fields: readonly string[],
): void => {
  for (const field of fields) {
    if (typeof source[field] === `number`) target[field] = source[field]
  }
}

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

// Symbol (<= 3 chars, non-numeric) followed by three numeric coordinates. Coordinates go
// through the same strict parser as the frame reader so a Fortran `1.0D-3` token counts.
export const is_xyz_atom_line = (parts: string[] | undefined): boolean =>
  parts !== undefined &&
  parts.length >= 4 &&
  Number.isNaN(Number(parts[0])) &&
  parts[0].length <= 3 &&
  !Number.isNaN(parse_float_token(parts[1])) &&
  !Number.isNaN(parse_float_token(parts[2])) &&
  !Number.isNaN(parse_float_token(parts[3]))

// Location of one XYZ frame in a split file: `start` is the 0-based index of its atom-count line
export type XyzFrameSpec = { start: number; num_atoms: number; comment: string }

// Walk XYZ frames by their atom-count lines, sampling the first three atom lines of each
// candidate so stray numeric lines are not mistaken for a frame header. A frame whose atom
// block runs past the end of the input (a writer still appending) is not yielded; the first
// such candidate after the final complete frame is the generator's return value (a later one
// is a numeric comment line or stray number inside that frame's own block).
export function* iter_xyz_frames(
  lines: string[],
): Generator<XyzFrameSpec, XyzFrameSpec | null> {
  let line_idx = 0
  let torn: XyzFrameSpec | null = null
  while (line_idx < lines.length) {
    const num_atoms = Math.trunc(Number(lines[line_idx].trim()))
    if (Number.isNaN(num_atoms) || num_atoms <= 0) {
      line_idx++
      continue
    }
    const atom_lines = Math.max(0, Math.min(num_atoms, lines.length - line_idx - 2))
    const sample = Math.min(atom_lines, 3)
    let valid_coords = 0
    for (let idx = 0; idx < sample; idx++) {
      const line_at = line_idx + 2 + idx
      // The input's last line may be half-written by a writer still appending. A frame of
      // three atoms or fewer samples it, so it never disqualifies the frame here; the caller
      // decodes or drops it (index_xyz_frames), which a frame never indexed cannot be.
      if (line_at === lines.length - 1) valid_coords++
      else if (is_xyz_atom_line(lines[line_at].trim().split(/\s+/))) valid_coords++
    }
    if (valid_coords < sample) {
      line_idx++
      continue
    }
    const spec = { start: line_idx, num_atoms, comment: lines[line_idx + 1] ?? `` }
    if (atom_lines < num_atoms) {
      torn ??= spec
      line_idx++
      continue
    }
    torn = null
    yield spec
    line_idx += num_atoms + 2
  }
  return torn
}

// Count XYZ frames, stopping early once `limit` frames are found (format sniffing only
// needs to know whether there are at least two).
export function count_xyz_frames(data: string, limit = Number.POSITIVE_INFINITY): number {
  if (!data) return 0
  let frame_count = 0
  const frames = iter_xyz_frames(data.trim().split(/\r?\n/))
  while (frame_count < limit && !frames.next().done) frame_count += 1
  return frame_count
}
