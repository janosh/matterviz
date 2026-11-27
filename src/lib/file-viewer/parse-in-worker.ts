// Parse files in a module worker shared by every concurrent parse on the page. A trajectory
// remains owned by that worker and the main thread receives a TrajectoryRun backed by its
// MessagePort. Large runs prepare their display frames in a few more workers.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
// oxlint-disable eslint-plugin-unicorn/relative-url-style
import { HDF5_EXT_REGEX } from '#lib/constants'
import { has_hdf5_magic, magic_head } from '#lib/io/is-binary'
import { frame_transfers, type NumericFrame } from '#lib/trajectory/frame'
import type { ParseProgress, TrajectorySource } from '#lib/trajectory/index'
import { Hdf5GroupSelectionRequiredError } from '#lib/trajectory/parse/h5-utils'
import { dispose_run_port, worker_run } from '#lib/trajectory/runs/worker'
import type { WorkerRun } from '#lib/trajectory/runs/worker'
import { to_error } from 'svelte-widgets/utils'
import { can_create_worker, disable_workers } from 'svelte-widgets/worker-client'
import {
  create_prepare_pool,
  prepare_worker_count,
  type PreparePool,
} from '#lib/trajectory/prepare-pool'
import { parse_file_content } from './parse'
import type { ParseResult, TrajectoryLoadOptions } from './parse'
import type { ParseWorkerRequest, ParseWorkerResponse } from './parse-worker-protocol'

export type * from './parse-worker-protocol'

export type WorkerLike = Pick<Worker, `postMessage` | `addEventListener` | `terminate`>
type WorkerFactory = () => WorkerLike

interface ParseInWorkerOptions {
  worker_factory?: WorkerFactory
  // Workers preparing a large run's display frames (default: host-prepare-worker.ts)
  prepare_worker_factory?: WorkerFactory
  signal?: AbortSignal
  load_options?: TrajectoryLoadOptions
  on_progress?: (progress: ParseProgress) => void
  // The caller will not read `content` again, so transfer its buffer instead of cloning it.
  owns_content?: boolean
}

let next_request_id = 0

const parse_abort_error = (): DOMException => new DOMException(`Parse cancelled`, `AbortError`)

// How a parse worker failed. `crashed`: it started, then errored or sent an unreadable reply.
// `not_started`: it errored before its first message (e.g. its script failed to load once).
// `blocked`: this page can't run it (constructor threw, as for a cross-origin URL; no start
// within WORKER_START_TIMEOUT_MS; or MAX_START_FAILURES start failures in a row, as a CSP
// refusing worker-src gives).
export type ParseWorkerFailure = `crashed` | `not_started` | `blocked`

// The parse worker failed, not the file. A worker that never started was never given the
// content, so parse_in_worker retries those parses on the main thread.
export class ParseWorkerError extends Error {
  constructor(
    message: string,
    readonly failure: ParseWorkerFailure = `crashed`,
  ) {
    super(message)
    this.name = 'ParseWorkerError'
  }
}

// The worker posts its ready message once its module graph (h5wasm included) has loaded, which
// over a slow network takes far longer than a trivial probe worker, so allow 10 s
export const WORKER_START_TIMEOUT_MS = 10_000
// One start failure can be a flaky script fetch; repeated ones mean the page refuses workers
const MAX_START_FAILURES = 2
let consecutive_start_failures = 0

type WorkerParseResult =
  | Exclude<ParseResult, { type: `trajectory` }>
  | (Extract<ParseResult, { type: `trajectory` }> & { data: WorkerRun })

const default_worker_factory: WorkerFactory = () =>
  new Worker(new URL(`./parse-worker.js`, import.meta.url), { type: `module` })

const default_prepare_worker_factory: WorkerFactory = () =>
  new Worker(new URL(`./host-prepare-worker.js`, import.meta.url), { type: `module` })
// One worker decoding and preparing every frame manages ~85 frames/s at 11k atoms and ~45 at
// 20k (fcc Cu extxyz), a pool of 4 beside it ~290 and ~160
const MIN_POOLED_ATOMS = 10_000

type PendingParse = {
  filename: string
  receive: (response: ParseWorkerResponse) => void
  fail: (error: Error) => void
}

// A worker multiplexing parses by request id, plus the runs it serves to the main thread
interface ParseWorkerHost {
  worker: WorkerLike
  factory: WorkerFactory
  pending: Map<number, PendingParse>
  runs: Set<WorkerRun>
  terminated: boolean
  started: boolean // set by its first message (the ready message or a reply)
  queued: (() => void)[] // posts held until it starts, so a buffer never goes to a dead worker
  idle_timer?: ReturnType<typeof setTimeout>
  start_timer?: ReturnType<typeof setTimeout>
}

// One host per factory, so the default factory gives one worker (one script fetch) per page.
// HDF5 sources get dedicated hosts: only terminating a worker returns h5wasm's heap. Idle
// shared workers linger for the next viewer.
const shared_hosts = new Map<WorkerFactory, ParseWorkerHost>()
const SHARED_IDLE_MS = 10_000

// Stop routing new parses to this worker; it still serves its runs until they end
const retire_host = (host: ParseWorkerHost): void => {
  if (shared_hosts.get(host.factory) === host) shared_hosts.delete(host.factory)
}

const terminate_host = (host: ParseWorkerHost): void => {
  if (host.terminated) return
  host.terminated = true
  clearTimeout(host.idle_timer)
  clearTimeout(host.start_timer)
  retire_host(host)
  host.worker.terminate()
}

const is_idle = (host: ParseWorkerHost): boolean => !host.pending.size && !host.runs.size

// A dedicated or retired worker stops as soon as nothing uses it; the shared one after a grace
// period, re-checked when it ends
const release_if_idle = (host: ParseWorkerHost): void => {
  if (!is_idle(host)) return
  if (shared_hosts.get(host.factory) !== host) return terminate_host(host)
  host.idle_timer ??= setTimeout(() => {
    host.idle_timer = undefined
    if (is_idle(host)) terminate_host(host)
  }, SHARED_IDLE_MS)
}

const open_host = (factory: WorkerFactory, dedicated: boolean): ParseWorkerHost => {
  const existing = dedicated ? undefined : shared_hosts.get(factory)
  if (existing) {
    clearTimeout(existing.idle_timer)
    existing.idle_timer = undefined
    return existing
  }
  const host: ParseWorkerHost = {
    worker: factory(),
    factory,
    pending: new Map(),
    runs: new Set(),
    terminated: false,
    started: false,
    queued: [],
  }
  host.worker.addEventListener(`message`, ((event: MessageEvent<ParseWorkerResponse>) => {
    const response: ParseWorkerResponse | undefined = event.data
    // A worker given up on (start timeout, error) may still deliver what it had queued
    if (host.terminated) return dispose_run_port(response?.run_port)
    if (!host.started) {
      host.started = true
      consecutive_start_failures = 0
      clearTimeout(host.start_timer)
      for (const post of host.queued.splice(0)) post()
    }
    const pending = response && host.pending.get(response.id)
    // A late reply to a cancelled parse: release the run it may carry
    if (pending) pending.receive(response)
    else dispose_run_port(response?.run_port)
  }) as EventListener)
  const fail_pending = (
    describe: (filename: string) => string,
    failure: ParseWorkerFailure = `crashed`,
  ): void => {
    for (const { filename, fail } of host.pending.values())
      fail(new ParseWorkerError(describe(filename), failure))
  }
  // A crashed worker takes every parse and run it holds down with it. Unregister it first so a
  // parse started synchronously from a disposed run's release spawns a fresh worker.
  host.worker.addEventListener(`error`, (event) => {
    event.preventDefault()
    if (host.terminated) return
    const reason = event.message || `unknown worker error`
    let failure: ParseWorkerFailure = `crashed`
    if (!host.started) {
      consecutive_start_failures += 1
      failure = consecutive_start_failures >= MAX_START_FAILURES ? `blocked` : `not_started`
    }
    terminate_host(host)
    fail_pending((filename) => `Parse worker failed for ${filename}: ${reason}`, failure)
    for (const run of host.runs) run.dispose()
  })
  // A worker that neither starts nor errors would hold its queued parses forever
  host.start_timer = setTimeout(() => {
    terminate_host(host)
    fail_pending(
      (filename) =>
        `Parse worker for ${filename} did not start within ${WORKER_START_TIMEOUT_MS} ms`,
      `blocked`,
    )
  }, WORKER_START_TIMEOUT_MS)
  // A reply that failed to deserialize names no request, so every parse in flight fails; the
  // worker stays up, and its runs talk over their own ports
  host.worker.addEventListener(`messageerror`, () =>
    fail_pending((filename) => `Parse worker response failed to deserialize for ${filename}`),
  )
  if (!dedicated) shared_hosts.set(factory, host)
  return host
}

// Cancelling a parse settles only its own promise and drops its late reply. The worker can't
// interrupt the parse, so it is retired: new parses go to a fresh worker, and this one stops
// (ending the parse) as soon as no run it serves is left.
const parse_file_worker = async (
  content: TrajectorySource,
  filename: string,
  is_base64 = false,
  options: ParseInWorkerOptions & { dedicated?: boolean } = {},
  on_release?: () => void,
): Promise<WorkerParseResult> => {
  const {
    signal,
    worker_factory = default_worker_factory,
    load_options,
    on_progress,
    owns_content = false,
    dedicated = false,
  } = options
  signal?.throwIfAborted()
  const request: ParseWorkerRequest = {
    id: next_request_id++,
    content,
    filename,
    is_base64,
    load_options,
  }
  return new Promise<WorkerParseResult>((resolve, reject) => {
    let host: ParseWorkerHost
    try {
      host = open_host(worker_factory, dedicated)
    } catch (error) {
      return reject(new ParseWorkerError(to_error(error).message, `blocked`))
    }
    const transfer = owns_content && content instanceof ArrayBuffer ? [content] : []
    const settle = (outcome: WorkerParseResult | Error): void => {
      if (!host.pending.delete(request.id)) return
      signal?.removeEventListener(`abort`, abort)
      release_if_idle(host)
      if (outcome instanceof Error) reject(outcome)
      else resolve(outcome)
    }
    const abort = (): void => {
      retire_host(host)
      settle(to_error(signal?.reason ?? parse_abort_error()))
    }
    const receive = (response: ParseWorkerResponse): void => {
      const { result, error, progress, run_port, hdf5_group_paths } = response
      if (progress) {
        try {
          on_progress?.(progress)
        } catch (progress_error) {
          settle(to_error(progress_error))
        }
        return
      }
      if (!result) {
        return settle(
          hdf5_group_paths
            ? new Hdf5GroupSelectionRequiredError(hdf5_group_paths, error)
            : new Error(error ?? `Parse worker returned no result for ${filename}`),
        )
      }
      if (result.type !== `trajectory`) {
        dispose_run_port(run_port)
        return settle(result)
      }
      if (!run_port)
        return settle(new Error(`Trajectory parse worker result is missing its run port`))
      let run: WorkerRun | undefined
      try {
        run = worker_run(run_port, result.data, () => {
          if (run) host.runs.delete(run)
          release_if_idle(host)
          on_release?.()
        })
      } catch (bind_error) {
        dispose_run_port(run_port)
        return settle(to_error(bind_error))
      }
      host.runs.add(run)
      settle({ ...result, data: run })
    }
    host.pending.set(request.id, { filename, receive, fail: settle })
    signal?.addEventListener(`abort`, abort, { once: true })
    // A worker can't read messages before its module loads anyway, so holding them until its
    // ready message costs nothing, and one that never starts keeps the buffer for the retry
    const post = (): void => {
      if (!host.pending.has(request.id)) return // settled (aborted or failed) before the start
      try {
        host.worker.postMessage(request, { transfer })
      } catch (error) {
        settle(to_error(error))
      }
    }
    if (host.started) post()
    else host.queued.push(post)
  })
}

const parse_on_main_thread = async (
  content: TrajectorySource,
  filename: string,
  is_base64: boolean | undefined,
  { signal, load_options, on_progress }: ParseInWorkerOptions,
): Promise<ParseResult> => {
  signal?.throwIfAborted()
  const result = await parse_file_content(
    content,
    filename,
    is_base64,
    load_options,
    on_progress,
  )
  // the parse can't be interrupted, but an abort during it still rejects like the worker path,
  // releasing the run nobody will receive (a host run's stream listener, a file's reader)
  if (signal?.aborted) {
    if (result.type === `trajectory`) result.data.dispose()
    signal.throwIfAborted()
  }
  return result
}

// Runs past MIN_POOLED_ATOMS get their display frames prepared in a pool: the parse worker
// only decodes them, and each moves on to a pool worker for its bond search, so consecutive
// frames' preparations overlap
const parse_with_worker = async (
  content: TrajectorySource,
  filename: string,
  is_base64 = false,
  options: ParseInWorkerOptions = {},
): Promise<ParseResult> => {
  const load_options = options.load_options && structuredClone(options.load_options)
  // Host markers require the main-thread host bridge; they contain no file bytes to parse.
  // Where no worker can be created (see can_create_worker), files parse there too.
  const host_marker = typeof content === `string` && content.startsWith(`LARGE_FILE:`)
  if (host_marker || (!options.worker_factory && !can_create_worker()))
    return parse_on_main_thread(content, filename, is_base64, { ...options, load_options })
  let pool: PreparePool<{ frame: NumericFrame }> | undefined
  const is_hdf5 =
    HDF5_EXT_REGEX.test(filename) ||
    (content instanceof ArrayBuffer && has_hdf5_magic(magic_head(content)))
  const result = await parse_file_worker(
    content,
    filename,
    is_base64,
    { ...options, load_options, dedicated: is_hdf5 },
    () => pool?.dispose(),
  )
  const create_worker =
    options.prepare_worker_factory ??
    (can_create_worker() ? default_prepare_worker_factory : undefined)
  if (
    result.type !== `trajectory` ||
    !create_worker ||
    result.data.atom_count < MIN_POOLED_ATOMS
  )
    return result
  const run = result.data
  // The parse worker idles between decodes (~10% of a frame's work), so it needs no core spared
  const size = prepare_worker_count((navigator.hardwareConcurrency || 2) + 1)
  const prepare = (pool = create_prepare_pool({
    create_worker,
    transfers: ({ frame }) => frame_transfers(frame),
    size,
  })).prepare
  Object.assign(run, {
    preparation_concurrency: size,
    prepare_frame: async (idx, preparation, signal) =>
      prepare(
        { frame: await run.read_frame(idx, signal, preparation.channels) },
        preparation,
        signal,
      ),
  } satisfies Partial<WorkerRun>)
  return result
}

// A parse whose worker never started is retried here on the main thread (it still holds its
// content). Only a `blocked` failure, meaning this page can't run workers at all, disables
// workers for every later parse; after a one-off start failure the next parse tries a fresh
// worker. A worker that crashed after starting may have been given the content, and the parse
// may well crash the main thread too, so that rejects without retry or disabling.
export const parse_in_worker = (
  ...[content, filename, is_base64, options = {}]: Parameters<typeof parse_with_worker>
): Promise<ParseResult> =>
  parse_with_worker(content, filename, is_base64, options).catch((error: unknown) => {
    if (!(error instanceof ParseWorkerError) || error.failure === `crashed`) throw error
    const blocked = error.failure === `blocked`
    if (blocked) disable_workers()
    console.warn(
      `${error.message}, parsing ${filename} on the main thread${blocked ? `; parse workers disabled for this page` : ``}`,
    )
    return parse_on_main_thread(content, filename, is_base64, options)
  })
