// Synthetic trajectory inputs shared by the trajectory and spectral tests: a deterministic
// EXTXYZ generator and HDF5 files built in h5wasm's in-memory FS for layouts and torn-file
// scenarios no checked-in fixture covers.
import type { File as H5File, Group as H5Group } from 'h5wasm'
import { make_rng } from '../numeric-helpers'

// Deterministic EXTXYZ: a cubic cell that breathes, atoms jittering around a grid, an energy
// that drifts with the frame index.
export function synthetic_extxyz(n_frames: number, n_atoms: number, seed = 7): string {
  const rng = make_rng(seed)
  const side = Math.ceil(Math.cbrt(n_atoms))
  const chunks: string[] = []
  for (let frame_idx = 0; frame_idx < n_frames; frame_idx++) {
    const cell = 10 + 0.01 * frame_idx
    chunks.push(
      `${n_atoms}`,
      `Lattice="${cell} 0 0 0 ${cell} 0 0 0 ${cell}" Properties=species:S:1:pos:R:3:forces:R:3 ` +
        `energy=${(-5 * n_atoms - 0.001 * frame_idx).toFixed(6)} step=${frame_idx * 10} pbc="T T T"`,
    )
    for (let atom_idx = 0; atom_idx < n_atoms; atom_idx++) {
      const base = [
        atom_idx % side,
        Math.floor(atom_idx / side) % side,
        Math.floor(atom_idx / side ** 2),
      ]
      const pos = base.map((coord) => ((coord + 0.5) * cell) / side + 0.05 * (rng() - 0.5))
      const force = [rng() - 0.5, rng() - 0.5, rng() - 0.5]
      chunks.push(
        `${atom_idx % 2 ? `Cu` : `Au`} ${pos.map((val) => val.toFixed(5)).join(` `)} ${force
          .map((val) => val.toFixed(4))
          .join(` `)}`,
      )
    }
  }
  return `${chunks.join(`\n`)}\n`
}

export const ds = (group: H5File | H5Group, name: string, data: number[], shape: number[]) =>
  group.create_dataset({ name, data, shape })
export const flat_frames = (
  n_frames: number,
  frame: (frame_idx: number) => number[],
): number[] =>
  Array.from({ length: n_frames }, (_unused, frame_idx) => frame(frame_idx)).flat()
// Build a minimal torch-sim-layout HDF5 file in h5wasm's in-memory FS and
// return its bytes, for torn-file scenarios no checked-in fixture covers
export const h5_bytes = async (
  prefix: string,
  write: (file: H5File) => void,
): Promise<ArrayBuffer> => {
  const h5wasm = await import(`h5wasm`)
  const { FS } = await h5wasm.ready
  const temp_filename = `${prefix}-${Math.random().toString(36).slice(2)}.h5`
  const file = new h5wasm.File(temp_filename, `w`)
  let file_closed = false
  try {
    write(file)
    file.close()
    file_closed = true
    return Uint8Array.from(FS.readFile(temp_filename)).buffer
  } finally {
    if (!file_closed) {
      try {
        file.close()
      } catch {
        // Preserve the writer error if cleanup also fails.
      }
    }
    try {
      FS.unlink(temp_filename)
    } catch {
      // The writer may fail before h5wasm creates a filesystem entry.
    }
  }
}

export type H5Spec = [name: string, data: number[], shape: number[]]
export const make_h5_buffer = (datasets: H5Spec[]): Promise<ArrayBuffer> =>
  h5_bytes(`torn-tail`, (file) => {
    for (const [name, data, shape] of datasets) ds(file, name, data, shape)
  })

export const make_grouped_h5_buffer = (
  groups: { name: string; atomic_number: number; x_position: number }[],
  include_unrelated_data_signals = false,
): Promise<ArrayBuffer> =>
  h5_bytes(`grouped`, (file) => {
    for (const [group_idx, { name, atomic_number, x_position }] of groups.entries()) {
      const group = file.create_group(name)
      ds(group, `positions`, [x_position, 0, 0], [1, 1, 3])
      ds(group, `atomic_numbers`, [atomic_number], [1])
      group.create_attribute(`temperature_kelvin`, 300 + group_idx)
      group.create_attribute(`dt_fs`, 0.5)
    }
    if (include_unrelated_data_signals) {
      const data = file.create_group(`data`)
      ds(data, `masses`, [2], [1])
      ds(data, `dipole`, [1, 0, 0, 0, 1, 0], [2, 3])
      ds(file.create_group(`steps`), `dipole`, [0, 1], [2])
    }
  })

// Four 2-atom frames at steps 0..3 with velocities (idx / 10, one [2, 3] sample per frame
// unless `velocity_steps` puts them on their own axis), a dipole and a polarizability
export const make_torch_sim_signal_buffer = ({
  dipole_steps = [0, 2],
  include_dipole_steps = true,
  velocity_steps = [0, 1, 2, 3],
}: {
  dipole_steps?: number[]
  include_dipole_steps?: boolean
  velocity_steps?: number[]
} = {}): Promise<ArrayBuffer> =>
  h5_bytes(`torch-sim-signals`, (file) => {
    const data = file.create_group(`data`)
    const steps = file.create_group(`steps`)
    ds(
      data,
      `positions`,
      flat_frames(4, (frame_idx) => [frame_idx * 0.01, 0, 0, 1 + frame_idx * 0.01, 0, 0]),
      [4, 2, 3],
    )
    ds(data, `atomic_numbers`, [1, 8], [2])
    ds(data, `masses`, [1.008, 15.999], [2])
    ds(
      data,
      `velocities`,
      Array.from({ length: 6 * velocity_steps.length }, (_unused, idx) => idx / 10),
      [velocity_steps.length, 2, 3],
    ).create_attribute(`unit`, `A/fs`)
    ds(data, `dipole`, [1, 0, 0, 0, 1, 0], [2, 3])
    ds(
      data,
      `polarizability`,
      flat_frames(3, (sample_idx) => [
        1 + sample_idx,
        0,
        0,
        0,
        2 + sample_idx,
        0,
        0,
        0,
        3 + sample_idx,
      ]),
      [3, 3, 3],
    )
    ds(steps, `positions`, [0, 1, 2, 3], [4])
    ds(steps, `velocities`, velocity_steps, [velocity_steps.length])
    if (include_dipole_steps) {
      ds(steps, `dipole`, dipole_steps, [2])
    }
    ds(steps, `polarizability`, [0, 2, 4], [3])
    file.create_attribute(`time_step`, 0.5)
    file.create_attribute(`time_unit`, `fs`)
    file.create_attribute(`temperature`, 300)
    file.create_attribute(`model`, `mace-mpa-0`)
    file.create_attribute(`thermostat`, `langevin`)
    file.create_attribute(`random_seed`, 17)
  })

export const make_reference_md_h5_buffer = (
  global_ids = [100, 101],
  n_frames = 3,
  cell_matrix = [10, 0, 0, 0, 10, 0, 0, 0, 10],
): Promise<ArrayBuffer> =>
  h5_bytes(`reference-md`, (file) => {
    const frames = file.create_group(`frames`)
    ds(
      frames,
      `production_step`,
      Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx * 2),
      [n_frames],
    )
    ds(
      frames,
      `time_ps`,
      Array.from({ length: n_frames }, (_unused, frame_idx) => frame_idx * 0.5),
      [n_frames],
    )
    const simulation = file.create_group(`simulation`)
    simulation.create_attribute(`integration_timestep_ps`, 0.25)
    simulation.create_attribute(`sample_stride_steps`, 2)
    simulation.create_attribute(`sample_interval_ps`, 0.5)
    simulation.create_attribute(`ensemble`, `NVE`)
    ds(file.create_group(`replicas`), `global_ids`, global_ids, [global_ids.length])

    const molecule = file.create_group(`molecules`).create_group(`h2o`)
    const topology = molecule.create_group(`topology`)
    ds(topology, `atomic_numbers`, [1, 8], [2])
    ds(topology, `masses_amu`, [1.008, 15.999], [2])
    ds(topology, `pbc`, [0, 0, 0], [3])
    ds(molecule.create_group(`replicas`), `member_seeds`, [7, 8], [2])

    const initial_state = molecule.create_group(`production_initial_state`)
    ds(initial_state, `positions_angstrom`, [0, 0, 0, 0, 1, 0, 5, 0, 0, 5, 1, 0], [2, 2, 3])
    ds(initial_state, `momenta_sqrt_ev_amu`, Array(12).fill(0), [2, 2, 3])
    ds(initial_state, `cells_angstrom`, [...cell_matrix, ...cell_matrix], [2, 3, 3])

    const observables = molecule.create_group(`observables`)
    ds(
      observables,
      `atomic_velocity_angstrom_per_ps`,
      flat_frames(n_frames, () => [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 0]),
      [n_frames, 2, 2, 3],
    )
    ds(
      observables,
      `total_dipole_e_angstrom`,
      flat_frames(n_frames, (frame_idx) => [0, 0, 0, 10 + frame_idx, 0, 0]),
      [n_frames, 2, 3],
    )
    ds(
      observables,
      `total_energy_ev`,
      flat_frames(n_frames, (frame_idx) => [1 + frame_idx, 10 + frame_idx]),
      [n_frames, 2],
    )
    ds(
      observables,
      `vibrational_temperature_kelvin`,
      flat_frames(n_frames, (frame_idx) => [300 + frame_idx, 310 + frame_idx]),
      [n_frames, 2],
    )
  })
