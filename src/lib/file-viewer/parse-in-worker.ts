// Parse files in a fresh module worker. A trajectory remains owned by that worker and the
// main thread receives a TrajectoryRun backed by its MessagePort.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
// oxlint-disable eslint-plugin-unicorn/relative-url-style
import {
  Hdf5GroupSelectionRequiredError,
  open_trajectory,
  type OpenTrajectoryOptions,
  type ParseProgress,
  type TrajectoryRun,
  type TrajectoryRunSummary,
  type TrajectorySource,
} from '$lib/trajectory'
import { dispose_run_port, worker_run } from '$lib/trajectory/runs/worker'
import { to_error } from '$lib/utils'
import { parse_file_content, type ParseResult, type TrajectoryLoadOptions } from './parse'
import type { ParseWorkerRequest, ParseWorkerResponse } from './parse-worker-protocol'

export type * from './parse-worker-protocol'

export type WorkerLike = Pick<Worker, `postMessage` | `addEventListener` | `terminate`>
type WorkerFactory = () => WorkerLike

interface ParseInWorkerOptions {
  worker_factory?: WorkerFactory
  fallback_parse?: typeof parse_file_content
  signal?: AbortSignal
  load_options?: TrajectoryLoadOptions
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
  result: ParseResult
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
    data: worker_run(run_port, result.data as TrajectoryRunSummary, () => worker.terminate()),
  }
}

const utf8_size_exceeds = (text: string, max_bytes: number): boolean =>
  text.length > max_bytes || new Blob([text]).size > max_bytes

const fallback_disabled_error = (filename: string, cause: Error): Error =>
  new Error(
    `Parse worker failed for ${filename}; main-thread fallback is disabled above ${
      MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES / BYTES_PER_MIB
    } MiB text or ${MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES / BYTES_PER_MIB} MiB decoded binary`,
    { cause },
  )

export const parse_in_worker = async (
  content: string,
  filename: string,
  is_base64: boolean,
  options: ParseInWorkerOptions = {},
): Promise<ParseResult> => {
  const {
    signal,
    worker_factory = default_worker_factory,
    fallback_parse = parse_file_content,
    load_options,
  } = options
  signal?.throwIfAborted()
  if (content.startsWith(`LARGE_FILE:`)) {
    return fallback_parse(content, filename, is_base64, load_options)
  }
  try {
    return bind_worker_run(
      await run_in_worker(
        { kind: `file`, id: next_request_id++, content, filename, is_base64, load_options },
        { worker_factory, signal },
      ),
    )
  } catch (error) {
    if (!(error instanceof WorkerUnavailableError)) throw error
    const max_bytes = is_base64
      ? (MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES * 4) / 3
      : MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES
    if (utf8_size_exceeds(content, max_bytes)) throw fallback_disabled_error(filename, error)
    console.warn(
      `parse_in_worker: no worker for ${filename}, parsing on the main thread:`,
      error,
    )
    return fallback_parse(content, filename, is_base64, load_options)
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
  const byte_size =
    data instanceof Blob
      ? data.size
      : data instanceof ArrayBuffer
        ? data.byteLength
        : new Blob([data]).size
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
    return result.data as TrajectoryRun
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
          : byte_size > max_bytes
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
