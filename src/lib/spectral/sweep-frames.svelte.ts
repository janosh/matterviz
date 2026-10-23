// A sweep's frames with their heavy data loaded on demand: each requested frame is fetched once
// through the caller's loader and cached, merged over the frame's own fields (scalars, status
// and phonon spectra key by key) once, so a loaded frame keeps its identity across reads. Each
// sweep and loader pair gets its own cache, so loads still running for a previous pair land in
// a cache nothing reads anymore.
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import type { Sweep, SweepFrame, SweepFrameLoader, SweepSeries } from './sweep'

type FrameData = Awaited<ReturnType<SweepFrameLoader>>

// The loaded fields over the frame's own, nested records key by key; its value always wins
const merge_frame = (base: SweepFrame, data: FrameData): SweepFrame => ({
  ...base,
  ...data,
  ...((base.scalars ?? data.scalars) && { scalars: { ...base.scalars, ...data.scalars } }),
  ...((base.status ?? data.status) && { status: { ...base.status, ...data.status } }),
  ...((base.phonon ?? data.phonon) && { phonon: { ...base.phonon, ...data.phonon } }),
  value: base.value,
})

export function create_sweep_frames(inputs: {
  sweep: () => Sweep | undefined
  load_frame: () => SweepFrameLoader | undefined
  on_error: (message: string) => void
}) {
  const cache = $derived.by(() => {
    void inputs.sweep()
    return {
      loader: inputs.load_frame(),
      loaded: new SvelteMap<string, SweepFrame>(),
      pending: new SvelteSet<string>(),
      failed: new Set<string>(), // not retried until the sweep or loader changes
    }
  })
  const key = (series: SweepSeries, idx: number) => `${series.id}\u0000${idx}`
  const in_range = (series: SweepSeries, idx: number) =>
    Number.isInteger(idx) && idx >= 0 && idx < series.frames.length

  return {
    // The frame with whatever its loader returned merged in
    frame: (series: SweepSeries, idx: number): SweepFrame =>
      cache.loaded.get(key(series, idx)) ?? series.frames[idx],
    // Whether the frame has all its data: true without a loader or once its load settled
    is_ready(series: SweepSeries, idx: number): boolean {
      if (!cache.loader || !in_range(series, idx)) return true
      const frame_key = key(series, idx)
      return cache.loaded.has(frame_key) || cache.failed.has(frame_key)
    },
    is_loading(series: SweepSeries, idx: number): boolean {
      return cache.pending.has(key(series, idx))
    },
    // Start loading the frame unless it is loaded, loading or failed (no-op without a loader).
    // Call from an effect or event handler, never while deriving.
    request(series: SweepSeries, idx: number): void {
      const { loader, loaded, pending, failed } = cache
      if (!loader || !in_range(series, idx)) return
      const frame_key = key(series, idx)
      if (loaded.has(frame_key) || pending.has(frame_key) || failed.has(frame_key)) return
      pending.add(frame_key)
      loader(series.id, idx).then(
        (data) => {
          pending.delete(frame_key)
          loaded.set(frame_key, merge_frame(series.frames[idx], data))
        },
        (error: unknown) => {
          pending.delete(frame_key)
          failed.add(frame_key)
          // a previous sweep's failure is no longer the caller's concern
          if (loaded !== cache.loaded) return
          const reason = error instanceof Error ? error.message : String(error)
          inputs.on_error(
            `Loading frame ${idx + 1} of series "${series.id}" failed: ${reason}`,
          )
        },
      )
    },
  }
}
