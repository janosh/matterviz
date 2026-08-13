import type { ELEMENT_CATEGORIES } from '$lib/labels'

// oxfmt-ignore
export const ELEM_SYMBOLS = [`H`,`He`,`Li`,`Be`,`B`,`C`,`N`,`O`,`F`,`Ne`,`Na`,`Mg`,`Al`,`Si`,`P`,`S`,`Cl`,`Ar`,`K`,`Ca`,`Sc`,`Ti`,`V`,`Cr`,`Mn`,`Fe`,`Co`,`Ni`,`Cu`,`Zn`,`Ga`,`Ge`,`As`,`Se`,`Br`,`Kr`,`Rb`,`Sr`,`Y`,`Zr`,`Nb`,`Mo`,`Tc`,`Ru`,`Rh`,`Pd`,`Ag`,`Cd`,`In`,`Sn`,`Sb`,`Te`,`I`,`Xe`,`Cs`,`Ba`,`La`,`Ce`,`Pr`,`Nd`,`Pm`,`Sm`,`Eu`,`Gd`,`Tb`,`Dy`,`Ho`,`Er`,`Tm`,`Yb`,`Lu`,`Hf`,`Ta`,`W`,`Re`,`Os`,`Ir`,`Pt`,`Au`,`Hg`,`Tl`,`Pb`,`Bi`,`Po`,`At`,`Rn`,`Fr`,`Ra`,`Ac`,`Th`,`Pa`,`U`,`Np`,`Pu`,`Am`,`Cm`,`Bk`,`Cf`,`Es`,`Fm`,`Md`,`No`,`Lr`,`Rf`,`Db`,`Sg`,`Bh`,`Hs`,`Mt`,`Ds`,`Rg`,`Cn`,`Nh`,`Fl`,`Mc`,`Lv`,`Ts`,`Og`] as const

export type ElementCategory = (typeof ELEMENT_CATEGORIES)[number]
export type ElementSymbol = (typeof ELEM_SYMBOLS)[number]

// Shannon radii structure: oxidation_state -> coordination -> spin -> radii
export type ShannonRadiusPair = {
  crystal_radius: number
  ionic_radius: number
}
export type ShannonRadii = Record<string, Record<string, Record<string, ShannonRadiusPair>>>

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
  mendeleev_number?: number // Pettifor's chemical scale for crystal-structure maps
  oxidation_states?: number[]
  common_oxidation_states?: number[]
  icsd_oxidation_states?: number[]
  ionic_radii?: Record<string, number> // oxidation_state (as string) -> radius in Angstrom
  shannon_radii?: ShannonRadii
}

// How a multi-segment ElementTile is carved up. Which layouts exist depends on the
// segment count, so SPLIT_LAYOUTS_BY_COUNT in ElementTile.svelte is the source of truth
// for valid pairings and rejects the rest.
export type SplitLayout = `diagonal` | `horizontal` | `vertical` | `triangular` | `quadrant`

// One slice of an ElementTile's fill. Color and value live in the same object so they
// cannot get out of step, which the old parallel `bg_colors` / `value` arrays allowed.
export interface TileSegment {
  // Fill for this slice. Falls back to the element's category color.
  color?: string
  // Label drawn inside this slice. Omit it to paint the slice without a number.
  value?: number | string
}

// Paint for one kind of nucleon in a Nucleus diagram.
export interface NucleonPaint {
  fill?: string
  // Sector label text color. Defaults to whichever of black/white contrasts with `fill`.
  text?: string
  // Suffix after the count, e.g. ` P`.
  label?: string
}

// Paint for the element symbol drawn across the middle of a Nucleus.
export interface SymbolPaint {
  // Defaults to whichever of black/white contrasts with the neutron fill.
  text?: string
  // Halo keeping the symbol legible where it crosses the proton/neutron boundary.
  // Defaults to a contrasting outline; pass `none` to draw the symbol unoutlined.
  outline?: string
  outline_width?: string
}
