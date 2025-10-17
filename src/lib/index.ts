import type { elem_symbols, element_categories } from './labels'

export * from './bands'
export * from './brillouin'
export * from './colors'
export * from './composition'
export { default as ContextMenu } from './ContextMenu.svelte'
export * from './coordination'
export { default as DraggablePane } from './DraggablePane.svelte'
export * from './element'
export { default as FilePicker } from './FilePicker.svelte'
export { default as Icon } from './Icon.svelte'
export { icon_data, type IconName } from './icons'
export { default as InfoCard } from './InfoCard.svelte'
export * from './io'
export * from './labels'
export * from './math'
export { default as Nav } from './Nav.svelte'
export * from './periodic-table'
export * from './phase-diagram'
export * from './plot'
export * from './rdf'
export * from './settings'
export { default as SettingsSection } from './SettingsSection.svelte'
export { default as Spinner } from './Spinner.svelte'
export * from './structure'
export * from './theme'
export { default as Trajectory } from './trajectory/Trajectory.svelte'
export * from './utils'
export * from './xrd'

export type ElementCategory = (typeof element_categories)[number]
export type ElementSymbol = (typeof elem_symbols)[number]

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
}

export interface FileInfo {
  name: string
  url: string
  type?: string
  category?: string
  category_icon?: string
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

export async function toggle_fullscreen(wrapper?: HTMLDivElement): Promise<void> {
  if (!wrapper) return
  try {
    if (!document.fullscreenElement) {
      await wrapper.requestFullscreen()
    } else if (document.fullscreenElement === wrapper) {
      await document.exitFullscreen()
    } else {
      await document.exitFullscreen()
      await wrapper.requestFullscreen()
    }
  } catch (error) {
    console.error(`Fullscreen operation failed:`, error)
  }
}

export type InfoItem = Readonly<{
  label: string
  value: string | number
  key?: string
  tooltip?: string
}>
