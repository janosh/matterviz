// Every TrajectoryRun implementation against one contract table: frame_count, preview,
// read_frame (sync vs async, range, abort), collect_positions parity with the memory run on
// identical data, progressive properties and dispose semantics.
import type { ParseProgress, TrajectoryFrame } from '$lib/trajectory'
import { open_trajectory, trajectory_from_frames } from '$lib/trajectory/open'
import { summarize_run, TrajectoryProperties, type TrajectoryRun } from '$lib/trajectory/run'
import { parse_xyz_trajectory } from '$lib/trajectory/parse/xyz'
import { create_warning_collector } from '$lib/trajectory/parse/shared'
import { host_run } from '$lib/trajectory/runs/host'
import { indexed_text_run } from '$lib/trajectory/runs/indexed-text'
import { serve_run_over_port, worker_run } from '$lib/trajectory/runs/worker'
import { describe, expect, it, test } from 'vitest'
import { max_abs_error } from '../numeric-helpers'
import { make_trajectory_frame, read_binary_test_file } from '../setup'
import { synthetic_extxyz } from './fixtures'

const N_FRAMES = 40
const N_ATOMS = 27
const XYZ_TEXT = synthetic_extxyz(N_FRAMES, N_ATOMS)
const collector = create_warning_collector()
const reference_frames = parse_xyz_trajectory(XYZ_TEXT, collector).frames

const next_tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

const ase_buffer = read_binary_test_file(`ase-LiMnO2-chgnet-relax.traj`)

// A port pair in-process: worker side serves a memory run, client side is a worker_run
const make_worker_run = (): TrajectoryRun => {
  const served = trajectory_from_frames(reference_frames)
  let released = 0
  const port = serve_run_over_port(served)
  const run = worker_run(port, summarize_run(served), () => released++)
  return Object.assign(run, { released: () => released })
}

const make_host_run = (): TrajectoryRun => {
  const backing = trajectory_from_frames(reference_frames)
  return host_run(summarize_run(backing), async (frame_idx, signal) => {
    await next_tick()
    signal?.throwIfAborted()
    return backing.read_frame(frame_idx)
  })
}

type RunCase = {
  name: string
  make: () => Promise<TrajectoryRun> | TrajectoryRun
  sync_reads: boolean
  has_collect: boolean
  n_frames: number
  n_atoms: number
}

const RUN_CASES: RunCase[] = [
  {
    name: `memory`,
    make: () => trajectory_from_frames(reference_frames),
    sync_reads: true,
    has_collect: true,
    n_frames: N_FRAMES,
    n_atoms: N_ATOMS,
  },
  {
    name: `indexed xyz`,
    make: () =>
      indexed_text_run(
        XYZ_TEXT,
        `xyz`,
        { filename: `synthetic.extxyz` },
        create_warning_collector(),
      ),
    sync_reads: true,
    has_collect: true,
    n_frames: N_FRAMES,
    n_atoms: N_ATOMS,
  },
  {
    name: `indexed ase`,
    make: () =>
      indexed_text_run(
        ase_buffer.slice(0),
        `ase`,
        { filename: `relax.traj` },
        create_warning_collector(),
      ),
    sync_reads: true,
    has_collect: true,
    n_frames: 2,
    n_atoms: 8,
  },
  {
    name: `hdf5`,
    make: () =>
      open_trajectory(read_binary_test_file(`gold-nanoparticle-md.h5`), {
        filename: `gold.h5`,
      }),
    sync_reads: true,
    has_collect: true,
    n_frames: 100,
    n_atoms: 55,
  },
  {
    name: `worker port`,
    make: make_worker_run,
    sync_reads: false,
    has_collect: true,
    n_frames: N_FRAMES,
    n_atoms: N_ATOMS,
  },
  {
    name: `host`,
    make: make_host_run,
    sync_reads: false,
    has_collect: false,
    n_frames: N_FRAMES,
    n_atoms: N_ATOMS,
  },
]

describe.each(RUN_CASES)(
  `$name run`,
  ({ make, sync_reads, has_collect, n_frames, n_atoms }) => {
    it(`exposes frame_count, a frame-0 preview and range-checked frame reads`, async () => {
      const run = await make()
      expect(run.frame_count).toBe(n_frames)
      expect(run.preview.structure.sites).toHaveLength(n_atoms)
      // frame 0 is always served synchronously (it IS the preview)
      expect(run.read_frame(0)).toBe(run.preview)
      const last = run.read_frame(n_frames - 1)
      if (sync_reads) expect(last).not.toBeInstanceOf(Promise)
      else expect(last).toBeInstanceOf(Promise)
      const last_frame = await last
      expect(last_frame.structure.sites).toHaveLength(n_atoms)
      expect(last_frame.step).toBeGreaterThanOrEqual(run.preview.step)
      for (const bad_idx of [-1, n_frames, 1.5, NaN]) {
        expect(() => run.read_frame(bad_idx)).toThrow(RangeError)
      }
      expect(run.collect_positions !== undefined).toBe(has_collect)
      run.dispose()
    })

    it(`read_frame rejects with the abort reason`, async () => {
      const run = await make()
      const controller = new AbortController()
      const reason = new Error(`stale scrub`)
      const pending = run.read_frame(n_frames - 1, controller.signal)
      controller.abort(reason)
      if (pending instanceof Promise) await expect(pending).rejects.toBe(reason)
      else expect(pending.structure.sites).toHaveLength(n_atoms) // sync reads cannot be aborted
      run.dispose()
    })

    it(`dispose is idempotent and later reads fail`, async () => {
      const run = await make()
      run.dispose()
      run.dispose()
      const read = async (): Promise<TrajectoryFrame> => run.read_frame(n_frames - 1)
      await expect(read()).rejects.toThrow(/disposed/)
      if (run.collect_positions)
        await expect(run.collect_positions()).rejects.toThrow(/disposed/)
      expect(run.properties.complete).toBe(true)
    })

    it(`properties rows cover the run in frame order`, async () => {
      const run = await make()
      await run.properties.done
      const { rows } = run.properties
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.length).toBeLessThanOrEqual(n_frames)
      expect(rows[0].frame_number).toBe(0)
      expect(
        rows.every((row, idx) => idx === 0 || row.frame_number > rows[idx - 1].frame_number),
      ).toBe(true)
      const last_row = rows.at(-1)
      expect(last_row?.step).toBe((await run.read_frame(last_row?.frame_number ?? 0)).step)
      run.dispose()
    })
  },
)

describe(`collect_positions parity with the memory run`, () => {
  test.each(
    RUN_CASES.filter(
      ({ name, has_collect }) => has_collect && name !== `hdf5` && name !== `indexed ase`,
    ),
  )(`$name matches to max |Δ| = 0`, async ({ make }) => {
    const reference = await trajectory_from_frames(reference_frames).collect_positions?.({
      frame_stride: 3,
      vector_keys: [`force`],
    })
    const run = await make()
    const stream = await run.collect_positions?.({ frame_stride: 3, vector_keys: [`force`] })
    const window = await run.collect_positions?.({
      start_frame: 2,
      end_frame: 8,
      frame_stride: 3,
      vector_keys: [`force`],
    })
    expect(window?.steps).toEqual([reference_frames[2].step, reference_frames[5].step])
    expect(window?.positions).toEqual(
      Float64Array.from(
        [2, 5].flatMap((idx) =>
          reference_frames[idx].structure.sites.flatMap((site) => site.xyz),
        ),
      ),
    )
    if (!reference || !stream) throw new Error(`collect_positions missing`)
    expect(stream.n_frames).toBe(reference.n_frames)
    expect(stream.n_atoms).toBe(N_ATOMS)
    expect(stream.steps).toEqual(reference.steps)
    expect(stream.elements).toEqual(reference.elements)
    expect(max_abs_error(stream.positions, reference.positions)).toBe(0)
    expect(max_abs_error(stream.vectors?.force ?? [], reference.vectors?.force ?? [])).toBe(0)
    expect(stream.lattice_matrices?.map((matrix) => matrix?.flat())).toEqual(
      reference.lattice_matrices?.map((matrix) => matrix?.flat()),
    )
    run.dispose()
  })

  it(`worker port collect forwards progress and honours abort`, async () => {
    const run = make_worker_run()
    const controller = new AbortController()
    controller.abort()
    await expect(run.collect_positions?.({ signal: controller.signal })).rejects.toThrow(
      /abort/i,
    )
    run.dispose()

    // accumulate_positions reports once per 500 collected frames, so a 1000-frame run must
    // deliver exactly two progress messages across the port, at frames 499 and 999
    const n_frames = 1000
    const served = trajectory_from_frames(
      Array.from({ length: n_frames }, (_unused, frame_idx) =>
        make_trajectory_frame(frame_idx, 1),
      ),
    )
    const long_run = worker_run(serve_run_over_port(served), summarize_run(served), () => {})
    const progress: ParseProgress[] = []
    const stream = await long_run.collect_positions?.({
      on_progress: (step) => progress.push(step),
    })
    expect(stream?.n_frames).toBe(n_frames)
    expect(progress.map(({ current }) => current)).toEqual([49.9, 99.9])
    expect(progress.map(({ total, stage }) => [total, stage])).toEqual([
      [100, `Reading positions: 499/1000`],
      [100, `Reading positions: 999/1000`],
    ])
    long_run.dispose()
  })

  it(`hdf5 collect_positions matches its own read_frame positions`, async () => {
    const run = await open_trajectory(read_binary_test_file(`gold-nanoparticle-md.h5`), {
      filename: `gold.h5`,
    })
    const stream = await run.collect_positions?.({
      frame_stride: 5,
      start_frame: 2,
      end_frame: 15,
    })
    if (!stream) throw new Error(`no stream`)
    expect(stream.n_frames).toBe(3)
    for (const [sample_idx, frame_idx] of [2, 7, 12].entries()) {
      const frame = await run.read_frame(frame_idx)
      const from_frame = frame.structure.sites.flatMap((site) => site.xyz)
      const offset = sample_idx * stream.n_atoms * 3
      expect(
        max_abs_error(
          from_frame,
          stream.positions.subarray(offset, offset + from_frame.length),
        ),
      ).toBe(0)
    }
    run.dispose()
  })
})

describe(`worker-served run lifecycle`, () => {
  it(`streams property batches from the served run and releases on dispose`, async () => {
    const served = trajectory_from_frames(reference_frames, {
      properties: [{ frame_number: 0, step: 0, properties: { energy: 1 } }],
    })
    // Progressive source: replace the static properties with a streaming one
    const progressive = new TrajectoryProperties()
    Object.defineProperty(served, `properties`, { value: progressive })
    let released = 0
    const port = serve_run_over_port(served)
    const run = worker_run(port, summarize_run(served), () => released++)
    expect(run.properties.rows).toHaveLength(0)
    progressive.push([
      { frame_number: 0, step: 0, properties: { energy: -1 } },
      { frame_number: 1, step: 10, properties: { energy: -2 } },
    ])
    progressive.finish()
    await run.properties.done
    expect(run.properties.rows.map((row) => row.properties.energy)).toEqual([-1, -2])
    run.dispose()
    run.dispose()
    expect(released).toBe(1)
    await expect(Promise.resolve(run.read_frame(2))).rejects.toThrow(/disposed/)
  })

  it(`a disposed served run rejects in-flight reads`, async () => {
    const run = make_worker_run()
    const pending = run.read_frame(3) as Promise<TrajectoryFrame>
    run.dispose()
    await expect(pending).rejects.toThrow(/disposed/)
  })
})

describe(`TrajectoryProperties`, () => {
  it(`keeps rows sorted and deduplicated across out-of-order batches`, () => {
    const properties = new TrajectoryProperties()
    const seen: number[][] = []
    properties.subscribe((batch) => seen.push(batch.map((row) => row.frame_number)))
    properties.push([{ frame_number: 5, step: 5, properties: {} }])
    expect(properties.rows.map((row) => row.frame_number)).toEqual([5])
    properties.push([
      { frame_number: 1, step: 1, properties: {} },
      { frame_number: 5, step: 5, properties: { dup: 1 } },
    ])
    expect(properties.rows.map((row) => row.frame_number)).toEqual([1, 5])
    expect(seen).toEqual([[5], [1, 5]])
    properties.finish()
    expect(properties.complete).toBe(true)
    expect(() => properties.push([{ frame_number: 9, step: 9, properties: {} }])).toThrow(
      /after finish/,
    )
    properties.finish() // idempotent
  })
})

describe(`trajectory_from_frames validation`, () => {
  it.each([
    [`no frames`, [] as TrajectoryFrame[], {}, /at least one frame/],
    [`bad step`, [{ ...reference_frames[0], step: NaN }], {}, /invalid step/],
    [
      `wrong mass count`,
      reference_frames.slice(0, 1),
      { atom_masses: [1, 2] },
      /atom_masses has 2/,
    ],
    [
      `signal length`,
      reference_frames.slice(0, 1),
      { signals: { dipole: { values: new Float64Array(2), sample_shape: [3], steps: [0] } } },
      /signals.dipole needs a Float64Array of 3 values/,
    ],
    [
      `signal sample shape`,
      reference_frames.slice(0, 1),
      { signals: { dipole: { values: new Float64Array(), sample_shape: [0], steps: [0] } } },
      /sample_shape must be scalar/,
    ],
  ])(`rejects %s`, (_label, frames, extras, pattern) => {
    expect(() => trajectory_from_frames(frames, extras)).toThrow(pattern)
  })

  // Issue #449: a bag of generated structures in one XYZ loads and scrubs; only the
  // displacement analyses need a constant atom count and reject it when asked
  it(`accepts frames with differing atom counts and defers the check to collect_positions`, async () => {
    const [first, second] = reference_frames
    const shrunk = { ...second, structure: { sites: second.structure.sites.slice(1) } }
    const run = trajectory_from_frames([first, shrunk])
    expect((await run.read_frame(1)).structure.sites).toHaveLength(N_ATOMS - 1)
    await expect(run.collect_positions?.()).rejects.toThrow(
      `Atom count changed at frame 1: expected ${N_ATOMS} atoms, got ${N_ATOMS - 1}`,
    )
  })

  it(`fills property rows from the frames and exposes extras`, () => {
    const run = trajectory_from_frames(reference_frames, {
      provenance: { filename: `x.xyz` },
      time_step: { value: 2, unit: `fs` },
      metadata: { note: 1 },
      warnings: [`w`],
    })
    expect(run.properties.complete).toBe(true)
    expect(run.properties.rows).toHaveLength(N_FRAMES)
    expect(run.properties.rows[3]).toMatchObject({ frame_number: 3, step: 30 })
    expect(run.properties.rows[3].properties.energy).toBeCloseTo(-5 * N_ATOMS - 0.003, 9)
    expect(run.time_step).toEqual({ value: 2, unit: `fs` })
    expect(run.warnings).toEqual([`w`])
    expect(run.provenance.filename).toBe(`x.xyz`)
  })
})
