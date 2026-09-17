// Parse files in a fresh module worker. A trajectory remains owned by that worker and the
// main thread receives a TrajectoryRun backed by its MessagePort.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
// oxlint-disable eslint-plugin-unicorn/relative-url-style
import type { ParseProgress, TrajectoryRun, TrajectorySource } from '$lib/trajectory'
import { Hdf5GroupSelectionRequiredError } from '$lib/trajectory'
import { dispose_run_port, worker_run } from '$lib/trajectory/runs/worker'
import { summarize_run } from '$lib/trajectory/run'
import { to_error } from '$lib/utils'
import {
  display_frame_bytes,
  display_cache_budget,
  type DisplayFrame,
  type FramePreparation,
} from '$lib/trajectory/prepare'
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

const parse_file_worker = async (
  content: TrajectorySource,
  filename: string,
  is_base64: boolean = false,
  options: ParseInWorkerOptions & { replica?: ParseWorkerRequest[`replica`] } = {},
  on_release?: () => void,
): Promise<ParseResult> => {
  const {
    signal,
    worker_factory = () =>
      new Worker(new URL(`./parse-worker.js`, import.meta.url), { type: `module` }),
    load_options,
    on_progress,
    owns_content = false,
  } = options
  signal?.throwIfAborted()
  // Host markers require the main-thread host bridge; they contain no file bytes to parse.
  if (typeof content === `string` && content.startsWith(`LARGE_FILE:`)) {
    return parse_file_content(content, filename, is_base64, load_options, on_progress)
  }
  const request: ParseWorkerRequest = {
    id: next_request_id++,
    content,
    filename,
    is_base64,
    load_options,
    replica: options.replica,
  }
  const transfer = owns_content && content instanceof ArrayBuffer ? [content] : []
  return new Promise<ParseResult>((resolve, reject) => {
    if (signal?.aborted) return reject(to_error(signal.reason ?? parse_abort_error()))
    let worker: WorkerLike
    try {
      worker = worker_factory()
    } catch (error) {
      reject(to_error(error))
      return
    }
    let settled = false
    let run: TrajectoryRun | undefined
    const settle = (outcome: ParseResult | Error): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener(`abort`, abort)
      if (!run) worker.terminate()
      if (outcome instanceof Error) reject(outcome)
      else resolve(outcome)
    }
    const abort = (): void => settle(to_error(signal?.reason ?? parse_abort_error()))
    worker.addEventListener(`message`, ((event: MessageEvent<ParseWorkerResponse>) => {
      const {
        id: identifier,
        result,
        error,
        progress,
        run_port,
        hdf5_group_paths,
      } = event.data ?? {}
      if (settled || identifier !== request.id) {
        dispose_run_port(run_port)
        return
      }
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
            : new Error(error ?? `Parse worker returned no result for ${request.filename}`),
        )
      }
      if (result.type !== `trajectory`) {
        dispose_run_port(run_port)
        return settle(result)
      }
      if (!run_port)
        return settle(new Error(`Trajectory parse worker result is missing its run port`))
      try {
        run = worker_run(run_port, result.data, () => {
          worker.terminate()
          on_release?.()
        })
        settle({ ...result, data: run })
      } catch (bind_error) {
        dispose_run_port(run_port)
        settle(to_error(bind_error))
      }
    }) as EventListener)
    worker.addEventListener(`error`, (event) => {
      event.preventDefault()
      run?.dispose()
      settle(
        new Error(
          `Parse worker failed for ${request.filename}: ${event.message || `unknown worker error`}`,
        ),
      )
    })
    // Once parsing settles, the same handlers dispose a crashed frame-serving worker.
    worker.addEventListener(`messageerror`, () => {
      run?.dispose()
      settle(new Error(`Parse worker response failed to deserialize for ${request.filename}`))
    })
    signal?.addEventListener(`abort`, abort, { once: true })
    try {
      worker.postMessage(request, { transfer })
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
  let dispose_pool: (() => void) | undefined
  const result = await parse_file_worker(
    content,
    filename,
    is_base64,
    {
      ...options,
      load_options,
    },
    () => dispose_pool?.(),
  )
  if (
    result.type !== `trajectory` ||
    !(content instanceof File) ||
    result.data.atom_count <= 100_000 ||
    !result.data.compute_hotspots ||
    ![`hdf5`, `md-hdf5`, `reference-md-hdf5`].includes(result.data.provenance.format ?? ``)
  )
    return result
  const primary = result.data
  const primary_prepare = primary.prepare_frame?.bind(primary)
  if (!primary_prepare) throw new Error(`Numeric HDF5 worker cannot prepare frames`)
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
    run?: TrajectoryRun
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
          slot.run.provenance.hdf5_group !== primary.provenance.hdf5_group ||
          !slot.run.compute_hotspots ||
          !slot.run.prepare_frame
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
        (candidate) => candidate.run && !candidate.opening && !candidate.busy,
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
            slot.run === primary ? primary_prepare : slot.run?.prepare_frame?.bind(slot.run)
          if (!prepare) throw new Error(`HDF5 preparation replica has no frame preparer`)
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
