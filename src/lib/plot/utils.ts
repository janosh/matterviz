import type { TweenOptions } from 'svelte/motion'

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

export function calc_auto_range(values: number[]): [number, number] {
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
