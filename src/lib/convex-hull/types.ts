import type { CompositionType } from '#lib/composition/index.js'
import type { ElementSymbol } from '#lib/element/index.js'
import type { Point2D, Point3D } from '#lib/math.js'
import type { AnyStructure } from '#lib/structure/index.js'
import type { FileLoadData } from '#lib/io/types.js'

export interface StructurePopupStats {
  id?: string
  formula?: string
  e_above_hull?: number
  e_form?: number
}

export interface StructurePopupContext {
  structure: AnyStructure
  stats?: StructurePopupStats
  formula_html: string
}

// Unified convex hull entry interface supporting both pymatgen and Materials Project formats
export interface PhaseData {
  // Core required fields
  composition: CompositionType
  energy?: number // total eV, absent for E_form-only entries
  entry_id?: string

  // Common computed fields
  e_above_hull?: number
  is_stable?: boolean
  exclude_from_hull?: boolean // If true, entry is shown but neither builds the hull nor serves as a formation-energy reference
  energy_per_atom?: number
  e_form_per_atom?: number // Formation energy per atom from src/scripts/fetch_mp_pd_data.py
  reduced_formula?: string
  name?: string

  // Temperature-dependent free energies (replaces `energy` at selected T)
  temperatures?: readonly number[] // in Kelvin, use integers for exact matching
  free_energies?: readonly number[] // G(T) in eV/atom (not a total like `energy`), same length as temperatures
  // A^3/atom; lets the ternary T-x diagram estimate G(T) with the Bartel 2018 SISSO
  // descriptor when no free_energies are given (also read from structure.lattice.volume)
  volume_per_atom?: number

  // Pymatgen-specific fields (optional)
  '@module'?: string
  '@class'?: string
  correction?: number
  energy_adjustments?: readonly Readonly<Record<string, number>>[]
  parameters?: Record<string, unknown>
  data?: Record<string, unknown>
  structure?: Record<string, unknown>

  gas?: GasSpecies // only on gas phases apply_gas_corrections adds at mu(T, p)

  // Materials Project-specific fields (optional)
  attributes?: Record<string, unknown>

  // Free-form strings ('ferromagnetic') normalize via MAGNETIC_ORDERING_CATEGORY aliases;
  // unrecognized values are ignored
  magnetic_ordering?: MagneticOrdering | (string & {})
}

// on_file_load payload of the phase-entry viewers: a dropped file's entries and its source
export type PhaseEntriesLoadData = FileLoadData & { entries: PhaseData[]; filename: string }

// === Entry categories (generic categorical classification) ===

// Any categorical entry property (magnetic ordering by default, electronic class,
// crystallinity, ...) rendered as marker shapes with filter toggles in the controls pane
export interface EntryCategoryConfig {
  label: string // controls-pane row + tooltip label, e.g. 'Magnetic', 'Electronic', 'Structure'
  // Entry properties holding the category value, checked in order. Each property is
  // looked up top-level, then in the pymatgen `data` and MP `attributes` dicts.
  property: string | string[]
  // Category value -> marker shape. Key order defines toggle display order. Raw values
  // match case-insensitively; unrecognized values are ignored (default marker, never
  // filtered). Explicit entry.marker values take precedence over this mapping.
  markers: Record<string, MarkerSymbol>
  labels?: Record<string, string> // optional long names for toggle/tooltip hints
  aliases?: Record<string, string> // lowercase alias -> canonical value, e.g. { ferromagnetic: 'FM' }
}

// Magnetic ordering classifications (matching Materials Project conventions)
export type MagneticOrdering = `FM` | `FiM` | `AFM` | `NM`

// Built-in preset for magnetic orderings (MP/pymatgen conventions) and the default
// entry_category of all convex hull components: entries carrying magnetic_ordering
// (or an MP-style `ordering` field) auto-render as shape-coded points with filter toggles
export const MAGNETIC_ORDERING_CATEGORY: EntryCategoryConfig = {
  label: `Magnetic`,
  property: [`magnetic_ordering`, `ordering`],
  markers: { FM: `triangle`, FiM: `diamond`, AFM: `square`, NM: `circle` },
  // oxfmt-ignore
  labels: { FM: `Ferromagnetic`, FiM: `Ferrimagnetic`, AFM: `Antiferromagnetic`, NM: `Non-magnetic` },
  // oxfmt-ignore
  aliases: { ferromagnetic: `FM`, ferrimagnetic: `FiM`, antiferromagnetic: `AFM`, 'non-magnetic': `NM`, nonmagnetic: `NM`, diamagnetic: `NM` },
}

// Entries with normalized composition keys plus the sorted elements they span
export interface ProcessedPhaseData {
  entries: PhaseData[]
  elements: ElementSymbol[]
}

export type MarkerSymbol = // Marker symbol types for convex hull entries
  `circle` | `star` | `triangle` | `cross` | `diamond` | `square` | `wye`

// Hull face coloring modes for 3D/4D convex hull visualizations
export const HULL_FACE_COLOR_MODES = [
  `uniform`, // Single user-selected color (default)
  `formation_energy`, // Color by average formation energy of face vertices
  `dominant_element`, // Color by element with highest concentration at centroid
  `facet_index`, // Distinct categorical color per facet
] as const
export type HullFaceColorMode = (typeof HULL_FACE_COLOR_MODES)[number]

// Plot entry with 3D coordinates for quaternary diagrams
export interface ConvexHullEntry extends PhaseData, Point3D {
  is_element: boolean
  // E_form = 0 corner closing the hull where no unary anchors it, left out of phase counts
  is_synthetic?: boolean
  marker?: MarkerSymbol // Optional marker symbol override (default: circle)
}

// Configuration for convex hull display
export interface ConvexHullConfig {
  show_labels?: boolean
  show_hull?: boolean
  font_size?: number
  colors?: { stable?: string; unstable?: string }
}

// Point colours in stability mode (Okabe-Ito blue / orange), the one place they are spelled
export const DEFAULT_HULL_COLORS = { stable: `#0072B2`, unstable: `#E69F00` }

// Legend configuration
export interface ConvexHullControlsType {
  title?: string
  show_counts?: boolean
  show_label_controls?: boolean
}

// A composition placed on a hull at formation energy `e_form` (eV/atom; unused in 4D)
export interface HullMark {
  composition: CompositionType
  e_form: number
  label?: string
  color?: string
}

// Annotations a linked view draws over a hull, e.g. a precursor tie-line or a hovered point
export interface HullAnnotations {
  lines?: { from: HullMark; to: HullMark; color?: string }[]
  marks?: HullMark[]
}

// Annotations resolved to plot coordinates
export interface HullOverlay {
  segments: { from: Point3D; to: Point3D; color: string; dashed: boolean }[]
  rings: { at: Point3D; color: string; label?: string }[]
}

// Hover data for tooltips
export interface HoverData3D<T = ConvexHullEntry> {
  entry: T
  position: Point2D
}

// Phase statistics
export interface PhaseStats {
  total: number
  unary: number
  binary: number
  ternary: number
  quaternary: number
  quinary_plus: number
  stable: number
  unstable: number
  // Formation energy distribution (eV/atom), null when no entry has a formation energy
  e_form_range: { min: number; max: number; avg: number } | null
  hull_distance: { max: number; avg: number }
  elements: number
  chemical_system: string
  // Largest arity counted (higher counts are zeroed), which picks the arity rows to show
  max_arity: number
}

// Numeric arity-count fields in PhaseStats, Extract-ed to stay in sync with it
export type PhaseArityField = Extract<
  keyof PhaseStats,
  `unary` | `binary` | `ternary` | `quaternary` | `quinary_plus`
>

// Highlight styles for convex hull entries
export interface HighlightStyle {
  effect?: `pulse` | `glow` | `size` | `color` | `both`
  color?: string
  size_multiplier?: number
  opacity?: number
  pulse_speed?: number
}

// --- Gas Phase Thermodynamics ---

// Default temperature (Kelvin) for gas corrections when no temperature is specified
export const DEFAULT_GAS_TEMP = 300

// Supported gas species for chemical potential calculations and iteration
export const GAS_SPECIES = [`O2`, `N2`, `H2`, `CO`, `CO2`, `H2O`, `F2`] as const
export type GasSpecies = (typeof GAS_SPECIES)[number]

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

// Source of gas thermodynamic data, so callers can swap in their own tables
export interface GasThermodynamicsProvider {
  // Standard chemical potential μ°(T) at reference pressure P₀ = 1 bar, in eV PER ATOM of
  // the gas (μ per molecule divided by its atom count), on the 0 K enthalpy scale
  get_standard_chemical_potential(gas: GasSpecies, temperature: number): number
}

// Configuration for gas thermodynamics in convex hull calculations
export interface GasThermodynamicsConfig {
  enabled_gases?: GasSpecies[] // default: none
  pressures?: Partial<Record<GasSpecies, number>> // bar, default: DEFAULT_GAS_PRESSURES
  provider?: GasThermodynamicsProvider // default: built-in data
}

// Result of analyzing entries for gas-dependent data
export interface GasAnalysis {
  // Enabled gases made only of the system's elements (empty: the atmosphere changes nothing)
  relevant_gases: GasSpecies[]
}
