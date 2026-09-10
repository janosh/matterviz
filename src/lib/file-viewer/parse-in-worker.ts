// Parse files in a fresh module worker. A trajectory remains owned by that worker and the
// main thread receives a TrajectoryRun backed by its MessagePort.
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
// oxlint-disable eslint-plugin-unicorn/relative-url-style
import type { ParseProgress, TrajectoryRun, TrajectorySource } from '$lib/trajectory'
import { Hdf5GroupSelectionRequiredError } from '$lib/trajectory'
import { dispose_run_port, worker_run } from '$lib/trajectory/runs/worker'
import { to_error } from '$lib/utils'
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

const default_worker_factory: WorkerFactory = () =>
  new Worker(new URL(`./parse-worker.js`, import.meta.url), { type: `module` })

let next_request_id = 0

const parse_abort_error = (): DOMException => new DOMException(`Parse cancelled`, `AbortError`)

export const parse_in_worker = async (
  content: TrajectorySource,
  filename: string,
  is_base64: boolean = false,
  options: ParseInWorkerOptions = {},
): Promise<ParseResult> => {
  const {
    signal,
    worker_factory = default_worker_factory,
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
      if (progress) return on_progress?.(progress)
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
        run = worker_run(run_port, result.data, () => worker.terminate())
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
