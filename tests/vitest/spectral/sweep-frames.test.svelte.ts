// Sweep frame cache (spectral/sweep-frames): loads on request, once per frame and sweep
import type { Sweep, SweepFrameLoader } from '#lib/spectral/sweep.js'
import { create_sweep_frames } from '#lib/spectral/sweep-frames.svelte.js'
import { flushSync } from 'svelte'
import { expect, onTestFinished, test, vi } from 'vitest'

type FrameData = Awaited<ReturnType<SweepFrameLoader>>

const make_sweep = (): Sweep => ({
  axis: { key: `pressure`, label: `Pressure`, unit: `GPa` },
  series: [{ id: `fcc`, frames: [{ value: 0 }, { value: 50 }, { value: 100 }] }],
})
// A loader whose calls settle when the test says, recording which frames were asked for
function deferred_loader() {
  const calls: {
    args: [string, number]
    resolve: (data: FrameData) => void
    reject: (error: Error) => void
  }[] = []
  const load: SweepFrameLoader = vi.fn(
    (series_id: string, frame_idx: number) =>
      new Promise<FrameData>((resolve, reject) => {
        calls.push({ args: [series_id, frame_idx], resolve, reject })
      }),
  )
  return { load, calls }
}
// The cache under a reactive root, with its inputs as state the test can swap
function setup(loader?: SweepFrameLoader) {
  const inputs = $state({ sweep: make_sweep(), loader })
  const on_error = vi.fn()
  let frames: ReturnType<typeof create_sweep_frames> | undefined
  const cleanup = $effect.root(() => {
    frames = create_sweep_frames({
      sweep: () => inputs.sweep,
      load_frame: () => inputs.loader,
      on_error,
    })
  })
  onTestFinished(cleanup)
  if (!frames) throw new Error(`cache not created`)
  return { frames, inputs, on_error }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test(`without a loader every frame is ready as given and requests do nothing`, () => {
  const { frames, inputs } = setup()
  const series = inputs.sweep.series[0]
  frames.request(series, 0)
  expect(frames.is_ready(series, 0)).toBe(true)
  expect(frames.is_loading(series, 0)).toBe(false)
  expect(frames.frame(series, 1)).toBe(series.frames[1])
})

test(`a requested frame loads once, merged over its own fields (scalars and status per key)`, async () => {
  const { load, calls } = deferred_loader()
  const { frames, inputs } = setup(load)
  const series = inputs.sweep.series[0]
  frames.request(series, 1)
  frames.request(series, 1) // already loading
  expect(load).toHaveBeenCalledOnce()
  expect(load).toHaveBeenCalledWith(`fcc`, 1)
  expect(frames.is_loading(series, 1)).toBe(true)
  expect(frames.is_ready(series, 1)).toBe(false)
  // frames outside the series are ready (playback never waits on them) and never loaded
  frames.request(series, 3)
  expect(frames.is_ready(series, 3)).toBe(true)
  expect(load).toHaveBeenCalledOnce()

  // the frame's own scalars and status survive, merged key by key under the loaded ones
  series.frames[1] = {
    value: 50,
    scalars: { volume: 9, tc: 1 },
    status: { note: `relaxed` },
  }
  calls[0].resolve({ label: `loaded`, scalars: { tc: 12 }, status: { unstable: true } })
  await settle()
  flushSync()
  expect(frames.is_ready(series, 1)).toBe(true)
  expect(frames.is_loading(series, 1)).toBe(false)
  const loaded = frames.frame(series, 1)
  expect(loaded).toEqual({
    value: 50,
    label: `loaded`,
    scalars: { volume: 9, tc: 12 },
    status: { note: `relaxed`, unstable: true },
  })
  expect(frames.frame(series, 1)).toBe(loaded) // merged once: one identity across reads
  frames.request(series, 1) // loaded
  expect(load).toHaveBeenCalledOnce()
})

test(`a failed load is reported once, counts as ready and is not retried`, async () => {
  const { load, calls } = deferred_loader()
  const { frames, inputs, on_error } = setup(load)
  const series = inputs.sweep.series[0]
  frames.request(series, 2)
  calls[0].reject(new Error(`cluster unreachable`))
  await settle()
  flushSync()
  expect(on_error).toHaveBeenCalledExactlyOnceWith(
    `Loading frame 3 of series "fcc" failed: cluster unreachable`,
  )
  expect(frames.is_ready(series, 2)).toBe(true)
  frames.request(series, 2)
  expect(load).toHaveBeenCalledOnce()
  expect(frames.frame(series, 2)).toBe(series.frames[2])
})

test(`a new sweep starts a fresh cache, ignoring loads still running for the old one`, async () => {
  const { load, calls } = deferred_loader()
  const { frames, inputs, on_error } = setup(load)
  const old_series = inputs.sweep.series[0]
  frames.request(old_series, 0)
  frames.request(old_series, 1)
  calls[0].resolve({ label: `old 0` })
  await settle()
  flushSync()
  expect(frames.frame(old_series, 0).label).toBe(`old 0`)

  inputs.sweep = make_sweep()
  flushSync()
  const series = inputs.sweep.series[0]
  expect(frames.frame(series, 0).label).toBeUndefined() // dropped with the old cache
  calls[1].resolve({ label: `old 1` }) // lands in the old cache
  calls.length = 0
  await settle()
  flushSync()
  expect(frames.frame(series, 1).label).toBeUndefined()
  frames.request(series, 0) // loads again for the new sweep
  expect(load).toHaveBeenCalledTimes(3)
  expect(calls[0].args).toEqual([`fcc`, 0])
  expect(on_error).not.toHaveBeenCalled()
})
