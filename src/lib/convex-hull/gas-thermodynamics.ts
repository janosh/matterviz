// Gas phase thermodynamics for convex hull calculations
// Enables atmosphere-controlled phase diagram analysis

import { count_atoms_in_composition } from '$lib/composition'
import type {
  GasAnalysis,
  GasSpecies,
  GasThermodynamicsConfig,
  GasThermodynamicsProvider,
  PhaseData,
} from '$lib/convex-hull/types'
import { DEFAULT_GAS_PRESSURES, GAS_SPECIES } from '$lib/convex-hull/types'
import type { ElementSymbol } from '$lib/element'

// Physical constants
export const R_EV_PER_K = 8.617333262e-5 // Gas constant in eV/K (k_B)
export const P_REF = 1.0 // Reference pressure in bar

// Default element-to-gas mapping (which element comes from which gas)
export const DEFAULT_ELEMENT_TO_GAS: Readonly<Partial<Record<string, GasSpecies>>> = {
  O: `O2`,
  N: `N2`,
  H: `H2`,
  F: `F2`,
  C: `CO2`, // Carbon typically from CO2 in oxidizing atmospheres
}

// Stoichiometric coefficients: atoms of element per molecule of gas
// e.g., O2 has 2 O atoms, H2O has 2 H and 1 O
export const GAS_STOICHIOMETRY: Readonly<
  Record<GasSpecies, Partial<Record<string, number>>>
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

// Entropy contribution T*S at various temperatures (in eV/molecule)
// Data points at 0, 298, 300, 400, ..., 2000 K
// This data structure allows interpolation between tabulated values
interface TabulatedTSData {
  temperatures: number[] // K
  values: number[] // eV/molecule
}

// Default T*S data for common gases (in eV/molecule)
// Source: Barin Thermochemical Tables and NBS Thermochemical Tables
// Data compiled to match PIRO (https://github.com/GENESIS-EFRC/piro)
// Note: These values are T*S in eV/molecule
// deno-fmt-ignore
const DEFAULT_TS_DATA: Readonly<Record<GasSpecies, TabulatedTSData>> = {
  O2: {
    temperatures: [0, 298, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000],
    values: [0, 0.317, 0.3192, 0.4433, 0.5718, 0.7041, 0.8396, 0.9781, 1.119, 1.2623, 1.4075, 1.5547, 1.7036, 1.8541, 2.006, 2.1594, 2.3141, 2.47, 2.6271, 2.7854],
  },
  H2: {
    temperatures: [0, 298, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000],
    values: [0, 0.2019, 0.2034, 0.2886, 0.3776, 0.4697, 0.5645, 0.6614, 0.7605, 0.8614, 0.964, 1.0683, 1.1741, 1.2815, 1.3902, 1.5003, 1.6116, 1.7242, 1.838, 1.9528],
  },
  N2: {
    temperatures: [0, 298, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000],
    values: [0, 0.2959, 0.2981, 0.4149, 0.5356, 0.6596, 0.7866, 0.9161, 1.0481, 1.1822, 1.3184, 1.4563, 1.596, 1.7372, 1.8799, 2.0239, 2.1693, 2.3158, 2.4634, 2.6122],
  },
  CO: {
    temperatures: [0, 298, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000],
    values: [0, 0.3054, 0.3076, 0.4275, 0.5515, 0.6788, 0.8092, 0.9423, 1.0778, 1.2155, 1.3552, 1.4967, 1.64, 1.7848, 1.9311, 2.0788, 2.2277, 2.3779, 2.5291, 2.6815],
  },
  CO2: {
    temperatures: [0, 298, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000],
    values: [0, 0.2202, 0.2218, 0.3113, 0.4057, 0.5042, 0.6064, 0.7116, 0.8197, 0.9303, 1.0432, 1.1582, 1.2751, 1.3938, 1.5141, 1.636, 1.7593, 1.8839, 2.0098, 2.1369],
  },
  H2O: {
    temperatures: [0, 298, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000],
    values: [0, 0.1946, 0.1961, 0.2749, 0.357, 0.4419, 0.5293, 0.6189, 0.7107, 0.8045, 0.9001, 0.9975, 1.0966, 1.1972, 1.2994, 1.403, 1.5079, 1.6142, 1.7216, 1.8303],
  },
  F2: {
    // F2 not in Barin/NBS tables used by PIRO - approximated from similar homonuclear diatomics (O2, N2)
    temperatures: [0, 298, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000],
    values: [0, 0.31, 0.312, 0.435, 0.56, 0.69, 0.82, 0.96, 1.1, 1.24, 1.38, 1.53, 1.68, 1.83, 1.98, 2.13, 2.29, 2.45, 2.61, 2.77],
  },
}

// Formation enthalpies H_f at 0K in eV/molecule
// These are the reference energies for formation from elements
const DEFAULT_ENTHALPY: Readonly<Partial<Record<GasSpecies, number>>> = {
  CO: -0.5897,
  // CO2: Base value -1.3583 eV from JANAF tables, with -0.2482 eV correction
  // to improve accuracy for carbonate phase predictions (Wang et al., PRB 73, 195107)
  CO2: -1.3583 - 0.2482,
  H2O: -0.82547,
  // O2, N2, H2, F2 are reference states with H_f = 0
}

// Interpolation Helpers

// Linearly interpolate T*S value at given temperature
function interpolate_ts(data: TabulatedTSData, T: number): number {
  const { temperatures, values } = data

  // Clamp to valid range
  if (T <= temperatures[0]) return values[0]
  if (T >= temperatures[temperatures.length - 1]) {
    return values[values.length - 1]
  }

  // Find bracketing indices
  let i = 0
  while (i < temperatures.length - 1 && temperatures[i + 1] < T) i++

  const T_low = temperatures[i]
  const T_high = temperatures[i + 1]
  const v_low = values[i]
  const v_high = values[i + 1]

  // Linear interpolation
  const fraction = (T - T_low) / (T_high - T_low)
  return v_low + fraction * (v_high - v_low)
}

// Default Provider Implementation

// Create the default gas thermodynamics provider using built-in data
export function create_default_gas_provider(): GasThermodynamicsProvider {
  return {
    get_standard_chemical_potential(gas: GasSpecies, T: number): number {
      // μ°(T) = H_f - T*S
      // For elemental gases (O2, N2, H2, F2), H_f = 0
      const H_f = DEFAULT_ENTHALPY[gas] ?? 0
      const TS = interpolate_ts(DEFAULT_TS_DATA[gas], T)
      return H_f - TS
    },

    get_supported_gases(): GasSpecies[] {
      return [...GAS_SPECIES]
    },

    get_temperature_range(): [number, number] {
      return [0, 2000]
    },
  }
}

// Singleton default provider
let default_provider: GasThermodynamicsProvider | null = null

// Get the default gas thermodynamics provider (lazy initialization)
export function get_default_gas_provider(): GasThermodynamicsProvider {
  if (!default_provider) {
    default_provider = create_default_gas_provider()
  }
  return default_provider
}

// Gas Chemical Potential Calculations

// Number of atoms in each gas molecule
const GAS_NUM_ATOMS: Readonly<Record<GasSpecies, number>> = {
  O2: 2,
  N2: 2,
  H2: 2,
  F2: 2,
  CO: 2,
  CO2: 3,
  H2O: 3,
}

// Compute gas chemical potential at given temperature and pressure
// Following PIRO's convention, all values are per atom:
// μ_per_atom(T, P) = H_per_atom - (TS)_per_atom + k_B·T·ln(P/P₀) / num_atoms
// provider - Thermodynamic data provider
// gas - Gas species
// T - Temperature in Kelvin
// P - Pressure in bar
// Returns chemical potential in eV/atom
export function compute_gas_chemical_potential(
  provider: GasThermodynamicsProvider,
  gas: GasSpecies,
  T: number,
  P: number,
): number {
  const mu_standard = provider.get_standard_chemical_potential(gas, T)

  // Clamp invalid/infinite pressure to reference pressure
  const effective_P = Number.isFinite(P) && P > 0 ? P : P_REF

  // μ_per_atom(T, P) = μ°_per_atom(T) + k_B·T·ln(P/P₀) / num_atoms
  // The RT·ln(P) term must be divided by num_atoms to match PIRO's per-atom convention
  const num_atoms = GAS_NUM_ATOMS[gas]
  return mu_standard + (R_EV_PER_K * T * Math.log(effective_P / P_REF)) / num_atoms
}

// Compute chemical potential per atom of a specific element from a gas
// Since compute_gas_chemical_potential returns per-atom of gas molecule,
// we need to convert to per-atom of the specific element.
// For O from O2: μ(O) = μ(O2)_per_atom * num_atoms(O2) / stoich(O in O2) = μ(O2)_per_atom * 2 / 2 = μ(O2)_per_atom
// For O from CO2: μ(O) = μ(CO2)_per_atom * num_atoms(CO2) / stoich(O in CO2) = μ(CO2)_per_atom * 3 / 2
// provider - Thermodynamic data provider
// gas - Gas species
// element - Element symbol
// T - Temperature in Kelvin
// P - Pressure in bar
// Returns chemical potential per atom of element in eV/atom
export function compute_element_chemical_potential(
  provider: GasThermodynamicsProvider,
  gas: GasSpecies,
  element: string,
  T: number,
  P: number,
): number {
  const mu_gas_per_atom = compute_gas_chemical_potential(provider, gas, T, P)
  const num_atoms = GAS_NUM_ATOMS[gas]
  const stoich = GAS_STOICHIOMETRY[gas][element] ?? 1
  // Convert from per-atom-of-gas to per-atom-of-element
  return (mu_gas_per_atom * num_atoms) / stoich
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
  const element_to_gas = { ...DEFAULT_ELEMENT_TO_GAS, ...config.element_to_gas }

  // Find all elements in the chemical system
  const all_elements = new Set<string>()
  for (const entry of entries) {
    for (const el of Object.keys(entry.composition)) {
      if ((entry.composition[el as ElementSymbol] ?? 0) > 0) {
        all_elements.add(el)
      }
    }
  }

  // Find elements that come from enabled gases
  const gas_elements: string[] = []
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

// Get effective pressures for gases, using defaults for unspecified values
export function get_effective_pressures(
  config: GasThermodynamicsConfig,
): Record<GasSpecies, number> {
  const pressures = { ...DEFAULT_GAS_PRESSURES }
  if (config.pressures) {
    for (const [gas, P] of Object.entries(config.pressures)) {
      if (Number.isFinite(P) && P > 0) {
        pressures[gas as GasSpecies] = P
      }
    }
  }
  return pressures
}

// Compute gas chemical potential correction for an entry's energy
// The correction accounts for the difference between the gas chemical potential
// at the given (T, P) and the reference state (0 K, 1 bar).
// For a compound A_x B_y where B comes from gas B2:
// ΔE_correction = (y/2) * [μ(B2, T, P) - μ(B2, 0K, 1bar)]
// This shifts the formation energy based on the gas atmosphere.
export function compute_gas_correction(
  entry: PhaseData,
  config: GasThermodynamicsConfig,
  T: number,
  pressures: Record<GasSpecies, number>,
): number {
  const provider = config.provider ?? get_default_gas_provider()
  const element_to_gas = { ...DEFAULT_ELEMENT_TO_GAS, ...config.element_to_gas }
  const enabled_gases = new Set(config.enabled_gases ?? [])

  let correction = 0
  const n_atoms = count_atoms_in_composition(entry.composition)

  for (const [el, amount] of Object.entries(entry.composition)) {
    if (typeof amount !== `number` || amount <= 0) continue

    const gas = element_to_gas[el]
    if (!gas || !enabled_gases.has(gas)) continue

    const P = pressures[gas]
    const stoich = GAS_STOICHIOMETRY[gas][el] ?? 1
    const num_atoms = GAS_NUM_ATOMS[gas]

    // Chemical potential per atom of gas at current (T, P)
    const mu_TP = compute_gas_chemical_potential(provider, gas, T, P)

    // Chemical potential per atom of gas at reference (0K, 1bar) - just H_f since T*S = 0 at 0K
    const mu_ref = provider.get_standard_chemical_potential(gas, 0)

    // Correction per atom of this element
    // Convert from per-atom-of-gas to per-atom-of-element: multiply by num_atoms, divide by stoich
    const delta_mu = ((mu_TP - mu_ref) * num_atoms) / stoich

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
  T: number,
): PhaseData[] {
  if (!config || !config.enabled_gases?.length) return entries

  const analysis = analyze_gas_data(entries, config)

  // No gas-dependent elements, return entries unchanged
  if (!analysis.has_gas_dependent_elements) return entries

  const pressures = get_effective_pressures(config)

  return entries.map((entry) => {
    // Only apply corrections to unary (single-element) entries
    // These serve as reference states for formation energy calculations
    const elements_in_entry = Object.entries(entry.composition).filter(
      ([, amt]) => typeof amt === `number` && amt > 0,
    )
    if (elements_in_entry.length !== 1) return entry // Not unary, skip

    const correction = compute_gas_correction(entry, config, T, pressures)

    // If no correction needed, return entry unchanged
    if (Math.abs(correction) < 1e-12) return entry

    // Apply correction to energy
    return {
      ...entry,
      energy: entry.energy + correction,
    }
  })
}

// Format chemical potential for display (e.g., "-1.23 eV")
export function format_chemical_potential(mu: number, decimals = 3): string {
  return `${mu >= 0 ? `+` : ``}${mu.toFixed(decimals)} eV`
}

// Format pressure for display (scientific notation for very small/large values)
export function format_pressure(P: number): string {
  if (P >= 0.01 && P < 100) {
    return `${P.toPrecision(3)} bar`
  }
  return `${P.toExponential(2)} bar`
}
