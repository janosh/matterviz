import { calc_lattice_params, first_non_increasing_index } from '$lib/math'
import type { Pbc } from '$lib/structure/pbc'
import {
  convert_atomic_numbers,
  create_trajectory_frame,
  values_per_sample,
} from '$lib/trajectory/helpers'
import type { PositionStreamOptions, TrajectoryPositionStream } from '$lib/trajectory/index'
import type { Dataset, Group } from 'h5wasm'
import type * as h5wasm from 'h5wasm'
import {
  Hdf5GroupSelectionRequiredError,
  attach_site_vectors,
  attribute_value,
  dataset_at,
  dataset_shape,
  hdf5_frames_per_slice,
  is_hdf5_dataset,
  is_hdf5_group,
  lattice_from_values,
  read_numeric_hyperslab,
  read_numeric_samples,
  resolve_stream_channels,
  sampled_property_rows,
  signal_descriptors as describe_signals,
  string_value,
  to_number_array,
  to_scalar_number,
  trajectory_signal,
} from './h5-utils'
import type { LazyTrajectorySource, ParsedTrajectory } from './shared'

type ReplicaSelection = {
  path: string
  molecule_name: string
  replica_idx: number
  replica_count: number
}

const required_group = (h5_file: h5wasm.File, path: string): Group => {
  const entity = h5_file.get(path)
  if (is_hdf5_group(entity)) return entity
  throw new Error(`Reference MD HDF5 is missing group ${path}`)
}

const required_dataset = (h5_file: h5wasm.File, path: string): Dataset => {
  const entity = h5_file.get(path)
  if (is_hdf5_dataset(entity)) return entity
  throw new Error(`Reference MD HDF5 is missing dataset ${path}`)
}

const shape_of = (dataset: Dataset, path: string): number[] =>
  dataset_shape(dataset, path, `Reference MD HDF5`)

const values_of = (dataset: Dataset, path: string): number[] => {
  const values = to_number_array(dataset.to_array())
  if (!values) throw new Error(`Reference MD HDF5 dataset ${path} must contain finite numbers`)
  return values
}

const ensure_shape = (shape: number[], expected: number[], path: string): void => {
  if (shape.length !== expected.length || shape.some((size, idx) => size !== expected[idx])) {
    throw new Error(
      `Reference MD HDF5 dataset ${path} has shape [${shape.join(`, `)}], expected [${expected.join(`, `)}]`,
    )
  }
}

const is_pbc_value = (value: unknown): boolean =>
  value === true || value === false || value === 0 || value === 1

const as_pbc = (dataset: Dataset, path: string): Pbc => {
  const raw_values = dataset.to_array()
  const values =
    Array.isArray(raw_values) || ArrayBuffer.isView(raw_values)
      ? Array.from(raw_values as ArrayLike<unknown>)
      : []
  if (values.length !== 3 || values.some((value) => !is_pbc_value(value))) {
    throw new Error(`Reference MD HDF5 PBC dataset ${path} must contain three boolean values`)
  }
  return [Boolean(values[0]), Boolean(values[1]), Boolean(values[2])]
}

const is_reference_md_molecule = (molecule: Group): boolean =>
  is_hdf5_group(molecule.get(`topology`)) &&
  is_hdf5_group(molecule.get(`production_initial_state`)) &&
  is_hdf5_group(molecule.get(`observables`))

const molecule_selections = (
  h5_file: h5wasm.File,
  molecule_name: string,
): ReplicaSelection[] => {
  const positions_path = `/molecules/${molecule_name}/production_initial_state/positions_angstrom`
  const shape = shape_of(required_dataset(h5_file, positions_path), positions_path)
  if (shape.length !== 3 || shape[2] !== 3) {
    throw new Error(
      `Reference MD HDF5 dataset ${positions_path} has shape [${shape.join(`, `)}], expected [replicas, atoms, 3]`,
    )
  }
  return Array.from({ length: shape[0] }, (_unused, replica_idx) => ({
    path: `/molecules/${molecule_name}/replicas/${replica_idx}`,
    molecule_name,
    replica_idx,
    replica_count: shape[0],
  }))
}

const selection_from_path = (
  hdf5_group_path: string | undefined,
  selections: ReplicaSelection[],
): ReplicaSelection => {
  const paths = selections.map(({ path }) => path)
  if (!hdf5_group_path && selections.length !== 1) {
    throw new Hdf5GroupSelectionRequiredError(
      paths,
      `Reference MD HDF5 contains multiple molecule replicas; choose one to reconstruct`,
    )
  }
  const selection = selections.find(({ path }) => path === (hdf5_group_path ?? paths[0]))
  if (!selection) {
    throw new Error(
      `Unknown Reference MD HDF5 selection ${hdf5_group_path}; available selections: ${paths.join(`, `)}`,
    )
  }
  return selection
}

type ObservableManifest = {
  dataset: Dataset
  path: string
  sample_shape: number[]
  unit?: string
}

const optional_observable = (
  h5_file: h5wasm.File,
  molecule_path: string,
  name: string,
  expected_shape: number[],
  sample_shape: number[],
  unit?: string,
): ObservableManifest | undefined => {
  const path = `${molecule_path}/observables/${name}`
  const dataset = dataset_at(h5_file, path)
  if (!dataset) return undefined
  ensure_shape(shape_of(dataset, path), expected_shape, path)
  return { dataset, path, sample_shape, ...(unit ? { unit } : {}) }
}

const replica_value = (
  dataset: Dataset,
  path: string,
  replica_count: number,
  replica_idx: number,
): number => {
  ensure_shape(shape_of(dataset, path), [replica_count], path)
  return read_numeric_hyperslab(dataset, path, [[replica_idx, replica_idx + 1]])[0]
}

export const is_reference_md_h5_file = (h5_file: h5wasm.File): boolean => {
  const molecules = h5_file.get(`/molecules`)
  return (
    is_hdf5_group(h5_file.get(`/frames`)) &&
    is_hdf5_dataset(h5_file.get(`/frames/production_step`)) &&
    is_hdf5_dataset(h5_file.get(`/frames/time_ps`)) &&
    is_hdf5_group(h5_file.get(`/simulation`)) &&
    is_hdf5_dataset(h5_file.get(`/replicas/global_ids`)) &&
    is_hdf5_group(molecules) &&
    molecules.keys().some((name) => {
      const molecule = molecules.get(name)
      return is_hdf5_group(molecule) && is_reference_md_molecule(molecule)
    })
  )
}

export const reference_checkpoint_interval = (
  n_frames: number,
  checkpoint_bytes: number,
  budget_bytes = 32 * 1024 * 1024,
): number => {
  if (
    !Number.isInteger(n_frames) ||
    n_frames < 1 ||
    !Number.isInteger(checkpoint_bytes) ||
    checkpoint_bytes < 1 ||
    !Number.isInteger(budget_bytes) ||
    budget_bytes < 1
  ) {
    throw new Error(
      `Reference MD checkpoint sizing requires positive integers, got n_frames=${n_frames}, checkpoint_bytes=${checkpoint_bytes}, budget_bytes=${budget_bytes}`,
    )
  }
  const max_checkpoints = Math.floor(budget_bytes / checkpoint_bytes)
  if (max_checkpoints < 1) {
    throw new Error(
      `Reference MD position checkpoint requires ${checkpoint_bytes} bytes, above the ${budget_bytes}-byte budget`,
    )
  }
  return Math.max(256, Math.ceil(n_frames / max_checkpoints))
}

export const parse_reference_md_h5_file = (
  h5_file: h5wasm.File,
  hdf5_group_path?: string,
): ParsedTrajectory | LazyTrajectorySource => {
  required_group(h5_file, `/frames`)
  const simulation_group = required_group(h5_file, `/simulation`)
  const molecules_group = required_group(h5_file, `/molecules`)
  const selections = molecules_group.keys().flatMap((molecule_name) => {
    const molecule = molecules_group.get(molecule_name)
    return is_hdf5_group(molecule) && is_reference_md_molecule(molecule)
      ? molecule_selections(h5_file, molecule_name)
      : []
  })
  if (selections.length === 0) {
    throw new Error(`Reference MD HDF5 contains no molecule replicas`)
  }
  const { molecule_name, replica_idx, replica_count } = selection_from_path(
    hdf5_group_path,
    selections,
  )
  const molecule_path = `/molecules/${molecule_name}`
  const topology_path = `${molecule_path}/topology`
  const initial_state_path = `${molecule_path}/production_initial_state`
  const atomic_numbers_path = `${topology_path}/atomic_numbers`
  const masses_path = `${topology_path}/masses_amu`
  const pbc_path = `${topology_path}/pbc`
  const positions_path = `${initial_state_path}/positions_angstrom`
  const cells_path = `${initial_state_path}/cells_angstrom`
  const velocity_path = `${molecule_path}/observables/atomic_velocity_angstrom_per_ps`
  const production_steps_path = `/frames/production_step`
  const times_path = `/frames/time_ps`
  const atomic_numbers = values_of(
    required_dataset(h5_file, atomic_numbers_path),
    atomic_numbers_path,
  )
  const elements = convert_atomic_numbers(atomic_numbers)
  const n_atoms = elements.length
  const atom_masses = values_of(required_dataset(h5_file, masses_path), masses_path)
  if (atom_masses.length !== n_atoms || atom_masses.some((mass) => mass <= 0)) {
    throw new Error(
      `Reference MD HDF5 dataset ${masses_path} must contain ${n_atoms} positive masses`,
    )
  }
  const pbc = as_pbc(required_dataset(h5_file, pbc_path), pbc_path)
  const production_steps = values_of(
    required_dataset(h5_file, production_steps_path),
    production_steps_path,
  )
  const times_ps = values_of(required_dataset(h5_file, times_path), times_path)
  if (production_steps.length === 0 || times_ps.length !== production_steps.length) {
    throw new Error(
      `Reference MD HDF5 frames require matching non-empty ${production_steps_path} and ${times_path}`,
    )
  }
  for (const [axis, path] of [
    [production_steps, production_steps_path],
    [times_ps, times_path],
  ] as const) {
    if (first_non_increasing_index(axis) !== null) {
      throw new Error(`Reference MD HDF5 ${path} must increase strictly`)
    }
  }
  const n_frames = production_steps.length
  const initial_positions_dataset = required_dataset(h5_file, positions_path)
  ensure_shape(
    shape_of(initial_positions_dataset, positions_path),
    [replica_count, n_atoms, 3],
    positions_path,
  )
  const read_replica = (dataset: Dataset, path: string): number[] =>
    read_numeric_hyperslab(dataset, path, [[replica_idx, replica_idx + 1]])
  const initial_positions = read_replica(initial_positions_dataset, positions_path)
  const cells_dataset = required_dataset(h5_file, cells_path)
  ensure_shape(shape_of(cells_dataset, cells_path), [replica_count, 3, 3], cells_path)
  const selected_cell_values = read_replica(cells_dataset, cells_path)
  const lattice_matrix = lattice_from_values(selected_cell_values)
  const velocity_dataset = required_dataset(h5_file, velocity_path)
  const velocity_shape = [n_frames, replica_count, n_atoms, 3]
  ensure_shape(shape_of(velocity_dataset, velocity_path), velocity_shape, velocity_path)
  const velocity_sample_size = n_atoms * 3
  const observable = (name: string, sample_shape: number[], unit?: string) =>
    optional_observable(
      h5_file,
      molecule_path,
      name,
      [n_frames, replica_count, ...sample_shape],
      sample_shape,
      unit,
    )
  const dipole = observable(`total_dipole_e_angstrom`, [3], `e*A`)
  const energy = observable(`total_energy_ev`, [], `eV`)
  const temperature = observable(`vibrational_temperature_kelvin`, [], `K`)
  const global_ids_path = `/replicas/global_ids`
  const member_seeds_path = `${molecule_path}/replicas/member_seeds`
  const global_id = replica_value(
    required_dataset(h5_file, global_ids_path),
    global_ids_path,
    replica_count,
    replica_idx,
  )
  const member_seed = replica_value(
    required_dataset(h5_file, member_seeds_path),
    member_seeds_path,
    replica_count,
    replica_idx,
  )
  const integration_timestep_ps = to_scalar_number(
    attribute_value(simulation_group, [`integration_timestep_ps`]),
  )
  if (integration_timestep_ps == null || integration_timestep_ps <= 0) {
    throw new Error(
      `Reference MD HDF5 simulation attribute integration_timestep_ps must be positive`,
    )
  }
  const sample_stride_steps = to_scalar_number(
    attribute_value(simulation_group, [`sample_stride_steps`]),
  )
  const sample_interval_ps = to_scalar_number(
    attribute_value(simulation_group, [`sample_interval_ps`]),
  )
  const ensemble = string_value(attribute_value(simulation_group, [`ensemble`]))
  const volume = calc_lattice_params(lattice_matrix).volume
  if (!(volume > 0)) {
    throw new Error(`Reference MD HDF5 cell volume must be positive, got ${volume}`)
  }
  const signal_manifest: Record<string, ObservableManifest> = {
    velocity: {
      dataset: velocity_dataset,
      path: velocity_path,
      sample_shape: [n_atoms, 3],
      unit: `A/ps`,
    },
    ...(dipole ? { dipole } : {}),
  }
  // Every observable is stored [n_frames, replica, ...] on the production steps, so all of
  // them share the geometry's step axis
  const signal_descriptors = describe_signals(
    signal_manifest,
    () => n_frames,
    () => true,
  )
  const velocity_frames_per_slice = hdf5_frames_per_slice(velocity_sample_size)
  const read_replica_frames = (
    manifest: ObservableManifest,
    start: number,
    end: number,
    stride = 1,
  ): number[] =>
    read_numeric_hyperslab(manifest.dataset, manifest.path, [
      [start, end, stride],
      [replica_idx, replica_idx + 1],
    ])
  const read_replica_samples = (manifest: ObservableManifest, stride = 1): Float64Array => {
    return read_numeric_samples(
      manifest.dataset,
      manifest.path,
      n_frames,
      values_per_sample(manifest.sample_shape),
      stride,
      (start, end, sample_stride) => [
        [start, end, sample_stride],
        [replica_idx, replica_idx + 1],
      ],
    )
  }
  const velocity_manifest = signal_manifest.velocity
  const integrate_velocity_sample = (
    positions: Float64Array,
    previous_velocity: Float64Array,
    velocities: number[],
    velocity_offset: number,
    time_delta_ps?: number,
  ): void => {
    for (let coordinate_idx = 0; coordinate_idx < velocity_sample_size; coordinate_idx++) {
      const velocity = velocities[velocity_offset + coordinate_idx]
      if (time_delta_ps !== undefined) {
        positions[coordinate_idx] +=
          (time_delta_ps * (previous_velocity[coordinate_idx] + velocity)) / 2
      }
      previous_velocity[coordinate_idx] = velocity
    }
  }
  const checkpoint_bytes = velocity_sample_size * Float64Array.BYTES_PER_ELEMENT
  const checkpoint_interval = reference_checkpoint_interval(n_frames, checkpoint_bytes)
  // Trapezoid-integrate the velocity samples of frames [start_frame, end_frame) into
  // `positions`, reading them in slice-sized chunks; `on_frame` sees each frame once the
  // integration has reached it, with the chunk and the frame's offset into it
  const integrate_velocity_frames = (
    start_frame: number,
    end_frame: number,
    positions: Float64Array,
    on_frame?: (frame_idx: number, chunk: number[], offset: number) => void,
  ): void => {
    const previous_velocity = new Float64Array(velocity_sample_size)
    let has_previous = false
    for (
      let chunk_start = start_frame;
      chunk_start < end_frame;
      chunk_start += velocity_frames_per_slice
    ) {
      const chunk_end = Math.min(chunk_start + velocity_frames_per_slice, end_frame)
      const chunk = read_replica_frames(velocity_manifest, chunk_start, chunk_end)
      for (let frame_idx = chunk_start; frame_idx < chunk_end; frame_idx++) {
        const offset = (frame_idx - chunk_start) * velocity_sample_size
        integrate_velocity_sample(
          positions,
          previous_velocity,
          chunk,
          offset,
          has_previous ? times_ps[frame_idx] - times_ps[frame_idx - 1] : undefined,
        )
        has_previous = true
        on_frame?.(frame_idx, chunk, offset)
      }
    }
  }
  const checkpoint_positions: Float64Array[] = []
  const integrated_positions = Float64Array.from(initial_positions)
  integrate_velocity_frames(0, n_frames, integrated_positions, (frame_idx) => {
    if (frame_idx % checkpoint_interval === 0) {
      checkpoint_positions.push(integrated_positions.slice())
    }
  })
  const assert_frame_number = (frame_number: number): void => {
    if (!Number.isInteger(frame_number) || frame_number < 0 || frame_number >= n_frames) {
      throw new Error(
        `Reference MD frame ${frame_number} is outside 0..${Math.max(n_frames - 1, 0)}`,
      )
    }
  }
  const reconstruct_positions = (frame_number: number): Float64Array => {
    assert_frame_number(frame_number)
    const checkpoint_idx = Math.floor(frame_number / checkpoint_interval)
    const checkpoint_frame = checkpoint_idx * checkpoint_interval
    const positions = checkpoint_positions[checkpoint_idx].slice()
    if (checkpoint_frame !== frame_number) {
      integrate_velocity_frames(checkpoint_frame, frame_number + 1, positions)
    }
    return positions
  }
  const selected_scalar = (
    manifest: ObservableManifest | undefined,
    frame_number: number,
  ): number | undefined =>
    manifest ? read_replica_frames(manifest, frame_number, frame_number + 1)[0] : undefined
  const metadata_for_frame = (frame_number: number): Record<string, number> => ({
    time_ps: times_ps[frame_number],
    ...(energy ? { energy: selected_scalar(energy, frame_number) } : {}),
    ...(temperature ? { temperature: selected_scalar(temperature, frame_number) } : {}),
  })
  const load_frame = (frame_number: number) => {
    const positions = reconstruct_positions(frame_number)
    const velocity = read_replica_frames(velocity_manifest, frame_number, frame_number + 1)
    const frame = create_trajectory_frame(
      Array.from({ length: n_atoms }, (_unused, atom_idx) =>
        Array.from(positions.slice(atom_idx * 3, atom_idx * 3 + 3)),
      ),
      elements,
      lattice_matrix,
      pbc,
      production_steps[frame_number],
      metadata_for_frame(frame_number),
    )
    attach_site_vectors(frame, `velocity`, velocity)
    return frame
  }
  const sampled_properties = () =>
    sampled_property_rows(
      n_frames,
      (frame_idx) => production_steps[frame_idx],
      (frame_indices, stride) => {
        const energy_values = energy ? read_replica_frames(energy, 0, n_frames, stride) : null
        const temperature_values = temperature
          ? read_replica_frames(temperature, 0, n_frames, stride)
          : null
        return frame_indices.map((frame_number, sample_idx) => ({
          time_ps: times_ps[frame_number],
          volume,
          ...(energy_values ? { energy: energy_values[sample_idx] } : {}),
          ...(temperature_values ? { temperature: temperature_values[sample_idx] } : {}),
        }))
      },
    )
  const trajectory_metadata = {
    molecule: molecule_name,
    replica_idx,
    global_id,
    member_seed,
    ...(sample_stride_steps !== null ? { sample_stride_steps } : {}),
    ...(sample_interval_ps !== null ? { sample_interval_ps } : {}),
    ...(ensemble ? { ensemble } : {}),
    reconstructed_positions: `trapezoidal integration of atomic_velocity_angstrom_per_ps`,
    position_checkpoint_interval: checkpoint_interval,
    position_checkpoint_bytes: checkpoint_positions.length * checkpoint_bytes,
  }
  if (n_frames === 1) {
    const signals = Object.fromEntries(
      Object.entries(signal_manifest).map(([key, manifest]) => [
        key,
        trajectory_signal(read_replica_samples(manifest), manifest, [...production_steps]),
      ]),
    )
    return {
      format: `reference-md-hdf5`,
      frames: [load_frame(0)],
      time_step: { value: integration_timestep_ps, unit: `ps` },
      atom_masses,
      signals,
      metadata: trajectory_metadata,
    }
  }
  const collect_positions = (
    options: PositionStreamOptions = {},
  ): TrajectoryPositionStream => {
    const { frame_stride, vector_keys, signal_keys, frame_indices } = resolve_stream_channels(
      `Reference MD HDF5`,
      options,
      n_frames,
      {
        is_vector: (key) => key === `velocity`,
        is_signal: (key) => Boolean(signal_manifest[key]),
        values_per_frame: (n_vectors) => velocity_sample_size * (1 + n_vectors) + 10,
        signal_values: (key) =>
          n_frames * (values_per_sample(signal_manifest[key].sample_shape) + 1),
      },
    )
    const selected_values = frame_indices.length * velocity_sample_size
    const positions = new Float64Array(selected_values)
    const selected_velocities = vector_keys.includes(`velocity`)
      ? new Float64Array(selected_values)
      : null
    const native_velocity = signal_keys.includes(`velocity`)
      ? new Float64Array(n_frames * velocity_sample_size)
      : null
    const stream_positions = Float64Array.from(initial_positions)
    let selected_idx = 0
    integrate_velocity_frames(0, n_frames, stream_positions, (frame_idx, chunk, offset) => {
      // The native signal wants every frame, so copy each chunk in one bulk set as it
      // arrives (offset 0 is the chunk's first frame); only the strided vector slices
      if (offset === 0) native_velocity?.set(chunk, frame_idx * velocity_sample_size)
      const selected = frame_idx % frame_stride === 0
      if (!selected) return
      selected_velocities?.set(
        chunk.slice(offset, offset + velocity_sample_size),
        selected_idx * velocity_sample_size,
      )
      positions.set(stream_positions, selected_idx * velocity_sample_size)
      selected_idx++
    })
    const signals = Object.fromEntries(
      signal_keys.map((key) => {
        const manifest = signal_manifest[key]
        const values =
          key === `velocity` && native_velocity
            ? native_velocity
            : read_replica_samples(manifest)
        return [key, trajectory_signal(values, manifest, [...production_steps])]
      }),
    )
    return {
      positions,
      n_frames: frame_indices.length,
      n_atoms,
      elements: [...elements],
      lattice_matrices: frame_indices.map(() => lattice_matrix),
      pbc,
      coords_unwrapped: true,
      frame_stride,
      steps: frame_indices.map((frame_idx) => production_steps[frame_idx]),
      ...(selected_velocities ? { vectors: { velocity: selected_velocities } } : {}),
      ...(Object.keys(signals).length > 0 ? { signals } : {}),
    }
  }
  return {
    format: `reference-md-hdf5`,
    frame_count: n_frames,
    read_frame: load_frame,
    properties: sampled_properties(),
    collect_positions,
    dispose: () => {
      checkpoint_positions.length = 0
    },
    time_step: { value: integration_timestep_ps, unit: `ps` },
    atom_masses,
    signals: signal_descriptors,
    metadata: trajectory_metadata,
  }
}
