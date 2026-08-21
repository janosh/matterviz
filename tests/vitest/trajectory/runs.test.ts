// Every TrajectoryRun implementation against one contract table: frame_count, preview,
// read_frame (sync vs async, range, abort), collect_positions parity with the memory run on
// identical data, progressive properties and dispose semantics.
import type { TrajectoryFrame } from '$lib/trajectory'
import { open_trajectory, trajectory_from_frames } from '$lib/trajectory/open'
import { summarize_run, TrajectoryProperties, type TrajectoryRun } from '$lib/trajectory/run'
import { parse_xyz_trajectory } from '$lib/trajectory/parse/xyz'
import { create_warning_collector } from '$lib/trajectory/parse/shared'
import { host_run } from '$lib/trajectory/runs/host'
import { indexed_text_run } from '$lib/trajectory/runs/indexed-text'
import { serve_run_over_port, worker_run } from '$lib/trajectory/runs/worker'
import { describe, expect, it, test } from 'vitest'
import { make_rng, max_abs_error } from '../numeric-helpers'
import { read_binary_test_file } from '../setup'

// Deterministic EXTXYZ: a cubic cell that breathes, atoms jittering around a grid, an energy
// that drifts with the frame index. Shared with open.test.ts and the perf test.
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
    await expect(run.collect_positions?.({}, undefined, controller.signal)).rejects.toThrow(
      /abort/i,
    )
    const progress: number[] = []
    const stream = await run.collect_positions?.({}, (step) => progress.push(step.current))
    expect(stream?.n_frames).toBe(N_FRAMES)
    run.dispose()
  })

  it(`hdf5 collect_positions matches its own read_frame positions`, async () => {
    const run = await open_trajectory(read_binary_test_file(`gold-nanoparticle-md.h5`), {
      filename: `gold.h5`,
    })
    const stream = await run.collect_positions?.({ frame_stride: 5 })
    if (!stream) throw new Error(`no stream`)
    expect(stream.n_frames).toBe(Math.ceil(run.frame_count / 5))
    for (const [sample_idx, frame_idx] of [0, 5, 10].entries()) {
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
    [
      `atom count change`,
      [
        reference_frames[0],
        {
          ...reference_frames[1],
          structure: { sites: reference_frames[1].structure.sites.slice(1) },
        },
      ],
      {},
      /atoms, expected/,
    ],
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
      /signals.dipole needs/,
    ],
  ])(`rejects %s`, (_label, frames, extras, pattern) => {
    expect(() => trajectory_from_frames(frames, extras)).toThrow(pattern)
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
