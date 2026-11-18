// Trajectory from a `matterviz-binary-v1` envelope (kind 'trajectory'), e.g. the anywidget
// `trajectory` trait when pymatviz ships numpy arrays as raw buffers. Positions, vectors and
// cells stay flat typed arrays; each frame is encoded on read straight into a numeric MD frame,
// so no per-site JS objects exist beyond frame 0's preview. Wire format: extensions/anywidget/readme.md
import { element_by_symbol } from '#lib/element/data.js'
import { element_from_atomic_number } from '#lib/element/helpers.js'
import {
  assert_shape,
  type BinaryArray,
  decode_binary_envelope,
  first_non_finite,
  is_float_array,
  to_float64,
} from '#lib/io/binary-arrays.js'
import { display_idx } from '#lib/labels.js'
import type { Matrix3x3 } from '#lib/math.js'
import { make_lattice } from '#lib/structure/parsers/shared.js'
import type { LatticeType, Pbc } from '#lib/structure/index.js'
import { create_numeric_md_frame, write_frame_vector } from './frame'
import type { TrajectoryMetadata } from './index'
import type { TrajectoryProvenance, TrajectoryRun } from './run'
import { numeric_run } from './runs/memory'

// unified atomic mass units per cubic angstrom to g/cm^3 (as structure/density.ts)
const AMU_PER_A3_TO_G_PER_CM3 = 1.66053907
const RESERVED = new Set([`positions`, `numbers`, `lattice`, `steps`])
const LATTICE_PARAMS = [`a`, `b`, `c`, `alpha`, `beta`, `gamma`] as const

const is_record = (value: unknown): value is Record<string, unknown> =>
  typeof value === `object` && value !== null && !Array.isArray(value)

// Finite float64 values of an array; `any_dtype` also admits integers (steps, scalars)
const float_array = (array: BinaryArray, name: string, any_dtype = false): Float64Array => {
  if (!any_dtype && !is_float_array(array)) {
    throw new TypeError(
      `Binary array '${name}' must be float32 or float64, got ${array.dtype}`,
    )
  }
  const values = to_float64(array)
  const bad_idx = first_non_finite(values)
  if (bad_idx !== -1) {
    throw new RangeError(
      `Binary array '${name}' has non-finite value at flat index ${bad_idx}`,
    )
  }
  return values
}

const matrix_at = (values: Float64Array, offset: number): Matrix3x3 => [
  [values[offset], values[offset + 1], values[offset + 2]],
  [values[offset + 3], values[offset + 4], values[offset + 5]],
  [values[offset + 6], values[offset + 7], values[offset + 8]],
]

function parse_pbc(value: unknown): Pbc {
  if (Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === `boolean`))
    return [value[0], value[1], value[2]]
  throw new TypeError(`Binary trajectory pbc must be 3 booleans, got ${JSON.stringify(value)}`)
}

export function trajectory_from_binary(
  payload: unknown,
  provenance: TrajectoryProvenance = {},
): TrajectoryRun {
  const { arrays, fields } = decode_binary_envelope(payload, `trajectory`)
  const { positions: positions_array, numbers: numbers_array, lattice, steps } = arrays
  if (!positions_array) throw new TypeError(`Binary trajectory needs a 'positions' array`)
  if (!numbers_array) throw new TypeError(`Binary trajectory needs a 'numbers' array`)
  assert_shape(positions_array, [null, null, 3], `positions`)
  const [n_frames, n_atoms] = positions_array.shape
  if (n_frames < 1 || n_atoms < 1) {
    throw new RangeError(
      `Binary trajectory needs at least 1 frame and 1 atom, got ${n_frames} x ${n_atoms}`,
    )
  }
  const positions = float_array(positions_array, `positions`)

  assert_shape(numbers_array, [n_atoms], `numbers`)
  if (is_float_array(numbers_array))
    throw new TypeError(`Binary array 'numbers' must have an integer dtype`)
  const numbers = Uint8Array.from(numbers_array.values)
  for (let idx = 0; idx < n_atoms; idx++) {
    if (
      numbers[idx] !== numbers_array.values[idx] ||
      !element_from_atomic_number(numbers[idx])
    )
      throw new RangeError(
        `Binary array 'numbers' has invalid atomic number ${numbers_array.values[idx]} at atom ${display_idx(idx)}`,
      )
  }

  // One shared [3, 3] cell or one per frame [n_frames, 3, 3]
  let cells: Float64Array | null = null
  let cell_stride = 0
  if (lattice) {
    if (lattice.shape.length === 2) assert_shape(lattice, [3, 3], `lattice`)
    else {
      assert_shape(lattice, [n_frames, 3, 3], `lattice`)
      cell_stride = 9
    }
    cells = float_array(lattice, `lattice`)
  }
  if (fields.pbc !== undefined && !cells)
    throw new TypeError(`Binary trajectory pbc needs a lattice`)
  const pbc = cells
    ? fields.pbc === undefined
      ? undefined
      : parse_pbc(fields.pbc)
    : undefined

  let step_values: Float64Array | null = null
  if (steps) {
    assert_shape(steps, [n_frames], `steps`)
    step_values = float_array(steps, `steps`, true)
  }
  const step_of = (frame_idx: number): number => step_values?.[frame_idx] ?? frame_idx

  // Every other array is a per-atom vec3 channel [n_frames, n_atoms, 3] (force, velocity)
  // or a per-frame scalar [n_frames] (energy, temperature)
  const vectors: [string, Float64Array][] = []
  const scalars: [string, Float64Array][] = []
  for (const [name, array] of Object.entries(arrays)) {
    if (RESERVED.has(name)) continue
    if (array.shape.length === 1) {
      assert_shape(array, [n_frames], name)
      scalars.push([name, to_float64(array)])
    } else {
      assert_shape(array, [n_frames, n_atoms, 3], name)
      vectors.push([name, float_array(array, name)])
    }
  }
  const vector_keys = vectors.map(([name]) => name)

  if (fields.metadata !== undefined && !is_record(fields.metadata))
    throw new TypeError(`Binary trajectory metadata must be an object`)
  const time_step = fields.time_step as TrajectoryRun[`time_step`]

  const frame_metadata = (frame_idx: number): Record<string, unknown> =>
    Object.fromEntries(scalars.map(([name, values]) => [name, values[frame_idx]]))
  const cell_of = (frame_idx: number): Matrix3x3 | undefined =>
    cells ? matrix_at(cells, frame_idx * cell_stride) : undefined

  const frame_size = n_atoms * 3
  const read = (frame_idx: number) => {
    const offset = frame_idx * frame_size
    const frame = create_numeric_md_frame(
      positions.subarray(offset, offset + frame_size),
      numbers,
      cell_of(frame_idx),
      pbc,
      step_of(frame_idx),
      frame_metadata(frame_idx),
      vector_keys,
    )
    for (const [column, [, values]] of vectors.entries())
      write_frame_vector(frame, column, values.subarray(offset, offset + frame_size))
    return frame
  }

  // Plot rows as full_data_extractor would build them, without materialising sites
  let total_mass = 0
  for (const number of numbers) {
    const element = element_from_atomic_number(number)
    total_mass += (element && element_by_symbol.get(element)?.atomic_mass) ?? 0
  }
  let lattice_params: LatticeType | undefined
  const properties: TrajectoryMetadata[] = Array.from({ length: n_frames }, (_, frame_idx) => {
    const step = step_of(frame_idx)
    const row: Record<string, number> = { Step: step }
    for (const [name, values] of scalars) {
      if (Number.isFinite(values[frame_idx])) row[name] = values[frame_idx]
    }
    const cell = cell_of(frame_idx)
    if (cell) {
      if (cell_stride || !lattice_params) lattice_params = make_lattice(cell, pbc)
      row.volume = lattice_params.volume
      for (const param of LATTICE_PARAMS) row[param] = lattice_params[param]
      row.density = (AMU_PER_A3_TO_G_PER_CM3 * total_mass) / lattice_params.volume
    }
    return { frame_number: frame_idx, step, properties: row }
  })

  return numeric_run(n_frames, read, {
    provenance: {
      format: `binary`,
      source_bytes: positions_array.values.byteLength,
      ...provenance,
    },
    metadata: fields.metadata ?? {},
    ...(time_step !== undefined && { time_step }),
    properties,
  })
}
