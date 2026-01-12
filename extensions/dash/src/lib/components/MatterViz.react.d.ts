import { ComponentType } from 'react'

export interface MatterVizProps {
  // Dash component id
  id?: string
  // MatterViz component identifier (e.g. "Structure" or "structure/Structure")
  component?: string
  // Props forwarded to the selected MatterViz component (JSON-serializable from Python)
  mv_props?: Record<string, unknown>
  // List of mv_props keys that should be converted from list -> Set in JS
  set_props?: string[]
  // List of mv_props keys that should be converted from list -> Float32Array in JS
  float32_props?: string[]
  // List of callback-prop names to inject (e.g. ["on_file_load", "on_error"])
  event_props?: string[]
  // Last event emitted back to Dash (set by this component)
  last_event?: {
    prop: string
    data: unknown
    timestamp: number
  } | null
  // CSS class
  className?: string
  // Inline styles
  style?: React.CSSProperties
  // Dash internal: callback to report prop changes
  setProps?: (props: Partial<MatterVizProps>) => void
}

// MatterViz component wrapper for Dash.
// Wraps any MatterViz Svelte component as a Dash-compatible React component.
declare const MatterViz: ComponentType<MatterVizProps>

export default MatterViz
