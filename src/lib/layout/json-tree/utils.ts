// JSON Tree utility functions
import type { JsonValueType } from './types'

// Pre-compiled regex for valid JS identifiers (used in path formatting)
const VALID_IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/

// Circular-safe JSON.stringify helper (hoisted for reuse)
function safe_stringify(val: unknown): string {
  const seen = new WeakSet()
  return JSON.stringify(
    val,
    (_key, inner) => {
      if (typeof inner === `object` && inner !== null) {
        if (seen.has(inner)) return `[Circular]`
        seen.add(inner)
      }
      if (typeof inner === `bigint`) return `${inner}n`
      if (typeof inner === `symbol`) return inner.toString()
      if (typeof inner === `function`) return `[Function: ${inner.name || `anonymous`}]`
      return inner
    },
    2,
  )
}

// Detect the type of a value for rendering purposes
export function get_value_type(value: unknown): JsonValueType {
  if (value === null) return `null`
  if (value === undefined) return `undefined`

  const type = typeof value

  if (type === `string`) return `string`
  if (type === `number`) return `number`
  if (type === `boolean`) return `boolean`
  if (type === `symbol`) return `symbol`
  if (type === `bigint`) return `bigint`
  if (type === `function`) return `function`

  if (type === `object`) {
    if (Array.isArray(value)) return `array`
    if (value instanceof Date) return `date`
    if (value instanceof RegExp) return `regexp`
    if (value instanceof Map) return `map`
    if (value instanceof Set) return `set`
    if (value instanceof Error) return `error`
    return `object`
  }

  return `object` // fallback
}

// Check if a value type is expandable (has children)
export function is_expandable_type(value_type: JsonValueType): boolean {
  return (
    value_type === `object` ||
    value_type === `array` ||
    value_type === `map` ||
    value_type === `set`
  )
}

// Check if a value type is a primitive (searchable as string)
export function is_primitive_type(value_type: JsonValueType): boolean {
  return (
    value_type === `string` ||
    value_type === `number` ||
    value_type === `boolean` ||
    value_type === `null` ||
    value_type === `undefined` ||
    value_type === `bigint`
  )
}

// Check if a value is expandable
export function is_expandable(value: unknown): boolean {
  return is_expandable_type(get_value_type(value))
}

// Get the number of children for a value
export function get_child_count(value: unknown): number {
  const type = get_value_type(value)
  if (type === `array`) return (value as unknown[]).length
  if (type === `object`) return Object.keys(value as object).length
  if (type === `map`) return (value as Map<unknown, unknown>).size
  if (type === `set`) return (value as Set<unknown>).size
  return 0
}

// Format a path segment for display
// Handles both string keys and numeric indices
// is_first: true for the first segment (no leading dot for valid identifiers)
function format_path_segment(
  segment: string | number,
  is_first: boolean = false,
): string {
  if (typeof segment === `number`) {
    return `[${segment}]`
  }
  // Check if the key is a valid identifier (can use dot notation)
  if (VALID_IDENTIFIER_RE.test(segment)) {
    return is_first ? segment : `.${segment}`
  }
  // Use bracket notation for keys with special characters
  return `["${segment.replace(/"/g, `\\"`)}"]`
}

// Format a full path from segments
// e.g., ["users", 0, "name"] -> "users[0].name"
// e.g., [0, "name"] -> "[0].name" (root numeric index)
// e.g., ["key.with.dot"] -> '["key.with.dot"]' (root special key)
export function format_path(segments: (string | number)[]): string {
  if (segments.length === 0) return ``

  let result = format_path_segment(segments[0], true)
  for (let idx = 1; idx < segments.length; idx++) {
    result += format_path_segment(segments[idx])
  }
  return result
}

// Build a path string from parent path and key
export function build_path(parent_path: string, key: string | number): string {
  if (!parent_path) {
    return format_path_segment(key, true)
  }
  return parent_path + format_path_segment(key)
}

// Format a primitive/special value to string (shared by serialize and preview)
function format_special_value(value: unknown, type: JsonValueType): string | null {
  if (type === `undefined`) return `undefined`
  if (type === `null`) return `null`
  if (type === `number` || type === `boolean`) return String(value)
  if (type === `bigint`) return `${value}n`
  if (type === `symbol`) return (value as symbol).toString()
  if (type === `date`) return (value as Date).toISOString()
  if (type === `regexp`) return (value as RegExp).toString()
  if (type === `error`) return `${(value as Error).name}: ${(value as Error).message}`
  return null // not a special type
}

// Serialize a value for copying to clipboard
export function serialize_for_copy(value: unknown): string {
  const type = get_value_type(value)
  if (type === `string`) return value as string
  if (type === `function`) return (value as (...args: unknown[]) => unknown).toString()

  const special = format_special_value(value, type)
  if (special !== null) return special

  // Map/Set/Object/Array - try JSON stringify
  const data = type === `map`
    ? Array.from((value as Map<unknown, unknown>).entries())
    : type === `set`
    ? Array.from(value as Set<unknown>)
    : value
  try {
    return safe_stringify(data)
  } catch {
    return String(value)
  }
}

// Format a value for inline preview (collapsed view)
export function format_preview(value: unknown, max_length: number = 50): string {
  const type = get_value_type(value)

  // Collection summaries
  if (type === `array`) return `Array(${(value as unknown[]).length})`
  if (type === `object`) {
    const len = Object.keys(value as object).length
    return `{${len} ${len === 1 ? `key` : `keys`}}`
  }
  if (type === `map`) return `Map(${(value as Map<unknown, unknown>).size})`
  if (type === `set`) return `Set(${(value as Set<unknown>).size})`

  // String with truncation
  if (type === `string`) {
    const str = value as string
    return str.length > max_length ? `"${str.slice(0, max_length)}..."` : `"${str}"`
  }

  // Function has special format
  if (type === `function`) {
    return `ƒ ${(value as (...args: unknown[]) => unknown).name || `anonymous`}()`
  }

  // Use shared formatter for other special types
  return format_special_value(value, type) ?? String(value)
}

// Check if a path/key/value matches a search query (case-insensitive)
export function matches_search(
  path: string,
  key: string | number | null,
  value: unknown,
  query: string,
): boolean {
  if (!query) return false

  const lower_query = query.toLowerCase()

  // Check path
  if (path.toLowerCase().includes(lower_query)) return true

  // Check key
  if (key !== null && String(key).toLowerCase().includes(lower_query)) return true

  // Check value (for primitives)
  const type = get_value_type(value)
  if (is_primitive_type(type)) {
    return String(value).toLowerCase().includes(lower_query)
  }

  return false
}

// Iterate over children of an expandable value, calling visitor for each
function for_each_child(
  value: unknown,
  type: JsonValueType,
  visitor: (child_value: unknown, key: string | number, map_key?: unknown) => void,
): void {
  if (type === `array`) {
    ;(value as unknown[]).forEach((val, idx) => visitor(val, idx))
  } else if (type === `object`) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      visitor((value as Record<string, unknown>)[key], key)
    }
  } else if (type === `map`) {
    let idx = 0
    for (const [map_key, map_value] of value as Map<unknown, unknown>) {
      visitor(map_value, idx, map_key)
      idx++
    }
  } else if (type === `set`) {
    let idx = 0
    for (const set_value of value as Set<unknown>) {
      visitor(set_value, idx)
      idx++
    }
  }
}

// Collect all expandable paths in a value tree
export function collect_all_paths(
  value: unknown,
  current_path: string = ``,
  max_depth: number = Infinity,
  current_depth: number = 0,
  seen: WeakSet<object> = new WeakSet(),
): string[] {
  if (current_depth >= max_depth) return []
  const type = get_value_type(value)
  if (!is_expandable_type(type)) return []
  if (typeof value === `object` && value !== null) {
    if (seen.has(value)) return []
    seen.add(value)
  }

  const paths: string[] = current_path ? [current_path] : []
  for_each_child(value, type, (child_value, key) => {
    const child_path = build_path(current_path, key)
    paths.push(
      ...collect_all_paths(child_value, child_path, max_depth, current_depth + 1, seen),
    )
  })
  return paths
}

// Find all paths that match a search query
export function find_matching_paths(
  value: unknown,
  query: string,
  current_path: string = ``,
  current_key: string | number | null = null,
  seen: WeakSet<object> = new WeakSet(),
): Set<string> {
  const matches = new Set<string>()
  if (!query) return matches

  const lower_query = query.toLowerCase()
  if (matches_search(current_path, current_key, value, query)) {
    matches.add(current_path)
  }

  const type = get_value_type(value)
  if (!is_expandable_type(type)) return matches
  if (typeof value === `object` && value !== null) {
    if (seen.has(value)) return matches
    seen.add(value)
  }

  for_each_child(value, type, (child_value, key, map_key) => {
    const child_path = build_path(current_path, key)
    // Also check if Map key matches
    if (map_key !== undefined && String(map_key).toLowerCase().includes(lower_query)) {
      matches.add(child_path)
    }
    for (const match of find_matching_paths(child_value, query, child_path, key, seen)) {
      matches.add(match)
    }
  })
  return matches
}

// Get all ancestor paths for a given path
// e.g., "users[0].name" -> ["users", "users[0]"]
export function get_ancestor_paths(path: string): string[] {
  const ancestors: string[] = []
  let current = ``

  // Parse the path to extract segments
  const segments = parse_path(path)
  for (let idx = 0; idx < segments.length - 1; idx++) {
    current = build_path(current, segments[idx])
    ancestors.push(current)
  }

  return ancestors
}

// Parse a path string into segments
// e.g., "users[0].name" -> ["users", 0, "name"]
export function parse_path(path: string): (string | number)[] {
  if (!path) return []

  const segments: (string | number)[] = []
  let current = ``
  let in_bracket = false

  for (let idx = 0; idx < path.length; idx++) {
    const char = path[idx]

    if (char === `.` && !in_bracket) {
      if (current) segments.push(current)
      current = ``
    } else if (char === `[`) {
      if (current) segments.push(current)
      current = ``
      in_bracket = true
    } else if (char === `]`) {
      if (current) {
        // Check if it's a number index
        const num = Number(current)
        if (Number.isNaN(num)) {
          // Remove surrounding quotes and unescape internal quotes
          const unquoted = current.replace(/^"|"$/g, ``).replace(/\\"/g, `"`)
          segments.push(unquoted)
        } else {
          segments.push(num)
        }
      }
      current = ``
      in_bracket = false
    } else {
      current += char
    }
  }

  if (current) segments.push(current)

  return segments
}

// Check if two values are deeply equal (for change detection)
export function values_equal(val_a: unknown, val_b: unknown): boolean {
  if (val_a === val_b) return true
  if (val_a === null || val_b === null) return false
  if (typeof val_a !== typeof val_b) return false

  const type = get_value_type(val_a)

  // For primitives, strict equality is sufficient
  if (is_primitive_type(type) || type === `symbol`) {
    return val_a === val_b
  }

  // For dates, compare timestamps
  if (type === `date`) {
    return (val_a as Date).getTime() === (val_b as Date).getTime()
  }

  // For regex, compare string representation
  if (type === `regexp`) {
    return (val_a as RegExp).toString() === (val_b as RegExp).toString()
  }

  // For objects and arrays, do shallow comparison (for performance)
  // Deep changes will be detected at the child level
  if (type === `array`) {
    return (val_a as unknown[]).length === (val_b as unknown[]).length
  }

  if (type === `object`) {
    const keys_a = Object.keys(val_a as object)
    const keys_b = Object.keys(val_b as object)
    return keys_a.length === keys_b.length
  }

  return false
}
