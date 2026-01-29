import type { ELEM_SYMBOLS, ELEMENT_CATEGORIES } from '$lib/labels'

export type ElementCategory = (typeof ELEMENT_CATEGORIES)[number]
export type ElementSymbol = (typeof ELEM_SYMBOLS)[number]

// Shannon radii structure: oxidation_state -> coordination -> spin -> radii
export type ShannonRadiusPair = {
  crystal_radius: number
  ionic_radius: number
}
export type ShannonRadii = Record<
  string,
  Record<string, Record<string, ShannonRadiusPair>>
>

export type ChemicalElement = {
  'cpk-hex': string | null
  appearance: string | null
  atomic_mass: number // in atomic units (u)
  atomic_radius: number | null // in Angstrom (A)
  boiling_point: number | null // in kelvin (K)
  category: ElementCategory
  column: number // aka group, in range 1 - 18
  covalent_radius: number | null // in Angstrom (A)
  density: number
  discoverer: string
  electron_affinity: number | null
  electron_configuration_semantic: string
  electron_configuration: string
  electronegativity_pauling: number | null
  electronegativity: number | null
  first_ionization: number | null // in electron volts (eV)
  ionization_energies: number[]
  melting_point: number | null
  metal: boolean | null
  metalloid: boolean | null
  molar_heat: number | null
  electrons: number
  neutrons: number
  protons: number
  n_shells: number
  n_valence: number | null
  name: string
  natural: boolean | null
  nonmetal: boolean | null
  number_of_isotopes: number | null
  number: number
  period: number
  phase: `Gas` | `Liquid` | `Solid`
  radioactive: boolean | null
  row: number // != period for lanthanides and actinides
  shells: number[]
  specific_heat: number | null
  spectral_img: string | null
  summary: string
  symbol: ElementSymbol
  year: number | string
  // Properties from pymatgen
  oxidation_states?: number[]
  common_oxidation_states?: number[]
  icsd_oxidation_states?: number[]
  ionic_radii?: Record<string, number> // oxidation_state (as string) -> radius in Angstrom
  shannon_radii?: ShannonRadii
}
