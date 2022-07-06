export type ChemicalElement = {
  appearance: string
  atomic_mass: number
  atomic_radius: number
  boiling_point: number | null
  category: string
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
  n_electrons: number
  n_neutrons: number
  n_protons: number
  n_shells: number
  n_valence: number
  name: string
  natural: boolean | null
  nonmetal: boolean | null
  number_of_isotopes: number
  number: number
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
