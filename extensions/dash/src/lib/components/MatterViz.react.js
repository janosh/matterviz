import PropTypes from 'prop-types'
import React, { Component, useEffect, useMemo, useRef, useState } from 'react'

// Convert non-JSON-serializable values for Dash event payloads.
// Uses JSON.stringify with a replacer to handle special types.
function sanitize_for_json(value) {
  const seen = new WeakSet()
  const replacer = (_key, val) => {
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
    if (ArrayBuffer.isView(val)) return [...val]
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
      if (seen.has(val)) return `[Circular]`
      seen.add(val)
    }
    return val
  }
  try {
    return JSON.parse(JSON.stringify(value, replacer))
  } catch {
    return String(value)
  }
}

function convert_dash_props_to_matterviz(mv_props, set_props_list, float32_props_list) {
  if (!mv_props || typeof mv_props !== `object`) return {}

  const out = { ...mv_props }

  for (const key of set_props_list || []) {
    if (Array.isArray(out[key])) {
      out[key] = new Set(out[key])
    }
  }

  for (const key of float32_props_list || []) {
    if (Array.isArray(out[key])) {
      out[key] = new Float32Array(out[key])
    }
  }

  return out
}

// Deep merge two objects. Used to merge nested event callbacks with mv_props.
// Callbacks (functions) always override, objects are recursively merged.
function deep_merge(target, source) {
  if (!source || typeof source !== `object`) return target
  const result = { ...target }
  for (const key of Object.keys(source)) {
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
      result[key] = deep_merge(tgt_val, src_val)
    } else {
      result[key] = src_val
    }
  }
  return result
}

// Error boundary component to catch and display errors from MatterViz components.
class MatterVizErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo })
    // Log error to console for debugging
    console.error(`MatterViz component error:`, error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
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
              this.setState({ hasError: false, error: null, errorInfo: null }),
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

// Inner component that handles the actual MatterViz custom element.
const MatterVizInner = (props) => {
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

  const ref = useRef(null)
  const [isLoading, setIsLoading] = useState(true)
  const callbacksRef = useRef({})

  // Build event callbacks during render and store in ref for stability.
  // This pattern is intentional: setProps is stable from Dash, and we avoid
  // the overhead of useCallback for each dynamic callback.
  // Clear previous callbacks to avoid stale handlers when event_props changes.
  // Supports dot notation for nested props (e.g., "tile_props.onclick").
  callbacksRef.current = {}
  if (setProps) {
    for (const propName of event_props || []) {
      const callback = (data) => {
        setProps({
          last_event: {
            prop: propName,
            data: sanitize_for_json(data),
            timestamp: Date.now(),
          },
        })
      }
      // Handle dot notation for nested props (e.g., "tile_props.onclick")
      if (propName.includes(`.`)) {
        const parts = propName.split(`.`).filter(Boolean)
        let target = callbacksRef.current
        for (let idx = 0; idx < parts.length - 1; idx++) {
          const part = parts[idx]
          if (!target[part]) target[part] = {}
          target = target[part]
        }
        target[parts[parts.length - 1]] = callback
      } else {
        callbacksRef.current[propName] = callback
      }
    }
  }

  // Serialize props for stable dependency comparison (Dash re-creates objects each render)
  const propsKey = useMemo(
    () => JSON.stringify([mv_props, set_props, float32_props, event_props]),
    [mv_props, set_props, float32_props, event_props],
  )

  // Delay before hiding loading indicator. Svelte custom elements don't expose
  // lifecycle events, so this is a reasonable UX approximation.
  const LOADING_DELAY_MS = 100

  useEffect(() => {
    const element = ref.current
    if (!element) return

    // Convert and deep-merge with callbacks (supports nested event props)
    const converted_props = convert_dash_props_to_matterviz(
      mv_props,
      set_props,
      float32_props,
    )
    const resolved_props = deep_merge(converted_props, callbacksRef.current)

    // Set component and props. Due to Svelte's reactivity, there may be a brief
    // render with incomplete props when switching components. Components should
    // have sensible defaults to handle this gracefully.
    element.component = component
    element.props = resolved_props

    // Mark as loaded after brief delay
    const timer = setTimeout(() => setIsLoading(false), LOADING_DELAY_MS)

    // Cleanup: clear props to allow garbage collection
    return () => {
      clearTimeout(timer)
      if (element) {
        element.props = {}
      }
    }
  }, [component, propsKey])

  // React key forces remount when component type changes
  return React.createElement(
    `div`,
    { style: { position: `relative`, ...style } },
    isLoading &&
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
      style: { opacity: isLoading ? 0.5 : 1, transition: `opacity 0.2s` },
    }),
  )
}

// PropTypes defined on outer MatterViz component

// MatterViz component wrapper for Dash.
// Wraps any MatterViz Svelte component as a Dash-compatible React component.
const MatterViz = (props) => {
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
