import type { ElementSymbol } from '$lib'

// Unified phase diagram entry interface supporting both pymatgen and Materials Project formats
export interface PhaseEntry {
  // Core required fields
  composition: Record<string, number>
  energy: number
  entry_id?: string

  // Common computed fields
  e_above_hull?: number
  is_stable?: boolean
  energy_per_atom?: number
  formation_energy_per_atom?: number
  reduced_formula?: string
  name?: string

  // Pymatgen-specific fields (optional)
  '@module'?: string
  '@class'?: string
  correction?: number
  energy_adjustments?: unknown[]
  parameters?: Record<string, unknown>
  data?: Record<string, unknown>
  structure?: Record<string, unknown>

  // Materials Project-specific fields (optional)
  attributes?: Record<string, unknown>
}

// Legacy type aliases for backward compatibility
export type PDEntry = PhaseEntry
export type PymatgenEntry = PhaseEntry

// Processed phase diagram data
export interface PhaseDiagramData {
  entries: PhaseEntry[]
  stable_entries: PhaseEntry[]
  unstable_entries: PhaseEntry[]
  elements: ElementSymbol[]
  el_refs: Record<string, PhaseEntry>
}

// 3D point for tetrahedral coordinates
export interface Point3D {
  x: number
  y: number
  z: number
}

// Plot entry with 3D coordinates for quaternary diagrams
export interface PlotEntry3D extends PhaseEntry, Point3D {
  is_element: boolean
  size?: number
  visible: boolean
}

// Configuration for phase diagram display
export interface PhaseDiagramConfig {
  width?: number
  height?: number
  margin?: { top: number; right: number; bottom: number; left: number }
  show_unstable?: number // eV/atom threshold for showing unstable entries
  show_labels?: boolean
  show_hull?: boolean
  enable_zoom?: boolean
  enable_pan?: boolean
  enable_hover?: boolean
  point_size?: number
  line_width?: number
  font_size?: number
  colors?: {
    stable?: string
    unstable?: string
    hull_line?: string
    background?: string
    text?: string
    edge?: string
    tooltip_bg?: string
    tooltip_text?: string
    annotation?: string
  }
}

// Legend configuration
export interface PDLegendConfig {
  title?: string
  show?: boolean
  position?: `top-left` | `top-right` | `bottom-left` | `bottom-right`
  width?: number
  show_counts?: boolean
  show_color_toggle?: boolean
  show_label_controls?: boolean
}

// Hover data for tooltips
export interface HoverData3D {
  entry: PlotEntry3D
  position: { x: number; y: number }
}
