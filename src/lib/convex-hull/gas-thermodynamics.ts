// Gas phase thermodynamics for convex hull calculations
// Enables atmosphere-controlled phase diagram analysis

import { count_atoms_in_composition } from '#lib/composition/reduce.js'
import { drop_cached_hull_data, entry_has_temp_data } from './thermodynamics'
import { BOLTZMANN_EV_PER_K } from '#lib/constants.js'
import type { ElementSymbol } from '#lib/element/index.js'
import { format_num } from '#lib/labels.js'
import type { Vec2 } from '#lib/math.js'
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

// Standard chemical potential per atom on the 0 K enthalpy scale of the elements, matching 0 K
// computed energies: μ°(T) = Δ_fH(0 K) + [H(T) - H(0 K)] - T·S(T), divided by atoms per molecule.
// Elemental gases sit at 0 at 0 K, so a 0 K computed reference E_0K becomes
// E_0K + [H(T) - H(0 K)] - T·S(T) (+ k_B·T·ln(p/p0), all per atom). Dropping the enthalpy
// increment (μ° = Δ_fH - T·S) overstated how far μ_O falls by 0.16 eV/atom at 1000 K.
// Source: NIST-JANAF Thermochemical Tables, 4th ed. (Chase 1998, https://janaf.nist.gov/tables):
// O2 O-029, H2 H-050, N2 N-023, CO C-093, CO2 C-095, H2O H-064 (ideal gas), F2 F-054.

// Temperature grid (K) shared by all tabulated data below
// oxfmt-ignore
const TS_TEMPERATURES = [0, 298, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000]

// T*S(T) in eV PER ATOM (not per molecule) at TS_TEMPERATURES, interpolated between grid points.
// O2 at 298 K: S = 205.15 J/mol/K = 0.6339 eV/molecule and the table holds 0.317, i.e. half of
// it. compute_gas_correction's num_atoms factor assumes this, so regenerating the table per
// molecule would scale every gas correction by its atom count. Barin/NBS tables as compiled by
// PIRO (https://github.com/GENESIS-EFRC/piro), F2 from JANAF F-054; all within 1e-3 eV/atom of
// JANAF.
// oxfmt-ignore
const DEFAULT_TS_DATA: Readonly<Record<GasSpecies, number[]>> = {
  O2: [0, 0.317, 0.3192, 0.4433, 0.5718, 0.7041, 0.8396, 0.9781, 1.119, 1.2623, 1.4075, 1.5547, 1.7036, 1.8541, 2.006, 2.1594, 2.3141, 2.47, 2.6271, 2.7854],
  H2: [0, 0.2019, 0.2034, 0.2886, 0.3776, 0.4697, 0.5645, 0.6614, 0.7605, 0.8614, 0.964, 1.0683, 1.1741, 1.2815, 1.3902, 1.5003, 1.6116, 1.7242, 1.838, 1.9528],
  N2: [0, 0.2959, 0.2981, 0.4149, 0.5356, 0.6596, 0.7866, 0.9161, 1.0481, 1.1822, 1.3184, 1.4563, 1.596, 1.7372, 1.8799, 2.0239, 2.1693, 2.3158, 2.4634, 2.6122],
  CO: [0, 0.3054, 0.3076, 0.4275, 0.5515, 0.6788, 0.8092, 0.9423, 1.0778, 1.2155, 1.3552, 1.4967, 1.64, 1.7848, 1.9311, 2.0788, 2.2277, 2.3779, 2.5291, 2.6815],
  CO2: [0, 0.2202, 0.2218, 0.3113, 0.4057, 0.5042, 0.6064, 0.7116, 0.8197, 0.9303, 1.0432, 1.1582, 1.2751, 1.3938, 1.5141, 1.636, 1.7593, 1.8839, 2.0098, 2.1369],
  H2O: [0, 0.1946, 0.1961, 0.2749, 0.357, 0.4419, 0.5293, 0.6189, 0.7107, 0.8045, 0.9001, 0.9975, 1.0966, 1.1972, 1.2994, 1.403, 1.5079, 1.6142, 1.7216, 1.8303],
  F2: [0, 0.3131, 0.3156, 0.4399, 0.5694, 0.7029, 0.8399, 0.9799, 1.1224, 1.2673, 1.41424, 1.5631, 1.7137, 1.8659, 2.0196, 2.1747, 2.3311, 2.4888, 2.6477, 2.8077],
}

// Enthalpy increment H(T) - H(0 K) in eV PER ATOM at TS_TEMPERATURES (JANAF H - H(298.15 K)
// plus its 0 K row's H(298.15 K) - H(0 K), e.g. O2: 22.703 + 8.683 kJ/mol at 1000 K)
// oxfmt-ignore
const DEFAULT_ENTHALPY_INCREMENT: Readonly<Record<GasSpecies, number[]>> = {
  O2: [0, 0.045, 0.0453, 0.0607, 0.0765, 0.0929, 0.1098, 0.1271, 0.1447, 0.1626, 0.1808, 0.1992, 0.2178, 0.2365, 0.2554, 0.2744, 0.2935, 0.3128, 0.3322, 0.3516],
  H2: [0, 0.0439, 0.0442, 0.0592, 0.0744, 0.0895, 0.1048, 0.1201, 0.1355, 0.151, 0.1668, 0.1827, 0.1989, 0.2153, 0.2319, 0.2488, 0.2659, 0.2831, 0.3006, 0.3183],
  N2: [0, 0.0449, 0.0452, 0.0603, 0.0756, 0.091, 0.1068, 0.1229, 0.1394, 0.1562, 0.1732, 0.1906, 0.2082, 0.226, 0.2439, 0.2621, 0.2803, 0.2987, 0.3172, 0.3358],
  CO: [0, 0.0449, 0.0452, 0.0604, 0.0757, 0.0913, 0.1072, 0.1236, 0.1403, 0.1573, 0.1747, 0.1923, 0.2101, 0.2281, 0.2463, 0.2646, 0.283, 0.3016, 0.3202, 0.339],
  CO2: [0, 0.0323, 0.0326, 0.0462, 0.061, 0.0769, 0.0937, 0.1111, 0.1292, 0.1477, 0.1667, 0.186, 0.2056, 0.2255, 0.2455, 0.2658, 0.2862, 0.3068, 0.3275, 0.3482],
  H2O: [0, 0.0342, 0.0344, 0.0461, 0.0581, 0.0705, 0.0832, 0.0964, 0.11, 0.124, 0.1385, 0.1534, 0.1688, 0.1845, 0.2006, 0.217, 0.2338, 0.2508, 0.2681, 0.2857],
  F2: [0, 0.0457, 0.046, 0.0627, 0.0802, 0.0982, 0.1166, 0.1353, 0.1542, 0.1733, 0.1926, 0.212, 0.2315, 0.2512, 0.2709, 0.2908, 0.3107, 0.3307, 0.3508, 0.3709],
}

// Formation enthalpies Δ_fH(0 K) in eV PER ATOM (JANAF 0 K rows, the 0 K scale above), e.g.
// CO2: -393.151 kJ/mol = -4.0748 eV/molecule over 3 atoms = -1.3583
const DEFAULT_ENTHALPY: Readonly<Partial<Record<GasSpecies, number>>> = {
  CO: -0.5897,
  // CO2: -0.2482 eV correction to improve accuracy for carbonate phase predictions
  // (Wang et al., PRB 73, 195107)
  CO2: -1.3583 - 0.2482,
  H2O: -0.82547,
  // O2, N2, H2, F2 are reference states with H_f = 0
}

// Linearly interpolate a tabulated value at `temperature` (clamped to the tabulated range)
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
  // μ°(T) = Δ_fH(0 K) + [H(T) - H(0 K)] - T*S(T); the elemental gases (O2, N2, H2, F2) have
  // Δ_fH = 0
  get_standard_chemical_potential(gas: GasSpecies, temperature: number): number {
    const formation_enthalpy = DEFAULT_ENTHALPY[gas] ?? 0
    return (
      formation_enthalpy +
      interpolate_ts(DEFAULT_ENTHALPY_INCREMENT[gas], temperature) -
      interpolate_ts(DEFAULT_TS_DATA[gas], temperature)
    )
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

// Shift of an element whose reference already carries its own G(T) (a tabulated entry, SISSO's
// experimental 1 bar gas): only k_B T ln(p/p0) is missing, since H(T) - H(0 K) - T*S is in G(T)
// already. Only elemental gases (O2, N2, ...) map one element to one pressure term; compound
// gases (CO2, CO, H2O) have no such reference.
export const tabulated_reference_shift = (
  gas: GasSpecies,
  temperature: number,
  pressure: number,
): number =>
  Object.keys(GAS_STOICHIOMETRY[gas]).length === 1
    ? gas_pressure_term(gas, temperature, pressure)
    : 0

// Gas chemical potential per atom at temperature (K) and pressure (bar):
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

// Elements present (positive amount) that come from an enabled gas, and those gases, in
// order of first appearance
export function analyze_gas_data(
  entries: PhaseData[],
  config: GasThermodynamicsConfig,
): GasAnalysis {
  const enabled_gases = config.enabled_gases ?? []
  const element_to_gas = { ...DEFAULT_ELEMENT_TO_GAS, ...config.element_to_gas }
  const present = new Set(
    entries.flatMap(({ composition }) =>
      (Object.keys(composition) as ElementSymbol[]).filter(
        (element) => (composition[element] ?? 0) > 0,
      ),
    ),
  )
  const gas_elements = [...present].filter((element) => {
    const gas = element_to_gas[element]
    return gas !== undefined && enabled_gases.includes(gas)
  })
  const relevant_gases = [
    ...new Set(gas_elements.flatMap((element) => element_to_gas[element] ?? [])),
  ]
  return { has_gas_dependent_elements: gas_elements.length > 0, gas_elements, relevant_gases }
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

// Shift of an element's chemical potential (eV/atom) set by its gas reservoir at (T, P)
// relative to (0 K, 1 bar). A gas fixes only the sum of its elements' potentials, e.g.
// Δμ(CO2) = Δμ_C + 2 Δμ_O, so partners with their own enabled reservoir (O from O2) are pinned
// by it and the element gets the remainder. Partners without a reservoir contribute 0.
export function compute_element_mu_shift(
  element: ElementSymbol,
  config: GasThermodynamicsConfig,
  temperature: number,
  pressures: Record<GasSpecies, number>,
): number {
  const element_to_gas: Partial<Record<string, GasSpecies>> = {
    ...DEFAULT_ELEMENT_TO_GAS,
    ...config.element_to_gas,
  }
  const provider = config.provider ?? get_default_gas_provider()
  const shift = (elem: string, resolving: string[]): number => {
    const gas = element_to_gas[elem]
    if (!gas || !config.enabled_gases?.includes(gas)) return 0
    const stoichiometry: Record<string, number> = GAS_STOICHIOMETRY[gas]
    const stoich = stoichiometry[elem]
    if (!stoich) throw new Error(`element_to_gas maps ${elem} to ${gas}, which has no ${elem}`)
    if (resolving.includes(elem)) {
      throw new Error(
        `Gas reservoirs for ${[...resolving, elem].join(` → `)} depend on each other; map each element to a gas whose other elements have their own reservoir`,
      )
    }
    // Per molecule at (T, P) versus the reference (0 K, 1 bar), where H(T) - H(0 K) and T*S
    // vanish
    const molecule_shift =
      (compute_gas_chemical_potential(provider, gas, temperature, pressures[gas]) -
        provider.get_standard_chemical_potential(gas, 0)) *
      gas_num_atoms(gas)
    let partner_shift = 0
    for (const [partner, count] of Object.entries(stoichiometry)) {
      if (partner !== elem) partner_shift += count * shift(partner, [...resolving, elem])
    }
    return (molecule_shift - partner_shift) / stoich
  }
  return shift(element, [])
}

// Chemical potential correction (eV/atom of compound) for an entry's energy: the composition-
// weighted element shifts of compute_element_mu_shift. For A_x B_y with B from gas B2:
// ΔE = y/(x+y) · Δμ_B, shifting the formation energy with the gas atmosphere.
export function compute_gas_correction(
  entry: PhaseData,
  config: GasThermodynamicsConfig,
  temperature: number,
  pressures: Record<GasSpecies, number>,
): number {
  const n_atoms = count_atoms_in_composition(entry.composition)
  let correction = 0
  for (const [element, amount] of Object.entries(entry.composition)) {
    if (typeof amount !== `number` || amount <= 0) continue
    correction +=
      (amount / n_atoms) *
      compute_element_mu_shift(element as ElementSymbol, config, temperature, pressures)
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
// elemental reference with the gas chemical potential at (T, P). A unary with a G(T) table
// (its energy is G(T) after filter_entries_at_temperature) only gets the pressure term.
export function apply_gas_corrections(
  entries: PhaseData[],
  config: GasThermodynamicsConfig | undefined,
  temperature: number,
): PhaseData[] {
  // No enabled gas or no gas-dependent element: entries unchanged
  if (!config || !analyze_gas_data(entries, config).has_gas_dependent_elements) return entries

  const pressures = get_effective_pressures(config)
  const element_to_gas = { ...DEFAULT_ELEMENT_TO_GAS, ...config.element_to_gas }
  const tabulated_shift = (element: ElementSymbol): number => {
    const gas = element_to_gas[element]
    return gas && config.enabled_gases?.includes(gas)
      ? tabulated_reference_shift(gas, temperature, pressures[gas])
      : 0
  }

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

    const correction = entry_has_temp_data(entry)
      ? tabulated_shift(elements_in_entry[0][0] as ElementSymbol)
      : compute_gas_correction(entry, config, temperature, pressures)

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
    Object.entries(entry.composition).some(
      ([element, amt]) => amt > 0 && shifted_elements.has(element),
    )
      ? drop_cached_hull_data(entry)
      : entry,
  )
}

// Format chemical potential for display (e.g., "-1.23 eV")
export const format_chemical_potential = (mean: number, decimals = 3): string =>
  `${mean >= 0 ? `+` : ``}${format_num(mean, `.${decimals}~f`)} eV`
