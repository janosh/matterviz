import { materialize_frame_result, type NumericFrame } from '#lib/trajectory/frame'
import { FramePreparer } from '#lib/trajectory/prepare'
import { prepare_worker_count, type PrepareRequest } from '#lib/trajectory/prepare-pool'
import type { ParseResult } from '#lib/file-viewer/parse'
import type {
  ParseWorkerRequest,
  ParseWorkerResponse,
  WorkerLike,
} from '#lib/file-viewer/parse-in-worker'
import { parse_in_worker, ParseWorkerError } from '#lib/file-viewer/parse-in-worker'
import { parse_file_content } from '#lib/file-viewer/parse'
import { handle_parse_worker_request } from '#lib/file-viewer/parse-worker'
import { prediction_to_json } from '#lib/structure/prediction'
import { import_without_workers } from '../setup'
import { make_grid, make_volume } from '../test-fixtures'
import type {
  Hdf5GroupSelectionRequiredError,
  TrajectoryFrame,
  TrajectoryRun,
} from '#lib/trajectory/index'
import { summarize_run } from '#lib/trajectory/run'
import { trajectory_from_frames } from '#lib/trajectory/runs/memory'
import { dispose_run_port, serve_run_over_port } from '#lib/trajectory/runs/worker'
import { afterEach, describe, expect, it, type Mock, vi } from 'vite-plus/test'

// MessagePort/Worker postMessage take no targetOrigin (that's window.postMessage)
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin

const structure_result: ParseResult = {
  type: `structure`,
  data: { sites: [] },
  filename: `mp-1.cif`,
  warnings: [],
}
const frame: TrajectoryFrame = {
  step: 0,
  structure: {
    charge: 0,
    sites: [
      {
        species: [{ element: `H`, occu: 1 }],
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
  // false: the worker never posts its ready message, as one that hangs while loading
  announce = true,
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
      // Like the real worker, announce the start once its module has loaded
      if (announce && type === `message` && !listeners.has(type))
        queueMicrotask(() =>
          emit(`message`, new MessageEvent(`message`, { data: { id: -1 } })),
        )
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
    result: { type: `trajectory`, filename: request.filename, data: summarize_run(run) },
    run_port,
  }
}

const reply = (worker: FakeWorker, data: ParseWorkerResponse): void =>
  worker.emit(`message`, new MessageEvent(`message`, { data }))

type ParseOptions = NonNullable<Parameters<typeof parse_in_worker>[3]>
// Parse through `worker`; content and filename matter only where a test inspects the request
const parse_with = (
  worker: WorkerLike,
  options: ParseOptions = {},
  content: Parameters<typeof parse_in_worker>[0] = `text`,
  filename = `movie.xyz`,
) => parse_in_worker(content, filename, false, { worker_factory: () => worker, ...options })
// A shared worker lingers 10 s once idle (a dedicated or retired one stops at once). Needs fake
// timeouts, installed by the test before the worker goes idle.
const use_fake_timeouts = () => vi.useFakeTimers({ toFake: [`setTimeout`, `clearTimeout`] })
const expect_stops_after_grace = async (worker: FakeWorker): Promise<void> => {
  await vi.advanceTimersByTimeAsync(9000)
  expect(worker.terminate).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  expect(worker.terminate).toHaveBeenCalledOnce()
}
// Lets a fresh fake worker announce its start, which releases the parses queued for it
const started = () => new Promise((resolve) => setImmediate(resolve))
// A factory of workers that answer nothing on their own, each kept for the test to drive
const silent_workers = () => {
  const workers: FakeWorker[] = []
  const worker_factory = vi.fn(() => {
    const worker = make_fake_worker(() => null)
    workers.push(worker)
    return worker
  })
  return { workers, worker_factory }
}
const open_run = async (worker: WorkerLike): Promise<TrajectoryRun> => {
  const result = await parse_with(worker)
  if (result.type !== `trajectory`) throw new Error(`Expected trajectory`)
  return result.data
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe(`parse_in_worker`, () => {
  it.each([
    [9999, `movie.xyz`, false],
    [10_000, `movie.xyz`, true],
    [333_200, `device.h5`, true],
  ])(
    `prepares a %i-atom run's frames (%s) in pool workers: %s`,
    async (atom_count, filename, pooled) => {
      const worker = make_fake_worker((request) => {
        const response = trajectory_response(request)
        if (response.result?.type === `trajectory`)
          response.result.data.atom_count = atom_count
        return response
      })
      const prepare_workers: { posted: number[]; terminate: Mock<() => void> }[] = []
      const prepare_worker_factory = () => {
        const target = new EventTarget()
        const prepare_worker = Object.assign(target, {
          posted: [] as number[],
          postMessage: (
            message: PrepareRequest<{ frame: NumericFrame }>,
            { transfer }: StructuredSerializeOptions,
          ) => {
            const {
              id: identifier,
              input,
              preparation: settings,
            } = structuredClone(message, {
              transfer,
            })
            prepare_worker.posted.push(input.frame.header.step)
            const display = new FramePreparer().prepare(input.frame, settings)
            const data = { id: identifier, display, prepare_ms: 0 }
            queueMicrotask(() => target.dispatchEvent(new MessageEvent(`message`, { data })))
          },
          terminate: vi.fn(),
        })
        prepare_workers.push(prepare_worker)
        return prepare_worker as unknown as WorkerLike
      }
      vi.spyOn(navigator, `hardwareConcurrency`, `get`).mockReturnValue(4)
      const content = filename.endsWith(`.h5`) ? new File([`HDF5`], filename) : `text`
      const result = await parse_with(worker, { prepare_worker_factory }, content, filename)
      if (result.type !== `trajectory`) throw new Error(`Expected trajectory`)
      const run = result.data
      // the parse worker's core is not spared: it idles between decodes
      expect(run.preparation_concurrency).toBe(pooled ? prepare_worker_count(5) : undefined)
      const prepared = await run.prepare_frame?.(0, {
        bonding_strategy: `electroneg_ratio`,
        bonding_options: {},
        bonds: false,
      })
      expect(prepared?.frame.header.step).toBe(0)
      expect(prepare_workers.map(({ posted }) => posted)).toEqual(pooled ? [[0]] : [])
      run.dispose()
      expect(prepare_workers.every(({ terminate }) => terminate.mock.calls.length === 1)).toBe(
        true,
      )
    },
  )

  it.each([
    [`Worker is missing`, undefined],
    [`workers are disabled`, vi.fn()],
  ])(`parses on the main thread where %s`, async (_label, worker_global) => {
    vi.stubGlobal(`Worker`, worker_global)
    const disabled = worker_global !== undefined
    const module = await (disabled
      ? import_without_workers(() => import(`#lib/file-viewer/parse-in-worker`))
      : import(`#lib/file-viewer/parse-in-worker`))
    const content = `{"lattice": {"matrix": [[3, 0, 0], [0, 3, 0], [0, 0, 3]]}, "sites": []}`
    const result = await module.parse_in_worker(content, `empty.json`)
    expect(result).toEqual(await parse_file_content(content, `empty.json`))
    if (disabled) expect(worker_global).not.toHaveBeenCalled()
    // an abort while the main-thread parse runs still rejects, as on the worker path
    const abort_parse = async () => {
      const controller = new AbortController()
      const pending = module.parse_in_worker(content, `empty.json`, false, {
        signal: controller.signal,
      })
      controller.abort()
      await expect(pending).rejects.toThrow(/abort/i)
    }
    await abort_parse()
    // and disposes a trajectory parsed meanwhile, else its listeners leak
    const run = trajectory_from_frames([frame])
    const dispose = vi.spyOn(run, `dispose`)
    const parse_module = await import(`#lib/file-viewer/parse`)
    vi.spyOn(parse_module, `parse_file_content`).mockResolvedValueOnce({
      type: `trajectory`,
      data: run,
      filename: `run.xyz`,
    })
    await abort_parse()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it(`posts a file request and stops the worker after a non-trajectory reply`, async () => {
    use_fake_timeouts()
    const worker = make_fake_worker()
    const load_options = { index_above_bytes: 4096, atom_type_mapping: { 1: `H` as const } }
    await expect(parse_with(worker, { load_options }, `data_si`, `si.cif`)).resolves.toEqual(
      structure_result,
    )
    // host loading settings ride along so the worker's open_trajectory honours them
    expect(worker.posted[0].request).toMatchObject({
      content: `data_si`,
      filename: `si.cif`,
      is_base64: false,
      load_options,
    })
    await expect_stops_after_grace(worker)
  })

  // A worker that never started (constructor threw, or errored before its first message)
  // hands the parse to the main thread; it was never given the buffer, so that parses too
  const xyz = `1\nH\nH 0 0 0\n`
  it.each([
    [`constructor throws`, true, xyz],
    [`errors before its first message`, false, xyz],
    [`was sent a buffer and never started`, false, new TextEncoder().encode(xyz).buffer],
  ])(`a worker that %s`, async (_label, throws, content) => {
    vi.spyOn(console, `warn`).mockImplementation(() => {})
    const worker = make_fake_worker(() => null)
    const worker_factory = () => {
      if (throws) throw new Error(`refused`)
      return worker
    }
    const parsing = parse_in_worker(content, `h.xyz`, false, {
      worker_factory,
      owns_content: true,
    })
    if (!throws) worker.emit(`error`, new ErrorEvent(`error`, { message: `404` }))
    expect(await parsing).toEqual(await parse_file_content(xyz, `h.xyz`))
  })

  it(`aborting terminates the worker`, async () => {
    const worker = make_fake_worker(() => null)
    const controller = new AbortController()
    const parsing = parse_with(worker, { signal: controller.signal })
    controller.abort()
    await expect(parsing).rejects.toMatchObject({ name: `AbortError` })
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  // Only failures meaning this page can't run workers move later parses to the main thread:
  // a throwing constructor, no start within the timeout, or start failures in a row. A one-off
  // start failure or a crash after starting leaves the next parse a fresh worker.
  it.each([
    [`constructor throws`, true, [`throw`]],
    [`hangs without starting`, true, [`hang`]],
    [`fails to start once`, false, [`error`]],
    [`fails to start twice in a row`, true, [`error`, `error`]],
    [`fails to start, starts, fails to start`, false, [`error`, `crash`, `error`]],
    [`crashes after starting`, false, [`crash`]],
  ] as const)(
    `a default worker that %s disables workers: %s`,
    async (_label, disabled, failures) => {
      vi.resetModules()
      use_fake_timeouts()
      const warn = vi.spyOn(console, `warn`).mockImplementation(() => {})
      const workers: FakeWorker[] = []
      // oxlint-disable-next-line prefer-arrow-callback -- Worker must be constructable with new
      const factory = vi.fn(function () {
        const failure = failures[workers.length] ?? `none`
        if (failure === `throw`) throw new DOMException(`cross-origin`, `SecurityError`)
        const worker = make_fake_worker(
          failure === `crash` ? () => null : undefined,
          failure !== `hang` && failure !== `error`,
        )
        workers.push(worker)
        return worker
      })
      vi.stubGlobal(`Worker`, factory)
      const module = await import(`#lib/file-viewer/parse-in-worker`)
      const availability = await import(`svelte-widgets/worker-client`)
      for (const [idx, failure] of failures.entries()) {
        const content = new TextEncoder().encode(xyz).buffer
        const parsing = module.parse_in_worker(content, `h${idx}.xyz`, false, {
          owns_content: true,
        })
        if (failure === `crash`) {
          await started()
          workers.at(-1)?.emit(`error`, new ErrorEvent(`error`, { message: `out of memory` }))
          await expect(parsing).rejects.toMatchObject({ failure: `crashed` })
          continue
        }
        if (failure === `error`)
          workers.at(-1)?.emit(`error`, new ErrorEvent(`error`, { message: `404` }))
        // a worker that never starts can't hold the parse: it falls back after the timeout
        if (failure === `hang`)
          await vi.advanceTimersByTimeAsync(module.WORKER_START_TIMEOUT_MS)
        await expect(parsing).resolves.toEqual(await parse_file_content(xyz, `h${idx}.xyz`))
        // the worker never started, so it was never given the buffer the retry parsed
        expect(content.detached).toBe(false)
        if (failure !== `throw`) expect(workers.at(-1)?.terminate).toHaveBeenCalledOnce()
      }
      // each fallback says it happened, and whether it disabled workers
      const warnings = warn.mock.calls.map(([message]) => String(message))
      expect(warnings).toHaveLength(failures.filter((kind) => kind !== `crash`).length)
      for (const [idx, message] of warnings.entries()) {
        expect(message).toContain(`on the main thread`)
        expect(message.includes(`disabled`)).toBe(disabled && idx === warnings.length - 1)
      }
      expect(availability.can_create_worker()).toBe(!disabled)
      await expect(module.parse_in_worker(xyz, `next.xyz`)).resolves.toMatchObject({
        type: `structure`,
      })
      // a later parse constructs a fresh worker unless workers were disabled
      expect(factory).toHaveBeenCalledTimes(failures.length + (disabled ? 0 : 1))
    },
  )

  it(`returns a live worker-backed run and stops its worker after dispose`, async () => {
    use_fake_timeouts()
    const worker = make_fake_worker(trajectory_response)
    const run = await open_run(worker)
    expect(run.frame_count).toBe(1)
    expect(await materialize_frame_result(run.read_frame(0))).toEqual(frame)
    expect(worker.terminate).not.toHaveBeenCalled()
    run.dispose()
    await expect_stops_after_grace(worker)
  })

  it.each([`missing port`, `malformed summary`])(
    `rejects a trajectory with %s and releases its worker`,
    async (failure) => {
      use_fake_timeouts()
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
      await expect(parse_with(worker)).rejects.toThrow(
        failure === `missing port` ? /missing its run port/ : /rows/,
      )
      await expect_stops_after_grace(worker)
    },
  )

  // Ownership alone decides whether bytes may be detached, independently of file size
  it.each([
    [`clones by default`, 4, undefined, 0],
    [`transfers a small payload the caller gave up`, 1024, true, 1],
    [`clones when the caller keeps ownership`, 60 * 1024 * 1024, false, 0],
    [`transfers an oversized payload the caller gave up`, 60 * 1024 * 1024, true, 1],
  ])(`%s`, async (_label, size, owns_content, expected_transfers) => {
    const worker = make_fake_worker()
    const content = new ArrayBuffer(size)
    await parse_with(worker, { owns_content }, content, `x.bin`)
    expect(worker.posted[0].transfer).toHaveLength(expected_transfers)
    // a cloned buffer stays readable here; a transferred one is detached
    expect(content.byteLength).toBe(expected_transfers === 0 ? size : 0)
  })

  it(`concurrent parses share one worker and each reply reaches only its caller`, async () => {
    use_fake_timeouts()
    const worker = make_fake_worker(() => null)
    const worker_factory = vi.fn(() => worker)
    const filenames = [`a.cif`, `b.cif`, `c.cif`]
    const progress = filenames.map(() => vi.fn())
    const parses = filenames.map((filename, idx) =>
      parse_in_worker(`data`, filename, false, { worker_factory, on_progress: progress[idx] }),
    )
    expect(worker_factory).toHaveBeenCalledOnce()
    await started()
    const requests = worker.posted.map(({ request }) => request)
    expect(requests.map(({ filename }) => filename)).toEqual(filenames)
    reply(worker, { id: requests[1].id, progress: { current: 1, total: 2, stage: `read` } })
    expect(progress.map((on_progress) => on_progress.mock.calls.length)).toEqual([0, 1, 0])
    for (const { id, filename } of requests.toReversed()) {
      expect(worker.terminate).not.toHaveBeenCalled()
      reply(worker, { id, result: { ...structure_result, filename } })
    }
    expect((await Promise.all(parses)).map(({ filename }) => filename)).toEqual(filenames)
    // a parse within the grace period reuses the worker and restarts the countdown from when
    // it settles
    await vi.advanceTimersByTimeAsync(5000)
    const late = parse_in_worker(`data`, `d.cif`, false, { worker_factory })
    expect(worker_factory).toHaveBeenCalledOnce()
    reply(worker, { id: worker.posted[3].request.id, result: structure_result })
    await late
    await expect_stops_after_grace(worker)
  })

  // h5wasm's heap only shrinks when its worker stops, so HDF5 sources never share one
  it.each([
    [`by extension`, `data`, `movie.h5`],
    [
      `by signature`,
      new Uint8Array([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]).buffer,
      `x.bin`,
    ],
  ])(`HDF5 detected %s parses on a dedicated worker`, async (_label, content, filename) => {
    const { workers, worker_factory } = silent_workers()
    const shared = parse_in_worker(`data`, `a.cif`, false, { worker_factory })
    const hdf5 = parse_in_worker(content, filename, false, { worker_factory })
    expect(worker_factory).toHaveBeenCalledTimes(2)
    await started()
    reply(workers[1], { id: workers[1].posted[0].request.id, result: structure_result })
    await hdf5
    expect(workers[1].terminate).toHaveBeenCalledOnce() // at once, no grace period
    reply(workers[0], { id: workers[0].posted[0].request.id, result: structure_result })
    await shared
  })

  // An aborted parse can't be interrupted, so its worker is retired: new parses get a fresh
  // worker, and the retired one stops as soon as the parses it already took have settled
  it.each([`abort`, `error`])(`one parse's %s leaves the others intact`, async (failure) => {
    use_fake_timeouts()
    const worker = make_fake_worker(() => null)
    const worker_factory = vi.fn(() => worker)
    const controller = new AbortController()
    const failing = parse_in_worker(`data`, `bad.cif`, false, {
      worker_factory,
      signal: controller.signal,
    })
    const healthy = parse_in_worker(`data`, `good.cif`, false, { worker_factory })
    await started()
    const [failing_request, healthy_request] = worker.posted.map(({ request }) => request)
    if (failure === `abort`) controller.abort()
    else reply(worker, { id: failing_request.id, error: `bad atoms` })
    await expect(failing).rejects.toThrow(failure === `abort` ? /abort/i : `bad atoms`)
    expect(worker.terminate).not.toHaveBeenCalled()
    // a late reply to the settled parse is dropped and its run port released
    const late = trajectory_response(failing_request)
    if (!late.run_port) throw new Error(`Expected run port`)
    const close_port = vi.spyOn(late.run_port, `close`)
    reply(worker, late)
    expect(close_port).toHaveBeenCalledOnce()
    reply(worker, { id: healthy_request.id, result: structure_result })
    await expect(healthy).resolves.toEqual(structure_result)
    if (failure === `abort`) expect(worker.terminate).toHaveBeenCalledOnce()
    else await expect_stops_after_grace(worker)
    void parse_in_worker(`data`, `next.cif`, false, { worker_factory })
    expect(worker_factory).toHaveBeenCalledTimes(2)
  })

  // A worker error takes the worker and every run it serves down; a reply that fails to
  // deserialize only fails the parses in flight (it names no request), and runs, served over
  // their own ports, keep working on the same worker
  it.each([
    [
      `error`,
      new ErrorEvent(`error`, { message: `out of memory` }),
      /failed for .+: out of memory/,
    ],
    [`messageerror`, new MessageEvent(`messageerror`), /failed to deserialize for/],
  ])(`a worker %s rejects every in-flight parse`, async (event_type, event, message) => {
    const crashes = event_type === `error`
    const { workers, worker_factory } = silent_workers()
    const opening = parse_in_worker(`text`, `movie.xyz`, false, { worker_factory })
    await started()
    reply(workers[0], trajectory_response(workers[0].posted[0].request))
    const opened = await opening
    if (opened.type !== `trajectory`) throw new Error(`Expected trajectory`)
    // the served run keeps the worker alive, so later parses share it
    const filenames = [`a.cif`, `b.cif`]
    const parses = filenames.map((filename) =>
      parse_in_worker(`data`, filename, false, { worker_factory }),
    )
    expect(worker_factory).toHaveBeenCalledOnce()
    workers[0].emit(event_type, event)
    for (const [idx, filename] of filenames.entries()) {
      await expect(parses[idx]).rejects.toThrow(ParseWorkerError)
      await expect(parses[idx]).rejects.toThrow(message)
      await expect(parses[idx]).rejects.toThrow(filename)
    }
    const frame_read = Promise.resolve(opened.data.read_frame(0))
    if (crashes) await expect(frame_read).rejects.toThrow(/disposed/)
    else expect(await materialize_frame_result(frame_read)).toEqual(frame)
    expect(workers[0].terminate).toHaveBeenCalledTimes(crashes ? 1 : 0)
    const next = parse_in_worker(`data`, `c.cif`, false, { worker_factory })
    expect(worker_factory).toHaveBeenCalledTimes(crashes ? 2 : 1)
    await started()
    const [next_worker, post_idx] = crashes ? [workers[1], 0] : [workers[0], 3]
    reply(next_worker, {
      id: next_worker.posted[post_idx].request.id,
      result: structure_result,
    })
    await expect(next).resolves.toEqual(structure_result)
  })

  it(`surfaces an ambiguous HDF5 group choice as a typed error`, async () => {
    const worker = make_fake_worker((request) => ({
      id: request.id,
      error: `ambiguous`,
      hdf5_group_paths: [`/a`, `/b`],
    }))
    await expect(parse_with(worker)).rejects.toMatchObject({
      name: `Hdf5GroupSelectionRequiredError`,
      groups: [`/a`, `/b`],
      message: `ambiguous`,
    } satisfies Partial<Hdf5GroupSelectionRequiredError>)
  })

  it.each([false, true])(
    `handles progress before the result (callback throws: %s)`,
    async (throws) => {
      use_fake_timeouts()
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
      const pending = parse_with(worker, { on_progress: progress })
      if (throws) await expect(pending).rejects.toBe(failure)
      else {
        const result = await pending
        if (result.type !== `trajectory`) throw new Error(`Expected trajectory`)
        result.data.dispose()
      }
      expect(progress).toHaveBeenCalledWith({ current: 1, total: 2, stage: `read` })
      await expect_stops_after_grace(worker)
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

  it(`transfers a parsed volumetric grid instead of copying it`, async () => {
    // isosurface grids (tens of MB for a CHGCAR) were cloned, not moved
    const cube = [`comment`, `comment`, `1 0 0 0`, `2 1 0 0`, `2 0 1 0`, `2 0 0 1`]
    const content = [...cube, `1 0 0 0 0`, `1 2 3 4 5 6 7 8`].join(`\n`)
    const request = { id: 9, filename: `rho.cube`, is_base64: false, content }
    const { response, transfer } = await handle_parse_worker_request(request)
    if (response.result?.type !== `isosurface`) throw new Error(`Expected isosurface result`)
    expect(transfer).toEqual(response.result.data.volumes.map(({ values }) => values.buffer))
    expect(transfer).toHaveLength(1)
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
