import { create_playback_telemetry, type TelemetryRecord } from '#lib/file-viewer/telemetry.js'
import { afterEach, expect, test, vi } from 'vite-plus/test'

afterEach(() => vi.useRealTimers())

const sample = (idx: number, rtt_ms: number) => ({
  idx,
  rtt_ms,
  host_read_ms: 1,
  host_encode_ms: 0.5,
  wire_bytes: 1000,
  in_flight: idx,
})

test(`summarizes received and displayed frames per window, then starts a new window`, () => {
  vi.useFakeTimers()
  let clock = 0
  const records: TelemetryRecord[] = []
  const telemetry = create_playback_telemetry(
    (record) => records.push(record),
    () => clock,
  )
  expect(telemetry.enabled).toBe(true)
  telemetry.animation_frame(1000) // paused, nothing shown yet: not a playback cadence
  // frames arrive 100 ms apart, each shown 20 ms after it arrived: 10 fps over 1 s
  for (let idx = 0; idx < 11; idx++) {
    clock = idx * 100
    telemetry.frame(sample(idx, 50 + idx))
    telemetry.prepared({ prepare_ms: 30 + idx, wait_ms: 2 })
    telemetry.decoded(2)
    telemetry.animation_frame(100)
    if (idx === 5) telemetry.long_task(500)
    clock += 20
    telemetry.shown(idx)
  }
  clock = 2000
  vi.advanceTimersByTime(2000)
  const [first_frame, playback] = records
  expect(first_frame).toEqual({ kind: `first_frame`, idx: 0, since_navigation_ms: 20 })
  expect(playback).toMatchObject({
    kind: `playback`,
    window_s: 2,
    frames_received: 11,
    frames_shown: 11,
    shown_fps: 10,
    wire_bytes_per_frame: 1000,
    wire_mbit_s: 0.04, // 11 kB * 8 / 2 s
    rtt_ms: { p50: 55, p95: 60 },
    prepare_ms: { p50: 35, p95: 40, mean: 35 },
    prepare_wait_ms: { p50: 2, mean: 2 },
    decode_ms: { p50: 2, mean: 2 },
    animation_frame_ms: { p50: 100, mean: 100 },
    long_task_share: 0.25, // 500 ms of a 2 s window
    buffered_ms: { p50: 20, p95: 20, mean: 20 },
    max_in_flight: 10,
  })
  // nothing new: no empty record
  telemetry.flush()
  expect(records).toHaveLength(2)
})

test(`a disabled collector posts nothing and tracks nothing`, () => {
  const telemetry = create_playback_telemetry(null)
  telemetry.frame(sample(0, 1))
  telemetry.prepared({ prepare_ms: 1, wait_ms: 1 })
  telemetry.shown(0)
  telemetry.flush()
  expect(telemetry.enabled).toBe(false)
})

test(`track_request counts each unanswered request once`, () => {
  const telemetry = create_playback_telemetry(() => {})
  const settle_a = telemetry.track_request()
  const settle_b = telemetry.track_request()
  expect(telemetry.in_flight()).toBe(2)
  settle_a()
  settle_a()
  expect(telemetry.in_flight()).toBe(1)
  settle_b()
  expect(telemetry.in_flight()).toBe(0)
})
