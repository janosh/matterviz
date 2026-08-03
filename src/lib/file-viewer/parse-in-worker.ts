// parse_in_worker: run parse_file_content in a module Web Worker
// (parse-worker.ts) so parsing large files doesn't block the UI thread,
// with a main-thread fallback whenever the worker path fails (worker
// construction blocked, worker script/wasm asset fails to load, or the parse
// itself errors. The fallback re-parses on the main thread so callers get
// the same behavior and error messages as before the worker existed).
//
// Worker.postMessage takes no targetOrigin (that's window.postMessage) and
// vite's static worker detection requires the literal `./` URL form, so both
// unicorn rules below are false positives here.
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
import { to_error } from '$lib/utils'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import { parse_file_content, type ParseResult } from './parse'
import type {
  FrameWorkerMethod,
  FrameWorkerResponse,
  ParseWorkerRequest,
  ParseWorkerResponse,
} from './parse-worker-protocol'

export { should_index_worker_xyz } from './parse-worker-protocol'
export type {
  FrameWorkerMethod,
  FrameWorkerRequest,
  FrameWorkerResponse,
  ParseWorkerRequest,
  ParseWorkerResponse,
} from './parse-worker-protocol'

// Minimal Worker surface so tests can inject a fake without a real thread
export type WorkerLike = Pick<Worker, `postMessage` | `addEventListener` | `terminate`>
export type WorkerFactory = () => WorkerLike

export interface ParseInWorkerOptions {
  worker_factory?: WorkerFactory
  // Injectable for tests; the default is the library's own parser, which handles
  // LARGE_FILE markers by asking the host for the file over the bridge.
  fallback_parse?: typeof parse_file_content
  // Ordinary worker failures fall back on the UI thread only for inputs within
  // the existing limits: 25 MiB UTF-8 text or 50 MiB decoded binary.
  // LARGE_FILE markers keep their optimized host fallback regardless of size.
  fallback_on_worker_error?: boolean
  signal?: AbortSignal
  timeout_ms?: number // tests use small values; default WORKER_TIMEOUT_MS
}

// Generous ceiling: a 231 MB spike file parsed in ~5 s; a request past two
// minutes means a hung worker, and the fallback re-parse is the better UX.
const WORKER_TIMEOUT_MS = 120_000
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

const dispose_unbound_frame_port = (frame_port: MessagePort | undefined): void => {
  if (!frame_port) return
  try {
    frame_port.postMessage({ id: 0, method: `dispose`, args: [] })
  } catch {
    // The worker may already have closed its end of the transferred port.
  }
  frame_port.close()
}

const bind_indexed_frame_loader = (
  result: ParseResult,
  frame_port: MessagePort | undefined,
): ParseResult => {
  if (result.type !== `trajectory`) return result
  const trajectory = result.data as TrajectoryType
  if (trajectory.is_indexed !== true) return result
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

const utf8_size_exceeds = (text: string, max_bytes: number): boolean => {
  let bytes = 0
  for (let char_idx = 0; char_idx < text.length; char_idx++) {
    const code = text.charCodeAt(char_idx)
    if (code <= 0x7f) bytes += 1
    else if (code <= 0x7ff) bytes += 2
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      text.charCodeAt(char_idx + 1) >= 0xdc00 &&
      text.charCodeAt(char_idx + 1) <= 0xdfff
    ) {
      bytes += 4
      char_idx++
    } else bytes += 3
    if (bytes > max_bytes) return true
  }
  return false
}

export const estimate_decoded_base64_bytes = (content: string): number => {
  let encoded_chars = 0
  let trailing_padding = 0
  for (const char of content) {
    const code = char.charCodeAt(0)
    if (code === 9 || code === 10 || code === 13 || code === 32) continue
    encoded_chars++
    trailing_padding = char === `=` ? Math.min(2, trailing_padding + 1) : 0
  }
  return Math.max(0, Math.floor((encoded_chars * 3) / 4) - trailing_padding)
}

const ordinary_fallback_is_safe = (job: ParseJob): boolean =>
  job.request.is_base64
    ? estimate_decoded_base64_bytes(job.request.content) <=
      MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES
    : !utf8_size_exceeds(job.request.content, MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES)

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
  const error = new Error(`Parse worker terminated`)
  for (const dispose of active_frame_loader_disposers) dispose(error)
  shared_worker?.terminate()
  shared_worker = null
}

// Soft abort/timeout: keep the worker while indexed frame ports are live.
// Late responses for the abandoned job are ignored (request id mismatch).
const terminate_idle_worker = (): void => {
  if (active_frame_loader_disposers.size === 0) terminate_worker()
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
        `Parse worker failed for a large file; main-thread fallback is disabled above 25 MiB text or 50 MiB decoded binary`,
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
  const fallback_parse = job.options.fallback_parse ?? parse_file_content
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
  if (shared_worker !== worker) {
    dispose_unbound_frame_port(frame_port)
    return
  }
  const job = queued_jobs[0]
  if (job?.phase !== `worker` || job.request.id !== id) {
    dispose_unbound_frame_port(frame_port)
    return
  }
  if (!result) {
    run_fallback(job, new Error(error ?? `Parse worker returned no result`))
    return
  }
  try {
    settle_job(job, { result: bind_indexed_frame_loader(result, frame_port) })
  } catch (bind_error) {
    run_fallback(job, to_error(bind_error))
  }
}

// A worker `error` event means the script itself failed (asset resolution,
// wasm instantiation at import time, CSP), stop using the worker entirely.
const handle_worker_error = (worker: WorkerLike, event: Event): void => {
  if (shared_worker !== worker) return
  const message =
    event instanceof ErrorEvent && event.message
      ? event.message
      : `Parse worker failed to load`
  fail_active_worker_job(new Error(message), true)
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
  const queue_idx = queued_jobs.indexOf(job)
  if (queue_idx === -1) return
  if (queue_idx === 0 && job.phase === `worker`) terminate_idle_worker()
  settle_job(job, { error: parse_abort_error() })
}

const time_out_active_job = (job: ParseJob, timeout_ms: number): void => {
  if (queued_jobs[0] !== job || job.phase !== `worker`) return
  terminate_idle_worker()
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
      if (shared_worker === worker) terminate_idle_worker()
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
