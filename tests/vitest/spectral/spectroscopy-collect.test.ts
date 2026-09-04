import {
  calc_trajectory_spectroscopy,
  collect_trajectory_spectroscopy_input,
  spectroscopy_stream_channels,
  trajectory_signal_keys,
} from '$lib/spectral'
import type { MemoryRunExtras, TrajectoryFrame, TrajectoryRun } from '$lib/trajectory'
import { is_signal_descriptor } from '$lib/trajectory'
import { open_trajectory, trajectory_from_frames } from '$lib/trajectory/open'
import { describe, expect, it, vi } from 'vitest'
import { make_torch_sim_signal_buffer } from '../trajectory/fixtures'

const N_FRAMES = 8
const every_step = Array.from({ length: N_FRAMES }, (_unused, frame_idx) => frame_idx)

const make_frame = (step: number): TrajectoryFrame => ({
  step,
  structure: {
    sites: [
      {
        species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
        xyz: [0.01 * step, 0, 0],
        abc: [0.01 * step, 0, 0],
        label: `H1`,
        properties: { velocity: [1, 0, 0], mass: 1.5 },
      },
    ],
  },
  metadata: {
    dipole: [Math.sin(step), 0, 0],
    polarizability: [
      [1 + Math.cos(step), 0, 0],
      [0, 2, 0],
      [0, 0, 3],
    ],
  },
})

// In-memory run of 8 single-atom frames carrying site velocities and masses plus dipole and
// polarizability frame metadata; `mutate` edits the frames before the run validates them.
const make_run = (
  extras: MemoryRunExtras = {},
  mutate: (frames: TrajectoryFrame[]) => void = () => {},
): TrajectoryRun => {
  const frames = every_step.map(make_frame)
  mutate(frames)
  return trajectory_from_frames(frames, {
    time_step: { value: 0.5, unit: `fs` },
    ...extras,
  })
}

describe(`collect_trajectory_spectroscopy_input`, () => {
  it(`collects frame response signals, site velocities, masses, and time provenance together`, async () => {
    const input = await collect_trajectory_spectroscopy_input(make_run())
    expect(input.positions.n_frames).toBe(N_FRAMES)
    expect(input.velocities?.sample_shape).toEqual([1, 3])
    expect(input.velocities?.values).toHaveLength(3 * N_FRAMES)
    expect(input.masses).toEqual(Float64Array.from([1.5]))
    expect(input.infrared_signal?.kind).toBe(`dipole`)
    expect(input.infrared_signal?.series.sample_shape).toEqual([3])
    expect(input.raman_signal?.kind).toBe(`polarizability`)
    if (input.raman_signal?.kind === `polarizability`) {
      expect(input.raman_signal.series.sample_shape).toEqual([3, 3])
    }
    const window_run = make_run()
    const read_frame = vi.spyOn(window_run, `read_frame`).mockImplementation(() => {
      throw new Error(`Excluded frame must not be loaded`)
    })
    const window = await collect_trajectory_spectroscopy_input(window_run, {
      start_frame: 2,
      end_frame: 6,
    })
    expect(read_frame).not.toHaveBeenCalled()
    expect(window.positions.steps).toEqual([2, 3, 4, 5])
    expect(window.infrared_signal?.series.steps).toEqual([2, 3, 4, 5])
    expect(window.velocities?.steps).toEqual([2, 3, 4, 5])
    expect(input.time_step).toBe(0.5)
    expect(input.time_unit).toBe(`fs`)
    expect(input.metadata).toMatchObject({
      mass_source: `recorded`,
      signal_sources: {
        velocity: `site:velocity`,
        infrared: { key: `dipole`, kind: `dipole` },
        raman: { key: `polarizability`, kind: `polarizability` },
      },
    })
  })

  it(`opting out of every channel collects positions only`, async () => {
    const input = await collect_trajectory_spectroscopy_input(make_run(), {
      velocity_key: null,
      infrared_key: null,
      raman_key: null,
    })
    expect(input.positions).toMatchObject({ n_frames: N_FRAMES, steps: every_step })
    expect(input.velocities).toBeNull()
    expect(input.infrared_signal).toBeNull()
    expect(input.raman_signal).toBeNull()
    expect(input.metadata?.signal_sources).toEqual({
      velocity: null,
      infrared: null,
      raman: null,
    })
  })

  it.each([
    [undefined, [`dipole`, `polarizability`]],
    [[3], [`dipole`]],
    [[3, 3], [`polarizability`]],
    [[1, 3], []],
  ])(`trajectory_signal_keys filters frame-metadata keys by shape %j`, (shape, keys) => {
    expect(trajectory_signal_keys(make_run(), shape)).toEqual(keys)
    expect(trajectory_signal_keys(undefined, shape)).toEqual([])
  })

  it(`infers custom IR response keys case-insensitively`, async () => {
    const run = make_run({}, (frames) => {
      for (const frame of frames) {
        const dipole = frame.metadata?.dipole
        delete frame.metadata?.dipole
        if (frame.metadata) frame.metadata.Polarization = dipole
      }
    })
    const input = await collect_trajectory_spectroscopy_input(run, {
      infrared_key: `Polarization`,
      polarization_branch_continuous: true,
    })
    expect(input.infrared_signal?.kind).toBe(`polarization`)
  })

  it.each([
    [`no recorded timestep`, undefined, null],
    [`a blank time unit`, { value: 0.5, unit: ` ` }, /time_unit must be a non-empty string/],
  ])(
    `forwards %s verbatim so the calculation decides`,
    async (_label, time_step, calc_error) => {
      const input = await collect_trajectory_spectroscopy_input(make_run({ time_step }))
      expect(input.time_step).toBe(time_step?.value)
      expect(input.time_unit).toBe(time_step?.unit)
      const calculate = () =>
        calc_trajectory_spectroscopy(input, {
          preprocessing: `raw`,
          frequency_unit: `1/step`,
        })
      if (calc_error) expect(calculate).toThrow(calc_error)
      else expect(calculate().frequency_unit).toBe(`1/step`)
    },
  )

  const drop_site_masses = (frames: TrajectoryFrame[]) => {
    for (const frame of frames) delete frame.structure.sites[0].properties.mass
  }
  const keep_frames = () => {}
  it.each([
    [`run-level masses win over site masses`, { atom_masses: [2.5] }, keep_frames, {}, 2.5],
    [`site masses serve when the run carries none`, {}, keep_frames, {}, 1.5],
    [`standard masses fill in when nothing is recorded`, {}, drop_site_masses, {}, 1.008],
    [
      `standard masses override recorded ones on request`,
      {},
      keep_frames,
      { mass_source: `standard` },
      1.008,
    ],
  ] as const)(`%s`, async (_label, extras, mutate, options, expected_mass) => {
    const input = await collect_trajectory_spectroscopy_input(
      make_run(extras, mutate),
      options,
    )
    expect(input.masses).toEqual(Float64Array.from([expected_mass]))
    expect(input.metadata?.mass_source).toBe(expected_mass === 1.008 ? `standard` : `recorded`)
  })

  it.each([
    [
      `invalid recorded masses`,
      (frames: TrajectoryFrame[]) => {
        frames[0].structure.sites[0].properties.mass = Number.POSITIVE_INFINITY
      },
      { mass_source: `auto` },
      /Recorded mass 0 must be finite and > 0/,
    ],
    [
      `requested recorded masses the run lacks`,
      drop_site_masses,
      { mass_source: `recorded` },
      /Recorded masses were requested, but the trajectory carries none/,
    ],
  ] as const)(`rejects %s`, async (_label, mutate, options, error) => {
    await expect(
      collect_trajectory_spectroscopy_input(make_run({}, mutate), options),
    ).rejects.toThrow(error)
  })

  it(`preserves independent-cadence trajectory signals instead of intersecting them`, async () => {
    const run = make_run({
      signals: {
        dipole: {
          values: Float64Array.from([1, 0, 0, 0, 1, 0]),
          sample_shape: [3],
          steps: [0, 4],
        },
        polarizability: {
          values: Float64Array.from(
            Array.from({ length: 3 }, (_unused, idx) => [
              1 + idx,
              0,
              0,
              0,
              2,
              0,
              0,
              0,
              3,
            ]).flat(),
          ),
          sample_shape: [3, 3],
          steps: [0, 2, 4],
        },
      },
    })
    const input = await collect_trajectory_spectroscopy_input(run)
    expect(input.infrared_signal?.series.steps).toEqual([0, 4])
    if (input.raman_signal?.kind === `polarizability`) {
      expect(input.raman_signal.series.steps).toEqual([0, 2, 4])
    }
    expect(input.positions.steps).toHaveLength(N_FRAMES)
  })

  it(`does not collect lower-priority frame or site channels when a run signal wins or a key is declined`, async () => {
    const velocity = {
      values: new Float64Array(N_FRAMES * 3),
      sample_shape: [1, 3],
      steps: every_step,
    }
    // frame 1 carries unusable site velocity and polarizability; collecting them would throw
    const run = make_run({ signals: { velocity } }, (frames) => {
      frames[1].structure.sites[0].properties.velocity = `invalid`
      frames[1].metadata = { ...frames[1].metadata, polarizability: `invalid` }
    })
    const input = await collect_trajectory_spectroscopy_input(run, { raman_key: null })
    expect(input.velocities).toBe(velocity)
    expect(input.raman_signal).toBeNull()
    expect(input.metadata?.signal_sources).toMatchObject({ velocity: `velocity`, raman: null })
  })

  it.each([
    // A LAMMPS dump's box_origin is a vec3 too, but it is geometry, not a response
    [`box_origin`, false],
    [`cell_origin`, false],
    [`Polarization`, true],
    [`dipole_moment`, true],
    [`total_dipole`, true],
    // writer-specific dipole/polarization spellings (extxyz, LAMMPS compute names) must stay
    // selectable in the pane's dropdown
    [`electronic_dipole`, true],
    [`ionic_dipole`, true],
    [`dipole_debye`, true],
    [`total_polarization_quantum`, true],
    [`c_dipole`, true],
    [`current_density`, true],
    [`total_current`, true],
    // matches the unanchored /current/ but is bookkeeping, not a response
    [`current_time`, false],
    [`current_step`, false],
    [`v_mu`, false],
  ])(`offers vec3 metadata %s as an IR candidate: %s`, (key, included) => {
    const run = make_run({}, (frames) => {
      for (const frame of frames) frame.metadata = { ...frame.metadata, [key]: [1, 0, 0] }
    })
    expect(trajectory_signal_keys(run, [3])).toEqual(
      included ? [key, `dipole`].toSorted() : [`dipole`],
    )
  })

  it.each([
    [`polarizability_tensor`, true],
    [`alpha_polariz`, true],
    [`stress`, false],
  ])(`offers 3x3 metadata %s as a Raman candidate: %s`, (key, included) => {
    const tensor = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const run = make_run({}, (frames) => {
      for (const frame of frames) frame.metadata = { ...frame.metadata, [key]: tensor }
    })
    expect(trajectory_signal_keys(run, [3, 3])).toEqual(
      included ? [key, `polarizability`].toSorted() : [`polarizability`],
    )
  })

  // Run-level signals on the full step axis beside positions strided to 0, 2, 4, 6
  const native_cadence_run = (dipole_steps: number[] = every_step) =>
    make_run({
      signals: {
        velocity: {
          values: Float64Array.from(every_step.flatMap((step) => [step, 0, 0])),
          sample_shape: [1, 3],
          steps: every_step,
        },
        dipole: {
          values: Float64Array.from(dipole_steps.flatMap((step) => [Math.sin(step), 0, 0])),
          sample_shape: [3],
          steps: dipole_steps,
        },
      },
    })

  it.each([
    // rigid-motion removal looks every velocity step up in the positions, so velocities are
    // always aligned; a dipole keeps its own cadence unless body-frame rotation needs it
    [undefined, every_step],
    [`raw`, every_step],
    [`remove_com`, every_step],
    [`body_fixed`, [0, 2, 4, 6]],
  ] as const)(
    `with frame_stride 2 and preprocessing %s, velocities follow the kept steps and the dipole keeps steps %j`,
    async (preprocessing, dipole_steps) => {
      const input = await collect_trajectory_spectroscopy_input(native_cadence_run(), {
        frame_stride: 2,
        raman_key: null,
        preprocessing,
      })
      const window_run = native_cadence_run()
      vi.spyOn(window_run, `read_frame`).mockImplementation(() => {
        throw new Error(`Excluded geometry must not be loaded to get its recorded step`)
      })
      const window = await collect_trajectory_spectroscopy_input(window_run, {
        start_frame: 1,
        end_frame: 6,
        frame_stride: 2,
        raman_key: null,
        preprocessing,
      })
      expect(window.positions.steps).toEqual([1, 3, 5])
      expect(window.velocities?.steps).toEqual([1, 3, 5])
      expect(window.infrared_signal?.series.steps).toEqual(
        preprocessing === `body_fixed` ? [1, 3, 5] : [1, 2, 3, 4, 5],
      )
      expect(input.positions.steps).toEqual([0, 2, 4, 6])
      expect(input.velocities).toEqual({
        values: Float64Array.from([0, 0, 0, 2, 0, 0, 4, 0, 0, 6, 0, 0]),
        sample_shape: [1, 3],
        steps: [0, 2, 4, 6],
      })
      expect(input.infrared_signal?.series.steps).toEqual(dipole_steps)
      expect(input.infrared_signal?.series.values).toHaveLength(3 * dipole_steps.length)
      // ...and the spectrum built from it uses the stored velocities and the dipole's own
      // step spacing (1 at native cadence, 2 once restricted to the kept steps)
      const result = calc_trajectory_spectroscopy(input, {
        preprocessing: preprocessing ?? `remove_com`,
        frequency_unit: `1/step`,
      })
      expect(result.velocity_source).toBe(`stored`)
      expect(result.vdos.sample_interval).toBe(2)
      expect(result.ir?.sample_interval).toBe(dipole_steps[1] - dipole_steps[0])
    },
  )

  it(`names a signal the stride leaves without samples on the kept steps`, async () => {
    // a dipole sampled only on the skipped (odd) steps would become an empty spectrum
    const run = native_cadence_run([1, 3, 5, 7])
    await expect(
      collect_trajectory_spectroscopy_input(run, {
        frame_stride: 2,
        raman_key: null,
        preprocessing: `body_fixed`,
      }),
    ).rejects.toThrow(
      `Signal 'dipole' has no samples on the strided position steps (frame_stride=2); use stride 1`,
    )
    // the same dipole is fine when nothing matches its steps to positions
    const input = await collect_trajectory_spectroscopy_input(run, {
      frame_stride: 2,
      raman_key: null,
      preprocessing: `remove_com`,
    })
    expect(input.infrared_signal?.series.steps).toEqual([1, 3, 5, 7])
  })

  it(`requires explicit continuity before accepting polarization as IR input`, async () => {
    const run = make_run({
      signals: {
        polarization: {
          values: new Float64Array(N_FRAMES * 3),
          sample_shape: [3],
          steps: every_step,
        },
      },
    })
    await expect(
      collect_trajectory_spectroscopy_input(run, {
        infrared_key: `polarization`,
        infrared_kind: `polarization`,
      }),
    ).rejects.toThrow(/must be explicitly marked branch_continuous/)
    const input = await collect_trajectory_spectroscopy_input(run, {
      infrared_key: `polarization`,
      infrared_kind: `polarization`,
      polarization_branch_continuous: true,
    })
    expect(input.infrared_signal).toMatchObject({
      kind: `polarization`,
      branch_continuous: true,
    })
  })

  it(`rejects an unknown response key by name`, async () => {
    await expect(
      collect_trajectory_spectroscopy_input(make_run(), { infrared_key: `current` }),
    ).rejects.toThrow(/metadata signal "current"/)
  })

  const open_torch_sim = (
    options: Parameters<typeof make_torch_sim_signal_buffer>[0] = {},
  ): Promise<TrajectoryRun> =>
    make_torch_sim_signal_buffer(options).then((buffer) =>
      open_trajectory(buffer, { filename: `torch-sim.h5` }),
    )

  it(`streams descriptor-backed HDF5 velocity and response signals at native cadence`, async () => {
    const run = await open_torch_sim()
    try {
      expect(Object.values(run.signals ?? {}).every(is_signal_descriptor)).toBe(true)
      expect(trajectory_signal_keys(run)).toEqual([`dipole`, `polarizability`, `velocity`])
      expect(trajectory_signal_keys(run, [2, 3])).toEqual([`velocity`])
      const input = await collect_trajectory_spectroscopy_input(run)
      expect(input.positions).toMatchObject({ n_frames: 4, n_atoms: 2, steps: [0, 1, 2, 3] })
      // the frame-aligned velocity descriptor streams strided through vector_keys and comes
      // back identical to the native-cadence signal_keys read at stride 1
      const native = await run.collect_positions?.({ signal_keys: [`velocity`] })
      expect(input.velocities).toEqual(native?.signals?.velocity)
      expect(input.velocities).toMatchObject({
        sample_shape: [2, 3],
        steps: [0, 1, 2, 3],
        unit: `A/fs`,
      })
      expect(input.infrared_signal?.series.steps).toEqual([0, 2])
      if (input.raman_signal?.kind === `polarizability`) {
        expect(input.raman_signal.series.steps).toEqual([0, 2, 4])
      }
      expect(input.masses).toEqual(Float64Array.from([1.008, 15.999]))
      const window = await collect_trajectory_spectroscopy_input(make_run(), {
        start_frame: 2,
        end_frame: 6,
      })
      expect(window.positions.steps).toEqual([2, 3, 4, 5])
      expect(window.infrared_signal?.series.steps).toEqual([2, 3, 4, 5])
      expect(window.velocities?.steps).toEqual([2, 3, 4, 5])
      expect(input.time_step).toBe(0.5)
      expect(input.time_unit).toBe(`fs`)
      expect(input.metadata).toMatchObject({
        mass_source: `recorded`,
        model: `mace-mpa-0`,
        signal_sources: {
          velocity: `stream:velocity`,
          infrared: { key: `dipole`, kind: `dipole` },
          raman: { key: `polarizability`, kind: `polarizability` },
        },
      })
    } finally {
      run.dispose()
    }
  })

  it.each([
    // a lazy [n_atoms, 3] velocity the parser marked frame_aligned (one sample per frame on
    // the geometry steps) streams strided beside positions; on its own axis it is a
    // native-cadence read, even with as many samples as frames: the steps decide, not the
    // count (the vector_keys read of a shifted axis throws in the parser)
    [
      `on the geometry steps`,
      {},
      { vector_keys: [`velocity`], signal_keys: [`dipole`, `polarizability`] },
      [0, 1, 2, 3],
    ],
    [
      `on its own step axis`,
      { velocity_steps: [0, 2] },
      { vector_keys: [], signal_keys: [`velocity`, `dipole`, `polarizability`] },
      [0, 2],
    ],
    [
      `with one sample per frame on shifted steps`,
      { velocity_steps: [1, 2, 3, 4] },
      { vector_keys: [], signal_keys: [`velocity`, `dipole`, `polarizability`] },
      [1, 2, 3, 4],
    ],
  ])(
    `routes an HDF5 velocity descriptor %s through the matching collect channel`,
    async (_label, fixture, channels, velocity_steps) => {
      const run = await open_torch_sim(fixture)
      try {
        const frame_aligned = channels.vector_keys.length > 0
        expect(run.signals?.velocity).toMatchObject({
          sample_count: velocity_steps.length,
          frame_aligned,
        })
        const keys = { infrared_key: `dipole`, raman_key: `polarizability` }
        expect(spectroscopy_stream_channels(run, keys)).toEqual(channels)
        const input = await collect_trajectory_spectroscopy_input(run, {
          ...keys,
          preprocessing: `remove_com`,
        })
        expect(input.velocities?.steps).toEqual(velocity_steps)
        expect(input.metadata?.signal_sources).toMatchObject({ velocity: `stream:velocity` })
      } finally {
        run.dispose()
      }
    },
  )

  it(`fits a strided velocity descriptor into a budget the native-cadence read overruns`, async () => {
    const run = await open_torch_sim()
    try {
      // stride 2 keeps 2 of 4 frames: positions + velocities + step = 13 values each (208 B)
      // beside 304 B of native-cadence dipole/polarizability; the full velocity series alone
      // would add 224 B, so the signal_keys path cannot fit in 560 B but the vector path does
      const max_bytes = 560
      await expect(
        run.collect_positions?.({
          frame_stride: 2,
          max_bytes,
          signal_keys: [`velocity`, `dipole`, `polarizability`],
        }),
      ).rejects.toThrow(`native-cadence signals need`)
      const input = await collect_trajectory_spectroscopy_input(run, {
        frame_stride: 2,
        max_bytes,
      })
      expect(input.velocities).toMatchObject({ steps: [0, 2], unit: `A/fs` })
    } finally {
      run.dispose()
    }
  })

  it.each([
    // Streamed signals arrive on their native step axis like run-level ones. A stride must
    // drop the skipped velocity steps (rigid-motion removal finds orphan samples otherwise)
    // but only body-frame rotation needs the response signals on the kept steps too
    [
      `remove_com`,
      [0, 2, 4],
      [1, 0, 0, 0, 2, 0, 0, 0, 3, 2, 0, 0, 0, 3, 0, 0, 0, 4, 3, 0, 0, 0, 4, 0, 0, 0, 5],
    ],
    [`body_fixed`, [0, 2], [1, 0, 0, 0, 2, 0, 0, 0, 3, 2, 0, 0, 0, 3, 0, 0, 0, 4]],
  ] as const)(
    `sub-samples HDF5-streamed velocities to the strided position steps and responses only under %s`,
    async (preprocessing, raman_steps, raman_values) => {
      const run = await open_torch_sim()
      try {
        const input = await collect_trajectory_spectroscopy_input(run, {
          frame_stride: 2,
          preprocessing,
        })
        expect(input.positions.steps).toEqual([0, 2])
        expect(input.velocities).toMatchObject({ sample_shape: [2, 3], steps: [0, 2] })
        expect(input.velocities?.values).toEqual(
          Float64Array.from([0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17].map((idx) => idx / 10)),
        )
        expect(input.infrared_signal?.series.steps).toEqual([0, 2])
        expect(input.raman_signal?.series.steps).toEqual(raman_steps)
        expect(input.raman_signal?.series.values).toEqual(Float64Array.from(raman_values))
      } finally {
        run.dispose()
      }
    },
  )

  it(`names the analysis when a run cannot serve a full pass`, async () => {
    const run: TrajectoryRun = { ...make_run(), collect_positions: undefined }
    await expect(collect_trajectory_spectroscopy_input(run)).rejects.toThrow(
      /Spectroscopy needs a pass over all 8 frames/,
    )
  })
})
