// A run served over a MessagePort: the worker keeps the real run (and with it the source
// bytes or HDF5 handle) and answers read_frame / collect_positions requests; the client side
// is itself a TrajectoryRun whose dispose() releases the port and terminates the worker.
//
// MessagePort.postMessage takes no targetOrigin (that's window.postMessage).
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import { to_error } from '$lib/utils'
import { position_stream_transferables } from '../helpers'
import type {
  ParseProgress,
  PositionStreamOptions,
  TrajectoryFrame,
  TrajectoryMetadata,
  TrajectoryPositionStream,
} from '../index'
import type { TrajectoryRun, TrajectoryRunSummary } from '../run'
import { assert_frame_idx, disposed_error, run_fields_from_summary } from '../run'

type RunPortMethod = `read_frame` | `collect_positions` | `abort` | `dispose`

interface RunPortRequest {
  id: number
  method: RunPortMethod
  args: unknown[]
}

type RunPortReply =
  | { id: number; result?: unknown; error?: string; progress?: ParseProgress }
  // Unsolicited: progressive property rows from the served run
  | { properties: TrajectoryMetadata[]; complete: boolean }

const abort_error = (): DOMException => new DOMException(`Request aborted`, `AbortError`)

// Worker side. Returns the port to transfer to the client; the run is disposed when the
// client sends `dispose` or the port becomes unusable.
export const serve_run_over_port = (run: TrajectoryRun): MessagePort => {
  const channel = new MessageChannel()
  const { port1 } = channel
  let served: TrajectoryRun | null = run
  let controllers: (AbortController | undefined)[] = []
  let queue = Promise.resolve()
  const unsubscribe = run.properties.subscribe((batch, complete) =>
    post({ properties: batch, complete }),
  )
  const dispose = (): void => {
    unsubscribe()
    for (const controller of controllers) controller?.abort(abort_error())
    controllers = []
    try {
      served?.dispose()
    } finally {
      served = null
      port1.close()
    }
  }
  function post(reply: RunPortReply, transfer: Transferable[] = []): void {
    if (!served) return
    try {
      port1.postMessage(reply, { transfer })
    } catch (error) {
      if (`id` in reply) {
        try {
          port1.postMessage({ id: reply.id, error: to_error(error).message })
        } catch {
          // The port itself is unusable; disposal below releases the retained source
        }
      }
      dispose()
    }
  }
  port1.addEventListener(`message`, (event: MessageEvent<RunPortRequest>) => {
    const { id, method, args } = event.data
    if (method === `dispose` || !served) return dispose()
    if (method === `abort`) return controllers[Number(args[0])]?.abort(abort_error())
    const controller = new AbortController()
    controllers[id] = controller
    queue = queue.then(async () => {
      const active = served
      if (!active) return
      if (controller.signal.aborted) {
        controllers[id] = undefined
        return post({ id, error: `Request aborted` })
      }
      try {
        if (method === `read_frame`) {
          const frame = await active.read_frame(Number(args[0]), controller.signal)
          post({ id, result: frame })
        } else if (method === `collect_positions`) {
          if (!active.collect_positions) throw new Error(`Run cannot collect positions`)
          const stream = await active.collect_positions({
            ...(args[0] as PositionStreamOptions | undefined),
            on_progress: (progress) => post({ id, progress }),
            signal: controller.signal,
          })
          post({ id, result: stream }, position_stream_transferables(stream))
        } else throw new Error(`Unsupported run port method: ${String(method)}`)
      } catch (error) {
        post({ id, error: to_error(error).message })
      } finally {
        controllers[id] = undefined
      }
    })
  })
  port1.start()
  return channel.port2
}

// Best-effort release for a port the client never bound (stale reply, clone failure)
export const dispose_run_port = (port: MessagePort | undefined): void => {
  if (!port) return
  try {
    port.postMessage({ id: 0, method: `dispose`, args: [] } satisfies RunPortRequest)
  } catch {
    // Port may already be closed / detached
  }
  port.close()
}

// Client side. `release` runs once on dispose (or a port failure) and is where the caller
// terminates the worker that owns the other end.
export const worker_run = (
  port: MessagePort,
  summary: TrajectoryRunSummary,
  release: () => void = () => {},
): TrajectoryRun => {
  const fields = run_fields_from_summary(summary)
  const { properties } = fields
  let next_id = 0
  let disposed_reason: Error | null = null
  type Pending = {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    on_progress?: (progress: ParseProgress) => void
    signal?: AbortSignal
    on_abort: () => void
  }
  let pending: (Pending | undefined)[] = []
  const dispose = (reason = disposed_error(`Worker-served trajectory`)): void => {
    if (disposed_reason) return
    disposed_reason = reason
    for (const request of pending) {
      if (!request) continue
      request.signal?.removeEventListener(`abort`, request.on_abort)
      request.reject(reason)
    }
    pending = []
    properties.finish()
    dispose_run_port(port)
    release()
  }
  port.addEventListener(`message`, (event: MessageEvent<RunPortReply>) => {
    const reply = event.data
    if (`properties` in reply) {
      if (!properties.complete) {
        properties.push(reply.properties)
        if (reply.complete) properties.finish()
      }
      return
    }
    const request = pending[reply.id]
    if (!request) return
    if (reply.progress) return request.on_progress?.(reply.progress)
    pending[reply.id] = undefined
    request.signal?.removeEventListener(`abort`, request.on_abort)
    if (reply.error) request.reject(new Error(reply.error))
    else request.resolve(reply.result)
  })
  port.addEventListener(`messageerror`, () =>
    dispose(new Error(`Worker-served trajectory reply failed to deserialize`)),
  )
  port.start()

  const rpc = <Result>(
    method: RunPortMethod,
    args: unknown[],
    signal?: AbortSignal,
    on_progress?: (progress: ParseProgress) => void,
  ): Promise<Result> => {
    if (disposed_reason) return Promise.reject(disposed_reason)
    if (signal?.aborted) return Promise.reject(to_error(signal.reason ?? abort_error()))
    return new Promise<Result>((resolve, reject) => {
      const id = next_id++
      const on_abort = (): void => {
        if (!pending[id]) return
        pending[id] = undefined
        try {
          port.postMessage({
            id: next_id++,
            method: `abort`,
            args: [id],
          } satisfies RunPortRequest)
        } catch {
          // Aborting a request on a dead port changes nothing
        }
        reject(to_error(signal?.reason ?? abort_error()))
      }
      pending[id] = {
        resolve: (value) => resolve(value as Result),
        reject,
        on_progress,
        signal,
        on_abort,
      }
      signal?.addEventListener(`abort`, on_abort, { once: true })
      try {
        port.postMessage({ id, method, args } satisfies RunPortRequest)
      } catch (error) {
        pending[id] = undefined
        reject(to_error(error))
        dispose(to_error(error))
      }
    })
  }

  return {
    ...fields,
    read_frame: (frame_idx, signal) => {
      assert_frame_idx(summary, frame_idx)
      if (frame_idx === 0) return summary.preview
      return rpc<TrajectoryFrame>(`read_frame`, [frame_idx], signal)
    },
    ...(summary.has_collect_positions
      ? {
          // Only the cloneable sweep options cross the port; progress and abort travel as
          // port messages
          collect_positions: ({ on_progress, signal, ...options } = {}) =>
            rpc<TrajectoryPositionStream>(`collect_positions`, [options], signal, on_progress),
        }
      : {}),
    dispose: () => dispose(),
  }
}
