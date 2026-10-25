// A sweep's frames with their heavy data loaded on demand: each requested frame is fetched
// through the sweep's loader, parsed like a JSON frame and cached by the frame object it
// belongs to, so frames inserted, removed or edited in place (a $state sweep) keep their data.
// Reads merge the loaded fields over the frame's own, so an in-place edit shows at once. Each
// sweep and loader pair gets its own cache, whose loads are aborted when the pair is replaced
// or the owner unmounts.
// Memory stays bounded: a request names the window (per series shown, e.g. a compared one: the
// shown frame and the neighbours to prefetch). Loads outside it are aborted, and loaded frames
// outside it and the RECENT_FRAMES last shown ones drop their heavy data, keeping only the light
// fields the trends plot reads (see light_data). A dropped or aborted frame loads again when
// requested.
import { untrack } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { to_error } from 'svelte-widgets/utils'
import { compute_descriptor, normalize_frame_data } from './sweep'
import type { DescriptorSpec, Sweep, SweepFrame, SweepFrameData, SweepSeries } from './sweep'

// The last shown frames (the current one included) that keep their heavy data after leaving
// the window, so flipping back to a frame just compared needs no reload. A frame's band grid
// is up to 64³ points × bands (~20 MB at 10 bands in f64), so the window's 3 frames plus 3
// older ones cap the cache near 120 MB (twice the window while comparing two series).
export const RECENT_FRAMES = 4

// A series and the indices of its frames to load: the shown frame first, then its neighbours
export type FrameWindow = [SweepSeries, [number, ...number[]]]

// A frame's load. `data` is the loader's result, only its light fields once evicted (also
// while loading again or after a failed reload, so the trends plot keeps its points).
type FrameEntry =
  | { state: `loading`; controller: AbortController; data?: SweepFrameData }
  | { state: `loaded`; data: SweepFrameData }
  | { state: `evicted`; data: SweepFrameData }
  | { state: `failed`; data?: SweepFrameData } // not retried until the sweep or loader changes

// data's entries over base's (undefined when neither is set)
const merge = <Value extends object>(base?: Value, data?: Value): Value | undefined =>
  base && data ? { ...base, ...data } : (base ?? data)

// The loaded fields over the frame's own, every record (phonon's too) key by key, phonon's
// mode_values whole (its arrays align by q-point); the frame's value always wins
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
            mode_values: data.phonon.mode_values ?? phonon.mode_values,
          }
        : (phonon ?? data.phonon),
    value: base.value,
  }
}

// What an evicted frame keeps of its loaded data: label, status and scalars, the latter with
// the descriptors computed from the data it drops, so the trends plot never changes on eviction
const light_data = (
  base: SweepFrame,
  data: SweepFrameData,
  descriptors: DescriptorSpec[],
): SweepFrameData => {
  const frame = merge_frame(base, data)
  const computed = descriptors.flatMap((spec) => {
    const value =
      spec.compute && frame.scalars?.[spec.key] === undefined
        ? compute_descriptor(frame, spec)
        : undefined
    return value === undefined ? [] : [[spec.key, value] as const]
  })
  const { label, status } = data
  const scalars = { ...data.scalars, ...Object.fromEntries(computed) }
  return {
    ...(label !== undefined && { label }),
    ...(status && { status }),
    ...(Object.keys(scalars).length > 0 && { scalars }),
  }
}

export function create_sweep_frames(inputs: {
  sweep: () => Sweep | undefined
  on_error: (message: string) => void
}) {
  const cache = $derived({
    loader: inputs.sweep()?.load_frame,
    entries: new SvelteMap<SweepFrame, FrameEntry>(),
    recent: [] as SweepFrame[], // the last shown frames, most recent first
  })
  // a replaced cache (new sweep or loader) and unmounting abort the loads still running
  $effect(() => {
    const { entries } = cache
    return () => {
      for (const entry of untrack(() => [...entries.values()])) {
        if (entry.state === `loading`) entry.controller.abort()
      }
    }
  })
  const in_range = (series: SweepSeries, idx: number) =>
    Number.isInteger(idx) && idx >= 0 && idx < series.frames.length

  const start = (current: typeof cache, series: SweepSeries, idx: number): void => {
    const { loader, entries } = current
    if (!loader) return
    const base = series.frames[idx]
    const entry = entries.get(base)
    if (entry && entry.state !== `evicted`) return
    const controller = new AbortController()
    const { signal } = controller
    entries.set(base, { state: `loading`, controller, data: entry?.data })
    // an aborted load is neither cached nor reported: its entry was already reset
    loader(series.id, idx, { signal })
      .then((data) => normalize_frame_data(data, `load_frame("${series.id}", ${idx})`))
      .then(
        (data) => {
          if (!signal.aborted) entries.set(base, { state: `loaded`, data })
        },
        (error: unknown) => {
          if (signal.aborted) return
          entries.set(base, { state: `failed`, data: entry?.data })
          const reason = to_error(error).message
          inputs.on_error(`Loading frame ${idx} of series "${series.id}" failed: ${reason}`)
        },
      )
  }

  // Abort loads outside the windows, evict loaded frames outside them and the recent ones, then
  // start the windows' loads (the shown frames first)
  const show = (current: typeof cache, windows: FrameWindow[]): void => {
    const { entries } = current
    const valid = windows.map(([series, window]) => ({
      series,
      indices: window.filter((idx) => in_range(series, idx)),
      shown: in_range(series, window[0]) ? series.frames[window[0]] : undefined,
    }))
    const in_window = new Set(
      valid.flatMap(({ series, indices }) => indices.map((idx) => series.frames[idx])),
    )
    const shown = valid.flatMap((entry) => (entry.shown ? [entry.shown] : []))
    const older = current.recent.filter((frame) => !shown.includes(frame))
    current.recent = [...shown, ...older].slice(0, RECENT_FRAMES)
    const descriptors = inputs.sweep()?.descriptors ?? []
    for (const [base, entry] of entries) {
      if (in_window.has(base)) continue
      if (entry.state === `loading`) {
        entry.controller.abort()
        if (entry.data) entries.set(base, { state: `evicted`, data: entry.data })
        else entries.delete(base)
      } else if (entry.state === `loaded` && !current.recent.includes(base)) {
        entries.set(base, {
          state: `evicted`,
          data: light_data(base, entry.data, descriptors),
        })
      }
    }
    // each window's first frame, then each window's second and so on
    const depth = Math.max(...valid.map(({ indices }) => indices.length))
    for (let rank = 0; rank < depth; rank++) {
      for (const { series, indices } of valid) {
        if (rank < indices.length) start(current, series, indices[rank])
      }
    }
  }

  return {
    // The frame with whatever its loader returned merged in
    frame(series: SweepSeries, idx: number): SweepFrame {
      const base = series.frames[idx]
      const data = cache.entries.get(base)?.data
      return data ? merge_frame(base, data) : base
    },
    // Whether the frame has all its data: true without a loader or once its load settled
    // (false again once evicted)
    is_ready(series: SweepSeries, idx: number): boolean {
      if (!cache.loader || !in_range(series, idx)) return true
      const state = cache.entries.get(series.frames[idx])?.state
      return state === `loaded` || state === `failed`
    },
    is_loading: (series: SweepSeries, idx: number): boolean =>
      cache.entries.get(series.frames[idx])?.state === `loading`,
    // Make the windows' frames (one window per shown series, each its shown frame first, then
    // the neighbours to prefetch; indices outside the series are skipped) the loaded frames:
    // start each one's load unless it is loaded, loading or failed, abort the others' loads
    // and evict their data (see RECENT_FRAMES). No-op without a loader. Call from an effect or
    // event handler, never while deriving. The calling effect reruns when the cache is
    // replaced (a new sweep or loader) or another frame takes a window index, to request anew,
    // but not on each load it starts or settles.
    request(...windows: [FrameWindow, ...FrameWindow[]]): void {
      const current = cache
      for (const [series, window] of windows) {
        for (const idx of window) void series.frames[idx]
      }
      untrack(() => show(current, windows))
    },
  }
}
