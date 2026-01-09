import type { CompositionType } from '$lib/composition'
import { ATOMIC_WEIGHTS } from '$lib/composition/parse'
import type { ElementSymbol } from '$lib/element'
import { element_data } from '$lib/element'
import type { Vec3 } from '$lib/math'
import * as math from '$lib/math'
import type { Lattice, StructureScene } from '$lib/structure'
import type { ComponentProps } from 'svelte'
import type { Pbc } from './pbc'

export { default as Arrow } from './Arrow.svelte'
export * from './atom-properties'
export { default as AtomLegend } from './AtomLegend.svelte'
export { default as Bond } from './Bond.svelte'
export * as bonding_strategies from './bonding'
export { default as CanvasTooltip } from './CanvasTooltip.svelte'
export { default as Cylinder } from './Cylinder.svelte'
export { default as Lattice } from './Lattice.svelte'
export * from './pbc'
export { default as Structure } from './Structure.svelte'
export { default as StructureControls } from './StructureControls.svelte'
export { default as StructureExportPane } from './StructureExportPane.svelte'
export { default as StructureInfoPane } from './StructureInfoPane.svelte'
export { default as StructureScene } from './StructureScene.svelte'
export * from './supercell'

export type Species = {
  element: ElementSymbol
  occu: number
  oxidation_state: number
}
export type Site = {
  species: Species[]
  abc: Vec3
  xyz: Vec3
  label: string
  properties: Record<string, unknown>
}

export const LATTICE_PARAM_KEYS = [`a`, `b`, `c`, `alpha`, `beta`, `gamma`] as const
export type LatticeParams = { [key in (typeof LATTICE_PARAM_KEYS)[number]]: number }

export type LatticeType =
  & { matrix: math.Matrix3x3; pbc: Pbc; volume: number }
  & LatticeParams

export type Molecule = {
  sites: Site[]
  charge?: number
  id?: string
  properties?: Record<string, unknown>
}
export type Crystal = Molecule & { lattice: LatticeType }
export type AnyStructure = Crystal | Molecule

// Bond pair with position vectors, site indices, bond length, strength score, and transformation matrix
export type BondPair = {
  pos_1: Vec3
  pos_2: Vec3
  site_idx_1: number
  site_idx_2: number
  bond_length: number
  strength: number
  transform_matrix: Float32Array
}

export function get_element_counts(structure: AnyStructure) {
  const elements: CompositionType = {}
  for (const site of structure.sites) {
    for (const species of site.species) {
      const { element: elem, occu } = species
      elements[elem] = (elements[elem] ?? 0) + occu
    }
  }
  return elements
}

export function format_chemical_formula(
  structure: AnyStructure,
  sort_fn: (symbols: ElementSymbol[]) => ElementSymbol[],
): string {
  // concatenate elements in a structure followed by their amount
  const elements = get_element_counts(structure)
  const formula = []
  for (const element of sort_fn(Object.keys(elements) as ElementSymbol[])) {
    const amount = elements[element] ?? 0
    if (amount === 1) formula.push(element)
    else formula.push(`${element}<sub>${amount}</sub>`)
  }
  return formula.join(` `)
}

export function format_formula_by_electronegativity(structure: AnyStructure): string {
  // concatenate elements in a structure followed by their amount sorted by electronegativity
  return format_chemical_formula(structure, (symbols) => (symbols.sort((el1, el2) => {
    const elec_neg1 = element_data.find((el) => el.symbol === el1)?.electronegativity ??
      0
    const elec_neg2 = element_data.find((el) => el.symbol === el2)?.electronegativity ??
      0
    // Sort by electronegativity (ascending), then alphabetically for ties
    if (elec_neg1 !== elec_neg2) return elec_neg1 - elec_neg2
    return el1.localeCompare(el2)
  })))
}

// Atomic radii in Angstroms (used for relative sizing, not absolute rendering scale)
export const atomic_radii: CompositionType = Object.fromEntries(
  element_data.map((el) => [el.symbol, el.atomic_radius ?? 1]),
)

// unified atomic mass units (u) per cubic angstrom (Å^3)
// to grams per cubic centimeter (g/cm^3)
const AMU_PER_A3_TO_G_PER_CM3 = 1.66053907

export function get_density(structure: Crystal): number {
  // calculate the density of a Crystal in g/cm³
  const elements = get_element_counts(structure)
  let mass = 0
  for (const [element, amount] of Object.entries(elements)) {
    const weight = ATOMIC_WEIGHTS.get(element as ElementSymbol)
    if (weight !== undefined) mass += amount * weight
  }
  return (AMU_PER_A3_TO_G_PER_CM3 * mass) / structure.lattice.volume
}

export function get_center_of_mass(structure: AnyStructure): Vec3 {
  let center: Vec3 = [0, 0, 0]
  let total_weight = 0

  for (const site of structure.sites) {
    // Handle disordered sites by summing contributions from all species
    for (const species of site.species) {
      const atomic_weight = ATOMIC_WEIGHTS.get(species.element) ?? 1
      const weight = atomic_weight * species.occu

      const scaled_pos = math.scale(site.xyz, weight)
      center = math.add(center, scaled_pos)

      total_weight += weight
    }
  }

  return math.scale(center, 1 / total_weight)
}

export interface StructureHandlerData {
  structure?: AnyStructure
  filename?: string
  file_size?: number
  total_atoms?: number
  error_msg?: string
  fullscreen?: boolean
  camera_position?: Vec3
  camera_has_moved?: boolean
  color_scheme?: string
  performance_mode?: `quality` | `speed`
  scene_props?: ComponentProps<typeof StructureScene>
  lattice_props?: ComponentProps<typeof Lattice>
}

export interface BondInstance {
  matrix: Float32Array
  color_start: string
  color_end: string
}

export interface BondGroupWithGradients {
  thickness: number
  instances: BondInstance[]
  ambient_light?: number
  directional_light?: number
}
