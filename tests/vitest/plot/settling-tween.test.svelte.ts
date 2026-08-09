import { create_settling_tween, SETTLE_MS } from '$lib/plot/core/utils'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// Long enough that any animated step is still far from its target when we assert.
const SLOW = { duration: 60_000 }

// Only `performance` is faked, and from before the tween is created so its settle deadline
// is on the same clock. Everything else (the tween's own rAF loop) stays real.
beforeEach(() => vi.useFakeTimers({ toFake: [`performance`] }))
afterEach(() => vi.useRealTimers())
const settle = () => vi.advanceTimersByTime(SETTLE_MS + 1)

const with_tween = <T>(
  initial: T,
  run: (tween: ReturnType<typeof create_settling_tween<T>>) => void,
  is_same?: (left: T, right: T) => boolean,
) => {
  const dispose = $effect.root(() => run(create_settling_tween(initial, SLOW, is_same)))
  flushSync()
  dispose()
}

describe(`create_settling_tween`, () => {
  // The rule is a time window, not a call count: however many layout corrections a plot
  // needs to resolve its geometry, none of them animate, and a later data change still does.
  test(`shows its seed, snaps while settling, animates afterwards`, () => {
    with_tween(0, (tween) => {
      expect(tween.current).toBe(0)
      tween.set_target(0) // no-op, e.g. the first effect run after mount
      expect(tween.current).toBe(0)
      tween.set_target(10) // the plot settling on its measured size
      expect(tween.current).toBe(10)
      tween.set_target(20) // a second correction (font metrics, axis width)
      expect(tween.current).toBe(20)
      settle()
      tween.set_target(30) // a genuine data change
      expect(tween.current).not.toBe(30)
    })
  })

  test(`repeated equal targets never restart an in-flight tween`, () => {
    with_tween(0, (tween) => {
      settle()
      tween.set_target(20) // animating
      const mid_flight = tween.current
      expect(mid_flight).not.toBe(20) // else the assertion below would hold either way
      tween.set_target(20)
      tween.set_target(20)
      expect(tween.current).toBe(mid_flight)
    })
  })

  // Callers pass options per call, not at construction, so an interaction that retargets on
  // every pointer frame (ScatterPlot's shift-drag pan) can drop the animation while it lasts.
  test(`per-call options override the construction options`, () => {
    with_tween(0, (tween) => {
      settle()
      tween.set_target(10, { duration: 0 })
      expect(tween.current).toBe(10) // snapped despite SLOW
      tween.set_target(20) // interaction over, back to the construction options
      expect(tween.current).not.toBe(20)
    })
  })

  // ScatterPoint rebuilds its {x, y} target object on every render, so without a structural
  // check every unrelated re-render would restart the tween.
  test(`honours a custom equality check across fresh objects`, () => {
    with_tween(
      { x: 0 },
      (tween) => {
        settle()
        tween.set_target({ x: 2 }) // animating
        const mid_flight = tween.current.x
        expect(mid_flight).not.toBe(2)
        tween.set_target({ x: 2 })
        expect(tween.current.x).toBe(mid_flight)
      },
      (left, right) => left.x === right.x,
    )
  })
})
