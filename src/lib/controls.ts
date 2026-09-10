import { untrack } from 'svelte'

// Shared visibility contract for viewer and plot controls.

export type ControlsVisibility = `always` | `hover` | `never`

export type ShowControlsConfig<ControlName extends string = string> = {
  mode?: ControlsVisibility
  hidden?: readonly ControlName[]
  style?: string
}

// Prop type: boolean shorthand, mode string, or full config
export type ShowControlsProp<ControlName extends string = string> =
  | ControlsVisibility
  | ShowControlsConfig<ControlName>
  | boolean

// Normalized ShowControlsProp, passed to viewer chrome components
export type ShowControlsState = ReturnType<typeof normalize_show_controls>

export function normalize_show_controls(
  prop: ShowControlsProp | undefined,
  default_mode: ControlsVisibility = `hover`,
) {
  const config = typeof prop === `object` && prop ? prop : undefined
  const mode =
    typeof prop === `boolean`
      ? prop
        ? `always`
        : `never`
      : typeof prop === `string`
        ? prop
        : (config?.mode ?? default_mode)
  // Plain Set: never mutated, and every caller already wraps this in a $derived
  const hidden = new Set(config?.hidden)
  return {
    mode,
    style: config?.style,
    visible: (name: string) => mode !== `never` && !hidden.has(name),
    // CSS class for visibility mode
    class: mode === `never` ? `` : `${mode}-visible`,
  }
}

// Settings panes own their reset baseline; SettingsSection only renders changed keys.
// Read through proxies so nested edits cannot mutate the captured baseline.
const copy_setting = (value: unknown): unknown => {
  if (value instanceof Date) return new Date(value)
  if (Array.isArray(value)) return value.map(copy_setting)
  if (value && typeof value === `object`) {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== null && prototype !== Object.prototype)
      throw new TypeError(`Unsupported setting object: ${prototype.constructor?.name}`)
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, copy_setting(item)]),
    )
  }
  return value
}

const settings_equal = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (left instanceof Date || right instanceof Date)
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime()
  if (!left || !right || typeof left !== `object` || typeof right !== `object`) return false
  if (Array.isArray(left) !== Array.isArray(right)) return false
  const entries = Object.entries(left)
  return (
    entries.length === Object.keys(right).length &&
    entries.every(
      ([key, value]) =>
        Object.hasOwn(right, key) && settings_equal(value, Reflect.get(right, key)),
    )
  )
}

export function track_settings(
  get_values: () => Record<string, unknown>,
  defaults?: Record<string, unknown>,
) {
  const initial = untrack(() => {
    const values = get_values()
    const reference = defaults
      ? Object.fromEntries(
          Object.keys(values)
            .filter((key) => Object.hasOwn(defaults, key))
            .map((key) => [key, defaults[key]]),
        )
      : values
    return copy_setting(reference) as Record<string, unknown>
  })
  return {
    get changed_keys() {
      return this.changes(get_values())
    },
    changes: (values: Record<string, unknown>) =>
      [...new Set([...Object.keys(initial), ...Object.keys(values)])].filter(
        (key) =>
          Object.hasOwn(initial, key) !== Object.hasOwn(values, key) ||
          !settings_equal(values[key], initial[key]),
      ),
    reset: (key: string, apply: (value: unknown, present: boolean) => void) =>
      apply(copy_setting(initial[key]), Object.hasOwn(initial, key)),
  }
}
