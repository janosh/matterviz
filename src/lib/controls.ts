import { untrack } from 'svelte'
import { is_plain_object } from '$lib/utils'

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
    if (!is_plain_object(value))
      throw new TypeError(`Unsupported setting object: ${value.constructor?.name}`)
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
  if (Array.isArray(left) && Array.isArray(right) && left.length !== right.length) return false
  if (!Array.isArray(left) && (!is_plain_object(left) || !is_plain_object(right))) return false
  const entries = Object.entries(left)
  return (
    entries.length === Object.keys(right).length &&
    entries.every(
      ([key, value]) =>
        Object.hasOwn(right, key) && settings_equal(value, Reflect.get(right, key)),
    )
  )
}

export const INITIAL_SETTINGS_LABELS = {
  reset_section: (title: string) => `Restore ${title.toLowerCase()} to initial values`,
  reset_key: (label: string) => `Restore ${label.toLowerCase()} to initial value`,
}

// The reset target is explicit: capture mounted values, or compare with a supplied reference.
// A supplied reference is restricted to the fields this section exposes at capture time.
export function track_settings<Values extends Record<string, unknown>>(
  get_values: () => Values,
  reset_reference: `initial` | Record<string, unknown>,
) {
  const initial = untrack(() => {
    const values = get_values()
    const reference =
      reset_reference !== `initial`
        ? Object.fromEntries(
            Object.keys(values)
              .filter((key) => Object.hasOwn(reset_reference, key))
              .map((key) => [key, reset_reference[key]]),
          )
        : values
    return copy_setting(reference) as Record<string, unknown>
  })
  return {
    get changed_keys() {
      const values = get_values()
      return [...new Set([...Object.keys(initial), ...Object.keys(values)])].filter(
        (key) =>
          Object.hasOwn(initial, key) !== Object.hasOwn(values, key) ||
          !settings_equal(values[key], initial[key]),
      )
    },
    // Clone only the requested fields; omitted keys remain omitted so resets can delete them.
    snapshot<Key extends keyof Values = keyof Values>(
      keys?: readonly Key[],
    ): Pick<Values, Key> {
      const snapshot: Record<string, unknown> = {}
      for (const key of keys ?? Object.keys(initial)) {
        if (Object.hasOwn(initial, key))
          Reflect.set(snapshot, key, copy_setting(Reflect.get(initial, key)))
      }
      return snapshot as Pick<Values, Key>
    },
  }
}
