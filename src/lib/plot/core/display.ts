import type { DisplayConfig } from './types'

const category_zero_keys = {
  x: [`x_zero_line`, `x2_zero_line`],
  y: [`y_zero_line`, `y2_zero_line`],
} as const
const zero_line_keys = [...category_zero_keys.x, ...category_zero_keys.y]
type CategoryAxis = `x` | `y` | null
type CategoryZeroKey = (typeof zero_line_keys)[number]
type CategoryZeroSyncState = readonly [
  CategoryAxis,
  readonly CategoryZeroKey[],
  DisplayConfig?,
]

const at_zero_defaults = (display: DisplayConfig, defaults: DisplayConfig): boolean =>
  zero_line_keys.every((key) => (display[key] ?? false) === (defaults[key] ?? false))

// Merge library display defaults with caller overrides. When `category_axis` is set,
// category/slot zero lines stay off unless the bound `display` explicitly enables them
// (`?? false` so a defaults-merge can't resurrect zeros through the first category).
export const resolve_plot_display = (
  display: DisplayConfig,
  defaults: DisplayConfig,
  category_axis: CategoryAxis = null,
): DisplayConfig => {
  const resolved = { ...defaults, ...display }
  if (category_axis) {
    for (const key of category_zero_keys[category_axis]) {
      resolved[key] = display[key] ?? false
    }
  }
  return resolved
}

export const sync_category_zero_display = (
  display: DisplayConfig,
  defaults: DisplayConfig,
  category_axis: CategoryAxis,
  previous: CategoryZeroSyncState,
): CategoryZeroSyncState => {
  const [previous_axis, previous_disabled_keys, previous_display = display] = previous
  const same_display = previous_display === display
  if (same_display && category_axis === previous_axis) return previous

  if (same_display) for (const key of previous_disabled_keys) display[key] = defaults[key]

  if (
    category_axis == null ||
    ((!same_display || previous_axis == null) && !at_zero_defaults(display, defaults))
  )
    return [category_axis, [], display]

  const disabled_keys = category_zero_keys[category_axis].filter(
    (key) => display[key] !== false,
  )
  for (const key of disabled_keys) display[key] = false
  return [category_axis, disabled_keys, display]
}
