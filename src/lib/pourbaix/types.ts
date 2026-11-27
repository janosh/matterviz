import type { Vec2 } from '#lib/math'

// One species of a metal–water system
export interface PourbaixEntry {
  // Formula with an optional trailing charge (`Fe2O3`, `Fe^2+`, `Fe³⁺`, `HFeO2^-`), unique
  // within a diagram. Charged species are dissolved, as is a neutral one marked `(aq)`
  // (`Fe(OH)2(aq)`); all others are solids at unit activity.
  formula: string
  // Overrides that formula rule, e.g. `aqueous` for a neutral dissolved species named
  // without (aq); a charged species cannot be `solid`
  phase?: `solid` | `aqueous`
  // Standard Gibbs free energy of formation ΔfG° (eV per formula unit, 298.15 K) from the
  // elements in their standard states (the metal, H2 and O2), H+(aq) and e- being 0
  energy: number
}

// Thermodynamic conditions of the species' free energies
export interface PourbaixConditions {
  // log10 activity of every aqueous species (default -6, Pourbaix's corrosion threshold),
  // divided among the metal atoms of a species with several (pymatgen's convention)
  log_conc: number
  // Temperature (K) of the Nernst terms RT ln(10) and RT ln(a) (default 298.15). ΔfG° stay
  // at their 298.15 K values, so away from it the diagram is the usual first approximation.
  temperature: number
  // ΔfG° of liquid water (eV per H2O), default CODATA's -237.14 kJ/mol
  water_energy: number
  // log_conc of the aqueous species of one element, overriding the shared one for it
  element_log_conc?: Record<string, number>
}

// Conditions and composition of a Pourbaix diagram
export interface PourbaixConfig extends Partial<PourbaixConditions> {
  // Amounts of the (at most two) elements besides H and O, like pymatgen's comp_dict
  // (default equal parts); only their ratio matters
  composition?: Record<string, number> | null
}

// Pourbaix energy of a phase per atom of its elements besides H and O (metal atoms for
// short) as a plane over the window: Ψ(pH, E) = offset + ph_coeff·pH + potential_coeff·E (eV)
export interface PourbaixPlane {
  // One species, or two mixed to the diagram's composition (pymatgen's MultiEntry), each with
  // its share of the phase's metal atoms
  species: { entry: PourbaixEntry; aqueous: boolean; weight: number }[]
  label: string // species formulas joined by ` + `, unique within a diagram
  metal_fractions: Record<string, number> // atom fraction of each element besides H and O
  offset: number
  ph_coeff: number
  potential_coeff: number
}

// Stable region of one phase: a convex polygon in (pH, E), counter-clockwise
export interface PourbaixDomain {
  plane: PourbaixPlane
  vertices: Vec2[]
  area: number // pH·V
}

// Phase under the pointer and its Pourbaix energy (eV per metal atom) at the pointer's (pH, E)
export interface PourbaixHoverInfo {
  plane: PourbaixPlane
  ph: number
  potential: number
  energy: number
}

export interface PourbaixDiagramData {
  elements: string[] // besides H and O, in entry order
  species: PourbaixPlane[] // one plane per entry
  planes: PourbaixPlane[] // phases at the diagram's composition: the species for one element
}
