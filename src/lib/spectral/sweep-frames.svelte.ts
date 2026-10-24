// A sweep's frames with their heavy data loaded on demand: each requested frame is fetched once
// through the sweep's loader, parsed like a JSON frame and cached by the frame object it
// belongs to, so frames inserted, removed or edited in place (a $state sweep) keep their data.
// Reads merge the loaded fields over the frame's own, so an in-place edit shows at once. Each
// sweep and loader pair gets its own cache: loads still running for a previous pair land in a
// cache nothing reads anymore.
import { untrack } from 'svelte'
import { SvelteMap, SvelteSet } from 'svelte/reactivity'
import { to_error } from 'svelte-widgets/utils'
import { normalize_frame_data } from './sweep'
import type { Sweep, SweepFrame, SweepFrameData, SweepSeries } from './sweep'

// data's entries over base's (undefined when neither is set)
const merge = <Value extends object>(base?: Value, data?: Value): Value | undefined =>
  base && data ? { ...base, ...data } : (base ?? data)

// The loaded fields over the frame's own, every record (phonon's too) key by key; the frame's
// value always wins
const merge_frame = (base: SweepFrame, data: SweepFrameData): SweepFrame => {
  const { phonon } = base
  return {
    ...base,
    ...data,
    scalars: merge(base.scalars, data.scalars),
    status: merge(base.status, data.status),
    band_structs: merge(base.band_structs, data.band_structs),
    doses: merge(base.doses, data.doses),
    phonon:
      phonon && data.phonon
        ? {
            band_structs: merge(phonon.band_structs, data.phonon.band_structs),
            doses: merge(phonon.doses, data.phonon.doses),
            a2f: merge(phonon.a2f, data.phonon.a2f),
          }
        : (phonon ?? data.phonon),
    value: base.value,
  }
}

export function create_sweep_frames(inputs: {
  sweep: () => Sweep | undefined
  on_error: (message: string) => void
}) {
  const cache = $derived({
    loader: inputs.sweep()?.load_frame,
    loaded: new SvelteMap<SweepFrame, SweepFrameData>(),
    pending: new SvelteSet<SweepFrame>(),
    failed: new Set<SweepFrame>(), // not retried until the sweep or loader changes
  })
  const in_range = (series: SweepSeries, idx: number) =>
    Number.isInteger(idx) && idx >= 0 && idx < series.frames.length

  const start = (current: typeof cache, series: SweepSeries, idx: number): void => {
    const { loader, loaded, pending, failed } = current
    if (!loader || !in_range(series, idx)) return
    const base = series.frames[idx]
    if (loaded.has(base) || pending.has(base) || failed.has(base)) return
    pending.add(base)
    loader(series.id, idx)
      .then((data) => normalize_frame_data(data, `load_frame("${series.id}", ${idx})`))
      .then(
        (data) => {
          pending.delete(base)
          loaded.set(base, data)
        },
        (error: unknown) => {
          pending.delete(base)
          failed.add(base)
          // a previous sweep's failure is no longer the caller's concern
          if (loaded !== cache.loaded) return
          const reason = to_error(error).message
          inputs.on_error(`Loading frame ${idx} of series "${series.id}" failed: ${reason}`)
        },
      )
  }

  return {
    // The frame with whatever its loader returned merged in
    frame(series: SweepSeries, idx: number): SweepFrame {
      const base = series.frames[idx]
      const data = cache.loaded.get(base)
      return data ? merge_frame(base, data) : base
    },
    // Whether the frame has all its data: true without a loader or once its load settled
    is_ready(series: SweepSeries, idx: number): boolean {
      if (!cache.loader || !in_range(series, idx)) return true
      const base = series.frames[idx]
      return cache.loaded.has(base) || cache.failed.has(base)
    },
    is_loading: (series: SweepSeries, idx: number): boolean =>
      cache.pending.has(series.frames[idx]),
    // Start loading the frame unless it is loaded, loading or failed (no-op without a loader).
    // Call from an effect or event handler, never while deriving. The calling effect reruns
    // when the cache is replaced (a new sweep or loader) or another frame takes the index, to
    // request anew, but not on each load it starts or settles.
    request(series: SweepSeries, idx: number): void {
      const current = cache
      void series.frames[idx]
      untrack(() => start(current, series, idx))
    },
  }
}
