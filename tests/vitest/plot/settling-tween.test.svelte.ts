import { ScatterPoint } from '$lib'
import type { Point2D } from '$lib/math'
import { create_settling_tween, SETTLE_MS } from '$lib/plot/core/settling-tween.svelte'
import { flushSync, mount, unmount } from 'svelte'
import type { TweenOptions } from 'svelte/motion'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { translate_of } from '../setup'

// Long enough that any animated step is still far from its target when we assert.
const SLOW = { duration: 60_000 }

// Only `performance` is faked, and from before the tween is created so its settle deadline
// is on the same clock. Everything else (the tween's own rAF loop) stays real.
beforeEach(() => vi.useFakeTimers({ toFake: [`performance`] }))
afterEach(() => vi.useRealTimers())
const settle = () => vi.advanceTimersByTime(SETTLE_MS + 1)

// Drives the tween the way a component does — through its reactive source — rather than
// calling into it, so the tests exercise the same path production takes.
const with_tween = <T>(
  initial: T,
  run: (ctx: {
    tween: { readonly current: T }
    set: (value: T) => void
    set_live: (live: TweenOptions<T> | undefined) => void
    // How many times the tween actually retargeted. The live getter is consulted once per
    // retarget and only after the settle window, which makes skipped updates observable —
    // `current` alone can't show them, since it moves on rAF rather than synchronously.
    retargets: () => number
  }) => void,
  {
    is_same,
    defaults = SLOW,
  }: {
    is_same?: (left: T, right: T) => boolean
    defaults?: TweenOptions<T>
  } = {},
) => {
  const store = $state<{ value: T; live: TweenOptions<T> | undefined }>({
    value: initial,
    live: undefined,
  })
  let retargets = 0
  let tween: { readonly current: T } | undefined
  const dispose = $effect.root(() => {
    tween = create_settling_tween(() => store.value, defaults, {
      live: () => {
        retargets += 1
        return store.live
      },
      is_same,
    })
  })
  flushSync()
  if (!tween) throw new Error(`create_settling_tween returned nothing`)
  run({
    tween,
    set: (value) => {
      store.value = value
      flushSync()
    },
    set_live: (live) => (store.live = live),
    retargets: () => retargets,
  })
  dispose()
}

describe(`create_settling_tween`, () => {
  // The rule is a time window, not a call count: however many layout corrections a plot
  // needs to resolve its geometry, none of them animate, and a later data change still does.
  test(`shows its seed, snaps while settling, animates afterwards`, () => {
    with_tween(0, ({ tween, set }) => {
      expect(tween.current).toBe(0)
      set(0) // no-op, e.g. the first effect run after mount
      expect(tween.current).toBe(0)
      set(10) // the plot settling on its measured size
      expect(tween.current).toBe(10)
      set(20) // a second correction (font metrics, axis width)
      expect(tween.current).toBe(20)
      settle()
      set(30) // a genuine data change
      expect(tween.current).not.toBe(30)
    })
  })

  // Options vary per update, not per tween, so an interaction that retargets on every pointer
  // frame (ScatterPlot's pan) can drop the animation for as long as it lasts and restore it.
  test(`live options override the defaults for that update only`, () => {
    with_tween(0, ({ tween, set, set_live }) => {
      settle()
      set_live({ duration: 0 })
      set(10)
      expect(tween.current).toBe(10) // snapped despite the SLOW defaults
      set_live(undefined)
      set(20)
      expect(tween.current).not.toBe(20) // interaction over, animating again
    })
  })

  // Tween.set merges live options over the defaults, so a duration in the defaults is what a
  // live option that omits one falls back to. That is why callers hand over only their static
  // options: a ScatterPoint mounted in canvas marker mode, or a Line over its morph budget,
  // would otherwise park `duration: 0` there and never animate again.
  test(`a live option that omits duration falls back to the default`, () => {
    with_tween(
      0,
      ({ tween, set, set_live }) => {
        settle()
        set(10)
        expect(tween.current).toBe(10) // snapped: the default duration is 0
        set_live(SLOW)
        set(20)
        expect(tween.current).not.toBe(20) // an explicit live duration still animates
      },
      { defaults: { duration: 0 } },
    )
  })

  // ScatterPoint rebuilds its {x, y} target object on every render, so without a structural
  // check every unrelated re-render would restart the tween.
  test(`honours a custom equality check across fresh objects`, () => {
    with_tween(
      { x: 0 },
      ({ tween, set, retargets }) => {
        settle()
        set({ x: 2 }) // animating
        expect(retargets()).toBe(1)
        const mid_flight = tween.current.x
        expect(mid_flight).not.toBe(2) // else the assertion below would hold either way
        set({ x: 2 }) // fresh objects, same content
        set({ x: 2 })
        expect(retargets()).toBe(1) // neither restarted the tween
        expect(tween.current.x).toBe(mid_flight)
      },
      { is_same: (left, right) => left.x === right.x },
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
    const marker_x = () => translate_of(target.querySelector(`g`)).x
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
