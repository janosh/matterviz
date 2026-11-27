// Opt-in transport and playback telemetry for host-served trajectories (VS Code setting
// matterviz.telemetry). The webview aggregates frame round trips, wire bytes, decode time and
// displayed frames into periodic summaries and posts them to the host, which logs each as one
// JSON line in its MatterViz output channel. Over Remote-SSH the extension host runs on the
// remote machine, so these numbers separate host reads, the network and webview rendering.
// Free of DOM and Svelte imports, like host-bridge.ts which records into it.

import type { PrepareTiming } from '#lib/trajectory/prepare-pool'

interface FrameSample {
  idx: number
  // request posted -> response received, as the webview sees it
  rtt_ms: number
  // host-side source read and wire encoding, reported in the frame_response
  host_read_ms?: number
  host_encode_ms?: number
  wire_bytes: number
  // other frame requests unanswered when this one was posted
  in_flight: number
}

export type TelemetryRecord = Record<string, unknown> & { kind: string }

const FLUSH_INTERVAL_MS = 2000

const quantile = (sorted: number[], fraction: number): number | undefined =>
  sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
    : undefined
const round = (value: number | undefined, digits = 2): number | undefined =>
  value === undefined || !Number.isFinite(value) ? undefined : Number(value.toFixed(digits))
const stats = (values: number[]): Record<string, number | undefined> => {
  const sorted = values.toSorted((val_a, val_b) => val_a - val_b)
  const mean = sorted.reduce((sum, value) => sum + value, 0) / (sorted.length || 1)
  return {
    p50: round(quantile(sorted, 0.5)),
    p95: round(quantile(sorted, 0.95)),
    mean: round(mean),
  }
}

export interface PlaybackTelemetry {
  readonly enabled: boolean
  frame: (sample: FrameSample) => void
  // a frame decoded on the main thread (prepared frames decode in their worker, see prepared)
  decoded: (ms: number) => void
  // display preparation of a received frame in a worker (see prepare-pool.ts)
  prepared: (timing: PrepareTiming) => void
  shown: (idx: number) => void
  // the time between two animation frames: above the display's refresh interval when the main
  // thread (or the GPU) can't keep up
  animation_frame: (interval_ms: number) => void
  long_task: (duration_ms: number) => void
  event: (record: TelemetryRecord) => void
  // other frame requests currently unanswered
  in_flight: () => number
  track_request: () => () => void
  flush: () => void
}

export const create_playback_telemetry = (
  post: ((record: TelemetryRecord) => void) | null,
  now: () => number = () => performance.now(),
): PlaybackTelemetry => {
  let frames: FrameSample[] = []
  let prepared: PrepareTiming[] = []
  let decode_ms: number[] = []
  let frame_intervals: number[] = []
  let long_task_ms = 0
  let shown_at: number[] = []
  // response arrival per frame index, so a shown frame reports how long it sat buffered
  const received_at = new Map<number, number>()
  let buffered_ms: number[] = []
  let window_start = now()
  let first_shown_ms: number | undefined
  let pending = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const schedule = (): void => {
    if (post && timer === undefined) timer = setTimeout(flush, FLUSH_INTERVAL_MS)
  }
  function flush(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (!post || (frames.length === 0 && shown_at.length === 0)) return
    const end = now()
    const window_s = (end - window_start) / 1000
    const wire_bytes = frames.reduce((sum, frame) => sum + frame.wire_bytes, 0)
    // displayed rate from first to last display in the window, not the window length, so an
    // idle tail after playback ends doesn't dilute it
    const span_s = ((shown_at.at(-1) ?? 0) - (shown_at[0] ?? 0)) / 1000
    const host = (key: `host_read_ms` | `host_encode_ms`) =>
      stats(frames.flatMap((frame) => (frame[key] === undefined ? [] : [frame[key]])))
    post({
      kind: `playback`,
      window_s: round(window_s),
      frames_received: frames.length,
      frames_shown: shown_at.length,
      shown_fps: span_s > 0 ? round((shown_at.length - 1) / span_s) : undefined,
      received_fps: round(frames.length / window_s),
      wire_mb: round(wire_bytes / 1e6, 3),
      wire_bytes_per_frame: frames.length ? Math.round(wire_bytes / frames.length) : undefined,
      wire_mbit_s: round((wire_bytes * 8) / 1e6 / window_s),
      rtt_ms: stats(frames.map((frame) => frame.rtt_ms)),
      host_read_ms: host(`host_read_ms`),
      host_encode_ms: host(`host_encode_ms`),
      decode_ms: stats(decode_ms),
      prepare_ms: stats(prepared.map((timing) => timing.prepare_ms)),
      prepare_wait_ms: stats(prepared.map((timing) => timing.wait_ms)),
      buffered_ms: stats(buffered_ms),
      animation_frame_ms: stats(frame_intervals),
      // share of the window the main thread spent in tasks of 50 ms or more
      long_task_share: round(long_task_ms / (end - window_start), 3),
      max_in_flight: Math.max(0, ...frames.map((frame) => frame.in_flight)),
    })
    frames = []
    prepared = []
    decode_ms = []
    frame_intervals = []
    long_task_ms = 0
    shown_at = []
    buffered_ms = []
    window_start = end
  }

  return {
    enabled: post !== null,
    frame: (sample) => {
      if (!post) return
      frames.push(sample)
      received_at.set(sample.idx, now())
      schedule()
    },
    // only while this window shows frames: a paused viewer neither grows the samples nor
    // reports its idle refresh rate as playback cadence
    animation_frame: (interval_ms) => {
      if (post && shown_at.length > 0) frame_intervals.push(interval_ms)
    },
    long_task: (duration_ms) => {
      if (post) long_task_ms += duration_ms
    },
    decoded: (ms) => {
      if (post) decode_ms.push(ms)
    },
    prepared: (timing) => {
      if (post) prepared.push(timing)
    },
    shown: (idx) => {
      if (!post) return
      const time = now()
      shown_at.push(time)
      const arrival = received_at.get(idx)
      if (arrival !== undefined) {
        buffered_ms.push(time - arrival)
        received_at.delete(idx)
      }
      if (first_shown_ms === undefined) {
        first_shown_ms = time
        post({ kind: `first_frame`, idx, since_navigation_ms: round(time) })
      }
      schedule()
    },
    event: (record) => post?.(record),
    in_flight: () => pending,
    track_request: () => {
      pending++
      let done = false
      return () => {
        if (!done) pending--
        done = true
      }
    },
    flush,
  }
}
