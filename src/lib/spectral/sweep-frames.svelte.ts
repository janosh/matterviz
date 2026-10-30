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
// A background frame (e.g. the trends plot's frames without a value yet) loads through the same
// cache at the lowest priority (see load_background).
// A failed load is reported while its frame is shown, so a prefetched or background frame's
// failure waits until a request shows that frame instead of overwriting the shown frame's error.
import { untrack } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { to_error } from 'svelte-widgets/utils'
import { compute_descriptor, normalize_frame_data } from './sweep'
import type { DescriptorSpec, Sweep, SweepFrame, SweepFrameData, SweepSeries } from './sweep'

// The last shown frames (the current one included) that keep their heavy data after leaving
// the window, so flipping back to a frame just compared needs no reload. A frame's band grid
// is up to 64³ points × bands (~20 MB at 10 bands in f64), so the window's 3 frames, 3 older
// ones and the background frame while it loads cap the cache near 140 MB (~180 MB while
// comparing two series: 6 window frames, 2 older ones).
export const RECENT_FRAMES = 4

// A series and the indices of its frames to load: the shown frame first, then its neighbours
export type FrameWindow = [SweepSeries, [number, ...number[]]]
// One frame of a series by index
export type FrameRef = [SweepSeries, number]

// A frame's load. `data` is the loader's result, only its light fields once evicted (also
// while loading again or after a failed reload, so the trends plot keeps its points).
type FrameEntry =
  | { state: `loading`; controller: AbortController; data?: SweepFrameData }
  | { state: `loaded`; data: SweepFrameData }
  | { state: `evicted`; data: SweepFrameData }
  // not retried until the sweep or loader changes; `unreported` holds its error until reported
  // (at once while shown, else once a request shows it)
  | { state: `failed`; data?: SweepFrameData; unreported?: string }

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
  // Bumped once per cache, by the effect below, after the old sweep's panes tore down: their
  // teardown reading props makes Svelte re-run dirty deriveds against the old values, which left
  // the frame cache's readers subscribed to a throwaway map, so loads into the current one never
  // reached them (a swapped sweep's panes stayed empty). The bump re-runs them on the current
  // cache, whose per-entry signals then notify only a loaded frame's readers.
  let epoch = $state(0)
  const cache = $derived({
    loader: inputs.sweep()?.load_frame,
    entries: new SvelteMap<SweepFrame, FrameEntry>(),
    recent: [] as SweepFrame[], // the last shown frames, most recent first
    // the last request's window frames (none before the first request)
    in_window: new Set<SweepFrame>(),
    shown: new Set<SweepFrame>(), // the last request's shown frames (each window's first)
    background: undefined as SweepFrame | undefined, // the frame load_background loads
    background_failed: false, // a background load failed (reported once per cache)
  })
  // a replaced cache (new sweep or loader) and unmounting abort the loads still running
  $effect(() => {
    const { entries } = cache
    epoch = untrack(() => epoch) + 1
    return () => {
      for (const entry of entries.values()) {
        if (entry.state === `loading`) entry.controller.abort()
      }
    }
  })
  // the frame's entry in the current cache, tracking it and the cache's replacement
  const entry_of = (base: SweepFrame): FrameEntry | undefined => {
    void epoch
    return cache.entries.get(base)
  }
  const in_range = (series: SweepSeries, idx: number) =>
    Number.isInteger(idx) && idx >= 0 && idx < series.frames.length

  // Report a failed frame's error unless reported already, with `suffix` appended
  const report = (current: typeof cache, base: SweepFrame, suffix = ``): void => {
    const entry = current.entries.get(base)
    if (entry?.state !== `failed` || entry.unreported === undefined) return
    current.entries.set(base, { state: `failed`, data: entry.data })
    inputs.on_error(`${entry.unreported}${suffix}`)
  }

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
          const reason = to_error(error).message
          const unreported = `Loading frame ${idx} of series "${series.id}" failed: ${reason}`
          entries.set(base, { state: `failed`, data: entry?.data, unreported })
          const { shown } = current
          if (shown.has(base)) report(current, base)
          else if (base === current.background && !current.background_failed) {
            // the first failure of frames nobody asked to see stands for the rest
            current.background_failed = true
            report(current, base, ` (other frames' failures show with the frame)`)
          }
        },
      )
  }

  // Abort loads outside the windows (the background frame's excepted), evict loaded frames
  // outside them and the recent ones
  const release = (current: typeof cache): void => {
    const { entries, in_window, background } = current
    const descriptors = inputs.sweep()?.descriptors ?? []
    for (const [base, entry] of entries) {
      if (in_window.has(base)) continue
      if (entry.state === `loading`) {
        if (base === background) continue
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
  }

  // Make the windows the loaded frames (see release), then start their loads (the shown
  // frames first)
  const show = (current: typeof cache, windows: FrameWindow[]): void => {
    // each window's first frame, then each one's second and so on (a stable sort)
    const loads = windows
      .flatMap(([series, window]) =>
        window
          .filter((idx) => in_range(series, idx))
          .map((idx, rank) => ({ series, idx, rank })),
      )
      .toSorted((lhs, rhs) => lhs.rank - rhs.rank)
    current.in_window = new Set(loads.map(({ series, idx }) => series.frames[idx]))
    const shown = windows.flatMap(([series, [first]]) =>
      in_range(series, first) ? [series.frames[first]] : [],
    )
    const older = current.recent.filter((frame) => !shown.includes(frame))
    current.recent = [...shown, ...older].slice(0, RECENT_FRAMES)
    current.shown = new Set(shown)
    release(current)
    for (const frame of shown) report(current, frame)
    for (const { series, idx } of loads) start(current, series, idx)
  }

  return {
    // The frame with whatever its loader returned merged in
    frame(series: SweepSeries, idx: number): SweepFrame {
      const base = series.frames[idx]
      const data = entry_of(base)?.data
      return data ? merge_frame(base, data) : base
    },
    // Whether the frame has all its data: true without a loader or once its load settled
    // (false again once evicted)
    is_ready(series: SweepSeries, idx: number): boolean {
      if (!cache.loader || !in_range(series, idx)) return true
      const state = entry_of(series.frames[idx])?.state
      return state === `loaded` || state === `failed`
    },
    is_loading: (series: SweepSeries, idx: number): boolean =>
      entry_of(series.frames[idx])?.state === `loading`,
    // Whether the frame's load settled once: loaded, failed, or loaded and since evicted (its
    // light fields kept), so loading it again would add no light field. True without a loader.
    is_settled(series: SweepSeries, idx: number): boolean {
      if (!cache.loader || !in_range(series, idx)) return true
      const entry = entry_of(series.frames[idx])
      return entry !== undefined && (entry.state !== `loading` || entry.data !== undefined)
    },
    // Make the windows' frames (one per shown series: its shown frame, then the neighbours to
    // prefetch; indices outside the series skipped) the loaded frames: start each one's load
    // unless loaded, loading or failed, abort the others' and evict their data (see
    // RECENT_FRAMES). No-op without a loader. Call from an effect or event handler, never while
    // deriving: the effect reruns when the cache is replaced (a new sweep or loader) or another
    // frame takes a window index, not on each load it starts or settles.
    request(...windows: [FrameWindow, ...FrameWindow[]]): void {
      const current = cache
      for (const [series, window] of windows) {
        for (const idx of window) void series.frames[idx]
      }
      untrack(() => show(current, windows))
    },
    // Load `target` in the background (none: stop), one frame at a time at the lowest priority:
    // it starts once a request named the windows and none of their frames is loading, and is
    // not aborted for being outside them. A previous background frame is released like any
    // frame outside the windows: aborted while loading, evicted once loaded (light fields
    // kept). Only the first failure of the background frame (the one last passed here, also
    // when a window started its load) is reported at once, the others once their frame shows.
    // Call from an effect, which reruns when the windows' loads settle so a waiting target
    // starts then.
    load_background(target?: FrameRef): void {
      const current = cache
      const base = target && in_range(...target) ? target[0].frames[target[1]] : undefined
      const busy = [...current.in_window].some((frame) => entry_of(frame)?.state === `loading`)
      untrack(() => {
        current.background = base
        release(current)
        if (target && base && current.in_window.size > 0 && !busy) start(current, ...target)
      })
    },
  }
}
