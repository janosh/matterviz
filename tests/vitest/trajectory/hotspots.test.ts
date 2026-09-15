import { describe, expect, it, vi } from 'vitest'
import {
  calculate_hotspots,
  hotspot_bin,
  hotspot_values,
  hotspot_mean,
  hotspot_slice,
  BOLTZMANN_EV,
  type HotspotGrid,
  type HotspotRequest,
} from '$lib/trajectory/hotspots'
import {
  atom_range,
  frame_atom_batch,
  atom_batch_transfers,
  type ReadAtoms,
  type AtomBatch,
} from '$lib/trajectory/atom-batches'
import { trajectory_from_frames } from '$lib/trajectory/runs/memory'
import { summarize_run } from '$lib/trajectory/run'
import { serve_run_over_port, worker_run } from '$lib/trajectory/runs/worker'
import { create_trajectory_frame } from '$lib/trajectory/helpers'
import { h5_bytes } from './fixtures'
import { open_trajectory } from '$lib/trajectory/open'

const grid: HotspotGrid = {
  dims: [2, 1, 1],
  origin: [0, 0, 0],
  cell: [
    [2, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  pbc: [false, false, false],
}
const conversion = (0.5 * 1.66053906892e-27 * 100 ** 2) / 1.602176634e-19

function source(n_atoms = 8, steps = [0, 1, 2], drift = 0): ReadAtoms {
  return (options): AtomBatch => {
    const { start, count, stride } = atom_range(n_atoms, options)
    const positions = new Float64Array(count * 3)
    const velocities = new Float64Array(count * 3)
    const masses = new Float64Array(count)
    for (let idx = 0; idx < count; idx++) {
      const atom_idx = start + idx * stride
      positions.set([atom_idx < n_atoms / 2 ? 0.5 : 1.5, 0.5, 0.5], idx * 3)
      const speed = atom_idx < n_atoms / 2 ? 1 : 2
      velocities[idx * 3] = drift + (atom_idx % 2 ? speed : -speed)
      masses[idx] = 28
    }
    return {
      positions,
      velocities,
      masses,
      atomic_numbers: new Uint8Array(count).fill(14),
      total_atoms: n_atoms,
      start,
      stride,
      step: steps[options.frame_idx],
      cell: grid.cell,
      origin: grid.origin,
      pbc: grid.pbc,
    }
  }
}

describe(`spatial kinetic hotspots`, () => {
  it.each([1, 3, 8])(`preserves energies across batch size %s`, async (batch_size) => {
    const result = await calculate_hotspots(3, source(), {
      grid,
      mass_unit: `amu`,
      velocity_unit: `A/ps`,
      batch_size,
    })
    expect(Array.from(result.population)).toEqual([8, 8])
    expect(Array.from(result.energy)).toEqual([8 * 28 * conversion, 8 * 28 * conversion * 4])
    expect(hotspot_mean(result, `energy`)).toBe(28 * conversion * 2.5)
    expect(result.frames).toBe(3)
    expect(result.time_weight).toBe(2)
  })

  it.each([`translation`, `local`] as const)(
    `removes %s without subtracting large raw energies`,
    async (motion) => {
      const options = {
        grid,
        mass_unit: `amu` as const,
        velocity_unit: `A/ps` as const,
        motion,
      }
      const expected = await calculate_hotspots(3, source(8), options)
      const actual = await calculate_hotspots(3, source(8, [0, 1, 2], 2 ** 30), options)
      const errors = actual.energy.map((value, idx) => Math.abs(value - expected.energy[idx]))
      const max_abs = Math.max(...errors)
      const max_rel = Math.max(...errors.map((value, idx) => value / expected.energy[idx]))
      // Identical integer-valued velocities with exactly representable means.
      expect(max_abs).toBe(0)
      expect(max_rel).toBe(0)
      expect(actual.dof[0]).toBe(motion === `local` ? 18 : 21)
    },
  )

  it(`weights irregular timestamps and changing occupancy by atom exposure`, async () => {
    const read: ReadAtoms = (options) => {
      const batch = source(8, [0, 2, 5])(options) as AtomBatch
      batch.energies = new Float64Array(batch.atomic_numbers.length).fill(
        options.frame_idx + 1,
      )
      batch.selected = new Uint8Array(batch.atomic_numbers.length).fill(
        options.frame_idx === 1 ? 0 : 1,
      )
      return batch
    }
    const result = await calculate_hotspots(3, read, {
      grid,
      energy_key: `ke`,
      energy_unit: `eV`,
      energy_reference: `device`,
      selection_key: `mobile`,
    })
    expect(result.time_weight).toBe(5)
    expect(Array.from(result.population)).toEqual([10, 10])
    expect(Array.from(result.energy)).toEqual([22, 22])
    expect(hotspot_mean(result, `energy`)).toBe(2.2)
    expect(Array.from(result.occupied_frames)).toEqual([2, 2])
  })

  it.each([2 ** 30, 2 ** 50])(`removes independent bin drift of %s`, async (drift) => {
    const read: ReadAtoms = () => ({
      positions: new Float64Array([
        0.5,
        0.5,
        0.5,
        ...Array.from({ length: 4 }, () => [1.5, 0.5, 0.5]).flat(),
      ]),
      velocities: new Float64Array(
        [0, drift, drift + 1, drift, drift + 1].flatMap((speed) => [speed, 0, 0]),
      ),
      masses: new Float64Array(5).fill(1),
      atomic_numbers: new Uint8Array(5).fill(1),
      total_atoms: 5,
      start: 0,
      stride: 1,
      step: 0,
      origin: grid.origin,
      cell: grid.cell,
      pbc: grid.pbc,
    })
    const result = await calculate_hotspots(1, read, {
      grid,
      velocity_unit: `A/ps`,
      mass_unit: `amu`,
      motion: `local`,
    })
    // The populated bin has residuals [-0.5, 0.5, -0.5, 0.5], with squared sum 1.
    expect(result.energy[0]).toBe(0)
    expect(Math.abs(result.energy[1] - conversion)).toBeLessThanOrEqual(
      2 * Number.EPSILON * conversion,
    )
  })

  it(`masks underpopulated cells and converts explicit degrees of freedom`, async () => {
    const result = await calculate_hotspots(1, source(), {
      grid,
      mass_unit: `amu`,
      velocity_unit: `A/ps`,
      dof_per_atom: 2,
    })
    expect(hotspot_values(result, `energy`, 5).every(Number.isNaN)).toBe(true)
    const temperature = hotspot_values(result, `temperature`)
    expect(temperature[0]).toBe(Math.fround((28 * conversion) / BOLTZMANN_EV))
  })

  it.each([
    [{}, /Declare velocity units/],
    [{ velocity_unit: `constructor` }, /Declare velocity units/],
    [
      { energy_key: `ke`, energy_unit: `constructor`, energy_reference: `device` },
      /Declare kinetic-energy units/,
    ],
    [{ mass_unit: `amu`, velocity_unit: `A/ps`, max_bytes: 1 }, /budget/],
    [{ mass_unit: `amu`, velocity_unit: `A/ps`, retained_bytes: 128 * 1024 ** 2 }, /budget/],
    [{ mass_unit: `amu`, velocity_unit: `A/ps`, frame_stride: 0 }, /Invalid hotspot frame/],
    [{ mass_unit: `amu`, velocity_unit: `A/ps`, bins: 129, grid: undefined }, /Bins per axis/],
    [{ energy_key: `ke`, energy_unit: `eV`, motion: `local` }, /cannot remove motion/],
  ] as const)(`rejects invalid options %j`, async (options, message) => {
    await expect(
      calculate_hotspots(3, source(), { grid, ...options } as HotspotRequest),
    ).rejects.toThrow(message)
  })

  it(`wraps triclinic periodic coordinates and keeps nonperiodic boundaries`, () => {
    const tilted: HotspotGrid = {
      ...grid,
      cell: [
        [2, 0, 0],
        [1, 1, 0],
        [0, 0, 1],
      ],
      pbc: [true, false, false],
    }
    expect(hotspot_bin([3, 0.5, 0.5], 0, tilted)).toBe(0)
    expect(hotspot_bin([3, 2, 0.5], 0, tilted)).toBe(-1)
  })

  it.each([100_000, 1_000_000])(`processes %s atoms with bounded batches`, async (n_atoms) => {
    const read = vi.fn(source(n_atoms))
    const result = await calculate_hotspots(3, read, {
      grid,
      mass_unit: `amu`,
      velocity_unit: `A/ps`,
    })
    expect(result.population[0] + result.population[1]).toBe(n_atoms * 2)
    expect(read.mock.calls.every(([options]) => (options.count ?? 0) <= 65_536)).toBe(true)
    expect(result.reserved_buffer_bytes).toBeLessThan(32 * 1024 ** 2)
    expect(hotspot_mean(result, `energy`)).toBeCloseTo(28 * conversion * 2.5, 12)
  })

  it(`cancels before reading the next batch`, async () => {
    const controller = new AbortController()
    const read = vi.fn(source(100_000))
    await expect(
      calculate_hotspots(3, read, {
        grid,
        mass_unit: `amu`,
        velocity_unit: `A/ps`,
        signal: controller.signal,
        on_progress: () => controller.abort(),
      }),
    ).rejects.toThrow(/abort/i)
    expect(read.mock.calls.length).toBeLessThan(6)
  })

  it(`rejects missing selections and overflowing energy instead of publishing a map`, async () => {
    await expect(
      calculate_hotspots(1, source(), {
        grid,
        velocity_unit: `A/ps`,
        mass_unit: `amu`,
        selection_key: `mobile`,
      }),
    ).rejects.toThrow(`Missing or invalid selection`)
    const read: ReadAtoms = (options) => ({
      ...(source()(options) as AtomBatch),
      velocities: new Float64Array(24).fill(1e200),
    })
    await expect(
      calculate_hotspots(1, read, { grid, velocity_unit: `m/s`, mass_unit: `kg` }),
    ).rejects.toThrow(`accumulation overflow`)
  })

  it(`follows changing cells while fixed-device bins exclude atoms leaving the device`, async () => {
    const read: ReadAtoms = ({ frame_idx }): AtomBatch => ({
      positions: new Float64Array([frame_idx ? 3 : 1.5, 0.5, 0.5]),
      energies: new Float64Array([2]),
      atomic_numbers: new Uint8Array([14]),
      total_atoms: 1,
      start: 0,
      stride: 1,
      step: frame_idx,
      cell: [
        [frame_idx ? 4 : 2, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      origin: [0, 0, 0],
      pbc: [true, false, false],
    })
    const options = {
      grid,
      energy_key: `ke`,
      energy_unit: `eV` as const,
      energy_reference: `device`,
    }
    const fixed = await calculate_hotspots(2, read, options)
    const following = await calculate_hotspots(2, read, { ...options, coordinates: `cell` })
    expect([...fixed.population]).toEqual([0, 0.5])
    expect(fixed.excluded_atoms).toBe(1)
    expect([...following.population]).toEqual([0, 1])
    expect([...following.energy]).toEqual([0, 2])
  })

  it(`runs through the worker port while allowing frame navigation`, async () => {
    const frames = [0, 1, 2].map((step) => {
      const frame = create_trajectory_frame(
        [
          [0.5, 0.5, 0.5],
          [1.5, 0.5, 0.5],
        ],
        [`Si`, `Si`],
        grid.cell,
        grid.pbc,
        step,
        {},
      )
      for (const site of frame.structure.sites)
        site.properties = { mass: 28, velocity: [1, 0, 0] }
      return frame
    })
    const backing = trajectory_from_frames(frames)
    const read_atoms = backing.read_atoms
    if (!read_atoms) throw new Error(`Missing numeric reader`)
    backing.read_atoms = async (options, signal) => {
      const batch = await read_atoms(options, signal)
      const packed = new Float64Array(batch.positions.length + batch.atomic_numbers.length)
      packed.set(batch.positions)
      const packed_batch = {
        ...batch,
        positions: packed.subarray(0, batch.positions.length),
        energies: packed.subarray(batch.positions.length),
      }
      expect(atom_batch_transfers(packed_batch)).toHaveLength(2)
      return packed_batch
    }
    const run = worker_run(serve_run_over_port(backing), summarize_run(backing))
    try {
      expect((await run.read_atoms?.({ frame_idx: 1 }))?.positions).toEqual(
        new Float64Array([0.5, 0.5, 0.5, 1.5, 0.5, 0.5]),
      )
      if (!run.compute_hotspots) throw new Error(`Missing worker hotspot capability`)
      const computation = run.compute_hotspots({
        grid,
        mass_unit: `amu`,
        velocity_unit: `A/ps`,
      })
      expect((await run.read_frame(1)).step).toBe(1)
      expect(hotspot_mean(await computation, `energy`)).toBe(28 * conversion)
      const compute = backing.compute_hotspots
      if (!compute) throw new Error(`Missing backing computation`)
      const started = Promise.withResolvers<undefined>()
      let active = 0
      let peak_active = 0
      let calls = 0
      backing.compute_hotspots = async (options) => {
        active++
        peak_active = Math.max(active, peak_active)
        try {
          if (calls++ === 0) {
            const signal = options.signal
            if (!signal) throw new Error(`Missing worker cancellation signal`)
            started.resolve(undefined)
            // Retain the first job through another turn after cancellation, like a reducer
            // unwinding its buffers. A replacement must not allocate alongside it.
            await new Promise((resolve) =>
              signal.addEventListener(`abort`, () => setTimeout(resolve, 0), { once: true }),
            )
            signal.throwIfAborted()
          }
          return await compute(options)
        } finally {
          active--
        }
      }
      const options = { grid, mass_unit: `amu` as const, velocity_unit: `A/ps` as const }
      const superseded = run.compute_hotspots(options).catch((error: unknown) => error)
      await started.promise
      const replacement = run.compute_hotspots(options)
      expect(await superseded).toBeInstanceOf(Error)
      expect(hotspot_mean(await replacement, `energy`)).toBe(28 * conversion)
      expect(peak_active).toBe(1)
    } finally {
      run.dispose()
    }
  })

  it(`restores box origins and weights recorded physical timestamps`, async () => {
    const frames = [0, 1, 2].map((step) => {
      const frame = create_trajectory_frame(
        [[0.5, 0.5, 0.5]],
        [`Si`],
        grid.cell,
        grid.pbc,
        step,
        { box_origin: [step % 2, 0, 0], time: [0, 1, 10][step] },
      )
      frame.structure.sites[0].properties.ke = step === 2 ? 10 : 0
      return frame
    })
    expect(Array.from(frame_atom_batch(frames[1], { frame_idx: 1 }).positions)).toEqual([
      1.5, 0.5, 0.5,
    ])
    const run = trajectory_from_frames(frames)
    try {
      if (!run.compute_hotspots) throw new Error(`Missing hotspot capability`)
      const result = await run.compute_hotspots({
        grid,
        energy_key: `ke`,
        energy_unit: `eV`,
        energy_reference: `device`,
      })
      expect(result.weighting).toBe(`recorded time`)
      expect(result.time_weight).toBe(10)
      expect(hotspot_mean(result, `energy`)).toBe(4.5)
      expect(Array.from(result.population)).toEqual([5, 5])
    } finally {
      run.dispose()
    }
  })

  it(`requires recorded mass units and rejects changing periodic device grids`, async () => {
    await expect(
      calculate_hotspots(1, source(), { grid, velocity_unit: `m/s` }),
    ).rejects.toThrow(`Declare recorded mass units`)
    const read: ReadAtoms = (options) => ({
      ...(source()(options) as AtomBatch),
      cell:
        options.frame_idx === 0
          ? grid.cell
          : [
              [4, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ],
    })
    await expect(
      calculate_hotspots(2, read, {
        grid: { ...grid, pbc: [true, false, false] },
        mass_unit: `amu`,
        velocity_unit: `A/ps`,
      }),
    ).rejects.toThrow(`unchanged cell`)
  })

  it.each([
    [1, false],
    [2, false],
    [3, false],
    [3, true],
  ] as const)(
    `reads single-atom HDF5 scalar channels with %s frames, sparse time=%s`,
    async (n_frames, sparse_time) => {
      const bytes = await h5_bytes(`single-atom-energy`, (file) => {
        const data = file.create_group(`data`)
        const steps = file.create_group(`steps`)
        for (const [name, values, shape] of [
          [`positions`, Array.from({ length: 9 }, () => 0.5), [3, 1, 3]],
          [`ke`, [2, 4, 10], [3, 1]],
          [`mobile`, [1, 1, 1], [3, 1]],
          [`time`, [0, 1, 10], [3]],
        ] as const) {
          const sample_size = shape.slice(1).reduce<number>((total, size) => total * size, 1)
          const samples =
            name === `time` && sparse_time
              ? [0, 2]
              : Array.from({ length: n_frames }, (_unused, idx) => idx)
          data.create_dataset({
            name,
            data: samples.flatMap((idx) =>
              values.slice(idx * sample_size, (idx + 1) * sample_size),
            ),
            shape: [samples.length, ...shape.slice(1)],
          })
          steps.create_dataset({ name, data: samples, shape: [samples.length] })
        }
        data.create_dataset({ name: `atomic_numbers`, data: [14], shape: [1] })
        data.create_dataset({ name: `pbc`, data: [0, 0, 0], shape: [3] })
      })
      const run = await open_trajectory(bytes, { filename: `scalar.h5` })
      try {
        if (!run.compute_hotspots) throw new Error(`Missing hotspot capability`)
        if (sparse_time) {
          expect((await run.read_frame(1)).step).toBe(1)
          expect((await run.read_atoms?.({ frame_idx: 1 }))?.time).toBeUndefined()
        }
        const computation = run.compute_hotspots({
          grid,
          energy_key: `ke`,
          energy_unit: `eV`,
          energy_reference: `device`,
          selection_key: `mobile`,
        })
        if (sparse_time) {
          await expect(computation).rejects.toThrow(`HDF5 time has no sample at step 1`)
          return
        }
        const result = await computation
        expect(hotspot_mean(result, `energy`)).toBe([2, 3, 6.6][n_frames - 1])
        expect(result.weighting).toBe(`recorded time`)
        expect(hotspot_values(result, `temperature`).every(Number.isNaN)).toBe(true)
      } finally {
        run.dispose()
      }
    },
  )

  it(`requires explicit post-reference DOF for stored-energy Kelvin`, async () => {
    const read: ReadAtoms = (options) => ({
      ...(source()(options) as AtomBatch),
      energies: new Float64Array(8).fill(1),
    })
    const options = {
      grid,
      energy_key: `ke`,
      energy_unit: `eV` as const,
      energy_reference: `COM removed`,
    }
    const unknown = await calculate_hotspots(1, read, options)
    expect(hotspot_mean(unknown, `temperature`)).toBeNaN()
    const declared = await calculate_hotspots(1, read, { ...options, dof_per_atom: 1.5 })
    const expected = 2 / (1.5 * BOLTZMANN_EV)
    // Reference divides by kB*DOF; reducer divides by DOF then multiplies by 2/kB.
    expect(Math.abs(hotspot_mean(declared, `temperature`) - expected)).toBeLessThanOrEqual(
      2 * Number.EPSILON * expected,
    )
  })

  it(`preserves bin values and empty cells in physical orthogonal and triclinic slices`, () => {
    const orthogonal = hotspot_slice(grid, new Float32Array([10, NaN]), 2, 0)
    expect([...orthogonal.data]).toEqual([10, NaN])
    expect([...orthogonal.mask]).toEqual([1, 0])
    expect(orthogonal.point).toEqual([0, 0, 0.5])
    const skewed = hotspot_slice(
      {
        ...grid,
        cell: [
          [2, 0, 0],
          [1, 2, 0],
          [0.2, 0.4, 2],
        ],
      },
      new Float32Array([10, 20]),
      2,
      0,
    )
    expect(skewed.point).toEqual([0.1, 0.2, 1])
    expect(skewed.normal).toEqual([0, 0, 1])
    expect(skewed.polygon).toEqual([
      [0, 0],
      [2, 0],
      [3, 2],
      [1, 2],
    ])
    expect(new Set(skewed.data.filter(Number.isFinite))).toEqual(new Set([10, 20]))
    expect(skewed.mask[skewed.width - 1]).toBe(0)
    expect(skewed.mask[(skewed.height - 1) * skewed.width]).toBe(0)
    const masked = hotspot_slice(grid, new Float32Array([10, 20]), 2, 0, 15)
    expect([...masked.data]).toEqual([NaN, 20])
  })

  it(`rejects oversized physical chunks before reading structural HDF5 data`, async () => {
    const n_atoms = 600_000
    const bytes = await h5_bytes(`oversized-species`, (file) => {
      const data = file.create_group(`data`)
      const steps = file.create_group(`steps`)
      data.create_dataset({
        name: `positions`,
        data: new Float32Array(n_atoms * 6).fill(0.5),
        shape: [2, n_atoms, 3],
        chunks: [1, 10_000, 3],
      })
      steps.create_dataset({ name: `positions`, data: [0, 1], shape: [2] })
      data.create_dataset({
        name: `atomic_numbers`,
        data: new Float64Array(n_atoms * 2).fill(14),
        shape: [2, n_atoms],
        chunks: [2, n_atoms],
      })
      steps.create_dataset({ name: `atomic_numbers`, data: [0, 1], shape: [2] })
    })
    await expect(open_trajectory(bytes, { filename: `oversized.h5` })).rejects.toThrow(
      `9600000-byte storage chunks`,
    )
  })

  it(`opens a million-atom TorchSim file through the first result with a bounded preview`, async () => {
    // Cross the old 8 MiB whole-species/mass ceiling as well as one million positions.
    const n_atoms = 1_050_000
    const bytes = await h5_bytes(`million-atom-hotspots`, (file) => {
      const data = file.create_group(`data`)
      const steps = file.create_group(`steps`)
      const positions = new Float32Array(n_atoms * 2 * 3)
      const velocities = new Float32Array(positions.length)
      for (let idx = 0; idx < n_atoms * 2; idx++) {
        positions.set(
          [idx % n_atoms < n_atoms / 2 ? 0.5 : 1 + (idx % 8) / 8, 0.5, 0.5],
          idx * 3,
        )
        velocities[idx * 3] = idx % 2 ? 1 : -1
      }
      for (const [name, values] of [
        [`positions`, positions],
        [`velocities`, velocities],
      ] as const) {
        data.create_dataset({
          name,
          data: values,
          shape: [2, n_atoms, 3],
          chunks: [1, 10_000, 3],
        })
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
      data.create_dataset({ name: `cell`, data: grid.cell.flat(), shape: [3, 3] })
      data.create_dataset({ name: `pbc`, data: [0, 0, 0], shape: [3] })
    })
    const started = performance.now()
    const run = await open_trajectory(bytes, { filename: `million.h5` })
    try {
      expect(run.atom_count).toBe(n_atoms)
      expect(run.preview.structure.sites.length).toBeLessThanOrEqual(2000)
      expect(run.preview.metadata?.render_sample).toBe(true)
      expect(run.preview.metadata?.volume).toBe(2)
      const indices = run.preview.metadata?.source_atom_indices
      expect(indices).toHaveLength(2000)
      if (!Array.isArray(indices)) throw new Error(`Missing sampled atom indices`)
      expect(indices[1]).toBe(Math.ceil(n_atoms / 2000))
      const tail = await run.read_atoms?.({
        frame_idx: 1,
        start: n_atoms - 5,
        count: 8,
        stride: 2,
      })
      expect(tail?.positions).toEqual(
        Float64Array.of(1.375, 0.5, 0.5, 1.625, 0.5, 0.5, 1.875, 0.5, 0.5),
      )
      if (!run.compute_hotspots) throw new Error(`Missing hotspot reader`)
      const result = await run.compute_hotspots({
        grid,
        mass_unit: `amu`,
        velocity_unit: `A/ps`,
        motion: `translation`,
      })
      expect(hotspot_mean(result, `energy`)).toBeCloseTo(28 * conversion, 12)
      expect(result.population.reduce((sum, value) => sum + value, 0)).toBe(n_atoms)
      console.info(
        `Million-atom HDF5 open-to-result: ${Math.round(performance.now() - started)} ms; analysis buffer reservation ${result.reserved_buffer_bytes} bytes`,
      )
    } finally {
      run.dispose()
    }
  })
})
