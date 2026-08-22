// Isobaric ternary composition-temperature phase diagrams computed from candidate phases with
// temperature-dependent Gibbs energies. For a finite set of stoichiometric phases the lower hull
// at each T tiles the Gibbs triangle into tie-triangles and only changes at discrete transition
// temperatures, so a diagram is sampled isothermal sections plus the exact (bisected) list of
// those transitions.
import type { D3InterpolateName } from '$lib/colors'
import type { GasSpecies, GasThermodynamicsConfig, PhaseData } from '$lib/convex-hull/types'
import type { ElementSymbol } from '$lib/element'
import type { Vec2, Vec3 } from '$lib/math'

// === Free energy models ===

// tabulated: the entry's own temperatures/free_energies (per-atom G(T), interpolated)
// sisso: Bartel et al. 2018 descriptor G^delta(V, m, T) on the 0 K formation enthalpy with
//        experimental elemental references (needs a volume per atom)
// static: the 0 K energy
export type FreeEnergySource = `tabulated` | `sisso` | `static`
// auto picks per entry: tabulated if present, else sisso if a volume is known, else static
export type FreeEnergyMode = FreeEnergySource | `auto`

export interface FreeEnergyOptions {
  mode?: FreeEnergyMode
  // Gas atmospheres for elements supplied as gases (O from O2, ...); pressures in bar
  gas_config?: GasThermodynamicsConfig
  gas_pressures?: Partial<Record<GasSpecies, number>>
}

// Formation Gibbs energy of one phase vs temperature, eV/atom; NaN outside t_range
export interface PhaseFreeEnergy {
  source: FreeEnergySource
  t_range: Vec2 | null // null = defined everywhere
  dg_form: (temperature: number) => number // eV/atom, like PhaseData.free_energies
}

// === Computed diagram ===

export interface DiagramPhase {
  idx: number // index into phases and every per-phase array
  entry: PhaseData
  label: string // reduced formula
  barycentric: Vec3 // atomic fractions in `elements` order
  xy: Vec2 // position in the Gibbs triangle (TRIANGLE_VERTICES frame)
  n_atoms: number // atoms per reduced formula unit (reaction balancing)
  is_element: boolean
  source: FreeEnergySource
}

// Equilibrium assemblage of a composition: tie-triangle vertices with atom fractions
export interface Decomposition {
  phases: number[]
  fractions: number[]
}

export interface IsothermalSection {
  temperature: number
  dg_form: Float64Array // eV/atom per phase, NaN if undefined at T
  e_above_hull: Float64Array // eV/atom per phase, NaN if undefined at T
  stable: number[] // hull vertices, ascending
  facets: number[][] // tie-triangles as phase-index triples
  edges: Vec2[] // unique tie-lines as ascending pairs, sorted
}

export type ReactionSide = { phase: number; coeff: number }[] // per formula unit
// polymorph: a phase is replaced on the hull by another entry of the same composition
export type PhaseEventKind = `appear` | `vanish` | `polymorph` | `tie_line_flip`

// Balanced reaction in the heating direction (reactants stable below T, products above)
export interface Reaction {
  kind: PhaseEventKind
  reactants: ReactionSide
  products: ReactionSide
  phase?: number // the phase an appear/vanish/polymorph reaction is about
}

// One change of hull topology; `kind` is the dominant change, the diffs carry everything
export interface PhaseEvent {
  temperature: number
  kind: PhaseEventKind
  appeared: number[]
  vanished: number[]
  edges_added: Vec2[]
  edges_removed: Vec2[]
  reactions: Reaction[]
  stable_after: number[] // hull topology just above the transition
  facets_after: number[][]
}

export interface TernaryPhaseDiagram {
  elements: [ElementSymbol, ElementSymbol, ElementSymbol]
  phases: DiagramPhase[]
  temperatures: number[] // ascending sample grid
  sections: IsothermalSection[] // one per temperature
  events: PhaseEvent[] // ascending
  stability_windows: Vec2[][] // per phase: maximal [T_lo, T_hi] intervals on the hull
  t_range: Vec2
  sources: FreeEnergySource[] // distinct G(T) sources used
}

export interface TernaryPhaseDiagramOptions {
  temperatures?: number[] // explicit sample grid (K); else n_samples evenly over t_range
  // Defaults to where every elemental reference is defined (tabulated data, 300-2000 K for
  // SISSO) or 300-1500 K for static energies
  t_range?: Vec2
  n_samples?: number
  free_energy?: FreeEnergyOptions
  elements?: [ElementSymbol, ElementSymbol, ElementSymbol] // corner order, default by electronegativity
  event_tolerance?: number // bisect transitions to this width (K); 0 disables
}

export type DiagramProgress = { done: number; total: number }

// === Viewer ===

// Everything the controls pane toggles; compute settings (model, T range, gases) are separate
export interface TernaryDisplay {
  view: `section` | `prism`
  show_tie_lines: boolean
  show_tie_triangles: boolean
  face_color_mode: `uniform` | `formation_energy` | `facet_index`
  face_opacity: number
  show_unstable: boolean
  max_e_above_hull: number // eV/atom: unstable-phase cutoff and stability-map colour ceiling
  show_stable_labels: boolean
  show_unstable_labels: boolean
  show_grid: boolean
  color_scale: D3InterpolateName
  show_upcoming: boolean // ring phases that change at the next transition on heating
  show_map: boolean
  show_events: boolean
  map_sort: `first_stable` | `composition` | `min_e_hull`
  map_filter: `stable_ever` | `near_hull` | `all`
  show_map_elements: boolean
  show_event_lines: boolean
  show_sheets: boolean // prism: vertical sheets swept by tie-lines between transitions
  sheet_opacity: number
  show_rods: boolean // prism: stable phases as rods over their stability windows
  show_event_rings: boolean // prism: triangle outlines at transition temperatures
  ghost_above_plane: boolean // prism: fade everything above the cutting plane
  play_speed: number // K/s
}

export const TERNARY_DISPLAY_DEFAULTS: Readonly<TernaryDisplay> = Object.freeze({
  view: `section`,
  show_tie_lines: true,
  show_tie_triangles: true,
  face_color_mode: `uniform`,
  face_opacity: 0.12,
  show_unstable: true,
  max_e_above_hull: 0.1,
  show_stable_labels: true,
  show_unstable_labels: false,
  show_grid: true,
  color_scale: `interpolateViridis`,
  show_upcoming: true,
  show_map: true,
  show_events: true,
  map_sort: `first_stable`,
  map_filter: `near_hull`,
  show_map_elements: false,
  show_event_lines: true,
  show_sheets: true,
  sheet_opacity: 0.1,
  show_rods: true,
  show_event_rings: true,
  ghost_above_plane: true,
  play_speed: 200,
})

export const TERNARY_COLORS = Object.freeze({
  stable: `#0072B2`,
  face: `#4caf50`,
  selected: `#66f0ff`,
  highlight: `#ff9800`,
  element: `#9e9e9e`,
})

export type SectionHover =
  | { kind: `phase`; phase: DiagramPhase; e_above_hull: number; position: Vec2 }
  | {
      kind: `composition`
      barycentric: Vec3
      decomposition: Decomposition | null
      position: Vec2
    }
// Hovering a phase at a temperature (stability map rows, prism rods)
export type PhaseTemperatureHover = { phase: number; temperature: number; position: Vec2 }
