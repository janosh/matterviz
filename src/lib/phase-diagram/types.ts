import type { Sides } from '$lib/plot'
import type { Vec2 } from '../math.ts'

export type TempUnit = `K` | `°C` | `°F`
export type CompUnit = `at%` | `wt%` | `mol%` | `fraction`

// Phase region with polygon vertices and metadata
export interface PhaseRegion {
  id: string
  name: string // e.g., "Liquid", "α + β", "α"
  vertices: Vec2[] // [composition, temperature] pairs defining the polygon
  color?: string
  // Optional text label position override (defaults to centroid)
  label_position?: Vec2
}

// Boundary curve types
export type BoundaryType =
  | `liquidus`
  | `solidus`
  | `solvus`
  | `eutectic`
  | `peritectic`
  | `tie-line`
  | `custom`

// Boundary curve between phases
export interface PhaseBoundary {
  id: string
  type: BoundaryType
  points: Vec2[] // [composition, temperature] pairs defining the curve
  style?: {
    color?: string
    width?: number
    dash?: string
  }
  label?: string
}

// Special point types (invariant reactions)
export type SpecialPointType =
  | `eutectic` // liquid → two solids (lowest melting point)
  | `peritectic` // liquid + solid → different solid
  | `eutectoid` // solid → two different solids
  | `peritectoid` // two solids → different solid
  | `congruent` // phase change without composition change
  | `melting_point` // pure element melting point at diagram edge
  | `custom`

// Special points (eutectic, peritectic, etc.)
export interface SpecialPoint {
  id: string
  type: SpecialPointType
  position: Vec2 // [composition, temperature]
  label?: string
}

// Metadata for pseudo-binary phase diagrams (vertical sections through ternary/higher systems)
export interface PseudoBinaryMetadata {
  // The full system being sectioned (e.g., ["Fe", "C", "Mn"] for Fe-Fe3C section)
  parent_system?: string[]
  // Description of the section (e.g., "Fe corner to Fe3C")
  section_description?: string
  // Whether to render chemical formulas with subscripts (default: true)
  use_subscripts?: boolean
}

// Complete diagram data structure
export interface PhaseDiagramData {
  // Components can be elements or compounds (e.g., ["Fe", "Fe3C"] for pseudo-binary)
  components: [string, string]
  temperature_range: Vec2 // [min, max] in Kelvin or Celsius
  temperature_unit?: TempUnit
  composition_unit?: CompUnit
  regions: PhaseRegion[]
  boundaries: PhaseBoundary[]
  special_points?: SpecialPoint[]
  title?: string
  // Pseudo-binary metadata - presence indicates this is a section through a higher-order system
  pseudo_binary?: PseudoBinaryMetadata
  // Custom axis labels (useful for pseudo-binary context or non-standard units)
  x_axis_label?: string
  y_axis_label?: string
}

// Tie-line display configuration
export interface TieLineConfig {
  stroke_width?: number
  endpoint_radius?: number
  cursor_radius?: number
}

// Configuration for phase diagram display
export interface PhaseDiagramConfig {
  margin?: Sides
  font_size?: number
  special_point_radius?: number
  tie_line?: TieLineConfig
  colors?: {
    background?: string
    grid?: string
    axis?: string
    text?: string
    boundary?: string
    special_point?: string
  }
}

// Lever rule calculation result for two-phase regions
export interface LeverRuleResult {
  left_phase: string // Name of phase on left side (lower composition)
  right_phase: string // Name of phase on right side (higher composition)
  left_composition: number // Composition at left phase boundary
  right_composition: number // Composition at right phase boundary
  fraction_left: number // Fraction of left phase (0-1)
  fraction_right: number // Fraction of right phase (0-1)
}

// Hover information returned when mouse is over a phase region
export interface PhaseHoverInfo {
  region: PhaseRegion
  composition: number
  temperature: number
  position: { x: number; y: number } // screen coordinates
  lever_rule?: LeverRuleResult // Only populated for two-phase regions
  special_point?: SpecialPoint // Populated when hovering near a special point
}

// Tooltip configuration object for prefix/suffix content
// Values can be static strings or functions that receive hover info for dynamic content
export interface PhaseDiagramTooltipConfig {
  prefix?: string | ((info: PhaseHoverInfo) => string)
  suffix?: string | ((info: PhaseHoverInfo) => string)
}
