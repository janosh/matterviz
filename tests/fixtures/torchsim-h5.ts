// Runner-neutral (imported by both vitest and Playwright specs): writes a two-frame
// TorchSim-layout HDF5 run of `n_atoms` non-periodic Si atoms into an open h5wasm file.
import type { File as H5File, Group as H5Group } from 'h5wasm'

// `row` gives the position and x velocity of each frame-major atom row (frame 0's atoms,
// then frame 1's); `cell` is the row-major 3x3 lattice. Returns the groups for extra channels.
export function write_torchsim_si_frames(
  file: H5File,
  n_atoms: number,
  cell: number[],
  row: (row_idx: number) => [x: number, y: number, z: number, v_x: number],
): { data: H5Group; steps: H5Group } {
  const data = file.create_group(`data`)
  const steps = file.create_group(`steps`)
  const positions = new Float32Array(n_atoms * 6)
  const velocities = new Float32Array(positions.length)
  for (let row_idx = 0; row_idx < n_atoms * 2; row_idx++) {
    const [x, y, z, v_x] = row(row_idx)
    positions.set([x, y, z], row_idx * 3)
    velocities[row_idx * 3] = v_x
  }
  for (const [name, values] of [
    [`positions`, positions],
    [`velocities`, velocities],
  ] as const) {
    data.create_dataset({ name, data: values, shape: [2, n_atoms, 3], chunks: [1, 10_000, 3] })
    steps.create_dataset({ name, data: [0, 1], shape: [2] })
  }
  data.create_dataset({
    name: `atomic_numbers`,
    data: new Uint8Array(n_atoms).fill(14),
    shape: [n_atoms],
  })
  data.create_dataset({
    name: `masses`,
    data: new Float64Array(n_atoms).fill(28),
    shape: [n_atoms],
  })
  data.create_dataset({ name: `cell`, data: cell, shape: [3, 3] })
  data.create_dataset({ name: `pbc`, data: [0, 0, 0], shape: [3] })
  return { data, steps }
}
