// Temperature-dependent formation Gibbs energies dG_f(T) (eV/atom) for convex-hull entries, all
// relative to the elemental references so they share one hull:
// - tabulated: G_i(T) - sum_e x_e G_e(T), G_e from the lowest-energy unary entry (tabulated/static)
// - sisso: dH_f(0 K) + G^delta(V, m, T) - sum_e x_e G_e^exp(T), the Bartel et al. 2018 descriptor
//   with experimental elemental Gibbs energies (g-els-data.ts)
// - static: E_i - sum_e x_e G_e(T)
// Gas-phase elements (O from O2, ...) shift the references by mu_e(T, p) - mu_e(ref).
import { count_atoms_in_composition } from '$lib/composition/reduce'
import {
  compute_gas_correction,
  DEFAULT_ELEMENT_TO_GAS,
  GAS_STOICHIOMETRY,
  get_effective_pressures,
  R_EV_PER_K,
} from '$lib/convex-hull/gas-thermodynamics'
import { interpolate_energy_at_temperature } from '$lib/convex-hull/helpers'
import { find_lowest_energy_unary_refs } from '$lib/convex-hull/thermodynamics'
import type { GasSpecies, GasThermodynamicsConfig, PhaseData } from '$lib/convex-hull/types'
import type { ElementSymbol } from '$lib/element'
import { element_by_symbol } from '$lib/element/data'
import type { Vec2 } from '$lib/math'
import { G_ELEMENT_TEMPERATURES, G_ELEMENTS } from './g-els-data'
import type { FreeEnergyOptions, FreeEnergySource, PhaseFreeEnergy } from './types'

export const SISSO_T_RANGE: Vec2 = [
  G_ELEMENT_TEMPERATURES[0],
  G_ELEMENT_TEMPERATURES.at(-1) ?? 2000,
]
type Fractions = [ElementSymbol, number][]

// === Per-entry inputs ===

const has_tabulated_g = (entry: PhaseData): boolean =>
  Boolean(
    entry.temperatures?.length && entry.temperatures.length === entry.free_energies?.length,
  )

const energy_per_atom = (entry: PhaseData): number => {
  const atoms = Math.max(count_atoms_in_composition(entry.composition), 1e-12)
  if (typeof entry.correction !== `number`)
    return entry.energy_per_atom ?? (entry.energy ?? 0) / atoms
  const total =
    typeof entry.energy_per_atom === `number`
      ? entry.energy_per_atom * atoms
      : (entry.energy ?? 0)
  return (total + entry.correction) / atoms
}

// Volume per atom in A^3 from volume_per_atom, structure.lattice.volume / n_sites or
// data.volume / n_atoms; null when none is available
export function get_volume_per_atom(entry: PhaseData): number | null {
  if (typeof entry.volume_per_atom === `number` && entry.volume_per_atom > 0)
    return entry.volume_per_atom
  const lattice = entry.structure?.lattice
  const sites = entry.structure?.sites
  if (
    lattice &&
    typeof lattice === `object` &&
    `volume` in lattice &&
    typeof lattice.volume === `number` &&
    Array.isArray(sites) &&
    sites.length > 0
  ) {
    return lattice.volume / sites.length
  }
  const data_volume = entry.data?.volume
  const n_atoms = count_atoms_in_composition(entry.composition)
  return typeof data_volume === `number` && data_volume > 0 && n_atoms > 0
    ? data_volume / n_atoms
    : null
}

function atomic_fractions(entry: PhaseData): Fractions {
  const pairs = Object.entries(entry.composition).filter(
    ([, amt]) => (amt ?? 0) > 0,
  ) as Fractions
  const total = pairs.reduce((sum, [, amt]) => sum + amt, 0)
  return pairs.map(([el, amt]) => [el, amt / total])
}

// === SISSO descriptor (Bartel et al. 2018, Nature Communications 9, 4168) ===

// Reduced mass (amu) per Eq. 6: sum over element pairs of (a_i + a_j) m_i m_j / (m_i + m_j),
// divided by (n_elements - 1) sum(a). Undefined for single elements.
export function sisso_reduced_mass(fractions: Fractions): number | null {
  const masses = fractions.map(([el]) => element_by_symbol.get(el)?.atomic_mass ?? NaN)
  if (fractions.length < 2 || !masses.every((mass) => mass > 0)) return null
  let mass_sum = 0
  for (const [idx_a, [, frac_a]] of fractions.entries()) {
    for (const [idx_b, [, frac_b]] of fractions.slice(idx_a + 1).entries()) {
      const mass_b = masses[idx_a + 1 + idx_b]
      mass_sum += ((frac_a + frac_b) * masses[idx_a] * mass_b) / (masses[idx_a] + mass_b)
    }
  }
  return (
    mass_sum / ((fractions.length - 1) * fractions.reduce((sum, [, frac]) => sum + frac, 0))
  )
}

// G^delta(T) in eV/atom (Eq. 4): the descriptor for G(T) - H(298 K) of a solid compound
export const sisso_g_delta = (
  volume_per_atom: number,
  reduced_mass: number,
  temperature: number,
): number =>
  (-2.48e-4 * Math.log(volume_per_atom) - 8.94e-5 * (reduced_mass / volume_per_atom)) *
    temperature +
  0.181 * Math.log(temperature) -
  0.882

// Experimental G_e(T) - H_e(298 K) of an element (eV/atom), linearly interpolated on the
// 300-2000 K grid; NaN outside it or for elements missing from the table
export function g_element_experimental(element: ElementSymbol, temperature: number): number {
  const values = G_ELEMENTS[element]
  const [t_min, t_max] = SISSO_T_RANGE
  if (!values || !(temperature >= t_min && temperature <= t_max)) return NaN
  const pos = (temperature - t_min) / (G_ELEMENT_TEMPERATURES[1] - t_min)
  const idx = Math.min(Math.floor(pos), values.length - 2)
  return values[idx] + (pos - idx) * (values[idx + 1] - values[idx])
}

// Compounds need a volume and a reduced mass; elements only their experimental G(T)
export function sisso_supports(entry: PhaseData): boolean {
  const fractions = atomic_fractions(entry)
  if (!fractions.every(([el]) => el in G_ELEMENTS)) return false
  return (
    fractions.length === 1 ||
    (get_volume_per_atom(entry) !== null && sisso_reduced_mass(fractions) !== null)
  )
}

// === Gas references ===

type GasShift = (
  element: ElementSymbol,
  temperature: number,
  source: FreeEnergySource,
) => number

// Per-atom shift of an element's chemical potential from the atmosphere. Against 0 K DFT
// references (tabulated/static entries) that is the full mu(T, p) - mu(0 K, 1 bar); the SISSO
// table already holds the pure diatomic gas at 1 bar, so only k_B T ln(p/p0) remains there and
// compound gases (CO2, CO, H2O) have no SISSO reference at all
function build_gas_shift(
  config: GasThermodynamicsConfig | undefined,
  pressures_override: Partial<Record<GasSpecies, number>> | undefined,
): GasShift | null {
  if (!config?.enabled_gases?.length) return null
  const merged: GasThermodynamicsConfig = {
    ...config,
    pressures: { ...config.pressures, ...pressures_override },
  }
  const pressures = get_effective_pressures(merged)
  const element_to_gas = { ...DEFAULT_ELEMENT_TO_GAS, ...merged.element_to_gas }
  const enabled = new Set(merged.enabled_gases)
  return (element, temperature, source) => {
    const gas = element_to_gas[element]
    if (!gas || !enabled.has(gas)) return 0
    if (source !== `sisso`)
      return compute_gas_correction(
        { composition: { [element]: 1 }, energy: 0 },
        merged,
        temperature,
        pressures,
      )
    const stoich = GAS_STOICHIOMETRY[gas]
    return Object.keys(stoich).length === 1
      ? (R_EV_PER_K * temperature * Math.log(pressures[gas])) / (stoich[element] ?? 1)
      : 0
  }
}

// === Model assembly ===

// `auto` labels elements sisso only when some compound uses the descriptor, so a purely static
// dataset reads as static even though elements always qualify
function pick_source(
  entry: PhaseData,
  mode: FreeEnergyOptions[`mode`],
  compounds_use_sisso: boolean,
): FreeEnergySource {
  const tabulated = has_tabulated_g(entry)
  if (mode === `static`) return `static`
  if (mode === `tabulated`) return tabulated ? `tabulated` : `static`
  if (mode === `sisso`) return sisso_supports(entry) ? `sisso` : `static`
  if (tabulated) return `tabulated`
  if (atomic_fractions(entry).length === 1) return compounds_use_sisso ? `sisso` : `static`
  return sisso_supports(entry) ? `sisso` : `static`
}

// Absolute G(T) per atom from an entry's own data (tabulated, NaN without a bracket) or its
// static energy
function own_g_per_atom(
  entry: PhaseData,
  tabulated: boolean,
  interpolate: boolean,
  max_gap: number,
): (temperature: number) => number {
  if (!tabulated) {
    const energy = energy_per_atom(entry)
    return () => energy
  }
  const { temperatures = [], free_energies = [] } = entry
  return (temperature) => {
    const exact = temperatures.indexOf(temperature)
    if (exact !== -1) return free_energies[exact]
    return (
      (interpolate ? interpolate_energy_at_temperature(entry, temperature, max_gap) : null) ??
      NaN
    )
  }
}

const tabulated_range = ({ temperatures = [] }: PhaseData): Vec2 => [
  Math.min(...temperatures),
  Math.max(...temperatures),
]

const intersect_ranges = (ranges: (Vec2 | null)[]): Vec2 | null => {
  const defined = ranges.filter((range) => range !== null)
  return defined.length
    ? [Math.max(...defined.map(([lo]) => lo)), Math.min(...defined.map(([, hi]) => hi))]
    : null
}

export interface FreeEnergyModel {
  phases: PhaseFreeEnergy[]
  reference_t_range: Vec2 | null // where the elemental references are defined (null = everywhere)
  unary_refs: Record<string, PhaseData>
}

// dG_f(T) evaluators for every entry. Entries need normalized composition keys (element
// symbols) and `elements` must cover every element present.
export function build_free_energy_model(
  entries: PhaseData[],
  elements: ElementSymbol[],
  options: FreeEnergyOptions = {},
): FreeEnergyModel {
  const { mode = `auto`, interpolate = true, max_interpolation_gap = 500 } = options
  const unary_refs = find_lowest_energy_unary_refs(entries)
  // Without a reference entry the element's corner sits at dG_f = 0 (synthetic element)
  for (const el of elements) unary_refs[el] ??= { composition: { [el]: 1 }, energy: 0 }
  const gas_shift = build_gas_shift(options.gas_config, options.gas_pressures)

  // Reference G_e(T) per element from its lowest-energy unary entry
  const refs = elements.map((el) => {
    const ref = unary_refs[el]
    const tabulated = mode !== `static` && has_tabulated_g(ref)
    return [
      el,
      own_g_per_atom(ref, tabulated, interpolate, max_interpolation_gap),
      tabulated ? tabulated_range(ref) : null,
    ] as const
  })
  const ref_g = Object.fromEntries(refs.map(([el, g_of]) => [el, g_of])) as Partial<
    Record<ElementSymbol, (temperature: number) => number>
  >
  const reference_t_range = intersect_ranges(refs.map(([, , range]) => range))
  const compounds_use_sisso = entries.some(
    (entry) =>
      atomic_fractions(entry).length > 1 && pick_source(entry, mode, false) === `sisso`,
  )

  const phases = entries.map((entry): PhaseFreeEnergy => {
    const source = pick_source(entry, mode, compounds_use_sisso)
    const fractions = atomic_fractions(entry)
    const unary = fractions.length === 1
    // Elements are their own (shifted) reference, so only compounds feel the gas shift
    const shift = (temperature: number): number =>
      gas_shift && !unary
        ? fractions.reduce(
            (sum, [el, frac]) => sum + frac * gas_shift(el, temperature, source),
            0,
          )
        : 0
    const weighted = (
      temperature: number,
      g_of: (el: ElementSymbol, temperature: number) => number,
    ) => fractions.reduce((sum, [el, frac]) => sum + frac * g_of(el, temperature), 0)

    if (source === `sisso`) {
      // Unary entries: the experimental reference makes the ground state dG_f = 0 and leaves
      // polymorphs at their 0 K offset
      if (unary) {
        const offset = energy_per_atom(entry) - energy_per_atom(unary_refs[fractions[0][0]])
        return { source, t_range: null, dg_form: () => offset }
      }
      const volume = get_volume_per_atom(entry) ?? NaN
      const reduced_mass = sisso_reduced_mass(fractions) ?? NaN
      const dh_form =
        entry.e_form_per_atom ??
        energy_per_atom(entry) - weighted(0, (el) => energy_per_atom(unary_refs[el]))
      return {
        source,
        t_range: SISSO_T_RANGE,
        dg_form: (temperature) =>
          dh_form +
          sisso_g_delta(volume, reduced_mass, temperature) -
          weighted(temperature, g_element_experimental) -
          shift(temperature),
      }
    }
    const tabulated = source === `tabulated`
    const own_g = own_g_per_atom(entry, tabulated, interpolate, max_interpolation_gap)
    return {
      source,
      t_range: intersect_ranges([
        tabulated ? tabulated_range(entry) : null,
        reference_t_range,
      ]),
      dg_form: (temperature) =>
        own_g(temperature) -
        weighted(temperature, (el, temp) => ref_g[el]?.(temp) ?? 0) -
        shift(temperature),
    }
  })
  return { phases, reference_t_range, unary_refs }
}

// Default temperature span: where the references are defined, else the union of the phases'
// own ranges, else 300-1500 K for purely static energies
export function default_t_range(model: FreeEnergyModel): Vec2 {
  if (model.reference_t_range) return model.reference_t_range
  const ranges = model.phases.map((phase) => phase.t_range).filter((range) => range !== null)
  return ranges.length
    ? [Math.min(...ranges.map(([lo]) => lo)), Math.max(...ranges.map(([, hi]) => hi))]
    : [300, 1500]
}
