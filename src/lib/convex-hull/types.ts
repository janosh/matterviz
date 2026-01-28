import type { CompositionType } from '$lib/composition'
import type { ShowControlsProp } from '$lib/controls'
import type { ElementSymbol } from '$lib/element'
import type { Sides } from '$lib/plot'
import type { Vec3 } from '$lib/math'

// Unified convex hull entry interface supporting both pymatgen and Materials Project formats
export interface PhaseData {
  // Core required fields
  composition: CompositionType
  energy: number
  entry_id?: string

  // Common computed fields
  e_above_hull?: number
  is_stable?: boolean
  energy_per_atom?: number
  e_form_per_atom?: number // Formation energy per atom from fetch-mp-pd-data.py
  reduced_formula?: string
  name?: string

  // Temperature-dependent free energies (replaces `energy` at selected T)
  temperatures?: number[] // in Kelvin, use integers for exact matching
  free_energies?: number[] // G(T) in eV, same length as temperatures

  // Pymatgen-specific fields (optional)
  '@module'?: string
  '@class'?: string
  correction?: number
  energy_adjustments?: Record<string, number>[]
  parameters?: Record<string, unknown>
  data?: Record<string, unknown>
  structure?: Record<string, unknown>

  // Materials Project-specific fields (optional)
  attributes?: Record<string, unknown>
}

// Processed phase data for convex hull calculations
export interface ProcessedPhaseData {
  entries: PhaseData[]
  stable_entries: PhaseData[]
  unstable_entries: PhaseData[]
  elements: ElementSymbol[]
  el_refs: Record<string, PhaseData>
}

export interface Point2D {
  x: number
  y: number
}

// 3D point for tetrahedral coordinates
export interface Point3D extends Point2D {
  z: number
}

export type MarkerSymbol = // Marker symbol types for convex hull entries
  | `circle`
  | `star`
  | `triangle`
  | `cross`
  | `diamond`
  | `square`
  | `wye`

// Plot entry with 3D coordinates for quaternary diagrams
export interface ConvexHullEntry extends PhaseData, Point3D {
  is_element: boolean
  size?: number
  visible: boolean
  marker?: MarkerSymbol // Optional marker symbol override (default: circle)
}

// Configuration for convex hull display
export interface ConvexHullConfig {
  width?: number
  height?: number
  margin?: Sides
  unstable_threshold?: number // eV/atom threshold for showing unstable entries
  show_labels?: boolean
  show_hull?: boolean
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
export interface ConvexHullControlsType {
  title?: string
  show?: ShowControlsProp
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
  vertices: Vec3
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

// Hover data for tooltips
export interface HoverData3D<T = ConvexHullEntry> {
  entry: T
  position: { x: number; y: number }
}

// Phase statistics
export interface PhaseStats {
  total: number
  unary: number
  binary: number
  ternary: number
  quaternary: number
  stable: number
  unstable: number
  energy_range: { min: number; max: number; avg: number }
  hull_distance: { max: number; avg: number }
  elements: number
  chemical_system: string
}

// Arity helpers (inlined from former arity.ts)
export const get_arity = (entry: PhaseData): number =>
  Object.values(entry.composition).filter((count) => count > 0).length

export const is_unary_entry = (entry: PhaseData) => get_arity(entry) === 1
export const is_binary_entry = (entry: PhaseData) => get_arity(entry) === 2
export const is_ternary_entry = (entry: PhaseData) => get_arity(entry) === 3
export const is_quaternary_entry = (entry: PhaseData) => get_arity(entry) === 4
export const is_quinary_entry = (entry: PhaseData) => get_arity(entry) === 5
export const is_senary_entry = (entry: PhaseData) => get_arity(entry) === 6
export const is_septenary_entry = (entry: PhaseData) => get_arity(entry) === 7
export const is_octonary_entry = (entry: PhaseData) => get_arity(entry) === 8
export const is_nonary_entry = (entry: PhaseData) => get_arity(entry) === 9
export const is_denary_entry = (entry: PhaseData) => get_arity(entry) === 10

// Highlight styles for convex hull entries
export interface HighlightStyle {
  effect?: `pulse` | `glow` | `size` | `color` | `both`
  color?: string
  size_multiplier?: number
  opacity?: number
  pulse_speed?: number
}

// --- Gas Phase Thermodynamics ---

// Supported gas species for chemical potential calculations
export type GasSpecies = `O2` | `N2` | `H2` | `CO` | `CO2` | `H2O` | `F2`

// All supported gas species as an array (for iteration)
export const GAS_SPECIES: readonly GasSpecies[] = [
  `O2`,
  `N2`,
  `H2`,
  `CO`,
  `CO2`,
  `H2O`,
  `F2`,
] as const

// Default atmospheric partial pressures (in bar)
export const DEFAULT_GAS_PRESSURES: Readonly<Record<GasSpecies, number>> = {
  O2: 0.2095, // ~21% in atmosphere
  N2: 0.7809, // ~78% in atmosphere
  H2: 0.1, // typical experimental
  CO: 1e-6, // trace
  CO2: 3.95e-4, // ~400 ppm in atmosphere
  H2O: 0.03, // ~3% humidity
  F2: 0.1, // typical experimental
}

// Interface for providing gas thermodynamic data (abstracted for privacy)
export interface GasThermodynamicsProvider {
  // Get standard chemical potential μ°(T) at reference pressure P₀=1 bar
  // Returns value in eV/molecule (not per atom)
  get_standard_chemical_potential(gas: GasSpecies, T: number): number

  // Get list of supported gas species
  get_supported_gases(): GasSpecies[]

  // Get valid temperature range [T_min, T_max] in Kelvin
  get_temperature_range(): [number, number]
}

// Configuration for gas thermodynamics in convex hull calculations
export interface GasThermodynamicsConfig {
  // Which gas species to enable (default: none)
  enabled_gases?: GasSpecies[]

  // Partial pressures for each gas (in bar, default: DEFAULT_GAS_PRESSURES)
  pressures?: Partial<Record<GasSpecies, number>>

  // Custom thermodynamic data provider (default: built-in data)
  provider?: GasThermodynamicsProvider

  // Element mapping: which elements are derived from which gases
  // e.g., { O: 'O2', N: 'N2' } means O comes from O2 gas, N from N2 gas
  // Default mapping is inferred from gas formula (O2 -> O, N2 -> N, etc.)
  element_to_gas?: Partial<Record<string, GasSpecies>>
}

// Result of analyzing entries for gas-dependent data
export interface GasAnalysis {
  // Whether any enabled gas affects the chemical system
  has_gas_dependent_elements: boolean
  // Elements that come from gas phases
  gas_elements: string[]
  // Gas species that are relevant for this system
  relevant_gases: GasSpecies[]
}
