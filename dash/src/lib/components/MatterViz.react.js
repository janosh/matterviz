import React, { useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';

function isPlainObject(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value.constructor === Object || Object.getPrototypeOf(value) === null)
  );
}

/**
 * Convert values that Dash can't JSON-serialize (typed arrays, Set, Map, Error, File, etc.).
 * This is used for event payloads sent back to Python.
 */
function sanitizeForJson(value, seen = new WeakSet(), depth = 0, maxDepth = 6) {
  if (depth > maxDepth) return null;

  if (value === null || value === undefined) return value;

  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') return Number.isFinite(value) ? value : null;
  if (t === 'bigint') return value.toString();
  if (t === 'function') return undefined;

  if (value instanceof Date) return value.toISOString();

  // Avoid cycles
  if (t === 'object') {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
  }

  // Typed arrays + DataView
  if (ArrayBuffer.isView(value)) {
    try {
      return Array.from(value);
    } catch (e) {
      return null;
    }
  }

  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value));
  }

  if (value instanceof Set) {
    return Array.from(value).map((v) => sanitizeForJson(v, seen, depth + 1, maxDepth));
  }

  if (value instanceof Map) {
    return Array.from(value.entries()).map(([k, v]) => [
      sanitizeForJson(k, seen, depth + 1, maxDepth),
      sanitizeForJson(v, seen, depth + 1, maxDepth)
    ]);
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  // Browser File/Blob
  if (typeof File !== 'undefined' && value instanceof File) {
    return {
      name: value.name,
      size: value.size,
      type: value.type,
      lastModified: value.lastModified
    };
  }

  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return {
      size: value.size,
      type: value.type
    };
  }

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForJson(v, seen, depth + 1, maxDepth));
  }

  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const sv = sanitizeForJson(v, seen, depth + 1, maxDepth);
      if (sv !== undefined) out[k] = sv;
    }
    return out;
  }

  // Fallback: best-effort stringify
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (e) {
    return String(value);
  }
}

function convertDashPropsToMatterviz(mvProps, setPropsList, float32PropsList) {
  if (!mvProps || typeof mvProps !== 'object') return {};

  const out = { ...mvProps };

  for (const key of setPropsList || []) {
    if (Array.isArray(out[key])) {
      out[key] = new Set(out[key]);
    }
  }

  for (const key of float32PropsList || []) {
    if (Array.isArray(out[key])) {
      out[key] = new Float32Array(out[key]);
    }
  }

  return out;
}

const MatterViz = (props) => {
  const {
    id,
    component = 'Structure',
    mv_props = {},
    set_props = [],
    float32_props = [],
    event_props = [],
    last_event, // eslint-disable-line no-unused-vars
    className,
    style,
    setProps
  } = props;

  const ref = useRef(null);

  // Build callback props that MatterViz will call.
  const injectedCallbacks = useMemo(() => {
    if (!setProps) return {};

    const callbacks = {};
    for (const propName of event_props || []) {
      // propName is typically something like "on_file_load".
      callbacks[propName] = (data) => {
        setProps({
          last_event: {
            prop: propName,
            data: sanitizeForJson(data),
            timestamp: Date.now()
          }
        });
      };
    }
    return callbacks;
  }, [event_props, setProps]);

  const resolvedProps = useMemo(() => {
    const converted = convertDashPropsToMatterviz(mv_props, set_props, float32_props);
    return {
      ...converted,
      ...injectedCallbacks
    };
  }, [mv_props, set_props, float32_props, injectedCallbacks]);

  useEffect(() => {
    if (!ref.current) return;
    // Set as properties (not attributes) so we can pass objects + functions.
    ref.current.component = component;
    ref.current.props = resolvedProps;
  }, [component, resolvedProps]);

  return React.createElement('mv-matterviz', {
    id,
    ref,
    className,
    style
  });
};

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
  setProps: PropTypes.func
};

export default MatterViz;
