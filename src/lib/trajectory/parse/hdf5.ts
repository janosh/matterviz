import { calc_lattice_params, transpose_3x3_matrix, type Matrix3x3 } from '$lib/math'
import type { Pbc } from '$lib/structure/pbc'
import type { Dataset, Group } from 'h5wasm'
import type * as h5wasm from 'h5wasm'
import {
  convert_atomic_numbers,
  count_elements,
  create_trajectory_frame,
  is_supported_trajectory_signal_shape,
  validate_3x3_matrix,
} from '$lib/trajectory/helpers'
import type {
  FrameLoader,
  PositionStreamOptions,
  TrajectoryMetadata,
  TrajectoryPositionStream,
  TrajectorySignal,
  TrajectorySignalDescriptor,
  TrajectoryType,
} from '$lib/trajectory/index'
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
  to_scalar_number,
  open_h5_source,
  unique_strings,
} from './h5-utils'
import { is_reference_md_h5_file, parse_reference_md_h5_file } from './reference-md-h5'
import { is_vaspout_h5_file, parse_vaspout_h5_file } from './vaspout-h5'

export { Hdf5TrajectoryGroupSelectionError } from './h5-utils'

export const parse_hdf5_trajectory = async (
  source: ArrayBuffer | Blob,
  filename?: string,
  hdf5_group_path?: string,
): Promise<TrajectoryType> => {
  const opened = await open_h5_source(source, filename)
  let loader_owns_h5_file = false
  try {
    const result = is_vaspout_h5_file(opened.h5_file)
      ? parse_vaspout_h5_file(opened.h5_file)
      : is_reference_md_h5_file(opened.h5_file)
        ? parse_reference_md_h5_file(opened.h5_file, hdf5_group_path)
        : parse_torch_sim_h5_file(opened.h5_file, hdf5_group_path)
    const { frame_loader } = result
    if (frame_loader?.requires_source === false) {
      const dispose_loader = frame_loader.dispose
      frame_loader.dispose = () => {
        try {
          dispose_loader?.()
        } finally {
          opened.close()
        }
      }
      loader_owns_h5_file = true
    }
    return result
  } finally {
    if (!loader_owns_h5_file) opened.close()
  }
}

const POSITION_ALIASES = [`positions`, `coords`, `coordinates`]
const ATOMIC_NUMBER_ALIASES = [`atomic_numbers`, `numbers`, `Z`, `species`]
const CELL_ALIASES = [`cell`, `cells`, `lattice`]
const ENERGY_ALIASES = [`potential_energy`, `energy`]
const PBC_ALIASES = [`pbc`, `periodic_boundary_conditions`]
const STRUCTURAL_ALIASES = new Set([
  ...POSITION_ALIASES,
  ...ATOMIC_NUMBER_ALIASES,
  ...CELL_ALIASES,
  ...ENERGY_ALIASES,
  ...PBC_ALIASES,
])
const MASS_ALIASES = new Set([`masses`, `mass`, `atomic_masses`])
const SIGNAL_ALIASES: Record<string, string> = {
  velocities: `velocity`,
  velocity: `velocity`,
  dipoles: `dipole`,
  dipole_moment: `dipole`,
  dipole: `dipole`,
  polarizations: `polarization`,
  polarization: `polarization`,
  currents: `current`,
  current: `current`,
  polarizabilities: `polarizability`,
  polarizability: `polarizability`,
}
const PACKED_PREVIEW_FRAME_COUNT = 10

const torch_sim_context = (inherited_attribute: (names: string[]) => unknown) => {
  const dt_fs = to_scalar_number(inherited_attribute([`dt_fs`]))
  const time_step =
    to_scalar_number(inherited_attribute([`time_step`, `timestep`, `dt`])) ?? dt_fs
  const time_unit =
    string_value(inherited_attribute([`time_unit`, `time_units`])) ??
    (dt_fs != null ? `fs` : undefined)
  return {
    timing: time_step != null && time_unit ? { time_step, time_unit } : {},
    source_metadata: Object.fromEntries(
      [
        [
          `temperature`,
          to_scalar_number(inherited_attribute([`temperature`, `temperature_kelvin`])),
        ],
        [`ensemble`, string_value(inherited_attribute([`ensemble`]))],
        [`model`, string_value(inherited_attribute([`model`, `model_name`]))],
        [`head`, string_value(inherited_attribute([`head`, `model_head`]))],
        [`theory`, string_value(inherited_attribute([`theory`, `level_of_theory`]))],
        [`thermostat`, string_value(inherited_attribute([`thermostat`]))],
        [`random_seed`, to_scalar_number(inherited_attribute([`random_seed`, `seed`]))],
      ].filter((entry): entry is [string, string | number] => entry[1] != null),
    ),
  }
}

const flatten_numeric = (value: unknown): number[] | null => {
  if (typeof value === `number`) return Number.isFinite(value) ? [value] : null
  if (typeof value === `bigint`) {
    const number = Number(value)
    return Number.isSafeInteger(number) ? [number] : null
  }
  if (ArrayBuffer.isView(value)) {
    const values = Array.from(value as unknown as ArrayLike<number | bigint>, (entry) => {
      if (typeof entry !== `bigint`) return entry
      const number = Number(entry)
      return Number.isSafeInteger(number) ? number : Number.NaN
    })
    return values.every(Number.isFinite) ? values : null
  }
  if (!Array.isArray(value)) return null
  const flattened: number[] = []
  for (const entry of value) {
    const child = flatten_numeric(entry)
    if (!child) return null
    flattened.push(...child)
  }
  return flattened
}

const product = (values: number[]): number => values.reduce((total, value) => total * value, 1)

const lattice_from_values = (values: number[]): Matrix3x3 =>
  transpose_3x3_matrix(
    validate_3x3_matrix(
      Array.from({ length: 3 }, (_unused, row_idx) =>
        values.slice(row_idx * 3, row_idx * 3 + 3),
      ),
    ),
  )

const parent_path = (path: string): string => path.slice(0, path.lastIndexOf(`/`))

const validate_steps = (steps: number[], path: string): void => {
  if (!steps.every(Number.isSafeInteger)) {
    throw new Error(`TorchSim HDF5 steps ${path} must contain safe integers`)
  }
  for (let step_idx = 1; step_idx < steps.length; step_idx++) {
    if (!(steps[step_idx] > steps[step_idx - 1])) {
      throw new Error(
        `TorchSim HDF5 steps ${path} must increase strictly; entries ` +
          `${step_idx - 1} and ${step_idx} are ${steps[step_idx - 1]} and ${steps[step_idx]}`,
      )
    }
  }
}

type TorchSimSignalManifest = {
  dataset: Dataset
  path: string
  steps: number[]
  sample_shape: number[]
  unit?: string
}

type TorchSimSignalDiscovery = {
  signal_manifest: Record<string, TorchSimSignalManifest>
  atom_masses?: number[]
  mass_path?: string
  signal_paths: Record<string, string>
}

const discover_torch_sim_signals = (
  h5_file: h5wasm.File,
  n_atoms: number,
  excluded_paths: Set<string>,
  data_group_path: string,
  steps_group_path: string,
  geometry_counts: { total: number; valid: number },
): TorchSimSignalDiscovery => {
  const data_group = h5_file.get(data_group_path)
  const steps_group = h5_file.get(steps_group_path)
  if (!is_hdf5_group(data_group)) return { signal_manifest: {}, signal_paths: {} }
  const signal_manifest: Record<string, TorchSimSignalManifest> = {}
  const signal_paths: Record<string, string> = {}
  let atom_masses: number[] | undefined
  let mass_path: string | undefined

  for (const name of data_group.keys()) {
    const dataset = data_group.get(name)
    const path = `${data_group_path}/${name}`
    if (!is_hdf5_dataset(dataset) || excluded_paths.has(path)) continue
    const steps_dataset = is_hdf5_group(steps_group) ? steps_group.get(name) : null
    const known_signal = name in SIGNAL_ALIASES
    if (!MASS_ALIASES.has(name) && !known_signal && !is_hdf5_dataset(steps_dataset)) {
      continue
    }
    const shape = dataset_shape(dataset, path)

    if (MASS_ALIASES.has(name)) {
      const valid_shape =
        (shape.length === 1 && shape[0] === n_atoms) ||
        (shape.length === 2 && shape[0] === 1 && shape[1] === n_atoms)
      const mass_values = valid_shape ? read_numeric_hyperslab(dataset, path, [[]]) : null
      if (!mass_values || mass_values.some((mass) => !Number.isFinite(mass) || mass <= 0)) {
        throw new Error(
          `TorchSim HDF5 masses ${path} must contain ${n_atoms} finite positive values`,
        )
      }
      atom_masses = mass_values
      mass_path = path
      continue
    }

    if (!is_hdf5_dataset(steps_dataset)) {
      if (known_signal) {
        throw new Error(`TorchSim HDF5 signal ${path} is missing ${steps_group_path}/${name}`)
      }
      continue
    }
    const step_path = `${steps_group_path}/${name}`
    let steps_raw = read_numeric_1d(steps_dataset, step_path, shape[0])
    if (
      geometry_counts.valid < geometry_counts.total &&
      steps_raw.length === geometry_counts.total &&
      steps_raw.slice(geometry_counts.valid).every((step) => step === 0)
    ) {
      steps_raw = steps_raw.slice(0, geometry_counts.valid)
    }
    validate_steps(steps_raw, step_path)
    const raw_sample_shape = shape.slice(1)
    const sample_shape =
      raw_sample_shape.length === 1 && raw_sample_shape[0] === 1 ? [] : raw_sample_shape
    if (!is_supported_trajectory_signal_shape(sample_shape, n_atoms)) {
      throw new Error(
        `TorchSim HDF5 signal ${path} has unsupported sample shape ` +
          `[${sample_shape.join(`, `)}]; expected scalar, [3], [3, 3], ` +
          `[${n_atoms}], or [${n_atoms}, 3]`,
      )
    }
    const key = SIGNAL_ALIASES[name] ?? name
    if (signal_manifest[key]) {
      throw new Error(
        `TorchSim HDF5 datasets ${signal_paths[key]} and ${path} both map to signal "${key}"`,
      )
    }
    const unit = string_value(attribute_value(dataset, [`unit`, `units`]))
    signal_manifest[key] = {
      dataset,
      path,
      sample_shape,
      steps: steps_raw,
      ...(unit ? { unit } : {}),
    }
    signal_paths[key] = path
  }
  return { signal_manifest, atom_masses, mass_path, signal_paths }
}

const read_torch_sim_signal = ({
  dataset,
  path,
  steps,
  sample_shape,
  unit,
}: TorchSimSignalManifest): TrajectorySignal => ({
  values: read_numeric_samples(dataset, path, steps.length, product(sample_shape)),
  sample_shape,
  steps: [...steps],
  ...(unit ? { unit } : {}),
})

type TorchSimConfig = {
  structural_parent: string
  position_path?: string
  atomic_number_path?: string
  cell_path?: string
  energy_path?: string
  pbc_path?: string
  inherited_attribute: (names: string[]) => unknown
  total_groups_found: number
}

const dataset_at = (h5_file: h5wasm.File, path: string | undefined): Dataset | null => {
  if (!path) return null
  const entity = h5_file.get(path)
  return is_hdf5_dataset(entity) ? entity : null
}

const dataset_shape = (dataset: Dataset, path: string): number[] => {
  const shape = dataset.shape ?? []
  if (shape.length === 0 || shape.some((size) => !Number.isInteger(size) || size < 1)) {
    throw new Error(`TorchSim HDF5 dataset ${path} has invalid shape [${shape.join(`, `)}]`)
  }
  return shape
}

const read_numeric_1d = (dataset: Dataset, path: string, count: number): number[] => {
  const shape = dataset_shape(dataset, path)
  if (shape.length !== 1 || shape[0] !== count) {
    throw new Error(
      `TorchSim HDF5 steps ${path} have shape [${shape.join(`, `)}], expected [${count}]`,
    )
  }
  return read_numeric_first_axis(dataset, path, count, 1, `TorchSim HDF5 steps`)
}

const parse_torch_sim_datasets = (
  h5_file: h5wasm.File,
  config: TorchSimConfig,
): TrajectoryType => {
  const {
    structural_parent,
    position_path,
    atomic_number_path,
    cell_path,
    energy_path,
    pbc_path,
    inherited_attribute,
    total_groups_found,
  } = config
  const positions_dataset = dataset_at(h5_file, position_path)
  const atomic_numbers_dataset = dataset_at(h5_file, atomic_number_path)
  if (!positions_dataset || !atomic_numbers_dataset || !position_path || !atomic_number_path) {
    const missing = [
      !positions_dataset ? `positions (${POSITION_ALIASES.join(`/`)})` : null,
      !atomic_numbers_dataset ? `atomic numbers (${ATOMIC_NUMBER_ALIASES.join(`/`)})` : null,
    ].filter((name): name is string => name !== null)
    throw new Error(
      `Missing required dataset(s) in TorchSim HDF5 group ${structural_parent || `/`}: ${missing.join(`, `)}`,
    )
  }
  const position_shape = dataset_shape(positions_dataset, position_path)
  const positions_have_frame_axis = position_shape.length === 3 && position_shape[2] === 3
  const positions_are_single_frame = position_shape.length === 2 && position_shape[1] === 3
  if (!positions_have_frame_axis && !positions_are_single_frame) {
    throw new Error(
      `HDF5 positions have shape [${position_shape.join(`, `)}]; expected [n_atoms, 3] or [n_frames, n_atoms, 3]`,
    )
  }
  const n_frames = positions_have_frame_axis ? position_shape[0] : 1
  const n_atoms = positions_have_frame_axis ? position_shape[1] : position_shape[0]
  const position_values_per_frame = n_atoms * 3
  const is_per_atom_vector = ({ sample_shape }: TorchSimSignalManifest): boolean =>
    sample_shape.length === 2 && sample_shape[0] === n_atoms && sample_shape[1] === 3
  const atomic_number_shape = dataset_shape(atomic_numbers_dataset, atomic_number_path)
  const dynamic_atomic_numbers =
    atomic_number_shape.length === 2 &&
    n_frames > 1 &&
    atomic_number_shape[0] === n_frames &&
    atomic_number_shape[1] === n_atoms
  const static_atomic_numbers_with_frame_axis =
    atomic_number_shape.length === 2 &&
    atomic_number_shape[0] === 1 &&
    atomic_number_shape[1] === n_atoms
  if (
    !dynamic_atomic_numbers &&
    !static_atomic_numbers_with_frame_axis &&
    (atomic_number_shape.length !== 1 || atomic_number_shape[0] !== n_atoms)
  ) {
    throw new Error(
      `HDF5 atomic numbers have shape [${atomic_number_shape.join(`, `)}]; expected ` +
        `[${n_atoms}], [1, ${n_atoms}], or [${n_frames}, ${n_atoms}]`,
    )
  }
  const static_atomic_numbers = dynamic_atomic_numbers
    ? null
    : read_numeric_hyperslab(atomic_numbers_dataset, atomic_number_path, [[]])
  const first_atomic_numbers =
    static_atomic_numbers ??
    read_numeric_hyperslab(atomic_numbers_dataset, atomic_number_path, [[0, 1]])
  const elements = convert_atomic_numbers(first_atomic_numbers)
  const cells_dataset = dataset_at(h5_file, cell_path)
  const cell_shape =
    cells_dataset && cell_path ? dataset_shape(cells_dataset, cell_path) : null
  const dynamic_cells =
    cell_shape?.length === 3 &&
    n_frames > 1 &&
    cell_shape[0] === n_frames &&
    cell_shape[1] === 3 &&
    cell_shape[2] === 3
  const static_cell_with_frame_axis =
    cell_shape?.length === 3 &&
    cell_shape[0] === 1 &&
    cell_shape[1] === 3 &&
    cell_shape[2] === 3
  if (
    cell_shape &&
    !dynamic_cells &&
    !static_cell_with_frame_axis &&
    (cell_shape.length !== 2 || cell_shape[0] !== 3 || cell_shape[1] !== 3)
  ) {
    throw new Error(
      `HDF5 cells have shape [${cell_shape.join(`, `)}]; expected [3, 3], [1, 3, 3], or ` +
        `[${n_frames}, 3, 3]`,
    )
  }
  const static_lattice =
    cells_dataset && cell_path && !dynamic_cells
      ? lattice_from_values(
          read_numeric_hyperslab(
            cells_dataset,
            cell_path,
            static_cell_with_frame_axis ? [[0, 1]] : [[]],
          ),
        )
      : undefined
  if (static_lattice && !(calc_lattice_params(static_lattice).volume > 0)) {
    throw new Error(`HDF5 static cell volume must be positive`)
  }
  const data_group_path = structural_parent.endsWith(`/data`) ? structural_parent : undefined
  const steps_group_path = data_group_path ? `${parent_path(data_group_path)}/steps` : `/steps`
  const position_name = position_path.split(`/`).at(-1) ?? `positions`
  const position_steps_dataset = dataset_at(h5_file, `${steps_group_path}/${position_name}`)
  const steps = position_steps_dataset
    ? read_numeric_1d(position_steps_dataset, `${steps_group_path}/${position_name}`, n_frames)
    : Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx)
  const pbc_dataset = dataset_at(h5_file, pbc_path)
  const pbc_shape = pbc_dataset && pbc_path ? dataset_shape(pbc_dataset, pbc_path) : null
  const pbc_sample_size = pbc_shape ? product(pbc_shape.slice(1)) : 0
  const pbc_values =
    pbc_dataset && pbc_path && pbc_shape
      ? Array.from(
          read_numeric_samples(pbc_dataset, pbc_path, pbc_shape[0], pbc_sample_size, 1),
        )
      : flatten_numeric(inherited_attribute(PBC_ALIASES))
  if (pbc_values?.some((value) => value !== 0 && value !== 1)) {
    const source = pbc_dataset ? `dataset ${pbc_path}` : `attribute ${PBC_ALIASES.join(`/`)}`
    throw new Error(`HDF5 PBC ${source} must contain only 0/1 values`)
  }
  const static_pbc: Pbc | null =
    pbc_values?.length === 1
      ? [Boolean(pbc_values[0]), Boolean(pbc_values[0]), Boolean(pbc_values[0])]
      : pbc_values?.length === 3
        ? [Boolean(pbc_values[0]), Boolean(pbc_values[1]), Boolean(pbc_values[2])]
        : pbc_values
          ? null
          : static_lattice || dynamic_cells
            ? [true, true, true]
            : [false, false, false]
  if (pbc_values && !static_pbc && pbc_values.length !== n_frames * 3) {
    throw new Error(
      `HDF5 PBC has ${pbc_values.length} values; expected 1, 3, or ${n_frames * 3}`,
    )
  }
  const pbc_for_frame = (frame_idx: number): Pbc =>
    static_pbc ?? [
      Boolean(pbc_values?.[frame_idx * 3]),
      Boolean(pbc_values?.[frame_idx * 3 + 1]),
      Boolean(pbc_values?.[frame_idx * 3 + 2]),
    ]
  const read_positions = (start: number, end: number): number[] =>
    read_numeric_hyperslab(
      positions_dataset,
      position_path,
      positions_have_frame_axis ? [[start, end, 1]] : [[]],
    )
  const read_atomic_numbers = (start: number, end: number): number[] =>
    static_atomic_numbers ??
    read_numeric_hyperslab(atomic_numbers_dataset, atomic_number_path, [[start, end, 1]])
  const read_cells = (start: number, end: number): number[] | null =>
    cells_dataset && cell_path && dynamic_cells
      ? read_numeric_hyperslab(cells_dataset, cell_path, [[start, end, 1]])
      : null
  const is_zero_tail_frame = (
    frame_positions: number[],
    frame_atomic_numbers: number[],
    frame_cells: number[] | undefined,
  ): boolean =>
    frame_positions.every((value) => value === 0) &&
    (!dynamic_atomic_numbers || frame_atomic_numbers.every((value) => value === 0)) &&
    (!dynamic_cells || frame_cells?.every((value) => value === 0) === true)
  const position_chunk_size = hdf5_frames_per_slice(
    position_values_per_frame,
    ...(dynamic_atomic_numbers ? [n_atoms] : []),
    ...(dynamic_cells ? [9] : []),
  )
  let valid_frame_count = 0
  let invalid_frame_idx: number | null = null
  let invalid_reason = ``
  let tail_is_zero = true
  for (let start = 0; start < n_frames; start += position_chunk_size) {
    const end = Math.min(start + position_chunk_size, n_frames)
    const position_chunk = read_positions(start, end)
    const atomic_chunk = dynamic_atomic_numbers ? read_atomic_numbers(start, end) : null
    const cell_chunk = dynamic_cells ? read_cells(start, end) : null
    for (let frame_idx = start; frame_idx < end; frame_idx++) {
      const local_idx = frame_idx - start
      const frame_positions = position_chunk.slice(
        local_idx * position_values_per_frame,
        (local_idx + 1) * position_values_per_frame,
      )
      const frame_atomic_numbers = atomic_chunk
        ? atomic_chunk.slice(local_idx * n_atoms, (local_idx + 1) * n_atoms)
        : first_atomic_numbers
      const frame_cells = cell_chunk?.slice(local_idx * 9, (local_idx + 1) * 9)
      if (invalid_frame_idx !== null) {
        tail_is_zero &&= is_zero_tail_frame(frame_positions, frame_atomic_numbers, frame_cells)
        continue
      }
      try {
        const frame_elements = convert_atomic_numbers(frame_atomic_numbers)
        if (frame_elements.some((element, atom_idx) => element !== elements[atom_idx])) {
          throw new Error(`frame changes atom ordering`)
        }
        if (frame_cells) {
          const matrix = lattice_from_values(frame_cells)
          if (!(calc_lattice_params(matrix).volume > 0)) throw new Error(`cell volume is zero`)
        }
        valid_frame_count++
      } catch (error) {
        invalid_frame_idx = frame_idx
        invalid_reason = error instanceof Error ? error.message : String(error)
        tail_is_zero = is_zero_tail_frame(frame_positions, frame_atomic_numbers, frame_cells)
      }
    }
  }
  if (invalid_frame_idx !== null && (valid_frame_count === 0 || !tail_is_zero)) {
    throw new Error(
      `Invalid HDF5 trajectory frame ${invalid_frame_idx} from ${position_path}: ${invalid_reason}`,
    )
  }
  const dropped_steps = n_frames - valid_frame_count
  const retained_steps = steps.slice(0, valid_frame_count)
  validate_steps(retained_steps, `${steps_group_path}/${position_name}`)
  if (
    position_steps_dataset &&
    dropped_steps > 0 &&
    steps.slice(valid_frame_count).some((step) => step !== 0)
  ) {
    throw new Error(
      `TorchSim HDF5 torn tail in ${steps_group_path}/${position_name} must be zero-filled`,
    )
  }
  const last_geometry_step = steps[valid_frame_count - 1]
  const streamed_pbc =
    static_pbc ??
    (pbc_values?.every(
      (value, value_idx) =>
        value_idx >= valid_frame_count * 3 || value === pbc_values[value_idx % 3],
    )
      ? pbc_for_frame(0)
      : null)
  const candidate_energy_dataset = dataset_at(h5_file, energy_path)
  const candidate_energy_shape =
    candidate_energy_dataset && energy_path
      ? dataset_shape(candidate_energy_dataset, energy_path)
      : null
  const energy_name = energy_path?.split(`/`).at(-1)
  const energy_step_path = energy_name ? `${steps_group_path}/${energy_name}` : undefined
  const energy_steps_dataset = dataset_at(h5_file, energy_step_path)
  let energy_steps =
    energy_steps_dataset && energy_step_path && candidate_energy_shape
      ? read_numeric_1d(energy_steps_dataset, energy_step_path, candidate_energy_shape[0])
      : null
  if (
    energy_steps &&
    dropped_steps > 0 &&
    energy_steps.length === n_frames &&
    energy_steps.slice(valid_frame_count).every((step) => step === 0)
  ) {
    energy_steps = energy_steps.slice(0, valid_frame_count)
  }
  if (energy_steps && energy_step_path) validate_steps(energy_steps, energy_step_path)
  const energy_is_frame_aligned =
    candidate_energy_shape !== null &&
    product(candidate_energy_shape.slice(1)) === 1 &&
    candidate_energy_shape[0] === n_frames &&
    (!energy_steps ||
      (energy_steps.length === valid_frame_count &&
        energy_steps.every((step, frame_idx) => step === retained_steps[frame_idx])))
  const excluded_paths = new Set(
    [
      position_path,
      atomic_number_path,
      cell_path,
      energy_is_frame_aligned ? energy_path : undefined,
      pbc_path,
    ].filter((path): path is string => Boolean(path)),
  )
  const discovered_signals = data_group_path
    ? discover_torch_sim_signals(
        h5_file,
        n_atoms,
        excluded_paths,
        data_group_path,
        steps_group_path,
        { total: n_frames, valid: valid_frame_count },
      )
    : { signal_manifest: {}, signal_paths: {} }
  const { atom_masses, mass_path, signal_paths } = discovered_signals
  const signal_manifest = Object.fromEntries(
    Object.entries(discovered_signals.signal_manifest).map(([key, signal]) => {
      if (dropped_steps === 0) return [key, signal]
      const retained_count =
        signal.steps.findLastIndex((step) => step <= last_geometry_step) + 1
      if (retained_count < 1) {
        throw new Error(
          `TorchSim HDF5 signal ${signal.path} has no samples before the surviving geometry ends at step ${last_geometry_step}`,
        )
      }
      return [key, { ...signal, steps: signal.steps.slice(0, retained_count) }]
    }),
  )
  const energy_dataset = energy_is_frame_aligned ? candidate_energy_dataset : null
  const lattice_for_frame = (frame_idx: number): Matrix3x3 | undefined => {
    if (static_lattice) return static_lattice
    const values = read_cells(frame_idx, frame_idx + 1)
    return values ? lattice_from_values(values) : undefined
  }
  const load_frame = (frame_idx: number) => {
    if (!Number.isInteger(frame_idx) || frame_idx < 0 || frame_idx >= valid_frame_count) {
      throw new Error(
        `TorchSim HDF5 frame ${frame_idx} is outside 0..${valid_frame_count - 1}`,
      )
    }
    const values = read_positions(frame_idx, frame_idx + 1)
    const lattice = lattice_for_frame(frame_idx)
    const energy =
      energy_dataset && energy_path
        ? read_numeric_hyperslab(energy_dataset, energy_path, [[frame_idx, frame_idx + 1]])[0]
        : undefined
    const frame = create_trajectory_frame(
      Array.from({ length: n_atoms }, (_unused, atom_idx) =>
        values.slice(atom_idx * 3, atom_idx * 3 + 3),
      ),
      elements,
      lattice,
      pbc_for_frame(frame_idx),
      steps[frame_idx],
      {
        ...(energy !== undefined ? { energy } : {}),
        ...(lattice ? { volume: calc_lattice_params(lattice).volume } : {}),
      },
    )
    for (const [key, signal] of Object.entries(signal_manifest)) {
      const signal_idx = signal.steps.indexOf(steps[frame_idx])
      if (!is_per_atom_vector(signal) || signal_idx === -1) continue
      const signal_values = read_numeric_hyperslab(signal.dataset, signal.path, [
        [signal_idx, signal_idx + 1],
      ])
      for (const [atom_idx, site] of frame.structure.sites.entries()) {
        site.properties = {
          ...site.properties,
          [key]: signal_values.slice(atom_idx * 3, atom_idx * 3 + 3),
        }
      }
    }
    return frame
  }
  const plot_metadata_for = (requested_stride = 1): TrajectoryMetadata[] => {
    const stride = Math.max(
      positive_integer_stride(requested_stride, `TorchSim HDF5 sample_rate`),
      Math.ceil(valid_frame_count / 1000),
    )
    const frame_indices = sampled_indices(valid_frame_count, stride)
    const sampled_energy =
      energy_dataset && energy_path
        ? read_numeric_samples(energy_dataset, energy_path, valid_frame_count, 1, stride)
        : null
    const sampled_cells =
      cells_dataset && cell_path && dynamic_cells
        ? read_numeric_samples(cells_dataset, cell_path, valid_frame_count, 9, stride)
        : null
    return frame_indices.map((frame_number, sample_idx) => {
      const lattice = sampled_cells
        ? lattice_from_values(
            Array.from(sampled_cells.subarray(sample_idx * 9, (sample_idx + 1) * 9)),
          )
        : static_lattice
      return {
        frame_number,
        step: steps[frame_number],
        properties: {
          ...(sampled_energy ? { energy: sampled_energy[sample_idx] } : {}),
          ...(lattice ? { volume: calc_lattice_params(lattice).volume } : {}),
        },
      }
    })
  }
  const frames = Array.from(
    { length: Math.min(valid_frame_count, PACKED_PREVIEW_FRAME_COUNT) },
    (_unused, frame_idx) => load_frame(frame_idx),
  )
  const { timing, source_metadata } = torch_sim_context(inherited_attribute)
  const result: TrajectoryType = {
    frames,
    ...timing,
    ...(atom_masses ? { atom_masses } : {}),
    metadata: {
      source_format: `hdf5_trajectory`,
      frame_count: valid_frame_count,
      num_atoms: n_atoms,
      periodic_boundary_conditions: pbc_for_frame(0),
      element_counts: count_elements(elements),
      discovered_datasets: {
        positions: position_path,
        atomic_numbers: atomic_number_path,
        cells: cell_path,
        energies: energy_path,
        pbc: pbc_path,
        masses: mass_path,
        signals: signal_paths,
      },
      total_groups_found,
      has_cell_info: Boolean(cells_dataset),
      ...source_metadata,
      ...(dropped_steps > 0 ? { dropped_steps } : {}),
    },
  }
  if (valid_frame_count === 1) {
    const signals: Record<string, TrajectorySignal> = Object.fromEntries(
      Object.entries(signal_manifest).map(([key, signal]) => [
        key,
        read_torch_sim_signal(signal),
      ]),
    )
    return {
      ...result,
      ...(Object.keys(signals).length > 0 ? { signals } : {}),
    }
  }
  const plot_metadata = plot_metadata_for()
  const signal_descriptors: Record<string, TrajectorySignalDescriptor> = Object.fromEntries(
    Object.entries(signal_manifest).map(([key, signal]) => [
      key,
      {
        sample_shape: signal.sample_shape,
        sample_count: signal.steps.length,
        ...(signal.unit ? { unit: signal.unit } : {}),
      },
    ]),
  )
  let disposed = false
  const frame_loader: FrameLoader = {
    requires_source: false,
    dispose: () => {
      disposed = true
    },
    get_total_frames: async () => valid_frame_count,
    build_frame_index: async (_data, sample_rate) =>
      sampled_indices(
        valid_frame_count,
        positive_integer_stride(sample_rate, `TorchSim HDF5 sample_rate`),
      ).map((frame_number) => ({
        frame_number,
        byte_offset: frame_number * position_values_per_frame * Float64Array.BYTES_PER_ELEMENT,
        estimated_size: position_values_per_frame * Float64Array.BYTES_PER_ELEMENT,
      })),
    load_frame: async (_data, frame_number) => {
      if (disposed) throw new Error(`TorchSim HDF5 loader was disposed`)
      return load_frame(frame_number)
    },
    extract_plot_metadata: async (_data, options) => {
      if (disposed) throw new Error(`TorchSim HDF5 loader was disposed`)
      return plot_metadata_for(options?.sample_rate)
    },
    stream_positions: async (
      _data: string | ArrayBuffer,
      options: PositionStreamOptions = {},
    ): Promise<TrajectoryPositionStream> => {
      if (disposed) throw new Error(`TorchSim HDF5 loader was disposed`)
      const frame_stride = positive_integer_stride(
        options.frame_stride,
        `TorchSim HDF5 frame_stride`,
      )
      if (!streamed_pbc) {
        throw new Error(
          `TorchSim HDF5 analysis does not support PBC flags that vary between frames`,
        )
      }
      const vector_keys = unique_strings(options.vector_keys)
      const signal_keys = unique_strings(options.signal_keys)
      const scalar_keys = unique_strings(options.scalar_keys)
      const unknown_keys = [
        ...vector_keys.filter((key) => !signal_manifest[key]),
        ...signal_keys.filter((key) => !signal_manifest[key]),
        ...scalar_keys.filter((key) => key !== `energy` || !energy_dataset),
      ]
      if (unknown_keys.length > 0) {
        throw new Error(`TorchSim HDF5 has no channels named ${unknown_keys.join(`, `)}`)
      }
      for (const key of vector_keys) {
        const signal = signal_manifest[key]
        if (!is_per_atom_vector(signal)) {
          throw new Error(
            `TorchSim HDF5 vector ${key} has sample shape [${signal.sample_shape.join(`, `)}], expected [${n_atoms}, 3]`,
          )
        }
      }
      const selected_frame_count = Math.ceil(valid_frame_count / frame_stride)
      const signal_value_count = signal_keys.reduce(
        (total, key) =>
          total +
          signal_manifest[key].steps.length * (product(signal_manifest[key].sample_shape) + 1),
        0,
      )
      assert_hdf5_stream_budget(
        `TorchSim HDF5`,
        valid_frame_count,
        selected_frame_count,
        position_values_per_frame * (1 + vector_keys.length) +
          scalar_keys.length +
          1 +
          (static_lattice || dynamic_cells ? 9 : 0),
        signal_value_count,
        options.max_bytes ?? Number.POSITIVE_INFINITY,
      )
      const frame_indices = sampled_indices(valid_frame_count, frame_stride)
      const positions = read_numeric_samples(
        positions_dataset,
        position_path,
        valid_frame_count,
        position_values_per_frame,
        frame_stride,
      )
      const vectors = Object.fromEntries(
        vector_keys.map((key) => {
          const signal = signal_manifest[key]
          if (
            signal.steps.length !== valid_frame_count ||
            signal.steps.some((step, frame_idx) => step !== steps[frame_idx])
          ) {
            throw new Error(`TorchSim HDF5 vector ${key} does not share geometry steps`)
          }
          return [
            key,
            read_numeric_samples(
              signal.dataset,
              signal.path,
              valid_frame_count,
              position_values_per_frame,
              frame_stride,
            ),
          ]
        }),
      )
      const signals = Object.fromEntries(
        signal_keys.map((key) => [key, read_torch_sim_signal(signal_manifest[key])]),
      )
      const scalars: Record<string, Float64Array> =
        scalar_keys.length > 0 && energy_dataset && energy_path
          ? {
              energy: read_numeric_samples(
                energy_dataset,
                energy_path,
                valid_frame_count,
                1,
                frame_stride,
              ),
            }
          : {}
      return {
        positions,
        n_frames: frame_indices.length,
        n_atoms,
        elements: [...elements],
        lattice_matrices:
          static_lattice || dynamic_cells
            ? frame_indices.map((frame_idx) => lattice_for_frame(frame_idx) ?? null)
            : null,
        pbc: streamed_pbc,
        coords_unwrapped: false,
        frame_stride,
        steps: frame_indices.map((frame_idx) => steps[frame_idx]),
        ...(scalar_keys.length > 0 ? { scalars } : {}),
        ...(vector_keys.length > 0 ? { vectors } : {}),
        ...(signal_keys.length > 0 ? { signals } : {}),
      }
    },
  }
  return {
    ...result,
    total_frames: valid_frame_count,
    plot_metadata,
    is_indexed: true,
    frame_loader,
    ...(Object.keys(signal_descriptors).length > 0 ? { signal_descriptors } : {}),
  }
}

function parse_torch_sim_h5_file(
  h5_file: h5wasm.File,
  hdf5_group_path?: string,
): TrajectoryType {
  const found_paths: Record<string, string[]> = {}
  let total_groups_found = 0

  const discover = (parent: Group, path = ``): void => {
    total_groups_found++
    for (const name of parent.keys()) {
      const item = parent.get(name)
      const full_path = path ? `${path}/${name}` : `/${name}`
      if (is_hdf5_dataset(item) && STRUCTURAL_ALIASES.has(name)) {
        const paths = (found_paths[name] ??= [])
        paths.push(full_path)
      } else if (is_hdf5_group(item)) {
        discover(item, full_path)
      }
    }
  }
  discover(h5_file)

  const paths_for = (names: string[]): string[] =>
    names.flatMap((name) => found_paths[name] ?? [])
  const structural_paths_for = (names: string[]): string[] =>
    paths_for(names).filter((path) => !path.includes(`/steps/`))
  const position_paths = structural_paths_for(POSITION_ALIASES)
  const atomic_number_paths = structural_paths_for(ATOMIC_NUMBER_ALIASES)
  const structural_parents = new Set(position_paths.map(parent_path))
  const common_parents = new Set(
    atomic_number_paths.map(parent_path).filter((parent) => structural_parents.has(parent)),
  )
  const dataset_path_for = (paths: string[], parent: string): string | undefined =>
    paths.find((path) => parent_path(path) === parent)
  const group_attribute_value = (parent: string, names: string[]): unknown => {
    let current = parent
    while (current) {
      const group = h5_file.get(current)
      const value = is_hdf5_group(group) ? attribute_value(group, names) : undefined
      if (value !== undefined) return value
      current = parent_path(current)
    }
    return attribute_value(h5_file, names)
  }
  const group_paths = [...common_parents].map((parent) => parent || `/`)
  const selected_parent = hdf5_group_path === `/` ? `` : hdf5_group_path
  if (selected_parent !== undefined && !common_parents.has(selected_parent)) {
    throw new Error(
      `Unknown HDF5 trajectory group ${hdf5_group_path}; available groups: ${group_paths.join(`, `)}`,
    )
  }
  if (
    selected_parent === undefined &&
    common_parents.size > 1 &&
    !common_parents.has(`/data`)
  ) {
    throw new Hdf5TrajectoryGroupSelectionError(group_paths)
  }
  const structural_parent =
    selected_parent ?? (common_parents.has(`/data`) ? `/data` : [...common_parents][0])
  const inherited_attribute = (names: string[]): unknown =>
    group_attribute_value(structural_parent ?? ``, names)
  const first_path = (names: string[]): string | undefined =>
    structural_parent === undefined
      ? undefined
      : dataset_path_for(structural_paths_for(names), structural_parent)
  const position_path = first_path(POSITION_ALIASES)
  const atomic_number_path = first_path(ATOMIC_NUMBER_ALIASES)
  const cell_path = first_path(CELL_ALIASES)
  const energy_path = first_path(ENERGY_ALIASES)
  const pbc_path = first_path(PBC_ALIASES)
  return parse_torch_sim_datasets(h5_file, {
    structural_parent: structural_parent ?? ``,
    position_path,
    atomic_number_path,
    cell_path,
    energy_path,
    pbc_path,
    inherited_attribute,
    total_groups_found,
  })
}
