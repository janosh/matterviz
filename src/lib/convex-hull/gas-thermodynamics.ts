// Gas phase thermodynamics for atmosphere-controlled convex hull analysis

import { is_finite_number } from '#lib/utils.js'
import { format_num } from 'svelte-widgets/format'
import { count_atoms_in_composition } from '#lib/composition/reduce.js'
import {
  entry_has_temp_data,
  find_lowest_energy_unary_refs,
  get_energy_per_atom,
  has_absolute_energy,
  unary_ref_score,
} from './thermodynamics'
import { BOLTZMANN_EV_PER_K } from '#lib/constants.js'
import type { ElementSymbol } from '#lib/element/index.js'
import type {
  GasAnalysis,
  GasSpecies,
  GasThermodynamicsConfig,
  GasThermodynamicsProvider,
  PhaseData,
} from './types'
import { DEFAULT_GAS_PRESSURES, GAS_SPECIES } from './types'

export const P_REF = 1.0 // Reference pressure in bar

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

// Standard chemical potential per atom on the elements' 0 K enthalpy scale (matching 0 K
// computed energies): μ°(T) = Δ_fH(0 K) + [H(T) - H(0 K)] - T·S(T), per atom. Dropping the
// enthalpy increment overstated how far μ_O falls by 0.16 eV/atom at 1000 K.
// Source: NIST-JANAF Thermochemical Tables, 4th ed. (Chase 1998, https://janaf.nist.gov/tables):
// O2 O-029, H2 H-050, N2 N-023, CO C-093, CO2 C-095, H2O H-064 (ideal gas), F2 F-054.

// Temperature grid (K) shared by all tabulated data below
// oxfmt-ignore
const TS_TEMPERATURES = [0, 298, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000]

// T*S(T) in eV PER ATOM (not per molecule) at TS_TEMPERATURES: O2 at 298 K holds 0.317, half
// of 0.6339 eV/molecule, as compute_gas_correction's num_atoms factor assumes. Barin/NBS data
// via PIRO (https://github.com/GENESIS-EFRC/piro), F2 from JANAF F-054; within 1e-3 of JANAF.
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
  let idx = 0
  while (idx < temps.length - 1 && temps[idx + 1] < temperature) idx++
  const fraction = (temperature - temps[idx]) / (temps[idx + 1] - temps[idx])
  return values[idx] + fraction * (values[idx + 1] - values[idx])
}

// Default provider backed by the built-in tables above. Stateless, so one shared instance.
const DEFAULT_GAS_PROVIDER: GasThermodynamicsProvider = {
  // μ°(T) = Δ_fH(0 K) + [H(T) - H(0 K)] - T*S(T)
  get_standard_chemical_potential(gas: GasSpecies, temperature: number): number {
    const formation_enthalpy = DEFAULT_ENTHALPY[gas] ?? 0
    return (
      formation_enthalpy +
      interpolate_ts(DEFAULT_ENTHALPY_INCREMENT[gas], temperature) -
      interpolate_ts(DEFAULT_TS_DATA[gas], temperature)
    )
  },
}

export const get_default_gas_provider = (): GasThermodynamicsProvider => DEFAULT_GAS_PROVIDER

// Gas Chemical Potential Calculations

// Number of atoms in one gas molecule, summed from the stoichiometry so the two can't drift
const gas_num_atoms = (gas: GasSpecies): number =>
  Object.values(GAS_STOICHIOMETRY[gas]).reduce((sum, count) => sum + count, 0)

// Pressure part of the gas chemical potential (eV/atom): k_B·T·ln(P/P₀) / atoms per molecule
export const gas_pressure_term = (
  gas: GasSpecies,
  temperature: number,
  pressure: number,
): number =>
  (BOLTZMANN_EV_PER_K * temperature * Math.log(pressure / P_REF)) / gas_num_atoms(gas)

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

// Whether a gas is made of one element (O2, N2, H2, F2): such a gas sets its element's chemical
// potential. Compound gases (CO, CO2, H2O) instead join the hull as phases of their own.
export const is_elemental_gas = (gas: GasSpecies): boolean =>
  Object.keys(GAS_STOICHIOMETRY[gas]).length === 1

// The elemental gas of each element that has one: O → O2, N → N2, H → H2, F → F2
export const ELEMENTAL_GASES: Readonly<Partial<Record<ElementSymbol, GasSpecies>>> =
  Object.fromEntries(
    GAS_SPECIES.filter(is_elemental_gas).map((gas) => [
      Object.keys(GAS_STOICHIOMETRY[gas])[0],
      gas,
    ]),
  )

// Gases made only of `elements` (all of GAS_SPECIES, else `enabled` in its order): the only
// ones that can form, or set a chemical potential, in that chemical system
export const relevant_gases = (
  elements: Iterable<string>,
  enabled: readonly GasSpecies[] = GAS_SPECIES,
): GasSpecies[] => {
  const present = new Set(elements)
  return enabled.filter((gas) =>
    Object.keys(GAS_STOICHIOMETRY[gas]).every((element) => present.has(element)),
  )
}

// Elements with a positive amount in any entry
const present_elements = (entries: readonly PhaseData[]): Set<string> =>
  new Set(
    entries.flatMap(({ composition }) =>
      Object.entries(composition).flatMap(([element, amount]) =>
        amount > 0 ? [element] : [],
      ),
    ),
  )

// Enabled gases that act on these entries: all their elements are present
export const analyze_gas_data = (
  entries: readonly PhaseData[],
  config: GasThermodynamicsConfig,
): GasAnalysis => ({
  relevant_gases: relevant_gases(present_elements(entries), config.enabled_gases ?? []),
})

// The phase entry of a compound gas (no energy: callers add theirs)
export const gas_phase_entry = (gas: GasSpecies) => ({
  composition: { ...GAS_STOICHIOMETRY[gas] },
  gas,
  entry_id: `gas:${gas}`,
  reduced_formula: gas,
  name: `${gas} gas`,
})

// Whether a composition is that of `gas`, in any multiple (C2O4 is CO2)
export function is_gas_composition(
  composition: Partial<Record<string, number>>,
  gas: GasSpecies,
): boolean {
  const stoichiometry: Partial<Record<string, number>> = GAS_STOICHIOMETRY[gas]
  const atoms = count_atoms_in_composition(composition)
  const gas_atoms = gas_num_atoms(gas)
  if (!(atoms > 0)) return false
  const elements = new Set([...Object.keys(stoichiometry), ...Object.keys(composition)])
  return [...elements].every(
    (element) =>
      Math.abs(
        (composition[element] ?? 0) / atoms - (stoichiometry[element] ?? 0) / gas_atoms,
      ) < 1e-9,
  )
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

// Shift of an element's chemical potential (eV/atom) set by its enabled elemental gas at (T, P)
// relative to (0 K, 1 bar), where H(T) - H(0 K) and T*S vanish: μ_O2(T, P) per atom - μ°_O2(0 K)
// per atom for O. 0 for every other element: compound gases are hull phases, not reservoirs of
// any one element, so solid elements (C in CO2, the H of H2O without H2) never move.
export function compute_element_mu_shift(
  element: ElementSymbol,
  config: GasThermodynamicsConfig,
  temperature: number,
  pressures: Record<GasSpecies, number>,
): number {
  const gas = ELEMENTAL_GASES[element]
  if (!gas || !config.enabled_gases?.includes(gas)) return 0
  const provider = config.provider ?? get_default_gas_provider()
  return (
    compute_gas_chemical_potential(provider, gas, temperature, pressures[gas]) -
    provider.get_standard_chemical_potential(gas, 0)
  )
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

// Gas atmospheres at (T, P) on a hull, as synthesis planning treats open gases:
// - an elemental gas (O2, N2, H2, F2) is its element's reference state: the element's unary entries
//   move by Δμ_e (compute_element_mu_shift; a unary with its own G(T) table, via
//   filter_entries_at_temperature, by k_B T ln(p/p0) only) and every E_form is re-referenced to
//   the moved level, so that corner stays at E_form = 0 (correcting every entry would cancel out)
// - a compound gas (CO, CO2, H2O) joins the hull as a phase at μ(T, P) per atom, formed from the
//   elements' 0 K references (`gas` set, entry_id `gas:<species>`). It replaces the entries of
//   its formula, which stay shown but leave the hull (exclude_from_hull), and moves no element:
//   graphite stays graphite under CO2.
// Gases whose elements are not all present do nothing.
export function apply_gas_corrections(
  entries: PhaseData[],
  config: GasThermodynamicsConfig,
  temperature: number,
): PhaseData[] {
  const gases = relevant_gases(present_elements(entries), config.enabled_gases ?? [])
  if (gases.length === 0) return entries
  const compound_gases = gases.filter((gas) => !is_elemental_gas(gas))
  const gas_elements = new Set(
    gases.filter(is_elemental_gas).map((gas) => Object.keys(GAS_STOICHIOMETRY[gas])[0]),
  )
  const pressures = get_effective_pressures(config)
  const provider = config.provider ?? get_default_gas_provider()

  // Per-atom energy shift of each entry: only unaries of elemental-gas elements move
  const unary_elements = entries.map((entry) => {
    const present = Object.keys(entry.composition).filter(
      (element) => (entry.composition[element as ElementSymbol] ?? 0) > 0,
    ) as ElementSymbol[]
    return present.length === 1 ? present[0] : null
  })
  const shifts = entries.map((entry, idx) => {
    const element = unary_elements[idx]
    const gas = element && gas_elements.has(element) ? ELEMENTAL_GASES[element] : undefined
    if (!element || !gas) return 0
    const correction = entry_has_temp_data(entry)
      ? gas_pressure_term(gas, temperature, pressures[gas])
      : compute_element_mu_shift(element, config, temperature, pressures)
    return Math.abs(correction) < 1e-12 ? 0 : correction
  })
  // A gas element without a reference entry (E_form-only data, where the hull closes that
  // corner at E_form = 0) still has a reference level, and it moves by the element's full Δμ
  const old_refs = find_lowest_energy_unary_refs(entries)
  const ref_shift = new Map<string, number>()
  for (const element of gas_elements) {
    if (old_refs[element]) continue
    const shift = compute_element_mu_shift(
      element as ElementSymbol,
      config,
      temperature,
      pressures,
    )
    if (Math.abs(shift) >= 1e-12) ref_shift.set(element, shift)
  }
  if (shifts.every((shift) => shift === 0) && ref_shift.size === 0 && !compound_gases.length)
    return entries

  // Elements with a moved unary or implicit reference: hull distances against them are stale.
  // Δμ_e is how far the element's formation-energy reference level moves (0 when only a
  // polymorph above it moved). The shifts can reorder polymorphs (a tabulated one only gets the
  // pressure term), so the reference is picked again after shifting.
  const shifted_elements = new Set<string | null>([
    ...unary_elements.filter((_, idx) => shifts[idx] !== 0),
    ...ref_shift.keys(),
  ])
  const entry_idx = new Map(entries.map((entry, idx) => [entry, idx]))
  for (const [element, ref] of Object.entries(
    find_lowest_energy_unary_refs(entries, shifts),
  )) {
    const shift = shifts[entry_idx.get(ref) ?? -1]
    const old_ref = old_refs[element]
    // the same reference moves by exactly its own shift (no score round trip)
    ref_shift.set(
      element,
      ref === old_ref ? shift : unary_ref_score(ref) + shift - unary_ref_score(old_ref),
    )
  }
  // Σ x_e Δμ_e: how far a composition's reference level moved
  const ref_sum_of = (composition: Partial<Record<string, number>>): number => {
    const atoms = count_atoms_in_composition(composition)
    let ref_sum = 0
    for (const [element, amt = 0] of Object.entries(composition)) {
      if (amt > 0) ref_sum += (amt / atoms) * (ref_shift.get(element) ?? 0)
    }
    return ref_sum
  }

  const corrected = entries.map((entry, idx) => {
    const own_shift = shifts[idx]
    const atoms = count_atoms_in_composition(entry.composition)
    const replaced = compound_gases.some((gas) => is_gas_composition(entry.composition, gas))
    // a new gas phase reshapes the hull, so every cached hull distance goes; otherwise a
    // zero-amount key is absent and must not invalidate a cache
    const stale =
      compound_gases.length > 0 ||
      own_shift !== 0 ||
      Object.entries(entry.composition).some(
        ([element, amt]) => amt > 0 && shifted_elements.has(element),
      )
    if (!stale) return entry
    // A cached E_form moves by the entry's own shift minus Σ x_e Δμ_e, so E_form-only entries
    // (no energy to recompute it from) follow the atmosphere too
    const { e_form_per_atom: e_form } = entry
    // hull distances were measured against the old references and phases
    const moved: PhaseData = {
      ...entry,
      e_form_per_atom: is_finite_number(e_form)
        ? e_form + own_shift - ref_sum_of(entry.composition)
        : undefined,
      e_above_hull: undefined,
      is_stable: undefined,
      ...(replaced && { exclude_from_hull: true }),
    }
    // the MP correction stays: the shifted base is the RAW per-atom energy (none for E_form-only
    // entries, whose shift the E_form above carries)
    const raw_per_atom =
      entry.energy_per_atom ?? (entry.energy === undefined ? undefined : entry.energy / atoms)
    if (own_shift === 0 || raw_per_atom === undefined) return moved
    const energy_per_atom = raw_per_atom + own_shift
    return { ...moved, energy: energy_per_atom * atoms, energy_per_atom }
  })

  // Compound gas phases: E_form = μ(T, P) per atom on the 0 K references, re-referenced like
  // every entry; an absolute energy on the references' scale when they all have one
  const gas_entries = compound_gases.map((gas): PhaseData => {
    const entry = gas_phase_entry(gas)
    const { composition } = entry
    const atoms = gas_num_atoms(gas)
    const mu_form = compute_gas_chemical_potential(provider, gas, temperature, pressures[gas])
    let ref_energy = 0 // Σ x_e E_e of the 0 K references, NaN without absolute ones
    for (const [element, amt = 0] of Object.entries(composition)) {
      const ref = old_refs[element]
      ref_energy +=
        ref && has_absolute_energy(ref) ? (amt / atoms) * get_energy_per_atom(ref) : NaN
    }
    const energy_per_atom = mu_form + ref_energy
    return {
      ...entry,
      e_form_per_atom: mu_form - ref_sum_of(composition),
      // E_form-only when a reference has no absolute energy
      ...(Number.isFinite(energy_per_atom) && {
        energy: energy_per_atom * atoms,
        energy_per_atom,
      }),
    }
  })
  return [...corrected, ...gas_entries]
}

// Format chemical potential for display (e.g., "-1.23 eV")
export const format_chemical_potential = (mean: number, decimals: number): string =>
  `${mean >= 0 ? `+` : ``}${format_num(mean, `.${decimals}~f`)} eV`
