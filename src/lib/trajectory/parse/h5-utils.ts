import { is_elem_symbol } from '$lib/element/helpers'
import type { ElementSymbol } from '$lib/element/types'
import { transpose_3x3_matrix, type Matrix3x3 } from '$lib/math'
import { validate_3x3_matrix } from '$lib/trajectory/helpers'
import type {
  PositionStreamOptions,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectorySignal,
  TrajectorySignalDescriptor,
} from '$lib/trajectory/index'
import type { Dataset, Entity, Group } from 'h5wasm'
import type * as h5wasm from 'h5wasm'

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
  for (const name of names) {
    const attribute = entity.attrs[name]
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

// HDF5 stores cells as row-major [3, 3] with lattice vectors along the first axis; the
// structure convention keeps them as columns, hence the transpose
export const lattice_from_values = (values: ArrayLike<number>, offset = 0): Matrix3x3 =>
  transpose_3x3_matrix(
    validate_3x3_matrix(
      Array.from({ length: 3 }, (_unused, row_idx) =>
        Array.from(
          { length: 3 },
          (_unused_2, column_idx) => values[offset + row_idx * 3 + column_idx],
        ),
      ),
    ),
  )

// Write a per-atom vec3 channel (velocities) onto a frame's sites
export const attach_site_vectors = (
  frame: TrajectoryFrame,
  key: string,
  values: ArrayLike<number>,
): void => {
  for (const [atom_idx, site] of frame.structure.sites.entries()) {
    site.properties = {
      ...site.properties,
      [key]: Array.from({ length: 3 }, (_unused, axis) => values[atom_idx * 3 + axis]),
    }
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

export const read_dataset = (h5_file: h5wasm.File, path: string): unknown => {
  try {
    const entity = h5_file.get(path)
    return is_hdf5_dataset(entity) ? entity.to_array() : null
  } catch {
    return null
  }
}

export const HDF5_MAX_LOGICAL_SLICE_BYTES = 8 * 1024 * 1024

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

const to_finite_number = (value: unknown): number | null => {
  const number = typeof value === `bigint` ? Number(value) : value
  const valid_bigint =
    typeof value !== `bigint` || (typeof number === `number` && Number.isSafeInteger(number))
  return typeof number === `number` && Number.isFinite(number) && valid_bigint ? number : null
}

const validated_numeric_hyperslab = (
  dataset: Dataset,
  path: string,
  ranges: Parameters<Dataset[`slice`]>[0],
): ArrayLike<unknown> => {
  const requested_bytes =
    requested_hyperslab_values(dataset, path, ranges) * Float64Array.BYTES_PER_ELEMENT
  if (requested_bytes > HDF5_MAX_LOGICAL_SLICE_BYTES) {
    throw new Error(
      `HDF5 dataset ${path} hyperslab requests ${requested_bytes} logical bytes, above the ` +
        `${HDF5_MAX_LOGICAL_SLICE_BYTES}-byte application limit`,
    )
  }
  const values = numeric_values(dataset.slice(ranges))
  if (!values) throw new Error(`HDF5 dataset ${path} hyperslab must contain finite numbers`)
  const logical_bytes = values.length * Float64Array.BYTES_PER_ELEMENT
  if (logical_bytes > HDF5_MAX_LOGICAL_SLICE_BYTES) {
    throw new Error(
      `HDF5 dataset ${path} hyperslab returned ${logical_bytes} logical bytes, above the ` +
        `${HDF5_MAX_LOGICAL_SLICE_BYTES}-byte application limit`,
    )
  }
  return values
}

export const read_numeric_hyperslab = (
  dataset: Dataset,
  path: string,
  ranges: Parameters<Dataset[`slice`]>[0],
): number[] => {
  const values = Array.from(validated_numeric_hyperslab(dataset, path, ranges), (value) =>
    to_finite_number(value),
  )
  if (!values.every((value): value is number => value !== null)) {
    throw new Error(`HDF5 dataset ${path} hyperslab must contain finite numbers`)
  }
  return values
}

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
    const value = to_finite_number(values[value_idx])
    if (value === null) {
      throw new Error(`HDF5 dataset ${path} hyperslab must contain finite numbers`)
    }
    destination[destination_offset + value_idx] = value
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

export const to_number_array = (data: unknown): number[] | null => {
  const values = numeric_values(data)
  if (!values) return null
  const numbers = Array.from(values, to_finite_number)
  return numbers.every((item): item is number => item !== null) ? numbers : null
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

export const signal_descriptors = <Manifest extends { sample_shape: number[]; unit?: string }>(
  manifest: Record<string, Manifest>,
  sample_count_of: (signal: Manifest) => number,
): Record<string, TrajectorySignalDescriptor> =>
  Object.fromEntries(
    Object.entries(manifest).map(([key, signal]) => [
      key,
      {
        sample_shape: signal.sample_shape,
        sample_count: sample_count_of(signal),
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
    signal_values: (key: string) => number
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
  const frame_indices = sampled_indices(n_frames, frame_stride)
  assert_hdf5_stream_budget(
    format,
    n_frames,
    frame_indices.length,
    channels.values_per_frame(vector_keys.length),
    signal_keys.reduce((total, key) => total + channels.signal_values(key), 0),
    options.max_bytes ?? Number.POSITIVE_INFINITY,
  )
  return { frame_stride, vector_keys, signal_keys, frame_indices }
}

export const read_numeric_first_axis = (
  dataset: Dataset,
  path: string,
  entry_count: number,
  values_per_entry: number,
  error_label: string,
): number[] => {
  if (dataset.shape?.[0] !== entry_count) {
    throw new Error(
      `${error_label} ${path} has ${dataset.shape?.[0]} entries, expected ${entry_count}`,
    )
  }
  return Array.from(read_numeric_samples(dataset, path, entry_count, values_per_entry))
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
): Float64Array => {
  const values = new Float64Array(Math.ceil(sample_count / stride) * sample_size)
  const samples_per_slice = hdf5_frames_per_slice(sample_size)
  let output_offset = 0
  for (let start = 0; start < sample_count; start += samples_per_slice * stride) {
    const end = Math.min(start + samples_per_slice * stride, sample_count)
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

export const expand_ion_types = (
  ion_types: string[],
  ion_counts: number[],
): ElementSymbol[] => {
  if (ion_types.length !== ion_counts.length) {
    throw new Error(
      `ion_types (${ion_types.length}) and ion_counts (${ion_counts.length}) length mismatch`,
    )
  }
  const elements: ElementSymbol[] = []
  for (const [type_idx, symbol] of ion_types.entries()) {
    if (!is_elem_symbol(symbol)) {
      throw new Error(`Unknown element symbol in ion_types: ${symbol}`)
    }
    const ion_count = ion_counts[type_idx]
    if (!Number.isFinite(ion_count) || !Number.isInteger(ion_count) || ion_count < 0) {
      throw new Error(`Invalid ion count for ${symbol}: ${ion_count}`)
    }
    for (let count = 0; count < ion_count; count++) elements.push(symbol)
  }
  return elements
}

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
