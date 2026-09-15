// Every TrajectoryRun implementation against one contract table: frame_count, preview,
// read_frame (sync vs async, range, abort), collect_positions parity with the memory run on
// identical data, progressive properties and dispose semantics.
import type { ParseProgress, TrajectoryFrame } from '$lib/trajectory'
import { open_trajectory, trajectory_from_frames } from '$lib/trajectory/open'
import {
  summarize_run,
  sync_run,
  TrajectoryProperties,
  type TrajectoryRun,
} from '$lib/trajectory/run'
import { parse_xyz_trajectory } from '$lib/trajectory/parse/xyz'
import { create_warning_collector } from '$lib/trajectory/parse/shared'
import { host_run } from '$lib/trajectory/runs/host'
import { indexed_text_run } from '$lib/trajectory/runs/indexed-text'
import { serve_run_over_port, worker_run } from '$lib/trajectory/runs/worker'
import { describe, expect, it, test, vi } from 'vitest'
import { max_abs_error } from '../numeric-helpers'
import { make_trajectory_frame, read_binary_test_file } from '../test-fixtures'
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
  return worker_run(serve_run_over_port(served), summarize_run(served))
}

const expect_listener_errors = (notify: () => void, failures: Error[]): void => {
  const attempt = vi.fn(notify)
  expect(attempt).toThrow(Error)
  const error: unknown = attempt.mock.results[0].value
  if (failures.length === 1) expect(error).toBe(failures[0])
  else {
    expect(error).toBeInstanceOf(AggregateError)
    expect(error).toHaveProperty(`errors`, failures)
  }
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

it.each([27, 100_000])(
  `uses the full %i atom count to gate frame-backed analysis`,
  (atom_count) => {
    const run = sync_run({
      label: `sampled preview`,
      atom_count,
      frame_count: 1,
      preview: reference_frames[0],
      read: () => reference_frames[0],
      properties: new TrajectoryProperties(),
      provenance: {},
      metadata: {},
      warnings: [],
    })
    expect(run.atom_count).toBe(atom_count)
    expect(run.read_atoms !== undefined).toBe(atom_count === 27)
    run.dispose()
  },
)

describe.each(RUN_CASES)(
  `$name run`,
  ({ make, sync_reads, has_collect, n_frames, n_atoms }) => {
    it(`exposes frame_count, a frame-0 preview and range-checked frame reads`, async () => {
      const run = await make()
      expect(run.frame_count).toBe(n_frames)
      expect(run.atom_count).toBe(n_atoms)
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
      for (const frame_idx of [0, n_frames - 1]) {
        await expect(
          (async () => run.read_frame(frame_idx, controller.signal))(),
        ).rejects.toBe(reason)
      }
      run.dispose()
    })

    it(`dispose is idempotent and later reads fail`, async () => {
      const run = await make()
      run.dispose()
      run.dispose()
      for (const frame_idx of [0, n_frames - 1]) {
        await expect((async () => run.read_frame(frame_idx))()).rejects.toThrow(/disposed/)
      }
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
  it(`rejects a throwing progress callback, aborts its work and preserves other requests`, async () => {
    const served = trajectory_from_frames(reference_frames)
    let collect_signal: AbortSignal | undefined
    served.collect_positions = ({ signal, on_progress } = {}) =>
      new Promise((_resolve, reject) => {
        collect_signal = signal
        signal?.addEventListener(`abort`, () => reject(new Error(`Collection aborted`)), {
          once: true,
        })
        on_progress?.({ current: 0, total: 1, stage: `read` })
      })
    const run = worker_run(serve_run_over_port(served), summarize_run(served))
    const controller = new AbortController()
    const remove_listener = vi.spyOn(controller.signal, `removeEventListener`)
    const failure = new Error(`Progress observer failed`)
    const collecting = run.collect_positions?.({
      signal: controller.signal,
      on_progress: () => {
        throw failure
      },
    })
    const reading = run.read_frame(1)
    await expect(collecting).rejects.toBe(failure)
    await expect(reading).resolves.toEqual(reference_frames[1])
    expect(collect_signal?.aborted).toBe(true)
    expect(remove_listener).toHaveBeenCalledWith(`abort`, expect.any(Function))
    await expect(run.read_frame(2)).resolves.toEqual(reference_frames[2])
    run.dispose()
  })

  it.each([
    [false, 0],
    [true, 0],
    [false, 1],
    [false, 2],
  ] as const)(
    `streams properties (nested completion: %s, listener failures: %s)`,
    async (finish_during_batch, error_count) => {
      const served = trajectory_from_frames(reference_frames)
      // Progressive source: replace the static properties with a streaming one
      const progressive = new TrajectoryProperties()
      Object.defineProperty(served, `properties`, { value: progressive })
      if (finish_during_batch) {
        progressive.subscribe((_batch, complete) => {
          if (!complete) progressive.finish()
        })
      }
      const release = vi.fn()
      const port = serve_run_over_port(served)
      const add_listener = vi.spyOn(port, `addEventListener`)
      const run = worker_run(port, summarize_run(served), release)
      expect(run.properties.rows).toHaveLength(0)
      const batch = [
        { frame_number: 0, step: 0, properties: { energy: -1 } },
        { frame_number: 1, step: 10, properties: { energy: -2 } },
      ]
      if (error_count) {
        const failures = [
          new Error(`Batch observer failed`),
          new Error(`Finish observer failed`),
        ]
        run.properties.subscribe((_batch, complete) => {
          if (!complete) throw failures[0]
          if (error_count === 2) throw failures[1]
        })
        const observer = vi.fn()
        run.properties.subscribe(observer)
        const handler = add_listener.mock.calls.find(([type]) => type === `message`)?.[1]
        if (typeof handler !== `function`) throw new Error(`Missing worker message handler`)
        // Invoke directly so the test can assert errors normally reported by the event loop.
        expect_listener_errors(
          () =>
            handler.call(
              port,
              new MessageEvent(`message`, {
                data: { properties: batch, complete: true },
              }),
            ),
          failures.slice(0, error_count),
        )
        expect(observer.mock.calls).toEqual([
          [batch, false],
          [[], true],
        ])
        expect(run.properties.complete).toBe(true)
      } else {
        progressive.push(batch)
        progressive.finish()
      }
      await run.properties.done
      expect(run.properties.rows.map((row) => row.properties.energy)).toEqual([-1, -2])
      run.dispose()
      run.dispose()
      expect(release).toHaveBeenCalledOnce()
      await expect(Promise.resolve(run.read_frame(2))).rejects.toThrow(/disposed/)
    },
  )

  it.each([`dispose`, `messageerror`, `close failure`])(
    `rejects pending reads and releases the worker despite observer/port failure during %s`,
    async (phase) => {
      const served = trajectory_from_frames(reference_frames)
      Object.defineProperty(served, `properties`, { value: new TrajectoryProperties() })
      const port = serve_run_over_port(served)
      const close_port = port.close.bind(port)
      const close = vi.spyOn(port, `close`)
      const add_listener = vi.spyOn(port, `addEventListener`)
      const release = vi.fn()
      const run = worker_run(port, summarize_run(served), release)
      const pending = Promise.resolve(run.read_frame(3))
      const failure = new Error(`${phase} callback failed`)
      if (phase === `close failure`)
        close.mockImplementationOnce(() => {
          close_port()
          throw failure
        })
      else
        run.properties.subscribe(() => {
          throw failure
        })
      const dispose = () => {
        if (phase !== `messageerror`) return run.dispose()
        const handler = add_listener.mock.calls.find(([type]) => type === `messageerror`)?.[1]
        if (typeof handler !== `function`) throw new Error(`Missing messageerror handler`)
        handler.call(port, new MessageEvent(`messageerror`))
      }
      expect(dispose).toThrow(failure)
      const reason = phase === `messageerror` ? /deserialize/ : /disposed/
      await expect(pending).rejects.toThrow(reason)
      await run.properties.done
      run.dispose()
      expect(close).toHaveBeenCalledOnce()
      expect(release).toHaveBeenCalledOnce()
      await expect(Promise.resolve(run.read_frame(0))).rejects.toThrow(reason)
    },
  )
})

describe(`TrajectoryProperties`, () => {
  it.each([`synchronous`, `host`])(
    `releases a %s source even when its completion subscriber throws`,
    async (kind) => {
      const release = vi.fn()
      const source = sync_run({
        label: `test trajectory`,
        frame_count: 1,
        read: () => reference_frames[0],
        properties: new TrajectoryProperties(),
        release: kind === `synchronous` ? release : undefined,
        provenance: {},
        metadata: {},
        warnings: [],
      })
      const run =
        kind === `host`
          ? host_run(summarize_run(source), async () => reference_frames[0], release)
          : source
      const failure = new Error(`Completion observer failed`)
      run.properties.subscribe(() => {
        throw failure
      })
      expect(() => run.dispose()).toThrow(failure)
      await run.properties.done
      run.dispose()
      expect(release).toHaveBeenCalledOnce()
      await expect((async () => run.read_frame(0))()).rejects.toThrow(/disposed/)
    },
  )

  it(`delivers nested batches before completion and snapshots queued rows`, () => {
    const properties = new TrajectoryProperties()
    properties.subscribe((batch) => {
      if (batch[0]?.frame_number !== 0) return
      const nested = [{ frame_number: 1, step: 1, properties: {} }]
      properties.push(nested)
      nested[0] = { frame_number: 99, step: 99, properties: {} }
      properties.finish()
    })
    const seen: [number[], boolean][] = []
    properties.subscribe((batch, complete) =>
      seen.push([batch.map(({ frame_number }) => frame_number), complete]),
    )
    properties.push([{ frame_number: 0, step: 0, properties: {} }])
    expect(seen).toEqual([
      [[0], false],
      [[1], false],
      [[], true],
    ])
    expect(properties.rows.map(({ frame_number }) => frame_number)).toEqual([0, 1])
  })

  it.each([
    [false, 1],
    [true, 1],
    [true, 2],
  ] as const)(
    `drains notifications after listener errors (finish: %s, errors: %s)`,
    (finish_before_throw, error_count) => {
      const properties = new TrajectoryProperties()
      const failures = Array.from(
        { length: error_count },
        (_, idx) => new Error(`listener ${idx} failed`),
      )
      for (const failure of failures) {
        const unsubscribe = properties.subscribe(() => {
          unsubscribe()
          if (finish_before_throw) properties.finish()
          throw failure
        })
      }
      const listener = vi.fn()
      properties.subscribe(listener)
      const first_batch = [{ frame_number: 0, step: 0, properties: {} }]
      const next_batch = [{ frame_number: 1, step: 1, properties: {} }]
      expect_listener_errors(() => properties.push(first_batch), failures)
      if (finish_before_throw) properties.finish()
      else properties.push(next_batch)
      expect(listener.mock.calls).toEqual([
        [first_batch, false],
        [finish_before_throw ? [] : next_batch, finish_before_throw],
      ])
    },
  )

  it.each([`push`, `finish`] as const)(
    `%s notifies later subscribers when a listener unsubscribes itself`,
    (method) => {
      const properties = new TrajectoryProperties()
      const first = vi.fn(() => unsubscribe())
      const unsubscribe = properties.subscribe(first)
      const second = vi.fn()
      properties.subscribe(second)
      const notify = () =>
        method === `push`
          ? properties.push([{ frame_number: 0, step: 0, properties: {} }])
          : properties.finish()
      notify()
      expect(second).toHaveBeenCalledTimes(1)
      notify()
      expect(first).toHaveBeenCalledTimes(1)
      expect(second).toHaveBeenCalledTimes(method === `push` ? 2 : 1)
    },
  )

  it(`keeps rows sorted and deduplicated across out-of-order batches`, () => {
    const properties = new TrajectoryProperties()
    const seen: number[][] = []
    properties.subscribe((batch) => seen.push(batch.map((row) => row.frame_number)))
    properties.push([{ frame_number: 5, step: 5, properties: {} }])
    const first_snapshot = properties.rows
    expect(properties.rows.map((row) => row.frame_number)).toEqual([5])
    properties.push([
      { frame_number: 5, step: 5, properties: { dup: 1 } },
      { frame_number: 1, step: 1, properties: {} },
    ])
    expect(properties.rows.map((row) => row.frame_number)).toEqual([1, 5])
    expect(properties.rows[1].properties).toEqual({}) // The first copy of a frame wins.
    expect(first_snapshot.map((row) => row.frame_number)).toEqual([5])
    expect(seen).toEqual([[5], [5, 1]]) // Sorting must not reorder the caller's batch.
    properties.finish()
    expect(properties.complete).toBe(true)
    expect(() => properties.push([{ frame_number: 9, step: 9, properties: {} }])).toThrow(
      /after finish/,
    )
    properties.finish() // idempotent
  })

  it.each([
    [0, 1, 2],
    [2, 1, 0],
    [0, 1, 2, 1],
  ])(`owns its initial row snapshot %j`, (...frame_numbers) => {
    const rows = frame_numbers.map((frame_number) => ({
      frame_number,
      step: frame_number,
      properties: {},
    }))
    const properties = new TrajectoryProperties(rows)
    expect(rows.map((row) => row.frame_number)).toEqual(frame_numbers)
    rows[0] = { frame_number: 99, step: 99, properties: {} }
    expect(properties.rows.map((row) => row.frame_number)).toEqual([0, 1, 2])
    const previous_snapshot = properties.rows
    properties.push([{ frame_number: 3, step: 3, properties: {} }])
    expect(previous_snapshot.map((row) => row.frame_number)).toEqual([0, 1, 2])
    expect(properties.rows.map((row) => row.frame_number)).toEqual([0, 1, 2, 3])
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
