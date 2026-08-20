import type { ParseResult } from '$lib/file-viewer/parse'
import {
  MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES,
  MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES,
  parse_in_worker,
  parse_trajectory_in_worker,
  should_index_worker_xyz,
} from '$lib/file-viewer/parse-in-worker'
import type {
  FrameWorkerRequest,
  FrameWorkerResponse,
  ParseWorkerRequest,
  ParseWorkerResponse,
  WorkerLike,
} from '$lib/file-viewer/parse-in-worker'
import type { AtomTypeMapping, FrameLoader, TrajectoryType } from '$lib/trajectory'
import { Hdf5TrajectoryGroupSelectionError } from '$lib/trajectory/parse/hdf5'
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest'

// MessagePort/Worker postMessage take no targetOrigin (that's window.postMessage)
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin

const structure_result: ParseResult = {
  type: `structure`,
  data: { sites: [] },
  filename: `mp-1.cif`,
}

interface FakeWorker extends WorkerLike {
  emit: (type: string, event: Event) => void
  posted: { request: ParseWorkerRequest; transfer: readonly Transferable[] }[]
  terminate: Mock<() => void>
}

// Fake worker: records each request (structured-cloned with its transfer list, like a real
// worker would) and answers through `respond`; a null answer simulates a hung worker.
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
    postMessage: (message: unknown, options?: StructuredSerializeOptions | Transferable[]) => {
      const transfer = Array.isArray(options) ? options : (options?.transfer ?? [])
      const request = structuredClone(message, {
        transfer: [...transfer],
      }) as ParseWorkerRequest
      worker.posted.push({ request, transfer })
      const response = respond(request)
      if (!response) return
      const cloned = structuredClone(response, {
        transfer: response.frame_port ? [response.frame_port] : [],
      })
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

const silence_warnings = () => vi.spyOn(console, `warn`).mockImplementation(() => {})

afterEach(() => vi.restoreAllMocks())

describe(`parse_in_worker`, () => {
  it(`posts a file request to a fresh worker and terminates it after the reply`, async () => {
    const worker = make_fake_worker()
    const worker_factory = vi.fn(() => worker)
    const fallback_parse = vi.fn()
    const result = await parse_in_worker(`data_si`, `si.cif`, false, {
      worker_factory,
      fallback_parse,
    })
    expect(result).toEqual(structure_result)
    expect(worker.posted).toEqual([
      {
        request: {
          kind: `file`,
          id: expect.any(Number),
          content: `data_si`,
          filename: `si.cif`,
          is_base64: false,
        },
        transfer: [],
      },
    ])
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(fallback_parse).not.toHaveBeenCalled()
  })

  it(`reports worker parse errors as-is instead of re-parsing on the main thread`, async () => {
    const worker = make_fake_worker((request) => ({ id: request.id, error: `h5 open failed` }))
    const fallback_parse = vi.fn()
    await expect(
      parse_in_worker(`junk`, `broken.h5`, true, {
        worker_factory: () => worker,
        fallback_parse,
      }),
    ).rejects.toThrow(`h5 open failed`)
    expect(fallback_parse).not.toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it.each([
    [
      `construction throws`,
      (): FakeWorker => {
        throw new Error(`Failed to construct 'Worker': cross-origin script`)
      },
    ],
    [
      `script fails to load`,
      () => {
        const worker = make_fake_worker(() => null)
        queueMicrotask(() =>
          worker.emit(`error`, new ErrorEvent(`error`, { message: `404 parse-worker.js` })),
        )
        return worker
      },
    ],
    [
      `reply fails to deserialize`,
      () => {
        const worker = make_fake_worker(() => null)
        queueMicrotask(() => worker.emit(`messageerror`, new MessageEvent(`messageerror`)))
        return worker
      },
    ],
    [
      `postMessage throws`,
      (): WorkerLike => ({
        postMessage: () => {
          throw new DOMException(`not cloneable`, `DataCloneError`)
        },
        addEventListener: () => {},
        terminate: vi.fn(),
      }),
    ],
  ])(`falls back to the main thread when the worker %s`, async (_label, worker_factory) => {
    const warn = silence_warnings()
    const fallback_parse = vi.fn().mockResolvedValue(structure_result)
    let worker: WorkerLike | undefined
    const result = await parse_in_worker(`data_si`, `si.cif`, false, {
      worker_factory: () => (worker = worker_factory()),
      fallback_parse,
    })
    expect(result).toEqual(structure_result)
    expect(fallback_parse).toHaveBeenCalledExactlyOnceWith(`data_si`, `si.cif`, false)
    expect(warn).toHaveBeenCalledOnce()
    if (worker) expect(worker.terminate).toHaveBeenCalledOnce()
  })

  // base64 content is ASCII, so the decoded-size ceiling maps to 4/3 as many characters.
  // The last case sits past the text ceiling but well inside the roomier base64 one.
  it.each([
    [`oversized text`, MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES + 1, false, false],
    [
      `oversized base64`,
      Math.ceil((MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES * 4) / 3),
      true,
      false,
    ],
    [`text-sized base64`, MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES + 1, true, true],
  ])(`main-thread fallback for %s`, async (_label, length, is_base64, expect_fallback) => {
    silence_warnings()
    const fallback_parse = vi.fn().mockResolvedValue(structure_result)
    const parsing = parse_in_worker(`x`.repeat(length), `huge.h5`, is_base64, {
      worker_factory: () => {
        throw new Error(`blocked`)
      },
      fallback_parse,
    })
    if (expect_fallback) await expect(parsing).resolves.toEqual(structure_result)
    else await expect(parsing).rejects.toThrow(`main-thread fallback is disabled`)
    expect(fallback_parse).toHaveBeenCalledTimes(expect_fallback ? 1 : 0)
  })

  it(`resolves LARGE_FILE markers on the main thread without constructing a worker`, async () => {
    const worker_factory = vi.fn()
    const fallback_parse = vi.fn().mockResolvedValue(structure_result)
    const marker = `LARGE_FILE:/tmp/run.xyz:123456`
    await expect(
      parse_in_worker(marker, `run.xyz`, false, { worker_factory, fallback_parse }),
    ).resolves.toEqual(structure_result)
    expect(worker_factory).not.toHaveBeenCalled()
    expect(fallback_parse).toHaveBeenCalledExactlyOnceWith(marker, `run.xyz`, false)
  })

  it(`aborting terminates the worker and ignores its late reply`, async () => {
    const worker = make_fake_worker(() => null)
    const worker_factory = vi.fn(() => worker)
    const controller = new AbortController()
    const parsing = parse_in_worker(`data_si`, `si.cif`, false, {
      worker_factory,
      signal: controller.signal,
    })
    controller.abort()
    await expect(parsing).rejects.toMatchObject({ name: `AbortError` })
    expect(worker.terminate).toHaveBeenCalledOnce()
    // A reply after termination must not resurrect the request or leak its frame port
    const { port1, port2 } = new MessageChannel()
    const port_closed = vi.spyOn(port2, `close`)
    worker.emit(
      `message`,
      new MessageEvent(`message`, {
        data: { id: worker.posted[0].request.id, result: structure_result, frame_port: port2 },
      }),
    )
    expect(port_closed).toHaveBeenCalledOnce()
    port1.close()

    // Already-aborted signals never reach the worker factory
    await expect(
      parse_in_worker(`data_si`, `si.cif`, false, {
        worker_factory,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: `AbortError` })
    expect(worker_factory).toHaveBeenCalledOnce()
  })

  // A worker-side frame loader behind a real MessageChannel, as parse-worker.ts would build
  const make_indexed_worker = (trajectory: Partial<TrajectoryType> = {}) => {
    const channel = new MessageChannel()
    const served: FrameWorkerRequest[] = []
    channel.port1.addEventListener(`message`, (event: MessageEvent<FrameWorkerRequest>) => {
      const { id, method, args } = event.data
      served.push(event.data)
      if (method === `dispose`) return
      if (method === `get_total_frames`) channel.port1.postMessage({ id, result: 64 })
      else if (method === `build_frame_index`) {
        channel.port1.postMessage({ id, progress: { current: 1, total: 1, stage: `read` } })
        channel.port1.postMessage({ id, result: [] })
      } else if (method === `load_frame`) {
        channel.port1.postMessage({
          id,
          result: { step: Number(args[0]), structure: { sites: [] } },
        })
      } else if (method === `extract_plot_metadata`) {
        channel.port1.postMessage({ id, error: `metadata unavailable` })
      }
    })
    channel.port1.start()
    const indexed_result: ParseResult = {
      type: `trajectory`,
      filename: `movie.xyz`,
      data: {
        frames: [{ structure: { sites: [] }, step: 0 }],
        total_frames: 64,
        is_indexed: true,
        ...trajectory,
      },
    }
    const worker = make_fake_worker((request) => ({
      id: request.id,
      result: indexed_result,
      frame_port: channel.port2,
    }))
    return { worker, served, port: channel.port1 }
  }

  it(`binds an indexed result's frame port to an RPC loader that owns the worker`, async () => {
    const { worker, served } = make_indexed_worker()
    const result = await parse_in_worker(`frames`, `movie.xyz`, false, {
      worker_factory: () => worker,
    })
    const { frame_loader } = result.data as TrajectoryType
    if (!frame_loader) throw new Error(`indexed result has no frame loader`)
    expect(frame_loader.requires_source).toBe(false)
    // The worker now serves frames, so the parse reply must not have terminated it
    expect(worker.terminate).not.toHaveBeenCalled()

    const progress = vi.fn()
    await expect(frame_loader.get_total_frames(``)).resolves.toBe(64)
    await expect(frame_loader.load_frame(``, 7)).resolves.toMatchObject({ step: 7 })
    await expect(frame_loader.build_frame_index(``, 1, progress)).resolves.toEqual([])
    expect(progress).toHaveBeenCalledWith({ current: 1, total: 1, stage: `read` })
    await expect(frame_loader.extract_plot_metadata(``, {}, progress)).rejects.toThrow(
      `metadata unavailable`,
    )
    expect(served.map(({ method }) => method)).toEqual([
      `get_total_frames`,
      `load_frame`,
      `build_frame_index`,
      `extract_plot_metadata`,
    ])

    frame_loader.dispose?.()
    await vi.waitFor(() => expect(served.at(-1)?.method).toBe(`dispose`))
    expect(worker.terminate).toHaveBeenCalledOnce()
    await expect(frame_loader.load_frame(``, 0)).rejects.toThrow(`disposed`)
  })

  it(`rejects pending frame reads when the serving worker crashes`, async () => {
    const { worker } = make_indexed_worker()
    const result = await parse_in_worker(`frames`, `movie.xyz`, false, {
      worker_factory: () => worker,
    })
    const { frame_loader } = result.data as TrajectoryType
    // Stall the port by never answering: emit the crash while a read is in flight
    const reading = frame_loader?.load_frame(``, 1)
    worker.emit(`error`, new ErrorEvent(`error`, { message: `worker crashed` }))
    await expect(reading).rejects.toThrow(`worker crashed`)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it(`materializes packed worker frames locally and releases a stray frame port`, async () => {
    const { worker, served } = make_indexed_worker({
      frame_store: {
        positions: new Float64Array([0, 0, 0, 1, 2, 3]),
        elements: [`H`],
        coords_unwrapped: true,
        steps: [0, 1],
        metadata: [{}, { energy: -1 }],
        plot_metadata: [0, 1].map((frame_number) => ({
          frame_number,
          step: frame_number,
          properties: {},
        })),
      },
    })
    const result = await parse_in_worker(`payload`, `packed.h5`, true, {
      worker_factory: () => worker,
    })
    const trajectory = result.data as TrajectoryType
    expect(trajectory.frame_loader?.requires_source).toBe(false)
    await expect(trajectory.frame_loader?.load_frame(``, 1)).resolves.toMatchObject({
      step: 1,
      metadata: { energy: -1 },
      structure: { sites: [{ xyz: [1, 2, 3], species: [{ element: `H` }] }] },
    })
    // Nothing is served remotely, so the port is disposed and the worker released
    await vi.waitFor(() => expect(served.map(({ method }) => method)).toEqual([`dispose`]))
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  const large_xyz_frame = `1\n${`x`.repeat(600_000)}\nH 0 0 0\n`
  const large_single_frame = `1\n${`x`.repeat(1_100_000)}\nH 0 0 0\n`
  it.each([
    [`63-frame XYZ`, `1\nframe\nH 0 0 0\n`.repeat(63), `movie.xyz`, false, false],
    [`64-frame XYZ`, `1\nframe\nH 0 0 0\n`.repeat(64), `movie.xyz`, false, true],
    [`large XYZ`, large_xyz_frame.repeat(2), `movie.extxyz`, false, true],
    [`large single-frame XYZ`, large_single_frame, `movie.xyz`, false, false],
    [`CRLF XYZ`, `1\r\nframe\r\nH 0 0 0\r\n`.repeat(64), `movie.xyz`, false, true],
    [`other format`, `1\nframe\nH 0 0 0\n`.repeat(64), `movie.cif`, false, false],
    [`base64 XYZ`, `1\nframe\nH 0 0 0\n`.repeat(64), `movie.xyz`, true, false],
  ] as const)(
    `selects adaptive indexed parsing for %s`,
    (_label, content, filename, is_base64, expected) => {
      expect(should_index_worker_xyz(content, filename, is_base64)).toBe(expected)
    },
  )

  it(`keeps indexable XYZ indexed when parsing on the main thread`, async () => {
    silence_warnings()
    const content = `1\nframe\nH 0 0 0\n`.repeat(64)
    const result = await parse_in_worker(content, `movie.xyz`, false, {
      worker_factory: () => {
        throw new Error(`blocked`)
      },
    })
    expect(result).toMatchObject({
      type: `trajectory`,
      data: { is_indexed: true, total_frames: 64 },
    })
    const trajectory = result.data as TrajectoryType
    await expect(trajectory.frame_loader?.load_frame(content, 63)).resolves.toMatchObject({
      step: 63,
    })
    trajectory.frame_loader?.dispose?.()
  })
})

describe(`parse_trajectory_in_worker`, () => {
  const trajectory_response = (request: ParseWorkerRequest): ParseWorkerResponse => ({
    id: request.id,
    result: {
      type: `trajectory`,
      filename: request.filename,
      data: { frames: [{ structure: { sites: [] }, step: 0 }], total_frames: 1 },
    },
  })

  it(`clones an ArrayBuffer source by default and snapshots reactive options`, async () => {
    const source = new Uint8Array([1, 2, 3, 4]).buffer
    const worker = make_fake_worker(trajectory_response)
    const trajectory = await parse_trajectory_in_worker(
      source,
      `large.h5`,
      undefined,
      { use_indexing: true, atom_type_mapping: new Proxy<AtomTypeMapping>({ 1: `H` }, {}) },
      { worker_factory: () => worker },
    )
    expect(trajectory.total_frames).toBe(1)
    expect(source.byteLength).toBe(4) // a copy was transferred, not the caller's buffer
    const [{ request, transfer }] = worker.posted
    expect(request).toMatchObject({
      kind: `trajectory`,
      filename: `large.h5`,
      options: { use_indexing: true, atom_type_mapping: { 1: `H` } },
    })
    expect(transfer).toHaveLength(1)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it(`transfers the source when asked and refuses to fall back afterwards`, async () => {
    const source = new Uint8Array([1, 2, 3, 4]).buffer
    const worker = make_fake_worker(() => null)
    queueMicrotask(() => worker.emit(`error`, new ErrorEvent(`error`, { message: `boom` })))
    const fallback_parse = vi.fn()
    await expect(
      parse_trajectory_in_worker(
        source,
        `large.h5`,
        undefined,
        {},
        {
          worker_factory: () => worker,
          fallback_parse,
          transfer_source: true,
        },
      ),
    ).rejects.toThrow(`after taking ownership of large.h5`)
    expect(source.byteLength).toBe(0)
    expect(worker.posted[0].transfer).toEqual([source])
    expect(fallback_parse).not.toHaveBeenCalled()
  })

  it(`posts Blob sources without a transfer and never parses them on the main thread`, async () => {
    const worker = make_fake_worker(() => null)
    queueMicrotask(() => worker.emit(`error`, new ErrorEvent(`error`, { message: `boom` })))
    const fallback_parse = vi.fn()
    await expect(
      parse_trajectory_in_worker(
        new Blob([`h5`]),
        `large.h5`,
        undefined,
        {},
        {
          worker_factory: () => worker,
          fallback_parse,
        },
      ),
    ).rejects.toThrow(`Blob-backed HDF5 parsing failed for large.h5`)
    // jsdom Blobs don't survive structuredClone, so only the request shape is checked
    expect(worker.posted[0]).toMatchObject({ request: { kind: `trajectory` }, transfer: [] })
    expect(fallback_parse).not.toHaveBeenCalled()
  })

  it(`surfaces HDF5 group selection as Hdf5TrajectoryGroupSelectionError`, async () => {
    const worker = make_fake_worker((request) => ({
      id: request.id,
      error: `ambiguous`,
      hdf5_group_paths: [`/a`, `/b`],
    }))
    const fallback_parse = vi.fn()
    const parsing = parse_trajectory_in_worker(
      `text`,
      `multi.h5`,
      undefined,
      {},
      {
        worker_factory: () => worker,
        fallback_parse,
      },
    )
    await expect(parsing).rejects.toBeInstanceOf(Hdf5TrajectoryGroupSelectionError)
    await expect(parsing).rejects.toMatchObject({
      group_paths: [`/a`, `/b`],
      message: `ambiguous`,
    })
    expect(fallback_parse).not.toHaveBeenCalled()
  })

  it(`forwards progress and falls back within the size limit only`, async () => {
    silence_warnings()
    const progress = vi.fn()
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
    await parse_trajectory_in_worker(
      `text`,
      `run.xyz`,
      progress,
      {},
      {
        worker_factory: () => worker,
      },
    )
    expect(progress).toHaveBeenCalledWith({ current: 1, total: 2, stage: `read` })

    const blocked_factory = () => {
      throw new Error(`blocked`)
    }
    const fallback_parse = vi.fn().mockResolvedValue({ frames: [], total_frames: 0 })
    const options = { use_indexing: true }
    await parse_trajectory_in_worker(`text`, `run.xyz`, progress, options, {
      worker_factory: blocked_factory,
      fallback_parse,
    })
    expect(fallback_parse).toHaveBeenCalledExactlyOnceWith(
      `text`,
      `run.xyz`,
      progress,
      options,
    )

    const oversized = new ArrayBuffer(MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES + 1)
    await expect(
      parse_trajectory_in_worker(
        oversized,
        `big.traj`,
        undefined,
        {},
        {
          worker_factory: blocked_factory,
          fallback_parse,
        },
      ),
    ).rejects.toThrow(`main-thread fallback is disabled`)
    expect(fallback_parse).toHaveBeenCalledOnce()
  })
})

describe(`parse worker handlers`, () => {
  const load_worker = () => import(`$lib/file-viewer/parse-worker`)
  const next_port_message = (port: MessagePort) =>
    new Promise<FrameWorkerResponse>((resolve) => {
      port.addEventListener(
        `message`,
        (event: MessageEvent<FrameWorkerResponse>) => resolve(event.data),
        { once: true },
      )
      port.start()
    })

  it(`indexes long XYZ and serves frames over a transferred port until disposed`, async () => {
    const { TrajFrameReader } = await import(`$lib/trajectory/parse`)
    const dispose_spy = vi.spyOn(TrajFrameReader.prototype, `dispose`)
    const { handle_parse_worker_request } = await load_worker()
    const { response, transfer } = await handle_parse_worker_request({
      kind: `file`,
      id: 8,
      content: `1\nframe\nH 0 0 0\n`.repeat(64),
      filename: `movie.xyz`,
      is_base64: false,
    })
    expect(transfer).toEqual([response.frame_port])
    const cloned = structuredClone(response, { transfer })
    expect(cloned.result).toMatchObject({
      type: `trajectory`,
      data: { is_indexed: true, total_frames: 64, frame_loader: undefined },
    })
    const frame_port = cloned.frame_port
    if (!frame_port) throw new Error(`indexed worker response has no frame port`)

    const frame_response = next_port_message(frame_port)
    frame_port.postMessage({ id: 9, method: `load_frame`, args: [63] })
    expect((await frame_response).result).toMatchObject({
      step: 63,
      structure: { sites: [{ species: [{ element: `H` }] }] },
    })

    frame_port.postMessage({ id: 10, method: `dispose`, args: [] })
    await vi.waitFor(() => expect(dispose_spy).toHaveBeenCalledOnce())
    let follow_up: FrameWorkerResponse | undefined
    frame_port.addEventListener(`message`, (event: MessageEvent<FrameWorkerResponse>) => {
      follow_up = event.data
    })
    frame_port.postMessage({ id: 11, method: `load_frame`, args: [0] })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(follow_up).toBeUndefined()
    frame_port.close()
  })

  it(`transfers packed frame stores and streamed positions instead of cloning them`, async () => {
    const { prepare_parse_result } = await load_worker()
    const stream_values = new Float64Array([1, 2, 3, 4, 5, 6])
    const stream_scalars = new Float64Array([0.5, 1.5])
    const loader: FrameLoader = {
      get_total_frames: async () => 2,
      build_frame_index: async () => [],
      load_frame: async () => ({ structure: { sites: [] }, step: 0 }),
      extract_plot_metadata: async () => [],
      stream_positions: async () => ({
        positions: stream_values,
        scalars: { charge: stream_scalars },
        vectors: { velocity: stream_values },
        signals: { dipole: { values: stream_values, sample_shape: [3], steps: [0, 1] } },
        n_frames: 2,
        n_atoms: 1,
        elements: [`H`],
        lattice_matrices: null,
        pbc: null,
        coords_unwrapped: false,
        frame_stride: 1,
        steps: [0, 1],
      }),
    }
    const base = {
      frames: [{ structure: { sites: [] }, step: 0 }],
      total_frames: 2,
      is_indexed: true,
    }

    const compact = prepare_parse_result(
      6,
      { type: `trajectory`, filename: `compact.h5`, data: { ...base, frame_loader: loader } },
      `binary payload`,
    )
    expect(compact.transfer).toHaveLength(1)
    const cloned_compact = structuredClone(compact.response, { transfer: compact.transfer })
    const compact_trajectory = cloned_compact.result?.data as TrajectoryType | undefined
    expect(compact_trajectory?.frame_loader).toBeUndefined()
    const port = cloned_compact.frame_port
    if (!port) throw new Error(`compact worker response has no frame port`)
    const streamed = next_port_message(port)
    port.postMessage({ id: 7, method: `stream_positions`, args: [{}] })
    expect((await streamed).result).toMatchObject({
      positions: new Float64Array([1, 2, 3, 4, 5, 6]),
      scalars: { charge: new Float64Array([0.5, 1.5]) },
    })
    // Buffers moved out of the worker side: a second stream of the same detached arrays fails
    expect(stream_values.byteLength).toBe(0)
    const failed = next_port_message(port)
    port.postMessage({ id: 8, method: `stream_positions`, args: [{}] })
    await expect(failed).resolves.toMatchObject({
      id: 8,
      error: expect.stringMatching(/detach|clone|transfer/i),
    })
    port.close()

    const packed_positions = new Float64Array([0, 0, 0, 1, 2, 3])
    const packed_velocity = new Float64Array([1, 0, 0, 0, 1, 0])
    const packed = prepare_parse_result(
      7,
      {
        type: `trajectory`,
        filename: `packed.h5`,
        data: {
          ...base,
          frame_loader: loader,
          frame_store: {
            positions: packed_positions,
            elements: [`H`],
            coords_unwrapped: true,
            steps: [0, 1],
            metadata: [{}, {}],
            plot_metadata: [0, 1].map((frame_number) => ({
              frame_number,
              step: frame_number,
              properties: {},
            })),
            vectors: { velocity: packed_velocity },
            signals: {
              velocity: { values: packed_velocity, sample_shape: [1, 3], steps: [0, 1] },
            },
          },
        },
      },
      `binary payload`,
    )
    expect(packed.response.frame_port).toBeUndefined()
    expect(packed.transfer).toEqual([packed_positions.buffer, packed_velocity.buffer])
    const packed_trajectory = packed.response.result?.data as TrajectoryType | undefined
    expect(packed_trajectory?.frame_loader).toBeUndefined()
  })

  it(`serves one live HDF5 frame request at a time`, async () => {
    const { prepare_parse_result } = await load_worker()
    const call_order: string[] = []
    const { promise: first_pending, resolve: release_first } =
      Promise.withResolvers<undefined>()
    const loader: FrameLoader = {
      requires_source: false,
      get_total_frames: async () => 2,
      build_frame_index: async () => [],
      extract_plot_metadata: async () => [],
      load_frame: async (_data, frame_number) => {
        call_order.push(`start:${frame_number}`)
        if (frame_number === 0) await first_pending
        call_order.push(`end:${frame_number}`)
        return { structure: { sites: [] }, step: frame_number }
      },
    }
    const prepared = prepare_parse_result(
      1,
      {
        type: `trajectory`,
        filename: `lazy.h5`,
        data: {
          frames: [{ structure: { sites: [] }, step: 0 }],
          total_frames: 2,
          is_indexed: true,
          frame_loader: loader,
        },
      },
      new Blob(),
    )
    const cloned = structuredClone(prepared.response, { transfer: prepared.transfer })
    const frame_port = cloned.frame_port
    if (!frame_port) throw new Error(`lazy worker response has no frame port`)
    const responses: FrameWorkerResponse[] = []
    frame_port.addEventListener(`message`, (event: MessageEvent<FrameWorkerResponse>) => {
      responses.push(event.data)
    })
    frame_port.start()
    frame_port.postMessage({ id: 1, method: `load_frame`, args: [0] })
    frame_port.postMessage({ id: 2, method: `load_frame`, args: [1] })
    await vi.waitFor(() => expect(call_order).toEqual([`start:0`]))
    release_first(undefined)
    await vi.waitFor(() => expect(responses).toHaveLength(2))
    expect(call_order).toEqual([`start:0`, `end:0`, `start:1`, `end:1`])
    frame_port.postMessage({ id: 3, method: `dispose`, args: [] })
    frame_port.close()
  })

  it(`returns an RPC error when a frame response cannot be cloned`, async () => {
    const { prepare_parse_result } = await load_worker()
    const frame_loader: FrameLoader = {
      requires_source: false,
      get_total_frames: async () => 1,
      build_frame_index: async () => [],
      load_frame: async () => ({
        structure: { sites: [] },
        step: 0,
        metadata: { unclonable: () => undefined },
      }),
      extract_plot_metadata: async () => [],
    }
    const prepared = prepare_parse_result(
      1,
      {
        type: `trajectory`,
        filename: `unclonable.h5`,
        data: {
          frames: [{ structure: { sites: [] }, step: 0 }],
          is_indexed: true,
          frame_loader,
        },
      },
      new Blob(),
    )
    const cloned = structuredClone(prepared.response, { transfer: prepared.transfer })
    const frame_port = cloned.frame_port
    if (!frame_port) throw new Error(`lazy worker response has no frame port`)
    const response = next_port_message(frame_port)
    frame_port.postMessage({ id: 7, method: `load_frame`, args: [0] })
    await expect(response).resolves.toMatchObject({
      id: 7,
      error: expect.stringMatching(/clone|function/i),
    })
    frame_port.close()
  })

  it(`answers the worker message event with the request id and transfer list`, async () => {
    await load_worker()
    const post_message = vi.spyOn(self, `postMessage`).mockImplementation(() => {})
    self.dispatchEvent(
      new MessageEvent(`message`, {
        data: {
          kind: `file`,
          id: 11,
          content: `invalid`,
          filename: `invalid.unknown`,
          is_base64: false,
        },
      }),
    )
    await vi.waitFor(() =>
      expect(post_message).toHaveBeenCalledWith(
        { id: 11, error: expect.stringMatching(/invalid|unsupported|format/i) },
        { transfer: [] },
      ),
    )
  })
})
