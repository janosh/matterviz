// Controls visibility configuration for visualization components
// Manages visibility of control buttons in Structure, Trajectory, BrillouinZone

export type ControlsVisibility = `always` | `hover` | `never`

export type ShowControlsConfig = {
  mode?: ControlsVisibility
  hidden?: string[]
  style?: string
}

// Prop type: boolean shorthand, mode string, or full config
export type ShowControlsProp = ControlsVisibility | ShowControlsConfig | boolean

// Normalize show_controls prop into consistent config with helper methods
export function normalize_show_controls(prop: ShowControlsProp | undefined) {
  // Extract mode, hidden, style from various prop forms
  let mode: ControlsVisibility = `hover`
  let hidden_arr: string[] | undefined
  let style: string | undefined

  if (typeof prop === `boolean`) {
    mode = prop ? `always` : `never`
  } else if (typeof prop === `string`) {
    mode = prop
  } else if (prop) {
    mode = prop.mode ?? `hover`
    hidden_arr = prop.hidden
    style = prop.style
  }

  const hidden = new Set(hidden_arr)
  return {
    mode,
    hidden,
    style,
    // Helper: check if a control should be visible
    visible: (name: string) => !hidden.has(name),
    // CSS class for visibility mode
    class: mode === `never` ? `` : `${mode}-visible`,
  }
}
