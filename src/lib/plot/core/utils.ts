import type { Vec2 } from '$lib/math'
import { Tween, type TweenOptions } from 'svelte/motion'

// Unique DOM id token (for SVG clipPath/gradient ids, control `for`/`id` prefixes). Returns a
// fresh id on every call; callers should store it in a const (e.g. `const id = unique_id('foo')`)
// so it stays stable across re-renders. Pass a prefix for a readable `prefix-<uuid>`, or omit it
// when the caller adds its own prefix.
export const unique_id = (prefix = ``): string =>
  prefix ? `${prefix}-${crypto.randomUUID()}` : crypto.randomUUID()

// Path-morph (interpolatePath) tweening scales poorly with many simultaneously morphing
// <path> elements (band structures with 100+ bands) or a single very long line. Disable
// the morph above these budgets unless the caller explicitly opts into a tween.
export const LINE_TWEEN = { max_series: 16, max_points: 8000 }

export const resolve_line_tween = (
  line_tween: TweenOptions<string> | undefined,
  load: { series: number; points: number },
): TweenOptions<string> | undefined =>
  line_tween ??
  (load.series > LINE_TWEEN.max_series || load.points > LINE_TWEEN.max_points
    ? { duration: 0 }
    : undefined)

// How long after creation a tween treats target changes as the plot still settling.
// Generous on purpose: measured size, then font metrics, then axis widths can each move a
// path, and animating any of them flies the line in from somewhere it never was. Snapping a
// data change that lands inside the window only costs one missed animation.
export const SETTLE_MS = 500

// A Tween that snaps while the plot is still settling and animates genuine changes after.
// Svelte's Tween restarts on every `target` assignment even when the value is unchanged, and
// the assignments right after mount are the plot resolving its own geometry, not the data
// moving. The window is wall-clock rather than "the first change" so the outcome doesn't
// depend on how many layout corrections happen to land first.
export function create_settling_tween<T>(
  initial: T,
  options: TweenOptions<T>,
  is_same: (left: T, right: T) => boolean = Object.is,
): { readonly current: T; set_target: (value: T, live?: TweenOptions<T>) => void } {
  const tween = new Tween(initial, options)
  // Tracked here rather than read off tween.target, which is reactive state: reading it in
  // the caller's effect only to write it back makes the effect depend on itself.
  let target = initial
  const settled_at = performance.now() + SETTLE_MS
  return {
    get current() {
      return tween.current
    },
    // `live` overrides the construction options per call, so callers can drop the animation
    // for the duration of an interaction (see ScatterPlot's pan handling) and restore it after.
    set_target(value: T, live?: TweenOptions<T>) {
      if (is_same(target, value)) return
      target = value
      void tween.set(value, performance.now() < settled_at ? { duration: 0 } : live)
    },
  }
}

export function calc_auto_range(values: number[]): Vec2 {
  const finite_values = values.filter(Number.isFinite)
  if (finite_values.length === 0) return [0, 1]
  let [min_value, max_value] = [finite_values[0], finite_values[0]]
  for (const value of finite_values) {
    if (value < min_value) min_value = value
    else if (value > max_value) max_value = value
  }
  const padding = (max_value - min_value) * 0.05 || 0.5
  return [min_value - padding, max_value + padding]
}
