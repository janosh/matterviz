import type { DisplayConfig } from './types'

const category_zero_keys = {
  x: [`x_zero_line`, `x2_zero_line`],
  y: [`y_zero_line`, `y2_zero_line`],
} as const
const zero_line_keys = [...category_zero_keys.x, ...category_zero_keys.y]

const at_zero_defaults = (display: DisplayConfig, defaults: DisplayConfig): boolean =>
  zero_line_keys.every((key) => (display[key] ?? false) === (defaults[key] ?? false))

// Merge library display defaults with caller overrides. When `category_axis` is set,
// category/slot zero lines stay off unless the bound `display` explicitly enables them
// (`?? false` so a defaults-merge can't resurrect zeros through the first category).
export const resolve_plot_display = (
  display: DisplayConfig,
  defaults: DisplayConfig,
  category_axis: `x` | `y` | null = null,
): DisplayConfig => {
  const resolved = { ...defaults, ...display }
  if (category_axis) {
    for (const key of category_zero_keys[category_axis]) {
      resolved[key] = display[key] ?? false
    }
  }
  return resolved
}

// Keep bound `display` category-zero flags aligned with rendering when the plot starts at
// library defaults or the category axis flips with orientation. Explicit zero-line props
// (anything other than virgin library defaults) are left alone on first mount.
export const sync_category_zero_display = (
  display: DisplayConfig,
  defaults: DisplayConfig,
  category_axis: `x` | `y` | null,
  prev_category_axis: `x` | `y` | null,
): `x` | `y` | null => {
  if (category_axis === prev_category_axis) return prev_category_axis

  if (prev_category_axis) {
    const [primary_key] = category_zero_keys[prev_category_axis]
    if (display[primary_key] === false) display[primary_key] = defaults[primary_key]
  }

  if (
    category_axis != null &&
    (prev_category_axis != null || at_zero_defaults(display, defaults))
  ) {
    for (const key of category_zero_keys[category_axis]) display[key] = false
  }

  return category_axis
}
