import type { AxisConfig } from '$lib/plot'
import { category_tick_labels, create_axis_loader } from '$lib/plot/core/axis-utils'
import { describe, expect, test, vi } from 'vitest'

describe(`create_axis_loader`, () => {
  test.each([`x`, `x2`, `y`, `y2`] as const)(
    `returns data for %s without owning caller state`,
    async (axis) => {
      const result = Object.freeze({ series: Object.freeze([{ x: [1], y: [2] }]) })
      const load = vi.fn().mockResolvedValue(result)
      const loader = create_axis_loader(load)
      expect(await loader.load(axis, `energy`)).toBe(result)
      expect(load).toHaveBeenCalledWith(axis, `energy`, expect.any(AbortSignal))
    },
  )

  test.each([`supersede`, `cancel`] as const)(
    `%s suppresses stale results even when the loader ignores abort`,
    async (action) => {
      const pending = Promise.withResolvers<number>()
      const signals: AbortSignal[] = []
      const loader = create_axis_loader((_axis, key, signal) => {
        signals.push(signal)
        return key === `slow` ? pending.promise : Promise.resolve(2)
      })
      const first = loader.load(`x`, `slow`)
      if (action === `supersede`) expect(await loader.load(`x`, `fast`)).toBe(2)
      else loader.cancel()
      expect(signals[0].aborted).toBe(true)
      pending.resolve(1)
      expect(await first).toBeUndefined()
      expect(await loader.load(`x`, `fast`)).toBe(2)
    },
  )

  test(`a load started synchronously by an abort handler remains the latest request`, async () => {
    const pending = Promise.withResolvers<number>()
    let restarted: Promise<number | undefined> | undefined
    const load = vi.fn((_axis, key: string, signal: AbortSignal): Promise<number> => {
      if (key === `old`) {
        signal.addEventListener(`abort`, () => {
          restarted = loader.load(`x`, `restarted`)
        })
        return pending.promise
      }
      return Promise.resolve(3)
    })
    const loader = create_axis_loader(load)
    const old = loader.load(`x`, `old`)
    expect(await loader.load(`x`, `superseded`)).toBeUndefined()
    expect(await restarted).toBe(3)
    expect(load.mock.calls.map(([, key]) => key)).toEqual([`old`, `restarted`])
    pending.resolve(1)
    expect(await old).toBeUndefined()
  })

  test(`axes load independently and cancel aborts every pending axis`, async () => {
    const pending = { x: Promise.withResolvers<string>(), y: Promise.withResolvers<string>() }
    const signals: AbortSignal[] = []
    const loader = create_axis_loader((axis, _key, signal) => {
      signals.push(signal)
      return pending[axis as `x` | `y`].promise
    })
    const x_load = loader.load(`x`, `energy`)
    const y_load = loader.load(`y`, `volume`)
    pending.y.resolve(`volume`)
    expect(await y_load).toBe(`volume`)
    expect(signals[0].aborted).toBe(false)
    pending.x.resolve(`energy`)
    expect(await x_load).toBe(`energy`)
    const cancelled = [loader.load(`x`, `next`), loader.load(`y`, `next`)]
    loader.cancel()
    expect(signals.slice(2).every((signal) => signal.aborted)).toBe(true)
    expect(await Promise.all(cancelled)).toEqual([undefined, undefined])
  })

  test(`active failures reject; cancelled failures cannot overwrite newer state`, async () => {
    const pending = Promise.withResolvers<number>()
    const loader = create_axis_loader(() => pending.promise)
    const first = loader.load(`x`, `old`)
    loader.cancel()
    pending.reject(new Error(`cancelled request`))
    expect(await first).toBeUndefined()
    await expect(loader.load(`y`, `new`)).rejects.toThrow(`cancelled request`)
  })
})

test.each<[string, string[], AxisConfig[`ticks`], AxisConfig[`ticks`]]>([
  [`no categories`, [], 5, undefined],
  [`index -> name by default`, [`A`, `B`], undefined, { 0: `A`, 1: `B` }],
  [`a tick count is ignored`, [`A`, `B`], 7, { 0: `A`, 1: `B` }],
  [`tick positions are ignored`, [`A`, `B`], [0, 1], { 0: `A`, 1: `B` }],
  [`a label mapping wins`, [`A`, `B`], { 0: `first` }, { 0: `first` }],
])(`category_tick_labels: %s`, (_name, categories, user_ticks, expected) => {
  expect(category_tick_labels(categories, user_ticks)).toEqual(expected)
})
