import { calc_lattice_params, transpose_3x3_matrix } from '$lib/math'
import type { Pbc } from '$lib/structure/pbc'
import {
  convert_atomic_numbers,
  count_elements,
  create_trajectory_frame,
  validate_3x3_matrix,
} from '$lib/trajectory/helpers'
import type {
  FrameLoader,
  PositionStreamOptions,
  TrajectoryMetadata,
  TrajectoryPositionStream,
  TrajectorySignalDescriptor,
  TrajectoryType,
} from '$lib/trajectory/index'
import type { Dataset, Group } from 'h5wasm'
import type * as h5wasm from 'h5wasm'
import {
  Hdf5TrajectoryGroupSelectionError,
  assert_hdf5_stream_budget,
  attribute_value,
  hdf5_frames_per_slice,
  is_hdf5_dataset,
  is_hdf5_group,
  positive_integer_stride,
  read_numeric_first_axis,
  read_numeric_hyperslab,
  read_numeric_samples,
  sampled_indices,
  string_value,
  to_number_array,
  to_scalar_number,
  unique_strings,
} from './h5-utils'

type ReplicaSelection = {
  path: string
  molecule_name: string
  replica_idx: number
  replica_count: number
}

const PREVIEW_FRAME_COUNT = 10

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

const optional_dataset = (h5_file: h5wasm.File, path: string): Dataset | undefined => {
  const entity = h5_file.get(path)
  return is_hdf5_dataset(entity) ? entity : undefined
}

const shape_of = (dataset: Dataset, path: string): number[] => {
  const shape = dataset.shape
  if (!shape || shape.some((size) => !Number.isInteger(size) || size < 1)) {
    throw new Error(
      `Reference MD HDF5 dataset ${path} has invalid shape [${shape?.join(`, `)}]`,
    )
  }
  return shape
}

const values_of = (dataset: Dataset, path: string): number[] => {
  const values = to_number_array(dataset.to_array())
  if (!values) throw new Error(`Reference MD HDF5 dataset ${path} must contain finite numbers`)
  return values
}

const values_of_first_axis = (dataset: Dataset, path: string): number[] => {
  const shape = shape_of(dataset, path)
  const values_per_entry = shape.slice(1).reduce((product, size) => product * size, 1)
  return read_numeric_first_axis(
    dataset,
    path,
    shape[0],
    values_per_entry,
    `Reference MD HDF5 dataset`,
  )
}

const slice_values = (
  dataset: Dataset,
  path: string,
  ranges: Parameters<Dataset[`slice`]>[0],
): number[] => read_numeric_hyperslab(dataset, path, ranges)

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
    throw new Hdf5TrajectoryGroupSelectionError(
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
  const dataset = optional_dataset(h5_file, path)
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
  const values = slice_values(dataset, path, [[replica_idx, replica_idx + 1]])
  if (values.length !== 1) {
    throw new Error(`Reference MD HDF5 dataset ${path} must yield one selected replica value`)
  }
  return values[0]
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
): TrajectoryType => {
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
  const production_steps = values_of_first_axis(
    required_dataset(h5_file, production_steps_path),
    production_steps_path,
  )
  const times_ps = values_of_first_axis(required_dataset(h5_file, times_path), times_path)
  if (production_steps.length === 0 || times_ps.length !== production_steps.length) {
    throw new Error(
      `Reference MD HDF5 frames require matching non-empty ${production_steps_path} and ${times_path}`,
    )
  }
  for (let frame_idx = 1; frame_idx < production_steps.length; frame_idx++) {
    if (!(production_steps[frame_idx] > production_steps[frame_idx - 1])) {
      throw new Error(`Reference MD HDF5 ${production_steps_path} must increase strictly`)
    }
    if (!(times_ps[frame_idx] > times_ps[frame_idx - 1])) {
      throw new Error(`Reference MD HDF5 ${times_path} must increase strictly`)
    }
  }
  const n_frames = production_steps.length
  const initial_positions_dataset = required_dataset(h5_file, positions_path)
  ensure_shape(
    shape_of(initial_positions_dataset, positions_path),
    [replica_count, n_atoms, 3],
    positions_path,
  )
  const initial_positions = slice_values(initial_positions_dataset, positions_path, [
    [replica_idx, replica_idx + 1],
  ])
  const cells_dataset = required_dataset(h5_file, cells_path)
  ensure_shape(shape_of(cells_dataset, cells_path), [replica_count, 3, 3], cells_path)
  const selected_cell_values = slice_values(cells_dataset, cells_path, [
    [replica_idx, replica_idx + 1],
  ])
  if (selected_cell_values.length !== 9) {
    throw new Error(`Reference MD HDF5 dataset ${cells_path} must contain 9 selected values`)
  }
  const lattice_matrix = transpose_3x3_matrix(
    validate_3x3_matrix(
      Array.from({ length: 3 }, (_unused, row_idx) =>
        selected_cell_values.slice(row_idx * 3, row_idx * 3 + 3),
      ),
    ),
  )
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
  const signal_descriptors: Record<string, TrajectorySignalDescriptor> = Object.fromEntries(
    Object.entries(signal_manifest).map(([key, { sample_shape, unit }]) => [
      key,
      { sample_shape, sample_count: n_frames, ...(unit ? { unit } : {}) },
    ]),
  )
  const velocity_frames_per_slice = hdf5_frames_per_slice(velocity_sample_size)
  const read_replica_frames = (
    manifest: ObservableManifest,
    start: number,
    end: number,
    stride = 1,
  ): number[] =>
    slice_values(manifest.dataset, manifest.path, [
      [start, end, stride],
      [replica_idx, replica_idx + 1],
    ])
  const read_replica_samples = (manifest: ObservableManifest, stride = 1): Float64Array => {
    const sample_size = manifest.sample_shape.reduce((product, size) => product * size, 1)
    return read_numeric_samples(
      manifest.dataset,
      manifest.path,
      n_frames,
      sample_size,
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
  const CHECKPOINT_BUDGET_BYTES = 32 * 1024 * 1024
  const checkpoint_bytes = velocity_sample_size * Float64Array.BYTES_PER_ELEMENT
  const checkpoint_interval = reference_checkpoint_interval(
    n_frames,
    checkpoint_bytes,
    CHECKPOINT_BUDGET_BYTES,
  )
  const checkpoint_positions: Float64Array[] = []
  const integrated_positions = Float64Array.from(initial_positions)
  const previous_velocity = new Float64Array(velocity_sample_size)
  let have_previous_velocity = false
  for (let chunk_start = 0; chunk_start < n_frames; chunk_start += velocity_frames_per_slice) {
    const chunk_end = Math.min(chunk_start + velocity_frames_per_slice, n_frames)
    const chunk = read_replica_frames(velocity_manifest, chunk_start, chunk_end)
    for (let frame_idx = chunk_start; frame_idx < chunk_end; frame_idx++) {
      const offset = (frame_idx - chunk_start) * velocity_sample_size
      integrate_velocity_sample(
        integrated_positions,
        previous_velocity,
        chunk,
        offset,
        have_previous_velocity ? times_ps[frame_idx] - times_ps[frame_idx - 1] : undefined,
      )
      have_previous_velocity = true
      if (frame_idx % checkpoint_interval === 0) {
        checkpoint_positions.push(integrated_positions.slice())
      }
    }
  }
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
    if (checkpoint_frame === frame_number) return positions
    const replay_previous_velocity = new Float64Array(velocity_sample_size)
    let replay_has_previous = false
    for (
      let chunk_start = checkpoint_frame;
      chunk_start <= frame_number;
      chunk_start += velocity_frames_per_slice
    ) {
      const chunk_end = Math.min(chunk_start + velocity_frames_per_slice, frame_number + 1)
      const chunk = read_replica_frames(velocity_manifest, chunk_start, chunk_end)
      for (let frame_idx = chunk_start; frame_idx < chunk_end; frame_idx++) {
        const offset = (frame_idx - chunk_start) * velocity_sample_size
        integrate_velocity_sample(
          positions,
          replay_previous_velocity,
          chunk,
          offset,
          replay_has_previous ? times_ps[frame_idx] - times_ps[frame_idx - 1] : undefined,
        )
        replay_has_previous = true
      }
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
    volume,
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
    for (const [atom_idx, site] of frame.structure.sites.entries()) {
      site.properties = {
        ...site.properties,
        velocity: velocity.slice(atom_idx * 3, atom_idx * 3 + 3),
      }
    }
    return frame
  }
  const plot_metadata_for = (requested_stride = 1): TrajectoryMetadata[] => {
    const stride = Math.max(
      positive_integer_stride(requested_stride, `Reference MD sample_rate`),
      Math.ceil(n_frames / 1000),
    )
    const frame_indices = sampled_indices(n_frames, stride)
    const energy_values = energy ? read_replica_frames(energy, 0, n_frames, stride) : null
    const temperature_values = temperature
      ? read_replica_frames(temperature, 0, n_frames, stride)
      : null
    return frame_indices.map((frame_number, sample_idx) => ({
      frame_number,
      step: production_steps[frame_number],
      properties: {
        time_ps: times_ps[frame_number],
        volume,
        ...(energy_values ? { energy: energy_values[sample_idx] } : {}),
        ...(temperature_values ? { temperature: temperature_values[sample_idx] } : {}),
      },
    }))
  }
  const plot_metadata = plot_metadata_for()
  const trajectory_metadata = {
    source_format: `reference_md_hdf5`,
    frame_count: n_frames,
    num_atoms: n_atoms,
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
    periodic_boundary_conditions: pbc,
    element_counts: count_elements(elements),
    has_cell_info: true,
  }
  if (n_frames === 1) {
    const signals = Object.fromEntries(
      Object.entries(signal_manifest).map(([key, manifest]) => [
        key,
        {
          values: read_replica_samples(manifest),
          sample_shape: manifest.sample_shape,
          steps: [...production_steps],
          ...(manifest.unit ? { unit: manifest.unit } : {}),
        },
      ]),
    )
    return {
      frames: [load_frame(0)],
      time_step: integration_timestep_ps,
      time_unit: `ps`,
      atom_masses,
      signals,
      metadata: trajectory_metadata,
    }
  }
  let disposed = false
  const require_open = (): void => {
    if (disposed) throw new Error(`Reference MD HDF5 loader was disposed`)
  }
  const frame_loader: FrameLoader = {
    requires_source: false,
    dispose: () => {
      disposed = true
      checkpoint_positions.length = 0
    },
    get_total_frames: async () => n_frames,
    build_frame_index: async (_data, sample_rate) =>
      sampled_indices(
        n_frames,
        positive_integer_stride(sample_rate, `Reference MD sample_rate`),
      ).map((frame_number) => ({
        frame_number,
        byte_offset: frame_number * velocity_sample_size * Float64Array.BYTES_PER_ELEMENT,
        estimated_size: velocity_sample_size * Float64Array.BYTES_PER_ELEMENT,
      })),
    load_frame: async (_data, frame_number) => {
      require_open()
      return load_frame(frame_number)
    },
    extract_plot_metadata: async (_data, options) => {
      require_open()
      return plot_metadata_for(options?.sample_rate)
    },
    stream_positions: async (
      _data: string | ArrayBuffer,
      options: PositionStreamOptions = {},
    ): Promise<TrajectoryPositionStream> => {
      require_open()
      const frame_stride = positive_integer_stride(
        options.frame_stride,
        `Reference MD frame_stride`,
      )
      const scalar_keys = unique_strings(options.scalar_keys)
      const vector_keys = unique_strings(options.vector_keys)
      const signal_keys = unique_strings(options.signal_keys)
      const unknown_keys = [
        ...scalar_keys.filter(
          (key) =>
            (key !== `energy` && key !== `temperature`) ||
            (key === `energy` && !energy) ||
            (key === `temperature` && !temperature),
        ),
        ...vector_keys.filter((key) => key !== `velocity`),
        ...signal_keys.filter((key) => !signal_manifest[key]),
      ]
      if (unknown_keys.length > 0) {
        throw new Error(`Reference MD HDF5 has no channels named ${unknown_keys.join(`, `)}`)
      }
      const selected_frame_count = Math.ceil(n_frames / frame_stride)
      const selected_values = selected_frame_count * velocity_sample_size
      const signal_values = signal_keys.reduce(
        (total, key) =>
          total +
          n_frames *
            (signal_manifest[key].sample_shape.reduce((product, size) => product * size, 1) +
              1),
        0,
      )
      assert_hdf5_stream_budget(
        `Reference MD`,
        n_frames,
        selected_frame_count,
        velocity_sample_size * (1 + vector_keys.length) + scalar_keys.length + 10,
        signal_values,
        options.max_bytes ?? Number.POSITIVE_INFINITY,
      )
      const frame_indices = sampled_indices(n_frames, frame_stride)
      const positions = new Float64Array(selected_values)
      const selected_velocities = vector_keys.includes(`velocity`)
        ? new Float64Array(selected_values)
        : null
      const native_velocity = signal_keys.includes(`velocity`)
        ? new Float64Array(n_frames * velocity_sample_size)
        : null
      const stream_positions = Float64Array.from(initial_positions)
      const stream_previous_velocity = new Float64Array(velocity_sample_size)
      let stream_has_previous = false
      let selected_idx = 0
      for (
        let chunk_start = 0;
        chunk_start < n_frames;
        chunk_start += velocity_frames_per_slice
      ) {
        const chunk_end = Math.min(chunk_start + velocity_frames_per_slice, n_frames)
        const chunk = read_replica_frames(velocity_manifest, chunk_start, chunk_end)
        native_velocity?.set(chunk, chunk_start * velocity_sample_size)
        for (let frame_idx = chunk_start; frame_idx < chunk_end; frame_idx++) {
          const velocity_offset = (frame_idx - chunk_start) * velocity_sample_size
          integrate_velocity_sample(
            stream_positions,
            stream_previous_velocity,
            chunk,
            velocity_offset,
            stream_has_previous ? times_ps[frame_idx] - times_ps[frame_idx - 1] : undefined,
          )
          stream_has_previous = true
          if (frame_idx % frame_stride !== 0) continue
          positions.set(stream_positions, selected_idx * velocity_sample_size)
          selected_velocities?.set(
            chunk.slice(velocity_offset, velocity_offset + velocity_sample_size),
            selected_idx * velocity_sample_size,
          )
          selected_idx++
        }
      }
      const scalars = Object.fromEntries(
        scalar_keys.map((key) => {
          const manifest = key === `energy` ? energy : temperature
          if (!manifest) throw new Error(`Reference MD HDF5 has no scalar ${key}`)
          return [key, read_replica_samples(manifest, frame_stride)]
        }),
      )
      const signals = Object.fromEntries(
        signal_keys.map((key) => {
          const manifest = signal_manifest[key]
          const values =
            key === `velocity` && native_velocity
              ? native_velocity
              : read_replica_samples(manifest)
          return [
            key,
            {
              values,
              sample_shape: manifest.sample_shape,
              steps: [...production_steps],
              ...(manifest.unit ? { unit: manifest.unit } : {}),
            },
          ]
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
        ...(Object.keys(scalars).length > 0 ? { scalars } : {}),
        ...(selected_velocities ? { vectors: { velocity: selected_velocities } } : {}),
        ...(Object.keys(signals).length > 0 ? { signals } : {}),
      }
    },
  }
  const frames = Array.from(
    { length: Math.min(n_frames, PREVIEW_FRAME_COUNT) },
    (_unused, idx) => load_frame(idx),
  )
  return {
    frames,
    total_frames: n_frames,
    plot_metadata,
    is_indexed: true,
    frame_loader,
    time_step: integration_timestep_ps,
    time_unit: `ps`,
    atom_masses,
    signal_descriptors,
    metadata: trajectory_metadata,
  }
}
