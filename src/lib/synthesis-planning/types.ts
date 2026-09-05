import type { CompositionType } from '$lib/composition'
import type { GasSpecies, GasThermodynamicsProvider, PhaseData } from '$lib/convex-hull/types'
import type { ElementSymbol } from '$lib/element/types'

// === Request ===

// Thermodynamic conditions of the synthesis. Solids keep their 0 K computed formation energies; gases
// that are exchanged with the atmosphere get μ(T, p) = H_f - T·S + k_B·T·ln(p/p°) per atom from
// tabulated data, which is what makes carbonate/hydroxide decomposition and oxygen uptake or
// release temperature-dependent.
export interface SynthesisConditions {
  // Kelvin. 0 reproduces the bare 0 K hull.
  temperature?: number
  // Gas species the reaction may consume from or release to the atmosphere, e.g. [`O2`, `CO2`].
  // Elements of these gases may then appear in precursors without appearing in the target.
  open_species?: GasSpecies[]
  // Partial pressures in bar (default: ambient air, see DEFAULT_GAS_PRESSURES; set 1 for pure gas).
  partial_pressures?: Partial<Record<GasSpecies, number>>
  // Custom gas thermodynamics tables (defaults to the built-in Barin/NBS data).
  gas_provider?: GasThermodynamicsProvider
}

export interface PrecursorPoolOptions {
  // Only these entries/formulas may serve as precursors (entry ids or formulas).
  allow?: string[]
  // Never use these entries/formulas as precursors.
  block?: string[]
  // Max distance above the hull for a phase to count as an obtainable precursor (eV/atom).
  // Default 0.03 so slightly metastable but real compounds (e.g. Co3O4 in some functionals) stay.
  max_e_above_hull?: number
  // Restrict the pool to compounds in the built-in commercial precursor library. Default: true
  // whenever library precursors can supply every target element, false otherwise.
  only_common?: boolean
  // Max number of distinct elements per precursor. Default: one fewer than the target (binaries
  // for a ternary target); library precursors such as Li2CO3 always pass this filter.
  max_elements?: number
}

// Relative weights of the scoring terms. Each term is normalized to roughly [0, 1] before
// weighting so the defaults are comparable; set a weight to 0 to ignore a term.
export interface ScoreWeights {
  // Margin by which the target out-competes the most favorable competing phase
  selectivity: number
  // Inverse hull energy: depth of the target below the hull of competing phases (https://doi.org/10.1038/s44160-024-00502-y)
  inverse_hull: number
  // Magnitude of the target's reaction energy from the precursors
  driving_force: number
  // Penalty per competing phase that is more favorable than the target
  competition: number
  // Commercial availability / handling of the precursors and byproduct volatility
  practicality: number
  // Fewer precursors and fewer pairwise interfaces are easier to homogenize
  simplicity: number
}

export interface SynthesisPlanRequest {
  // Thermodynamic entries covering the target's chemical system (and any precursor-only
  // elements like C or H when carbonate/hydroxide precursors should be considered).
  entries: PhaseData[]
  // Target phase: an entry id or a formula such as `LiCoO2`. With a formula, the lowest-energy
  // matching entry is used.
  target: string
  precursors?: PrecursorPoolOptions
  conditions?: SynthesisConditions
  // Largest precursor set to enumerate (1-4, default 2). 1 covers decomposition/dehydration routes.
  max_precursors?: number
  // Also search two-step routes through an intermediate phase (default false).
  two_step?: boolean
  scoring?: Partial<ScoreWeights>
  // Number of ranked routes to return in full detail (default 20).
  max_routes?: number
  // Also return these evaluated routes outside the top-ranked limit, for persistent comparisons.
  keep_route_ids?: string[]
  // Target mass the recipe is scaled to (grams, default 1).
  target_mass_g?: number
}

export interface SynthesisPlanProgress {
  stage: `preparing` | `direct_routes` | `two_step_routes` | `ranking`
  current: number
  total: number
}

// === Result ===

export interface PhaseRef {
  id: string
  formula: string
  composition: CompositionType
  // Formation energy per atom in the working reference frame (eV/atom). For gases this is
  // μ(T, p) per atom; for solids the 0 K computed value.
  energy_per_atom: number
  // Distance above the hull of all phases at the given conditions (eV/atom)
  e_above_hull: number
  n_atoms_per_fu: number
  molar_mass: number
  is_gas: boolean
  // Name from the precursor library, when the phase is a common commercial precursor
  common_name?: string
}

export interface ReactionSpecies {
  phase: PhaseRef
  // Formula units per formula unit of target (reduced so all coefficients are small integers
  // where possible)
  coefficient: number
}

export interface SynthesisReaction {
  reactants: ReactionSpecies[]
  products: ReactionSpecies[]
  // Human-readable balanced equation, e.g. `BaCO3 + TiO2 → BaTiO3 + CO2`
  equation: string
  // Reaction energy per atom of target (eV/atom); negative is downhill
  energy_per_atom: number
  // Reaction energy per formula unit of target (eV)
  energy_per_fu: number
  // Reaction energy per atom of the reacting mixture (precursors + consumed gas), the
  // normalization used for all selectivity comparisons (eV/atom)
  driving_force: number
}

export interface CompetingPhase {
  phase: PhaseRef
  // Energy released per atom of precursor mixture consumed when this phase forms (eV/atom);
  // more negative means a stronger thermodynamic pull than the target's driving force
  driving_force: number
  // Whether this competitor is thermodynamically preferred over the target
  more_favorable_than_target: boolean
  // Atom fraction of each precursor (by formula) in the mixture that forms this phase, i.e. where
  // along the precursor tie-line/simplex it sits. Precursors not involved are absent.
  mixture: Record<string, number>
}

// What forms first where two precursor grains touch: the phase with the largest driving force
// along the tie-line between that pair (pairwise reaction picture of https://doi.org/10.1038/s44160-024-00502-y)
export interface PairwiseInterface {
  precursors: [PhaseRef, PhaseRef]
  // Most favorable phase at this interface, if any phase lies between the two precursors
  first_product: CompetingPhase | null
  // True when the first product is the target itself
  forms_target: boolean
}

export interface SelectivityMetrics {
  // Target's formation driving force from the precursors per atom of reacting mixture (eV/atom)
  target_driving_force: number
  // Depth of the target below the hull formed by all other phases reachable from the precursors,
  // evaluated at the target composition (eV/atom). Positive = target is the ground state of the
  // reaction; larger = bigger margin against intermediates persisting
  inverse_hull_energy: number
  // All phases (other than target and precursors) reachable from the precursor mixture with a
  // negative driving force, most favorable first
  competitors: CompetingPhase[]
  // Target driving force minus that of the most favorable competitor (eV/atom): negative when
  // the target is preferred, and the more negative the cleaner the reaction. Equals the target
  // driving force itself when nothing competes.
  selectivity_margin: number
  n_more_favorable: number
  target_is_most_favorable: boolean
  interfaces: PairwiseInterface[]
}

export interface RouteThermodynamics {
  temperature: number
  partial_pressures: Partial<Record<GasSpecies, number>>
  // Lowest temperature (K) at which the reaction energy turns negative at the given partial
  // pressures, searched on a 1 K grid up to 2000 K. null when no gas is exchanged, when the
  // reaction is already downhill at 0 K (then `onset_temperature` = 0), or never downhill.
  onset_temperature: number | null
  // Moles of each gas per formula unit of target; positive = released, negative = consumed
  gas_exchange: Partial<Record<GasSpecies, number>>
  // Human-readable net gas exchange; not an experimental atmosphere recommendation.
  atmosphere: string
}

export interface PracticalityAssessment {
  // 0-1, higher is better
  score: number
  notes: string[]
}

export interface RecipeItem {
  phase: PhaseRef
  // `atmosphere` = gas taken up from the furnace atmosphere
  role: `precursor` | `atmosphere` | `target` | `byproduct`
  moles: number
  mass_g: number
  // Mass fraction of all precursors (precursors only)
  mass_fraction?: number
}

// Experimental choices are user input, never inferred from thermodynamic favorability.
export interface RecipeAssumptions {
  temperature_K: string
  ramp_K_min: string
  hold_hours: string
  preparation: string
  container: string
  atmosphere: string
  source: string
}

export interface Recipe {
  target_mass_g: number
  items: RecipeItem[]
  // Percent of solid precursor mass lost; negative means uptake from the atmosphere.
  mass_loss_percent: number
  // Local precursor-library notes have no attached literature references.
  guidance: string[]
  assumptions: RecipeAssumptions
  checkpoints: string[]
}

export interface SynthesisStep {
  reaction: SynthesisReaction
  thermodynamics: RouteThermodynamics
  selectivity: SelectivityMetrics
  recipe: Recipe
}

export type RejectReason =
  | `unbalanced` // precursors cannot combine to the target (with the allowed gas exchange)
  | `redundant_precursor` // a precursor gets zero coefficient, a smaller set covers this route
  | `uphill` // reaction energy positive at the requested conditions and never downhill up to 2000 K

export interface SynthesisRoute {
  id: string
  // `direct` = one firing; `two_step` = an intermediate is synthesized first
  kind: `direct` | `two_step`
  reaction: SynthesisReaction
  // Intermediate reaction for two-step routes (step 1); `reaction` is then step 2
  intermediate_step?: SynthesisStep
  selectivity: SelectivityMetrics
  thermodynamics: RouteThermodynamics
  practicality: PracticalityAssessment
  // Weighted total and per-term contributions (already multiplied by their weights)
  score: number
  score_breakdown: Record<keyof ScoreWeights, number>
  // Plain-language reasons for the ranking, suitable for relaying to a user or an agent
  rationale: string[]
  recipe: Recipe
}

export interface TargetStability {
  e_above_hull: number
  is_stable: boolean
  // Hull decomposition at the target composition (fractions by atom), empty when stable
  decomposition: { phase: PhaseRef; atom_fraction: number }[]
}

export interface SynthesisPlan {
  target: PhaseRef
  // Working solid and gas energies at the requested conditions, including any target polymorph comparator.
  phases: PhaseRef[]
  chemical_system: string
  elements: ElementSymbol[]
  conditions: Required<Pick<SynthesisConditions, `temperature` | `open_species`>> & {
    partial_pressures: Partial<Record<GasSpecies, number>>
  }
  target_stability: TargetStability
  weights: ScoreWeights
  // Ranked best-first
  routes: SynthesisRoute[]
  // Candidate precursor sets that did not yield a valid route, counted by reason
  rejected: Record<RejectReason, number>
  n_candidates: number
  precursor_pool: PhaseRef[]
  warnings: string[]
}
