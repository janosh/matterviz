// Trajectory from a `matterviz-binary-v1` envelope (kind 'trajectory', wire format in
// extensions/anywidget/readme.md). Arrays stay the decoded typed arrays, each frame encoded on
// read into a numeric MD frame, so no per-site JS objects exist beyond frame 0's preview.
// The run borrows the payload's buffers (zero-copy), so they must stay unmodified for its life.
import { element_by_symbol } from '#lib/element/data.js'
import { element_from_atomic_number } from '#lib/element/helpers.js'
import {
  type BinaryArray,
  checked_array,
  decode_binary_envelope,
} from '#lib/io/binary-arrays.js'
import { display_idx } from '#lib/labels.js'
import type { Matrix3x3 } from '#lib/math.js'
import { TIME_UNIT_TO_THZ } from '#lib/spectral/frequency-units.js'
import { make_lattice } from '#lib/structure/parsers/shared.js'
import type { LatticeType, Pbc } from '#lib/structure/index.js'
import { is_plain_object } from 'svelte-widgets/utils'
import { BOOKKEEPING_METADATA_KEYS } from './extract'
import { create_numeric_md_frame, write_frame_vector } from './frame'
import type { TrajectoryMetadata } from './index'
import type { TrajectoryProvenance, TrajectoryRun } from './run'
import { numeric_run } from './runs/memory'

// unified atomic mass units per cubic angstrom to g/cm^3 (as structure/density.ts)
const AMU_PER_A3_TO_G_PER_CM3 = 1.66053907
const RESERVED = new Set([`positions`, `numbers`, `lattice`, `steps`])
const LATTICE_PARAMS = [`a`, `b`, `c`, `alpha`, `beta`, `gamma`] as const
const FIELDS = [`pbc`, `metadata`, `time_step`]
const TIME_UNITS = Object.keys(TIME_UNIT_TO_THZ)

// Values of an array that must hold only finite numbers (indexed loop: millions of values)
function finite_values({ values }: BinaryArray, name: string): BinaryArray[`values`] {
  for (let idx = 0; idx < values.length; idx++) {
    if (!Number.isFinite(values[idx]))
      throw new RangeError(`Binary array '${name}' has non-finite value at flat index ${idx}`)
  }
  return values
}

const matrix_at = (values: ArrayLike<number>, offset: number): Matrix3x3 => [
  [values[offset], values[offset + 1], values[offset + 2]],
  [values[offset + 3], values[offset + 4], values[offset + 5]],
  [values[offset + 6], values[offset + 7], values[offset + 8]],
]

export function trajectory_from_binary(
  payload: unknown,
  provenance: TrajectoryProvenance = {},
): TrajectoryRun {
  const { arrays, fields } = decode_binary_envelope(payload, `trajectory`)
  const unknown_field = Object.keys(fields).find((key) => !FIELDS.includes(key))
  if (unknown_field !== undefined)
    throw new TypeError(
      `Binary trajectory has unknown field '${unknown_field}', expected ${FIELDS.join(`, `)}`,
    )
  const positions_array = checked_array(
    arrays.positions,
    `positions`,
    [null, null, 3],
    `float`,
  )
  const [n_frames, n_atoms] = positions_array.shape
  if (n_frames < 1 || n_atoms < 1) {
    throw new RangeError(
      `Binary trajectory needs at least 1 frame and 1 atom, got ${n_frames} x ${n_atoms}`,
    )
  }
  const positions = finite_values(positions_array, `positions`)

  const raw_numbers = checked_array(arrays.numbers, `numbers`, [n_atoms], `integer`).values
  const numbers = Uint8Array.from(raw_numbers)
  for (let idx = 0; idx < n_atoms; idx++) {
    if (numbers[idx] !== raw_numbers[idx] || !element_from_atomic_number(numbers[idx]))
      throw new RangeError(
        `Binary array 'numbers' has invalid atomic number ${raw_numbers[idx]} at atom ${display_idx(idx)}`,
      )
  }

  // One shared [3, 3] cell or one per frame [n_frames, 3, 3]
  const { lattice } = arrays
  const shared_cell = lattice?.shape.length === 2
  const cells =
    lattice &&
    finite_values(
      checked_array(lattice, `lattice`, shared_cell ? [3, 3] : [n_frames, 3, 3], `float`),
      `lattice`,
    )
  const cell_of = (frame_idx: number): Matrix3x3 | undefined =>
    cells && matrix_at(cells, shared_cell ? 0 : frame_idx * 9)
  const raw_pbc = fields.pbc
  if (raw_pbc !== undefined && !cells)
    throw new TypeError(`Binary trajectory pbc needs a lattice`)
  // each flag checked (a hole in [true, , true] fails) and copied off the caller's array
  const [flag_a, flag_b, flag_c]: unknown[] =
    Array.isArray(raw_pbc) && raw_pbc.length === 3
      ? [0, 1, 2].map((axis) => raw_pbc[axis])
      : []
  const pbc: Pbc | undefined =
    typeof flag_a === `boolean` && typeof flag_b === `boolean` && typeof flag_c === `boolean`
      ? [flag_a, flag_b, flag_c]
      : undefined
  if (raw_pbc !== undefined && !pbc)
    throw new TypeError(
      `Binary trajectory pbc must be 3 booleans, got ${JSON.stringify(raw_pbc)}`,
    )

  const step_values =
    arrays.steps && finite_values(checked_array(arrays.steps, `steps`, [n_frames]), `steps`)
  const step_of = (frame_idx: number): number => step_values?.[frame_idx] ?? frame_idx

  // Every other array is a per-atom vec3 channel [n_frames, n_atoms, 3] (force, velocity)
  // or a per-frame scalar [n_frames] (energy, temperature)
  const vectors: [string, BinaryArray[`values`]][] = []
  const scalars: [string, BinaryArray[`values`]][] = []
  for (const [name, array] of Object.entries(arrays)) {
    if (RESERVED.has(name)) continue
    if (array.shape.length === 1)
      scalars.push([name, checked_array(array, name, [n_frames]).values])
    else {
      const checked = checked_array(array, name, [n_frames, n_atoms, 3], `float`)
      vectors.push([name, finite_values(checked, name)])
    }
  }
  const vector_keys = vectors.map(([name]) => name)

  if (fields.metadata !== undefined && !is_plain_object(fields.metadata))
    throw new TypeError(`Binary trajectory metadata must be an object`)
  const { time_step } = fields
  if (
    time_step !== undefined &&
    !(
      is_plain_object(time_step) &&
      Object.keys(time_step).toSorted().join(`,`) === `unit,value` &&
      typeof time_step.value === `number` &&
      Number.isFinite(time_step.value) &&
      time_step.value > 0 &&
      TIME_UNITS.some((unit) => unit === time_step.unit)
    )
  )
    throw new TypeError(
      `Binary trajectory time_step must be { value: finite > 0, unit: ${TIME_UNITS.join(` | `)} }, got ${JSON.stringify(time_step)}`,
    )

  const frame_size = n_atoms * 3
  const read = (frame_idx: number) => {
    const offset = frame_idx * frame_size
    const frame = create_numeric_md_frame(
      positions.subarray(offset, offset + frame_size),
      numbers,
      cell_of(frame_idx),
      pbc,
      step_of(frame_idx),
      Object.fromEntries(scalars.map(([name, values]) => [name, values[frame_idx]])),
      vector_keys,
    )
    for (const [column, [, values]] of vectors.entries())
      write_frame_vector(frame, column, values.subarray(offset, offset + frame_size))
    return frame
  }

  // Plot rows by full_data_extractor's precedence, without materialising sites: the real
  // step wins over a scalar named Step, a supplied finite density over the computed one
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
      const value = values[frame_idx]
      if (Number.isFinite(value) && name !== `Step` && !BOOKKEEPING_METADATA_KEYS.has(name))
        row[name] = value
    }
    const cell = cell_of(frame_idx)
    if (cell) {
      if (!shared_cell || !lattice_params) lattice_params = make_lattice(cell, pbc)
      row.volume = lattice_params.volume
      for (const param of LATTICE_PARAMS) row[param] = lattice_params[param]
      row.density ??= (AMU_PER_A3_TO_G_PER_CM3 * total_mass) / lattice_params.volume
    }
    return { frame_number: frame_idx, step, properties: row }
  })

  return numeric_run(n_frames, read, {
    provenance: {
      format: `binary`,
      // every decoded buffer, as a file's size would count it
      source_bytes: Object.values(arrays).reduce(
        (sum, { values }) => sum + values.byteLength,
        0,
      ),
      ...provenance,
    },
    // copies: unlike the numeric buffers, the host may reuse these JSON objects
    metadata: { ...fields.metadata },
    time_step: time_step && { ...(time_step as NonNullable<TrajectoryRun[`time_step`]>) },
    properties,
  })
}
