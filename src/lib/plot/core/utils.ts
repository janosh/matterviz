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

// A Tween that snaps to its first target and animates only genuine changes afterwards.
// Svelte's Tween restarts on every `target` assignment even when the value is unchanged, and
// the first assignment after mount is the plot settling on its measured size, not the data
// moving. Both would animate markers and lines in from somewhere they never were.
export function create_settling_tween<T>(
  initial: T,
  options: TweenOptions<T>,
  is_same: (left: T, right: T) => boolean = Object.is,
): { readonly current: T; set_target: (value: T) => void } {
  const tween = new Tween(initial, options)
  // Tracked here rather than read off tween.target, which is reactive state: reading it in
  // the caller's effect only to write it back makes the effect depend on itself.
  let target = initial
  let settled = false
  return {
    get current() {
      return tween.current
    },
    set_target(value: T) {
      if (is_same(target, value)) return
      target = value
      void tween.set(value, settled ? undefined : { duration: 0 })
      settled = true
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
