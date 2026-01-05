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

// Complete diagram data structure
export interface PhaseDiagramData {
  components: [string, string] // e.g., ["A", "B"] or ["Cu", "Ni"]
  temperature_range: Vec2 // [min, max] in Kelvin or Celsius
  temperature_unit?: TempUnit
  composition_unit?: CompUnit
  regions: PhaseRegion[]
  boundaries: PhaseBoundary[]
  special_points?: SpecialPoint[]
  title?: string
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

// =============================================================================
// Ternary Phase Diagram Types (3-component systems)
// =============================================================================

// Ternary composition as [comp_A, comp_B, comp_C] where A + B + C = 1
export type TernaryComposition = [number, number, number]

// Ternary vertex: composition + temperature [comp_A, comp_B, comp_C, T]
export type TernaryVertex = [number, number, number, number]

// Ternary phase region - 3D polyhedron in composition-temperature space
export interface TernaryPhaseRegion {
  id: string
  name: string // e.g., "Liquid", "α + β + γ"
  // Polyhedron vertices: [comp_A, comp_B, comp_C, T] where A+B+C=1
  vertices: TernaryVertex[]
  faces: number[][] // Triangle indices into vertices
  color?: string
  label_position?: TernaryVertex // Override centroid
}

// Ternary phase boundary surface
export interface TernaryPhaseBoundary {
  id: string
  type: BoundaryType
  vertices: TernaryVertex[]
  faces: number[][]
  style?: { color?: string; opacity?: number }
}

// Ternary special point types (extends binary types)
export type TernarySpecialPointType =
  | SpecialPointType
  | `ternary_eutectic`
  | `ternary_peritectic`
  | `ternary_eutectoid`

// Ternary special point (invariant reactions)
export interface TernarySpecialPoint {
  id: string
  type: TernarySpecialPointType
  position: TernaryVertex // [comp_A, comp_B, comp_C, T]
  label?: string
}

// Complete ternary diagram data structure
export interface TernaryPhaseDiagramData {
  components: [string, string, string] // e.g., ["Fe", "Cr", "Ni"]
  temperature_range: Vec2 // [T_min, T_max]
  temperature_unit?: TempUnit
  composition_unit?: CompUnit
  regions: TernaryPhaseRegion[]
  boundaries?: TernaryPhaseBoundary[]
  special_points?: TernarySpecialPoint[]
  title?: string
}

// Result of isothermal slicing (horizontal cut at constant T)
export interface IsothermalSlice {
  temperature: number
  regions: IsothermalSliceRegion[]
}

export interface IsothermalSliceRegion {
  id: string
  name: string
  vertices: TernaryComposition[] // 2D polygon in ternary composition space
  color?: string
}

// Result of vertical slicing (pseudo-binary section at constant A:B ratio)
export interface VerticalSlice {
  ratio: number // A/(A+B) ratio, 0 to 1
  fixed_components: [string, string] // e.g., ["Fe", "Cr"]
  variable_component: string // e.g., "Ni"
  regions: VerticalSliceRegion[]
}

export interface VerticalSliceRegion {
  id: string
  name: string
  vertices: Vec2[] // [composition_C, T] 2D polygon
  color?: string
}

// Hover info for ternary regions
export interface TernaryPhaseHoverInfo {
  region: TernaryPhaseRegion
  composition: TernaryComposition
  temperature: number
  position: { x: number; y: number } // screen coordinates
  special_point?: TernarySpecialPoint
}

// Configuration for ternary phase diagram display
export interface TernaryPhaseDiagramConfig {
  margin?: Sides
  font_size?: number
  special_point_radius?: number
  region_opacity?: number
  colors?: {
    background?: string
    grid?: string
    axis?: string
    text?: string
    boundary?: string
    special_point?: string
    slice_plane?: string
  }
}

// =============================================================================
// Ternary Stacked Slices Data (for rendering as stacked 2D layers)
// =============================================================================

// A single isothermal slice with 2D polygons for each phase
export interface TernaryIsothermalSection {
  temperature: number
  phases: TernarySlicePhase[]
}

// A phase region within an isothermal slice (2D ternary polygon)
export interface TernarySlicePhase {
  id: string
  name: string
  // 2D vertices in barycentric coordinates [comp_A, comp_B, comp_C] where A+B+C≈1
  vertices: TernaryComposition[]
  color?: string
}

// Stacked slices data format - alternative to complex 3D polyhedra
export interface TernaryStackedData {
  components: [string, string, string]
  temperature_range: Vec2
  temperature_unit?: TempUnit
  composition_unit?: CompUnit
  // Array of isothermal sections at different temperatures
  slices: TernaryIsothermalSection[]
  special_points?: TernarySpecialPoint[]
  title?: string
}
