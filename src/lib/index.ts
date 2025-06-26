import type { categories, elem_symbols } from './labels'

export { default as BohrAtom } from './BohrAtom.svelte'
export * from './composition'
export { default as ControlPanel } from './ControlPanel.svelte'
export * from './element'
export { default as element_data } from './element/data'
export { default as Icon } from './Icon.svelte'
export { default as InfoCard } from './InfoCard.svelte'
export * from './labels'
export * from './material'
export * from './math'
export { default as Nucleus } from './Nucleus.svelte'
export * from './periodic-table'
export * from './plot'
export { default as Spinner } from './Spinner.svelte'
export * from './structure'
export { default as Structure } from './structure/Structure.svelte'
export { default as Trajectory } from './trajectory/Trajectory.svelte'

export type Category = (typeof categories)[number]

export type ElementSymbol = (typeof elem_symbols)[number]

export type CompositionType = Partial<Record<ElementSymbol, number>>

export type ChemicalElement = {
  'cpk-hex': string | null
  appearance: string | null
  atomic_mass: number // in atomic units (u)
  atomic_radius: number | null // in Angstrom (A)
  boiling_point: number | null // in kelvin (K)
  category: Category
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
}

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
  focus: DispatchPayload
  blur: DispatchPayload
}

export const crystal_systems = [
  `triclinic`,
  `monoclinic`,
  `orthorhombic`,
  `tetragonal`,
  `trigonal`,
  `hexagonal`,
  `cubic`,
] as const
export type CrystalSystem = (typeof crystal_systems)[number]

// Helper function to escape HTML special characters to prevent XSS
export function escape_html(unsafe_string: string): string {
  return unsafe_string
    .replaceAll(`&`, `&amp;`)
    .replaceAll(`<`, `&lt;`)
    .replaceAll(`>`, `&gt;`)
    .replaceAll(`"`, `&quot;`)
    .replaceAll(`'`, `&#39;`)
}

// Simplified binary detection
export function is_binary(content: string): boolean {
  return (
    content.includes(`\0`) ||
    // deno-lint-ignore no-control-regex
    (content.match(/[\u0000-\u0008\u000E-\u001F\u007F-\u00FF]/g) || []).length /
          content.length > 0.1 ||
    (content.match(/[\u0020-\u007E]/g) || []).length / content.length < 0.7
  )
}
