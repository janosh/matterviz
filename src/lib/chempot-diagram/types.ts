import type { D3InterpolateName } from '$lib/colors'
import type { PhaseData } from '$lib/convex-hull/types'

// Per-element chemical potential bounds [min, max] in eV
// Default is [-50, 0] matching pymatgen
export type ChemPotLimits = Partial<Record<string, [number, number]>>

export type ChemPotColorMode =
  | `none`
  | `energy`
  | `formation_energy`
  | `arity`
  | `entries`

// Visual and behavioral configuration for the diagram
export interface ChemPotDiagramConfig {
  // Plot formal (reference) chemical potentials mu_X - mu_X^0, or absolute DFT energies mu_X
  formal_chempots?: boolean // default true
  // Lower bound for unspecified element limits (eV)
  default_min_limit?: number // default -50
  // Padding (eV) to trim default_min_limit bounding box for cleaner plots
  element_padding?: number // default 1.0
  // Whether to label stable phases by formula
  label_stable?: boolean // default true
  // Which 2 or 3 elements to use as axes (default: first 2 or 3 from entries)
  elements?: string[]
  // Per-element chemical potential bounds
  limits?: ChemPotLimits
  // 3D only: overlay domains for specified formulas (can be from other chemical systems)
  formulas_to_draw?: string[]
  draw_formula_meshes?: boolean // default true
  draw_formula_lines?: boolean // default true
  formula_colors?: string[] // default Dark2 palette
  show_tooltip?: boolean // default true
  tooltip_detail_level?: `compact` | `detailed` // default detailed
  // Region coloring mode for 3D diagram
  color_mode?: ChemPotColorMode // default none
  // D3 interpolator for continuous color scales (energy, formation_energy, entries)
  color_scale?: D3InterpolateName // default interpolateSpectral
  // Reverse the color scale direction
  reverse_color_scale?: boolean // default true
  // Enable linear interpolation for temperatures not in the data (default: true)
  interpolate_temperature?: boolean
  // Maximum temperature gap (Kelvin) allowed for interpolation (default: 500)
  max_interpolation_gap?: number
}

// Computed chemical potential diagram data
export interface ChemPotDiagramData {
  // Stability domains keyed by reduced formula
  domains: Record<string, number[][]>
  // Sorted element list for this diagram
  elements: string[]
  // Elemental reference entries keyed by element symbol
  el_refs: Record<string, PhaseData>
  // Minimum-energy entries per composition
  min_entries: PhaseData[]
  // Hyperplane data: rows of [x_1, ..., x_n, -E_per_atom]
  hyperplanes: number[][]
  // Entries corresponding to hyperplanes (same order)
  hyperplane_entries: PhaseData[]
  // Axis limits array: [[min, max], ...] per element
  lims: [number, number][]
}

export interface ChemPotHoverPointer {
  x: number
  y: number
}

export interface ChemPotHoverInfoBase {
  formula: string
  view: `2d` | `3d`
  pointer?: ChemPotHoverPointer
}

export interface AxisRangeData {
  element: string
  min_val: number
  max_val: number
}

export interface ChemPotHoverInfo2D extends ChemPotHoverInfoBase {
  view: `2d`
  n_points: number
  axis_ranges: AxisRangeData[]
}

export interface ChemPotHoverInfo3D extends ChemPotHoverInfoBase {
  view: `3d`
  n_vertices: number
  n_edges: number
  n_points: number
  ann_loc: number[]
  axis_ranges: AxisRangeData[]
  touches_limits: string[]
  is_elemental: boolean
  is_draw_formula: boolean
  matching_entry_count: number
  min_energy_per_atom: number | null
  max_energy_per_atom: number | null
  neighbors: string[]
}

export type ChemPotHoverInfo = ChemPotHoverInfo2D | ChemPotHoverInfo3D

// Default configuration values
export const CHEMPOT_DEFAULTS = {
  formal_chempots: true,
  default_min_limit: -50,
  element_padding: 1.0,
  label_stable: true,
  draw_formula_meshes: true,
  draw_formula_lines: true,
  show_tooltip: true,
  tooltip_detail_level: `detailed`,
  color_mode: `formation_energy` as ChemPotColorMode,
  color_scale: `interpolateSpectral` as D3InterpolateName,
  reverse_color_scale: true,
  interpolate_temperature: true,
  max_interpolation_gap: 500,
  // Dark2 qualitative palette (same as pymatgen/plotly default)
  formula_colors: [
    `#1b9e77`,
    `#d95f02`,
    `#7570b3`,
    `#e7298a`,
    `#66a61e`,
    `#e6ab02`,
    `#a6761d`,
    `#666666`,
  ],
} as const
