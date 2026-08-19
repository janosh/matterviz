import { ATOMIC_NUMBER_TO_SYMBOL } from '$lib/composition/parse'
import { is_elem_symbol } from '$lib/element/helpers'
import type { ElementSymbol } from '$lib/element/types'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { AnyStructure } from '$lib/structure/index'
import type { Pbc } from '$lib/structure/pbc'
import { make_site } from '$lib/structure/site'
import type {
  FrameLoader,
  ParseProgress,
  PositionStreamOptions,
  TrajectoryFrame,
  TrajectoryFrameStore,
  TrajectoryPositionStream,
  TrajectorySignal,
} from './index'

const is_valid_vec3 = (coords: unknown): coords is Vec3 =>
  Array.isArray(coords) && math.is_finite_vec3_like(coords)

export const is_supported_trajectory_signal_shape = (
  sample_shape: number[],
  n_atoms: number,
): boolean =>
  sample_shape.length === 0 ||
  (sample_shape.length === 1 && (sample_shape[0] === 3 || sample_shape[0] === n_atoms)) ||
  (sample_shape.length === 2 &&
    ((sample_shape[0] === 3 && sample_shape[1] === 3) ||
      (sample_shape[0] === n_atoms && sample_shape[1] === 3)))

export function validate_3x3_matrix(data: unknown): math.Matrix3x3 {
  if (!Array.isArray(data) || data.length !== 3) {
    throw new Error(
      `Expected 3x3 matrix, got array of length ${Array.isArray(data) ? data.length : `non-array`}`,
    )
  }

  if (
    !data.every(
      (row) =>
        (Array.isArray(row) || (ArrayBuffer.isView(row) && `length` in row)) &&
        math.is_finite_vec3_like(row as ArrayLike<unknown>),
    )
  ) {
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

export const count_elements = (elements: readonly string[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const element of elements) counts[element] = (counts[element] || 0) + 1
  return counts
}

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

const packed_frame_indices = (n_frames: number, frame_stride = 1): number[] => {
  if (!Number.isInteger(frame_stride) || frame_stride < 1) {
    throw new Error(
      `Packed trajectory frame_stride must be a positive integer, got ${frame_stride}`,
    )
  }
  return Array.from(
    { length: Math.ceil(n_frames / frame_stride) },
    (_unused, sample_idx) => sample_idx * frame_stride,
  )
}

const copy_packed_samples = (
  source: Float64Array,
  frame_indices: number[],
  values_per_frame: number,
): Float64Array => {
  const output = new Float64Array(frame_indices.length * values_per_frame)
  for (const [sample_idx, frame_idx] of frame_indices.entries()) {
    const source_offset = frame_idx * values_per_frame
    output.set(
      source.subarray(source_offset, source_offset + values_per_frame),
      sample_idx * values_per_frame,
    )
  }
  return output
}

const required_packed_channel = <Value>(
  channels: Record<string, Value> | undefined,
  key: string,
  kind: string,
): Value => {
  const channel = channels?.[key]
  if (!channel) throw new Error(`Packed trajectory has no ${kind} channel ${key}`)
  return channel
}

const copy_packed_channels = (
  channels: Record<string, Float64Array> | undefined,
  keys: string[],
  kind: `scalar` | `vector`,
  frame_indices: number[],
  values_per_frame: number,
): Record<string, Float64Array> =>
  Object.fromEntries(
    keys.map((key) => [
      key,
      copy_packed_samples(
        required_packed_channel(channels, key, kind),
        frame_indices,
        values_per_frame,
      ),
    ]),
  )

const validate_packed_channels = (
  channels: Record<string, Float64Array> | undefined,
  expected_length: number,
  kind: `scalar` | `vector`,
): void => {
  for (const [key, values] of Object.entries(channels ?? {})) {
    if (values.length !== expected_length) {
      throw new Error(
        `Packed trajectory ${kind} ${key} has ${values.length} values, expected ${expected_length}`,
      )
    }
  }
}

const copy_packed_signal = (signal: TrajectorySignal): TrajectorySignal => ({
  ...signal,
  values: signal.values.slice(),
  steps: [...signal.steps],
})

export const create_packed_frame_loader = (store: TrajectoryFrameStore): FrameLoader => {
  const n_frames = store.steps.length
  const n_atoms = store.elements.length
  const position_values_per_frame = n_atoms * 3
  if (n_frames < 1 || n_atoms < 1) {
    throw new Error(`Packed trajectory requires at least one frame and atom`)
  }
  if (store.positions.length !== n_frames * position_values_per_frame) {
    throw new Error(
      `Packed trajectory positions length ${store.positions.length} does not match ` +
        `${n_frames} frames x ${n_atoms} atoms x 3`,
    )
  }
  if (store.lattice_matrix && store.lattice_matrices) {
    throw new Error(`Packed trajectory cannot define both static and per-frame lattices`)
  }
  if (store.lattice_matrices && store.lattice_matrices.length !== n_frames * 9) {
    throw new Error(
      `Packed trajectory lattices have ${store.lattice_matrices.length} values, expected ${n_frames * 9}`,
    )
  }
  if (store.pbc_frames && store.pbc_frames.length !== n_frames) {
    throw new Error(
      `Packed trajectory PBC has ${store.pbc_frames.length} frames, expected ${n_frames}`,
    )
  }
  if (store.metadata.length !== n_frames || store.plot_metadata.length !== n_frames) {
    throw new Error(
      `Packed trajectory metadata lengths must match ${n_frames} frames, got ` +
        `${store.metadata.length} and ${store.plot_metadata.length}`,
    )
  }
  validate_packed_channels(store.scalars, n_frames * n_atoms, `scalar`)
  validate_packed_channels(store.vectors, n_frames * position_values_per_frame, `vector`)
  for (const [key, signal] of Object.entries(store.signals ?? {})) {
    if (!signal.sample_shape.every((size) => Number.isInteger(size) && size > 0)) {
      throw new Error(`Packed trajectory signal ${key} has an invalid sample shape`)
    }
    const values_per_sample = signal.sample_shape.reduce((product, size) => product * size, 1)
    if (signal.values.length !== signal.steps.length * values_per_sample) {
      throw new Error(
        `Packed trajectory signal ${key} has ${signal.values.length} values for ` +
          `${signal.steps.length} steps of shape [${signal.sample_shape.join(`, `)}]`,
      )
    }
  }

  const lattice_for_frame = (frame_number: number): math.Matrix3x3 | undefined => {
    if (!store.lattice_matrices) return store.lattice_matrix
    const offset = frame_number * 9
    return [
      Array.from(store.lattice_matrices.subarray(offset, offset + 3)),
      Array.from(store.lattice_matrices.subarray(offset + 3, offset + 6)),
      Array.from(store.lattice_matrices.subarray(offset + 6, offset + 9)),
    ] as math.Matrix3x3
  }
  const pbc_for_frame = (frame_number: number): Pbc | undefined =>
    store.pbc_frames?.[frame_number] ?? store.pbc

  const load_frame_sync = (frame_number: number): TrajectoryFrame | null => {
    if (!Number.isInteger(frame_number) || frame_number < 0 || frame_number >= n_frames) {
      return null
    }
    const source_offset = frame_number * position_values_per_frame
    const positions = Array.from({ length: n_atoms }, (_unused, atom_idx) => {
      const atom_offset = source_offset + atom_idx * 3
      return [
        store.positions[atom_offset],
        store.positions[atom_offset + 1],
        store.positions[atom_offset + 2],
      ]
    })
    const frame = create_trajectory_frame(
      positions,
      store.elements,
      lattice_for_frame(frame_number),
      pbc_for_frame(frame_number),
      store.steps[frame_number],
      store.metadata[frame_number],
    )
    for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
      const properties = frame.structure.sites[atom_idx].properties
      for (const [key, values] of Object.entries(store.scalars ?? {})) {
        properties[key] = values[frame_number * n_atoms + atom_idx]
      }
      for (const [key, values] of Object.entries(store.vectors ?? {})) {
        const offset = (frame_number * n_atoms + atom_idx) * 3
        properties[key] = [values[offset], values[offset + 1], values[offset + 2]]
      }
    }
    return frame
  }

  return {
    requires_source: false,
    get_total_frames: async () => n_frames,
    build_frame_index: async (_raw_data, sample_rate, on_progress) => {
      const frame_indices = packed_frame_indices(n_frames, sample_rate)
      on_progress?.({ current: 100, total: 100, stage: `Indexed packed trajectory frames` })
      return frame_indices.map((frame_number) => ({
        frame_number,
        byte_offset: frame_number * position_values_per_frame * Float64Array.BYTES_PER_ELEMENT,
        estimated_size: position_values_per_frame * Float64Array.BYTES_PER_ELEMENT,
      }))
    },
    load_frame: async (_raw_data, frame_number) => load_frame_sync(frame_number),
    load_frame_sync,
    extract_plot_metadata: async (_raw_data, options, on_progress) => {
      const frame_indices = packed_frame_indices(n_frames, options?.sample_rate)
      on_progress?.({ current: 100, total: 100, stage: `Read packed trajectory metadata` })
      return frame_indices.map((frame_idx) => store.plot_metadata[frame_idx])
    },
    stream_positions: async (
      _raw_data: string | ArrayBuffer,
      options: PositionStreamOptions = {},
      on_progress?: (progress: ParseProgress) => void,
    ): Promise<TrajectoryPositionStream> => {
      const frame_indices = packed_frame_indices(n_frames, options.frame_stride)
      const scalar_keys = [...new Set(options.scalar_keys)]
      const vector_keys = [...new Set(options.vector_keys)]
      const signal_keys = [...new Set(options.signal_keys)]
      const missing_channels = [
        ...scalar_keys.filter((key) => !store.scalars?.[key]),
        ...vector_keys.filter((key) => !store.vectors?.[key]),
        ...signal_keys.filter((key) => !store.signals?.[key]),
      ]
      if (missing_channels.length > 0) {
        throw new Error(
          `Packed trajectory has no channels named ${missing_channels.join(`, `)}`,
        )
      }
      const stream_pbc = store.pbc_frames
        ? store.pbc_frames.every((pbc) =>
            pbc.every((value, axis) => value === store.pbc_frames?.[0]?.[axis]),
          )
          ? store.pbc_frames[0]
          : null
        : (store.pbc ?? null)
      if (store.pbc_frames && !stream_pbc) {
        throw new Error(
          `Packed trajectory analysis does not support PBC flags that vary between frames`,
        )
      }
      const values_per_frame =
        position_values_per_frame +
        scalar_keys.length * n_atoms +
        vector_keys.length * position_values_per_frame
      const signal_value_count = signal_keys.reduce((total, key) => {
        const signal = required_packed_channel(store.signals, key, `signal`)
        return total + signal.values.length + signal.steps.length
      }, 0)
      const needed_bytes =
        (frame_indices.length * values_per_frame + signal_value_count) *
        Float64Array.BYTES_PER_ELEMENT
      const max_bytes = options.max_bytes ?? Number.POSITIVE_INFINITY
      if (!(max_bytes > 0)) {
        throw new Error(`Packed trajectory max_bytes must be positive, got ${max_bytes}`)
      }
      const signal_bytes = signal_value_count * Float64Array.BYTES_PER_ELEMENT
      if (signal_bytes > max_bytes) {
        throw new Error(
          `Packed trajectory native-cadence signals need ${signal_bytes} bytes, over the ${max_bytes} byte budget.`,
        )
      }
      if (needed_bytes > max_bytes) {
        const frame_bytes = values_per_frame * Float64Array.BYTES_PER_ELEMENT
        const affordable_frames = Math.floor((max_bytes - signal_bytes) / frame_bytes)
        if (affordable_frames < 1) {
          throw new Error(
            `A packed trajectory frame needs ${frame_bytes} bytes, over the ${max_bytes} byte budget.`,
          )
        }
        const minimum_stride = Math.ceil(n_frames / affordable_frames)
        throw new Error(
          `Collecting ${frame_indices.length} packed trajectory frames needs ${needed_bytes} ` +
            `bytes, over the ${max_bytes} byte budget. Use frame_stride >= ${minimum_stride}.`,
        )
      }
      const scalars = copy_packed_channels(
        store.scalars,
        scalar_keys,
        `scalar`,
        frame_indices,
        n_atoms,
      )
      const vectors = copy_packed_channels(
        store.vectors,
        vector_keys,
        `vector`,
        frame_indices,
        position_values_per_frame,
      )
      const signals = Object.fromEntries(
        signal_keys.map((key) => [
          key,
          copy_packed_signal(required_packed_channel(store.signals, key, `signal`)),
        ]),
      )
      on_progress?.({ current: 100, total: 100, stage: `Collected packed trajectory data` })
      return {
        positions: copy_packed_samples(
          store.positions,
          frame_indices,
          position_values_per_frame,
        ),
        n_frames: frame_indices.length,
        n_atoms,
        elements: [...store.elements],
        lattice_matrices:
          store.lattice_matrix || store.lattice_matrices
            ? frame_indices.map((frame_idx) => lattice_for_frame(frame_idx) ?? null)
            : null,
        pbc: stream_pbc,
        coords_unwrapped: store.coords_unwrapped,
        frame_stride: options.frame_stride ?? 1,
        steps: frame_indices.map((frame_idx) => store.steps[frame_idx]),
        ...(scalar_keys.length > 0 ? { scalars } : {}),
        ...(vector_keys.length > 0 ? { vectors } : {}),
        ...(signal_keys.length > 0 ? { signals } : {}),
      }
    },
  }
}

export const load_packed_frame_preview = (
  frame_loader: FrameLoader,
  total_frames: number,
  max_frames: number,
  label: string,
): TrajectoryFrame[] => {
  const load_frame_sync = frame_loader.load_frame_sync
  if (!load_frame_sync) throw new Error(`${label} loader must support synchronous frames`)
  return Array.from({ length: Math.min(total_frames, max_frames) }, (_unused, frame_idx) => {
    const frame = load_frame_sync(frame_idx)
    if (!frame) throw new Error(`${label} loader could not reconstruct frame ${frame_idx}`)
    return frame
  })
}

export const trajectory_data_transferables = (
  data: TrajectoryFrameStore | TrajectoryPositionStream,
): ArrayBuffer[] => {
  const buffers = new Set<ArrayBuffer>()
  const add = (values: Float64Array) => buffers.add(values.buffer as ArrayBuffer)
  add(data.positions)
  if (data.lattice_matrices instanceof Float64Array) add(data.lattice_matrices)
  for (const values of Object.values(data.scalars ?? {})) add(values)
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
  const total = shape.reduce((product, dim_size) => product * dim_size, 1)

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

export function derive_time_step(
  times: readonly (number | null)[],
  steps: readonly number[],
): number | undefined {
  if (times.length !== steps.length || times.length < 2) return undefined
  const finite_times = times.filter(
    (time): time is number => time !== null && Number.isFinite(time),
  )
  if (finite_times.length !== times.length) return undefined
  const step_span = steps[1] - steps[0]
  const time_span = finite_times[1] - finite_times[0]
  if (!(step_span > 0) || !(time_span > 0)) return undefined
  const time_step = time_span / step_span
  const uniform = steps.every((step, idx) => {
    if (idx === 0) return true
    const expected = time_step * (step - steps[idx - 1])
    const elapsed_time = finite_times[idx] - finite_times[idx - 1]
    return Math.abs(elapsed_time - expected) <= 1e-6 * Math.abs(expected)
  })
  return uniform ? time_step : undefined
}

export const is_xyz_atom_line = (parts: string[] | undefined): boolean =>
  parts !== undefined &&
  parts.length >= 4 &&
  isNaN(Number(parts[0])) &&
  parts[0].length <= 3 &&
  parts.slice(1, 4).every((coord) => coord !== `` && !isNaN(Number(coord)))

export function* iter_xyz_frames(
  lines: string[],
): Generator<{ start: number; num_atoms: number; comment: string }> {
  let line_idx = 0
  while (line_idx < lines.length) {
    const num_atoms = Math.trunc(Number(lines[line_idx]?.trim()))
    if (isNaN(num_atoms) || num_atoms <= 0 || line_idx + num_atoms + 2 > lines.length) {
      line_idx++
      continue
    }
    let valid_coords = 0
    const sample = Math.min(num_atoms, 3)
    for (let idx = 0; idx < sample; idx++) {
      if (is_xyz_atom_line(lines[line_idx + 2 + idx]?.trim().split(/\s+/))) valid_coords++
    }
    if (valid_coords < sample) {
      line_idx++
      continue
    }
    yield { start: line_idx, num_atoms, comment: lines[line_idx + 1] || `` }
    line_idx += num_atoms + 2
  }
}

export function count_xyz_frames(data: string): number {
  if (!data) return 0
  const frames = iter_xyz_frames(data.trim().split(/\r?\n/))
  let frame_count = 0
  while (!frames.next().done) frame_count += 1
  return frame_count
}
