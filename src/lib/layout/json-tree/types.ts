// JSON Tree component types

// Value type classification for rendering and styling
export type JsonValueType =
  | `string`
  | `number`
  | `boolean`
  | `null`
  | `undefined`
  | `object`
  | `array`
  | `date`
  | `regexp`
  | `map`
  | `set`
  | `symbol`
  | `bigint`
  | `error`
  | `function`
  | `circular`

// Props for the main JsonTree component
export interface JsonTreeProps {
  // The data to display - can be any JSON-serializable value
  value: unknown
  // Optional label for the root node (if undefined, no root label shown)
  root_label?: string
  // Number of levels to expand by default (default: 2)
  default_fold_level?: number
  // Auto-collapse arrays longer than this (default: 10)
  auto_fold_arrays?: number
  // Auto-collapse objects with more keys than this (default: 20)
  auto_fold_objects?: number
  // Bindable set of collapsed paths for external control
  collapsed_paths?: Set<string>
  // Show header with search and expand/collapse controls (default: true)
  show_header?: boolean
  // Show type annotations next to values (default: false)
  show_data_types?: boolean
  // Show numeric indices for array items (default: true)
  show_array_indices?: boolean
  // Sort object keys alphabetically (default: false)
  sort_keys?: boolean
  // Maximum string length before truncation (default: 200)
  max_string_length?: number
  // Highlight values that change between renders (default: true)
  highlight_changes?: boolean
  // Callback when a node is selected/clicked
  onselect?: (path: string, value: unknown) => void
  // Callback when a value is copied
  oncopy?: (path: string, value: string) => void
  // Custom filename for JSON download (default: "data-YYYY-MM-DD.json")
  download_filename?: string
  // Optional value to diff against - highlights additions, removals, and changes
  compare_value?: unknown
  // Enable inline editing of leaf values (double-click to edit)
  editable?: boolean
  // Callback when a value is edited inline (path, new_value, old_value)
  onchange?: (path: string, new_value: unknown, old_value: unknown) => void
}

// Context shared with child components (state + methods)
export interface JsonTreeContext {
  settings: {
    default_fold_level: number
    auto_fold_arrays: number
    auto_fold_objects: number
    show_data_types: boolean
    show_array_indices: boolean
    sort_keys: boolean
    max_string_length: number
    highlight_changes: boolean
    editable: boolean
  }
  collapsed: Set<string>
  force_expanded: Set<string>
  search_query: string
  search_matches: Set<string>
  current_match_path: string | null
  focused_path: string | null
  previous_values: Map<string, unknown>
  toggle_collapse: (path: string, is_currently_collapsed: boolean) => void
  toggle_collapse_recursive: (path: string, collapse: boolean) => void
  expand_all: () => void
  collapse_all: () => void
  collapse_to_level: (level: number) => void
  set_focused: (path: string | null) => void
  copy_value: (path: string, value: unknown, event?: CopyEventPosition) => Promise<void>
  copy_path: (path: string, event?: CopyEventPosition) => Promise<void>
  register_path: (path: string) => void
  unregister_path: (path: string) => void
  show_context_menu: (
    event: MouseEvent,
    path: string,
    value: unknown,
    expandable: boolean,
    is_collapsed: boolean,
  ) => void
  pinned_paths: Set<string>
  toggle_pin: (path: string) => void
  selected_paths: Set<string>
  toggle_select: (path: string, shift: boolean) => void
  copy_selected: () => void
  diff_map: Map<string, DiffEntry> | null
  ghost_map: Map<string, import('./utils').GhostEntry[]>
  collapse_children_only: (path: string) => void
  onchange?: (path: string, new_value: unknown, old_value: unknown) => void
}

// Minimal position info for copy feedback (avoids partial MouseEvent mocks)
export type CopyEventPosition = { clientX: number; clientY: number }

// Context key for Svelte's setContext/getContext
export const JSON_TREE_CONTEXT_KEY = Symbol(`json-tree-context`)

// Diff status for comparing two JSON values
export type DiffStatus = `added` | `removed` | `changed`

// Single entry in a diff result (one path that differs between old and new)
export interface DiffEntry {
  status: DiffStatus
  path: string
  old_value?: unknown
  new_value?: unknown
}
