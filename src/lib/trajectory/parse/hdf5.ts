import { calc_lattice_params, transpose_3x3_matrix } from '$lib/math'
import type { Pbc } from '$lib/structure/pbc'
import type { Dataset, Group } from 'h5wasm'
import type * as h5wasm from 'h5wasm'
import {
  convert_atomic_numbers,
  count_elements,
  create_packed_frame_loader,
  create_trajectory_frame,
  is_supported_trajectory_signal_shape,
  load_packed_frame_preview,
  validate_3x3_matrix,
} from '$lib/trajectory/helpers'
import type {
  TrajectoryFrameStore,
  TrajectoryMetadata,
  TrajectorySignal,
  TrajectoryType,
} from '$lib/trajectory/index'
import {
  Hdf5TrajectoryGroupSelectionError,
  attribute_value,
  is_hdf5_dataset,
  is_hdf5_group,
  read_dataset,
  string_value,
  to_scalar_number,
  with_h5_file,
} from './h5-utils'
import { is_reference_md_h5_file, parse_reference_md_h5_file } from './reference-md-h5'
import { is_vaspout_h5_file, parse_vaspout_h5_file } from './vaspout-h5'

export { Hdf5TrajectoryGroupSelectionError } from './h5-utils'

export const parse_hdf5_trajectory = async (
  buffer: ArrayBuffer,
  filename?: string,
  hdf5_group_path?: string,
): Promise<TrajectoryType> =>
  with_h5_file(buffer, filename, (h5_file) =>
    is_vaspout_h5_file(h5_file)
      ? parse_vaspout_h5_file(h5_file)
      : is_reference_md_h5_file(h5_file)
        ? parse_reference_md_h5_file(h5_file, hdf5_group_path)
        : parse_torch_sim_h5_file(h5_file, hdf5_group_path),
  )

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

const is_zero_filled = (value: unknown): boolean =>
  flatten_numeric(value)?.every((entry) => entry === 0) === true

const product = (values: number[]): number => values.reduce((total, value) => total * value, 1)

const parent_path = (path: string): string => path.slice(0, path.lastIndexOf(`/`))

const sibling_group_path = (data_group_path: string, sibling: string): string =>
  `${parent_path(data_group_path)}/${sibling}`

const read_signal_unit = (dataset: Dataset): string | undefined =>
  string_value(attribute_value(dataset, [`unit`, `units`]))

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

const read_torch_sim_signals = (
  h5_file: h5wasm.File,
  n_atoms: number,
  excluded_paths: Set<string>,
  data_group_path: string,
  steps_group_path: string,
): {
  signals: Record<string, TrajectorySignal>
  atom_masses?: number[]
  mass_path?: string
  signal_paths: Record<string, string>
} => {
  const data_group = h5_file.get(data_group_path)
  const steps_group = h5_file.get(steps_group_path)
  if (!is_hdf5_group(data_group)) return { signals: {}, signal_paths: {} }
  const signals: Record<string, TrajectorySignal> = {}
  const signal_paths: Record<string, string> = {}
  let atom_masses: number[] | undefined
  let mass_path: string | undefined

  for (const name of data_group.keys()) {
    const dataset = data_group.get(name)
    const path = `${data_group_path}/${name}`
    if (!is_hdf5_dataset(dataset) || excluded_paths.has(path)) continue
    const shape = dataset.shape ?? []
    const values = flatten_numeric(dataset.to_array())
    const steps_dataset = is_hdf5_group(steps_group) ? steps_group.get(name) : null
    const known_signal = name in SIGNAL_ALIASES
    if (!values || values.length !== product(shape)) {
      if (known_signal || MASS_ALIASES.has(name) || is_hdf5_dataset(steps_dataset)) {
        throw new Error(
          `TorchSim HDF5 dataset ${path} has non-finite values or does not match shape ` +
            `[${shape.join(`, `)}]`,
        )
      }
      continue
    }

    if (MASS_ALIASES.has(name)) {
      const mass_values =
        shape.length === 1 && shape[0] === n_atoms
          ? values
          : shape.length === 2 && shape[0] === 1 && shape[1] === n_atoms
            ? values
            : null
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
    const steps_raw = flatten_numeric(steps_dataset.to_array())
    if (!steps_raw) {
      throw new Error(`TorchSim HDF5 signal ${path} has invalid ${steps_group_path}/${name}`)
    }
    validate_steps(steps_raw, `${steps_group_path}/${name}`)
    if (shape.length < 1 || shape[0] !== steps_raw.length) {
      throw new Error(
        `TorchSim HDF5 signal ${path} has shape [${shape.join(`, `)}] but ` +
          `${steps_group_path}/${name} has ${steps_raw.length} entries`,
      )
    }
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
    if (signals[key]) {
      throw new Error(
        `TorchSim HDF5 datasets ${signal_paths[key]} and ${path} both map to signal "${key}"`,
      )
    }
    const unit = read_signal_unit(dataset)
    signals[key] = {
      values: Float64Array.from(values),
      sample_shape,
      steps: steps_raw,
      ...(unit ? { unit } : {}),
    }
    signal_paths[key] = path
  }
  return { signals, atom_masses, mass_path, signal_paths }
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
  const find_dataset = (path: string | undefined): unknown =>
    path ? read_dataset(h5_file, path) : null

  const position_path = first_path(POSITION_ALIASES)
  const atomic_number_path = first_path(ATOMIC_NUMBER_ALIASES)
  const cell_path = first_path(CELL_ALIASES)
  const energy_path = first_path(ENERGY_ALIASES)
  const pbc_path = first_path(PBC_ALIASES)
  const positions_data = find_dataset(position_path) as number[][] | number[][][] | null
  const atomic_numbers_data = find_dataset(atomic_number_path) as number[] | number[][] | null
  const cells_data = find_dataset(cell_path) as number[][][] | null
  const energies_data = find_dataset(energy_path) as number[] | number[][] | null

  if (!positions_data || !atomic_numbers_data) {
    const missing_datasets = []
    if (!positions_data) {
      missing_datasets.push(`positions (tried: ${POSITION_ALIASES.join(`, `)})`)
    }
    if (!atomic_numbers_data) {
      missing_datasets.push(`atomic numbers (tried: ${ATOMIC_NUMBER_ALIASES.join(`, `)})`)
    }
    const missing_str = missing_datasets.join(`, `)
    const available_str = [...h5_file.keys()].join(`, `)
    throw new Error(
      `Missing required dataset(s) in HDF5 file: ${missing_str}. Available datasets: ${available_str}`,
    )
  }

  const positions_are_frames =
    positions_data.length > 0 &&
    positions_data.every(
      (entry) => Array.isArray(entry) && entry.every((coord) => Array.isArray(coord)),
    )
  const positions = positions_are_frames ? positions_data : [positions_data as number[][]]
  const atomic_numbers_are_frames =
    atomic_numbers_data.length > 0 &&
    atomic_numbers_data.every((entry) => Array.isArray(entry))
  const atomic_numbers = atomic_numbers_are_frames
    ? atomic_numbers_data
    : [atomic_numbers_data as number[]]
  if (
    atomic_numbers_are_frames &&
    atomic_numbers.length !== 1 &&
    atomic_numbers.length !== positions.length
  ) {
    throw new Error(
      `HDF5 atomic numbers have ${atomic_numbers.length} frames for ${positions.length} position frames; expected 1 or ${positions.length}`,
    )
  }
  const cells_are_frames = cells_data?.every(
    (entry) => Array.isArray(entry) && entry.every((row) => Array.isArray(row)),
  )
  const cells = cells_data
    ? cells_are_frames
      ? cells_data
      : [cells_data as unknown as number[][]]
    : null
  if (cells_are_frames && cells && cells.length !== 1 && cells.length !== positions.length) {
    throw new Error(
      `HDF5 cells have ${cells.length} frames for ${positions.length} position frames; expected 1 or ${positions.length}`,
    )
  }
  const pbc_dataset_values = find_dataset(pbc_path)
  const pbc_source =
    pbc_dataset_values == null ? `attribute ${PBC_ALIASES.join(`/`)}` : `dataset ${pbc_path}`
  const pbc_values = flatten_numeric(pbc_dataset_values ?? inherited_attribute(PBC_ALIASES))
  const as_pbc = (values: number[]): Pbc => [
    Boolean(values[0]),
    Boolean(values[1]),
    Boolean(values[2]),
  ]
  let pbc_frames: Pbc[] | null = null
  if (pbc_values) {
    if (pbc_values.some((value) => value !== 0 && value !== 1)) {
      throw new Error(`HDF5 PBC ${pbc_source} must contain only 0/1 values`)
    }
    if (pbc_values.length === 1) {
      const flag = Boolean(pbc_values[0])
      pbc_frames = [[flag, flag, flag]]
    } else if (pbc_values.length === 3) pbc_frames = [as_pbc(pbc_values)]
    else if (pbc_values.length === positions.length * 3) {
      pbc_frames = Array.from({ length: positions.length }, (_unused, frame_idx) =>
        as_pbc(pbc_values.slice(frame_idx * 3, frame_idx * 3 + 3)),
      )
    } else {
      throw new Error(
        `HDF5 PBC ${pbc_source} has ${pbc_values.length} values; expected 1, 3, or ` +
          `${positions.length * 3}`,
      )
    }
  }
  let frames: TrajectoryType[`frames`] = []
  const position_name = position_path?.split(`/`).at(-1)
  const data_group_path = structural_parent?.endsWith(`/data`) ? structural_parent : undefined
  const steps_group_path = data_group_path
    ? sibling_group_path(data_group_path, `steps`)
    : `/steps`
  const position_steps_data = position_name
    ? flatten_numeric(read_dataset(h5_file, `${steps_group_path}/${position_name}`))
    : null
  if (position_steps_data && position_steps_data.length !== positions.length) {
    throw new Error(
      `TorchSim HDF5 positions have ${positions.length} frames but ` +
        `${steps_group_path}/${position_name} ` +
        `has ${position_steps_data.length} entries`,
    )
  }
  if (position_steps_data) {
    validate_steps(position_steps_data, `${steps_group_path}/${position_name}`)
  }
  const first_atomic_numbers = atomic_numbers[0]
  const first_frame_elements = convert_atomic_numbers(first_atomic_numbers)
  const n_atoms = first_frame_elements.length
  const packed_positions =
    positions.length > PACKED_PREVIEW_FRAME_COUNT
      ? new Float64Array(positions.length * n_atoms * 3)
      : null
  const packed_lattices =
    packed_positions && cells_are_frames && cells && cells.length > 1
      ? new Float64Array(positions.length * 9)
      : null
  const frame_metadata: Record<string, unknown>[] = []
  const plot_metadata: TrajectoryMetadata[] = []
  let valid_frame_count = 0
  let dropped_steps = 0
  for (const [idx, frame_pos] of positions.entries()) {
    try {
      const frame_atomic_numbers =
        atomic_numbers.length === 1 ? atomic_numbers[0] : atomic_numbers[idx]
      const frame_elements = convert_atomic_numbers(frame_atomic_numbers)
      if (
        frame_elements.length !== first_frame_elements.length ||
        frame_elements.some((element, atom_idx) => element !== first_frame_elements[atom_idx])
      ) {
        throw new Error(`frame changes atom count or ordering`)
      }
      if (
        frame_pos.length !== n_atoms ||
        frame_pos.some(
          (coords) =>
            !Array.isArray(coords) || coords.length !== 3 || !coords.every(Number.isFinite),
        )
      ) {
        throw new Error(`positions must contain ${n_atoms} finite xyz rows`)
      }
      const cell = cells ? cells[cells.length === 1 ? 0 : idx] : undefined
      const lattice_mat = cell ? transpose_3x3_matrix(validate_3x3_matrix(cell)) : undefined
      const energy_entry = energies_data?.[idx]
      const energy = Array.isArray(energy_entry) ? energy_entry[0] : energy_entry
      const metadata: Record<string, unknown> = {}
      if (energy !== undefined) metadata.energy = energy
      if (lattice_mat) {
        const volume = calc_lattice_params(lattice_mat).volume
        if (!(volume > 0)) throw new Error(`cell volume must be positive, got ${volume}`)
        metadata.volume = volume
      }
      const pbc: Pbc =
        pbc_frames?.[idx] ??
        pbc_frames?.[0] ??
        (lattice_mat ? [true, true, true] : [false, false, false])

      const step = position_steps_data?.[idx] ?? idx
      frame_metadata.push(metadata)
      plot_metadata.push({
        frame_number: idx,
        step,
        properties: Object.fromEntries(
          Object.entries(metadata).filter(
            (entry): entry is [string, number] => typeof entry[1] === `number`,
          ),
        ),
      })
      if (packed_positions) packed_positions.set(frame_pos.flat(), idx * n_atoms * 3)
      if (packed_lattices && lattice_mat) packed_lattices.set(lattice_mat.flat(), idx * 9)
      if (!packed_positions) {
        frames.push(
          create_trajectory_frame(frame_pos, frame_elements, lattice_mat, pbc, step, metadata),
        )
      }
      valid_frame_count++
    } catch (error) {
      // Interrupted writes leave zero-filled trailing chunks; interior corruption still fails.
      const remaining_is_zero_filled = positions.slice(idx).every((_position, tail_idx) => {
        const frame_idx = idx + tail_idx
        return (
          (atomic_numbers_are_frames && is_zero_filled(atomic_numbers[frame_idx])) ||
          (cells_are_frames && is_zero_filled(cells?.[frame_idx]))
        )
      })
      if (valid_frame_count === 0 || !remaining_is_zero_filled) {
        throw new Error(
          `Invalid HDF5 trajectory frame ${idx} from ${position_path}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
      dropped_steps = positions.length - idx
      break
    }
  }

  const excluded_paths = new Set(
    [position_path, atomic_number_path, cell_path, energy_path, pbc_path].filter(
      (path): path is string => path !== undefined,
    ),
  )
  const parsed_signals = data_group_path
    ? read_torch_sim_signals(
        h5_file,
        first_frame_elements.length,
        excluded_paths,
        data_group_path,
        steps_group_path,
      )
    : { signals: {}, signal_paths: {} }
  let { signals } = parsed_signals
  const { atom_masses, mass_path, signal_paths } = parsed_signals
  if (dropped_steps > 0) {
    const last_step = plot_metadata.at(-1)?.step ?? Number.NEGATIVE_INFINITY
    signals = Object.fromEntries(
      Object.entries(signals).map(([key, signal]) => {
        const retained_samples = signal.steps.findLastIndex((step) => step <= last_step) + 1
        if (retained_samples < 2) {
          throw new Error(
            `TorchSim HDF5 signal ${signal_paths[key]} has fewer than 2 samples before ` +
              `the surviving geometry ends at step ${last_step}`,
          )
        }
        const sample_size = product(signal.sample_shape)
        return [
          key,
          {
            ...signal,
            values: signal.values.slice(0, retained_samples * sample_size),
            steps: signal.steps.slice(0, retained_samples),
          },
        ]
      }),
    )
  }
  const dt_fs = to_scalar_number(inherited_attribute([`dt_fs`]))
  const time_step =
    to_scalar_number(inherited_attribute([`time_step`, `timestep`, `dt`])) ?? dt_fs
  const time_unit =
    string_value(inherited_attribute([`time_unit`, `time_units`])) ??
    (dt_fs != null ? `fs` : undefined)
  const source_metadata = Object.fromEntries(
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
  )

  let frame_store: TrajectoryFrameStore | undefined
  let frame_loader: TrajectoryType[`frame_loader`]
  if (packed_positions) {
    const retained_values = (values: Float64Array, values_per_frame: number) =>
      valid_frame_count === positions.length
        ? values
        : values.slice(0, valid_frame_count * values_per_frame)
    const retained_positions = retained_values(packed_positions, n_atoms * 3)
    const retained_lattices = packed_lattices ? retained_values(packed_lattices, 9) : undefined
    const matching_vectors = Object.fromEntries(
      Object.entries(signals)
        .filter(
          ([, signal]) =>
            signal.sample_shape.length === 2 &&
            signal.sample_shape[0] === n_atoms &&
            signal.sample_shape[1] === 3 &&
            signal.steps.length === valid_frame_count &&
            signal.steps.every((step, frame_idx) => step === plot_metadata[frame_idx]?.step),
        )
        .map(([key, signal]) => [key, signal.values]),
    )
    const static_lattice =
      cells?.length === 1 ? transpose_3x3_matrix(validate_3x3_matrix(cells[0])) : undefined
    const static_pbc = pbc_frames?.length === 1 ? pbc_frames[0] : undefined
    frame_store = {
      positions: retained_positions,
      elements: first_frame_elements,
      ...(static_lattice ? { lattice_matrix: static_lattice } : {}),
      ...(retained_lattices ? { lattice_matrices: retained_lattices } : {}),
      ...(static_pbc ? { pbc: static_pbc } : {}),
      ...(pbc_frames && pbc_frames.length > 1
        ? { pbc_frames: pbc_frames.slice(0, valid_frame_count) }
        : {}),
      coords_unwrapped: false,
      steps: plot_metadata.map(({ step }) => step),
      metadata: frame_metadata,
      plot_metadata,
      ...(Object.keys(matching_vectors).length > 0 ? { vectors: matching_vectors } : {}),
      ...(Object.keys(signals).length > 0 ? { signals } : {}),
    }
    frame_loader = create_packed_frame_loader(frame_store)
    frames = load_packed_frame_preview(
      frame_loader,
      valid_frame_count,
      PACKED_PREVIEW_FRAME_COUNT,
      `Packed HDF5`,
    )
  }

  return {
    frames,
    ...(frame_store && frame_loader
      ? {
          total_frames: valid_frame_count,
          plot_metadata,
          is_indexed: true,
          frame_store,
          frame_loader,
        }
      : {}),
    ...(time_step != null && time_unit ? { time_step, time_unit } : {}),
    ...(atom_masses ? { atom_masses } : {}),
    ...(Object.keys(signals).length > 0 ? { signals } : {}),
    metadata: {
      source_format: `hdf5_trajectory`,
      frame_count: valid_frame_count,
      num_atoms: first_frame_elements.length,
      periodic_boundary_conditions:
        pbc_frames?.[0] ?? (cells_data ? [true, true, true] : [false, false, false]),
      element_counts: count_elements(first_frame_elements),
      discovered_datasets: {
        positions: position_path ?? `unknown`,
        atomic_numbers: atomic_number_path ?? `unknown`,
        cells: cell_path,
        energies: energy_path,
        pbc: pbc_path,
        masses: mass_path,
        signals: signal_paths,
      },
      ...source_metadata,
      total_groups_found,
      has_cell_info: Boolean(cells_data),
      ...(dropped_steps > 0 ? { dropped_steps } : {}),
    },
  }
}
