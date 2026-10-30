// Tween that snaps while a plot is still settling and animates genuine changes after.

import { untrack } from 'svelte'
import { prefersReducedMotion, Tween, type TweenOptions } from 'svelte/motion'

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
    enabled,
  }: {
    // Options for this update alone, e.g. dropping the animation while a pan drag is live.
    live?: () => TweenOptions<T> | undefined
    // False skips the tween altogether, reading no source and writing nothing, for callers
    // that draw `source` directly meanwhile (`current` goes stale). The first update once it
    // is true again snaps, rather than animating from wherever the tween was left.
    enabled?: () => boolean
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
  // A snapped value, else the tween's. A snap writes this alone: Tween.set writes its target
  // and current and aborts its task, which every Line and marker of a plot pays per update.
  // Snaps leave the tween behind, so an animation first jumps it to the snapped value.
  let snapped = $state.raw<{ value: T } | null>({ value: target })

  let stale = false

  $effect.pre(() => {
    if (enabled && !enabled()) {
      stale = true
      return
    }
    const value = source()
    if (!stale && is_same(target, value)) return
    target = value
    // Reduced motion snaps like the settling window, overriding any `live` duration
    const options =
      stale || performance.now() < settled_at || prefersReducedMotion.current
        ? { duration: 0 }
        : live?.()
    stale = false
    if ((options?.duration ?? defaults.duration) === 0) {
      if (!snapped) void tween.set(value, { duration: 0 }) // stops a running animation
      snapped = { value }
      return
    }
    if (snapped) void tween.set(snapped.value, { duration: 0 })
    snapped = null
    void tween.set(value, options)
  })

  return {
    get current() {
      return snapped ? snapped.value : tween.current
    },
  }
}
