import PropTypes from 'prop-types'
import React, { Component, useEffect, useMemo, useRef, useState } from 'react'

// Convert non-JSON-serializable values for Dash event payloads.
// Uses JSON.stringify with a replacer to handle special types.
function sanitizeForJson(value) {
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

function convertDashPropsToMatterviz(mvProps, setPropsList, float32PropsList) {
  if (!mvProps || typeof mvProps !== `object`) return {}

  const out = { ...mvProps }

  for (const key of setPropsList || []) {
    if (Array.isArray(out[key])) {
      out[key] = new Set(out[key])
    }
  }

  for (const key of float32PropsList || []) {
    if (Array.isArray(out[key])) {
      out[key] = new Float32Array(out[key])
    }
  }

  return out
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
            onClick: () => this.setState({ hasError: false, error: null }),
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
    mv_props = {},
    set_props = [],
    float32_props = [],
    event_props = [],
    className,
    style,
    setProps,
  } = props

  const ref = useRef(null)
  const [isLoading, setIsLoading] = useState(true)
  const callbacksRef = useRef({})

  // Build event callbacks (stable references via ref)
  if (setProps) {
    for (const propName of event_props || []) {
      callbacksRef.current[propName] = (data) => {
        setProps({
          last_event: {
            prop: propName,
            data: sanitizeForJson(data),
            timestamp: Date.now(),
          },
        })
      }
    }
  }

  // Serialize props for stable dependency comparison (Dash re-creates objects each render)
  const propsKey = useMemo(
    () => JSON.stringify([mv_props, set_props, float32_props]),
    [mv_props, set_props, float32_props],
  )

  useEffect(() => {
    const element = ref.current
    if (!element) return

    // Convert and merge with callbacks
    const resolvedProps = {
      ...convertDashPropsToMatterviz(mv_props, set_props, float32_props),
      ...callbacksRef.current,
    }

    // Set as properties (not attributes) so we can pass objects + functions.
    element.component = component
    element.props = resolvedProps

    // Mark as loaded after a short delay to allow the component to render
    const timer = setTimeout(() => setIsLoading(false), 100)

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

MatterVizInner.propTypes = {
  id: PropTypes.string,
  component: PropTypes.string,
  mv_props: PropTypes.object,
  set_props: PropTypes.arrayOf(PropTypes.string),
  float32_props: PropTypes.arrayOf(PropTypes.string),
  event_props: PropTypes.arrayOf(PropTypes.string),
  className: PropTypes.string,
  style: PropTypes.object,
  setProps: PropTypes.func,
}

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
