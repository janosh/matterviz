import { transpose_3x3_matrix, type Matrix3x3 } from '$lib/math'
import { matrix3x3_from_rows } from '$lib/structure/parsers/shared'
import type {
  PositionStreamOptions,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectorySignal,
  TrajectorySignalDescriptor,
} from '$lib/trajectory/index'
import type { Dataset, Entity, Group } from 'h5wasm'
import type * as h5wasm from 'h5wasm'
import { DEFAULT_POSITION_STREAM_MAX_BYTES, resolve_frame_range } from '../runs/accumulate'

export const is_hdf5_dataset = (entity: Entity | null): entity is Dataset =>
  entity !== null && `to_array` in entity

export const is_hdf5_group = (entity: Entity | null): entity is Group =>
  entity !== null && `keys` in entity

// The file holds several trajectories and the caller gave no `hdf5_group_path`; the file
// viewer maps this to its group picker.
export class Hdf5GroupSelectionRequiredError extends Error {
  constructor(
    readonly groups: string[],
    message = `Ambiguous HDF5 trajectory: positions and atomic numbers occur together in ${groups.join(`, `)}`,
  ) {
    super(message)
    this.name = 'Hdf5GroupSelectionRequiredError'
  }
}

export const attribute_value = (entity: Dataset | Group, names: string[]): unknown => {
  const attrs = entity.attrs // a getter that re-lists every attribute over WASM per access
  for (const name of names) {
    const attribute = attrs[name]
    if (attribute) return attribute.to_array()
  }
  return undefined
}

export const string_value = (value: unknown): string | undefined => {
  if (typeof value === `string`) return value.trim() || undefined
  if (value instanceof Uint8Array) return new TextDecoder().decode(value).trim() || undefined
  if (Array.isArray(value) && value.length === 1) return string_value(value[0])
  return undefined
}

// The dataset at `path`, or null when the entity is missing or is a group
export const dataset_at = (h5_file: h5wasm.File, path: string | undefined): Dataset | null => {
  if (!path) return null
  const entity = h5_file.get(path)
  return is_hdf5_dataset(entity) ? entity : null
}

// A dataset's shape, rejecting scalars and degenerate axes: every dataset the trajectory
// parsers read is indexed along at least one axis of positive length
export const dataset_shape = (dataset: Dataset, path: string, format: string): number[] => {
  const shape = dataset.shape ?? []
  if (shape.length === 0 || shape.some((size) => !Number.isInteger(size) || size < 1)) {
    throw new Error(`${format} dataset ${path} has invalid shape [${shape.join(`, `)}]`)
  }
  return shape
}

// Exactly `count` numbers along a single axis (step axes, per-replica ids)
export const read_numeric_1d = (
  dataset: Dataset,
  path: string,
  count: number,
  format: string,
): number[] => {
  const shape = dataset_shape(dataset, path, format)
  if (shape.length !== 1 || shape[0] !== count) {
    throw new Error(
      `${format} dataset ${path} has shape [${shape.join(`, `)}], expected [${count}]`,
    )
  }
  return Array.from(read_numeric_samples(dataset, path, count, 1))
}

// HDF5 writes the cell with lattice vectors down the columns (`values[row * 3 + col]` is
// component `row` of vector `col`); the structure convention keeps them as rows, hence transpose
export const lattice_from_values = (values: ArrayLike<number>, offset = 0): Matrix3x3 =>
  transpose_3x3_matrix(
    matrix3x3_from_rows(
      Array.from({ length: 3 }, (_unused, row_idx) =>
        Array.from(
          { length: 3 },
          (_unused_2, column_idx) => values[offset + row_idx * 3 + column_idx],
        ),
      ),
      `lattice matrix`,
    ),
  )

// Write a per-atom vec3 channel (velocities) onto the sites of a freshly built frame
export const attach_site_vectors = (
  frame: TrajectoryFrame,
  key: string,
  values: ArrayLike<number>,
): void => {
  for (const [atom_idx, site] of frame.structure.sites.entries()) {
    const off = atom_idx * 3
    site.properties[key] = [values[off], values[off + 1], values[off + 2]]
  }
}

// Plot rows for at most ~1000 evenly spaced frames: the plot is sampled, never the run.
// `read_properties` receives the sampled frame indices and the stride to read them with.
export const sampled_property_rows = (
  n_frames: number,
  step_of: (frame_idx: number) => number,
  read_properties: (frame_indices: number[], stride: number) => Record<string, number>[],
): TrajectoryMetadata[] => {
  const stride = Math.max(1, Math.ceil(n_frames / 1000))
  const frame_indices = sampled_indices(n_frames, stride)
  const properties = read_properties(frame_indices, stride)
  return frame_indices.map((frame_number, sample_idx) => ({
    frame_number,
    step: step_of(frame_number),
    properties: properties[sample_idx],
  }))
}

// Bounds ONE hyperslab: the streaming readers slice a run frame-by-frame, so this only has to
// hold a single `slice()` call in a Float64Array scratch buffer.
export const HDF5_MAX_LOGICAL_SLICE_BYTES = 8 * 1024 * 1024

// Bounds a WHOLE-dataset `to_array()`, which has no frame axis to slice along, so the
// frame-sized hyperslab budget rejected an ordinary 200-atom / 2000-step vaspout.h5. h5wasm
// returns nested JS arrays at ~4x the logical size, so this caps the heap at ~512 MB.
export const HDF5_MAX_WHOLE_DATASET_BYTES = 128 * 1024 * 1024

const assert_budget = (path: string, n_values: number, action: string, max_bytes: number) => {
  const logical_bytes = n_values * Float64Array.BYTES_PER_ELEMENT
  if (logical_bytes > max_bytes) {
    throw new Error(
      `HDF5 dataset ${path} ${action} ${logical_bytes} logical bytes, above the ` +
        `${max_bytes}-byte application limit`,
    )
  }
}

// Nested JS arrays, null for a missing path. No try/catch: it reported real failures (float16,
// missing filter, oversized alloc) as "no data". `format` applies the whole-dataset budget.
export const read_dataset = (h5_file: h5wasm.File, path: string, format?: string): unknown => {
  const dataset = dataset_at(h5_file, path)
  if (!dataset) return null
  if (format !== undefined) {
    const shape = dataset_shape(dataset, path, format)
    const values = shape.reduce((product, size) => product * size, 1)
    assert_budget(path, values, `requests`, HDF5_MAX_WHOLE_DATASET_BYTES)
  }
  return dataset.to_array()
}

const requested_hyperslab_values = (
  dataset: Dataset,
  path: string,
  ranges: Parameters<Dataset[`slice`]>[0],
): number => {
  const shape = dataset.shape ?? []
  if (shape.length === 0) throw new Error(`HDF5 dataset ${path} has no sliceable dimensions`)
  return shape.reduce((value_count, dimension_size, dimension_idx) => {
    const range = ranges[dimension_idx] ?? []
    if (range.length === 0) return value_count * dimension_size
    const [start, end] = range
    const stride = range[2] ?? 1
    if (
      typeof start !== `number` ||
      typeof end !== `number` ||
      typeof stride !== `number` ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      !Number.isInteger(stride) ||
      start < 0 ||
      end < start ||
      end > dimension_size ||
      stride < 1
    ) {
      throw new Error(
        `Invalid HDF5 hyperslab range [${range.join(`, `)}] for ${path} dimension ${dimension_idx} of size ${dimension_size}`,
      )
    }
    return value_count * Math.ceil((end - start) / stride)
  }, 1)
}

const numeric_values = (data: unknown): ArrayLike<unknown> | null =>
  Array.isArray(data)
    ? data
    : ArrayBuffer.isView(data)
      ? (data as unknown as ArrayLike<unknown>)
      : null

// bigint counts only while it round-trips exactly (a 2^60 step index fails, not silently shifts)
export const to_finite_number = (value: unknown): number | null => {
  const number = typeof value === `bigint` ? Number(value) : value
  const valid_bigint =
    typeof value !== `bigint` || (typeof number === `number` && Number.isSafeInteger(number))
  return typeof number === `number` && Number.isFinite(number) && valid_bigint ? number : null
}

const not_numeric = (path: string): never => {
  throw new Error(`HDF5 dataset ${path} hyperslab must contain finite numbers`)
}

const finite_or_throw = (value: unknown, path: string): number =>
  to_finite_number(value) ?? not_numeric(path)

const validated_numeric_hyperslab = (
  dataset: Dataset,
  path: string,
  ranges: Parameters<Dataset[`slice`]>[0],
): ArrayLike<unknown> => {
  const requested = requested_hyperslab_values(dataset, path, ranges)
  assert_budget(path, requested, `hyperslab requests`, HDF5_MAX_LOGICAL_SLICE_BYTES)
  const values = numeric_values(dataset.slice(ranges))
  if (!values) return not_numeric(path)
  // h5wasm returns raw bytes for a dtype it cannot decode: an undecoded 2-byte `masses` of
  // shape [n_atoms] yields 2*n_atoms plausible byte values that pass every value check
  if (values.length !== requested) {
    throw new Error(
      `HDF5 dataset ${path} hyperslab returned ${values.length} values, expected ${requested}`,
    )
  }
  return values
}

export const read_numeric_hyperslab = (
  dataset: Dataset,
  path: string,
  ranges: Parameters<Dataset[`slice`]>[0],
): number[] =>
  Array.from(validated_numeric_hyperslab(dataset, path, ranges), (value) =>
    finite_or_throw(value, path),
  )

const copy_numeric_hyperslab = (
  dataset: Dataset,
  path: string,
  ranges: Parameters<Dataset[`slice`]>[0],
  destination: Float64Array,
  destination_offset: number,
): number => {
  const values = validated_numeric_hyperslab(dataset, path, ranges)
  if (destination_offset + values.length > destination.length) {
    throw new Error(
      `HDF5 dataset ${path} returned ${values.length} values beyond its ` +
        `${destination.length}-value destination`,
    )
  }
  for (let value_idx = 0; value_idx < values.length; value_idx++) {
    destination[destination_offset + value_idx] = finite_or_throw(values[value_idx], path)
  }
  return values.length
}

export const hdf5_frames_per_slice = (...values_per_frame: number[]): number => {
  if (
    values_per_frame.length === 0 ||
    values_per_frame.some((value_count) => !Number.isInteger(value_count) || value_count < 1)
  ) {
    throw new Error(
      `HDF5 values_per_frame must contain positive integers, got ${values_per_frame.join(`, `)}`,
    )
  }
  const logical_frame_bytes = Math.max(...values_per_frame) * Float64Array.BYTES_PER_ELEMENT
  if (logical_frame_bytes > HDF5_MAX_LOGICAL_SLICE_BYTES) {
    throw new Error(
      `One HDF5 sample contains ${logical_frame_bytes} logical bytes, above the ` +
        `${HDF5_MAX_LOGICAL_SLICE_BYTES}-byte application slice limit`,
    )
  }
  return Math.floor(HDF5_MAX_LOGICAL_SLICE_BYTES / logical_frame_bytes)
}

export const to_string_array = (data: unknown): string[] | null => {
  if (!Array.isArray(data)) return null
  const decoder = new TextDecoder()
  const strings: string[] = []
  for (const item of data) {
    if (typeof item === `string`) strings.push(item.trim())
    else if (item instanceof Uint8Array) strings.push(decoder.decode(item).trim())
    else return null
  }
  return strings
}

// `deep` flattens nesting and accepts a bare scalar: an HDF5 attribute comes back as any of
// `[[1, 0, 0]]`, `[1, 0, 0]` or `1` depending on how it was written
export const to_number_array = (data: unknown, deep = false): number[] | null => {
  const values = numeric_values(data)
  if (!values) {
    const scalar = deep ? to_finite_number(data) : null
    return scalar === null ? null : [scalar]
  }
  const numbers = Array.from(values, to_finite_number)
  if (numbers.every((item): item is number => item !== null)) return numbers
  if (!deep) return null
  const flattened: number[] = []
  for (const [idx, number] of numbers.entries()) {
    // what to_finite_number rejected may be a nested array
    const child = number === null ? to_number_array(values[idx], deep) : [number]
    if (!child) return null
    flattened.push(...child)
  }
  return flattened
}

// Final-structure datasets may carry a leading singleton step axis ([1, 3, 3] lattices,
// [1, n_atoms, 3] positions) depending on the VASP version that wrote them.
export const squeeze_leading_axis = (data: unknown): unknown => {
  if (!Array.isArray(data) || data.length !== 1) return data
  const first: unknown = data[0]
  return Array.isArray(first) && Array.isArray(first[0]) ? first : data
}

// Squeeze the optional leading step axis, then apply the POSCAR universal scale. The bands path
// skipping the squeeze made a file that opens fine as a trajectory read as identity.
export const read_scaled_lattice = (
  h5_file: h5wasm.File,
  lattice_path: string,
  scale_path: string,
): Matrix3x3 | null => {
  const lattice_data = squeeze_leading_axis(read_dataset(h5_file, lattice_path))
  if (!lattice_data) return null
  const scale = to_scalar_number(read_dataset(h5_file, scale_path)) ?? 1
  return scale_matrix(matrix3x3_from_rows(lattice_data, `lattice matrix`), scale)
}

export const to_scalar_number = (data: unknown): number | null => {
  if (Array.isArray(data) && data.length !== 1) return null
  return to_finite_number(Array.isArray(data) ? data[0] : data)
}

const unique_strings = (values: string[] | undefined): string[] => [...new Set(values)]

const positive_integer_stride = (value: number | undefined, label: string): number => {
  const stride = value ?? 1
  if (!Number.isFinite(stride) || !Number.isInteger(stride) || stride < 1) {
    throw new Error(`${label} must be a positive integer, got ${stride}`)
  }
  return stride
}

const sampled_indices = (item_count: number, stride: number): number[] =>
  Array.from({ length: Math.ceil(item_count / stride) }, (_unused, idx) => idx * stride)

export const trajectory_signal = (
  values: Float64Array,
  { sample_shape, unit }: { sample_shape: number[]; unit?: string },
  steps: number[],
): TrajectorySignal => ({ values, sample_shape, steps, ...(unit ? { unit } : {}) })

// `frame_aligned_of` says whether the signal's step axis is the geometry's (see
// `TrajectorySignalDescriptor.frame_aligned`); the parser knows both axes, consumers don't
export const signal_descriptors = <Manifest extends { sample_shape: number[]; unit?: string }>(
  manifest: Record<string, Manifest>,
  sample_count_of: (signal: Manifest) => number,
  frame_aligned_of: (signal: Manifest) => boolean,
): Record<string, TrajectorySignalDescriptor> =>
  Object.fromEntries(
    Object.entries(manifest).map(([key, signal]) => [
      key,
      {
        sample_shape: signal.sample_shape,
        sample_count: sample_count_of(signal),
        frame_aligned: frame_aligned_of(signal),
        ...(signal.unit ? { unit: signal.unit } : {}),
      },
    ]),
  )

// The option handling every HDF5 `collect_positions` shares: stride, channel selection and
// the memory budget. `is_vector` / `is_signal` say which keys the file can stream (and may
// throw their own shape errors); `values_per_frame(n_vectors)` sizes one selected frame and
// `signal_values(key)` a whole native-cadence signal.
export const resolve_stream_channels = (
  format: string,
  options: PositionStreamOptions,
  n_frames: number,
  channels: {
    is_vector: (key: string) => boolean
    is_signal: (key: string) => boolean
    values_per_frame: (n_vectors: number) => number
    signal_values: (key: string, start_frame: number, end_frame: number) => number
  },
): {
  frame_stride: number
  vector_keys: string[]
  signal_keys: string[]
  frame_indices: number[]
} => {
  const frame_stride = positive_integer_stride(options.frame_stride, `${format} frame_stride`)
  const vector_keys = unique_strings(options.vector_keys)
  const signal_keys = unique_strings(options.signal_keys)
  const unknown_keys = [
    ...vector_keys.filter((key) => !channels.is_vector(key)),
    ...signal_keys.filter((key) => !channels.is_signal(key)),
  ]
  if (unknown_keys.length > 0) {
    throw new Error(`${format} has no channels named ${unknown_keys.join(`, `)}`)
  }
  const { start_frame, end_frame } = resolve_frame_range(n_frames, options)
  const frame_indices = sampled_indices(end_frame - start_frame, frame_stride).map(
    (idx) => idx + start_frame,
  )
  assert_hdf5_stream_budget(
    format,
    end_frame - start_frame,
    frame_indices.length,
    channels.values_per_frame(vector_keys.length),
    signal_keys.reduce(
      (total, key) => total + channels.signal_values(key, start_frame, end_frame),
      0,
    ),
    options.max_bytes ?? DEFAULT_POSITION_STREAM_MAX_BYTES,
  )
  return { frame_stride, vector_keys, signal_keys, frame_indices }
}

export const read_numeric_samples = (
  dataset: Dataset,
  path: string,
  sample_count: number,
  sample_size: number,
  stride = 1,
  ranges_for_samples: (
    start: number,
    end: number,
    stride: number,
  ) => Parameters<Dataset[`slice`]>[0] = (start, end, sample_stride) => [
    [start, end, sample_stride],
  ],
  sample_start = 0,
  sample_end = sample_count,
): Float64Array => {
  const values = new Float64Array(
    Math.ceil((sample_end - sample_start) / stride) * sample_size,
  )
  const samples_per_slice = hdf5_frames_per_slice(sample_size)
  let output_offset = 0
  for (let start = sample_start; start < sample_end; start += samples_per_slice * stride) {
    const end = Math.min(start + samples_per_slice * stride, sample_end)
    const expected_count = Math.ceil((end - start) / stride) * sample_size
    const copied_count = copy_numeric_hyperslab(
      dataset,
      path,
      ranges_for_samples(start, end, stride),
      values,
      output_offset,
    )
    if (copied_count !== expected_count) {
      throw new Error(
        `HDF5 dataset ${path} returned ${copied_count} values for ${expected_count} requested entries`,
      )
    }
    output_offset += copied_count
  }
  return values
}

const assert_hdf5_stream_budget = (
  format: string,
  total_frames: number,
  selected_frames: number,
  values_per_selected_frame: number,
  fixed_values: number,
  max_bytes: number,
): void => {
  if (!(max_bytes > 0)) throw new Error(`${format} max_bytes must be positive`)
  const bytes_per_value = Float64Array.BYTES_PER_ELEMENT
  const fixed_bytes = fixed_values * bytes_per_value
  const bytes_per_selected_frame = values_per_selected_frame * bytes_per_value
  const needed_bytes = fixed_bytes + selected_frames * bytes_per_selected_frame
  if (needed_bytes <= max_bytes) return
  const affordable_frames = Math.floor((max_bytes - fixed_bytes) / bytes_per_selected_frame)
  if (affordable_frames < 1) {
    throw new Error(
      `Requested native-cadence signals need ${fixed_bytes} bytes, leaving no room for one geometry frame under the ${max_bytes}-byte budget`,
    )
  }
  throw new Error(
    `Collecting ${format} data needs ${needed_bytes} bytes, over the ${max_bytes}-byte budget. Use frame_stride >= ${Math.ceil(total_frames / affordable_frames)}.`,
  )
}

export const scale_matrix = (matrix: Matrix3x3, scale: number): Matrix3x3 =>
  scale === 1 ? matrix : (matrix.map((row) => row.map((val) => val * scale)) as Matrix3x3)

export async function with_h5_file<T>(
  buffer: ArrayBuffer,
  filename: string | undefined,
  callback: (h5_file: h5wasm.File) => T | Promise<T>,
): Promise<T> {
  const source = await open_h5_source(buffer, filename)
  try {
    return await callback(source.h5_file)
  } finally {
    source.close()
  }
}

// Opens an in-memory (ArrayBuffer) or WORKERFS-mounted (Blob) HDF5 file. `close` is
// idempotent and always releases both the h5wasm handle and the backing FS entry.
export async function open_h5_source(
  source: ArrayBuffer | Blob,
  filename?: string,
): Promise<{ h5_file: h5wasm.File; close: () => void }> {
  const h5 = await import(`h5wasm`)
  const { FS } = await h5.ready
  const file_basename =
    filename
      ?.split(`/`)
      .at(-1)
      ?.replaceAll(/[^\w.-]/g, `_`) ?? `trajectory.h5`
  const unique_suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const path = `/matterviz-hdf5-${unique_suffix}`
  let h5_file: h5wasm.File | null = null
  let closed = false
  const best_effort = (cleanup: () => void): void => {
    try {
      cleanup()
    } catch {}
  }

  let cleanup_source = (): void => {}
  let source_path = ``
  try {
    if (source instanceof Blob) {
      const source_file = typeof File !== `undefined` && source instanceof File
      FS.mkdir(path)
      cleanup_source = () => {
        best_effort(() => FS.unmount(path))
        best_effort(() => FS.rmdir(path))
      }
      const mount_options = source_file
        ? { files: [source] }
        : { blobs: [{ name: file_basename, data: source }] }
      FS.mount(FS.filesystems.WORKERFS, mount_options, path)
      source_path = `${path}/${source_file ? source.name : file_basename}`
    } else {
      source_path = `${file_basename}-${unique_suffix}.h5`
      cleanup_source = () => best_effort(() => FS.unlink(source_path))
      FS.writeFile(source_path, new Uint8Array(source))
    }
    h5_file = new h5.File(source_path, `r`)
  } catch (error) {
    cleanup_source()
    throw error
  }
  return {
    h5_file,
    close: () => {
      if (closed) return
      closed = true
      best_effort(() => h5_file?.close())
      h5_file = null
      cleanup_source()
    },
  }
}
