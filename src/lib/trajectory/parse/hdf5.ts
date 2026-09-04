import type { Matrix3x3 } from '$lib/math'
import { calc_lattice_params, first_non_increasing_index, partition_point } from '$lib/math'
import type { Pbc } from '$lib/structure/pbc'
import { to_error } from '$lib/utils'
import type { Dataset, Group } from 'h5wasm'
import type * as h5wasm from 'h5wasm'
import {
  convert_atomic_numbers,
  create_trajectory_frame,
  is_supported_trajectory_signal_shape,
  values_per_sample,
} from '$lib/trajectory/helpers'
import type {
  PositionStreamOptions,
  TrajectoryPositionStream,
  TrajectorySignal,
} from '$lib/trajectory/index'
import {
  Hdf5GroupSelectionRequiredError,
  attach_site_vectors,
  attribute_value,
  dataset_at,
  dataset_shape as shape_of_dataset,
  hdf5_frames_per_slice,
  is_hdf5_dataset,
  is_hdf5_group,
  lattice_from_values,
  read_numeric_1d as read_1d,
  read_numeric_hyperslab,
  read_numeric_samples,
  resolve_stream_channels,
  sampled_property_rows,
  signal_descriptors as describe_signals,
  string_value,
  to_number_array,
  to_scalar_number,
  open_h5_source,
  trajectory_signal,
} from './h5-utils'
import { is_reference_md_h5_file, parse_reference_md_h5_file } from './reference-md-h5'
import type { LazyTrajectorySource, ParsedTrajectory, WarningCollector } from './shared'
import { is_vaspout_h5_file, parse_vaspout_h5_file } from './vaspout-h5'

type Hdf5TrajectoryResult =
  | { kind: `parsed`; parsed: ParsedTrajectory }
  // `lazy.dispose` closes the h5wasm handle and releases the backing FS entry
  | { kind: `lazy`; lazy: LazyTrajectorySource }

const is_lazy_source = (
  result: ParsedTrajectory | LazyTrajectorySource,
): result is LazyTrajectorySource => `read_frame` in result

// Opens an HDF5 trajectory. vaspout.h5 and single-frame files come back fully parsed (the
// handle is closed before returning); multi-frame TorchSim / Reference MD files stay open
// and decode frames on demand until the returned source is disposed.
export const open_hdf5_trajectory = async (
  source: ArrayBuffer | Blob,
  collector: WarningCollector,
  filename?: string,
  hdf5_group_path?: string,
): Promise<Hdf5TrajectoryResult> => {
  const opened = await open_h5_source(source, filename)
  let lazy: LazyTrajectorySource | undefined
  try {
    const result = is_vaspout_h5_file(opened.h5_file)
      ? parse_vaspout_h5_file(opened.h5_file, collector.warn)
      : is_reference_md_h5_file(opened.h5_file)
        ? parse_reference_md_h5_file(opened.h5_file, hdf5_group_path)
        : parse_torch_sim_h5_file(opened.h5_file, hdf5_group_path)
    if (!is_lazy_source(result)) return { kind: `parsed`, parsed: result }
    const dispose_source = result.dispose
    lazy = {
      ...result,
      dispose: () => {
        try {
          dispose_source?.()
        } finally {
          opened.close()
        }
      },
    }
    return { kind: `lazy`, lazy }
  } finally {
    if (!lazy) opened.close()
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

const torch_sim_context = (inherited_attribute: (names: string[]) => unknown) => {
  const dt_fs = to_scalar_number(inherited_attribute([`dt_fs`]))
  const tagged_step = to_scalar_number(inherited_attribute([`time_step`, `timestep`, `dt`]))
  const tagged_unit = string_value(inherited_attribute([`time_unit`, `time_units`]))
  // Value and unit must come from the same attribute: resolving them independently read a
  // file with `dt = 0.0005` (ps) and `dt_fs = 0.5` as 0.0005 fs
  const { value: time_step, unit: time_unit } =
    tagged_step != null && tagged_unit
      ? { value: tagged_step, unit: tagged_unit }
      : { value: dt_fs, unit: `fs` }
  return {
    timing:
      time_step != null && time_step > 0 && time_unit
        ? { time_step: { value: time_step, unit: time_unit } }
        : {},
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

const FORMAT = `TorchSim HDF5`
const dataset_shape = (dataset: Dataset, path: string): number[] =>
  shape_of_dataset(dataset, path, FORMAT)
const read_numeric_1d = (dataset: Dataset, path: string, count: number): number[] =>
  read_1d(dataset, path, count, FORMAT)

const parent_path = (path: string): string => path.slice(0, path.lastIndexOf(`/`))

const validate_steps = (steps: number[], path: string): void => {
  if (!steps.every(Number.isSafeInteger)) {
    throw new Error(`TorchSim HDF5 steps ${path} must contain safe integers`)
  }
  const step_idx = first_non_increasing_index(steps)
  if (step_idx !== null) {
    throw new Error(
      `TorchSim HDF5 steps ${path} must increase strictly; entries ` +
        `${step_idx - 1} and ${step_idx} are ${steps[step_idx - 1]} and ${steps[step_idx]}`,
    )
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

const read_torch_sim_signal = (
  signal: TorchSimSignalManifest,
  start_step = -Infinity,
  end_step = Infinity,
): TrajectorySignal => {
  const { dataset, path, steps, sample_shape } = signal
  const start = steps.findIndex((step) => step >= start_step)
  const end = steps.findIndex((step) => step >= end_step)
  const sample_start = start === -1 ? steps.length : start
  const sample_end = end === -1 ? steps.length : end
  const values = read_numeric_samples(
    dataset,
    path,
    steps.length,
    values_per_sample(sample_shape),
    1,
    undefined,
    sample_start,
    sample_end,
  )
  return trajectory_signal(values, signal, steps.slice(sample_start, sample_end))
}

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

const parse_torch_sim_datasets = (
  h5_file: h5wasm.File,
  config: TorchSimConfig,
): ParsedTrajectory | LazyTrajectorySource => {
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
  // A per-structure dataset is stored once (`base` shape), once behind a frame axis
  // (`[1, ...base]`) or per frame (`[n_frames, ...base]`)
  const frame_axis_layout = (
    shape: number[],
    base: number[],
    what: string,
  ): `static` | `static_with_frame_axis` | `dynamic` => {
    const matches_base = (offset: number): boolean =>
      shape.length === base.length + offset &&
      base.every((size, idx) => shape[idx + offset] === size)
    if (matches_base(1) && n_frames > 1 && shape[0] === n_frames) return `dynamic`
    if (matches_base(1) && shape[0] === 1) return `static_with_frame_axis`
    if (matches_base(0)) return `static`
    const base_text = base.join(`, `)
    throw new Error(
      `HDF5 ${what} have shape [${shape.join(`, `)}]; expected [${base_text}], ` +
        `[1, ${base_text}], or [${n_frames}, ${base_text}]`,
    )
  }
  const atomic_number_layout = frame_axis_layout(
    dataset_shape(atomic_numbers_dataset, atomic_number_path),
    [n_atoms],
    `atomic numbers`,
  )
  const dynamic_atomic_numbers = atomic_number_layout === `dynamic`
  const static_atomic_numbers = dynamic_atomic_numbers
    ? null
    : read_numeric_hyperslab(atomic_numbers_dataset, atomic_number_path, [[]])
  const first_atomic_numbers =
    static_atomic_numbers ??
    read_numeric_hyperslab(atomic_numbers_dataset, atomic_number_path, [[0, 1]])
  const elements = convert_atomic_numbers(first_atomic_numbers)
  const data_group_path = structural_parent.endsWith(`/data`) ? structural_parent : undefined
  const steps_group_path = data_group_path ? `${parent_path(data_group_path)}/steps` : `/steps`
  const position_name = position_path.split(`/`).at(-1) ?? `positions`
  const position_steps_dataset = dataset_at(h5_file, `${steps_group_path}/${position_name}`)
  const steps = position_steps_dataset
    ? read_numeric_1d(position_steps_dataset, `${steps_group_path}/${position_name}`, n_frames)
    : Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx)
  const pbc_dataset = dataset_at(h5_file, pbc_path)
  const pbc_shape = pbc_dataset && pbc_path ? dataset_shape(pbc_dataset, pbc_path) : null
  const pbc_sample_size = pbc_shape ? values_per_sample(pbc_shape.slice(1)) : 0
  const pbc_values =
    pbc_dataset && pbc_path && pbc_shape
      ? Array.from(
          read_numeric_samples(pbc_dataset, pbc_path, pbc_shape[0], pbc_sample_size, 1),
        )
      : to_number_array(inherited_attribute(PBC_ALIASES), true)
  if (pbc_values?.some((value) => value !== 0 && value !== 1)) {
    const source = pbc_dataset ? `dataset ${pbc_path}` : `attribute ${PBC_ALIASES.join(`/`)}`
    throw new Error(`HDF5 PBC ${source} must contain only 0/1 values`)
  }
  // A cell is only needed when some axis is periodic (no PBC info means fully periodic).
  // Non-periodic trajectories may still carry a decorative cell (cluster MD from ASE/TorchSim)
  // that renders when valid, but TorchSim molecules write all-zero cells: those yield no
  // lattice instead of being rejected as torn writes or inverted as singular matrices.
  const cell_required = pbc_values ? pbc_values.some(Boolean) : true
  const lattice_or_none = (matrix: Matrix3x3, context: string): Matrix3x3 | undefined => {
    if (calc_lattice_params(matrix).volume > 0) return matrix
    if (cell_required) throw new Error(`HDF5 ${context} cell volume must be positive`)
    return undefined
  }
  const cells_dataset = dataset_at(h5_file, cell_path)
  const cell_layout =
    cells_dataset && cell_path
      ? frame_axis_layout(dataset_shape(cells_dataset, cell_path), [3, 3], `cells`)
      : null
  const dynamic_cells = cell_layout === `dynamic`
  const static_lattice =
    cells_dataset && cell_path && cell_layout && !dynamic_cells
      ? lattice_or_none(
          lattice_from_values(
            read_numeric_hyperslab(
              cells_dataset,
              cell_path,
              cell_layout === `static_with_frame_axis` ? [[0, 1]] : [[]],
            ),
          ),
          `static`,
        )
      : undefined
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
  // Torn-tail detection without reading the whole positions dataset. An interrupted writer
  // zero-fills the trailing chunk, so the tail announces itself in the cheap datasets: a
  // step axis that falls back to 0, or per-frame atomic numbers / cells that turn to zero.
  // Positions are only read from the first suspect frame onwards, to confirm the tail is
  // all zeros; a static topology with no step axis reads no positions at all here.
  const first_invalid_dynamic_frame = (): { frame_idx: number; reason: string } | null => {
    if (!dynamic_atomic_numbers && !dynamic_cells) return null
    const chunk_size = hdf5_frames_per_slice(
      ...(dynamic_atomic_numbers ? [n_atoms] : []),
      ...(dynamic_cells ? [9] : []),
    )
    for (let start = 0; start < n_frames; start += chunk_size) {
      const end = Math.min(start + chunk_size, n_frames)
      const atomic_chunk = dynamic_atomic_numbers ? read_atomic_numbers(start, end) : null
      const cell_chunk = dynamic_cells ? read_cells(start, end) : null
      for (let frame_idx = start; frame_idx < end; frame_idx++) {
        const local_idx = frame_idx - start
        try {
          if (atomic_chunk) {
            const frame_elements = convert_atomic_numbers(
              atomic_chunk.slice(local_idx * n_atoms, (local_idx + 1) * n_atoms),
            )
            if (frame_elements.some((element, atom_idx) => element !== elements[atom_idx])) {
              throw new Error(`frame changes atom ordering`)
            }
          }
          // a zero cell is a torn write only where a cell is needed at all
          if (cell_chunk && cell_required) {
            const matrix = lattice_from_values(cell_chunk, local_idx * 9)
            if (!(calc_lattice_params(matrix).volume > 0))
              throw new Error(`cell volume is zero`)
          }
        } catch (error) {
          return { frame_idx, reason: to_error(error).message }
        }
      }
    }
    return null
  }
  const tail_chunk_size = hdf5_frames_per_slice(
    position_values_per_frame,
    ...(dynamic_atomic_numbers ? [n_atoms] : []),
    ...(dynamic_cells ? [9] : []),
  )
  const range_is_zero = (values: readonly number[], start: number, end: number): boolean => {
    for (let idx = start; idx < end; idx++) if (values[idx] !== 0) return false
    return true
  }
  // Last frame in [start, end) with any non-zero position / atomic number / cell value, or
  // null when the whole chunk is zero-filled. One hyperslab read per dataset per chunk.
  const last_non_zero_frame_in = (start: number, end: number): number | null => {
    const positions = read_positions(start, end)
    const atomic_numbers = dynamic_atomic_numbers ? read_atomic_numbers(start, end) : null
    const cells = read_cells(start, end)
    for (let frame_idx = end - 1; frame_idx >= start; frame_idx--) {
      const local_idx = frame_idx - start
      const frame_zero =
        range_is_zero(
          positions,
          local_idx * position_values_per_frame,
          (local_idx + 1) * position_values_per_frame,
        ) &&
        (!atomic_numbers ||
          range_is_zero(atomic_numbers, local_idx * n_atoms, (local_idx + 1) * n_atoms)) &&
        (!cells || range_is_zero(cells, local_idx * 9, (local_idx + 1) * 9))
      if (!frame_zero) return frame_idx
    }
    return null
  }
  // Same over [from_frame, n_frames), chunked back to front so the scan stops at the first
  // chunk holding data and each chunk is read at most once
  const last_non_zero_frame_from = (from_frame: number): number | null => {
    for (let end = n_frames; end > from_frame; end -= tail_chunk_size) {
      const last_non_zero = last_non_zero_frame_in(
        Math.max(from_frame, end - tail_chunk_size),
        end,
      )
      if (last_non_zero !== null) return last_non_zero
    }
    return null
  }
  // A step axis that drops back to 0 marks where the writer stopped, once everything from
  // there on is zero-filled. A zero-filled tail implies the step axis is zero from the tear to
  // the end, so the only candidates lie in the trailing run of zero steps (free to find: steps
  // are in memory); the tear is the frame after the last one holding data, so a partially
  // written frame (or a step axis that is all zeros over real data) costs no re-reads.
  const first_torn_step_frame = (): number | null => {
    if (!position_steps_dataset) return null
    let zero_run_start = n_frames
    while (zero_run_start > 0 && steps[zero_run_start - 1] === 0) zero_run_start--
    // Frame 0 has no predecessor to drop back from
    let candidate = Math.max(1, zero_run_start)
    if (candidate >= n_frames) return null
    const last_non_zero = last_non_zero_frame_from(candidate)
    if (last_non_zero !== null) candidate = last_non_zero + 1
    // Always true inside the trailing zero run (0 <= any earlier step); kept so the criterion
    // reads as a drop back to 0 rather than "any zero step"
    if (candidate >= n_frames || steps[candidate] > steps[candidate - 1]) return null
    return candidate
  }
  // The earlier candidate ends the run. A torn step frame was already confirmed zero-filled;
  // only a structural failure ahead of it still needs its tail checked, and one at frame 0
  // leaves nothing to keep
  const invalid_dynamic = first_invalid_dynamic_frame()
  const torn_step_frame = first_torn_step_frame() ?? n_frames
  const valid_frame_count = Math.min(invalid_dynamic?.frame_idx ?? n_frames, torn_step_frame)
  if (
    invalid_dynamic &&
    invalid_dynamic.frame_idx < torn_step_frame &&
    (valid_frame_count === 0 || last_non_zero_frame_from(valid_frame_count) !== null)
  ) {
    throw new Error(
      `Invalid HDF5 trajectory frame ${valid_frame_count} from ${position_path}: ${invalid_dynamic.reason}`,
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
    values_per_sample(candidate_energy_shape.slice(1)) === 1 &&
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
    return values ? lattice_or_none(lattice_from_values(values), `frame`) : undefined
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
      energy === undefined ? {} : { energy },
    )
    for (const [key, signal] of Object.entries(signal_manifest)) {
      if (!is_per_atom_vector(signal)) continue
      const signal_idx = partition_point(signal.steps, (step) => step < steps[frame_idx])
      if (signal.steps[signal_idx] !== steps[frame_idx]) continue
      const ranges: [number, number][] = [[signal_idx, signal_idx + 1]]
      attach_site_vectors(
        frame,
        key,
        read_numeric_hyperslab(signal.dataset, signal.path, ranges),
      )
    }
    return frame
  }
  const sampled_properties = () =>
    sampled_property_rows(
      valid_frame_count,
      (frame_idx) => steps[frame_idx],
      (frame_indices, stride) => {
        const sampled_energy =
          energy_dataset && energy_path
            ? read_numeric_samples(energy_dataset, energy_path, valid_frame_count, 1, stride)
            : null
        const sampled_cells =
          cells_dataset && cell_path && dynamic_cells
            ? read_numeric_samples(cells_dataset, cell_path, valid_frame_count, 9, stride)
            : null
        return frame_indices.map((_frame_number, sample_idx) => {
          const lattice = sampled_cells
            ? lattice_from_values(sampled_cells, sample_idx * 9)
            : static_lattice
          return {
            ...(sampled_energy ? { energy: sampled_energy[sample_idx] } : {}),
            ...(lattice ? { volume: calc_lattice_params(lattice).volume } : {}),
          }
        })
      },
    )
  const { timing, source_metadata } = torch_sim_context(inherited_attribute)
  const shared = {
    format: `hdf5`,
    ...timing,
    ...(atom_masses ? { atom_masses } : {}),
    metadata: {
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
      ...shared,
      frames: [load_frame(0)],
      ...(Object.keys(signals).length > 0 ? { signals } : {}),
    }
  }
  // One sample per surviving frame on exactly the geometry steps: only such a signal can be
  // streamed strided beside positions (`vector_keys`)
  const shares_geometry_steps = (signal: TorchSimSignalManifest): boolean =>
    signal.steps.length === valid_frame_count &&
    signal.steps.every((step, frame_idx) => step === steps[frame_idx])
  const signal_descriptors = describe_signals(
    signal_manifest,
    (signal) => signal.steps.length,
    shares_geometry_steps,
  )
  const collect_positions = (
    options: PositionStreamOptions = {},
  ): TrajectoryPositionStream => {
    const { frame_stride, vector_keys, signal_keys, frame_indices } = resolve_stream_channels(
      FORMAT,
      options,
      valid_frame_count,
      {
        is_vector: (key) => {
          const signal = signal_manifest[key]
          if (signal && !is_per_atom_vector(signal)) {
            throw new Error(
              `TorchSim HDF5 vector ${key} has sample shape [${signal.sample_shape.join(`, `)}], expected [${n_atoms}, 3]`,
            )
          }
          return Boolean(signal)
        },
        is_signal: (key) => Boolean(signal_manifest[key]),
        values_per_frame: (n_vectors) =>
          position_values_per_frame * (1 + n_vectors) +
          1 +
          (static_lattice || dynamic_cells ? 9 : 0),
        signal_values: (key, start_frame, end_frame) =>
          signal_manifest[key].steps.reduce(
            (count, step) =>
              count +
              Number(
                step >= steps[start_frame] &&
                  step < (end_frame < valid_frame_count ? steps[end_frame] : Infinity),
              ),
            0,
          ) *
          (values_per_sample(signal_manifest[key].sample_shape) + 1),
      },
    )
    const start_frame = options.start_frame ?? 0
    const end_frame = options.end_frame ?? valid_frame_count
    const streamed_pbc = pbc_for_frame(start_frame)
    for (let idx = static_pbc ? end_frame * 3 : start_frame * 3; idx < end_frame * 3; idx++) {
      if (Boolean(pbc_values?.[idx]) !== streamed_pbc[idx % 3]) {
        throw new Error(
          `TorchSim HDF5 analysis does not support PBC flags that vary between frames`,
        )
      }
    }
    const positions = read_numeric_samples(
      positions_dataset,
      position_path,
      valid_frame_count,
      position_values_per_frame,
      frame_stride,
      undefined,
      start_frame,
      end_frame,
    )
    const vectors = Object.fromEntries(
      vector_keys.map((key) => {
        const signal = signal_manifest[key]
        if (!shares_geometry_steps(signal)) {
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
            undefined,
            start_frame,
            end_frame,
          ),
        ]
      }),
    )
    const signals = Object.fromEntries(
      signal_keys.map((key) => [
        key,
        read_torch_sim_signal(
          signal_manifest[key],
          steps[start_frame],
          end_frame < valid_frame_count ? steps[end_frame] : Infinity,
        ),
      ]),
    )
    const sampled_cells =
      cells_dataset && cell_path && dynamic_cells
        ? read_numeric_samples(
            cells_dataset,
            cell_path,
            valid_frame_count,
            9,
            frame_stride,
            undefined,
            start_frame,
            end_frame,
          )
        : null
    return {
      positions,
      n_frames: frame_indices.length,
      n_atoms,
      elements: [...elements],
      lattice_matrices: static_lattice
        ? frame_indices.map(() => static_lattice)
        : sampled_cells
          ? frame_indices.map((_frame_idx, sample_idx) =>
              lattice_from_values(sampled_cells, sample_idx * 9),
            )
          : null,
      pbc: streamed_pbc,
      coords_unwrapped: false,
      frame_stride,
      steps: frame_indices.map((frame_idx) => steps[frame_idx]),
      ...(vector_keys.length > 0 ? { vectors } : {}),
      ...(signal_keys.length > 0 ? { signals } : {}),
    }
  }
  return {
    ...shared,
    frame_count: valid_frame_count,
    read_frame: load_frame,
    properties: sampled_properties(),
    collect_positions,
    ...(Object.keys(signal_descriptors).length > 0 ? { signals: signal_descriptors } : {}),
  }
}

function parse_torch_sim_h5_file(
  h5_file: h5wasm.File,
  hdf5_group_path?: string,
): ParsedTrajectory | LazyTrajectorySource {
  const found_paths: Record<string, string[]> = {}
  let total_groups_found = 0

  const discover = (parent: Group, path = ``): void => {
    total_groups_found++
    for (const name of parent.keys()) {
      const item = parent.get(name)
      const full_path = path ? `${path}/${name}` : `/${name}`
      if (is_hdf5_dataset(item) && STRUCTURAL_ALIASES.has(name)) {
        found_paths[name] ??= []
        found_paths[name].push(full_path)
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
    throw new Hdf5GroupSelectionRequiredError(group_paths)
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
