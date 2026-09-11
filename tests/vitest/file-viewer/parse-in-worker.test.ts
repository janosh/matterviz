import type { ParseResult } from '$lib/file-viewer/parse'
import type {
  ParseWorkerRequest,
  ParseWorkerResponse,
  WorkerLike,
} from '$lib/file-viewer/parse-in-worker'
import { parse_in_worker } from '$lib/file-viewer/parse-in-worker'
import { handle_parse_worker_request } from '$lib/file-viewer/parse-worker'
import { prediction_to_json } from '$lib/structure/prediction'
import { make_grid, make_volume } from '../setup'
import type { Hdf5GroupSelectionRequiredError, TrajectoryFrame } from '$lib/trajectory'
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

afterEach(() => vi.restoreAllMocks())

describe(`parse_in_worker`, () => {
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
    expect(run.read_frame(0)).toEqual(frame)
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
