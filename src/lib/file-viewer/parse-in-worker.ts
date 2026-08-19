// parse_in_worker: run parse_file_content in a module Web Worker (parse-worker.ts) so
// parsing large files doesn't block the UI thread. Whenever the worker path fails (blocked
// construction, script/wasm asset that won't load, or a parse error) the same input is
// re-parsed on the main thread, so callers see the behavior and errors they would have
// without a worker at all.
//
// Worker.postMessage takes no targetOrigin (that's window.postMessage) and vite's static
// worker detection requires the literal `./` URL form, so both unicorn rules are false
// positives here.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
// oxlint-disable eslint-plugin-unicorn/relative-url-style
import type {
  FrameIndex,
  ParseProgress,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryPositionStream,
  TrajectoryType,
} from '$lib/trajectory'
import { parse_trajectory_async } from '$lib/trajectory/parse'
import type { LoadingOptions } from '$lib/trajectory/parse'
import { Hdf5TrajectoryGroupSelectionError } from '$lib/trajectory/parse/hdf5'
import { create_packed_frame_loader } from '$lib/trajectory/helpers'
import { to_error } from '$lib/utils'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import type { ParseResult } from './parse'
import { parse_file_content } from './parse'
import type {
  FrameWorkerMethod,
  FrameWorkerResponse,
  ParseWorkerRequest,
  ParseWorkerResponse,
  TrajectoryParseWorkerRequest,
} from './parse-worker-protocol'
import { dispose_frame_port, should_index_worker_xyz } from './parse-worker-protocol'

export * from './parse-worker-protocol'

// Minimal Worker surface so tests can inject a fake without a real thread
export type WorkerLike = Pick<Worker, `postMessage` | `addEventListener` | `terminate`>
export type WorkerFactory = () => WorkerLike

export interface ParseInWorkerOptions {
  worker_factory?: WorkerFactory
  // Injectable for tests; the default is the library's own parser, which handles
  // LARGE_FILE markers by asking the host for the file over the bridge.
  fallback_parse?: typeof parse_file_content
  fallback_on_worker_error?: boolean
  signal?: AbortSignal
  timeout_ms?: number // tests use small values; default WORKER_TIMEOUT_MS
}

export interface ParseTrajectoryInWorkerOptions {
  worker_factory?: WorkerFactory
  fallback_parse?: typeof parse_trajectory_async
  signal?: AbortSignal
  timeout_ms?: number
  // Transfer ownership instead of cloning a binary source. Intended for large File-backed
  // loads that can be read from the File again if group selection is required.
  transfer_source?: boolean
}

// Generous ceiling: a 231 MB spike file parsed in ~5 s; a request past two
// minutes means a hung worker, and the fallback re-parse is the better UX.
const WORKER_TIMEOUT_MS = 120_000
const BYTES_PER_MIB = 1024 ** 2
export const MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES = 25 * 1024 * 1024
export const MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES = 50 * 1024 * 1024

// `.js`, not `.ts`: svelte-package compiles the sibling into dist/file-viewer/parse-worker.js,
// and Vite resolves the .js specifier back to the .ts source in dev and in source consumers.
const default_worker_factory: WorkerFactory = () =>
  new Worker(new URL(`./parse-worker.js`, import.meta.url), { type: `module` })

// One shared worker for all parses (its import graph includes h5wasm and every
// parser, so per-parse construction would be wasteful). Module-level so it
// survives component remounts; HMR-safe enough for dev (a stale worker is
// simply replaced on next use after reset).
let shared_worker: WorkerLike | null = null
let worker_unusable = false
let next_request_id = 0
let fallback_task: Promise<ParseOutcome> | null = null
let draining_queue = false
const queued_jobs: ParseJob[] = []
const active_frame_loader_disposers = new SvelteSet<(error?: Error) => void>()

const parse_abort_error = (): DOMException => new DOMException(`Parse cancelled`, `AbortError`)
const worker_error = (event: Event, fallback: string): Error =>
  new Error(event instanceof ErrorEvent && event.message ? event.message : fallback)

type ParseOutcome = { result: ParseResult } | { error: Error }

interface ParseJob {
  request: ParseWorkerRequest
  options: ParseInWorkerOptions
  fallback_only: boolean
  fallback_error?: Error
  resolve: (result: ParseResult) => void
  reject: (error: Error) => void
  phase: `queued` | `worker` | `fallback`
  timeout: ReturnType<typeof setTimeout> | null
  abort_request: () => void
}

const bind_indexed_frame_loader = (
  result: ParseResult,
  frame_port: MessagePort | undefined,
  owning_worker?: WorkerLike,
): ParseResult => {
  const trajectory = result.type === `trajectory` ? (result.data as TrajectoryType) : null
  if (!trajectory?.is_indexed) {
    dispose_frame_port(frame_port)
    return result
  }
  if (trajectory.frame_store) {
    dispose_frame_port(frame_port)
    trajectory.frame_loader = create_packed_frame_loader(trajectory.frame_store)
    return result
  }
  if (!frame_port) throw new Error(`Indexed parse worker result is missing its frame port`)

  let next_id = 0
  let disposed_error: Error | null = null
  const pending = new SvelteMap<
    number,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      on_progress?: (progress: ParseProgress) => void
    }
  >()
  frame_port.addEventListener(`message`, (event: MessageEvent<FrameWorkerResponse>) => {
    const { id, result: frame_result, error, progress } = event.data
    const request = pending.get(id)
    if (!request) return
    if (progress) {
      request.on_progress?.(progress)
      return
    }
    pending.delete(id)
    if (error) request.reject(new Error(error))
    else request.resolve(frame_result)
  })

  const dispose = (error = new Error(`Indexed frame loader was disposed`)): void => {
    if (disposed_error) return
    disposed_error = error
    active_frame_loader_disposers.delete(dispose)
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    try {
      frame_port.postMessage({ id: next_id++, method: `dispose`, args: [] })
    } catch {
      // Port may already be closed after a hard worker terminate.
    }
    frame_port.close()
    owning_worker?.terminate()
  }
  frame_port.addEventListener(`messageerror`, () =>
    dispose(new Error(`Indexed frame loader response failed to deserialize`)),
  )
  if (owning_worker) {
    owning_worker.addEventListener(`error`, (event) =>
      dispose(worker_error(event, `Parse worker failed while serving indexed frames`)),
    )
    owning_worker.addEventListener(`messageerror`, () =>
      dispose(new Error(`Parse worker response failed to deserialize`)),
    )
  }
  frame_port.start()

  const rpc = <Result>(
    method: FrameWorkerMethod,
    args: unknown[] = [],
    on_progress?: (progress: ParseProgress) => void,
  ): Promise<Result> => {
    if (disposed_error) return Promise.reject(disposed_error)
    return new Promise((resolve, reject) => {
      const id = next_id++
      pending.set(id, { resolve: (value) => resolve(value as Result), reject, on_progress })
      try {
        frame_port.postMessage({ id, method, args })
      } catch (error) {
        const post_error = to_error(error)
        pending.delete(id)
        reject(post_error)
        dispose(post_error)
      }
    })
  }
  active_frame_loader_disposers.add(dispose)
  trajectory.frame_loader = {
    requires_source: false,
    dispose,
    get_total_frames: () => rpc<number>(`get_total_frames`),
    build_frame_index: (_data, sample_rate, on_progress) =>
      rpc<FrameIndex[]>(`build_frame_index`, [sample_rate], on_progress),
    load_frame: (_data, frame_number) =>
      rpc<TrajectoryFrame | null>(`load_frame`, [frame_number]),
    extract_plot_metadata: (_data, options, on_progress) =>
      rpc<TrajectoryMetadata[]>(`extract_plot_metadata`, [options], on_progress),
    stream_positions: (_data, options, on_progress) =>
      rpc<TrajectoryPositionStream>(`stream_positions`, [options], on_progress),
  }
  return result
}

// The length test short-circuits the Blob copy for inputs already past the limit, since
// UTF-8 never spends less than one byte per UTF-16 code unit.
const utf8_size_exceeds = (text: string, max_bytes: number): boolean =>
  text.length > max_bytes || new Blob([text]).size > max_bytes

// Ordinary worker failures re-parse on the UI thread only within the limits above. base64
// payloads are ASCII, so their 4-chars-per-3-bytes ratio bounds the decoded size.
const ordinary_fallback_is_safe = ({ request }: ParseJob): boolean =>
  !utf8_size_exceeds(
    request.content,
    request.is_base64
      ? (MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES * 4) / 3
      : MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES,
  )

// Default fallback. Mirrors the worker's indexed-XYZ branch so a fallback parse yields the
// same shape; materializing every frame of a long trajectory would blow up the UI thread.
const parse_on_main_thread = async (
  content: string,
  filename: string,
  is_base64 = false,
): Promise<ParseResult> =>
  should_index_worker_xyz(content, filename, is_base64)
    ? {
        type: `trajectory`,
        filename,
        data: await parse_trajectory_async(content, filename, undefined, {
          use_indexing: true,
          extract_plot_metadata: true,
        }),
      }
    : parse_file_content(content, filename, is_base64)

const settle_job = (job: ParseJob, outcome: ParseOutcome): void => {
  const queue_idx = queued_jobs.indexOf(job)
  if (queue_idx === -1) return
  queued_jobs.splice(queue_idx, 1)
  clearTimeout(job.timeout ?? undefined)
  job.options.signal?.removeEventListener(`abort`, job.abort_request)
  if (queue_idx === 0) queueMicrotask(drain_queue)
  if (`result` in outcome) job.resolve(outcome.result)
  else job.reject(outcome.error)
}

const terminate_worker = (): void => {
  const worker = shared_worker
  shared_worker = null
  worker?.terminate()
}

const run_fallback = (job: ParseJob, error?: Error, warn = true): void => {
  job.phase = `fallback`
  clearTimeout(job.timeout ?? undefined)
  job.timeout = null
  if (error && job.options.fallback_on_worker_error === false) {
    settle_job(job, { error })
    return
  }
  if (error && !job.fallback_only && !ordinary_fallback_is_safe(job)) {
    settle_job(job, {
      error: new Error(
        `Parse worker failed for a large file; main-thread fallback is disabled above ${MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES / BYTES_PER_MIB} MiB text or ${MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES / BYTES_PER_MIB} MiB decoded binary`,
        { cause: error },
      ),
    })
    return
  }
  if (error && warn) {
    console.warn(
      `parse_in_worker: worker parse failed for ${job.request.filename}, falling back to main thread:`,
      error,
    )
  }
  const fallback_parse = job.options.fallback_parse ?? parse_on_main_thread
  const { content, filename, is_base64 } = job.request
  const fallback = Promise.resolve()
    .then(() => fallback_parse(content, filename, is_base64))
    .then(
      (result): ParseOutcome => ({ result }),
      (fallback_error: unknown): ParseOutcome => ({ error: to_error(fallback_error) }),
    )
  fallback_task = fallback
  void fallback.then((outcome) => {
    if (fallback_task === fallback) fallback_task = null
    settle_job(job, outcome)
    drain_queue()
  })
}

const fail_active_worker_job = (error: Error, disable_worker = false): void => {
  const job = queued_jobs[0]?.phase === `worker` ? queued_jobs[0] : null
  if (disable_worker) worker_unusable = true
  terminate_worker()
  if (job) run_fallback(job, error)
  else queueMicrotask(drain_queue)
}

const handle_worker_message = (
  worker: WorkerLike,
  event: MessageEvent<ParseWorkerResponse>,
): void => {
  const { id, result, error, frame_port } = event.data ?? {}
  const job = shared_worker === worker ? queued_jobs[0] : undefined
  if (job?.phase !== `worker` || job.request.id !== id) {
    dispose_frame_port(frame_port)
    return
  }
  if (!result) {
    run_fallback(job, new Error(error ?? `Parse worker returned no result`))
    return
  }
  try {
    // A worker serving a remote frame loader becomes trajectory-owned. Retire it from the
    // parse pool immediately so later files parse concurrently; loader disposal terminates it.
    const worker_owns_loader = Boolean(frame_port)
    if (worker_owns_loader && shared_worker === worker) shared_worker = null
    settle_job(job, {
      result: bind_indexed_frame_loader(
        result,
        frame_port,
        worker_owns_loader ? worker : undefined,
      ),
    })
  } catch (bind_error) {
    if (frame_port) worker.terminate()
    run_fallback(job, to_error(bind_error))
  }
}

// A worker `error` event means the script itself failed (asset resolution,
// wasm instantiation at import time, CSP), stop using the worker entirely.
const handle_worker_error = (worker: WorkerLike, event: Event): void => {
  if (shared_worker !== worker) return
  fail_active_worker_job(worker_error(event, `Parse worker failed to load`), true)
}

// A response deserialize failure invalidates this worker instance, but a fresh
// worker can still handle later jobs.
const handle_worker_messageerror = (worker: WorkerLike): void => {
  if (shared_worker !== worker) return
  const error = new Error(`Parse worker response failed to deserialize`)
  for (const job of queued_jobs.slice(1)) {
    if (job.options.fallback_on_worker_error === false) settle_job(job, { error })
    else job.fallback_error = error
  }
  fail_active_worker_job(error)
}

const ensure_worker = (factory: WorkerFactory): WorkerLike | null => {
  if (worker_unusable || shared_worker) return shared_worker
  try {
    const worker = factory()
    shared_worker = worker
    worker.addEventListener(`message`, ((event: MessageEvent<ParseWorkerResponse>) =>
      handle_worker_message(worker, event)) as EventListener)
    worker.addEventListener(`error`, (event) => handle_worker_error(worker, event))
    worker.addEventListener(`messageerror`, () => handle_worker_messageerror(worker))
  } catch {
    shared_worker?.terminate()
    shared_worker = null
    worker_unusable = true
  }
  return shared_worker
}

const abort_job = (job: ParseJob): void => {
  if (queued_jobs.indexOf(job) === 0) {
    if (job.phase === `worker`) terminate_worker()
    // Release the queue now; the orphaned fallback promise settles into a removed job.
    else if (job.phase === `fallback`) fallback_task = null
  }
  settle_job(job, { error: parse_abort_error() })
}

const time_out_active_job = (job: ParseJob, timeout_ms: number): void => {
  if (queued_jobs[0] !== job || job.phase !== `worker`) return
  terminate_worker()
  run_fallback(job, new Error(`Parse worker timed out after ${timeout_ms / 1000}s`))
}

function drain_queue(): void {
  if (fallback_task || draining_queue) return
  draining_queue = true
  try {
    const job = queued_jobs[0]
    if (!job || job.phase !== `queued`) return
    if (job.options.signal?.aborted) {
      settle_job(job, { error: parse_abort_error() })
      return
    }
    if (job.fallback_only || job.fallback_error) {
      run_fallback(job, job.fallback_error, false)
      return
    }
    const worker = ensure_worker(job.options.worker_factory ?? default_worker_factory)
    if (queued_jobs[0] !== job) {
      if (shared_worker === worker) terminate_worker()
      return
    }
    if (!worker) {
      run_fallback(job, new Error(`Parse worker is unavailable`), false)
      return
    }
    job.phase = `worker`
    const timeout_ms = job.options.timeout_ms ?? WORKER_TIMEOUT_MS
    job.timeout = setTimeout(() => time_out_active_job(job, timeout_ms), timeout_ms)
    try {
      worker.postMessage(job.request)
    } catch (post_error) {
      terminate_worker()
      run_fallback(job, to_error(post_error))
    }
  } finally {
    draining_queue = false
  }
}

// Release the shared worker and settle every active/queued job as cancelled. Tests call it
// between cases; a host can call it to drop the worker's memory when no viewer is open.
export const reset_parse_worker = (): void => {
  const error = new Error(`Parse worker terminated`)
  for (const dispose of active_frame_loader_disposers) dispose(error)
  terminate_worker()
  worker_unusable = false
  fallback_task = null
  while (queued_jobs[0]) settle_job(queued_jobs[0], { error: parse_abort_error() })
}

export const parse_in_worker = (
  content: string,
  filename: string,
  is_base64: boolean,
  options: ParseInWorkerOptions = {},
): Promise<ParseResult> => {
  if (options.signal?.aborted) return Promise.reject(parse_abort_error())

  return new Promise<ParseResult>((resolve, reject) => {
    const job: ParseJob = {
      request: { id: next_request_id++, content, filename, is_base64 },
      options,
      // LARGE_FILE markers resolve through a host bridge available only on the
      // main thread, but still use the queue's abort/reset lifecycle.
      fallback_only: content.startsWith(`LARGE_FILE:`),
      resolve,
      reject,
      phase: `queued`,
      timeout: null,
      abort_request: () => {},
    }
    job.abort_request = () => abort_job(job)
    queued_jobs.push(job)
    options.signal?.addEventListener(`abort`, job.abort_request, { once: true })
    if (options.signal?.aborted) abort_job(job)
    else drain_queue()
  })
}

// Trajectory component loads use a dedicated worker so aborting a superseded HDF5 parse can
// terminate it immediately and an indexed frame loader cannot block later parse requests.
export const parse_trajectory_in_worker = (
  data: string | ArrayBuffer,
  filename: string,
  on_progress: ((progress: ParseProgress) => void) | undefined,
  loading_options: LoadingOptions,
  client_options: ParseTrajectoryInWorkerOptions = {},
): Promise<TrajectoryType> => {
  if (client_options.signal?.aborted) return Promise.reject(parse_abort_error())

  return new Promise<TrajectoryType>((resolve, reject) => {
    let worker: WorkerLike | undefined
    let source_transferred = false
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const finish = (dispose_worker = true): boolean => {
      if (settled) return false
      settled = true
      if (timeout !== undefined) clearTimeout(timeout)
      client_options.signal?.removeEventListener(`abort`, abort)
      if (dispose_worker) worker?.terminate()
      return true
    }
    const fail = (error: Error): void => {
      if (!finish()) return
      reject(error)
    }
    const fallback = (error: Error): void => {
      if (settled) return
      if (source_transferred) {
        return fail(
          new Error(
            `Trajectory parse worker failed after taking ownership of ${filename}; reload the source file to retry`,
            { cause: error },
          ),
        )
      }
      const byte_size = data instanceof ArrayBuffer ? data.byteLength : new Blob([data]).size
      const max_bytes =
        data instanceof ArrayBuffer
          ? MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES
          : MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES
      if (byte_size > max_bytes) {
        return fail(
          new Error(
            `Trajectory parse worker failed for ${filename}; main-thread fallback is disabled for ${byte_size} bytes above the ${max_bytes}-byte limit`,
            { cause: error },
          ),
        )
      }
      if (!finish()) return
      const fallback_parse = client_options.fallback_parse ?? parse_trajectory_async
      void fallback_parse(data, filename, on_progress, loading_options).then(resolve, reject)
    }
    const abort = (): void => fail(parse_abort_error())

    try {
      worker = (client_options.worker_factory ?? default_worker_factory)()
    } catch (error) {
      fallback(to_error(error))
      return
    }

    const request_id = next_request_id++
    worker.addEventListener(`message`, ((event: MessageEvent<ParseWorkerResponse>) => {
      const { id, result, error, progress, frame_port, hdf5_group_paths } = event.data ?? {}
      if (id !== request_id || settled) {
        dispose_frame_port(frame_port)
        return
      }
      if (progress) {
        return on_progress?.(progress)
      }
      if (!result) {
        return fail(
          hdf5_group_paths
            ? new Hdf5TrajectoryGroupSelectionError(hdf5_group_paths, error)
            : new Error(error ?? `Trajectory parse worker returned no result`),
        )
      }
      try {
        const keep_worker = Boolean(frame_port)
        const bound = bind_indexed_frame_loader(
          result,
          frame_port,
          keep_worker ? worker : undefined,
        )
        if (!finish(!keep_worker)) return
        if (bound.type !== `trajectory`)
          return reject(new Error(`Trajectory parse worker returned ${bound.type}`))
        resolve(bound.data as TrajectoryType)
      } catch (bind_error) {
        fail(to_error(bind_error))
      }
    }) as EventListener)
    worker.addEventListener(`error`, (event) =>
      fallback(worker_error(event, `Trajectory parse worker failed to load`)),
    )
    worker.addEventListener(`messageerror`, () =>
      fallback(new Error(`Trajectory parse worker response failed to deserialize`)),
    )
    client_options.signal?.addEventListener(`abort`, abort, { once: true })
    if (client_options.signal?.aborted) {
      abort()
      return
    }
    const timeout_ms = client_options.timeout_ms ?? WORKER_TIMEOUT_MS
    timeout = setTimeout(
      () =>
        fallback(new Error(`Trajectory parse worker timed out after ${timeout_ms / 1000}s`)),
      timeout_ms,
    )
    const request_data =
      data instanceof ArrayBuffer && !client_options.transfer_source ? data.slice(0) : data
    const request: TrajectoryParseWorkerRequest = {
      kind: `trajectory`,
      id: request_id,
      data: request_data,
      filename,
      options: {
        ...loading_options,
        ...(loading_options.atom_type_mapping && {
          atom_type_mapping: { ...loading_options.atom_type_mapping },
        }),
      },
    }
    try {
      worker.postMessage(
        request,
        request_data instanceof ArrayBuffer ? { transfer: [request_data] } : undefined,
      )
      source_transferred = request_data === data && data instanceof ArrayBuffer
    } catch (error) {
      fallback(to_error(error))
    }
  })
}
