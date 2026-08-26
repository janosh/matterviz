// Turn raw thermodynamic entries into the planner's working phase set: one lowest-energy phase
// per formula, gas species at their chemical potentials for the requested conditions, elemental
// references at 0 eV/atom, and atom-fraction vectors over a shared element list.
import type { CompositionType } from '$lib/composition'
import { get_electro_neg_formula } from '$lib/composition/format'
import { parse_composition } from '$lib/composition/parse'
import { count_atoms_in_composition, get_reduced_formula } from '$lib/composition/reduce'
import {
  compute_gas_chemical_potential,
  GAS_STOICHIOMETRY,
  get_default_gas_provider,
} from '$lib/convex-hull/gas-thermodynamics'
import {
  compute_e_form_per_atom,
  find_lowest_energy_unary_refs,
  normalize_hull_composition_keys,
} from '$lib/convex-hull/thermodynamics'
import { DEFAULT_GAS_PRESSURES } from '$lib/convex-hull/types'
import type { GasSpecies, PhaseData } from '$lib/convex-hull/types'
import { element_by_symbol } from '$lib/element/data'
import type { ElementSymbol } from '$lib/element/types'
import { solve_linear_program } from '$lib/math'
import { lookup_precursor_info } from './precursor-library'
import type { PhaseRef, SynthesisConditions } from './types'

// Internal working phase: PhaseRef plus the element-fraction vector used by all LPs
export interface PlannerPhase extends PhaseRef {
  // Atom fractions ordered like `elements` of the phase set
  fractions: number[]
  // Hull distance on the plain 0 K closed-system hull (eV/atom): whether a phase exists as a
  // shelf-stable powder, as opposed to `e_above_hull` at firing conditions
  e_above_hull_0K: number
}

export interface PhaseSet {
  elements: ElementSymbol[]
  // Lowest-energy phase per formula, including gases and elemental references
  phases: PlannerPhase[]
  // Every prepared entry (all polymorphs) by id, for resolving user-specified targets
  by_id: Map<string, PlannerPhase>
  warnings: string[]
}

export const ENERGY_TOL = 1e-9

const plain_formula = (composition: CompositionType): string =>
  get_electro_neg_formula(composition, { plain_text: true, delim: `` })

// Reduced formula, e.g. {Li: 2, Co: 2, O: 4} → `LiCoO2`
export const formula_of = (composition: CompositionType): string =>
  plain_formula(get_reduced_formula(composition))

const molar_mass_of = (composition: CompositionType): number =>
  Object.entries(composition).reduce((sum, [symbol, amount]) => {
    const element = element_by_symbol.get(symbol as ElementSymbol)
    if (!element) throw new Error(`Unknown element ${symbol} in composition`)
    return sum + element.atomic_mass * amount
  }, 0)

const fraction_vector = (
  composition: CompositionType,
  elements: ElementSymbol[],
): number[] => {
  const n_atoms = count_atoms_in_composition(composition)
  return elements.map((element) => (composition[element] ?? 0) / n_atoms)
}

const phase_elements = (composition: CompositionType): ElementSymbol[] =>
  (Object.keys(composition) as ElementSymbol[]).filter((el) => (composition[el] ?? 0) > 0)

function make_phase(
  id: string,
  composition: CompositionType,
  energy_per_atom: number,
  elements: ElementSymbol[],
  is_gas: boolean,
): PlannerPhase {
  // Gases keep their molecular formula (O2, not O); solids are reduced per formula unit, except
  // that library precursors use their conventional formula unit (Li2O2 rather than LiO)
  const common = lookup_precursor_info(formula_of(composition))
  const reduced = is_gas
    ? composition
    : common
      ? parse_composition(common.formula)
      : get_reduced_formula(composition)
  const formula = common?.formula ?? plain_formula(reduced)
  return {
    id,
    formula,
    composition: reduced,
    energy_per_atom,
    e_above_hull: NaN, // filled in by the hull pass at conditions
    e_above_hull_0K: NaN,
    n_atoms_per_fu: count_atoms_in_composition(reduced),
    molar_mass: molar_mass_of(reduced),
    is_gas,
    fractions: fraction_vector(reduced, elements),
    ...(common ? { common_name: common.name } : {}),
  }
}

// Gas species as phases in the formation-energy frame: μ(T, p) per atom relative to the
// elemental references at 0 K, so O2 sits at 0 at 0 K and drops by T·S at temperature.
function gas_phases(
  conditions: SynthesisConditions,
  elements: ElementSymbol[],
): PlannerPhase[] {
  const provider = conditions.gas_provider ?? get_default_gas_provider()
  const temperature = conditions.temperature ?? 0
  return (conditions.open_species ?? []).map((gas) => {
    const pressure = conditions.partial_pressures?.[gas] ?? DEFAULT_GAS_PRESSURES[gas]
    const mu = compute_gas_chemical_potential(provider, gas, temperature, pressure)
    return make_phase(`gas:${gas}`, GAS_STOICHIOMETRY[gas], mu, elements, true)
  })
}

const gas_elements = (species: GasSpecies[]): ElementSymbol[] => [
  ...new Set(species.flatMap((gas) => phase_elements(GAS_STOICHIOMETRY[gas]))),
]

// Prepare the working phase set. Entries without a usable formation energy are skipped with a
// warning; missing elemental references are synthesized at 0 eV/atom (the formation-energy
// convention); polymorphs collapse to the lowest-energy entry per formula.
export function prepare_phase_set(
  entries: PhaseData[],
  conditions: SynthesisConditions = {},
): PhaseSet {
  const warnings: string[] = []
  const normalized = entries
    .map((entry) => ({
      ...entry,
      composition: normalize_hull_composition_keys(entry.composition),
    }))
    .filter((entry) => count_atoms_in_composition(entry.composition) > 0)
  const open_species = conditions.open_species ?? []
  const elements = [
    ...new Set([
      ...normalized.flatMap((entry) => phase_elements(entry.composition)),
      ...gas_elements(open_species),
    ]),
  ].toSorted()
  const unary_refs = find_lowest_energy_unary_refs(normalized)

  const by_id = new Map<string, PlannerPhase>()
  let n_skipped = 0
  normalized.forEach((entry, entry_idx) => {
    const e_form =
      typeof entry.e_form_per_atom === `number`
        ? entry.e_form_per_atom
        : compute_e_form_per_atom(entry, unary_refs)
    if (e_form === null || !Number.isFinite(e_form)) {
      n_skipped++
      return
    }
    const id = entry.entry_id ?? `${formula_of(entry.composition)}#${entry_idx}`
    if (by_id.has(id)) {
      warnings.push(`Duplicate entry id ${id}; keeping the first occurrence`)
      return
    }
    by_id.set(id, make_phase(id, entry.composition, e_form, elements, false))
  })
  if (n_skipped > 0) {
    warnings.push(
      `Skipped ${n_skipped} entries without e_form_per_atom or elemental references to compute it`,
    )
  }

  // Lowest-energy representative per reduced formula
  const best_by_formula = new Map<string, PlannerPhase>()
  for (const phase of by_id.values()) {
    const existing = best_by_formula.get(phase.formula)
    if (!existing || phase.energy_per_atom < existing.energy_per_atom - ENERGY_TOL) {
      best_by_formula.set(phase.formula, { ...phase })
    }
  }

  // Elemental references at 0 eV/atom where the data has no unary entry
  for (const element of elements) {
    if (best_by_formula.has(element)) continue
    best_by_formula.set(
      element,
      make_phase(`ref:${element}`, { [element]: 1 }, 0, elements, false),
    )
  }

  // Shelf stability from the closed 0 K hull of the solids, before gases enter the picture
  const solids = [...best_by_formula.values()]
  assign_e_above_hull(solids)
  for (const phase of solids) phase.e_above_hull_0K = phase.e_above_hull

  // Gases replace any solid/molecular entry of the same reduced formula (a computed CO2 crystal, the
  // elemental O reference), since at synthesis conditions the gas is the relevant state
  for (const gas of gas_phases(conditions, elements)) {
    best_by_formula.set(formula_of(gas.composition), { ...gas, e_above_hull_0K: 0 })
  }

  return { elements, phases: [...best_by_formula.values()], by_id, warnings }
}

// === Convex hull ===

const HULL_COEFF_TOL = 1e-7

export interface HullPoint {
  // Energy of the lowest-energy mixture with the query composition (eV/atom)
  energy: number
  decomposition: { phase: PlannerPhase; atom_fraction: number }[]
}

// Lowest-energy combination of `phases` reproducing `fractions` (atom fractions over the phase
// set's elements): the convex hull evaluated at that composition. Only phases whose elements are
// a subset of the query's appear as LP columns. Returns null when no combination exists.
export function hull_at(fractions: number[], phases: PlannerPhase[]): HullPoint | null {
  const candidates = phases.filter((phase) =>
    phase.fractions.every((fraction, el_idx) => fraction === 0 || fractions[el_idx] > 0),
  )
  if (candidates.length === 0) return null
  const active_rows = fractions
    .map((_, el_idx) => el_idx)
    .filter((el_idx) => fractions[el_idx] > 0)
  const result = solve_linear_program(
    candidates.map((phase) => phase.energy_per_atom),
    active_rows.map((el_idx) => candidates.map((phase) => phase.fractions[el_idx])),
    active_rows.map((el_idx) => fractions[el_idx]),
  )
  if (result.status !== `optimal`) return null
  const decomposition = result.solution
    .map((atom_fraction, idx) => ({ phase: candidates[idx], atom_fraction }))
    .filter(({ atom_fraction }) => atom_fraction > HULL_COEFF_TOL)
    .toSorted((item_a, item_b) => item_b.atom_fraction - item_a.atom_fraction)
  return { energy: result.objective, decomposition }
}

// Fill `e_above_hull` of every phase from the hull of the whole set (in place)
export function assign_e_above_hull(phases: PlannerPhase[]): void {
  for (const phase of phases) {
    const hull = hull_at(phase.fractions, phases)
    if (!hull) throw new Error(`No hull at composition of ${phase.formula}`)
    phase.e_above_hull = Math.max(0, phase.energy_per_atom - hull.energy)
  }
}

// Find the target among all entries by id, then by formula (lowest-energy polymorph). Garbage
// formulas resolve to null rather than throwing.
export function resolve_phase(phase_set: PhaseSet, query: string): PlannerPhase | null {
  const by_id = phase_set.by_id.get(query)
  if (by_id) return by_id
  let formula: string
  try {
    const composition = normalize_hull_composition_keys(parse_composition(query))
    if (count_atoms_in_composition(composition) <= 0) return null
    formula = formula_of(composition)
  } catch {
    return null
  }
  return phase_set.phases.find((phase) => phase.formula === formula) ?? null
}

export const to_phase_ref = (phase: PlannerPhase): PhaseRef => {
  const { fractions: _fractions, e_above_hull_0K: _hull_0K, ...ref } = phase
  return ref
}
