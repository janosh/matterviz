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
import { atom_batch_transfers, type AtomBatch, type AtomReadOptions } from '../atom-batches'
import type { HotspotOptions, HotspotRequest, HotspotResult } from '../hotspots'

type RunPortMethod =
  | `read_frame`
  | `read_atoms`
  | `compute_hotspots`
  | `collect_positions`
  | `abort`
  | `dispose`

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
  const controllers = new Map<number, AbortController>()
  let queue = Promise.resolve()
  let hotspot_queue = Promise.resolve()
  let hotspot_controller: AbortController | undefined
  const unsubscribe = run.properties.subscribe((batch, complete) =>
    post({ properties: batch, complete }),
  )
  const dispose = (): void => {
    unsubscribe()
    for (const controller of controllers.values()) controller.abort(abort_error())
    controllers.clear()
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
    const { id: identifier, method, args } = event.data
    if (method === `dispose` || !served) return dispose()
    if (method === `abort`) return controllers.get(Number(args[0]))?.abort(abort_error())
    const controller = new AbortController()
    controllers.set(identifier, controller)
    const execute = async () => {
      const active = served
      if (!active) return
      if (controller.signal.aborted) {
        controllers.delete(identifier)
        return post({ id: identifier, error: `Request aborted` })
      }
      try {
        if (method === `read_frame`) {
          const frame = await active.read_frame(Number(args[0]), controller.signal)
          post({ id: identifier, result: frame })
        } else if (method === `read_atoms`) {
          if (!active.read_atoms) throw new Error(`Run cannot read atom batches`)
          const batch = await active.read_atoms(args[0] as AtomReadOptions, controller.signal)
          post({ id: identifier, result: batch }, atom_batch_transfers(batch))
        } else if (method === `compute_hotspots`) {
          if (!active.compute_hotspots) throw new Error(`Run cannot calculate hotspots`)
          const result = await active.compute_hotspots({
            ...(args[0] as HotspotOptions),
            signal: controller.signal,
            on_progress: (progress) => post({ id: identifier, progress }),
          })
          post({ id: identifier, result }, [
            result.energy.buffer,
            result.population.buffer,
            result.dof.buffer,
            result.occupied_frames.buffer,
          ])
        } else if (method === `collect_positions`) {
          if (!active.collect_positions) throw new Error(`Run cannot collect positions`)
          const stream = await active.collect_positions({
            ...(args[0] as PositionStreamOptions | undefined),
            on_progress: (progress) => post({ id: identifier, progress }),
            signal: controller.signal,
          })
          post({ id: identifier, result: stream }, position_stream_transferables(stream))
        } else throw new Error(`Unsupported run port method: ${String(method)}`)
      } catch (error) {
        post({ id: identifier, error: to_error(error).message })
      } finally {
        controllers.delete(identifier)
      }
    }
    // Hotspot scans yield between numeric batches. They must not reserve the serial frame
    // queue for the whole trajectory; interactive reads and cancellation get each next turn.
    if (method === `compute_hotspots`) {
      hotspot_controller?.abort(abort_error())
      hotspot_controller = controller
      hotspot_queue = hotspot_queue.then(execute)
    } else queue = queue.then(execute)
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
    settle: (value?: unknown, error?: Error) => void
    on_progress?: (progress: ParseProgress) => void
    cancel: (reason: Error) => void
  }
  const pending = new Map<number, Pending>()
  const dispose = (reason = disposed_error(`Worker-served trajectory`)): void => {
    if (disposed_reason) return
    disposed_reason = reason
    for (const request of pending.values()) request.settle(undefined, reason)
    try {
      properties.finish()
    } finally {
      try {
        dispose_run_port(port)
      } finally {
        release()
      }
    }
  }
  port.addEventListener(`message`, (event: MessageEvent<RunPortReply>) => {
    const reply = event.data
    if (`properties` in reply) {
      if (properties.complete) return
      let errors: unknown[] | undefined
      try {
        properties.push(reply.properties)
      } catch (error) {
        errors = [error]
      }
      try {
        if (reply.complete) properties.finish()
      } catch (error) {
        ;(errors ??= []).push(error)
      }
      if (errors?.length === 1) throw errors[0]
      if (errors) throw new AggregateError(errors, `Worker property notifications failed`)
      return
    }
    const request = pending.get(reply.id)
    if (!request) return
    if (reply.progress) {
      try {
        request.on_progress?.(reply.progress)
      } catch (error) {
        request.cancel(to_error(error))
      }
      return
    }
    request.settle(reply.result, reply.error ? new Error(reply.error) : undefined)
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
      const identifier = next_id++
      const settle = (value?: unknown, error?: Error): void => {
        if (!pending.delete(identifier)) return
        signal?.removeEventListener(`abort`, on_abort)
        if (error) reject(error)
        else resolve(value as Result)
      }
      const cancel = (reason: Error): void => {
        if (!pending.has(identifier)) return
        try {
          port.postMessage({
            id: next_id++,
            method: `abort`,
            args: [identifier],
          } satisfies RunPortRequest)
        } catch {
          // Aborting a request on a dead port changes nothing
        }
        settle(undefined, reason)
      }
      const on_abort = (): void => cancel(to_error(signal?.reason ?? abort_error()))
      pending.set(identifier, { settle, on_progress, cancel })
      signal?.addEventListener(`abort`, on_abort, { once: true })
      try {
        port.postMessage({ id: identifier, method, args } satisfies RunPortRequest)
      } catch (error) {
        dispose(to_error(error))
      }
    })
  }

  return {
    ...fields,
    ...(summary.has_read_atoms && {
      read_atoms: (options: AtomReadOptions, signal?: AbortSignal) =>
        rpc<AtomBatch>(`read_atoms`, [options], signal),
      compute_hotspots: ({ signal, on_progress, ...options }: HotspotRequest) =>
        rpc<HotspotResult>(`compute_hotspots`, [options], signal, on_progress),
    }),
    // Keep the snapshot unproxied when Svelte binds the run to reactive state.
    get preview() {
      return summary.preview
    },
    read_frame: (frame_idx, signal) => {
      assert_frame_idx(summary, frame_idx)
      if (disposed_reason) return Promise.reject(disposed_reason)
      if (signal?.aborted) return Promise.reject(to_error(signal.reason ?? abort_error()))
      if (frame_idx === 0 && !summary.preview.metadata?.render_sample) return summary.preview
      return rpc<TrajectoryFrame>(`read_frame`, [frame_idx], signal)
    },
    ...(summary.has_collect_positions && {
      // Only the cloneable sweep options cross the port; progress and abort travel as
      // port messages
      collect_positions: ({ on_progress, signal, ...options } = {}) =>
        rpc<TrajectoryPositionStream>(`collect_positions`, [options], signal, on_progress),
    }),
    dispose: () => dispose(),
  }
}
