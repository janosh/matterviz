import type { ChemicalElement, ElementSymbol } from '$lib/element'
import { element_data } from '$lib/element'
import type { Snippet } from 'svelte'

// Key format for color_overrides lookups: `${x_key}\0${y_key}`
export const make_color_override_key = (x_key: string, y_key: string): string =>
  `${x_key}\0${y_key}`

// === Types ===

// Generic axis item -- works for elements, compositions, structures, etc.
// T defaults to Record<string, unknown> but can be narrowed (e.g. ChemicalElement)
export type AxisItem<T = Record<string, unknown>> = {
  label: string // display text (e.g. element symbol "Fe")
  key?: string // unique identifier, defaults to label
  sort_value?: number // numeric value used for sorting (set by ordering)
  category?: string // optional grouping (for label coloring)
  data?: T // arbitrary metadata
}
export const axis_key = (item: AxisItem): string => item.key ?? item.label

export type CellValue = number | string | null
// values[y_idx][x_idx], or nested records keyed by item key (y then x)
export type HeatmapValues = CellValue[][] | Record<string, Record<string, CellValue>>

// Resolve either `values` shape by cell index; missing entries read as null
export const cell_value_getter = (
  values: HeatmapValues,
  x_items: AxisItem[],
  y_items: AxisItem[],
): ((x_idx: number, y_idx: number) => CellValue) => {
  if (Array.isArray(values)) return (x_idx, y_idx) => values[y_idx]?.[x_idx] ?? null
  const x_keys = x_items.map(axis_key)
  const y_keys = y_items.map(axis_key)
  return (x_idx, y_idx) => values[y_keys[y_idx]]?.[x_keys[x_idx]] ?? null
}

// Context passed to tooltip, cell, and event handler snippets
export type CellContext = {
  x_item: AxisItem
  y_item: AxisItem
  x_idx: number
  y_idx: number
  value: CellValue
  bg_color: string | null
}

// styling for heatmap cells/tiles with no value (null/non-finite, non-color strings, or
// <=0 in log mode). Shared by HeatmapMatrix and PeriodicTable.
export interface MissingCellStyle {
  // fill for missing cells: any CSS color, or `element-category` for the item's category
  // color (only honored by category-aware tables like PeriodicTable)
  color?: `element-category` | (string & {})
  // text shown on missing cells (e.g. `N/A`); by default they show no value
  label?: string
  // arbitrary extra CSS applied to missing cells (e.g. `opacity: 0.4` to dim them)
  style?: string
}

// Human-readable labels for built-in orderings
export const ORDERING_LABELS = {
  atomic_number: `Atomic Number`,
  mendeleev_number: `Pettifor Chemical Similarity`,
  alphabetical: `Alphabetical`,
  atomic_mass: `Atomic Mass`,
  electronegativity: `Pauling Electronegativity`,
  first_ionization: `Ionization Energy`,
  melting_point: `Melting Point`,
  atomic_radius: `Atomic Radius`,
  density: `Density`,
  n_valence: `Valence Electrons`,
} as const

// String-only ordering key, derived from ORDERING_LABELS to avoid duplication
export type ElementAxisOrderingKey = keyof typeof ORDERING_LABELS

// Full ordering type: built-in key or custom comparator function
type ElementAxisOrdering =
  | ElementAxisOrderingKey
  | ((a: ChemicalElement, b: ChemicalElement) => number)

// Shared types used by both HeatmapMatrix and HeatmapMatrixControls. Prefixed because
// bond-angles has its own NormalizeMode and both modules are star-exported from $lib.
export type HeatmapNormalizeMode = `linear` | `log`
// auto: data min/max; robust: 2nd-98th percentile; fixed: color_scale_range as given
export type HeatmapDomainMode = `auto` | `robust` | `fixed`
export type ColorBarPosition = `right` | `bottom`
export type SymmetricMode = false | `lower` | `upper`

// Tooltip snippet type for HeatmapMatrix
export type HeatmapTooltipProp = Snippet<[CellContext]> | boolean
export type HeatmapExportFormat = `csv` | `json`

// All built-in string ordering keys
export const ELEMENT_ORDERINGS = Object.keys(ORDERING_LABELS) as ElementAxisOrderingKey[]

export function matrix_to_rows(
  x_items: AxisItem[],
  y_items: AxisItem[],
  values: HeatmapValues,
): Record<string, CellValue>[] {
  const get_value = cell_value_getter(values, x_items, y_items)
  return y_items.map((y_item, y_idx) => {
    const row: Record<string, CellValue> = { y_key: axis_key(y_item) }
    for (const [x_idx, x_item] of x_items.entries()) {
      row[axis_key(x_item)] = get_value(x_idx, y_idx)
    }
    return row
  })
}

// === Helpers ===

// Map ordering keys to ChemicalElement property names where they differ
const PROPERTY_MAP: Partial<Record<ElementAxisOrderingKey, keyof ChemicalElement>> = {
  atomic_number: `number`,
  electronegativity: `electronegativity_pauling`,
}

// Convert element data to axis items with a given ordering.
// Optionally filter to a subset of element symbols.
export function elements_to_axis(
  symbols?: ElementSymbol[],
  ordering: ElementAxisOrdering = `atomic_number`,
): AxisItem<ChemicalElement>[] {
  let elements = [...element_data]

  if (symbols) {
    const symbol_set = new Set(symbols)
    elements = elements.filter((el) => symbol_set.has(el.symbol))
  }

  if (typeof ordering === `function`) {
    elements.sort(ordering)
  } else if (ordering === `alphabetical`) {
    elements.sort((a, b) => a.symbol.localeCompare(b.symbol))
  } else {
    // Number.MAX_VALUE, not Infinity (Infinity - Infinity is NaN), sorts nullish last
    const key = PROPERTY_MAP[ordering] ?? ordering
    const num = (el: ChemicalElement) =>
      (el[key as keyof ChemicalElement] ?? Number.MAX_VALUE) as number
    elements.sort((el_a, el_b) => num(el_a) - num(el_b))
  }

  return elements.map((el, idx) => ({
    label: el.symbol,
    key: el.symbol,
    sort_value: idx,
    category: el.category,
    data: el,
  }))
}

// === Component Exports ===

export { default as HeatmapMatrix } from './HeatmapMatrix.svelte'
export { default as HeatmapMatrixControls } from './HeatmapMatrixControls.svelte'
