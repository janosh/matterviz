import type { TrajectoryFrame } from '#lib/trajectory/index.js'
import { to_error } from 'svelte-widgets/utils'

type FrameBatch = {
  controller: AbortController
  promise: Promise<TrajectoryFrame[]>
  readers: number
  speculative: boolean
}

// Keep remote playback ahead of the playhead without retaining the entire trajectory.
// Four batches hold at most 200k atoms for a fixed topology (or four oversized frames).
export const host_frame_cache = (
  frame_count: number,
  atom_count: number,
  max_batch_size: number,
  request: (start: number, count: number, signal: AbortSignal) => Promise<TrajectoryFrame[]>,
): {
  read_frame: (
    index: number,
    signal?: AbortSignal,
  ) => TrajectoryFrame | Promise<TrajectoryFrame>
  dispose: () => void
} => {
  const atoms_per_frame = Math.max(1, atom_count)
  const frames_per_batch = Math.floor(50_000 / atoms_per_frame)
  const batch_size = Math.max(1, Math.min(max_batch_size, frames_per_batch))
  const batches = new Map<number, TrajectoryFrame[]>()
  const pending = new Map<number, FrameBatch>()
  const lifetime = new AbortController()
  let last_index = 0
  const remember = (start: number, frames: TrajectoryFrame[]): void => {
    batches.delete(start)
    batches.set(start, frames)
    while (batches.size > 4) {
      const oldest = batches.keys().next().value
      if (oldest === undefined) break
      batches.delete(oldest)
    }
  }
  const cancel = (start: number, batch: FrameBatch): void => {
    if (pending.get(start) !== batch) return
    pending.delete(start)
    batch.controller.abort(new DOMException(`Frame batch superseded`, `AbortError`))
  }
  const load = (start: number, speculative: boolean): FrameBatch => {
    const existing = pending.get(start)
    if (existing) {
      if (!speculative) existing.speculative = false
      return existing
    }
    const controller = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, controller.signal])
    const count = Math.min(batch_size, frame_count - start)
    const batch: FrameBatch = {
      controller,
      readers: 0,
      speculative,
      promise: Promise.resolve()
        .then(() => {
          signal.throwIfAborted()
          return request(start, count, signal)
        })
        .then((frames) => {
          signal.throwIfAborted()
          remember(start, frames)
          return frames
        })
        .finally(() => {
          if (pending.get(start) === batch) pending.delete(start)
        }),
    }
    pending.set(start, batch)
    return batch
  }
  const prefetch = (start: number, index: number, direction: number): void => {
    const next = start + direction * batch_size
    const near_edge =
      direction > 0
        ? index - start >= Math.floor(batch_size / 2)
        : index - start < Math.ceil(batch_size / 2)
    if (near_edge && next >= 0 && next < frame_count && !batches.has(next))
      void load(next, true).promise.catch(() => {}) // retry speculative failures on demand
  }
  // Cancel a scrub's own wait promptly; retain a shared batch only while another reader needs it.
  const wait = (
    start: number,
    batch: FrameBatch,
    signal?: AbortSignal,
  ): Promise<TrajectoryFrame[]> => {
    batch.readers++
    const release = (): void => {
      batch.readers--
      // A new scrub in the same turn can adopt this batch before cancellation.
      if (!batch.readers && !batch.speculative)
        queueMicrotask(() => {
          if (!batch.readers && !batch.speculative) cancel(start, batch)
        })
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        signal?.removeEventListener(`abort`, abort)
        release()
        reject(to_error(signal?.reason))
      }
      signal?.addEventListener(`abort`, abort, { once: true })
      batch.promise.then(
        (frames) => {
          signal?.removeEventListener(`abort`, abort)
          if (signal?.aborted) return
          release()
          resolve(frames)
        },
        (error: unknown) => {
          signal?.removeEventListener(`abort`, abort)
          if (signal?.aborted) return
          release()
          reject(to_error(error))
        },
      )
    })
  }
  return {
    read_frame: (index, signal) => {
      if (lifetime.signal.aborted) return Promise.reject(to_error(lifetime.signal.reason))
      if (signal?.aborted) return Promise.reject(to_error(signal.reason))
      if (!Number.isInteger(index) || index < 0 || index >= frame_count)
        return Promise.reject(new RangeError(`Frame index is outside the trajectory`))
      const direction = index < last_index ? -1 : 1
      const start = Math.floor(index / batch_size) * batch_size
      // Speculation from the old playhead must not compete with a distant drag target.
      if (Math.abs(index - last_index) > batch_size) {
        for (const [offset, batch] of pending)
          if (offset !== start && batch.speculative && !batch.readers) cancel(offset, batch)
      }
      last_index = index
      const cached = batches.get(start)
      if (cached) {
        remember(start, cached)
        prefetch(start, index, direction)
        return cached[index - start]
      }
      return wait(start, load(start, false), signal).then((frames) => {
        lifetime.signal.throwIfAborted()
        signal?.throwIfAborted()
        remember(start, frames)
        if (last_index === index) prefetch(start, index, direction)
        return frames[index - start]
      })
    },
    dispose: () => {
      lifetime.abort(new DOMException(`Host frame cache disposed`, `AbortError`))
      batches.clear()
      pending.clear()
    },
  }
}
