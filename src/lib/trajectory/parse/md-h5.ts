import { create_numeric_md_frame, write_frame_vector, type FrameChannels } from '../frame'
// Lossless MD fixed-cell trajectories: static topology once, then independently
// compressed frames. Only the committed prefix is visible; atomic data stays on demand.
import { element_by_symbol } from '$lib/element/data'
import { calc_lattice_params, det_3x3 } from '$lib/math'
import { matrix3x3_from_rows } from '$lib/structure/parsers/shared'
import { ATOM_BATCH_SIZE, atom_range, type ReadAtoms } from '../atom-batches'
import { convert_atomic_numbers, create_sampled_frame } from '../helpers'
import type { PositionStreamOptions, TrajectoryPositionStream } from '../index'
import type { Dataset, File as H5File } from 'h5wasm'
import {
  attribute_value,
  dataset_at,
  read_numeric_buffer,
  read_numeric_samples,
  resolve_stream_channels,
  sampled_property_rows,
  string_value,
  to_scalar_number,
  trajectory_signal,
} from './h5-utils'
import type { LazyTrajectorySource } from './shared'
import type { TrajectoryRunSummary } from '../run'

const SCHEMA = `md-trajectory-v1`
const FORMAT = `MD HDF5`
const VELOCITY_FACTOR = 1 / 10.180505710759414
// Dataset width, stored unit and exposed property (absent for coordinates/step axes).
const FIELDS: Record<string, [number, string, string?]> = {
  positions: [3, `A; unwrapped Cartesian`],
  velocities: [3, `sqrt(eV/amu)`, `velocity`],
  forces: [3, `eV/A`, `force`],
  charges: [1, `e`, `charge`],
  spins: [1, `mu_B`, `spin`],
  energy: [0, `eV`, `energy`],
  energy_above_reference: [0, `eV`, `energy_above_reference`],
  kinetic_energy: [0, `eV`, `kinetic_energy`],
  total_energy: [0, `eV`, `total_energy`],
  total_energy_above_reference: [0, `eV`, `total_energy_above_reference`],
  temperature: [0, `K; center-of-mass motion removed`, `temperature`],
  time_fs: [0, `fs`, `time_fs`],
  md_step: [0, `absolute MD step`],
  local_step: [0, `zero-based frame index`],
}
const SCALARS = Object.keys(FIELDS).filter((name) => !FIELDS[name][0] && FIELDS[name][2])

const required = (file: H5File, path: string): Dataset => {
  const dataset = dataset_at(file, path)
  if (!dataset) throw new Error(`${FORMAT} is missing ${path}`)
  return dataset
}
const ensure_shape = (dataset: Dataset, path: string, expected: number[]): void => {
  const shape = dataset.shape ?? []
  if (shape.length !== expected.length || shape.some((size, idx) => size !== expected[idx]))
    throw new Error(`${FORMAT} ${path} has shape [${shape}], expected [${expected}]`)
}
const scalar = (file: H5File, path: string): number => {
  const dataset = required(file, path)
  ensure_shape(dataset, path, [])
  const value = to_scalar_number(dataset.to_array())
  if (value === null) throw new Error(`${FORMAT} ${path} must be a finite scalar`)
  return value
}
const attr = (file: H5File, key: string): unknown => attribute_value(file, [key])

export const is_md_h5_file = (file: H5File): boolean =>
  string_value(attr(file, `schema`))?.startsWith(`md-trajectory-`) ?? false

export const parse_md_h5_file = (
  file: H5File,
  group_path?: string,
  replica?: TrajectoryRunSummary,
): LazyTrajectorySource => {
  if (string_value(attr(file, `schema`)) !== SCHEMA)
    throw new Error(`${FORMAT} requires schema ${SCHEMA}`)
  if (group_path !== undefined && group_path !== `/`)
    throw new Error(`${FORMAT} has one trajectory at /, not ${group_path}`)
  const expected_frames = to_scalar_number(attr(file, `expected_frames`))
  const initial_step = to_scalar_number(attr(file, `initial_step`))
  const frame_count = scalar(file, `/committed_frames`)
  const success_dataset = required(file, `/successful`)
  ensure_shape(success_dataset, `/successful`, [])
  const successful = success_dataset.to_array()
  if (
    expected_frames === null ||
    !Number.isSafeInteger(expected_frames) ||
    expected_frames < 1 ||
    initial_step === null ||
    !Number.isSafeInteger(initial_step) ||
    initial_step < 0 ||
    !Number.isSafeInteger(frame_count) ||
    frame_count < 1 ||
    frame_count > expected_frames ||
    typeof successful !== `boolean` ||
    (successful && frame_count !== expected_frames)
  )
    throw new Error(`${FORMAT} has invalid committed/expected frame counts or success marker`)
  const timestep_fs = to_scalar_number(attr(file, `timestep_fs`))
  if (timestep_fs === null || timestep_fs <= 0)
    throw new Error(`${FORMAT} has invalid timestep_fs ${timestep_fs}`)
  if (to_scalar_number(attr(file, `velocity_to_A_per_fs`)) !== VELOCITY_FACTOR)
    throw new Error(`${FORMAT} has incompatible velocity conversion factor`)

  const numbers_dataset = required(file, `/static/atomic_numbers`)
  const n_atoms = numbers_dataset.shape?.[0] ?? 0
  if (!Number.isSafeInteger(n_atoms) || n_atoms < 1)
    throw new Error(`${FORMAT} has invalid atom count ${n_atoms}`)
  const read_static = (name: string, shape = [n_atoms]): Float64Array => {
    const path = `/static/${name}`
    const dataset = required(file, path)
    ensure_shape(dataset, path, shape)
    return read_numeric_samples(
      dataset,
      path,
      shape[0],
      shape.slice(1).reduce((total, size) => total * size, 1),
    )
  }
  const atomic_numbers = read_static(`atomic_numbers`)
  const elements = convert_atomic_numbers(atomic_numbers)
  const numeric_elements = Uint8Array.from(atomic_numbers)
  const masses = read_static(`masses`)
  const atom_masses = Array.from(masses)
  if (atom_masses.some((mass) => mass <= 0))
    throw new Error(`${FORMAT} masses must be positive`)
  const global_atom_ids = read_static(`global_atom_ids`)
  if (global_atom_ids.some((value, idx) => value !== idx))
    throw new Error(`${FORMAT} requires canonical global atom IDs`)
  global_atom_ids[0] = 0 // IDs are row indices, including positive zero for the first atom.
  const region_labels = read_static(`region_labels`)
  const period_ids = read_static(`period_id`)
  if (
    [region_labels, period_ids].some((values) =>
      values.some((value) => !Number.isSafeInteger(value) || value < 0),
    )
  )
    throw new Error(`${FORMAT} region/period IDs must be nonnegative integers`)
  const cell_values = read_static(`cell`, [3, 3])
  // Cell lattice vectors are stored as rows.
  const cell = matrix3x3_from_rows(
    [
      Array.from(cell_values.slice(0, 3)),
      Array.from(cell_values.slice(3, 6)),
      Array.from(cell_values.slice(6, 9)),
    ],
    `${FORMAT} cell`,
  )
  if (det_3x3(cell) <= 0) throw new Error(`${FORMAT} cell must have positive volume`)
  const pbc_dataset = required(file, `/static/pbc`)
  ensure_shape(pbc_dataset, `/static/pbc`, [3])
  const raw_pbc = pbc_dataset.to_array()
  if (
    !Array.isArray(raw_pbc) ||
    raw_pbc.length !== 3 ||
    raw_pbc.some((value) => typeof value !== `boolean`)
  )
    throw new Error(`${FORMAT} requires three boolean periodic boundary flags`)
  const pbc: [boolean, boolean, boolean] = [
    raw_pbc[0] === true,
    raw_pbc[1] === true,
    raw_pbc[2] === true,
  ]
  const volume = calc_lattice_params(cell).volume
  const metadata_text = string_value(attr(file, `metadata_json`))
  const producer: unknown = metadata_text ? JSON.parse(metadata_text) : null
  if (!producer || typeof producer !== `object` || Array.isArray(producer))
    throw new Error(`${FORMAT} metadata_json must be an object`)

  const sample_shape = (width: number): number[] =>
    width === 3 ? [n_atoms, 3] : width === 1 ? [n_atoms] : []
  const datasets: Record<string, Dataset> = {}
  for (const [name, [width, unit]] of Object.entries(FIELDS)) {
    const path = `/frames/${name}`
    const dataset = required(file, path)
    const stored_frames = dataset.shape?.[0] ?? -1
    // An interrupted append can leave unequal uncommitted tails. Never read those tails.
    if (
      stored_frames < frame_count ||
      stored_frames > expected_frames ||
      (successful && stored_frames !== frame_count)
    )
      throw new Error(`${FORMAT} ${path} does not cover exactly its committed prefix`)
    ensure_shape(dataset, path, [stored_frames, ...sample_shape(width)])
    const integer = name === `md_step` || name === `local_step`
    // HDF5 classes 0/1 are integer/float. Lossless scientific channels require float64.
    if (
      dataset.metadata.type !== (integer ? 0 : 1) ||
      dataset.metadata.size !== 8 ||
      string_value(attribute_value(dataset, [`units`])) !== unit
    )
      throw new Error(`${FORMAT} ${path} has incorrect dtype or units`)
    datasets[name] = dataset
  }
  const read_samples = (
    name: string,
    start: number,
    end: number,
    stride = 1,
  ): Float64Array => {
    const width = FIELDS[name][0]
    const values = read_numeric_samples(
      datasets[name],
      `/frames/${name}`,
      frame_count,
      width ? n_atoms * width : 1,
      stride,
      undefined,
      start,
      end,
    )
    if (name === `velocities`)
      for (let idx = 0; idx < values.length; idx++) values[idx] *= VELOCITY_FACTOR
    return values
  }
  // The primary validates all axes and plot samples once. Replicas open the same immutable
  // File, so repeating thousands of compressed scalar reads only delays frame preparation.
  if (
    replica &&
    (replica.frame_count !== frame_count ||
      replica.atom_count !== n_atoms ||
      replica.preview.step !== initial_step ||
      replica.time_step?.value !== timestep_fs ||
      replica.time_step.unit !== `fs` ||
      !replica.properties.complete)
  )
    throw new Error(`${FORMAT} replica metadata does not match its source`)
  const steps = replica
    ? Array.from({ length: frame_count }, (_unused, idx) => initial_step + idx)
    : Array.from(read_samples(`md_step`, 0, frame_count))
  const times = replica
    ? Float64Array.from(steps, (step) => step * timestep_fs)
    : read_samples(`time_fs`, 0, frame_count)
  if (!replica) {
    const local_steps = read_samples(`local_step`, 0, frame_count)
    if (
      steps.some(
        (step, idx) =>
          step !== initial_step + idx ||
          local_steps[idx] !== idx ||
          times[idx] !== step * timestep_fs,
      )
    )
      throw new Error(
        `${FORMAT} committed step/time axes must be consecutive at ${timestep_fs} fs`,
      )
  }
  const check_frame = (frame_idx: number): void => {
    if (!Number.isInteger(frame_idx) || frame_idx < 0 || frame_idx >= frame_count)
      throw new Error(`${FORMAT} frame ${frame_idx} is outside the committed prefix`)
  }
  const channels: Record<string, { name: string; width: number; unit: string }> =
    Object.fromEntries(
      Object.entries(FIELDS).flatMap(([name, [width, unit, key]]) =>
        key ? [[key, { name, width, unit: name === `velocities` ? `A/fs` : unit }]] : [],
      ),
    )
  const frame_properties = (frame_idx: number): Record<string, number> => ({
    ...Object.fromEntries(
      SCALARS.map((name) => [name, read_samples(name, frame_idx, frame_idx + 1)[0]]),
    ),
    time: times[frame_idx],
    volume,
  })
  const read_atoms: ReadAtoms = (options, signal) => {
    signal?.throwIfAborted()
    check_frame(options.frame_idx)
    const { start, count, stride } = atom_range(n_atoms, options)
    const { frame_idx, velocity_key, energy_key, selection_key, mass_source } = options
    if ((velocity_key && velocity_key !== `velocity`) || energy_key || selection_key)
      throw new Error(
        `${FORMAT} atom batches support the velocity channel and recorded/standard masses`,
      )
    const read_atomic = (name: string): Float64Array => {
      const values = read_numeric_buffer(datasets[name], `/frames/${name}`, [
        [frame_idx, frame_idx + 1],
        [start, Math.min(n_atoms, start + count * stride), stride],
      ])
      if (name === `velocities`)
        for (let idx = 0; idx < values.length; idx++) values[idx] *= VELOCITY_FACTOR
      return values
    }
    const batch_numbers = new Uint8Array(count)
    const batch_masses = mass_source ? new Float64Array(count) : undefined
    for (let idx = 0; idx < count; idx++) {
      const atom_idx = start + idx * stride
      batch_numbers[idx] = atomic_numbers[atom_idx]
      if (batch_masses) {
        const mass =
          mass_source === `recorded`
            ? atom_masses[atom_idx]
            : element_by_symbol.get(elements[atom_idx])?.atomic_mass
        if (mass === undefined || mass <= 0)
          throw new Error(`${FORMAT} missing ${mass_source} mass for atom ${atom_idx}`)
        batch_masses[idx] = mass
      }
    }
    return {
      positions: read_atomic(`positions`),
      atomic_numbers: batch_numbers,
      total_atoms: n_atoms,
      start,
      stride,
      step: steps[frame_idx],
      time: times[frame_idx],
      cell,
      origin: [0, 0, 0],
      pbc,
      ...(velocity_key && { velocities: read_atomic(`velocities`) }),
      ...(batch_masses && { masses: batch_masses }),
    }
  }
  const load_frame = (frame_idx: number, requested?: FrameChannels) => {
    check_frame(frame_idx)
    const positions = read_samples(`positions`, frame_idx, frame_idx + 1)
    const atomic = Object.fromEntries(
      Object.entries(channels)
        .filter(
          ([key, channel]) =>
            channel.width &&
            (channel.width !== 3 || !requested?.vectors || requested.vectors.includes(key)),
        )
        .map(([key, channel]) => [key, read_samples(channel.name, frame_idx, frame_idx + 1)]),
    )
    const vector_keys = [`force`, `velocity`].filter(
      (key) => !requested?.vectors || requested.vectors.includes(key),
    )
    const frame = create_numeric_md_frame(
      positions,
      numeric_elements,
      cell,
      pbc,
      steps[frame_idx],
      { ...frame_properties(frame_idx), coords_unwrapped: true },
      vector_keys,
    )
    frame.available_vector_keys = [`force`, `velocity`]
    for (const [column, key] of vector_keys.entries())
      write_frame_vector(frame, column, atomic[key])
    frame.scalar_columns = {
      id: global_atom_ids,
      mass: masses,
      region_label: region_labels,
      period_id: period_ids,
      charge: atomic.charge,
      spin: atomic.spin,
    }
    return frame
  }
  const collect_positions = (
    options: PositionStreamOptions = {},
  ): TrajectoryPositionStream => {
    const { frame_stride, vector_keys, signal_keys, frame_indices } = resolve_stream_channels(
      FORMAT,
      options,
      frame_count,
      {
        is_vector: (key) => channels[key]?.width === 3,
        is_signal: (key) => key in channels,
        values_per_frame: (n_vectors) => n_atoms * 3 * (1 + n_vectors) + 10,
        signal_values: (key, start, end) =>
          (end - start) * (Math.max(1, n_atoms * channels[key].width) + 1),
      },
    )
    const start = options.start_frame ?? 0
    const end = options.end_frame ?? frame_count
    return {
      positions: read_samples(`positions`, start, end, frame_stride),
      n_frames: frame_indices.length,
      n_atoms,
      elements: [...elements],
      lattice_matrices: frame_indices.map(() => cell),
      pbc,
      coords_unwrapped: true,
      frame_stride,
      steps: frame_indices.map((idx) => steps[idx]),
      ...(vector_keys.length && {
        vectors: Object.fromEntries(
          vector_keys.map((key) => [
            key,
            read_samples(channels[key].name, start, end, frame_stride),
          ]),
        ),
      }),
      ...(signal_keys.length && {
        signals: Object.fromEntries(
          signal_keys.map((key) => [
            key,
            trajectory_signal(
              read_samples(channels[key].name, start, end),
              {
                sample_shape: sample_shape(channels[key].width),
                unit: channels[key].unit,
              },
              steps.slice(start, end),
            ),
          ]),
        ),
      }),
    }
  }
  let preview = replica?.preview
  if (!preview && n_atoms > ATOM_BATCH_SIZE) {
    const preview_stride = Math.ceil(n_atoms / 2000)
    const preview_values = read_numeric_buffer(datasets.positions, `/frames/positions`, [
      [0, 1],
      [0, n_atoms, preview_stride],
    ])
    preview = create_sampled_frame(
      preview_values,
      elements,
      preview_stride,
      cell,
      pbc,
      steps[0],
      { ...frame_properties(0), coords_unwrapped: true },
    )
  }
  return {
    format: `md-hdf5`,
    frame_count,
    atom_count: n_atoms,
    atom_masses,
    time_step: { value: timestep_fs, unit: `fs` },
    metadata: {
      ...producer,
      schema: SCHEMA,
      successful,
      committed_frames: frame_count,
      expected_frames,
      ensemble: string_value(attr(file, `ensemble`)),
      active_thermostat: string_value(attr(file, `active_thermostat`)),
      velocity_source_unit: `sqrt(eV/amu)`,
      mass_unit: `amu`,
      velocity_to_A_per_fs: VELOCITY_FACTOR,
    },
    read_frame: load_frame,
    read_atoms,
    collect_positions,
    preview,
    properties:
      replica?.properties.rows ??
      sampled_property_rows(
        frame_count,
        (idx) => steps[idx],
        (indices, stride) => {
          const scalars = SCALARS.map(
            (name) => [name, read_samples(name, 0, frame_count, stride)] as const,
          )
          return indices.map((frame_idx, sample_idx) => ({
            ...Object.fromEntries(scalars.map(([name, values]) => [name, values[sample_idx]])),
            time: times[frame_idx],
            volume,
          }))
        },
      ),
    signals: Object.fromEntries(
      Object.entries(channels).map(([key, { width, unit }]) => [
        key,
        {
          sample_shape: sample_shape(width),
          sample_count: frame_count,
          frame_aligned: true,
          unit,
        },
      ]),
    ),
  }
}
