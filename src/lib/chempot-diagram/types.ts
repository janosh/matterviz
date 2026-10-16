import type { Point2D, Vec2 } from '#lib/math.js'
import type ColorBar from '#lib/plot/core/components/ColorBar.svelte'
import type { ColorScale, ColorScaleConfig } from '#lib/plot/core/types.js'
import type { ComponentProps } from 'svelte'
import type { TooltipProp } from '#lib/tooltip/index.js'

// Per-element chemical potential bounds [min, max] in eV
// Default is [-50, 0] matching pymatgen
type ChemPotLimits = Partial<Record<string, Vec2>>

export type ChemPotColorMode = `none` | `energy` | `formation_energy` | `arity` | `entries`

// For quaternary+ systems: "single" shows one 3D diagram with projection switcher,
// "grid" shows all C(n,3) ternary projections simultaneously
type ChemPotProjectionMode = `single` | `grid`

// Visual and behavioral configuration for the diagram
export interface ChemPotDiagramConfig {
  // Plot formal (reference) chemical potentials mu_X - mu_X^0, or absolute computed energies mu_X
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
  // Region coloring mode
  color_mode?: ChemPotColorMode // default formation_energy (2D) / arity (3D)
  // Color scale of the continuous modes (energy, formation_energy, entries). Unset fields
  // take the defaults: reversed Spectral (scheme interpolateSpectral, palette_range [1, 0];
  // pass palette_range [0, 1] to un-reverse); unset value_range ends fit the drawn domains.
  color_scale?: ColorScale
  // ColorBar props for the continuous modes' legend; null hides it
  color_bar?: Partial<ComponentProps<typeof ColorBar>> | null
  // Enable linear interpolation for temperatures not in the data (default: true)
  interpolate_temperature?: boolean
  // Maximum temperature gap (Kelvin) allowed for interpolation (default: 500)
  max_interpolation_gap?: number
  // For quaternary+ systems: show one diagram with projection switcher ("single")
  // or all C(n,3) ternary projections in a grid ("grid"). Default: "single"
  projection_mode?: ChemPotProjectionMode
  // Fix the chemical potentials (eV) of data elements outside `elements` to slice the diagram
  // there: exact cross-sections of the full N-D domains instead of the shadow projection
  // non-display elements get otherwise. Each value must lie within that element's limits.
  slice_chempots?: ChemPotSliceValues
}

export type ChemPotSliceValues = Partial<Record<string, number>>

// Halfspace system and N-D domains on every axis a view needs (see compute_chempot_system)
export interface ChemPotSystem {
  elements: string[]
  lims: Vec2[]
  // Entry rows [x_1, ..., x_n, -E_per_atom] meaning x·mu - E <= 0, named by `formulas`
  hyperplanes: number[][]
  formulas: string[]
  domains: Record<string, number[][]>
}

// Computed chemical potential diagram data
export interface ChemPotDiagramData {
  // Stability domains keyed by reduced formula
  domains: Record<string, number[][]>
  // Display elements (axis order) for this diagram
  elements: string[]
  // Axis limits array: [[min, max], ...] per element
  lims: Vec2[]
  // Elements neither displayed nor sliced, whose axis was dropped (shadow projection): the
  // domains are then projected polyhedra rather than the facets of one polytope
  shadow_elements: string[]
}

interface ChemPotHoverInfoBase {
  formula: string
  view: `2d` | `3d`
  pointer?: Point2D
  n_points: number
  axis_ranges: AxisRangeData[]
}

interface AxisRangeData {
  element: string
  min_val: number
  max_val: number
}

interface ChemPotHoverInfo2D extends ChemPotHoverInfoBase {
  view: `2d`
}

// An axis bound (limit) a domain is clipped against
export type ChemPotBound = { element: string; side: `lower` | `upper` }

export interface ChemPotHoverInfo3D extends ChemPotHoverInfoBase {
  view: `3d`
  n_vertices: number
  n_edges: number
  ann_loc: number[]
  touches_limits: ChemPotBound[]
  is_elemental: boolean
  is_draw_formula: boolean
  matching_entry_count: number
  min_energy_per_atom: number | null
  max_energy_per_atom: number | null
  neighbors: string[]
}

export type ChemPotHoverInfo = ChemPotHoverInfo2D | ChemPotHoverInfo3D

// detail_level `compact` drops the axis ranges, neighbours and bounds (default `detailed`)
export type ChemPotTooltipConfig = { detail_level?: `compact` | `detailed` }
export type ChemPotTooltipProp = TooltipProp<ChemPotHoverInfo, ChemPotTooltipConfig>

// Default configuration values
export const CHEMPOT_DEFAULTS = {
  formal_chempots: true,
  default_min_limit: -50,
  element_padding: 1.0,
  label_stable: true,
  draw_formula_meshes: true,
  draw_formula_lines: true,
  color_mode: `formation_energy` as ChemPotColorMode,
  color_scale: { scheme: `interpolateSpectral`, palette_range: [1, 0] } as ColorScaleConfig,
  interpolate_temperature: true,
  max_interpolation_gap: 500,
  projection_mode: `single` as ChemPotProjectionMode,
  slice_chempots: {} as ChemPotSliceValues,
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
