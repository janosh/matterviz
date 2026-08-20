// JSON Tree utility functions
import { build_path, format_path, parse_path } from '../../json-path'
import type { DiffEntry, JsonValueType } from './types'

export type JsonChild = { key: string | number; value: unknown }

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
      // oxlint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- anonymous fns have name ``
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
  // string/number/boolean/symbol/bigint/function map directly to JsonValueType
  if (type !== `object`) return type

  if (Array.isArray(value)) return `array`
  if (value instanceof Date) return `date`
  if (value instanceof RegExp) return `regexp`
  if (value instanceof Map) return `map`
  if (value instanceof Set) return `set`
  if (value instanceof Error) return `error`
  return `object`
}

// Check if a value type is expandable (has children)
export const is_expandable_type = (value_type: JsonValueType): boolean =>
  value_type === `object` ||
  value_type === `array` ||
  value_type === `map` ||
  value_type === `set`

// Check if a value type is a primitive (searchable as string)
export const is_primitive_type = (value_type: JsonValueType): boolean =>
  value_type === `string` ||
  value_type === `number` ||
  value_type === `boolean` ||
  value_type === `null` ||
  value_type === `undefined` ||
  value_type === `bigint`

// Check if a value is expandable
export const is_expandable = (value: unknown): boolean =>
  is_expandable_type(get_value_type(value))

// Get the number of children for a value
export function get_child_count(value: unknown): number {
  const type = get_value_type(value)
  if (type === `array`) return (value as unknown[]).length
  if (type === `object`) return Object.keys(value as object).length
  if (type === `map`) return (value as Map<unknown, unknown>).size
  if (type === `set`) return (value as Set<unknown>).size
  return 0
}

// The single definition of what a node's children are, shared by rendering, path lookup,
// search, collapse bookkeeping and diffing so they can never disagree. Map entries are
// wrapped as { key, value } objects under numeric indices so non-string keys stay
// expandable; Set members get numeric indices.
export function get_children(value: unknown, sort_keys = false): JsonChild[] {
  const type = get_value_type(value)
  if (type === `array`)
    return (value as unknown[]).map((val, idx) => ({ key: idx, value: val }))
  if (type === `object`) {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
    if (sort_keys) keys.sort()
    return keys.map((key) => ({ key, value: record[key] }))
  }
  if (type === `map`) {
    return Array.from(value as Map<unknown, unknown>, ([key, val], idx) => ({
      key: idx,
      value: { key, value: val },
    }))
  }
  if (type === `set`)
    return Array.from(value as Set<unknown>, (val, idx) => ({ key: idx, value: val }))
  return []
}

// Resolve a dot/bracket path (optionally prefixed by root_label) against root
export function get_value_at_path(root: unknown, path: string, root_label?: string): unknown {
  const segments = parse_path(path)
  const start = root_label && segments[0] === root_label ? 1 : 0
  let current = root
  for (let idx = start; idx < segments.length; idx++) {
    const segment = segments[idx]
    const type = get_value_type(current)
    if (type === `map` || type === `set`) {
      current = get_children(current)[Number(segment)]?.value
    } else if (type === `object` || type === `array`) {
      current = (current as Record<string | number, unknown>)[segment]
    } else return undefined
  }
  return current
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
  const data =
    type === `map`
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
  if (path.toLowerCase().includes(lower_query)) return true
  if (key !== null && String(key).toLowerCase().includes(lower_query)) return true
  // Check value (only primitives are searchable as strings)
  return (
    is_primitive_type(get_value_type(value)) &&
    String(value).toLowerCase().includes(lower_query)
  )
}

// Depth-first pre-order walk in render order, skipping already-visited objects so cycles
// terminate. visit returns false to stop descending into a node.
function walk_tree(
  value: unknown,
  current_path: string,
  sort_keys: boolean,
  visit: (value: unknown, path: string, key: string | number | null, depth: number) => boolean,
): void {
  const seen = new WeakSet<object>()
  const recurse = (val: unknown, path: string, key: string | number | null, depth: number) => {
    if (!visit(val, path, key, depth)) return
    if (!is_expandable(val)) return
    if (seen.has(val as object)) return
    seen.add(val as object)
    for (const child of get_children(val, sort_keys)) {
      recurse(child.value, build_path(path, child.key), child.key, depth + 1)
    }
  }
  recurse(value, current_path, null, 0)
}

// Collect all expandable paths (render order), starting at current_path when non-empty
export function collect_all_paths(
  value: unknown,
  current_path: string = ``,
  max_depth: number = Infinity,
): string[] {
  const paths: string[] = []
  walk_tree(value, current_path, false, (val, path, _key, depth) => {
    if (depth >= max_depth || !is_expandable(val)) return false
    if (path) paths.push(path)
    return true
  })
  return paths
}

// Paths whose key, path or primitive value contains query, in render order
export function find_matching_paths(
  value: unknown,
  query: string,
  current_path: string = ``,
  sort_keys = false,
): string[] {
  const matches: string[] = []
  if (!query) return matches
  walk_tree(value, current_path, sort_keys, (val, path, key) => {
    if (matches_search(path, key, val, query)) matches.push(path)
    return true
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

// Check if two values are deeply equal (for change detection)
export function values_equal(val_a: unknown, val_b: unknown): boolean {
  if (val_a === val_b) return true
  // NaN !== NaN in JS, but we want NaN === NaN for change detection
  if (typeof val_a === `number` && typeof val_b === `number`) {
    return Number.isNaN(val_a) && Number.isNaN(val_b)
  }
  if (val_a === null || val_b === null || typeof val_a !== typeof val_b) return false

  const type = get_value_type(val_a)
  if (type !== get_value_type(val_b)) return false
  if (is_primitive_type(type) || type === `symbol`) return false // strict equality failed above
  if (type === `date`) return (val_a as Date).getTime() === (val_b as Date).getTime()
  if (type === `regexp`) return (val_a as RegExp).toString() === (val_b as RegExp).toString()
  // Objects and arrays use shallow size comparison for performance —
  // deep changes are detected at the child level
  if (type === `array`) return (val_a as unknown[]).length === (val_b as unknown[]).length
  if (type === `object`) {
    return Object.keys(val_a as object).length === Object.keys(val_b as object).length
  }
  return false
}

// Parse a raw edited string into a typed JSON value
// Numbers, booleans, and null are auto-detected; everything else stays as string
export function parse_edited_value(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === `null`) return null
  if (trimmed === `true`) return true
  if (trimmed === `false`) return false
  const num = Number(trimmed)
  if (trimmed !== `` && Number.isFinite(num)) return num
  return text
}

// Set a value at a dot/bracket path in a deep-cloned copy of root
// root_label is stripped from the path prefix if present
export function set_at_path(
  root: unknown,
  path_str: string,
  new_value: unknown,
  root_label?: string,
): unknown {
  const segments = parse_path(path_str)
  const start = root_label && segments[0] === root_label ? 1 : 0
  if (start >= segments.length) return new_value
  const cloned = structuredClone(root)
  let current = cloned as Record<string | number, unknown>
  for (let idx = start; idx < segments.length - 1; idx++) {
    const next = current[segments[idx]]
    if (next === undefined || next === null) return root // bail — path no longer valid
    current = next as Record<string | number, unknown>
  }
  current[segments[segments.length - 1]] = new_value
  return cloned
}

// URL regex for auto-detection in string values
const URL_RE = /^https?:\/\/\S+$/

// CSS color patterns for swatch rendering
const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FUNC_COLOR_RE = /^(?:rgba?|hsla?|oklch|oklab|lch|lab|color)\([^)]*\)$/i

// Check if a string is a URL
export const is_url = (str: string): boolean => URL_RE.test(str.trim())

// Check if a string looks like a CSS color value
// Rejects strings with semicolons to prevent CSS injection
export function is_css_color(str: string): boolean {
  const trimmed = str.trim()
  if (trimmed.includes(`;`)) return false
  return HEX_COLOR_RE.test(trimmed) || FUNC_COLOR_RE.test(trimmed)
}

// Estimate the serialized byte size of a value (rough approximation)
// Uses max_depth to avoid expensive deep recursion on large trees
export function estimate_byte_size(
  value: unknown,
  max_depth: number = 4,
  current_depth: number = 0,
): number {
  if (current_depth >= max_depth) return 10
  const type = get_value_type(value)
  if (type === `null`) return 4
  if (type === `undefined`) return 9
  if (type === `boolean`) return value ? 4 : 5
  if (type === `number` || type === `bigint`) return String(value).length
  if (type === `string`) return (value as string).length + 2
  if (type === `symbol`) return (value as symbol).toString().length
  if (type === `function`) return 20
  if (type === `date`) return 24
  if (type === `regexp`) return (value as RegExp).toString().length
  if (type === `error`) {
    return `${(value as Error).name}: ${(value as Error).message}`.length
  }
  // Accumulate child sizes for collection types
  const child_depth = current_depth + 1
  const child_size = (val: unknown, overhead: number = 1) =>
    estimate_byte_size(val, max_depth, child_depth) + overhead
  if (type === `array`) {
    let size = 2
    for (const item of value as unknown[]) size += child_size(item)
    return size
  }
  if (type === `object`) {
    let size = 2
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      size += key.length + 4 + child_size(val, 0)
    }
    return size
  }
  if (type === `map`) {
    let size = 2
    for (const [, val] of value as Map<unknown, unknown>) size += child_size(val, 10)
    return size
  }
  if (type === `set`) {
    let size = 2
    for (const val of value as Set<unknown>) size += child_size(val)
    return size
  }
  return String(value).length
}

// Ghost entry for removed diff children
export interface GhostEntry {
  key: string | number
  value: unknown
  path: string
}

// Pre-compute a map of parent_path -> removed children from a diff map
// This avoids O(diff_size) iteration per expanded node
export function build_ghost_map(diff_map: Map<string, DiffEntry>): Map<string, GhostEntry[]> {
  const ghost_map = new Map<string, GhostEntry[]>()
  for (const [diff_path, entry] of diff_map) {
    if (entry.status !== `removed`) continue
    const segments = parse_path(diff_path)
    if (segments.length === 0) continue
    const parent_path = segments.length === 1 ? `` : format_path(segments.slice(0, -1))
    const key = segments[segments.length - 1]
    const ghosts = ghost_map.get(parent_path) ?? []
    ghosts.push({ key, value: entry.old_value, path: diff_path })
    ghost_map.set(parent_path, ghosts)
  }
  return ghost_map
}

// Compute diff between old and new values, returning path -> DiffEntry map
// Only paths that differ are included (unchanged paths are omitted)
export function compute_diff(
  old_val: unknown,
  new_val: unknown,
  current_path: string = ``,
  result = new Map<string, DiffEntry>(),
  seen = new WeakSet<object>(),
): Map<string, DiffEntry> {
  const old_type = get_value_type(old_val)
  const new_type = get_value_type(new_val)
  const mark_changed = () =>
    result.set(current_path, {
      status: `changed`,
      path: current_path,
      old_value: old_val,
      new_value: new_val,
    })

  // Different types = changed
  if (old_type !== new_type) {
    mark_changed()
    return result
  }

  // Both primitive: compare values (values_equal treats NaN === NaN)
  if (is_primitive_type(old_type)) {
    if (!values_equal(old_val, new_val)) mark_changed()
    return result
  }

  // Non-expandable special types (date, regexp, etc): compare string forms
  if (!is_expandable_type(old_type)) {
    if (String(old_val) !== String(new_val)) mark_changed()
    return result
  }

  // Prevent circular references
  if (seen.has(old_val as object)) return result
  seen.add(old_val as object)

  // Objects diff by key; arrays, Maps and Sets diff by index (Map entries wrapped as
  // { key, value }, matching how get_children renders them)
  const old_children = new Map(get_children(old_val).map(({ key, value }) => [key, value]))
  const new_children = new Map(get_children(new_val).map(({ key, value }) => [key, value]))
  for (const key of new Set([...old_children.keys(), ...new_children.keys()])) {
    const child_path = build_path(current_path, key)
    if (!old_children.has(key)) {
      result.set(child_path, {
        status: `added`,
        path: child_path,
        new_value: new_children.get(key),
      })
    } else if (!new_children.has(key)) {
      result.set(child_path, {
        status: `removed`,
        path: child_path,
        old_value: old_children.get(key),
      })
    } else {
      compute_diff(old_children.get(key), new_children.get(key), child_path, result, seen)
    }
  }
  return result
}
