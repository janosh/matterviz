import { SvelteSet } from 'svelte/reactivity'

// Controls visibility configuration for visualization components
// Manages visibility of control buttons in Structure, Trajectory, BrillouinZone

export type ControlsVisibility = `always` | `hover` | `never`

export type ShowControlsConfig<ControlName extends string = string> = {
  mode?: ControlsVisibility
  hidden?: ControlName[]
  style?: string
}

// Prop type: boolean shorthand, mode string, or full config
export type ShowControlsProp<ControlName extends string = string> =
  | ControlsVisibility
  | ShowControlsConfig<ControlName>
  | boolean

// Normalize show_controls prop into consistent config with helper methods
// Normalized result of a ShowControlsProp, passed to viewer chrome components
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
  const hidden = new SvelteSet(config?.hidden)
  return {
    mode,
    hidden,
    style: config?.style,
    // Helper: check if a control should be visible
    visible: (name: string) => !hidden.has(name),
    // CSS class for visibility mode
    class: mode === `never` ? `` : `${mode}-visible`,
  }
}
