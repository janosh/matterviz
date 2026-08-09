import { ScatterPoint } from '$lib'
import type { Point2D } from '$lib/math'
import { create_settling_tween, SETTLE_MS } from '$lib/plot/core/utils'
import { flushSync, mount, unmount } from 'svelte'
import type { TweenOptions } from 'svelte/motion'
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

  // Tween.set merges per-call options over the construction ones, so a duration captured at
  // construction is what a `live` that omits one falls back to. That is why callers hand over
  // only their static defaults: ScatterPoint mounted during canvas marker mode, or a Line over
  // its morph budget, would otherwise bake in `duration: 0` and never animate again.
  test(`a live option that omits duration falls back to the construction default`, () => {
    const dispose = $effect.root(() => {
      const tween = create_settling_tween(0, { duration: 0 })
      settle()
      tween.set_target(10)
      expect(tween.current).toBe(10) // snapped: no live duration, construction default is 0
      tween.set_target(20, SLOW)
      expect(tween.current).not.toBe(20) // an explicit live duration still animates
    })
    flushSync()
    dispose()
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

  // The caller half of the contract above: whatever `point_tween` happens to be at mount must
  // not become the tween's fallback duration. A plot in canvas marker mode passes
  // `{ duration: 0 }`, and the SVG overlay points mounted then have to animate again once it
  // switches back and stops passing anything.
  test(`ScatterPoint still animates after mounting with a zero-duration tween`, () => {
    const props = $state<{ x: number; y: number; point_tween?: TweenOptions<Point2D> }>({
      x: 100,
      y: 100,
      point_tween: { duration: 0 },
    })
    const target = document.createElement(`div`)
    document.body.append(target)
    const component = mount(ScatterPoint, { target, props })
    const marker_x = () =>
      Number(
        /translate\((?<x>[-\d.]+)/.exec(
          target.querySelector(`g`)?.getAttribute(`transform`) ?? ``,
        )?.groups?.x,
      )
    flushSync()
    expect(marker_x()).toBe(100)

    settle() // past the window in which every change snaps regardless
    props.point_tween = undefined // canvas mode over: back to the component's own default
    props.x = 300
    flushSync()

    expect(marker_x()).toBe(100) // still animating from the seed, not jumped to the target
    void unmount(component)
    target.remove()
  })
})
