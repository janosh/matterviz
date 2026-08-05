import type { DisplayConfig } from './types'

const category_zero_keys = {
  x: [`x_zero_line`, `x2_zero_line`],
  y: [`y_zero_line`, `y2_zero_line`],
} as const
const zero_line_keys = [...category_zero_keys.x, ...category_zero_keys.y]
type CategoryAxis = `x` | `y` | null
type CategoryZeroKey = (typeof zero_line_keys)[number]
// What the last sync did, so the next one can undo it. `display` is the object we wrote
// into, absent only in the initial state callers pass in.
type CategoryZeroSyncState = {
  axis: CategoryAxis
  disabled_keys: readonly CategoryZeroKey[]
  display?: DisplayConfig
}

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

// Zero lines along a category axis mark nothing, so hide them. But `display` is bound to the
// caller, so this only writes flags it can prove it owns: a line is disabled only where the
// caller left it at the library default, and the keys it touched are remembered so an
// orientation flip can put them back.
export const sync_category_zero_display = (
  display: DisplayConfig,
  defaults: DisplayConfig,
  category_axis: CategoryAxis,
  previous: CategoryZeroSyncState,
): CategoryZeroSyncState => {
  const { axis: previous_axis, disabled_keys: previous_keys } = previous
  // A swapped-in `display` object voids the bookkeeping: those keys were disabled on the
  // old object, and the new one carries whatever the caller put in it.
  const same_display = (previous.display ?? display) === display
  if (same_display && category_axis === previous_axis) return previous

  // Undo the last sync first, so the decision below sees the caller's own flags.
  if (same_display) for (const key of previous_keys) display[key] = defaults[key]

  // Nothing to hide without a category axis. And on a first sync into a given object, any
  // deviation from the default zero lines is the caller expressing intent — back off
  // entirely rather than guess which flag they meant.
  const first_sync = !same_display || previous_axis == null
  if (category_axis == null || (first_sync && !at_zero_defaults(display, defaults)))
    return { axis: category_axis, disabled_keys: [], display }

  // Skip lines the caller already switched off: claiming them would mean "restoring" them
  // to the default `true` on the next flip, turning on a line nobody asked for.
  const disabled_keys = category_zero_keys[category_axis].filter(
    (key) => display[key] !== false,
  )
  for (const key of disabled_keys) display[key] = false
  return { axis: category_axis, disabled_keys, display }
}
