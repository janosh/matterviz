// Display preparation (bonds, polyhedra, vector geometry) for runs whose frames arrive on the
// main thread rather than in a source worker (a host run, see runs/host.ts). Each input (a
// host's encoded reply, or a frame) moves (transferred, not copied) to one of a few module
// workers, which decodes it into a frame and prepares it there, and its DisplayFrame moves
// back. Jobs wait here and go only to an idle worker, so read-ahead that a seek cancels never
// occupies one. The worker side is serve_preparation (prepare-serve.ts).
// oxlint-disable eslint-plugin-unicorn/require-post-message-target-origin
import { to_error } from 'svelte-widgets/utils'
import type { DisplayFrame, FramePreparation } from './prepare'

export interface PrepareRequest<Input> {
  id: number
  input: Input
  preparation: FramePreparation
}
export type PrepareReply =
  | { id: number; display: DisplayFrame; prepare_ms: number }
  | { id: number; error: string }

export type PrepareWorker = Pick<Worker, `postMessage` | `addEventListener` | `terminate`>

// worker time (decoding and preparing), and everything else from the request to its result
// (waiting for an idle worker, both transfers, the reply's turn on the main thread)
export type PrepareTiming = { prepare_ms: number; wait_ms: number }

export interface PreparePool<Input> {
  // Takes ownership of the input's transferred buffers
  prepare: (
    input: Input,
    preparation: FramePreparation,
    signal?: AbortSignal,
  ) => Promise<DisplayFrame>
  dispose: () => void
}

// Bond search for 20k atoms takes ~20-35 ms, so one worker caps playback near 30-50 fps; a few
// workers overlap frames while sparing cores for rendering and the host channel
export const prepare_worker_count = (cores = globalThis.navigator?.hardwareConcurrency ?? 2) =>
  Math.max(1, Math.min(4, cores - 2))

type Job<Input> = {
  id: number
  input: Input
  preparation: FramePreparation
  started_at: number
  finish: (outcome: { display: DisplayFrame; prepare_ms: number } | Error) => void
}
type Slot<Input> = { worker: PrepareWorker; job?: Job<Input> }
// Idle workers end after this long (a paused viewer), returning their heaps and bond-search
// scratch; the next job opens fresh ones
const IDLE_RELEASE_MS = 10_000

export const create_prepare_pool = <Input>({
  create_worker,
  transfers,
  size = prepare_worker_count(),
  on_timing,
}: {
  create_worker: () => PrepareWorker
  // the input's buffers to move rather than copy to the worker
  transfers: (input: Input) => Transferable[]
  size?: number
  on_timing?: (timing: PrepareTiming) => void
}): PreparePool<Input> => {
  const slots: Slot<Input>[] = []
  // insertion order is the queue
  const queued = new Set<Job<Input>>()
  let next_id = 0
  let disposed: Error | undefined
  let idle_timer: ReturnType<typeof setTimeout> | undefined
  const release_idle = (): void => {
    idle_timer = undefined
    for (const slot of slots.splice(0)) slot.worker.terminate()
  }

  const fail_slot = (slot: Slot<Input>, error: Error): void => {
    const idx = slots.indexOf(slot)
    if (idx === -1) return // its error and messageerror both fired
    slot.worker.terminate()
    slots.splice(idx, 1)
    slot.job?.finish(error)
    pump()
  }
  const open_slot = (): Slot<Input> => {
    const slot: Slot<Input> = { worker: create_worker() }
    slot.worker.addEventListener(`message`, ({ data }: MessageEvent<PrepareReply>) => {
      const { job } = slot
      slot.job = undefined
      if (job?.id === data.id) job.finish(`error` in data ? new Error(data.error) : data)
      pump()
    })
    // A worker that fails to load or crashes takes only its own job down; the next job opens
    // a fresh one, and a page refusing workers fails every job rather than preparing nothing
    slot.worker.addEventListener(`error`, (event: ErrorEvent) => {
      event.preventDefault()
      fail_slot(slot, new Error(`Frame preparation worker failed: ${event.message}`))
    })
    slot.worker.addEventListener(`messageerror`, () =>
      fail_slot(slot, new Error(`Frame preparation worker reply failed to deserialize`)),
    )
    slots.push(slot)
    return slot
  }
  function pump(): void {
    clearTimeout(idle_timer)
    idle_timer = undefined
    for (const job of queued) {
      const slot =
        slots.find((candidate) => !candidate.job) ??
        (slots.length < size ? open_slot() : undefined)
      if (!slot) return
      queued.delete(job)
      slot.job = job
      try {
        const request: PrepareRequest<Input> = {
          id: job.id,
          input: job.input,
          preparation: job.preparation,
        }
        slot.worker.postMessage(request, { transfer: transfers(job.input) })
      } catch (error) {
        slot.job = undefined
        job.finish(to_error(error))
      }
    }
    if (!disposed && slots.length && !queued.size && slots.every((slot) => !slot.job))
      idle_timer = setTimeout(release_idle, IDLE_RELEASE_MS)
  }

  return {
    prepare: (input, preparation, signal) => {
      if (disposed) return Promise.reject(disposed)
      if (signal?.aborted) return Promise.reject(to_error(signal.reason))
      return new Promise((resolve, reject) => {
        const abort = (): void => {
          queued.delete(job)
          // a posted job still occupies its worker until the reply, which is then dropped
          job.finish(to_error(signal?.reason))
        }
        let settled = false
        const job: Job<Input> = {
          id: next_id++,
          input,
          preparation,
          started_at: performance.now(),
          finish: (outcome) => {
            if (settled) return
            settled = true
            signal?.removeEventListener(`abort`, abort)
            if (outcome instanceof Error) return reject(outcome)
            const { display, prepare_ms } = outcome
            on_timing?.({
              prepare_ms,
              wait_ms: performance.now() - job.started_at - prepare_ms,
            })
            resolve(display)
          },
        }
        signal?.addEventListener(`abort`, abort, { once: true })
        queued.add(job)
        pump()
      })
    },
    dispose: () => {
      if (disposed) return
      disposed = new Error(`Frame preparation pool is disposed`)
      clearTimeout(idle_timer)
      for (const job of queued) job.finish(disposed)
      queued.clear()
      for (const slot of slots.splice(0)) {
        slot.worker.terminate()
        slot.job?.finish(disposed)
      }
    },
  }
}
