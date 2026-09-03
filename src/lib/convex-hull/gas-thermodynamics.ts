// Gas phase thermodynamics for convex hull calculations
// Enables atmosphere-controlled phase diagram analysis

import { count_atoms_in_composition } from '$lib/composition/reduce'
import { drop_cached_hull_data } from './thermodynamics'
import { BOLTZMANN_EV_PER_K } from '$lib/constants'
import type { ElementSymbol } from '$lib/element'
import { format_num } from '$lib/labels'
import type { Vec2 } from '$lib/math'
import type {
  GasAnalysis,
  GasSpecies,
  GasThermodynamicsConfig,
  GasThermodynamicsProvider,
  PhaseData,
} from './types'
import { DEFAULT_GAS_PRESSURES, GAS_SPECIES } from './types'

export const P_REF = 1.0 // Reference pressure in bar

// Default element-to-gas mapping (which element comes from which gas)
export const DEFAULT_ELEMENT_TO_GAS: Readonly<Partial<Record<ElementSymbol, GasSpecies>>> = {
  O: `O2`,
  N: `N2`,
  H: `H2`,
  F: `F2`,
  C: `CO2`, // Carbon typically from CO2 in oxidizing atmospheres
}

// Stoichiometric coefficients: atoms of element per molecule of gas
// e.g., O2 has 2 O atoms, H2O has 2 H and 1 O
export const GAS_STOICHIOMETRY: Readonly<
  Record<GasSpecies, Partial<Record<ElementSymbol, number>>>
> = {
  O2: { O: 2 },
  N2: { N: 2 },
  H2: { H: 2 },
  F2: { F: 2 },
  CO: { C: 1, O: 1 },
  CO2: { C: 1, O: 2 },
  H2O: { H: 2, O: 1 },
}

// Default Thermodynamic Data (abstracted - users can provide their own)

// Temperature grid (K) shared by all tabulated T*S data below
// oxfmt-ignore
const TS_TEMPERATURES = [0, 298, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000]

// Default T*S values in eV PER ATOM (not per molecule) at TS_TEMPERATURES, interpolated between
// grid points. Cross-checked against NIST standard entropies: O2 at 298 K is S = 205.15 J/mol/K
// = 0.6339 eV/molecule, and the table holds 0.317, i.e. half of it. compute_gas_correction's
// num_atoms factor assumes this, so regenerating the table per molecule would scale every gas
// correction by its atom count.
// Source: Barin Thermochemical Tables and NBS Thermochemical Tables
// Data compiled to match PIRO (https://github.com/GENESIS-EFRC/piro)
// F2 not in Barin/NBS tables used by PIRO - approximated from similar homonuclear diatomics (O2, N2)
// oxfmt-ignore
const DEFAULT_TS_DATA: Readonly<Record<GasSpecies, number[]>> = {
  O2: [0, 0.317, 0.3192, 0.4433, 0.5718, 0.7041, 0.8396, 0.9781, 1.119, 1.2623, 1.4075, 1.5547, 1.7036, 1.8541, 2.006, 2.1594, 2.3141, 2.47, 2.6271, 2.7854],
  H2: [0, 0.2019, 0.2034, 0.2886, 0.3776, 0.4697, 0.5645, 0.6614, 0.7605, 0.8614, 0.964, 1.0683, 1.1741, 1.2815, 1.3902, 1.5003, 1.6116, 1.7242, 1.838, 1.9528],
  N2: [0, 0.2959, 0.2981, 0.4149, 0.5356, 0.6596, 0.7866, 0.9161, 1.0481, 1.1822, 1.3184, 1.4563, 1.596, 1.7372, 1.8799, 2.0239, 2.1693, 2.3158, 2.4634, 2.6122],
  CO: [0, 0.3054, 0.3076, 0.4275, 0.5515, 0.6788, 0.8092, 0.9423, 1.0778, 1.2155, 1.3552, 1.4967, 1.64, 1.7848, 1.9311, 2.0788, 2.2277, 2.3779, 2.5291, 2.6815],
  CO2: [0, 0.2202, 0.2218, 0.3113, 0.4057, 0.5042, 0.6064, 0.7116, 0.8197, 0.9303, 1.0432, 1.1582, 1.2751, 1.3938, 1.5141, 1.636, 1.7593, 1.8839, 2.0098, 2.1369],
  H2O: [0, 0.1946, 0.1961, 0.2749, 0.357, 0.4419, 0.5293, 0.6189, 0.7107, 0.8045, 0.9001, 0.9975, 1.0966, 1.1972, 1.2994, 1.403, 1.5079, 1.6142, 1.7216, 1.8303],
  F2: [0, 0.31, 0.312, 0.435, 0.56, 0.69, 0.82, 0.96, 1.1, 1.24, 1.38, 1.53, 1.68, 1.83, 1.98, 2.13, 2.29, 2.45, 2.61, 2.77],
}

// Formation enthalpies H_f at 0K in eV/molecule
// Reference energies for formation from elements, in eV PER ATOM like DEFAULT_TS_DATA above:
// the CO2 base of -1.3583 eV is the JANAF -4.0748 eV/molecule divided by its 3 atoms.
const DEFAULT_ENTHALPY: Readonly<Partial<Record<GasSpecies, number>>> = {
  CO: -0.5897,
  // CO2: Base value -1.3583 eV from JANAF tables, with -0.2482 eV correction
  // to improve accuracy for carbonate phase predictions (Wang et al., PRB 73, 195107)
  CO2: -1.3583 - 0.2482,
  H2O: -0.82547,
  // O2, N2, H2, F2 are reference states with H_f = 0
}

// Linearly interpolate a T*S value at `temperature` (clamped to the tabulated range)
function interpolate_ts(values: number[], temperature: number): number {
  const temps = TS_TEMPERATURES
  if (temperature <= temps[0]) return values[0]
  if (temperature >= temps[temps.length - 1]) return values[values.length - 1]

  // Find bracketing indices
  let idx = 0
  while (idx < temps.length - 1 && temps[idx + 1] < temperature) idx++

  const fraction = (temperature - temps[idx]) / (temps[idx + 1] - temps[idx])
  return values[idx] + fraction * (values[idx + 1] - values[idx])
}

// Default provider backed by the built-in tables above. Stateless, so one shared instance.
const DEFAULT_GAS_PROVIDER: GasThermodynamicsProvider = {
  // μ°(T) = H_f - T*S; the elemental gases (O2, N2, H2, F2) have H_f = 0
  get_standard_chemical_potential(gas: GasSpecies, temperature: number): number {
    const formation_enthalpy = DEFAULT_ENTHALPY[gas] ?? 0
    return formation_enthalpy - interpolate_ts(DEFAULT_TS_DATA[gas], temperature)
  },

  get_supported_gases(): GasSpecies[] {
    return [...GAS_SPECIES]
  },

  get_temperature_range(): Vec2 {
    return [0, 2000]
  },
}

export const get_default_gas_provider = (): GasThermodynamicsProvider => DEFAULT_GAS_PROVIDER

// Gas Chemical Potential Calculations

// Number of atoms in one gas molecule, summed from the stoichiometry so the two can't drift
const gas_num_atoms = (gas: GasSpecies): number =>
  Object.values(GAS_STOICHIOMETRY[gas]).reduce((sum, count) => sum + count, 0)

// Pressure part of the gas chemical potential, k_B·T·ln(P/P₀) / num_atoms in eV/atom: the
// k_B·T·ln(P/P₀) term is per molecule, hence divided by the atoms per molecule
export const gas_pressure_term = (
  gas: GasSpecies,
  temperature: number,
  pressure: number,
): number =>
  (BOLTZMANN_EV_PER_K * temperature * Math.log(pressure / P_REF)) / gas_num_atoms(gas)

// Gas chemical potential per atom at temperature (K) and pressure (bar), PIRO's convention:
// μ_per_atom(T, P) = μ°_per_atom(T) + k_B·T·ln(P/P₀) / num_atoms, in eV/atom. An invalid or
// non-finite pressure counts as the reference pressure.
export function compute_gas_chemical_potential(
  provider: GasThermodynamicsProvider,
  gas: GasSpecies,
  temperature: number,
  pressure: number,
): number {
  const mu_standard = provider.get_standard_chemical_potential(gas, temperature)
  const effective_pressure = Number.isFinite(pressure) && pressure > 0 ? pressure : P_REF
  return mu_standard + gas_pressure_term(gas, temperature, effective_pressure)
}

// Gas Analysis and Corrections

// Analyze entries to determine which gases are relevant for the chemical system
export function analyze_gas_data(
  entries: PhaseData[],
  config: GasThermodynamicsConfig,
): GasAnalysis {
  const enabled_gases = config.enabled_gases ?? []
  if (enabled_gases.length === 0) {
    return {
      has_gas_dependent_elements: false,
      gas_elements: [],
      relevant_gases: [],
    }
  }

  // Get element-to-gas mapping
  const element_to_gas = {
    ...DEFAULT_ELEMENT_TO_GAS,
    ...config.element_to_gas,
  }

  // Find all elements in the chemical system
  const all_elements = new Set<ElementSymbol>()
  for (const entry of entries) {
    for (const el of Object.keys(entry.composition)) {
      if ((entry.composition[el as ElementSymbol] ?? 0) > 0) {
        all_elements.add(el as ElementSymbol)
      }
    }
  }

  // Find elements that come from enabled gases
  const gas_elements: ElementSymbol[] = []
  const relevant_gases: GasSpecies[] = []

  for (const el of all_elements) {
    const gas = element_to_gas[el]
    if (gas && enabled_gases.includes(gas)) {
      gas_elements.push(el)
      if (!relevant_gases.includes(gas)) {
        relevant_gases.push(gas)
      }
    }
  }

  return {
    has_gas_dependent_elements: gas_elements.length > 0,
    gas_elements,
    relevant_gases,
  }
}

// Pressures for every gas: the config's finite positive values over the defaults
export function get_effective_pressures(
  config: GasThermodynamicsConfig,
): Record<GasSpecies, number> {
  const pressures = { ...DEFAULT_GAS_PRESSURES }
  for (const [gas, pressure] of Object.entries(config.pressures ?? {})) {
    if (Number.isFinite(pressure) && pressure > 0) pressures[gas as GasSpecies] = pressure
  }
  return pressures
}

// Chemical potential correction (eV/atom of compound) for an entry's energy: the difference
// between the gas chemical potential at (T, P) and at the reference state (0 K, 1 bar). For a
// compound A_x B_y where B comes from gas B2: ΔE = (y/2) * [μ(B2, T, P) - μ(B2, 0K, 1bar)],
// shifting the formation energy with the gas atmosphere.
export function compute_gas_correction(
  entry: PhaseData,
  config: GasThermodynamicsConfig,
  temperature: number,
  pressures: Record<GasSpecies, number>,
): number {
  const provider = config.provider ?? get_default_gas_provider()
  const element_to_gas = {
    ...DEFAULT_ELEMENT_TO_GAS,
    ...config.element_to_gas,
  }
  const enabled_gases = new Set(config.enabled_gases)

  let correction = 0
  const n_atoms = count_atoms_in_composition(entry.composition)

  for (const [el_str, amount] of Object.entries(entry.composition)) {
    if (typeof amount !== `number` || amount <= 0) continue
    const el = el_str as ElementSymbol

    const gas = element_to_gas[el]
    if (!gas || !enabled_gases.has(gas)) continue

    const stoich = GAS_STOICHIOMETRY[gas][el] ?? 1
    const num_atoms = gas_num_atoms(gas)

    // Per atom of gas at (T, P) versus the reference (0 K, 1 bar), where T*S vanishes
    const mu_at_conditions = compute_gas_chemical_potential(
      provider,
      gas,
      temperature,
      pressures[gas],
    )
    const mu_ref = provider.get_standard_chemical_potential(gas, 0)

    // Per atom of gas → per atom of this element: multiply by num_atoms, divide by stoich
    const delta_mu = ((mu_at_conditions - mu_ref) * num_atoms) / stoich

    // Total correction for this element in the compound (per atom of compound)
    correction += (amount / n_atoms) * delta_mu
  }

  return correction
}

// Apply gas chemical potential corrections to elemental reference entries only.
// IMPORTANT: Corrections are only applied to unary (single-element) entries.
// This is thermodynamically correct because:
// - Formation energy = E(compound) - Σ n_i * μ_i
// - For gas-forming elements (O, N, H...), μ_i = μ(gas, T, P)
// - For solid elements, μ_i = E(element)
// If we applied corrections to ALL entries, they would cancel out in the
// formation energy calculation, resulting in no change to the hull.
// By only correcting unary references, we effectively replace the standard
// elemental reference with the gas chemical potential at (T, P).
export function apply_gas_corrections(
  entries: PhaseData[],
  config: GasThermodynamicsConfig | undefined,
  temperature: number,
): PhaseData[] {
  if (!config?.enabled_gases?.length) return entries

  const analysis = analyze_gas_data(entries, config)

  // No gas-dependent elements, return entries unchanged
  if (!analysis.has_gas_dependent_elements) return entries

  const pressures = get_effective_pressures(config)

  // Elements whose reference energy moved: every formation energy measured against one of them
  // is now stale, including on the compounds returned untouched, hence the second pass below.
  const shifted_elements = new Set<string>()

  const corrected = entries.map((entry) => {
    // Only apply corrections to unary (single-element) entries
    // These serve as reference states for formation energy calculations
    const elements_in_entry = Object.entries(entry.composition).filter(
      ([, amt]) => typeof amt === `number` && amt > 0,
    )
    if (elements_in_entry.length !== 1) return entry // Not unary, skip

    const correction = compute_gas_correction(entry, config, temperature, pressures)

    // If no correction needed, return entry unchanged
    if (Math.abs(correction) < 1e-12) return entry

    // compute_gas_correction is PER-ATOM: shift energy_per_atom by it and rescale total
    // energy by atom count so downstream formation energies use the corrected values
    const atoms = count_atoms_in_composition(entry.composition)
    const energy_per_atom = (entry.energy_per_atom ?? entry.energy / atoms) + correction
    shifted_elements.add(elements_in_entry[0][0])
    // the MP correction stays: the shifted base above is the RAW per-atom energy
    return { ...entry, energy: energy_per_atom * atoms, energy_per_atom }
  })

  if (shifted_elements.size === 0) return entries
  return corrected.map((entry) =>
    // amt > 0: a zero-amount element is absent, so its key must not invalidate a live cache
    Object.entries(entry.composition).some(([el, amt]) => amt > 0 && shifted_elements.has(el))
      ? drop_cached_hull_data(entry)
      : entry,
  )
}

// Format chemical potential for display (e.g., "-1.23 eV")
export const format_chemical_potential = (mu: number, decimals = 3): string =>
  `${mu >= 0 ? `+` : ``}${format_num(mu, `.${decimals}~f`)} eV`
