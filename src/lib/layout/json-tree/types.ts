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
  copy_value: (path: string, value: unknown) => Promise<void>
  copy_path: (path: string) => Promise<void>
  register_path: (path: string) => void
  unregister_path: (path: string) => void
}

// Context key for Svelte's setContext/getContext
export const JSON_TREE_CONTEXT_KEY = Symbol(`json-tree-context`)
