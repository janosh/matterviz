// Thermodynamics of candidate reactions, all expressed as small linear programs over the working
// phase set so the same code handles binaries through quinaries and open gas reservoirs.
import {
  compute_gas_chemical_potential,
  get_default_gas_provider,
} from '$lib/convex-hull/gas-thermodynamics'
import { DEFAULT_GAS_PRESSURES } from '$lib/convex-hull/types'
import type { GasSpecies } from '$lib/convex-hull/types'
import { solve_linear_program } from '$lib/math'
import type { PlannerPhase } from './phases'
import { ENERGY_TOL, to_phase_ref } from './phases'
import type {
  CompetingPhase,
  PairwiseInterface,
  SynthesisReaction,
  ReactionSpecies,
  SelectivityMetrics,
  SynthesisConditions,
} from './types'

const COEFF_TOL = 1e-7

// Formula-unit atom counts of a phase per element of the phase set, and its energy per formula unit
const fu_counts = (phase: PlannerPhase): number[] =>
  phase.fractions.map((fraction) => fraction * phase.n_atoms_per_fu)
const fu_energy = (phase: PlannerPhase): number => phase.energy_per_atom * phase.n_atoms_per_fu
const negate = (values: number[]): number[] => values.map((value) => -value)
// Transpose LP columns into one equality row per element
const element_rows = (columns: number[][], n_el: number): number[][] =>
  Array.from({ length: n_el }, (_, el_idx) => columns.map((col) => col[el_idx]))

// === Reaction balancing ===

export interface BalancedReaction {
  // Formula units of each precursor per formula unit of product
  coefficients: number[]
  // Formula units of each open gas per formula unit of product; positive = released
  gas_exchange: number[]
  // Energy change per formula unit of product (eV)
  energy_per_fu: number
  // Atoms of precursors and consumed gas per formula unit of product
  reactant_atoms: number
}

// Driving force per atom of the reacting mixture (pymatgen InterfacialReactivity convention),
// which keeps decomposition and formation products comparable
const driving_force_of = (balanced: BalancedReaction): number =>
  balanced.energy_per_fu / balanced.reactant_atoms

export type BalanceFailure = `unbalanced` | `redundant_precursor`

// Balance `precursors → product + gases` with non-negative precursor coefficients and free-signed
// gas exchange, choosing the solution with the least total gas exchange when several exist.
// `require_all` rejects solutions where a precursor has zero coefficient.
export function balance_reaction(
  precursors: PlannerPhase[],
  product: PlannerPhase,
  gases: PlannerPhase[],
  require_all: boolean,
): BalancedReaction | BalanceFailure {
  const product_counts = fu_counts(product)
  // Columns: precursors | gas released (moved to the reactant side, hence negative) | gas consumed
  const columns = [
    ...precursors.map(fu_counts),
    ...gases.map((gas) => negate(fu_counts(gas))),
    ...gases.map(fu_counts),
  ]
  const objective = [...precursors.map(() => 0), ...gases.map(() => 1), ...gases.map(() => 1)]
  const result = solve_linear_program(
    objective,
    element_rows(columns, product_counts.length),
    product_counts,
  )
  if (result.status !== `optimal`) return `unbalanced`

  const coefficients = result.solution.slice(0, precursors.length)
  if (require_all && coefficients.some((coeff) => coeff <= COEFF_TOL))
    return `redundant_precursor`
  const released = result.solution.slice(precursors.length, precursors.length + gases.length)
  const consumed = result.solution.slice(precursors.length + gases.length)
  const gas_exchange = released.map((amount, idx) => amount - consumed[idx])
  const energy_per_fu =
    fu_energy(product) +
    gases.reduce((sum, gas, idx) => sum + gas_exchange[idx] * fu_energy(gas), 0) -
    precursors.reduce((sum, phase, idx) => sum + coefficients[idx] * fu_energy(phase), 0)
  const reactant_atoms = precursors.reduce(
    (sum, phase, idx) => sum + coefficients[idx] * phase.n_atoms_per_fu,
    gases.reduce((sum, gas, idx) => sum + consumed[idx] * gas.n_atoms_per_fu, 0),
  )
  return { coefficients, gas_exchange, energy_per_fu, reactant_atoms }
}

// Smallest multiplier (≤ 200) that makes every coefficient integral, else 1
function integer_multiplier(values: number[]): number {
  for (let factor = 1; factor <= 200; factor++) {
    if (
      values.every((value) => Math.abs(value * factor - Math.round(value * factor)) < 1e-6)
    ) {
      return factor
    }
  }
  return 1
}

const format_coefficient = (value: number): string => {
  if (Math.abs(value - Math.round(value)) < 1e-6) {
    return Math.round(value) === 1 ? `` : `${Math.round(value)} `
  }
  return `${Number(value.toPrecision(4))} `
}

const format_side = (species: ReactionSpecies[]): string =>
  species
    .map(({ phase, coefficient }) => `${format_coefficient(coefficient)}${phase.formula}`)
    .join(` + `)

// Reaction object with coefficients scaled to small integers where possible
export function make_reaction(
  precursors: PlannerPhase[],
  product: PlannerPhase,
  gases: PlannerPhase[],
  balanced: BalancedReaction,
): SynthesisReaction {
  const all_coeffs = [1, ...balanced.coefficients, ...balanced.gas_exchange.map(Math.abs)]
  const factor = integer_multiplier(all_coeffs.filter((coeff) => coeff > COEFF_TOL))
  // Solid reactants alphabetically by formula so equations read the same regardless of pool order
  const reactants: ReactionSpecies[] = precursors
    .map((phase, idx) => ({
      phase: to_phase_ref(phase),
      coefficient: balanced.coefficients[idx] * factor,
    }))
    .filter(({ coefficient }) => coefficient > COEFF_TOL)
    .toSorted((species_a, species_b) =>
      species_a.phase.formula.localeCompare(species_b.phase.formula),
    )
  const products: ReactionSpecies[] = [{ phase: to_phase_ref(product), coefficient: factor }]
  gases.forEach((gas, idx) => {
    const amount = balanced.gas_exchange[idx] * factor
    if (amount > COEFF_TOL) products.push({ phase: to_phase_ref(gas), coefficient: amount })
    else if (amount < -COEFF_TOL)
      reactants.push({ phase: to_phase_ref(gas), coefficient: -amount })
  })
  return {
    reactants,
    products,
    equation: `${format_side(reactants)} → ${format_side(products)}`,
    energy_per_atom: balanced.energy_per_fu / product.n_atoms_per_fu,
    energy_per_fu: balanced.energy_per_fu,
    driving_force: driving_force_of(balanced),
  }
}

// === Selectivity ===

// Atom fraction of each solid precursor in the reacting mixture of a balanced reaction
const mixture_fractions = (
  precursors: PlannerPhase[],
  balanced: BalancedReaction,
): Record<string, number> => {
  const solid_atoms = precursors.reduce(
    (sum, phase, idx) => sum + balanced.coefficients[idx] * phase.n_atoms_per_fu,
    0,
  )
  return Object.fromEntries(
    precursors.flatMap((phase, idx) =>
      balanced.coefficients[idx] > COEFF_TOL
        ? [[phase.formula, (balanced.coefficients[idx] * phase.n_atoms_per_fu) / solid_atoms]]
        : [],
    ),
  )
}

interface Competitor {
  phase: PlannerPhase
  balanced: BalancedReaction
  driving_force: number
}

// One prepared phase set/request only. Preserve pair order: LP coefficients depend on it.
export const create_thermo_cache = () => ({
  gas_mu: new Map<string, number>(),
  pairs: new Map<PlannerPhase, Map<PlannerPhase, Map<PlannerPhase, Competitor[]>>>(),
})
type ThermoCache = ReturnType<typeof create_thermo_cache>

// Phases (other than the precursors, the target and gases) that can form from the precursor
// mixture with a negative driving force, strongest first. Phases may form from a subset of the
// precursors, so single-precursor decomposition products are included.
function find_competitors(
  precursors: PlannerPhase[],
  target: PlannerPhase,
  gases: PlannerPhase[],
  phases: PlannerPhase[],
): Competitor[] {
  const excluded = new Set([target.id, ...precursors.map((phase) => phase.id)])
  // Reachable phases can only contain elements present in the precursors or open gases
  const available = precursors.concat(gases).reduce(
    (mask, phase) => mask.map((has, el_idx) => has || phase.fractions[el_idx] > 0),
    target.fractions.map(() => false),
  )
  const competitors: Competitor[] = []
  for (const phase of phases) {
    if (excluded.has(phase.id) || phase.is_gas) continue
    if (phase.fractions.some((fraction, el_idx) => fraction > 0 && !available[el_idx]))
      continue
    const balanced = balance_reaction(precursors, phase, gases, false)
    if (typeof balanced === `string`) continue
    const driving_force = driving_force_of(balanced)
    if (driving_force < -ENERGY_TOL) competitors.push({ phase, balanced, driving_force })
  }
  return competitors.toSorted((comp_a, comp_b) => comp_a.driving_force - comp_b.driving_force)
}

const to_competing_phase = (
  precursors: PlannerPhase[],
  { phase, balanced, driving_force }: Competitor,
  target_driving_force: number,
): CompetingPhase => ({
  phase: to_phase_ref(phase),
  driving_force,
  more_favorable_than_target: driving_force < target_driving_force - ENERGY_TOL,
  mixture: mixture_fractions(precursors, balanced),
})

// What forms first where two precursor grains meet: the target if it is reachable and at least as
// favorable as every competitor on that tie-line, else the strongest competitor
function pairwise_interface(
  pair: PlannerPhase[],
  target: PlannerPhase,
  gases: PlannerPhase[],
  competitors: Competitor[],
): PairwiseInterface {
  const target_balance = balance_reaction(pair, target, gases, false)
  const target_force =
    typeof target_balance === `string` ? Infinity : driving_force_of(target_balance)
  const strongest = competitors[0]
  const forms_target =
    target_force < 0 && (!strongest || target_force <= strongest.driving_force + ENERGY_TOL)
  const first_product =
    typeof target_balance !== `string` && forms_target
      ? to_competing_phase(
          pair,
          { phase: target, balanced: target_balance, driving_force: target_force },
          target_force,
        )
      : strongest
        ? to_competing_phase(pair, strongest, target_force)
        : null
  return {
    precursors: [to_phase_ref(pair[0]), to_phase_ref(pair[1])],
    first_product,
    forms_target,
  }
}

// Depth of the target below the open-system hull of every other phase reachable from the
// precursors, at the target's composition (eV/atom). Gas exchange with the reservoir is free.
function inverse_hull_energy(
  precursors: PlannerPhase[],
  target: PlannerPhase,
  gases: PlannerPhase[],
  competitor_phases: PlannerPhase[],
): number {
  // target + consumed gas → solids + released gas. Solids and released gas are products and enter
  // the element balance with the same sign; consumed gas sits on the reactant side.
  const solids = [...precursors, ...competitor_phases]
  const columns = [
    ...solids.map(fu_counts),
    ...gases.map(fu_counts),
    ...gases.map((gas) => negate(fu_counts(gas))),
  ]
  const objective = [
    ...solids.map(fu_energy),
    ...gases.map(fu_energy),
    ...gases.map((gas) => -fu_energy(gas)),
  ]
  const target_counts = fu_counts(target)
  const result = solve_linear_program(
    objective,
    element_rows(columns, target_counts.length),
    target_counts,
  )
  if (result.status !== `optimal`) {
    throw new Error(`Inverse hull LP ${result.status} for ${target.formula}`)
  }
  return (result.objective - fu_energy(target)) / target.n_atoms_per_fu
}

export function analyze_selectivity(
  precursors: PlannerPhase[],
  target: PlannerPhase,
  gases: PlannerPhase[],
  phases: PlannerPhase[],
  target_driving_force: number,
  cache?: ThermoCache,
): SelectivityMetrics {
  const competitors_for = (mixture: PlannerPhase[]): Competitor[] => {
    if (!cache || mixture.length !== 2) return find_competitors(mixture, target, gases, phases)
    const [first, second] = mixture
    let by_first = cache.pairs.get(target)
    if (!by_first) cache.pairs.set(target, (by_first = new Map()))
    let by_second = by_first.get(first)
    if (!by_second) by_first.set(first, (by_second = new Map()))
    let found = by_second.get(second)
    if (!found)
      by_second.set(second, (found = find_competitors(mixture, target, gases, phases)))
    return found
  }
  const competitors = competitors_for(precursors)
  const interfaces: PairwiseInterface[] = []
  for (let idx_a = 0; idx_a < precursors.length; idx_a++) {
    for (let idx_b = idx_a + 1; idx_b < precursors.length; idx_b++) {
      const pair = [precursors[idx_a], precursors[idx_b]]
      // For a two-precursor route the pair is the whole mixture: reuse its competitors
      const pair_competitors = precursors.length === 2 ? competitors : competitors_for(pair)
      interfaces.push(pairwise_interface(pair, target, gases, pair_competitors))
    }
  }
  const more_favorable = competitors.filter(
    (comp) => comp.driving_force < target_driving_force - ENERGY_TOL,
  )
  return {
    target_driving_force,
    inverse_hull_energy: inverse_hull_energy(
      precursors,
      target,
      gases,
      competitors.map((comp) => comp.phase),
    ),
    competitors: competitors.map((comp) =>
      to_competing_phase(precursors, comp, target_driving_force),
    ),
    selectivity_margin: target_driving_force - (competitors[0]?.driving_force ?? 0),
    n_more_favorable: more_favorable.length,
    target_is_most_favorable: more_favorable.length === 0,
    interfaces,
  }
}

// === Temperature dependence ===

// Reaction energy per formula unit as a function of temperature: only the gas chemical potentials
// vary, so evaluate the solid part once and add Σ g_s · n_s · μ_s(T).
export function reaction_energy_at_temperature(
  balanced: BalancedReaction,
  gases: PlannerPhase[],
  gas_species: GasSpecies[],
  conditions: SynthesisConditions,
  cache?: ThermoCache,
): (temperature: number) => number {
  const provider = conditions.gas_provider ?? get_default_gas_provider()
  // Custom providers may be stateful; preserve their call order and count.
  const samples = conditions.gas_provider ? undefined : cache?.gas_mu
  const solid_part =
    balanced.energy_per_fu -
    gases.reduce(
      (sum, gas, idx) =>
        sum + balanced.gas_exchange[idx] * gas.energy_per_atom * gas.n_atoms_per_fu,
      0,
    )
  return (temperature) =>
    solid_part +
    gases.reduce((sum, gas, idx) => {
      const species = gas_species[idx]
      const pressure =
        conditions.partial_pressures?.[species] ?? DEFAULT_GAS_PRESSURES[species]
      const key = `${species}:${temperature}:${pressure}`
      const mu =
        samples?.get(key) ??
        compute_gas_chemical_potential(provider, species, temperature, pressure)
      samples?.set(key, mu)
      return sum + balanced.gas_exchange[idx] * mu * gas.n_atoms_per_fu
    }, 0)
}

// Lowest temperature (1 K grid, ≤ max_temperature) where the reaction energy turns negative, or
// null when it never does. Only meaningful for reactions that exchange gas: nothing else varies.
export function onset_temperature(
  energy_at: (temperature: number) => number,
  max_temperature = 2000,
): number | null {
  if (energy_at(0) < 0) return 0
  for (let temperature = 1; temperature <= max_temperature; temperature++) {
    if (energy_at(temperature) < 0) return temperature
  }
  return null
}
