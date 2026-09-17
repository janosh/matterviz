import { materialize_frame_result } from '$lib/trajectory/frame'
import * as preparation_module from '$lib/trajectory/prepare'
import type { ParseResult } from '$lib/file-viewer/parse'
import type {
  ParseWorkerRequest,
  ParseWorkerResponse,
  WorkerLike,
} from '$lib/file-viewer/parse-in-worker'
import { parse_in_worker } from '$lib/file-viewer/parse-in-worker'
import { handle_parse_worker_request } from '$lib/file-viewer/parse-worker'
import { prediction_to_json } from '$lib/structure/prediction'
import { make_grid, make_volume } from '../test-fixtures'
import type {
  Hdf5GroupSelectionRequiredError,
  TrajectoryFrame,
  TrajectoryRun,
} from '$lib/trajectory'
import { summarize_run, trajectory_from_frames } from '$lib/trajectory'
import { dispose_run_port, serve_run_over_port } from '$lib/trajectory/runs/worker'
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest'

// MessagePort/Worker postMessage take no targetOrigin (that's window.postMessage)
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin

const structure_result: ParseResult = {
  type: `structure`,
  data: { sites: [] },
  filename: `mp-1.cif`,
}
const frame: TrajectoryFrame = {
  step: 0,
  structure: {
    charge: 0,
    sites: [
      {
        species: [{ element: `H`, occu: 1, oxidation_state: 0 }],
        xyz: [1, 2, 3],
        abc: [1, 2, 3],
        label: `H1`,
        properties: {},
      },
    ],
  },
}

interface FakeWorker extends WorkerLike {
  emit: (type: string, event: Event) => void
  posted: { request: ParseWorkerRequest; transfer: readonly Transferable[] }[]
  run_ports: MessagePort[]
  terminate: Mock<() => void>
}

const make_fake_worker = (
  respond: (request: ParseWorkerRequest) => ParseWorkerResponse | null = (request) => ({
    id: request.id,
    result: structure_result,
  }),
): FakeWorker => {
  const listeners = new Map<string, EventListener[]>()
  const emit = (type: string, event: Event): void => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  const worker: FakeWorker = {
    posted: [],
    run_ports: [],
    postMessage: (message: unknown, options?: StructuredSerializeOptions | Transferable[]) => {
      const transfer = Array.isArray(options) ? options : (options?.transfer ?? [])
      const request = structuredClone(message, {
        transfer: [...transfer],
      }) as ParseWorkerRequest
      worker.posted.push({ request, transfer })
      const response = respond(request)
      if (!response) return
      const cloned = structuredClone(response, {
        transfer: response.run_port ? [response.run_port] : [],
      })
      if (cloned.run_port) worker.run_ports.push(cloned.run_port)
      queueMicrotask(() => emit(`message`, new MessageEvent(`message`, { data: cloned })))
    },
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener as EventListener])
    },
    emit,
    terminate: vi.fn(),
  }
  return worker
}

const trajectory_response = (request: ParseWorkerRequest): ParseWorkerResponse => {
  const run = trajectory_from_frames([frame], { provenance: { filename: request.filename } })
  const run_port = serve_run_over_port(run)
  return {
    id: request.id,
    result: {
      type: `trajectory`,
      filename: request.filename,
      data: summarize_run(run),
    },
    run_port,
  }
}

const preparation = {
  bonding_strategy: `electroneg_ratio` as const,
  bonding_options: {},
  bonds: false,
}
const preparation_workers = (atom_count: number, format = `hdf5`, defer_startup = false) => {
  const workers: FakeWorker[] = []
  const pending: { worker_idx: number; idx: number; resolve: () => void }[] = []
  const openings: (() => void)[] = []
  const factory = () => {
    const worker_idx = workers.length
    const worker = make_fake_worker((request) => {
      const run = trajectory_from_frames(
        Array.from({ length: 12 }, (_, idx) => ({ ...frame, step: idx })),
        {
          provenance: { format, filename: request.filename, hdf5_group: `/device` },
        },
      )
      // Preparation must work without hotspot analysis, including on replicas.
      delete run.compute_hotspots
      const read_frame = run.read_frame
      run.read_frame = (idx) =>
        new Promise((resolve) => {
          pending.push({ worker_idx, idx, resolve: () => resolve(read_frame(idx)) })
        })
      const response = {
        id: request.id,
        result: {
          type: `trajectory` as const,
          filename: request.filename,
          data: { ...summarize_run(run), atom_count },
        },
        run_port: serve_run_over_port(run),
      }
      if (!defer_startup || worker_idx === 0) return response
      openings.push(() => {
        const cloned = structuredClone(response, { transfer: [response.run_port] })
        worker.run_ports.push(cloned.run_port)
        worker.emit(`message`, new MessageEvent(`message`, { data: cloned }))
      })
      return null
    })
    workers.push(worker)
    return worker
  }
  const warm = async (run: TrajectoryRun) => {
    if (!run.prepare_frame) throw new Error(`Expected frame preparer`)
    const first = run.prepare_frame(0, preparation)
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    pending.shift()?.resolve()
    await first
  }
  const open = async (
    content: File | ArrayBuffer = new File([`HDF5`], `device.h5`),
    worker_factory = factory,
  ) => {
    const result = await parse_in_worker(content, `device.h5`, false, { worker_factory })
    if (result.type !== `trajectory` || !result.data.prepare_frame)
      throw new Error(`Expected prepared trajectory`)
    expect(result.data.compute_hotspots).toBeUndefined()
    return { run: result.data, prepare: result.data.prepare_frame.bind(result.data) }
  }
  return { workers, pending, openings, factory, warm, open }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe(`parse_in_worker`, () => {
  it.each([3, 8])(
    `keeps frames moving while replicas open together (%i cores), then shares work`,
    async (cores) => {
      vi.spyOn(navigator, `hardwareConcurrency`, `get`).mockReturnValue(cores)
      const { workers, pending, openings, warm, open } = preparation_workers(
        333_200,
        `hdf5`,
        true,
      )
      const { run, prepare } = await open()
      const requests: Promise<unknown>[] = []
      try {
        await warm(run)
        const frames = [1, 2, 3].map((idx) => prepare(idx, preparation))
        requests.push(...frames)
        for (const [idx, prepared] of frames.entries()) {
          await vi.waitFor(() => expect(pending).toHaveLength(1))
          // Replicas start together, bounded by CPU capacity and queued demand.
          expect(workers.map(({ posted }) => posted.length)).toEqual(
            Array(Math.min(cores - 1, 3)).fill(1),
          )
          expect(pending[0].worker_idx).toBe(0)
          expect(pending[0].idx).toBe(idx + 1)
          pending.shift()?.resolve()
          expect((await prepared).frame.header.step).toBe(idx + 1)
        }
        openings.shift()?.()
        const shared = [prepare(4, preparation), prepare(5, preparation)]
        requests.push(...shared)
        await vi.waitFor(() => expect(pending).toHaveLength(2))
        expect(new Set(pending.map(({ worker_idx }) => worker_idx))).toEqual(new Set([0, 1]))
        for (const request of pending.splice(0)) request.resolve()
        expect(
          (await Promise.all(shared)).map(({ frame: prepared }) => prepared.header.step),
        ).toEqual([4, 5])
      } finally {
        run.dispose()
        await Promise.allSettled(requests)
        for (const finish_opening of openings) finish_opening()
        for (const request of pending.splice(0)) request.resolve()
      }
      expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true)
    },
  )

  it.each([
    [333_200, 8, true, `hdf5`, 1, 4, undefined],
    [333_200, 8, true, `reference-md-hdf5`, 1, 4, undefined],
    [333_200, 18, true, `hdf5`, 1, 10, 32],
    [333_200, 18, true, `md-hdf5`, 1, 10, 32],
    [333_200, 18, true, `hdf5`, 1, 4, 8],
    [333_200, 18, true, `hdf5`, 1, 2, 4],
    [1_000_000, 18, true, `hdf5`, 256 * 1024 ** 2, 4, 16],
    [1_000_000, 18, true, `hdf5`, 1025 * 1024 ** 2, 1, 32],
    [1_000_000, 8, true, `hdf5`, 256 * 1024 ** 2, 2, undefined],
    [1_000_000, 8, true, `hdf5`, 513 * 1024 ** 2, 1, undefined],
    [333_200, 2, true, `hdf5`, 1, 1, 32],
    [100_000, 8, true, `hdf5`, 1, 1, 32],
    [333_200, 8, false, `hdf5`, 1, 1, 32],
    [333_200, 8, true, `xyz`, 1, 1, 32],
  ])(
    `bounds preparation: %i atoms, %i cores, File=%s, %s, %i bytes/frame, %i workers, memory=%s`,
    async (atom_count, cores, is_file, format, frame_bytes, concurrency, memory) => {
      vi.spyOn(navigator, `hardwareConcurrency`, `get`).mockReturnValue(cores)
      vi.stubGlobal(`navigator`, Object.create(navigator, { deviceMemory: { value: memory } }))
      vi.spyOn(preparation_module, `display_frame_bytes`).mockReturnValue(frame_bytes)
      const { workers, pending, warm, open } = preparation_workers(atom_count, format)
      const file = new File([`HDF5`], `device.h5`)
      const { run, prepare } = await open(is_file ? file : new ArrayBuffer(4))
      try {
        expect(workers).toHaveLength(1)
        await warm(run)
        const frames = Array.from({ length: 12 }, (_, idx) => prepare(idx, preparation))
        await vi.waitFor(() => expect(pending).toHaveLength(concurrency))
        expect(workers).toHaveLength(concurrency)
        expect(new Set(pending.map(({ worker_idx }) => worker_idx)).size).toBe(concurrency)
        for (const worker of workers.slice(1)) {
          expect(worker.posted[0].request.load_options).toEqual({ hdf5_group_path: `/device` })
          expect(worker.posted[0].request.replica).toEqual(
            format === `md-hdf5` ? summarize_run(run) : undefined,
          )
          expect(worker.posted[0].request.content).toEqual(
            workers[0].posted[0].request.content,
          )
        }
        let completed = 0
        while (completed < frames.length) {
          await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0))
          for (const request of pending.splice(0)) {
            request.resolve()
            completed++
          }
        }
        expect(
          (await Promise.all(frames)).map(
            ({ frame: prepared_frame }) => prepared_frame.header.step,
          ),
        ).toEqual(Array.from({ length: 12 }, (_, idx) => idx))
      } finally {
        run.dispose()
      }
      expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true)
    },
  )

  it(`keeps an aborted primary occupied, terminates replica work, and rejects disposal`, async () => {
    vi.spyOn(navigator, `hardwareConcurrency`, `get`).mockReturnValue(8)
    const { workers, pending, warm, open } = preparation_workers(333_200)
    const { run, prepare } = await open()
    await warm(run)
    const controllers = [new AbortController(), new AbortController()]
    const first = prepare(0, preparation, controllers[0].signal)
    const first_failure = first.catch((error: unknown) => error)
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    controllers[0].abort()
    expect(await first_failure).toMatchObject({ name: `AbortError` })
    expect(workers[0].terminate).not.toHaveBeenCalled()
    const second = prepare(1, preparation, controllers[1].signal)
    const second_failure = second.catch((error: unknown) => error)
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    expect(pending.map(({ worker_idx }) => worker_idx)).toEqual([0, 1])
    controllers[1].abort()
    expect(await second_failure).toMatchObject({ name: `AbortError` })
    expect(workers[1].terminate).toHaveBeenCalledOnce()
    const third = prepare(2, preparation)
    const third_failure = third.catch((error: unknown) => error)
    run.dispose()
    expect(await third_failure).toMatchObject({ message: expect.stringContaining(`disposed`) })
    await expect(prepare(3, preparation)).rejects.toThrow(`disposed`)
    for (const request of pending.splice(0)) request.resolve()
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true)
  })

  it(`reuses warm replicas and expires them only after all actual work becomes idle`, async () => {
    vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] })
    vi.spyOn(navigator, `hardwareConcurrency`, `get`).mockReturnValue(3)
    const { workers, pending, warm, open } = preparation_workers(333_200)
    const { run, prepare } = await open()
    const settle = async (requests: Promise<unknown>[]) => {
      await vi.waitFor(() => expect(pending).toHaveLength(requests.length))
      for (const request of pending.splice(0)) request.resolve()
      await Promise.all(requests)
    }
    try {
      await warm(run)
      await settle([prepare(1, preparation), prepare(2, preparation)])
      const capacity = run.preparation_concurrency
      expect(workers).toHaveLength(2)
      await vi.advanceTimersByTimeAsync(9000)
      expect(workers.every((worker) => worker.terminate.mock.calls.length === 0)).toBe(true)

      const reused = [prepare(3, preparation), prepare(4, preparation)]
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      await vi.advanceTimersByTimeAsync(2000) // Pass the original idle deadline while busy.
      expect(workers).toHaveLength(2)
      expect(workers.every((worker) => worker.terminate.mock.calls.length === 0)).toBe(true)
      await settle(reused)

      const controller = new AbortController()
      const cancelled = prepare(5, preparation, controller.signal).catch(
        (error: unknown) => error,
      )
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      controller.abort()
      expect(await cancelled).toMatchObject({ name: `AbortError` })
      await vi.advanceTimersByTimeAsync(11_000)
      expect(workers.every((worker) => worker.terminate.mock.calls.length === 0)).toBe(true)
      // Cancelling its caller does not finish the primary worker's actual RPC.
      pending.shift()?.resolve()
      await vi.waitFor(() => expect(vi.getTimerCount()).toBe(1))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(workers[0].terminate).not.toHaveBeenCalled()
      expect(workers[1].terminate).toHaveBeenCalledOnce()
      expect(run.preparation_concurrency).toBe(capacity)

      await settle([prepare(6, preparation), prepare(7, preparation)])
      expect(workers).toHaveLength(3) // Replicas reopen lazily after expiry.
      run.dispose()
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true)
    } finally {
      run.dispose()
      for (const request of pending.splice(0)) request.resolve()
      vi.useRealTimers()
    }
  })

  it.each([`abort`, `error`, `mismatch`])(
    `releases a replica on startup %s`,
    async (failure) => {
      vi.spyOn(navigator, `hardwareConcurrency`, `get`).mockReturnValue(8)
      const { workers, pending, factory, warm, open } = preparation_workers(333_200)
      const broken = make_fake_worker(
        failure === `mismatch` ? trajectory_response : () => null,
      )
      const { run, prepare } = await open(undefined, () =>
        workers.length ? broken : factory(),
      )
      await warm(run)
      const current = prepare(1, preparation)
      const disposed = current.catch((error: unknown) => error)
      const controller = new AbortController()
      const replica = prepare(2, preparation, controller.signal)
      const rejected = replica.catch((error: unknown) => error)
      if (failure === `abort`) controller.abort()
      if (failure === `error`)
        broken.emit(`error`, new ErrorEvent(`error`, { message: `startup failed` }))
      try {
        expect(await rejected).toMatchObject({
          message: expect.stringMatching(
            failure === `abort`
              ? /abort/i
              : failure === `error`
                ? /startup failed/
                : /does not match/,
          ),
        })
        expect(broken.terminate).toHaveBeenCalledOnce()
        expect(workers[0].terminate).not.toHaveBeenCalled()
      } finally {
        run.dispose()
        expect(await disposed).toMatchObject({ message: expect.stringContaining(`disposed`) })
        for (const request of pending.splice(0)) request.resolve()
      }
    },
  )

  it(`disposes every replica when the primary RPC port fails`, async () => {
    vi.spyOn(navigator, `hardwareConcurrency`, `get`).mockReturnValue(8)
    const { workers, pending, warm, open } = preparation_workers(333_200)
    const { run, prepare } = await open()
    await warm(run)
    const requests = [1, 2].map((idx) =>
      prepare(idx, preparation).catch((error: unknown) => error),
    )
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    vi.spyOn(workers[0].run_ports[0], `postMessage`).mockImplementationOnce(() => {
      throw new Error(`port failed`)
    })
    await expect(run.read_frame(0)).rejects.toThrow(`port failed`)
    for (const request of requests)
      expect(await request).toMatchObject({ message: expect.stringContaining(`disposed`) })
    expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true)
    await expect(prepare(3, preparation)).rejects.toThrow(`disposed`)
    for (const request of pending.splice(0)) request.resolve()
  })

  it(`posts a file request and terminates the worker after a non-trajectory reply`, async () => {
    const worker = make_fake_worker()
    await expect(
      parse_in_worker(`data_si`, `si.cif`, false, {
        worker_factory: () => worker,
        load_options: { index_above_bytes: 4096 },
      }),
    ).resolves.toEqual(structure_result)
    // host loading settings ride along so the worker's open_trajectory honours them
    expect(worker.posted[0].request).toMatchObject({
      content: `data_si`,
      filename: `si.cif`,
      is_base64: false,
      load_options: { index_above_bytes: 4096 },
    })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it.each([
    [
      `construction`,
      () => {
        throw new Error(`blocked`)
      },
    ],
    [
      `script load`,
      () => {
        const worker = make_fake_worker(() => null)
        queueMicrotask(() => worker.emit(`error`, new ErrorEvent(`error`, { message: `404` })))
        return worker
      },
    ],
    [
      `deserialization`,
      () => {
        const worker = make_fake_worker(() => null)
        queueMicrotask(() => worker.emit(`messageerror`, new MessageEvent(`messageerror`)))
        return worker
      },
    ],
  ])(`rejects when worker %s fails`, async (_label, make_worker) => {
    await expect(
      parse_in_worker(`data`, `si.cif`, false, {
        worker_factory: make_worker,
        load_options: { index_above_bytes: 4096 },
      }),
    ).rejects.toThrow(/blocked|404|deserialize/)
  })

  it(`aborting terminates the worker`, async () => {
    const worker = make_fake_worker(() => null)
    const controller = new AbortController()
    const parsing = parse_in_worker(`data`, `si.cif`, false, {
      worker_factory: () => worker,
      signal: controller.signal,
    })
    controller.abort()
    await expect(parsing).rejects.toMatchObject({ name: `AbortError` })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  it(`returns a live worker-backed run and terminates its worker on dispose`, async () => {
    const worker = make_fake_worker(trajectory_response)
    const result = await parse_in_worker(`1\nframe\nH 1 2 3\n`, `movie.xyz`, false, {
      worker_factory: () => worker,
    })
    if (result.type !== `trajectory`) throw new Error(`Expected trajectory`)
    const run = result.data
    expect(run.frame_count).toBe(1)
    expect(await materialize_frame_result(run.read_frame(0))).toEqual(frame)
    expect(worker.terminate).not.toHaveBeenCalled()
    run.dispose()
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce())
  })

  it.each([`missing port`, `malformed summary`])(
    `rejects a trajectory with %s and releases its worker`,
    async (failure) => {
      const worker = make_fake_worker((request) => {
        const response = trajectory_response(request)
        if (failure === `missing port`) {
          dispose_run_port(response.run_port)
          delete response.run_port
        } else if (response.result?.type === `trajectory`) {
          Reflect.deleteProperty(response.result.data, `properties`)
        }
        return response
      })
      await expect(
        parse_in_worker(`text`, `movie.xyz`, false, { worker_factory: () => worker }),
      ).rejects.toThrow(failure === `missing port` ? /missing its run port/ : /rows/)
      expect(worker.terminate).toHaveBeenCalledOnce()
    },
  )

  it(`clones retained ArrayBuffer sources and mapping options`, async () => {
    const source = new Uint8Array([1, 2, 3, 4]).buffer
    const worker = make_fake_worker(trajectory_response)
    const mapping = { 1: `H` as const }
    const result = await parse_in_worker(source, `large.h5`, false, {
      worker_factory: () => worker,
      load_options: { atom_type_mapping: mapping },
    })
    if (result.type !== `trajectory`) throw new Error(`Expected trajectory`)
    const run = result.data
    expect(source.byteLength).toBe(4)
    expect(worker.posted[0].request).toMatchObject({
      filename: `large.h5`,
      load_options: { atom_type_mapping: { 1: `H` } },
    })
    expect(worker.posted[0].transfer).toHaveLength(0)
    run.dispose()
  })

  // Ownership alone decides whether bytes may be detached, independently of file size.
  it.each([
    [`transfers a small payload the caller gave up`, 1024, true, 1],
    [`clones when the caller keeps ownership`, 60 * 1024 * 1024, false, 0],
    [`transfers an oversized payload the caller gave up`, 60 * 1024 * 1024, true, 1],
  ])(`%s`, async (_label, size, owns_content, expected_transfers) => {
    const worker = make_fake_worker((request) => ({
      id: request.id,
      result: { type: `structure`, data: { sites: [] }, filename: `x.bin` },
    }))
    const content = new ArrayBuffer(size)
    await parse_in_worker(content, `x.bin`, false, {
      worker_factory: () => worker,
      owns_content,
    })
    expect(worker.posted[0].transfer).toHaveLength(expected_transfers)
    // a cloned buffer stays readable here; a transferred one is detached
    expect(content.byteLength).toBe(expected_transfers === 0 ? size : 0)
  })

  it.each([`error`, `messageerror`])(
    `a late worker %s disposes the opened trajectory`,
    async (event_type) => {
      const worker = make_fake_worker(trajectory_response)
      const result = await parse_in_worker(`text`, `movie.xyz`, false, {
        worker_factory: () => worker,
      })
      if (result.type !== `trajectory`) throw new Error(`Expected trajectory`)
      const run = result.data
      worker.emit(event_type, new Event(event_type))
      await expect(Promise.resolve(run.read_frame(0))).rejects.toThrow(/disposed/)
      expect(worker.terminate).toHaveBeenCalledOnce()
    },
  )

  it(`surfaces an ambiguous HDF5 group choice as a typed error`, async () => {
    const worker = make_fake_worker((request) => ({
      id: request.id,
      error: `ambiguous`,
      hdf5_group_paths: [`/a`, `/b`],
    }))
    await expect(
      parse_in_worker(`text`, `multi.h5`, false, {
        worker_factory: () => worker,
      }),
    ).rejects.toMatchObject({
      name: `Hdf5GroupSelectionRequiredError`,
      groups: [`/a`, `/b`],
      message: `ambiguous`,
    } satisfies Partial<Hdf5GroupSelectionRequiredError>)
  })

  it.each([false, true])(
    `handles progress before the result (callback throws: %s)`,
    async (throws) => {
      const failure = new Error(`Progress observer failed`)
      const progress = vi.fn(() => {
        if (throws) throw failure
      })
      const worker = make_fake_worker((request) => {
        queueMicrotask(() =>
          worker.emit(
            `message`,
            new MessageEvent(`message`, {
              data: { id: request.id, progress: { current: 1, total: 2, stage: `read` } },
            }),
          ),
        )
        return trajectory_response(request)
      })
      const pending = parse_in_worker(`text`, `run.xyz`, false, {
        on_progress: progress,
        worker_factory: () => worker,
      })
      if (throws) await expect(pending).rejects.toBe(failure)
      else {
        const result = await pending
        if (result.type !== `trajectory`) throw new Error(`Expected trajectory`)
        result.data.dispose()
      }
      expect(progress).toHaveBeenCalledWith({ current: 1, total: 2, stage: `read` })
      expect(worker.terminate).toHaveBeenCalledOnce()
    },
  )
})

describe(`parse worker handler`, () => {
  it.each([0, 2])(`transfers all %i imported density buffers`, async (count) => {
    const volumes = Array.from({ length: count }, (_, idx) => ({
      ...make_volume(make_grid(2, 2, 2, () => idx + 1)),
      id: `density-${idx}`,
    }))
    const { response, transfer } = await handle_parse_worker_request({
      id: 8,
      filename: `prediction.json`,
      is_base64: false,
      content: prediction_to_json({
        input: frame.structure,
        run_id: 1,
        provenance: { model: `test`, version: `1`, units: {}, settings: {} },
        volumes,
      }),
    })
    if (response.result?.type !== `structure`) throw new Error(`Expected structure result`)
    const buffers = response.result.prediction?.volumes?.map(({ values }) => values.buffer)
    expect(transfer).toEqual(buffers)
    expect(transfer).toHaveLength(count)
    const received = structuredClone(response, { transfer })
    expect(buffers?.every((buffer) => buffer.byteLength === 0)).toBe(true)
    if (received.result?.type !== `structure`)
      throw new Error(`Expected transferred structure`)
    expect(received.result.prediction?.volumes?.map(({ values }) => values)).toEqual(
      volumes.map(({ values }) => values),
    )
  })

  it(`keeps a parsed trajectory behind a transferred run port`, async () => {
    const { response, transfer } = await handle_parse_worker_request({
      id: 7,
      content: `1\nframe\nH 1 2 3\n1\nframe\nH 2 3 4\n`,
      filename: `movie.xyz`,
      is_base64: false,
    })
    expect(response.id).toBe(7)
    expect(response.result?.type).toBe(`trajectory`)
    expect(response.result?.data).toMatchObject({
      frame_count: 2,
      preview: { step: 0, structure: { sites: [{ xyz: [1, 2, 3] }] } },
    })
    expect(transfer).toEqual([response.run_port])
    dispose_run_port(response.run_port)
  })
})
