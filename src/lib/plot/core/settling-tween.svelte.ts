// Tween that snaps while a plot is still settling and animates genuine changes after.

import { untrack } from 'svelte'
import { Tween, type TweenOptions } from 'svelte/motion'

// How long after creation a change still counts as the plot resolving its own geometry rather
// than the data moving. Generous enough to cover a font load or a couple of layout passes; a
// data change that lands inside the window only costs one missed animation.
export const SETTLE_MS = 500

// Svelte's Tween restarts on every `target` assignment even when the value is unchanged, and
// the assignments right after mount are the plot resolving its own geometry, not the data
// moving. The window is wall-clock rather than "the first change" so the outcome doesn't
// depend on how many layout corrections happen to land first.
//
// Creates an $effect, so it must be called during component init. Seeding from `source` is
// what lets a plot appearing on screen draw itself where the data is rather than animating in
// from wherever the tween started.
export function create_settling_tween<T>(
  source: () => T,
  // Static only. Tween.set merges the per-update options over these, so a duration parked here
  // would outlive whatever condition set it — see `live` for anything that varies.
  defaults: TweenOptions<T>,
  {
    live,
    is_same = Object.is,
  }: {
    // Options for this update alone, e.g. dropping the animation while a pan drag is live.
    live?: () => TweenOptions<T> | undefined
    // Structural comparison for object targets, which are rebuilt on every render and would
    // otherwise restart the tween continuously.
    is_same?: (left: T, right: T) => boolean
  } = {},
): { readonly current: T } {
  // Plain, not read off tween.target: that is reactive state, and reading it in the effect
  // only to write it back would make the effect depend on itself.
  let target = untrack(source)
  const tween = new Tween(target, defaults)
  const settled_at = performance.now() + SETTLE_MS

  $effect.pre(() => {
    const value = source()
    if (is_same(target, value)) return
    target = value
    void tween.set(value, performance.now() < settled_at ? { duration: 0 } : live?.())
  })

  return {
    get current() {
      return tween.current
    },
  }
}
