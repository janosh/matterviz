import type { Vec2 } from '$lib/math'
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
const LINE_TWEEN = { max_series: 16, max_points: 8000 }

export const resolve_line_tween = (
  line_tween: TweenOptions<string> | undefined,
  load: { series: number; points: number },
): TweenOptions<string> | undefined =>
  line_tween ??
  (load.series > LINE_TWEEN.max_series || load.points > LINE_TWEEN.max_points
    ? { duration: 0 }
    : undefined)

export function calc_auto_range<Item>(
  items: Iterable<Item>,
  get_values: (item: Item) => Iterable<number>,
): Vec2 {
  let [min_value, max_value] = [Infinity, -Infinity]
  for (const item of items)
    for (const value of get_values(item)) {
      if (!Number.isFinite(value)) continue
      min_value = Math.min(min_value, value)
      max_value = Math.max(max_value, value)
    }
  if (min_value === Infinity) return [0, 1]
  const padding = (max_value - min_value) * 0.05 || 0.5
  return [min_value - padding, max_value + padding]
}

// Attachment factory reporting an element's rendered size (immediately, on resize, and zeroed
// on unmount) without an extra measuring wrapper div. The element is passed along for callers
// that also read its computed style.
export const observe_size =
  <El extends Element>(
    on_size: (size: { height: number; width: number }, element: El) => void,
  ) =>
  (element: El) => {
    const update = () =>
      on_size({ height: element.clientHeight, width: element.clientWidth }, element)
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => {
      observer.disconnect()
      on_size({ height: 0, width: 0 }, element)
    }
  }
