// Parse files in a fresh module worker. A trajectory remains owned by that worker and the
// main thread receives a TrajectoryRun backed by its MessagePort.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
// oxlint-disable eslint-plugin-unicorn/relative-url-style
import type {
  OpenTrajectoryOptions,
  ParseProgress,
  TrajectoryRun,
  TrajectorySource,
} from '$lib/trajectory'
import { Hdf5GroupSelectionRequiredError, open_trajectory } from '$lib/trajectory'
import { is_indexable_trajectory_filename } from '$lib/trajectory/format-detect'
import { dispose_run_port, worker_run } from '$lib/trajectory/runs/worker'
import { content_byte_size } from '$lib/io/decompress'
import { to_error } from '$lib/utils'
import { parse_file_content } from './parse'
import type { ParseResult, TrajectoryLoadOptions, WireParseResult } from './parse'
import type { ParseWorkerRequest, ParseWorkerResponse } from './parse-worker-protocol'

export type * from './parse-worker-protocol'

export type WorkerLike = Pick<Worker, `postMessage` | `addEventListener` | `terminate`>
type WorkerFactory = () => WorkerLike

interface ParseInWorkerOptions {
  worker_factory?: WorkerFactory
  fallback_parse?: typeof parse_file_content
  signal?: AbortSignal
  load_options?: TrajectoryLoadOptions
  on_progress?: (progress: ParseProgress) => void
  // The caller allocated `content` and will not read it again, so an oversized binary
  // payload can be transferred to the worker instead of cloned
  owns_content?: boolean
}

type TrajectoryWorkerOptions = Omit<
  OpenTrajectoryOptions,
  `filename` | `signal` | `on_progress`
>

interface ParseTrajectoryInWorkerOptions {
  worker_factory?: WorkerFactory
  fallback_parse?: typeof open_trajectory
  signal?: AbortSignal
  transfer_source?: boolean
}

const BYTES_PER_MIB = 1024 ** 2
// Ceilings for parsing on the main thread when no worker can be had, so an eager parse never
// freezes the page for tens of seconds. Text an indexed run can open (multi-frame XYZ, ASE
// .traj) is exempt: above the indexing threshold it is located frame by frame without
// decoding, which is what the host's large-file path does on the main thread anyway.
export const MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES = 25 * BYTES_PER_MIB
export const MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES = 50 * BYTES_PER_MIB

const default_worker_factory: WorkerFactory = () =>
  new Worker(new URL(`./parse-worker.js`, import.meta.url), { type: `module` })

let next_request_id = 0

const parse_abort_error = (): DOMException => new DOMException(`Parse cancelled`, `AbortError`)

class WorkerUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WorkerUnavailableError'
  }
}

const worker_event_error = (event: Event, fallback: string): WorkerUnavailableError =>
  new WorkerUnavailableError(
    event instanceof ErrorEvent && event.message ? event.message : fallback,
  )

interface WorkerParseOutcome {
  result: WireParseResult
  run_port?: MessagePort
  worker: WorkerLike
}

interface RunInWorkerOptions {
  worker_factory: WorkerFactory
  signal?: AbortSignal
  on_progress?: (progress: ParseProgress) => void
  transfer?: Transferable[]
}

const run_in_worker = (
  request: ParseWorkerRequest,
  { worker_factory, signal, on_progress, transfer = [] }: RunInWorkerOptions,
): Promise<WorkerParseOutcome> =>
  new Promise<WorkerParseOutcome>((resolve, reject) => {
    if (signal?.aborted) return reject(to_error(signal.reason ?? parse_abort_error()))
    let worker: WorkerLike
    try {
      worker = worker_factory()
    } catch (error) {
      reject(new WorkerUnavailableError(to_error(error).message, { cause: error }))
      return
    }
    let settled = false
    const settle = (outcome: WorkerParseOutcome | Error, keep_worker = false): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener(`abort`, abort)
      if (!keep_worker) worker.terminate()
      if (outcome instanceof Error) reject(outcome)
      else resolve(outcome)
    }
    const abort = (): void => settle(to_error(signal?.reason ?? parse_abort_error()))
    worker.addEventListener(`message`, ((event: MessageEvent<ParseWorkerResponse>) => {
      const { id, result, error, progress, run_port, hdf5_group_paths } = event.data ?? {}
      if (settled || id !== request.id) {
        dispose_run_port(run_port)
        return
      }
      if (progress) return on_progress?.(progress)
      if (!result) {
        return settle(
          hdf5_group_paths
            ? new Hdf5GroupSelectionRequiredError(hdf5_group_paths, error)
            : new Error(error ?? `Parse worker returned no result for ${request.filename}`),
        )
      }
      settle({ result, run_port, worker }, Boolean(run_port))
    }) as EventListener)
    worker.addEventListener(`error`, (event) =>
      settle(worker_event_error(event, `Parse worker failed to load`)),
    )
    worker.addEventListener(`messageerror`, () =>
      settle(new WorkerUnavailableError(`Parse worker response failed to deserialize`)),
    )
    signal?.addEventListener(`abort`, abort, { once: true })
    try {
      worker.postMessage(request, { transfer })
    } catch (error) {
      settle(new WorkerUnavailableError(to_error(error).message, { cause: error }))
    }
  })

const bind_worker_run = ({ result, run_port, worker }: WorkerParseOutcome): ParseResult => {
  if (result.type !== `trajectory`) {
    dispose_run_port(run_port)
    return result
  }
  if (!run_port) {
    worker.terminate()
    throw new Error(`Trajectory parse worker result is missing its run port`)
  }
  return {
    ...result,
    data: worker_run(run_port, result.data, () => worker.terminate()),
  }
}

const fallback_disabled_error = (filename: string, cause: Error): Error =>
  new Error(
    `Parse worker failed for ${filename}; main-thread fallback is disabled above ${
      MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES / BYTES_PER_MIB
    } MiB text or ${MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES / BYTES_PER_MIB} MiB decoded binary`,
    { cause },
  )

export const parse_in_worker = async (
  content: TrajectorySource,
  filename: string,
  is_base64: boolean = false,
  options: ParseInWorkerOptions = {},
): Promise<ParseResult> => {
  const {
    signal,
    worker_factory = default_worker_factory,
    fallback_parse = parse_file_content,
    load_options,
    on_progress,
    owns_content = false,
  } = options
  signal?.throwIfAborted()
  if (typeof content === `string` && content.startsWith(`LARGE_FILE:`)) {
    return fallback_parse(content, filename, is_base64, load_options, on_progress)
  }
  const max_bytes =
    is_base64 || typeof content !== `string`
      ? MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES
      : MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES
  const byte_size = content_byte_size(content)
  const decoded_size = is_base64 ? (byte_size * 3) / 4 : byte_size
  const can_fall_back =
    (!is_base64 && is_indexable_trajectory_filename(filename)) || decoded_size <= max_bytes
  // Transferring detaches the caller's buffer, so it needs both their consent and a payload
  // the main-thread fallback could never have accepted anyway — which is exactly the
  // oversized-binary case where cloning costs the most. Everything else is cloned.
  const transfer =
    owns_content && !can_fall_back && content instanceof ArrayBuffer ? [content] : []
  try {
    return bind_worker_run(
      await run_in_worker(
        { kind: `file`, id: next_request_id++, content, filename, is_base64, load_options },
        { worker_factory, signal, on_progress, transfer },
      ),
    )
  } catch (error) {
    if (!(error instanceof WorkerUnavailableError)) throw error
    // A transferred payload is detached, so there is nothing left to parse here either way
    if (!can_fall_back) throw fallback_disabled_error(filename, error)
    console.warn(
      `parse_in_worker: no worker for ${filename}, parsing on the main thread:`,
      error,
    )
    return fallback_parse(content, filename, is_base64, load_options, on_progress)
  }
}

export const parse_trajectory_in_worker = async (
  data: TrajectorySource,
  filename: string,
  on_progress: ((progress: ParseProgress) => void) | undefined,
  loading_options: TrajectoryWorkerOptions = {},
  client_options: ParseTrajectoryInWorkerOptions = {},
): Promise<TrajectoryRun> => {
  const {
    signal,
    transfer_source = false,
    worker_factory = default_worker_factory,
    fallback_parse = open_trajectory,
  } = client_options
  signal?.throwIfAborted()
  const transfer_buffer = data instanceof ArrayBuffer && transfer_source
  const request_data = data instanceof ArrayBuffer && !transfer_buffer ? data.slice(0) : data
  const byte_size = content_byte_size(data)
  try {
    const result = bind_worker_run(
      await run_in_worker(
        {
          kind: `trajectory`,
          id: next_request_id++,
          data: request_data,
          filename,
          options: {
            ...loading_options,
            ...(loading_options.atom_type_mapping && {
              atom_type_mapping: { ...loading_options.atom_type_mapping },
            }),
          },
        },
        {
          worker_factory,
          signal,
          on_progress,
          transfer: request_data instanceof ArrayBuffer ? [request_data] : [],
        },
      ),
    )
    // A `trajectory` request can only come back as a trajectory result
    if (result.type !== `trajectory`)
      throw new Error(`Expected a trajectory, got ${result.type}`)
    return result.data
  } catch (error) {
    if (!(error instanceof WorkerUnavailableError)) throw error
    const max_bytes =
      data instanceof ArrayBuffer
        ? MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES
        : MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES
    const blocked_reason =
      data instanceof Blob
        ? `Blob-backed HDF5 parsing failed for ${filename}; reload after checking Web Worker and WebAssembly support`
        : transfer_buffer
          ? `Trajectory parse worker failed after taking ownership of ${filename}; reload the source file to retry`
          : byte_size > max_bytes && !is_indexable_trajectory_filename(filename)
            ? `Trajectory parse worker failed for ${filename}; main-thread fallback is disabled for ${byte_size} bytes above the ${max_bytes}-byte limit`
            : null
    if (blocked_reason) throw new Error(blocked_reason, { cause: error })
    console.warn(
      `parse_trajectory_in_worker: no worker for ${filename}, parsing on the main thread:`,
      error,
    )
    return fallback_parse(data, {
      ...loading_options,
      filename,
      signal,
      on_progress,
    })
  }
}
