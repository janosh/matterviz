// HDF5 trajectory parsing (torch-sim / generic format)
import * as math from '$lib/math'
import type { Pbc } from '$lib/structure'
import type { Dataset, Entity, Group } from 'h5wasm'
import * as h5wasm from 'h5wasm'
import {
  convert_atomic_numbers,
  create_trajectory_frame,
  validate_3x3_matrix,
} from '../helpers'
import type { TrajectoryType } from '../index'

const is_hdf5_dataset = (entity: Entity | null): entity is Dataset =>
  entity !== null && (`to_array` in entity || entity instanceof h5wasm.Dataset)

const is_hdf5_group = (entity: Entity | null): entity is Group =>
  entity !== null && (`keys` in entity && entity instanceof h5wasm.Group)

export async function parse_torch_sim_hdf5(
  buffer: ArrayBuffer,
  filename?: string,
): Promise<TrajectoryType> {
  await h5wasm.ready
  const { FS } = await h5wasm.ready
  const temp_filename = filename || `temp.h5`

  FS.writeFile(temp_filename, new Uint8Array(buffer))
  const h5_file = new h5wasm.File(temp_filename, `r`)

  try {
    const found_paths: Record<string, string> = {}
    const find_dataset = (names: string[]) => {
      const discover = (parent: Group, path = ``): Dataset | null => {
        for (const name of parent.keys()) {
          const item = parent.get(name)
          const full_path = path ? `${path}/${name}` : `/${name}`
          if (names.includes(name) && is_hdf5_dataset(item)) {
            const found_name = names.find((n) => n === name)
            if (found_name) found_paths[found_name] = full_path
            return item
          }
          if (is_hdf5_group(item)) {
            const result = discover(item, full_path)
            if (result) return result
          }
        }
        return null
      }
      return discover(h5_file as unknown as Group)
    }

    const positions_data = find_dataset([`positions`])?.to_array() as
      | number[][]
      | number[][][]
      | null
    const atomic_numbers_data = find_dataset(
      [`atomic_numbers`, `numbers`, `Z`, `species`],
    )?.to_array() as number[] | number[][] | null
    const cells_data = find_dataset([`cell`, `cells`, `lattice`])?.to_array() as
      | number[][][]
      | null
    const energies_data = find_dataset([`potential_energy`, `energy`])?.to_array() as
      | number[][]
      | null

    if (!positions_data || !atomic_numbers_data) {
      const missing_datasets = []
      if (!positions_data) {
        missing_datasets.push(`positions (tried: positions, coords, coordinates)`)
      }
      if (!atomic_numbers_data) {
        missing_datasets.push(
          `atomic numbers (tried: atomic_numbers, numbers, Z, species)`,
        )
      }
      const missing_str = missing_datasets.join(`, `)
      const available_str = Array.from(h5_file.keys()).join(`, `)
      throw new Error(
        `Missing required dataset(s) in HDF5 file: ${missing_str}. Available datasets: ${available_str}`,
      )
    }

    const positions_are_frames = positions_data.length > 0 &&
      positions_data.every((entry) =>
        Array.isArray(entry) && entry.every((coord) => Array.isArray(coord))
      )
    const positions = positions_are_frames
      ? positions_data as number[][][]
      : [positions_data as number[][]]
    const atomic_numbers_are_frames = atomic_numbers_data.length > 0 &&
      atomic_numbers_data.every((entry) => Array.isArray(entry))
    const atomic_numbers = atomic_numbers_are_frames
      ? atomic_numbers_data as number[][]
      : [atomic_numbers_data as number[]]
    const elements = convert_atomic_numbers(atomic_numbers[0])

    const frames = positions.map((frame_pos, idx) => {
      const cell = cells_data?.[idx]
      const lattice_mat = cell
        ? math.transpose_3x3_matrix(validate_3x3_matrix(cell))
        : undefined
      const energy = energies_data?.[idx]?.[0]
      const metadata: Record<string, unknown> = {}
      if (energy !== undefined) metadata.energy = energy
      if (lattice_mat) {
        metadata.volume = math.calc_lattice_params(lattice_mat).volume
      }
      const pbc: Pbc = lattice_mat ? [true, true, true] : [false, false, false]

      return create_trajectory_frame(frame_pos, elements, lattice_mat, pbc, idx, metadata)
    })

    return {
      frames,
      metadata: {
        source_format: `hdf5_trajectory`,
        frame_count: frames.length,
        num_atoms: elements.length,
        periodic_boundary_conditions: cells_data
          ? [true, true, true]
          : [false, false, false],
        element_counts: elements.reduce((counts: Record<string, number>, element) => {
          counts[element] = (counts[element] || 0) + 1
          return counts
        }, {}),
        discovered_datasets: {
          positions: found_paths.positions || `positions`,
          atomic_numbers: found_paths.atomic_numbers || found_paths.numbers ||
            found_paths.Z || found_paths.species || `unknown`,
          cells: found_paths.cell || found_paths.cells || found_paths.lattice,
          energies: found_paths.potential_energy || found_paths.energy,
        },
        total_groups_found: 1,
        has_cell_info: Boolean(cells_data),
      },
    }
  } finally {
    h5_file.close()
    try {
      FS.unlink(temp_filename)
    } catch { /* temp file cleanup is best-effort */ }
  }
}
