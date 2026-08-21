import type { ParseResult } from '$lib/file-viewer/parse'
import {
  MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES,
  MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES,
  parse_in_worker,
  parse_trajectory_in_worker,
  type ParseWorkerRequest,
  type ParseWorkerResponse,
  type WorkerLike,
} from '$lib/file-viewer/parse-in-worker'
import { handle_parse_worker_request } from '$lib/file-viewer/parse-worker'
import {
  summarize_run,
  trajectory_from_frames,
  type Hdf5GroupSelectionRequiredError,
  type TrajectoryFrame,
} from '$lib/trajectory'
import { serve_run_over_port } from '$lib/trajectory/runs/worker'
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

const silence_warnings = (): ReturnType<typeof vi.spyOn> =>
  vi.spyOn(console, `warn`).mockImplementation(() => {})

afterEach(() => vi.restoreAllMocks())

describe(`parse_in_worker`, () => {
  it(`posts a file request and terminates the worker after a non-trajectory reply`, async () => {
    const worker = make_fake_worker()
    const fallback_parse = vi.fn()
    await expect(
      parse_in_worker(`data_si`, `si.cif`, false, {
        worker_factory: () => worker,
        fallback_parse,
        load_options: { index_above_bytes: 4096 },
      }),
    ).resolves.toEqual(structure_result)
    // host loading settings ride along so the worker's open_trajectory honours them
    expect(worker.posted[0].request).toMatchObject({
      kind: `file`,
      content: `data_si`,
      filename: `si.cif`,
      is_base64: false,
      load_options: { index_above_bytes: 4096 },
    })
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(fallback_parse).not.toHaveBeenCalled()
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
  ])(`falls back when worker %s fails`, async (_label, make_worker) => {
    silence_warnings()
    const fallback_parse = vi.fn().mockResolvedValue(structure_result)
    await expect(
      parse_in_worker(`data`, `si.cif`, false, {
        worker_factory: make_worker,
        fallback_parse,
        load_options: { index_above_bytes: 4096 },
      }),
    ).resolves.toEqual(structure_result)
    expect(fallback_parse).toHaveBeenCalledExactlyOnceWith(`data`, `si.cif`, false, {
      index_above_bytes: 4096,
    })
  })

  it.each([
    [`text`, MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES + 1, false],
    [`base64`, Math.ceil((MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES * 4) / 3), true],
  ])(`refuses an oversized %s main-thread fallback`, async (_label, length, is_base64) => {
    silence_warnings()
    await expect(
      parse_in_worker(`x`.repeat(length), `huge.h5`, is_base64, {
        worker_factory: () => {
          throw new Error(`blocked`)
        },
      }),
    ).rejects.toThrow(`main-thread fallback is disabled`)
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
})

describe(`parse_trajectory_in_worker`, () => {
  it(`returns a live worker-backed run and terminates its worker on dispose`, async () => {
    const worker = make_fake_worker(trajectory_response)
    const run = await parse_trajectory_in_worker(
      `1\nframe\nH 1 2 3\n`,
      `movie.xyz`,
      undefined,
      {},
      {
        worker_factory: () => worker,
      },
    )
    expect(run.frame_count).toBe(1)
    expect(run.read_frame(0)).toEqual(frame)
    expect(worker.terminate).not.toHaveBeenCalled()
    run.dispose()
    await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce())
  })

  it(`clones ArrayBuffer sources by default and snapshots mapping options`, async () => {
    const source = new Uint8Array([1, 2, 3, 4]).buffer
    const worker = make_fake_worker(trajectory_response)
    const mapping = new Proxy({ 1: `H` as const }, {})
    const run = await parse_trajectory_in_worker(
      source,
      `large.h5`,
      undefined,
      {
        atom_type_mapping: mapping,
      },
      { worker_factory: () => worker },
    )
    expect(source.byteLength).toBe(4)
    expect(worker.posted[0].request).toMatchObject({
      kind: `trajectory`,
      filename: `large.h5`,
      options: { atom_type_mapping: { 1: `H` } },
    })
    expect(worker.posted[0].transfer).toHaveLength(1)
    run.dispose()
  })

  it(`surfaces an ambiguous HDF5 group choice as a typed error`, async () => {
    const worker = make_fake_worker((request) => ({
      id: request.id,
      error: `ambiguous`,
      hdf5_group_paths: [`/a`, `/b`],
    }))
    await expect(
      parse_trajectory_in_worker(
        `text`,
        `multi.h5`,
        undefined,
        {},
        {
          worker_factory: () => worker,
        },
      ),
    ).rejects.toMatchObject({
      name: `Hdf5GroupSelectionRequiredError`,
      groups: [`/a`, `/b`],
      message: `ambiguous`,
    } satisfies Partial<Hdf5GroupSelectionRequiredError>)
  })

  it(`forwards progress events before the run result`, async () => {
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
    const run = await parse_trajectory_in_worker(
      `text`,
      `run.xyz`,
      progress,
      {},
      {
        worker_factory: () => worker,
      },
    )
    expect(progress).toHaveBeenCalledWith({ current: 1, total: 2, stage: `read` })
    run.dispose()
  })
})

describe(`parse worker handler`, () => {
  it(`keeps a parsed trajectory behind a transferred run port`, async () => {
    const { response, transfer } = await handle_parse_worker_request({
      kind: `trajectory`,
      id: 7,
      data: `1\nframe\nH 1 2 3\n`,
      filename: `movie.xyz`,
      options: {},
    })
    expect(response.id).toBe(7)
    expect(response.result?.type).toBe(`trajectory`)
    expect(response.result?.data).toMatchObject({
      frame_count: 1,
      preview: { step: 0, structure: { sites: [{ xyz: [1, 2, 3] }] } },
    })
    expect(transfer).toEqual([response.run_port])
    response.run_port?.close()
  })
})
