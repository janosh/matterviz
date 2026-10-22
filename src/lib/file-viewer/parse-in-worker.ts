// Parse files in a module worker shared by every concurrent parse on the page. A trajectory
// remains owned by that worker and the main thread receives a TrajectoryRun backed by its
// MessagePort.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
// oxlint-disable eslint-plugin-unicorn/relative-url-style
import { HDF5_EXT_REGEX } from '#lib/constants.js'
import { has_hdf5_magic, magic_head } from '#lib/io/is-binary.js'
import type { ParseProgress, TrajectorySource } from '#lib/trajectory/index.js'
import { Hdf5GroupSelectionRequiredError } from '#lib/trajectory/parse/h5-utils.js'
import { dispose_run_port, worker_run } from '#lib/trajectory/runs/worker.js'
import type { WorkerRun } from '#lib/trajectory/runs/worker.js'
import { summarize_run } from '#lib/trajectory/run.js'
import { to_error } from 'svelte-widgets/utils'
import { can_create_worker } from '#lib/worker-client.svelte.js'
import type { DisplayFrame, FramePreparation } from '#lib/trajectory/prepare.js'
import { display_frame_bytes, display_cache_budget } from '#lib/trajectory/prepare.js'
import { parse_file_content } from './parse'
import type { ParseResult, TrajectoryLoadOptions } from './parse'
import type { ParseWorkerRequest, ParseWorkerResponse } from './parse-worker-protocol'

export type * from './parse-worker-protocol'

export type WorkerLike = Pick<Worker, `postMessage` | `addEventListener` | `terminate`>
type WorkerFactory = () => WorkerLike

interface ParseInWorkerOptions {
  worker_factory?: WorkerFactory
  signal?: AbortSignal
  load_options?: TrajectoryLoadOptions
  on_progress?: (progress: ParseProgress) => void
  // The caller will not read `content` again, so transfer its buffer instead of cloning it.
  owns_content?: boolean
}

let next_request_id = 0

const parse_abort_error = (): DOMException => new DOMException(`Parse cancelled`, `AbortError`)

type WorkerParseResult =
  | Exclude<ParseResult, { type: `trajectory` }>
  | (Extract<ParseResult, { type: `trajectory` }> & { data: WorkerRun })

const default_worker_factory: WorkerFactory = () =>
  new Worker(new URL(`./parse-worker.js`, import.meta.url), { type: `module` })

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
  idle_timer?: ReturnType<typeof setTimeout>
}

// One host per factory, so the default factory gives one worker (one script fetch) per page.
// HDF5 sources and replicas get dedicated hosts: only terminating a worker returns h5wasm's
// heap, and a replica's own thread is its point. Idle shared workers linger for the next viewer.
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
  }
  host.worker.addEventListener(`message`, ((event: MessageEvent<ParseWorkerResponse>) => {
    const response: ParseWorkerResponse | undefined = event.data
    const pending = response && host.pending.get(response.id)
    // A late reply to a cancelled parse: release the run it may carry
    if (pending) pending.receive(response)
    else dispose_run_port(response?.run_port)
  }) as EventListener)
  const fail_pending = (describe: (filename: string) => string): void => {
    for (const { filename, fail } of host.pending.values()) fail(new Error(describe(filename)))
  }
  // A crashed worker takes every parse and run it holds down with it. Unregister it first so a
  // parse started synchronously from a disposed run's release spawns a fresh worker.
  host.worker.addEventListener(`error`, (event) => {
    event.preventDefault()
    const reason = event.message || `unknown worker error`
    terminate_host(host)
    fail_pending((filename) => `Parse worker failed for ${filename}: ${reason}`)
    for (const run of host.runs) run.dispose()
  })
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
  is_base64: boolean = false,
  options: ParseInWorkerOptions & {
    replica?: ParseWorkerRequest[`replica`]
    dedicated?: boolean
  } = {},
  on_release?: () => void,
): Promise<WorkerParseResult> => {
  const {
    signal,
    worker_factory = default_worker_factory,
    load_options,
    on_progress,
    owns_content = false,
    replica,
    dedicated = false,
  } = options
  signal?.throwIfAborted()
  const request: ParseWorkerRequest = {
    id: next_request_id++,
    content,
    filename,
    is_base64,
    load_options,
    replica,
  }
  const transfer = owns_content && content instanceof ArrayBuffer ? [content] : []
  return new Promise<WorkerParseResult>((resolve, reject) => {
    let host: ParseWorkerHost
    try {
      host = open_host(worker_factory, dedicated)
    } catch (error) {
      return reject(to_error(error))
    }
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
    try {
      host.worker.postMessage(request, { transfer })
    } catch (error) {
      settle(to_error(error))
    }
  })
}

// File cloning shares the immutable backing file; every replica mounts its own bounded
// HDF5 reader. Byte buffers and rich sources never enter this pool.
export const parse_in_worker = async (
  content: TrajectorySource,
  filename: string,
  is_base64 = false,
  options: ParseInWorkerOptions = {},
): Promise<ParseResult> => {
  const load_options = options.load_options && structuredClone(options.load_options)
  // Host markers require the main-thread host bridge; they contain no file bytes to parse.
  // Where no worker can be created (see can_create_worker), files parse there too.
  const host_marker = typeof content === `string` && content.startsWith(`LARGE_FILE:`)
  if (host_marker || (!options.worker_factory && !can_create_worker())) {
    options.signal?.throwIfAborted()
    const result = await parse_file_content(
      content,
      filename,
      is_base64,
      load_options,
      options.on_progress,
    )
    // the parse can't be interrupted, but an abort during it still rejects like the worker path
    options.signal?.throwIfAborted()
    return result
  }
  let dispose_pool: (() => void) | undefined
  const is_hdf5 =
    HDF5_EXT_REGEX.test(filename) ||
    (content instanceof ArrayBuffer && has_hdf5_magic(magic_head(content)))
  const result = await parse_file_worker(
    content,
    filename,
    is_base64,
    { ...options, load_options, dedicated: is_hdf5 },
    () => dispose_pool?.(),
  )
  if (
    result.type !== `trajectory` ||
    !(content instanceof File) ||
    result.data.atom_count <= 100_000 ||
    ![`hdf5`, `md-hdf5`, `reference-md-hdf5`].includes(result.data.provenance.format ?? ``)
  )
    return result
  const primary = result.data
  const primary_prepare = primary.prepare_frame.bind(primary)
  const device_memory = Reflect.get(navigator, `deviceMemory`)
  const memory_budget = display_cache_budget()
  const concurrency = Math.max(
    1,
    Math.min(
      typeof device_memory === `number` && device_memory >= 16 ? 10 : 4,
      (navigator.hardwareConcurrency || 2) - 1,
      typeof device_memory === `number` && device_memory < 8 ? 2 : 10,
    ),
  )
  if (concurrency === 1) return result
  // Measure the first prepared output before opening replicas. This limits concurrent
  // output buffers, not worker heaps, HDF5 caches or the browser's total memory.
  let largest_frame_bytes = 0
  const capacity = () =>
    largest_frame_bytes
      ? Math.max(1, Math.min(concurrency, Math.floor(memory_budget / largest_frame_bytes)))
      : 1
  Object.defineProperty(primary, `preparation_concurrency`, { get: capacity })
  const source_options = {
    ...load_options,
    ...(primary.provenance.hdf5_group && {
      hdf5_group_path: primary.provenance.hdf5_group,
    }),
  }
  type Slot = {
    run?: WorkerRun
    opening?: AbortController
    busy: boolean
  }
  type Job = {
    idx: number
    preparation: FramePreparation
    slot?: Slot
    finish: (outcome: DisplayFrame | Error) => void
  }
  const slots: Slot[] = [{ run: primary, busy: false }]
  // Insertion order is the queue; assigning a slot marks a running job.
  const jobs = new Set<Job>()
  let disposed = false
  let idle_timer: ReturnType<typeof setTimeout> | undefined
  const clear_idle_timer = (): void => {
    if (idle_timer !== undefined) clearTimeout(idle_timer)
    idle_timer = undefined
  }
  const release_slot = (slot: Slot): void => {
    if (slot.run === primary) return
    clear_idle_timer()
    const idx = slots.indexOf(slot)
    if (idx !== -1) slots.splice(idx, 1)
    slot.opening?.abort(parse_abort_error())
    slot.run?.dispose()
  }
  // Opening a large source can be much slower than preparing a frame. Leave jobs in
  // FIFO order until a reader is ready. Open bounded replicas together so slow startup
  // does not serialize the entire playback pool.
  const open_replica = (): void => {
    if (
      slots.length >= capacity() ||
      slots.filter((slot) => slot.opening).length >=
        [...jobs].filter((job) => !job.slot).length
    )
      return
    const opening = new AbortController()
    const slot: Slot = { opening, busy: false }
    slots.push(slot)
    void parse_file_worker(content, filename, is_base64, {
      worker_factory: options.worker_factory,
      dedicated: true,
      signal: opening.signal,
      load_options: source_options,
      replica: primary.provenance.format === `md-hdf5` ? summarize_run(primary) : undefined,
    })
      .then((replica) => {
        if (replica.type !== `trajectory`)
          throw new Error(`HDF5 preparation replica returned ${replica.type}`)
        slot.run = replica.data
        if (disposed || opening.signal.aborted) return release_slot(slot)
        if (
          slot.run.atom_count !== primary.atom_count ||
          slot.run.frame_count !== primary.frame_count ||
          slot.run.provenance.format !== primary.provenance.format ||
          slot.run.provenance.hdf5_group !== primary.provenance.hdf5_group
        )
          throw new Error(`HDF5 preparation replica does not match ${filename}`)
      })
      .catch((error: unknown) => {
        const cancelled = opening.signal.aborted
        release_slot(slot)
        if (cancelled) return
        for (const job of jobs) if (!job.slot) job.finish(to_error(error))
      })
      .finally(() => {
        slot.opening = undefined
        pump()
      })
  }
  const pump = (): void => {
    if (disposed) return
    for (const job of jobs) {
      if (job.slot) continue
      if (slots.filter((slot) => slot.busy).length >= capacity()) return
      const slot = slots.find(
        (candidate): candidate is Slot & { run: WorkerRun } =>
          Boolean(candidate.run) && !candidate.opening && !candidate.busy,
      )
      if (!slot) {
        open_replica()
        return
      }
      slot.busy = true
      job.slot = slot
      void (async () => {
        try {
          const prepare =
            slot.run === primary ? primary_prepare : slot.run.prepare_frame.bind(slot.run)
          // Keep a primary slot occupied until its actual RPC completes. Aborting its
          // outward promise must not queue another preparation behind the cancelled one.
          const display = await prepare(job.idx, job.preparation)
          largest_frame_bytes = Math.max(largest_frame_bytes, display_frame_bytes(display))
          job.finish(display)
        } catch (error) {
          release_slot(slot)
          job.finish(to_error(error))
        } finally {
          slot.busy = false
          pump()
        }
      })()
    }
    // Cache-fitting playback stops requesting frames; release unused decoder heaps
    // after a grace period without restarting workers during short gaps in demand.
    if (
      idle_timer === undefined &&
      slots.length > 1 &&
      slots.every((slot) => !slot.busy && !slot.opening)
    ) {
      idle_timer = setTimeout(() => {
        idle_timer = undefined
        if (disposed || jobs.size || slots.some((slot) => slot.busy || slot.opening)) return
        for (const slot of slots.slice()) release_slot(slot)
      }, 10_000)
    }
  }
  primary.prepare_frame = (idx, preparation, signal) => {
    if (disposed) return Promise.reject(new Error(`HDF5 preparation pool is disposed`))
    if (signal?.aborted) return Promise.reject(to_error(signal.reason))
    clear_idle_timer()
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        job.finish(to_error(signal?.reason ?? parse_abort_error()))
        if (job.slot) release_slot(job.slot)
        if (![...jobs].some((pending) => !pending.slot))
          for (const slot of slots.slice()) if (slot.opening) release_slot(slot)
        pump()
      }
      const job: Job = {
        idx,
        preparation,
        finish: (outcome) => {
          // Removing the job also ignores late worker completions after cancellation.
          if (!jobs.delete(job)) return
          signal?.removeEventListener(`abort`, abort)
          if (outcome instanceof Error) reject(outcome)
          else resolve(outcome)
        },
      }
      signal?.addEventListener(`abort`, abort, { once: true })
      jobs.add(job)
      pump()
    })
  }
  const dispose_primary = primary.dispose.bind(primary)
  dispose_pool = () => {
    if (disposed) return
    disposed = true
    clear_idle_timer()
    const error = new Error(`HDF5 preparation pool is disposed`)
    for (const job of jobs) job.finish(error)
    for (const slot of slots.slice()) release_slot(slot)
    dispose_primary()
  }
  primary.dispose = dispose_pool
  return result
}
