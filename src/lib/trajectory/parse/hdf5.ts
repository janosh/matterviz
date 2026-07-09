// HDF5 trajectory parsing: dispatches between VASP vaspout.h5 and the
// torch-sim / generic dataset-alias layout after a single file open.
import { calc_lattice_params, transpose_3x3_matrix } from '$lib/math'
import type { Pbc } from '$lib/structure/pbc'
import type { Group } from 'h5wasm'
import type * as h5wasm from 'h5wasm'
import {
  convert_atomic_numbers,
  count_elements,
  create_trajectory_frame,
  validate_3x3_matrix,
} from '$lib/trajectory/helpers'
import type { TrajectoryType } from '$lib/trajectory/index'
import { is_hdf5_dataset, is_hdf5_group, read_dataset, with_h5_file } from './h5-utils'
import { is_vaspout_h5_file, parse_vaspout_h5_file } from './vaspout-h5'

// Routes an opened HDF5 file to the right parser: vaspout.h5 has the VASP 6.x
// root-group layout, everything else falls through to the torch-sim recursive
// dataset-name search. One FS write + open, no parse-and-fallback.
export async function parse_hdf5_trajectory(
  buffer: ArrayBuffer,
  filename?: string,
): Promise<TrajectoryType> {
  return with_h5_file(buffer, filename, (h5_file) =>
    is_vaspout_h5_file(h5_file)
      ? parse_vaspout_h5_file(h5_file)
      : parse_torch_sim_h5_file(h5_file),
  )
}

// Dataset-name aliases searched (in order) across the whole group tree
const POSITION_ALIASES = [`positions`, `coords`, `coordinates`]
const ATOMIC_NUMBER_ALIASES = [`atomic_numbers`, `numbers`, `Z`, `species`]
const CELL_ALIASES = [`cell`, `cells`, `lattice`]
const ENERGY_ALIASES = [`potential_energy`, `energy`]

function parse_torch_sim_h5_file(h5_file: h5wasm.File): TrajectoryType {
  const alias_groups = [POSITION_ALIASES, ATOMIC_NUMBER_ALIASES, CELL_ALIASES, ENERGY_ALIASES]
  const all_aliases = new Set(alias_groups.flat())
  const found_paths: Record<string, string> = {}
  const found_alias_groups = new Set<number>()
  let total_groups_found = 0

  const discover = (parent: Group, path = ``): void => {
    total_groups_found++
    for (const name of parent.keys()) {
      const item = parent.get(name)
      const full_path = path ? `${path}/${name}` : `/${name}`
      if (is_hdf5_dataset(item) && all_aliases.has(name)) {
        found_paths[name] ??= full_path
        for (const [group_idx, aliases] of alias_groups.entries()) {
          if (aliases.includes(name)) found_alias_groups.add(group_idx)
        }
        if (found_alias_groups.size === alias_groups.length) return
      } else if (is_hdf5_group(item)) {
        discover(item, full_path)
        if (found_alias_groups.size === alias_groups.length) return
      }
    }
  }
  discover(h5_file as unknown as Group)

  const first_path = (names: string[]): string | undefined =>
    names.map((name) => found_paths[name]).find(Boolean)
  const find_dataset = (names: string[]): unknown => {
    const path = first_path(names)
    return path ? read_dataset(h5_file, path) : null
  }

  const positions_data = find_dataset(POSITION_ALIASES) as number[][] | number[][][] | null
  const atomic_numbers_data = find_dataset(ATOMIC_NUMBER_ALIASES) as
    | number[]
    | number[][]
    | null
  const cells_data = find_dataset(CELL_ALIASES) as number[][][] | null
  const energies_data = find_dataset(ENERGY_ALIASES) as number[] | number[][] | null

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
  const frames: TrajectoryType[`frames`] = []
  let dropped_steps = 0
  for (const [idx, frame_pos] of positions.entries()) {
    try {
      const frame_atomic_numbers = atomic_numbers[idx] || atomic_numbers[0]
      const frame_elements = convert_atomic_numbers(frame_atomic_numbers)
      const cell = cells_data?.[idx]
      const lattice_mat = cell ? transpose_3x3_matrix(validate_3x3_matrix(cell)) : undefined
      const energy_entry = energies_data?.[idx]
      const energy = Array.isArray(energy_entry) ? energy_entry[0] : energy_entry
      const metadata: Record<string, unknown> = {}
      if (energy !== undefined) metadata.energy = energy
      if (lattice_mat) {
        metadata.volume = calc_lattice_params(lattice_mat).volume
      }
      const pbc: Pbc = lattice_mat ? [true, true, true] : [false, false, false]

      frames.push(
        create_trajectory_frame(frame_pos, frame_elements, lattice_mat, pbc, idx, metadata),
      )
    } catch (err) {
      // Same torn-tail resiliency as the vaspout parser: interrupted writers
      // zero-fill trailing chunks (atomic number 0, degenerate cells), which
      // fails validation — keep the frames parsed so far and report the rest
      // as dropped. A file whose very first frame is unparsable still throws.
      if (frames.length === 0) throw err
      dropped_steps = positions.length - idx
      break
    }
  }

  const first_frame_elements =
    frames[0]?.structure.sites.map((site) => site.species[0].element) ?? []

  return {
    frames,
    metadata: {
      source_format: `hdf5_trajectory`,
      frame_count: frames.length,
      num_atoms: first_frame_elements.length,
      periodic_boundary_conditions: cells_data ? [true, true, true] : [false, false, false],
      element_counts: count_elements(first_frame_elements),
      discovered_datasets: {
        positions: first_path(POSITION_ALIASES) ?? `unknown`,
        atomic_numbers: first_path(ATOMIC_NUMBER_ALIASES) ?? `unknown`,
        cells: first_path(CELL_ALIASES),
        energies: first_path(ENERGY_ALIASES),
      },
      total_groups_found,
      has_cell_info: Boolean(cells_data),
      ...(dropped_steps > 0 ? { dropped_steps } : {}),
    },
  }
}
