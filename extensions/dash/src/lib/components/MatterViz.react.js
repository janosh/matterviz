import PropTypes from 'prop-types'
import React, { Component, useEffect, useMemo, useRef, useState } from 'react'

function isPlainObject(value) {
  return (
    typeof value === `object` &&
    value !== null &&
    (value.constructor === Object || Object.getPrototypeOf(value) === null)
  )
}

/**
 * Convert values that Dash can't JSON-serialize (typed arrays, Set, Map, Error, File, etc.).
 * This is used for event payloads sent back to Python.
 */
function sanitizeForJson(value, seen = new WeakSet(), depth = 0, maxDepth = 6) {
  if (depth > maxDepth) return null

  if (value === null || value === undefined) return value

  const t = typeof value
  if (t === `string` || t === `boolean`) return value
  if (t === `number`) return Number.isFinite(value) ? value : null
  if (t === `bigint`) return value.toString()
  if (t === `function`) return undefined

  if (value instanceof Date) return value.toISOString()

  // Avoid cycles
  if (t === `object`) {
    if (seen.has(value)) return `[Circular]`
    seen.add(value)
  }

  // Typed arrays + DataView
  if (ArrayBuffer.isView(value)) {
    try {
      return Array.from(value)
    } catch {
      return null
    }
  }

  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value))
  }

  if (value instanceof Set) {
    return Array.from(value).map((v) => sanitizeForJson(v, seen, depth + 1, maxDepth))
  }

  if (value instanceof Map) {
    return Array.from(value.entries()).map(([k, v]) => [
      sanitizeForJson(k, seen, depth + 1, maxDepth),
      sanitizeForJson(v, seen, depth + 1, maxDepth),
    ])
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }

  // Browser File/Blob
  if (typeof File !== `undefined` && value instanceof File) {
    return {
      name: value.name,
      size: value.size,
      type: value.type,
      lastModified: value.lastModified,
    }
  }

  if (typeof Blob !== `undefined` && value instanceof Blob) {
    return {
      size: value.size,
      type: value.type,
    }
  }

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForJson(v, seen, depth + 1, maxDepth))
  }

  if (isPlainObject(value)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      const sv = sanitizeForJson(v, seen, depth + 1, maxDepth)
      if (sv !== undefined) out[k] = sv
    }
    return out
  }

  // Fallback: best-effort stringify
  try {
    return JSON.parse(JSON.stringify(value))
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

/**
 * Error boundary component to catch and display errors from MatterViz components.
 */
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

/**
 * Inner component that handles the actual MatterViz custom element.
 */
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

  // Build callback props that MatterViz will call.
  const injectedCallbacks = useMemo(() => {
    if (!setProps) return {}

    const callbacks = {}
    for (const propName of event_props || []) {
      // propName is typically something like "on_file_load".
      callbacks[propName] = (data) => {
        setProps({
          last_event: {
            prop: propName,
            data: sanitizeForJson(data),
            timestamp: Date.now(),
          },
        })
      }
    }
    return callbacks
  }, [event_props, setProps])

  // Serialize mv_props for stable dependency comparison (Dash re-creates objects on each render)
  const mvPropsKey = useMemo(() => JSON.stringify(mv_props), [mv_props])
  const setPropsKey = useMemo(() => JSON.stringify(set_props), [set_props])
  const float32PropsKey = useMemo(() => JSON.stringify(float32_props), [float32_props])

  const resolvedProps = useMemo(() => {
    const converted = convertDashPropsToMatterviz(mv_props, set_props, float32_props)
    return {
      ...converted,
      ...injectedCallbacks,
    }
  }, [mvPropsKey, setPropsKey, float32PropsKey, injectedCallbacks])

  useEffect(() => {
    const element = ref.current
    if (!element) return

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
  }, [component, resolvedProps])

  // Use mvPropsKey as React key to force remount when props change significantly
  // This is needed because Svelte 5 custom elements don't always detect external prop changes
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
      key: `${component}-${mvPropsKey}`,
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

/**
 * MatterViz component wrapper for Dash.
 * Wraps any MatterViz Svelte component as a Dash-compatible React component.
 */
const MatterViz = (props) => {
  return React.createElement(
    MatterVizErrorBoundary,
    { component: props.component },
    React.createElement(MatterVizInner, props),
  )
}

MatterViz.propTypes = {
  /** Dash component id */
  id: PropTypes.string,

  /** MatterViz component identifier (e.g. "Structure" or "structure/Structure") */
  component: PropTypes.string,

  /** Props forwarded to the selected MatterViz component (JSON-serializable from Python) */
  mv_props: PropTypes.object,

  /** List of mv_props keys that should be converted from list -> Set in JS */
  set_props: PropTypes.arrayOf(PropTypes.string),

  /** List of mv_props keys that should be converted from list -> Float32Array in JS */
  float32_props: PropTypes.arrayOf(PropTypes.string),

  /** List of callback-prop names to inject (e.g. ["on_file_load", "on_error"]) */
  event_props: PropTypes.arrayOf(PropTypes.string),

  /** Last event emitted back to Dash (set by this component) */
  last_event: PropTypes.object,

  /** CSS class */
  className: PropTypes.string,

  /** Inline styles */
  style: PropTypes.object,

  /** Dash internal: callback to report prop changes */
  setProps: PropTypes.func,
}

export default MatterViz
