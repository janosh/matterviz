import { create_settling_tween } from '$lib/plot/core/utils'
import { flushSync } from 'svelte'
import { describe, expect, test } from 'vitest'

// Long enough that any animated step is still far from its target when we assert.
const SLOW = { duration: 60_000 }

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
  test(`shows its seed, snaps the first change, animates later ones`, () => {
    with_tween(0, (tween) => {
      expect(tween.current).toBe(0)
      tween.set_target(0) // no-op, e.g. the first effect run after mount
      expect(tween.current).toBe(0)
      tween.set_target(10) // the plot settling on its measured size
      expect(tween.current).toBe(10)
      tween.set_target(20) // a genuine data change
      expect(tween.current).not.toBe(20)
    })
  })

  test(`repeated equal targets never restart an in-flight tween`, () => {
    with_tween(0, (tween) => {
      tween.set_target(10) // snapped
      tween.set_target(20) // animating
      const mid_flight = tween.current
      tween.set_target(20)
      tween.set_target(20)
      expect(tween.current).toBe(mid_flight)
    })
  })

  // ScatterPoint rebuilds its {x, y} target object on every render, so without a structural
  // check every unrelated re-render would restart the tween.
  test(`honours a custom equality check across fresh objects`, () => {
    with_tween(
      { x: 0 },
      (tween) => {
        tween.set_target({ x: 1 }) // snapped
        tween.set_target({ x: 2 }) // animating
        const mid_flight = tween.current.x
        tween.set_target({ x: 2 })
        expect(tween.current.x).toBe(mid_flight)
      },
      (left, right) => left.x === right.x,
    )
  })
})
