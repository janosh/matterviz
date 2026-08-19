import type { ParseResult } from '$lib/file-viewer/parse'
import {
  MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES,
  MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES,
  parse_in_worker,
  parse_trajectory_in_worker,
  reset_parse_worker,
  should_index_worker_xyz,
} from '$lib/file-viewer/parse-in-worker'
import type {
  FrameWorkerRequest,
  FrameWorkerResponse,
  ParseWorkerRequest,
  ParseWorkerResponse,
  TrajectoryParseWorkerRequest,
  WorkerLike,
} from '$lib/file-viewer/parse-in-worker'
import type { AtomTypeMapping, FrameLoader, TrajectoryType } from '$lib/trajectory'
import { afterEach, describe, expect, it, vi } from 'vitest'

const structure_result: ParseResult = {
  type: `structure`,
  data: { sites: [] },
  filename: `mp-1.cif`,
}

const trajectory_worker_response = (
  id: number,
  data: TrajectoryType,
): ParseWorkerResponse => ({
  id,
  result: { type: `trajectory`, data, filename: `large.h5` },
})

interface FakeWorker extends WorkerLike {
  emit: (type: string, event: Event) => void
}

// Fake worker that answers requests through the provided responder.
const make_fake_worker = (
  respond: (request: ParseWorkerRequest) => ParseWorkerResponse | null,
): FakeWorker => {
  const listeners = new Map<string, EventListener[]>()
  const emit = (type: string, event: Event): void => {
    for (const listener of listeners.get(type) ?? []) listener(event)
  }
  return {
    postMessage: (message: unknown) => {
      const request = message as ParseWorkerRequest
      const response = respond(request)
      if (!response) return // simulate a hung worker (never answers)
      const transfer = response.frame_port ? [response.frame_port] : []
      const cloned_response = structuredClone(response, { transfer })
      queueMicrotask(() =>
        emit(`message`, new MessageEvent(`message`, { data: cloned_response })),
      )
    },
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener as EventListener])
    },
    emit,
    terminate: vi.fn(),
  }
}

const emit_worker_message = (worker: FakeWorker, response: ParseWorkerResponse): void =>
  worker.emit(`message`, new MessageEvent(`message`, { data: response }))

const unavailable_worker_factory = (): WorkerLike => {
  throw new Error(`Worker blocked by CSP`)
}

const parse_error_worker_factory = (): FakeWorker =>
  make_fake_worker((request) => ({ id: request.id, error: `h5 open failed` }))

const make_successful_worker = (): FakeWorker =>
  make_fake_worker((request) => ({ id: request.id, result: structure_result }))

const make_worker_factory = (...workers: WorkerLike[]) => {
  let worker_idx = 0
  return vi.fn<() => WorkerLike>(() => workers[Math.min(worker_idx++, workers.length - 1)])
}

const make_stalled_then = (...next: WorkerLike[]) => {
  const stalled = make_fake_worker(() => null)
  return { stalled, worker_factory: make_worker_factory(stalled, ...next) }
}

afterEach(() => {
  reset_parse_worker()
  vi.useRealTimers()
})

describe(`parse_in_worker`, () => {
  it(`parses an ArrayBuffer trajectory with reactive options without detaching the source`, async () => {
    const source = new Uint8Array([1, 2, 3, 4]).buffer
    let posted_request: TrajectoryParseWorkerRequest | undefined
    let posted_transfer: readonly Transferable[] = []
    const listeners = new Map<string, EventListener>()
    const worker: WorkerLike = {
      postMessage: (
        message: unknown,
        options?: StructuredSerializeOptions | Transferable[],
      ) => {
        posted_transfer = Array.isArray(options) ? options : (options?.transfer ?? [])
        const request = structuredClone(message, {
          transfer: [...posted_transfer],
        }) as TrajectoryParseWorkerRequest
        posted_request = request
        queueMicrotask(() =>
          listeners.get(`message`)?.(
            new MessageEvent(`message`, {
              data: trajectory_worker_response(request.id, {
                frames: [{ structure: { sites: [] }, step: 0 }],
                total_frames: 1,
              }),
            }),
          ),
        )
      },
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
        listeners.set(type, listener as EventListener),
      terminate: vi.fn(),
    }

    const trajectory = await parse_trajectory_in_worker(
      source,
      `large.h5`,
      undefined,
      { use_indexing: true, atom_type_mapping: new Proxy<AtomTypeMapping>({ 1: `H` }, {}) },
      { worker_factory: () => worker },
    )

    expect(source.byteLength).toBe(4)
    expect(posted_request).toMatchObject({
      kind: `trajectory`,
      filename: `large.h5`,
      options: { use_indexing: true, atom_type_mapping: { 1: `H` } },
    })
    expect(posted_request?.data).not.toBe(source)
    expect(posted_transfer).toHaveLength(1)
    expect(trajectory.total_frames).toBe(1)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it(`transfers a large File-backed trajectory source without cloning it`, async () => {
    const source = new Uint8Array([1, 2, 3, 4]).buffer
    let posted_data: ArrayBuffer | undefined
    const listeners = new Map<string, EventListener>()
    const worker: WorkerLike = {
      postMessage: (message, options) => {
        const request = message as TrajectoryParseWorkerRequest
        posted_data = request.data as ArrayBuffer
        const transfer = Array.isArray(options) ? options : (options?.transfer ?? [])
        structuredClone(message, { transfer })
        queueMicrotask(() =>
          listeners.get(`message`)?.(
            new MessageEvent(`message`, {
              data: trajectory_worker_response(request.id, {
                frames: [{ structure: { sites: [] }, step: 0 }],
              }),
            }),
          ),
        )
      },
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
        listeners.set(type, listener as EventListener),
      terminate: vi.fn(),
    }

    await parse_trajectory_in_worker(
      source,
      `large.h5`,
      undefined,
      { use_indexing: true },
      { worker_factory: () => worker, transfer_source: true },
    )

    expect(posted_data).toBe(source)
    expect(source.byteLength).toBe(0)
  })

  it(`preserves HDF5 group-selection errors from the trajectory worker`, async () => {
    const worker = make_fake_worker((request) => ({
      id: request.id,
      error: `choose a run`,
      hdf5_group_paths: [`/run_a`, `/run_b`],
    }))
    await expect(
      parse_trajectory_in_worker(
        new ArrayBuffer(8),
        `ambiguous.h5`,
        undefined,
        {},
        { worker_factory: () => worker },
      ),
    ).rejects.toMatchObject({
      name: `Hdf5TrajectoryGroupSelectionError`,
      message: `choose a run`,
      group_paths: [`/run_a`, `/run_b`],
    })
  })

  it(`reuses one worker with distinct request ids and no fallback`, async () => {
    const seen_requests: ParseWorkerRequest[] = []
    const worker = make_fake_worker((request) => {
      seen_requests.push(request)
      return { id: request.id, result: structure_result }
    })
    const worker_factory = vi.fn(() => worker)
    const fallback_parse = vi.fn()
    const worker_options = { worker_factory, fallback_parse }
    const requests = [
      { content: `data_si`, filename: `mp-1.cif`, is_base64: false },
      { content: `encoded`, filename: `sample.h5`, is_base64: true },
      { content: `data_c`, filename: `mp-2.cif`, is_base64: false },
    ]
    const results = await Promise.all(
      requests.map(({ content, filename, is_base64 }) =>
        parse_in_worker(content, filename, is_base64, worker_options),
      ),
    )

    expect(results).toEqual(requests.map(() => structure_result))
    expect(worker_factory).toHaveBeenCalledTimes(1)
    expect(new Set(seen_requests.map(({ id }) => id)).size).toBe(requests.length)
    expect(seen_requests.map(({ id: _request_id, ...request }) => request)).toEqual(requests)
    expect(fallback_parse).not.toHaveBeenCalled()
  })

  it(`materializes packed worker frames locally without a frame RPC port`, async () => {
    const packed_result: ParseResult = {
      type: `trajectory`,
      filename: `packed.h5`,
      data: {
        frames: [{ structure: { sites: [] }, step: 0 }],
        total_frames: 2,
        is_indexed: true,
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
      } satisfies TrajectoryType,
    }
    const worker = make_fake_worker((request) => ({ id: request.id, result: packed_result }))
    const result = await parse_in_worker(`payload`, `packed.h5`, true, {
      worker_factory: () => worker,
    })
    const trajectory = result.data as TrajectoryType

    expect(trajectory.frame_loader).toBeDefined()
    expect(trajectory.frame_loader?.load_frame_sync?.(1)).toMatchObject({
      step: 1,
      structure: { sites: [{ xyz: [1, 2, 3] }] },
    })
    await expect(trajectory.frame_loader?.load_frame(``, 1)).resolves.toMatchObject({
      step: 1,
      metadata: { energy: -1 },
      structure: { sites: [{ xyz: [1, 2, 3], species: [{ element: `H` }] }] },
    })
  })

  const indexed_xyz = `1\nstep=0\nH 0 0 0\n1\nstep=1\nHe 1 0 0\n`
  const make_indexed_frame_worker = (respond_to_frame_reads = true): FakeWorker => {
    const frame_channel = new MessageChannel()
    frame_channel.port1.addEventListener(
      `message`,
      (event: MessageEvent<FrameWorkerRequest>) => {
        const { id, method, args } = event.data
        if (method === `dispose`) frame_channel.port1.close()
        else if (method === `load_frame` && respond_to_frame_reads) {
          frame_channel.port1.postMessage({
            id,
            result: {
              step: Number(args[0]),
              structure: {
                sites: [{ species: [{ element: `He`, occu: 1 }], xyz: [1, 0, 0] }],
              },
            },
          })
        }
      },
    )
    frame_channel.port1.start()
    return make_fake_worker((request) => ({
      id: request.id,
      frame_port: frame_channel.port2,
      result: {
        type: `trajectory`,
        filename: `movie.xyz`,
        data: {
          frames: [],
          metadata: { frame_count: 2 },
          total_frames: 2,
          indexed_frames: [],
          plot_metadata: [],
          is_indexed: true,
        },
      },
    }))
  }

  it(`rejects pending frame reads when their worker crashes`, async () => {
    const worker = make_indexed_frame_worker(false)
    const result = await parse_in_worker(indexed_xyz, `movie.xyz`, false, {
      worker_factory: () => worker,
    })
    const frame_loader = (result.data as TrajectoryType).frame_loader
    if (!frame_loader) throw new Error(`expected indexed frame loader`)

    const pending = frame_loader.load_frame(``, 1)
    worker.emit(`error`, new ErrorEvent(`error`, { message: `worker crashed` }))

    await expect(pending).rejects.toThrow(`worker crashed`)
    await expect(frame_loader.load_frame(``, 0)).rejects.toThrow(`worker crashed`)
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it(`retires an indexed loader worker so later parses can abort independently`, async () => {
    const worker = make_indexed_frame_worker()
    const stalled_worker = make_fake_worker(() => null)
    const replacement_worker = make_successful_worker()
    const worker_factory = make_worker_factory(worker, stalled_worker, replacement_worker)
    const result = await parse_in_worker(indexed_xyz, `movie.xyz`, false, {
      worker_factory,
    })
    const frame_loader = (result.data as TrajectoryType).frame_loader
    if (!frame_loader?.dispose) throw new Error(`expected indexed frame loader`)
    await expect(frame_loader.load_frame(``, 1)).resolves.toMatchObject({
      step: 1,
      structure: { sites: [{ species: [{ element: `He` }] }] },
    })

    // A new parse gets a separate worker. Aborting it cannot kill the loader-backed worker.
    const controller = new AbortController()
    const cancelled = parse_in_worker(`large`, `slow.h5`, true, {
      worker_factory,
      signal: controller.signal,
      fallback_parse: vi.fn(),
    })
    await vi.waitFor(() => expect(worker_factory).toHaveBeenCalledTimes(2))
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ name: `AbortError` })
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(stalled_worker.terminate).toHaveBeenCalledOnce()

    const queued = parse_in_worker(`data_si`, `queued.cif`, false, {
      worker_factory,
    })
    await expect(queued).resolves.toEqual(structure_result)
    expect(worker_factory).toHaveBeenCalledTimes(3)

    await expect(frame_loader.load_frame(``, 1)).resolves.toMatchObject({ step: 1 })
    frame_loader.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
    await expect(frame_loader.load_frame(``, 1)).rejects.toThrow(
      `Indexed frame loader was disposed`,
    )
  })

  it(`settles every pending request after a worker message error`, async () => {
    const worker = make_fake_worker(() => null)
    const replacement_worker = make_successful_worker()
    const worker_factory = make_worker_factory(worker, replacement_worker)
    const fallback_parse = vi.fn().mockResolvedValue(structure_result)
    const worker_options = { worker_factory, fallback_parse }
    const pending_parse = parse_in_worker(`a`, `a.cif`, false, worker_options)
    const queued_opt_out = parse_in_worker(`b`, `b.cif`, false, {
      worker_factory,
      fallback_on_worker_error: false,
    })
    const queued_large = parse_in_worker(
      `x`.repeat(MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES + 1),
      `large.cif`,
      false,
      worker_options,
    )
    void Promise.allSettled([queued_opt_out, queued_large])

    worker.emit(`messageerror`, new MessageEvent(`messageerror`))

    await expect(pending_parse).resolves.toEqual(structure_result)
    await expect(queued_opt_out).rejects.toThrow(`failed to deserialize`)
    await expect(queued_large).rejects.toThrow(
      `main-thread fallback is disabled above ${MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES / 1024 ** 2} MiB text or ${MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES / 1024 ** 2} MiB decoded binary`,
    )
    expect(worker.terminate).toHaveBeenCalledOnce()
    await expect(parse_in_worker(`c`, `c.cif`, false, worker_options)).resolves.toEqual(
      structure_result,
    )
    expect(worker_factory).toHaveBeenCalledTimes(2)
    expect(fallback_parse).toHaveBeenCalledOnce()
  })

  it(`keeps a queued survivor off-thread across repeated active aborts`, async () => {
    const stalled_workers = [make_fake_worker(() => null), make_fake_worker(() => null)]
    const successful_worker = make_successful_worker()
    const worker_factory = make_worker_factory(...stalled_workers, successful_worker)
    const fallback_parse = vi.fn()
    const controllers = [new AbortController(), new AbortController()]
    const cancelled = controllers.map((controller, cancel_idx) =>
      parse_in_worker(`large`, `cancel-${cancel_idx}.h5`, true, {
        worker_factory,
        fallback_parse,
        signal: controller.signal,
      }),
    )
    const survivor = parse_in_worker(`data_si`, `survivor.cif`, false, {
      worker_factory,
      fallback_parse,
    })

    controllers[0].abort()
    await expect(cancelled[0]).rejects.toMatchObject({ name: `AbortError` })
    controllers[1].abort()
    await expect(cancelled[1]).rejects.toMatchObject({ name: `AbortError` })

    await expect(survivor).resolves.toEqual(structure_result)
    expect(stalled_workers[0].terminate).toHaveBeenCalledOnce()
    expect(stalled_workers[1].terminate).toHaveBeenCalledOnce()
    expect(worker_factory).toHaveBeenCalledTimes(3)
    expect(fallback_parse).not.toHaveBeenCalled()
  })

  it(`does not start queued jobs sharing an aborted signal`, async () => {
    const replacement_worker = make_successful_worker()
    const replacement_post = vi.spyOn(replacement_worker, `postMessage`)
    const { worker_factory } = make_stalled_then(replacement_worker)
    const controller = new AbortController()
    const worker_options = { worker_factory, signal: controller.signal }
    const parses = [
      parse_in_worker(`a`, `a.cif`, false, worker_options),
      parse_in_worker(`b`, `b.cif`, false, worker_options),
    ]

    controller.abort()

    await Promise.all(
      parses.map((parsing) => expect(parsing).rejects.toMatchObject({ name: `AbortError` })),
    )
    expect(replacement_post).not.toHaveBeenCalled()
    expect(worker_factory).toHaveBeenCalledOnce()
  })

  it(`removes a queued abort without terminating active worker work`, async () => {
    let active_request: ParseWorkerRequest | undefined
    const worker = make_fake_worker((request) => {
      active_request = request
      return null
    })
    const active_parse = parse_in_worker(`first`, `first.cif`, false, {
      worker_factory: () => worker,
    })
    const queued_controller = new AbortController()
    const queued_parse = parse_in_worker(`second`, `second.cif`, false, {
      worker_factory: () => worker,
      signal: queued_controller.signal,
    })

    queued_controller.abort()
    await expect(queued_parse).rejects.toMatchObject({ name: `AbortError` })
    expect(worker.terminate).not.toHaveBeenCalled()
    if (!active_request) throw new Error(`active request was not posted`)
    emit_worker_message(worker, { id: active_request.id, result: structure_result })
    await expect(active_parse).resolves.toEqual(structure_result)
  })

  it(`discards a worker whose factory aborts its job`, async () => {
    const controller = new AbortController()
    const aborted_worker = make_fake_worker(() => null)
    const aborted_post = vi.spyOn(aborted_worker, `postMessage`)
    const replacement_worker = make_successful_worker()
    let survivor: ReturnType<typeof parse_in_worker> | undefined
    const worker_factory = vi
      .fn<() => WorkerLike>()
      .mockImplementationOnce(() => {
        controller.abort()
        survivor = parse_in_worker(`data_si`, `survivor.cif`, false, { worker_factory })
        return aborted_worker
      })
      .mockReturnValue(replacement_worker)
    const parsing = parse_in_worker(`data_si`, `aborted.cif`, false, {
      signal: controller.signal,
      worker_factory,
    })

    await expect(parsing).rejects.toMatchObject({ name: `AbortError` })
    if (!survivor) throw new Error(`survivor parse was not started`)
    await expect(survivor).resolves.toEqual(structure_result)
    expect(aborted_post).not.toHaveBeenCalled()
    expect(aborted_worker.terminate).toHaveBeenCalledOnce()
  })

  it(`times out the active worker and continues the queued parse off-thread`, async () => {
    vi.useFakeTimers()
    const { stalled, worker_factory } = make_stalled_then(make_successful_worker())
    const fallback_parse = vi.fn().mockResolvedValue(structure_result)
    const timed_out = parse_in_worker(`large`, `slow.h5`, true, {
      worker_factory,
      fallback_parse,
      timeout_ms: 10,
    })
    const queued = parse_in_worker(`data_si`, `queued.cif`, false, {
      worker_factory,
      fallback_parse,
    })

    await vi.advanceTimersByTimeAsync(10)

    await expect(timed_out).resolves.toEqual(structure_result)
    await expect(queued).resolves.toEqual(structure_result)
    expect(stalled.terminate).toHaveBeenCalledOnce()
    expect(worker_factory).toHaveBeenCalledTimes(2)
    expect(fallback_parse).toHaveBeenCalledOnce()
  })

  it.each([`error`, `message`] as const)(
    `ignores late %s events from a terminated worker`,
    async (event_type) => {
      const fallback_parse = vi.fn()
      const controller = new AbortController()
      let replacement_request: ParseWorkerRequest | undefined
      const replacement_worker = make_fake_worker((request) => {
        replacement_request = request
        return null
      })
      const { stalled: stalled_worker, worker_factory } = make_stalled_then(replacement_worker)
      const cancelled = parse_in_worker(`large`, `cancelled.h5`, true, {
        worker_factory,
        fallback_parse,
        signal: controller.signal,
      })
      const survivor = parse_in_worker(`data_si`, `survivor.cif`, false, {
        worker_factory,
        fallback_parse,
      })
      controller.abort()
      await expect(cancelled).rejects.toMatchObject({ name: `AbortError` })
      if (!replacement_request) throw new Error(`replacement request missing`)

      stalled_worker.emit(
        event_type,
        event_type === `error`
          ? new ErrorEvent(`error`, { message: `terminated worker error` })
          : new MessageEvent(`message`, {
              data: {
                id: replacement_request.id,
                result: { ...structure_result, filename: `stale.cif` },
              },
            }),
      )
      emit_worker_message(replacement_worker, {
        id: replacement_request.id,
        result: structure_result,
      })
      await expect(survivor).resolves.toEqual(structure_result)
      expect(replacement_worker.terminate).not.toHaveBeenCalled()
      expect(fallback_parse).not.toHaveBeenCalled()
    },
  )

  it(`falls back when worker event-handler setup fails`, async () => {
    const terminate = vi.fn()
    const worker: WorkerLike = {
      postMessage: vi.fn(),
      addEventListener: () => {
        throw new Error(`listener setup failed`)
      },
      terminate,
    }
    await expect(
      parse_in_worker(`data_si`, `structure.cif`, false, {
        worker_factory: () => worker,
        fallback_parse: async () => structure_result,
      }),
    ).resolves.toEqual(structure_result)
    expect(terminate).toHaveBeenCalledOnce()
  })

  it.each([
    [`worker construction failure`, true, unavailable_worker_factory, null],
    [
      `worker construction failure`,
      false,
      unavailable_worker_factory,
      `Parse worker is unavailable`,
    ],
    [`worker parse failure`, true, parse_error_worker_factory, null],
    [`worker parse failure`, false, parse_error_worker_factory, `h5 open failed`],
  ] as const)(
    `handles %s with fallback=%s`,
    async (_label, fallback_on_worker_error, worker_factory, expected_error) => {
      const fallback_parse = vi.fn().mockResolvedValue(structure_result)
      const parsing = parse_in_worker(`junk`, `broken.h5`, true, {
        worker_factory,
        fallback_parse,
        fallback_on_worker_error,
      })
      if (expected_error) {
        await expect(parsing).rejects.toThrow(expected_error)
        expect(fallback_parse).not.toHaveBeenCalled()
      } else {
        await expect(parsing).resolves.toEqual(structure_result)
        expect(fallback_parse).toHaveBeenCalledWith(`junk`, `broken.h5`, true)
      }
    },
  )

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
    const fallback_parse = vi.fn().mockResolvedValue(structure_result)
    const parsing = parse_in_worker(`x`.repeat(length), `huge.h5`, is_base64, {
      worker_factory: parse_error_worker_factory,
      fallback_parse,
    })
    if (expect_fallback) await expect(parsing).resolves.toEqual(structure_result)
    else await expect(parsing).rejects.toThrow(`main-thread fallback is disabled`)
    expect(fallback_parse).toHaveBeenCalledTimes(expect_fallback ? 1 : 0)
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

  it(`keeps indexable XYZ data indexed during main-thread fallback`, async () => {
    const content = `1\nframe\nH 0 0 0\n`.repeat(64)
    const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
    const result = await parse_in_worker(content, `movie.xyz`, false, {
      worker_factory: parse_error_worker_factory,
    })
    warn.mockRestore()

    expect(result).toMatchObject({
      type: `trajectory`,
      data: { is_indexed: true, total_frames: 64 },
    })
    const trajectory = result.data as TrajectoryType
    trajectory.frame_loader?.dispose?.()
  })

  it(`returns cloneable indexed worker results with live frame RPC`, async () => {
    const { TrajFrameReader } = await import(`$lib/trajectory/parse`)
    const dispose_spy = vi.spyOn(TrajFrameReader.prototype, `dispose`)
    const { handle_parse_worker_request, prepare_parse_result } = await import(
      `$lib/file-viewer/parse-worker`
    )
    const stream_values = new Float64Array([1, 2, 3, 4, 5, 6])
    const stream_scalars = new Float64Array([0.5, 1.5])
    const compact_loader: FrameLoader = {
      get_total_frames: async () => 2,
      build_frame_index: async () => [],
      load_frame: async () => ({ structure: { sites: [] }, step: 0 }),
      extract_plot_metadata: async () => [],
      stream_positions: async () => ({
        positions: stream_values,
        scalars: { charge: stream_scalars },
        vectors: { velocity: stream_values },
        signals: {
          dipole: { values: stream_values, sample_shape: [3], steps: [0, 1] },
        },
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
    const compact = prepare_parse_result(
      6,
      {
        type: `trajectory`,
        data: {
          frames: [{ structure: { sites: [] }, step: 0 }],
          total_frames: 2,
          is_indexed: true,
          frame_loader: compact_loader,
        },
        filename: `compact.h5`,
      },
      `binary payload`,
    )
    const cloned_compact = structuredClone(compact.response, { transfer: compact.transfer })
    const compact_trajectory = cloned_compact.result?.data as TrajectoryType
    expect(compact.transfer).toHaveLength(1)
    expect(compact_trajectory.is_indexed).toBe(true)
    expect(compact_trajectory.frame_loader).toBeUndefined()
    const compact_frame_port = cloned_compact.frame_port
    if (!compact_frame_port) throw new Error(`compact worker response has no frame port`)
    const stream_response = new Promise<FrameWorkerResponse>((resolve) => {
      compact_frame_port.addEventListener(
        `message`,
        (event: MessageEvent<FrameWorkerResponse>) => resolve(event.data),
        { once: true },
      )
      compact_frame_port.start()
    })
    // oxlint-disable-next-line eslint-plugin-unicorn/require-post-message-target-origin -- MessagePort has no targetOrigin argument.
    compact_frame_port.postMessage({ id: 7, method: `stream_positions`, args: [{}] })
    const streamed = (await stream_response).result
    expect(streamed).toMatchObject({
      positions: new Float64Array([1, 2, 3, 4, 5, 6]),
      scalars: { charge: new Float64Array([0.5, 1.5]) },
      vectors: { velocity: new Float64Array([1, 2, 3, 4, 5, 6]) },
      signals: { dipole: { values: new Float64Array([1, 2, 3, 4, 5, 6]) } },
    })
    expect(stream_values.byteLength).toBe(0)
    expect(stream_scalars.byteLength).toBe(0)
    cloned_compact.frame_port?.close()

    const packed_positions = new Float64Array([0, 0, 0, 1, 2, 3])
    const packed_velocity = new Float64Array([1, 0, 0, 0, 1, 0])
    const packed = prepare_parse_result(
      7,
      {
        type: `trajectory`,
        data: {
          frames: [{ structure: { sites: [] }, step: 0 }],
          total_frames: 2,
          is_indexed: true,
          frame_loader: compact_loader,
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
              velocity: {
                values: packed_velocity,
                sample_shape: [1, 3],
                steps: [0, 1],
              },
            },
          },
        },
        filename: `packed.h5`,
      },
      `binary payload`,
    )
    expect(packed.response.frame_port).toBeUndefined()
    expect(packed.transfer).toEqual([packed_positions.buffer, packed_velocity.buffer])
    const packed_result = packed.response.result
    if (!packed_result) throw new Error(`packed parse result missing`)
    expect((packed_result.data as TrajectoryType).frame_loader).toBeUndefined()

    const { response, transfer } = await handle_parse_worker_request({
      id: 8,
      content: `1\nframe\nH 0 0 0\n`.repeat(64),
      filename: `movie.xyz`,
      is_base64: false,
    })
    const cloned = structuredClone(response, { transfer })
    expect(transfer).toEqual([response.frame_port])
    const frame_port = cloned.frame_port
    if (!frame_port) throw new Error(`indexed worker response has no frame port`)
    const frame_response = new Promise<FrameWorkerResponse>((resolve) => {
      frame_port.addEventListener(
        `message`,
        (event: MessageEvent<FrameWorkerResponse>) => resolve(event.data),
        { once: true },
      )
      frame_port.start()
    })
    // oxlint-disable-next-line eslint-plugin-unicorn/require-post-message-target-origin -- MessagePort has no targetOrigin argument.
    frame_port.postMessage({ id: 9, method: `load_frame`, args: [63] })

    expect(cloned.result).toMatchObject({
      type: `trajectory`,
      data: { is_indexed: true, frame_loader: undefined },
    })
    expect((await frame_response).result).toMatchObject({
      step: 63,
      structure: { sites: [{ species: [{ element: `H` }] }] },
    })
    // oxlint-disable-next-line eslint-plugin-unicorn/require-post-message-target-origin -- MessagePort has no targetOrigin argument.
    frame_port.postMessage({ id: 10, method: `dispose`, args: [] })
    await vi.waitFor(() => expect(dispose_spy).toHaveBeenCalledOnce())
    let follow_up_response: FrameWorkerResponse | undefined
    frame_port.addEventListener(`message`, (event: MessageEvent<FrameWorkerResponse>) => {
      follow_up_response = event.data
    })
    // oxlint-disable-next-line eslint-plugin-unicorn/require-post-message-target-origin -- MessagePort has no targetOrigin argument.
    frame_port.postMessage({ id: 11, method: `load_frame`, args: [0] })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(follow_up_response).toBeUndefined()
    dispose_spy.mockRestore()
    frame_port.close()
  })

  it(`posts worker responses with structured serialization options`, async () => {
    await import(`$lib/file-viewer/parse-worker`)
    const post_message = vi.spyOn(self, `postMessage`).mockImplementation(() => {})
    self.dispatchEvent(
      new MessageEvent(`message`, {
        data: { id: 11, content: `invalid`, filename: `invalid.unknown`, is_base64: false },
      }),
    )

    await vi.waitFor(() =>
      expect(post_message).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }), {
        transfer: [],
      }),
    )
    post_message.mockRestore()
  })

  it(`marks the worker unusable after a script-level error event and stops retrying it`, async () => {
    const failing_worker: WorkerLike = {
      postMessage: () => {},
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        // Fire the script-load error as soon as the wrapper wires the handler
        if (type === `error`) {
          queueMicrotask(() =>
            (listener as EventListener)(
              new ErrorEvent(`error`, { message: `wasm asset 404` }),
            ),
          )
        }
      },
      terminate: vi.fn(),
    }
    const worker_factory = vi.fn(() => failing_worker)
    const fallback_parse = vi.fn().mockResolvedValue(structure_result)

    await parse_in_worker(`x`, `a.h5`, true, { worker_factory, fallback_parse })
    await parse_in_worker(`y`, `b.h5`, true, { worker_factory, fallback_parse })

    expect(worker_factory).toHaveBeenCalledTimes(1) // second call skips straight to fallback
    expect(fallback_parse).toHaveBeenCalledTimes(2)
  })

  it(`does not restart fallback after a late worker error`, async () => {
    const deferred_parse = Promise.withResolvers<ParseResult>()
    const worker = parse_error_worker_factory()
    const fallback_parse = vi.fn(() => deferred_parse.promise)
    const parsing = parse_in_worker(`junk`, `broken.h5`, true, {
      worker_factory: () => worker,
      fallback_parse,
    })
    await vi.waitFor(() => expect(fallback_parse).toHaveBeenCalledOnce())

    worker.emit(`error`, new ErrorEvent(`error`, { message: `late worker failure` }))
    expect(fallback_parse).toHaveBeenCalledOnce()
    deferred_parse.resolve(structure_result)
    await expect(parsing).resolves.toEqual(structure_result)
  })

  it(`serializes fallbacks when the worker is unavailable`, async () => {
    const deferred_fallbacks = Array.from({ length: 3 }, () =>
      Promise.withResolvers<ParseResult>(),
    )
    const fallback_parse = vi.fn(
      (_content: string, filename: string) =>
        deferred_fallbacks[Number(filename.at(0))].promise,
    )
    const parses = deferred_fallbacks.map((_deferred, parse_idx) =>
      parse_in_worker(`${parse_idx}`, `${parse_idx}.cif`, false, {
        fallback_parse,
        worker_factory: unavailable_worker_factory,
      }),
    )

    await vi.waitFor(() => expect(fallback_parse).toHaveBeenCalledOnce())
    for (const [parse_idx, deferred] of deferred_fallbacks.entries()) {
      deferred.resolve(structure_result)
      await expect(parses[parse_idx]).resolves.toEqual(structure_result)
      if (parse_idx < deferred_fallbacks.length - 1) {
        await vi.waitFor(() => expect(fallback_parse).toHaveBeenCalledTimes(parse_idx + 2))
      }
    }
  })

  it.each([
    {
      label: `valid marker`,
      content: `LARGE_FILE:/tmp/huge.extxyz:268435456`,
      filename: `huge.extxyz`,
      is_base64: false,
      fallback: () => vi.fn().mockResolvedValue(structure_result),
      expected: structure_result,
    },
    {
      label: `malformed marker`,
      content: `LARGE_FILE:/tmp/file:not-a-number`,
      filename: `file.h5`,
      is_base64: true,
      fallback: () => vi.fn().mockRejectedValue(new Error(`Malformed large file size`)),
      expected: `Malformed large file size`,
    },
  ])(
    `routes LARGE_FILE $label to fallback without a worker`,
    async ({ content, filename, is_base64, fallback, expected }) => {
      const worker_factory = vi.fn()
      const fallback_parse = fallback()
      const parsing = parse_in_worker(content, filename, is_base64, {
        worker_factory,
        fallback_parse,
      })
      if (typeof expected === `string`) await expect(parsing).rejects.toThrow(expected)
      else await expect(parsing).resolves.toEqual(expected)
      expect(worker_factory).not.toHaveBeenCalled()
      expect(fallback_parse).toHaveBeenCalledExactlyOnceWith(content, filename, is_base64)
    },
  )

  it(`reset aborts an active LARGE_FILE fallback`, async () => {
    const deferred_parse = Promise.withResolvers<ParseResult>()
    const parsing = parse_in_worker(
      `LARGE_FILE:/tmp/huge.extxyz:268435456`,
      `huge.extxyz`,
      false,
      { fallback_parse: () => deferred_parse.promise },
    )
    const queued = parse_in_worker(`data_si`, `queued.cif`, false)
    void queued.catch(() => {})
    await Promise.resolve()

    reset_parse_worker()

    await expect(parsing).rejects.toMatchObject({ name: `AbortError` })
    await expect(queued).rejects.toMatchObject({ name: `AbortError` })
    await expect(
      parse_in_worker(`data_si`, `recovered.cif`, false, {
        worker_factory: make_successful_worker,
      }),
    ).resolves.toEqual(structure_result)
    deferred_parse.resolve(structure_result)
  })

  it.each([
    [`LARGE_FILE fallback`, `LARGE_FILE:/tmp/huge.extxyz:268435456`, undefined],
    [`unavailable-worker fallback`, `data_si`, unavailable_worker_factory],
  ])(`cancels %s before its parser settles`, async (_label, content, worker_factory) => {
    const deferred_parse = Promise.withResolvers<ParseResult>()
    const fallback_parse = vi
      .fn()
      .mockImplementationOnce(() => deferred_parse.promise)
      .mockResolvedValue(structure_result)
    const controller = new AbortController()
    const options = {
      fallback_parse,
      ...(worker_factory ? { worker_factory } : {}),
    }
    const parsing = parse_in_worker(content, `huge.extxyz`, false, {
      ...options,
      signal: controller.signal,
    })
    const queued = parse_in_worker(content, `queued.extxyz`, false, options)

    await vi.waitFor(() => expect(fallback_parse).toHaveBeenCalledOnce())
    controller.abort()
    await expect(parsing).rejects.toMatchObject({ name: `AbortError` })
    await vi.waitFor(() => expect(fallback_parse).toHaveBeenCalledTimes(2))
    await expect(queued).resolves.toEqual(structure_result)
    deferred_parse.resolve(structure_result)
  })
})
