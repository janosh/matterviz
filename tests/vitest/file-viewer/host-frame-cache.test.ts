import { host_frame_cache } from '#lib/file-viewer/host-frame-cache.js'
import type { TrajectoryFrame } from '#lib/trajectory/index.js'
import { expect, test, vi } from 'vitest'

const frames = (start: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({ step: start + index }) as TrajectoryFrame)
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

test(`deduplicates batches, prefetches ahead, and clamps the last batch`, async () => {
  const request = vi.fn(async (start, count) => frames(start, count))
  const cache = host_frame_cache(5001, 160, 64, request)
  const result = await Promise.all([cache.read_frame(99), cache.read_frame(100)])
  expect(result.map((frame) => frame.step)).toEqual([99, 100])
  await settle()
  expect(request.mock.calls.map(([start, count]) => [start, count])).toEqual([
    [64, 64],
    [128, 64],
  ])
  await cache.read_frame(128)
  expect(request).toHaveBeenCalledTimes(2)
  expect((await cache.read_frame(5000)).step).toBe(5000)
  expect(request).toHaveBeenLastCalledWith(4992, 9, expect.any(AbortSignal))
  cache.dispose()
})

test(`bounds the cache and reduces batches for large atom counts`, async () => {
  const request = vi.fn(async (start, count) => frames(start, count))
  const cache = host_frame_cache(100, 25_000, 64, request)
  for (const index of [0, 2, 4, 6, 8]) await cache.read_frame(index)
  expect(request.mock.calls.every(([, count]) => count === 2)).toBe(true)
  await cache.read_frame(0)
  expect(request).toHaveBeenCalledTimes(6)
  cache.dispose()
})

test(`a cancelled reader does not cancel a shared batch; disposal does`, async () => {
  let finish!: (value: TrajectoryFrame[]) => void
  const request = vi.fn(
    (_start, _count, _signal) =>
      new Promise<TrajectoryFrame[]>((resolve) => {
        finish = resolve
      }),
  )
  const cache = host_frame_cache(100, 160, 64, request)
  const controller = new AbortController()
  const cancelled = cache.read_frame(1, controller.signal)
  const other = cache.read_frame(2)
  await Promise.resolve()
  controller.abort()
  await expect(cancelled).rejects.toMatchObject({ name: `AbortError` })
  expect(request.mock.calls[0][2].aborted).toBe(false)
  finish(frames(0, 64))
  expect((await other).step).toBe(2)
  expect(request).toHaveBeenCalledTimes(1)
  cache.dispose()
  expect(request.mock.calls[0][2].aborted).toBe(true)
  await expect(cache.read_frame(1)).rejects.toMatchObject({ name: `AbortError` })
})

test(`retries failed batches and rejects invalid indices`, async () => {
  const request = vi
    .fn(async (start, count) => frames(start, count))
    .mockRejectedValueOnce(new Error(`host failed`))
  const cache = host_frame_cache(100, 160, 64, request)
  await expect(cache.read_frame(1)).rejects.toThrow(`host failed`)
  expect((await cache.read_frame(1)).step).toBe(1)
  for (const index of [-1, 100, 1.5, NaN])
    await expect(cache.read_frame(index)).rejects.toThrow(/outside/)
  cache.dispose()
})
