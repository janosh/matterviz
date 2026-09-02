// Normalises the `show_controls` prop every viewer accepts into one shape for its chrome

type ControlsVisibility = `always` | `hover` | `never`

type ShowControlsConfig<ControlName extends string = string> = {
  mode?: ControlsVisibility
  hidden?: ControlName[]
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
    visible: (name: string) => !hidden.has(name),
    // CSS class for visibility mode
    class: mode === `never` ? `` : `${mode}-visible`,
  }
}
