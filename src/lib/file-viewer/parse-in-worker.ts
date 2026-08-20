// Run the file-viewer and trajectory parsers in a module Web Worker (parse-worker.ts) so
// parsing large files doesn't block the UI thread. Each request gets its own worker: a
// fresh worker costs ~30 ms against parses that take hundreds, aborting one is a plain
// terminate(), and a worker that ends up serving an indexed trajectory's frames simply
// lives on until that loader is disposed.
//
// Only worker *infrastructure* failures (no Worker constructor, a CSP or cross-origin
// SecurityError, a script that fails to load, a response that won't deserialize) fall back
// to parsing on the main thread, and only within the size limits below. Parse errors are
// the same on either thread and are reported as-is.
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
  TrajectorySource,
  TrajectoryType,
} from '$lib/trajectory'
import { create_packed_frame_loader } from '$lib/trajectory/helpers'
import type { LoadingOptions } from '$lib/trajectory/parse'
import { parse_trajectory_async } from '$lib/trajectory/parse'
import { Hdf5TrajectoryGroupSelectionError } from '$lib/trajectory/parse/hdf5'
import { to_error } from '$lib/utils'
import { SvelteMap } from 'svelte/reactivity'
import type { ParseResult } from './parse'
import type {
  FrameWorkerMethod,
  FrameWorkerResponse,
  ParseWorkerRequest,
  ParseWorkerResponse,
} from './parse-worker-protocol'
import { dispose_frame_port, parse_file_content_indexed } from './parse-worker-protocol'

export * from './parse-worker-protocol'

// Minimal Worker surface so tests can inject a fake without a real thread
export type WorkerLike = Pick<Worker, `postMessage` | `addEventListener` | `terminate`>
export type WorkerFactory = () => WorkerLike

export interface ParseInWorkerOptions {
  worker_factory?: WorkerFactory
  // Injectable for tests; the default is the library's own parser, which handles
  // LARGE_FILE markers by asking the host for the file over the bridge.
  fallback_parse?: typeof parse_file_content_indexed
  signal?: AbortSignal
}

export interface ParseTrajectoryInWorkerOptions {
  worker_factory?: WorkerFactory
  fallback_parse?: typeof parse_trajectory_async
  signal?: AbortSignal
  // Transfer ownership instead of cloning a binary source. Intended for large File-backed
  // loads that can be read from the File again if group selection is required.
  transfer_source?: boolean
}

const BYTES_PER_MIB = 1024 ** 2
export const MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES = 25 * BYTES_PER_MIB
export const MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES = 50 * BYTES_PER_MIB

// `.js`, not `.ts`: svelte-package compiles the sibling into dist/file-viewer/parse-worker.js,
// and Vite resolves the .js specifier back to the .ts source in dev and in source consumers.
const default_worker_factory: WorkerFactory = () =>
  new Worker(new URL(`./parse-worker.js`, import.meta.url), { type: `module` })

let next_request_id = 0

const parse_abort_error = (): DOMException => new DOMException(`Parse cancelled`, `AbortError`)

// The worker itself could not be used (as opposed to a parse that failed inside it)
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
  frame_port?: MessagePort
  worker: WorkerLike
}

interface RunInWorkerOptions {
  worker_factory: WorkerFactory
  signal?: AbortSignal
  on_progress?: (progress: ParseProgress) => void
  transfer?: Transferable[]
}

// Post one request to a fresh worker and settle on its reply. The worker is terminated once
// the request settles unless the reply carries a frame port, in which case the caller binds
// the port and the loader's dispose terminates the worker instead.
const run_in_worker = (
  request: ParseWorkerRequest,
  { worker_factory, signal, on_progress, transfer = [] }: RunInWorkerOptions,
): Promise<WorkerParseOutcome> =>
  new Promise<WorkerParseOutcome>((resolve, reject) => {
    if (signal?.aborted) {
      reject(parse_abort_error())
      return
    }
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
    const abort = (): void => settle(parse_abort_error())
    worker.addEventListener(`message`, ((event: MessageEvent<ParseWorkerResponse>) => {
      const { id, result, error, progress, frame_port, hdf5_group_paths } = event.data ?? {}
      if (settled || id !== request.id) {
        dispose_frame_port(frame_port)
        return
      }
      if (progress) return on_progress?.(progress)
      if (!result) {
        return settle(
          hdf5_group_paths
            ? new Hdf5TrajectoryGroupSelectionError(hdf5_group_paths, error)
            : new Error(error ?? `Parse worker returned no result for ${request.filename}`),
        )
      }
      settle({ result, frame_port, worker }, Boolean(frame_port))
    }) as EventListener)
    // `error` before a reply means the script itself failed (asset resolution, wasm
    // instantiation at import time, CSP)
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

// Wire an indexed trajectory's frame loader back up: packed frame stores are materialized
// locally, anything else becomes an RPC proxy over the worker's frame port.
const bind_indexed_frame_loader = ({
  result,
  frame_port,
  worker,
}: WorkerParseOutcome): ParseResult => {
  const trajectory = result.type === `trajectory` ? (result.data as TrajectoryType) : null
  // run_in_worker keeps the worker alive only for replies that carry a port
  const release_port = (): void => {
    if (!frame_port) return
    dispose_frame_port(frame_port)
    worker.terminate()
  }
  if (!trajectory?.is_indexed) {
    release_port()
    return result
  }
  if (trajectory.frame_store) {
    release_port()
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
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    try {
      frame_port.postMessage({ id: next_id++, method: `dispose`, args: [] })
    } catch {
      // Port may already be closed after a hard worker terminate.
    }
    frame_port.close()
    worker.terminate()
  }
  frame_port.addEventListener(`messageerror`, () =>
    dispose(new Error(`Indexed frame loader response failed to deserialize`)),
  )
  worker.addEventListener(`error`, (event) =>
    dispose(worker_event_error(event, `Parse worker failed while serving indexed frames`)),
  )
  worker.addEventListener(`messageerror`, () =>
    dispose(new Error(`Parse worker response failed to deserialize`)),
  )
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
    fallback_parse = parse_file_content_indexed,
  } = options
  if (signal?.aborted) throw parse_abort_error()
  // LARGE_FILE markers resolve through a host bridge available only on the main thread
  if (content.startsWith(`LARGE_FILE:`)) return fallback_parse(content, filename, is_base64)
  try {
    const outcome = await run_in_worker(
      { kind: `file`, id: next_request_id++, content, filename, is_base64 },
      { worker_factory, signal },
    )
    return bind_indexed_frame_loader(outcome)
  } catch (error) {
    if (!(error instanceof WorkerUnavailableError)) throw error
    // base64 payloads are ASCII, so their 4-chars-per-3-bytes ratio bounds the decoded size
    const max_bytes = is_base64
      ? (MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES * 4) / 3
      : MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES
    if (utf8_size_exceeds(content, max_bytes)) throw fallback_disabled_error(filename, error)
    console.warn(
      `parse_in_worker: no worker for ${filename}, parsing on the main thread:`,
      error,
    )
    return fallback_parse(content, filename, is_base64)
  }
}

// Trajectory component loads: progress, abort (terminates the worker), optional source
// transfer, and HDF5 group selection surfaced as Hdf5TrajectoryGroupSelectionError.
export const parse_trajectory_in_worker = async (
  data: TrajectorySource,
  filename: string,
  on_progress: ((progress: ParseProgress) => void) | undefined,
  loading_options: LoadingOptions,
  client_options: ParseTrajectoryInWorkerOptions = {},
): Promise<TrajectoryType> => {
  const {
    signal,
    transfer_source = false,
    worker_factory = default_worker_factory,
    fallback_parse = parse_trajectory_async,
  } = client_options
  if (signal?.aborted) throw parse_abort_error()
  const transfer_buffer = data instanceof ArrayBuffer && transfer_source
  const request_data = data instanceof ArrayBuffer && !transfer_buffer ? data.slice(0) : data
  // Measured before the transfer detaches the buffer
  const byte_size =
    data instanceof Blob
      ? data.size
      : data instanceof ArrayBuffer
        ? data.byteLength
        : new Blob([data]).size
  try {
    const outcome = await run_in_worker(
      {
        kind: `trajectory`,
        id: next_request_id++,
        data: request_data,
        filename,
        // $state proxies are not cloneable; snapshot the one nested option object
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
    )
    return bind_indexed_frame_loader(outcome).data as TrajectoryType
  } catch (error) {
    if (!(error instanceof WorkerUnavailableError)) throw error
    const max_bytes =
      data instanceof ArrayBuffer
        ? MAIN_THREAD_FALLBACK_BINARY_MAX_BYTES
        : MAIN_THREAD_FALLBACK_TEXT_MAX_BYTES
    // Blob sources need the worker's WORKERFS mount, a transferred buffer is gone, and
    // oversized sources would freeze the UI thread
    const blocked_reason =
      data instanceof Blob
        ? `Blob-backed HDF5 parsing failed for ${filename}; reload the file after checking browser Web Worker and WebAssembly support`
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
    return fallback_parse(data, filename, on_progress, loading_options)
  }
}
