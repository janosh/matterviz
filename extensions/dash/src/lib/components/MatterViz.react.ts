import PropTypes from 'prop-types'
import React, { Component, useEffect, useMemo, useRef, useState } from 'react'

// Delay before hiding loading indicator (ms). Svelte custom elements don't expose
// lifecycle events, so this is a reasonable UX approximation.
const LOADING_DELAY_MS = 100

// Guard against prototype pollution attacks via malicious prop names
const DANGEROUS_KEYS = new Set([`__proto__`, `constructor`, `prototype`])

interface MatterVizProps {
  id?: string
  component?: string
  mv_props?: Record<string, unknown>
  set_props?: string[]
  float32_props?: string[]
  event_props?: string[]
  last_event?: Record<string, unknown>
  className?: string
  style?: React.CSSProperties
  setProps?: (props: Record<string, unknown>) => void
  children?: React.ReactNode
}

interface ErrorBoundaryState {
  has_error: boolean
  error: Error | null
  error_info: React.ErrorInfo | null
}

// Convert non-JSON-serializable values for Dash event payloads.
// Uses JSON.stringify with a replacer to handle special types.
function sanitize_for_json(value: unknown): unknown {
  const seen = new WeakSet()
  const replacer = (_key: string, val: unknown): unknown => {
    if (val === null || val === undefined) return val
    if (typeof val === `bigint`) return val.toString()
    if (typeof val === `function`) return undefined
    if (typeof val === `number` && !Number.isFinite(val)) return null
    if (val instanceof Date) return val.toISOString()
    if (val instanceof Error) {
      return { name: val.name, message: val.message, stack: val.stack }
    }
    if (val instanceof Set) return [...val]
    if (val instanceof Map) return [...val.entries()]
    if (val instanceof DataView) {
      return [...new Uint8Array(val.buffer, val.byteOffset, val.byteLength)]
    }
    if (ArrayBuffer.isView(val)) return [...(val as Iterable<unknown>)]
    if (val instanceof ArrayBuffer) return [...new Uint8Array(val)]
    if (typeof File !== `undefined` && val instanceof File) {
      return {
        name: val.name,
        size: val.size,
        type: val.type,
        lastModified: val.lastModified,
      }
    }
    if (typeof Blob !== `undefined` && val instanceof Blob) {
      return { size: val.size, type: val.type }
    }
    // Circular reference detection
    if (typeof val === `object`) {
      if (seen.has(val as object)) return `[Circular]`
      seen.add(val as object)
    }
    return val
  }
  try {
    return JSON.parse(JSON.stringify(value, replacer))
  } catch {
    return String(value)
  }
}

function convert_dash_props_to_matterviz(
  mv_props: Record<string, unknown>,
  set_props_list: string[],
  float32_props_list: string[],
): Record<string, unknown> {
  if (!mv_props || typeof mv_props !== `object`) return {}

  const out: Record<string, unknown> = { ...mv_props }

  for (const key of set_props_list || []) {
    if (Array.isArray(out[key])) {
      out[key] = new Set(out[key] as unknown[])
    }
  }

  for (const key of float32_props_list || []) {
    if (Array.isArray(out[key])) {
      out[key] = new Float32Array(out[key] as number[])
    }
  }

  return out
}

// Deep merge two objects. Used to merge nested event callbacks with mv_props.
// Callbacks (functions) always override, objects are recursively merged.
// Skips dangerous keys to prevent prototype pollution.
function deep_merge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  if (!source || typeof source !== `object`) return target
  const result: Record<string, unknown> = { ...target }
  for (const key of Object.keys(source)) {
    // Skip dangerous keys (prototype pollution guard)
    if (DANGEROUS_KEYS.has(key)) continue
    const src_val = source[key]
    const tgt_val = result[key]
    if (
      src_val &&
      typeof src_val === `object` &&
      !Array.isArray(src_val) &&
      typeof src_val !== `function` &&
      tgt_val &&
      typeof tgt_val === `object` &&
      !Array.isArray(tgt_val)
    ) {
      result[key] = deep_merge(
        tgt_val as Record<string, unknown>,
        src_val as Record<string, unknown>,
      )
    } else {
      result[key] = src_val
    }
  }
  return result
}

// Error boundary component to catch and display errors from MatterViz components.
class MatterVizErrorBoundary extends Component<MatterVizProps, ErrorBoundaryState> {
  constructor(props: MatterVizProps) {
    super(props)
    this.state = { has_error: false, error: null, error_info: null }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { has_error: true, error }
  }

  componentDidCatch(error: Error, error_info: React.ErrorInfo): void {
    this.setState({ error_info })
    // Log error to console for debugging
    console.error(`MatterViz component error:`, error, error_info)
  }

  render(): React.ReactNode {
    if (this.state.has_error) {
      const { component } = this.props
      const { error } = this.state
      return React.createElement(
        `div`,
        {
          style: {
            padding: `16px`,
            border: `1px solid #dc3545`,
            borderRadius: `6px`,
            background: `#fff5f5`,
            color: `#dc3545`,
            fontFamily: `ui-monospace, monospace`,
            fontSize: `13px`,
          },
        },
        React.createElement(`strong`, null, `Error in ${component || `MatterViz`}:`),
        React.createElement(`br`),
        React.createElement(`code`, null, error?.message || String(error)),
        React.createElement(`br`),
        React.createElement(`br`),
        React.createElement(
          `button`,
          {
            onClick: () =>
              this.setState({ has_error: false, error: null, error_info: null }),
            style: {
              padding: `6px 12px`,
              border: `1px solid #dc3545`,
              borderRadius: `4px`,
              background: `white`,
              color: `#dc3545`,
              cursor: `pointer`,
            },
          },
          `Retry`,
        ),
      )
    }

    return this.props.children
  }
}

MatterVizErrorBoundary.propTypes = {
  children: PropTypes.node,
  component: PropTypes.string,
}

// Custom element type for the mv-matterviz web component
interface MatterVizElement extends HTMLElement {
  component: string
  props: Record<string, unknown>
}

// Inner component that handles the actual MatterViz custom element.
const MatterVizInner = (props: MatterVizProps) => {
  const {
    id,
    component = `Structure`,
    className,
    style,
    setProps,
  } = props
  // Handle null values from Python (destructuring defaults only apply to undefined)
  const mv_props = props.mv_props ?? {}
  const set_props = props.set_props ?? []
  const float32_props = props.float32_props ?? []
  const event_props = props.event_props ?? []

  const ref = useRef<MatterVizElement>(null)
  const [is_loading, set_is_loading] = useState(true)
  const callbacks_ref = useRef<Record<string, unknown>>({})

  // Build event callbacks during render and store in ref for stability.
  // This pattern is intentional: setProps is stable from Dash, and we avoid
  // the overhead of useCallback for each dynamic callback.
  // Clear previous callbacks to avoid stale handlers when event_props changes.
  // Supports dot notation for nested props (e.g., "tile_props.onclick").
  callbacks_ref.current = Object.create(null) // null-prototype to avoid prototype chain
  if (setProps) {
    for (const prop_name of event_props) {
      const parts = prop_name.split(`.`).filter(Boolean)
      // Skip if any part is a dangerous key (prototype pollution guard)
      if (parts.some((part) => DANGEROUS_KEYS.has(part))) continue

      const callback = (data: unknown) => {
        setProps({
          last_event: {
            prop: prop_name,
            data: sanitize_for_json(data),
            timestamp: Date.now(),
          },
        })
      }

      // Traverse/create nested path (no-op for flat props like "onclick")
      let target = callbacks_ref.current as Record<string, unknown>
      let conflict = false
      for (let idx = 0; idx < parts.length - 1; idx++) {
        const part = parts[idx]
        // Use null-prototype objects to avoid Object.prototype chain
        if (!target[part]) {
          target[part] = Object.create(null)
        } else if (typeof target[part] !== `object`) {
          // Conflict: e.g. flat "foo" already registered, "foo.bar" can't nest
          console.warn(
            `Event prop "${prop_name}" conflicts with "${
              parts.slice(0, idx + 1).join(`.`)
            }"`,
          )
          conflict = true
          break
        }
        target = target[part] as Record<string, unknown>
      }
      if (conflict) continue

      // Assign callback at leaf, unless a nested object already occupies it
      const leaf = parts[parts.length - 1]
      if (target[leaf] && typeof target[leaf] === `object`) {
        console.warn(
          `Event prop "${prop_name}" conflicts with nested props under "${prop_name}.*"`,
        )
      } else {
        target[leaf] = callback
      }
    }
  }

  // Serialize props for stable dependency comparison (Dash re-creates objects each render)
  const props_key = useMemo(
    () => JSON.stringify([mv_props, set_props, float32_props, event_props]),
    [mv_props, set_props, float32_props, event_props],
  )

  useEffect(() => {
    const element = ref.current
    if (!element) return

    // Convert and deep-merge with callbacks (supports nested event props)
    const converted_props = convert_dash_props_to_matterviz(
      mv_props,
      set_props,
      float32_props,
    )
    const resolved_props = deep_merge(
      converted_props,
      callbacks_ref.current as Record<string, unknown>,
    )

    // Set component and props. Due to Svelte's reactivity, there may be a brief
    // render with incomplete props when switching components. Components should
    // have sensible defaults to handle this gracefully.
    element.component = component
    element.props = resolved_props

    // Mark as loaded after brief delay
    const timer = setTimeout(() => set_is_loading(false), LOADING_DELAY_MS)

    // Cleanup: clear props to allow garbage collection
    return () => {
      clearTimeout(timer)
      element.props = {}
    }
  }, [component, props_key])

  // React key forces remount when component type changes
  return React.createElement(
    `div`,
    { style: { position: `relative`, ...style } },
    is_loading &&
      React.createElement(
        `div`,
        {
          style: {
            position: `absolute`,
            top: `50%`,
            left: `50%`,
            transform: `translate(-50%, -50%)`,
            color: `#888`,
            fontSize: `14px`,
          },
        },
        `Loading ${component}...`,
      ),
    React.createElement(`mv-matterviz`, {
      key: component,
      id,
      ref,
      className,
      style: { opacity: is_loading ? 0.5 : 1, transition: `opacity 0.2s` },
    }),
  )
}

// MatterViz component wrapper for Dash.
// Wraps any MatterViz Svelte component as a Dash-compatible React component.
const MatterViz = (props: MatterVizProps) => {
  return React.createElement(
    MatterVizErrorBoundary,
    { component: props.component },
    React.createElement(MatterVizInner, props),
  )
}

MatterViz.propTypes = {
  // Dash component id
  id: PropTypes.string,
  // MatterViz component identifier (e.g. "Structure" or "structure/Structure")
  component: PropTypes.string,
  // Props forwarded to the selected MatterViz component (JSON-serializable from Python)
  mv_props: PropTypes.object,
  // List of mv_props keys that should be converted from list -> Set in JS
  set_props: PropTypes.arrayOf(PropTypes.string),
  // List of mv_props keys that should be converted from list -> Float32Array in JS
  float32_props: PropTypes.arrayOf(PropTypes.string),
  // List of callback-prop names to inject (e.g. ["on_file_load", "on_error"])
  event_props: PropTypes.arrayOf(PropTypes.string),
  // Last event emitted back to Dash (set by this component)
  last_event: PropTypes.object,
  // CSS class
  className: PropTypes.string,
  // Inline styles
  style: PropTypes.object,
  // Dash internal: callback to report prop changes
  setProps: PropTypes.func,
}

export default MatterViz
