import type { ChemicalElement, ElementSymbol } from '$lib/element'
import { element_data } from '$lib/element'
import type { Snippet } from 'svelte'
export { COLOR_OVERRIDE_KEY_SEPARATOR, make_color_override_key } from './shared'

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

// Context passed to tooltip, cell, and event handler snippets
export type CellContext = {
  x_item: AxisItem
  y_item: AxisItem
  x_idx: number
  y_idx: number
  value: number | string | null
  bg_color: string | null
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
export type ElementAxisOrdering =
  | ElementAxisOrderingKey
  | ((a: ChemicalElement, b: ChemicalElement) => number)

// Tooltip snippet type for HeatmapMatrix
export type HeatmapTooltipProp = Snippet<[CellContext]> | boolean
export type HeatmapSelection = { x_idx: number; y_idx: number }
export type HeatmapExportFormat = `csv` | `json`
export type HeatmapBrushPayload = {
  x_range: [number, number]
  y_range: [number, number]
  cells: CellContext[]
}

// All built-in string ordering keys
export const ELEMENT_ORDERINGS = Object.keys(ORDERING_LABELS) as ElementAxisOrderingKey[]

export function matrix_to_rows(
  x_items: AxisItem[],
  y_items: AxisItem[],
  values:
    | (number | string | null)[][]
    | Record<string, Record<string, number | string | null>>,
): Record<string, number | string | null>[] {
  const get_value = Array.isArray(values)
    ? (x_idx: number, y_idx: number) => values[y_idx]?.[x_idx] ?? null
    : (x_idx: number, y_idx: number) => {
      const y_key = y_items[y_idx].key ?? y_items[y_idx].label
      const x_key = x_items[x_idx].key ?? x_items[x_idx].label
      return values[y_key]?.[x_key] ?? null
    }
  return y_items.map((y_item, y_idx) => {
    const row: Record<string, number | string | null> = {
      y_key: y_item.key ?? y_item.label,
    }
    for (const [x_idx, x_item] of x_items.entries()) {
      row[x_item.key ?? x_item.label] = get_value(x_idx, y_idx)
    }
    return row
  })
}

export function rows_to_csv(rows: Record<string, number | string | null>[]): string {
  if (!rows.length) return ``
  const escape_csv_field = (value: number | string | null | undefined): string => {
    const field = String(value ?? ``)
    if (!/[",\n\r]/.test(field)) return field
    return `"${field.replaceAll(`"`, `""`)}"`
  }
  const headers = Object.keys(rows[0])
  const lines = [
    headers.map((header) => escape_csv_field(header)).join(`,`),
    ...rows.map((row) =>
      headers.map((header) => escape_csv_field(row[header])).join(`,`)
    ),
  ]
  return lines.join(`\n`)
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

  // Filter to subset if specified
  if (symbols) {
    const symbol_set = new Set(symbols)
    elements = elements.filter((el) => symbol_set.has(el.symbol))
  }

  // Sort elements
  if (typeof ordering === `function`) {
    elements.sort(ordering)
  } else if (ordering === `alphabetical`) {
    elements.sort((a, b) => a.symbol.localeCompare(b.symbol))
  } else {
    // Sort by the named property, nulls/undefined last
    const key = PROPERTY_MAP[ordering] ?? ordering
    elements.sort((a, b) => {
      const val_a = (a[key as keyof ChemicalElement] ?? null) as number | null
      const val_b = (b[key as keyof ChemicalElement] ?? null) as number | null
      if (val_a === null && val_b === null) return 0
      if (val_a === null) return 1
      if (val_b === null) return -1
      return val_a - val_b
    })
  }

  // Convert to AxisItem[]
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
