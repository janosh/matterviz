// Regression: TorchSim writes an all-zero cell (with pbc = [false, false, false]) for
// non-periodic states such as molecules. A zero lattice is meaningless and must not be
// attached to parsed structures: downstream consumers invert the lattice matrix and
// crash with "Matrix is singular or ill-conditioned".
import type { TrajectoryRun } from '$lib/trajectory'
import { open_trajectory } from '$lib/trajectory/open'
import { describe, expect, it, onTestFinished } from 'vitest'
import { ds, h5_bytes } from './fixtures'

const open = async (content: ArrayBuffer, filename?: string): Promise<TrajectoryRun> => {
  const run = await open_trajectory(content, { filename })
  onTestFinished(() => run.dispose())
  return run
}

const make_torch_sim_molecule_buffer = (): Promise<ArrayBuffer> =>
  h5_bytes(`torch-sim-molecule`, (file) => {
    const data = file.create_group(`data`)
    const steps = file.create_group(`steps`)
    // 2-frame water-like molecule, stock TorchSim layout for a non-periodic state:
    // positions and energies vary per frame, cell is present but all-zero.
    ds(data, `positions`, [0, 0, 0, 0.96, 0, 0, -0.24, 0.93, 0, 0, 0, 0.1, 0.96, 0, 0.05, -0.24, 0.93, 0.02], [2, 3, 3])
    ds(data, `atomic_numbers`, [1, 8, 1], [3])
    ds(data, `masses`, [1.008, 15.999, 1.008], [3])
    ds(data, `cell`, new Array(18).fill(0), [2, 3, 3])
    ds(data, `potential_energy`, [-13.61, -13.6], [2, 1])
    ds(steps, `positions`, [0, 1], [2])
    ds(steps, `cell`, [0, 1], [2])
    ds(steps, `potential_energy`, [0, 1], [2])
    ds(data, `pbc`, [0, 0, 0], [3])
    file.create_attribute(`time_step`, 0.5)
    file.create_attribute(`time_unit`, `fs`)
  })

describe(`TorchSim HDF5 non-periodic states (zero cell)`, () => {
  it(`treats an all-zero cell with pbc=false as lattice-free`, async () => {
    const run = await open(await make_torch_sim_molecule_buffer(), `molecule.h5`)
    expect(run.frame_count).toBe(2)
    const frame = await run.read_frame(0)
    // No lattice may be attached: a zero matrix would be singular downstream.
    expect(`lattice` in frame.structure).toBe(false)
    expect(frame.structure.sites).toHaveLength(3)
    expect(frame.structure.sites[1].xyz).toEqual([0.96, 0, 0])
  })

  it(`keeps real cells for periodic TorchSim trajectories`, async () => {
    // Same layout but a genuine cubic box and pbc=true must retain its lattice.
    const buffer = await h5_bytes(`torch-sim-crystal`, (file) => {
      const data = file.create_group(`data`)
      const steps = file.create_group(`steps`)
      ds(data, `positions`, [0, 0, 0, 1.4, 1.4, 1.4], [1, 2, 3])
      ds(data, `atomic_numbers`, [6, 6], [2])
      ds(data, `masses`, [12.011, 12.011], [2])
      ds(data, `cell`, [3.4, 0, 0, 0, 3.4, 0, 0, 0, 3.4], [1, 3, 3])
      ds(data, `potential_energy`, [-9.1], [1, 1])
      ds(steps, `positions`, [0], [1])
      ds(steps, `cell`, [0], [1])
      ds(steps, `potential_energy`, [0], [1])
      ds(data, `pbc`, [1, 1, 1], [3])
      file.create_attribute(`time_step`, 0.5)
      file.create_attribute(`time_unit`, `fs`)
    })
    const run = await open(buffer, `crystal.h5`)
    const frame = await run.read_frame(0)
    expect(`lattice` in frame.structure).toBe(true)
    if (`lattice` in frame.structure) expect(frame.structure.lattice.matrix[0][0]).toBeCloseTo(3.4)
  })
})
