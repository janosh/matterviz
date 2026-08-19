import { calc_lattice_params, transpose_3x3_matrix } from '$lib/math'
import type { Pbc } from '$lib/structure/pbc'
import {
  convert_atomic_numbers,
  count_elements,
  create_packed_frame_loader,
  validate_3x3_matrix,
} from '$lib/trajectory/helpers'
import type {
  TrajectoryFrameStore,
  TrajectoryMetadata,
  TrajectorySignal,
  TrajectoryType,
} from '$lib/trajectory/index'
import type { Dataset, Group } from 'h5wasm'
import type * as h5wasm from 'h5wasm'
import {
  Hdf5TrajectoryGroupSelectionError,
  attribute_value,
  is_hdf5_dataset,
  is_hdf5_group,
  string_value,
  to_number_array,
  to_scalar_number,
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

const numeric_values = (data: unknown, path: string): number[] => {
  const values = to_number_array(data)
  if (!values) throw new Error(`Reference MD HDF5 dataset ${path} must contain finite numbers`)
  return values
}

const values_of = (dataset: Dataset, path: string): number[] =>
  numeric_values(dataset.to_array(), path)

const slice_values = (
  dataset: Dataset,
  path: string,
  ranges: Parameters<Dataset[`slice`]>[0],
): number[] => numeric_values(dataset.slice(ranges), path)

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

const optional_observable = (
  h5_file: h5wasm.File,
  molecule_path: string,
  name: string,
  replica_idx: number,
  expected_shape: number[],
): number[] | undefined => {
  const path = `${molecule_path}/observables/${name}`
  const dataset = optional_dataset(h5_file, path)
  if (!dataset) return undefined
  ensure_shape(shape_of(dataset, path), expected_shape, path)
  const values = slice_values(dataset, path, [[], [replica_idx, replica_idx + 1]])
  const sample_size = expected_shape.slice(2).reduce((product, size) => product * size, 1)
  if (values.length !== expected_shape[0] * sample_size) {
    throw new Error(
      `Reference MD HDF5 dataset ${path} has ${values.length} selected values, expected ${expected_shape[0] * sample_size}`,
    )
  }
  return values
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
  const current_positions = slice_values(initial_positions_dataset, positions_path, [
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
  const velocity_values = slice_values(velocity_dataset, velocity_path, [
    [],
    [replica_idx, replica_idx + 1],
  ])
  const velocity_sample_size = n_atoms * 3
  if (velocity_values.length !== n_frames * velocity_sample_size) {
    throw new Error(
      `Reference MD HDF5 dataset ${velocity_path} has ${velocity_values.length} selected values, expected ${n_frames * velocity_sample_size}`,
    )
  }
  const observable = (name: string, sample_shape: number[]): number[] | undefined =>
    optional_observable(h5_file, molecule_path, name, replica_idx, [
      n_frames,
      replica_count,
      ...sample_shape,
    ])
  const dipole_values = observable(`total_dipole_e_angstrom`, [3])
  const energy_values = observable(`total_energy_ev`, [])
  const temperature_values = observable(`vibrational_temperature_kelvin`, [])
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
  const reconstructed_positions = new Float64Array(n_frames * velocity_sample_size)
  const frame_metadata: Record<string, unknown>[] = []
  const plot_metadata: TrajectoryMetadata[] = []
  for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
    if (frame_idx > 0) {
      const time_delta_ps = times_ps[frame_idx] - times_ps[frame_idx - 1]
      const previous_velocity_offset = (frame_idx - 1) * velocity_sample_size
      const velocity_offset = frame_idx * velocity_sample_size
      for (let coordinate_idx = 0; coordinate_idx < velocity_sample_size; coordinate_idx++) {
        current_positions[coordinate_idx] +=
          (time_delta_ps *
            (velocity_values[previous_velocity_offset + coordinate_idx] +
              velocity_values[velocity_offset + coordinate_idx])) /
          2
      }
    }
    const metadata: Record<string, number> = { time_ps: times_ps[frame_idx], volume }
    if (energy_values) metadata.energy = energy_values[frame_idx]
    if (temperature_values) metadata.temperature = temperature_values[frame_idx]
    reconstructed_positions.set(current_positions, frame_idx * velocity_sample_size)
    frame_metadata.push(metadata)
    plot_metadata.push({
      frame_number: frame_idx,
      step: production_steps[frame_idx],
      properties: { ...metadata },
    })
  }
  const signals: Record<string, TrajectorySignal> = {
    velocity: {
      values: Float64Array.from(velocity_values),
      sample_shape: [n_atoms, 3],
      steps: production_steps,
      unit: `A/ps`,
    },
  }
  if (dipole_values) {
    signals.dipole = {
      values: Float64Array.from(dipole_values),
      sample_shape: [3],
      steps: production_steps,
      unit: `e*A`,
    }
  }
  const frame_store: TrajectoryFrameStore = {
    positions: reconstructed_positions,
    elements,
    lattice_matrix,
    pbc,
    coords_unwrapped: true,
    steps: production_steps,
    metadata: frame_metadata,
    plot_metadata,
    vectors: { velocity: signals.velocity.values },
    signals,
  }
  const frame_loader = create_packed_frame_loader(frame_store)
  const load_frame_sync = frame_loader.load_frame_sync
  if (!load_frame_sync)
    throw new Error(`Reference MD packed loader must support synchronous frames`)
  const frames = Array.from(
    { length: Math.min(n_frames, PREVIEW_FRAME_COUNT) },
    (_unused, frame_idx) => {
      const frame = load_frame_sync(frame_idx)
      if (!frame) {
        throw new Error(`Reference MD packed loader could not reconstruct frame ${frame_idx}`)
      }
      return frame
    },
  )
  return {
    frames,
    total_frames: n_frames,
    plot_metadata,
    is_indexed: frames.length < n_frames,
    ...(frames.length < n_frames ? { frame_loader, frame_store } : {}),
    time_step: integration_timestep_ps,
    time_unit: `ps`,
    atom_masses,
    signals,
    metadata: {
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
      periodic_boundary_conditions: pbc,
      element_counts: count_elements(elements),
      has_cell_info: true,
    },
  }
}
