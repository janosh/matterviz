import type { TrajectoryFrame } from '#lib/trajectory/index.js'
import { to_error } from 'svelte-widgets/utils'

// Keep remote playback ahead of the playhead without retaining the entire trajectory.
// Four batches hold at most 200k atoms for a fixed topology (or four oversized frames).
export const host_frame_cache = (
  frame_count: number,
  atom_count: number,
  max_batch_size: number,
  request: (start: number, count: number, signal: AbortSignal) => Promise<TrajectoryFrame[]>,
): {
  read_frame: (index: number, signal?: AbortSignal) => Promise<TrajectoryFrame>
  dispose: () => void
} => {
  const atoms_per_frame = Math.max(1, atom_count)
  const frames_per_batch = Math.floor(50_000 / atoms_per_frame)
  const batch_size = Math.max(1, Math.min(max_batch_size, frames_per_batch))
  const batches = new Map<number, TrajectoryFrame[]>()
  const pending = new Map<number, Promise<TrajectoryFrame[]>>()
  const lifetime = new AbortController()
  const remember = (start: number, frames: TrajectoryFrame[]): void => {
    batches.delete(start)
    batches.set(start, frames)
    while (batches.size > 4) {
      const oldest = batches.keys().next().value
      if (oldest === undefined) break
      batches.delete(oldest)
    }
  }
  const load = (start: number): Promise<TrajectoryFrame[]> => {
    const cached = batches.get(start)
    if (cached) return Promise.resolve(cached)
    const existing = pending.get(start)
    if (existing) return existing
    const count = Math.min(batch_size, frame_count - start)
    const promise = Promise.resolve()
      .then(() => {
        lifetime.signal.throwIfAborted()
        return request(start, count, lifetime.signal)
      })
      .then((frames) => {
        lifetime.signal.throwIfAborted()
        remember(start, frames)
        return frames
      })
      .finally(() => pending.delete(start))
    pending.set(start, promise)
    return promise
  }
  // A scrub cancels its own wait, never a batch another reader needs.
  const wait = (
    promise: Promise<TrajectoryFrame[]>,
    signal?: AbortSignal,
  ): Promise<TrajectoryFrame[]> => {
    if (!signal) return promise
    return new Promise((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener(`abort`, abort)
        reject(to_error(signal.reason))
      }
      signal.addEventListener(`abort`, abort, { once: true })
      promise.then(
        (frames) => {
          signal.removeEventListener(`abort`, abort)
          resolve(frames)
        },
        (error: unknown) => {
          signal.removeEventListener(`abort`, abort)
          reject(to_error(error))
        },
      )
    })
  }
  return {
    read_frame: async (index, signal) => {
      lifetime.signal.throwIfAborted()
      signal?.throwIfAborted()
      if (!Number.isInteger(index) || index < 0 || index >= frame_count)
        throw new RangeError(`Frame index is outside the trajectory`)
      const start = Math.floor(index / batch_size) * batch_size
      const frames = await wait(load(start), signal)
      lifetime.signal.throwIfAborted()
      signal?.throwIfAborted()
      remember(start, frames)
      const next = start + batch_size
      if (index - start >= Math.floor(batch_size / 2) && next < frame_count)
        void load(next).catch(() => {}) // speculative failure is retried on demand
      return frames[index - start]
    },
    dispose: () => {
      lifetime.abort(new DOMException(`Host frame cache disposed`, `AbortError`))
      batches.clear()
      pending.clear()
    },
  }
}
