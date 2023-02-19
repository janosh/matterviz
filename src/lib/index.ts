export { default as BohrAtom } from './BohrAtom.svelte'
export { default as ColorBar } from './ColorBar.svelte'
export { default as ColorCustomizer } from './ColorCustomizer.svelte'
export { default as ColorScaleSelect } from './ColorScaleSelect.svelte'
export { default as element_data } from './element-data'
export { default as ElementHeading } from './ElementHeading.svelte'
export { default as ElementPhoto } from './ElementPhoto.svelte'
export { default as ElementScatter } from './ElementScatter.svelte'
export { default as ElementStats } from './ElementStats.svelte'
export { default as ElementTile } from './ElementTile.svelte'
export { default as Icon } from './Icon.svelte'
export { default as Line } from './Line.svelte'
export { default as Nucleus } from './Nucleus.svelte'
export { default, default as PeriodicTable } from './PeriodicTable.svelte'
export { default as PropertySelect } from './PropertySelect.svelte'
export { default as ScatterPlot } from './ScatterPlot.svelte'
export { default as ScatterPoint } from './ScatterPoint.svelte'
export { default as TableInset } from './TableInset.svelte'

export const categories = [
  `actinide`,
  `alkali metal`,
  `alkaline earth metal`,
  `diatomic nonmetal`,
  `lanthanide`,
  `metalloid`,
  `noble gas`,
  `polyatomic nonmetal`,
  `post-transition metal`,
  `transition metal`,
] as const

export type Category = (typeof categories)[number]

// prettier-ignore
export const elem_symbols = [`H`,`He`,`Li`,`Be`,`B`,`C`,`N`,`O`,`F`,`Ne`,`Na`,`Mg`,`Al`,`Si`,`P`,`S`,`Cl`,`Ar`,`K`,`Ca`,`Sc`,`Ti`,`V`,`Cr`,`Mn`,`Fe`,`Co`,`Ni`,`Cu`,`Zn`,`Ga`,`Ge`,`As`,`Se`,`Br`,`Kr`,`Rb`,`Sr`,`Y`,`Zr`,`Nb`,`Mo`,`Tc`,`Ru`,`Rh`,`Pd`,`Ag`,`Cd`,`In`,`Sn`,`Sb`,`Te`,`I`,`Xe`,`Cs`,`Ba`,`La`,`Ce`,`Pr`,`Nd`,`Pm`,`Sm`,`Eu`,`Gd`,`Tb`,`Dy`,`Ho`,`Er`,`Tm`,`Yb`,`Lu`,`Hf`,`Ta`,`W`,`Re`,`Os`,`Ir`,`Pt`,`Au`,`Hg`,`Tl`,`Pb`,`Bi`,`Po`,`At`,`Rn`,`Fr`,`Ra`,`Ac`,`Th`,`Pa`,`U`,`Np`,`Pu`,`Am`,`Cm`,`Bk`,`Cf`,`Es`,`Fm`,`Md`,`No`,`Lr`,`Rf`,`Db`,`Sg`,`Bh`,`Hs`,`Mt`,`Ds`,`Rg`,`Cn`,`Nh`,`Fl`,`Mc`,`Lv`,`Ts`,`Og`] as const

export type ElementSymbol = (typeof elem_symbols)[number]

export type ChemicalElement = {
  'cpk-hex': string | null
  appearance: string
  atomic_mass: number
  atomic_radius: number
  boiling_point: number | null
  category: Category
  column: number // aka group, in range 1 - 18
  covalent_radius: number
  density: number
  discoverer: string
  electron_affinity: number
  electron_configuration_semantic: string
  electron_configuration: string
  electronegativity_pauling: number | null
  electronegativity: number | null
  first_ionization: number
  ionization_energies: number[]
  jmol_color: string
  melting_point: number | null
  metal: boolean | null
  metalloid: boolean | null
  molar_heat: number | null
  electrons: number
  neutrons: number
  protons: number
  n_shells: number
  n_valence: number
  name: string
  natural: boolean | null
  nonmetal: boolean | null
  number_of_isotopes: number
  number: number
  period: number
  phase: 'Gas' | 'Liquid' | 'Solid'
  radioactive: boolean | null
  row: number // != period for lanthanides and actinides
  shells: number[]
  specific_heat: number
  spectral_img: string
  summary: string
  symbol: string
  year: number | string
}

export type Coords = { x: number; y: number }

export type DispatchPayload = CustomEvent<{
  element: ChemicalElement
  active: boolean // whether the event target tile is currently active
  dom_event: Event // the DOM event that triggered the Svelte dispatch
}>

export type PeriodicTableEvents = {
  click: DispatchPayload
  mouseenter: DispatchPayload
  mouseleave: DispatchPayload
  keyup: DispatchPayload
  keydown: DispatchPayload
}
