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
  e_form_per_atom?: number // Formation energy per atom from fetch-mp-pd-data.py
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
  unstable_threshold?: number // eV/atom threshold for showing unstable entries
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
export interface PDControlsType {
  title?: string
  show?: boolean
  position?: `top-left` | `top-right` | `bottom-left` | `bottom-right`
  width?: number
  show_counts?: boolean
  show_color_toggle?: boolean
  show_label_controls?: boolean
}

// Plane equation: normal·p + offset = 0
export interface Plane {
  normal: Point3D
  offset: number
}

// Internal face structure for Quickhull algorithm
export interface ConvexHullFace {
  vertices: [number, number, number]
  plane: Plane
  centroid: Point3D
  outside_points: Set<number>
}

// Convex hull triangle with actual coordinate vertices (return type from compute_quickhull_triangles)
export interface ConvexHullTriangle {
  vertices: [Point3D, Point3D, Point3D]
  normal: Point3D
  centroid: Point3D
}

// Convex hull face for ternary 3D rendering (legacy interface - kept for backward compatibility)
export interface ConvexHullFace {
  vertices: number[] // indices into plot_entries array
  normal: Point3D // face normal vector for lighting
  centroid: Point3D // face center point
  is_stable: boolean // whether this face is on the stable hull
}

// Ternary plot entry with additional face information
export interface TernaryPlotEntry extends PlotEntry3D {
  // Barycentric coordinates for ternary system
  barycentric: [number, number, number]
  // Formation energy for z-axis positioning
  formation_energy: number
}

// Hover data for tooltips
export interface HoverData3D<T = PlotEntry3D> {
  entry: T
  position: { x: number; y: number }
}

// Arity helpers (inlined from former arity.ts)
export function get_arity(entry: PhaseEntry) {
  return Object.values(entry.composition).filter((v) => v > 0).length
}

export const is_elemental_entry = (entry: PhaseEntry) => get_arity(entry) === 1
export const is_binary_entry = (entry: PhaseEntry) => get_arity(entry) === 2
export const is_ternary_entry = (entry: PhaseEntry) => get_arity(entry) === 3
export const is_quaternary_entry = (entry: PhaseEntry) => get_arity(entry) === 4
export const is_quinary_entry = (entry: PhaseEntry) => get_arity(entry) === 5
export const is_senary_entry = (entry: PhaseEntry) => get_arity(entry) === 6
export const is_septenary_entry = (entry: PhaseEntry) => get_arity(entry) === 7
export const is_octonary_entry = (entry: PhaseEntry) => get_arity(entry) === 8
export const is_nonary_entry = (entry: PhaseEntry) => get_arity(entry) === 9
export const is_denary_entry = (entry: PhaseEntry) => get_arity(entry) === 10
