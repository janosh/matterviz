import type { ElementSymbol, Lattice, StructureScene, Vec3 } from '$lib'
import { atomic_weights } from '$lib/composition/parse'
import { element_data } from '$lib/element'
import type { Matrix3x3 } from '$lib/math'
import * as math from '$lib/math'
import type { ComponentProps } from 'svelte'
import type { Pbc } from './pbc'

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
export { default as StructureLegend } from './StructureLegend.svelte'
export { default as StructureScene } from './StructureScene.svelte'
export * from './supercell'
export { default as Vector } from './Vector.svelte'

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

export const lattice_param_keys = [
  `a`,
  `b`,
  `c`,
  `alpha`,
  `beta`,
  `gamma`,
] as const

export type LatticeParams = { [key in (typeof lattice_param_keys)[number]]: number }

export type PymatgenLattice = {
  matrix: Matrix3x3
  pbc: Pbc
  volume: number
} & LatticeParams

export type PymatgenMolecule = { sites: Site[]; charge?: number; id?: string }
export type PymatgenStructure = PymatgenMolecule & { lattice: PymatgenLattice }

export type Edge = { to_jimage: Vec3; id: number; key: number }

export type Graph = {
  directed: boolean
  multigraph: boolean
  graph: [
    [`edge_weight_name`, null] | [`edge_weight_units`, null] | [`name`, string],
  ]
  nodes: { id: number }[]
  adjacency: Edge[][]
}

export type StructureGraph = {
  '@module': string
  '@class': string
  structure: PymatgenStructure
  graphs: Graph[]
}

// Bond pair with position vectors, site indices, bond length, strength score, and transformation matrix
export type BondPair = {
  pos_1: Vec3
  pos_2: Vec3
  site_idx_1: number
  site_idx_2: number
  bond_length: number
  strength: number
  transform_matrix: number[] // 4x4 transformation matrix for instanced rendering
}

export type IdStructure = PymatgenStructure & { id: string }
export type StructureWithGraph = IdStructure & { graph: Graph }

export type AnyStructure = PymatgenStructure | PymatgenMolecule
export type AnyStructureGraph = AnyStructure & { graph: Graph }

export function get_elem_amounts(structure: AnyStructure) {
  const elements: Partial<Record<ElementSymbol, number>> = {}
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
  // concatenate elements in a pymatgen Structure followed by their amount
  const elements = get_elem_amounts(structure)
  const formula = []
  for (const el of sort_fn(Object.keys(elements) as ElementSymbol[])) {
    const amount = elements[el] ?? 0
    if (amount === 1) formula.push(el)
    else formula.push(`${el}<sub>${amount}</sub>`)
  }
  return formula.join(` `)
}

export function alphabetical_formula(structure: AnyStructure): string {
  // concatenate elements in a pymatgen Structure followed by their amount in alphabetical order
  return format_chemical_formula(structure, (symbols) => symbols.sort())
}

export function electro_neg_formula(structure: AnyStructure): string {
  // concatenate elements in a pymatgen Structure followed by their amount sorted by electronegativity
  return format_chemical_formula(structure, (symbols) => {
    return symbols.sort((el1, el2) => {
      const elec_neg1 = element_data.find((el) => el.symbol === el1)?.electronegativity ??
        0
      const elec_neg2 = element_data.find((el) => el.symbol === el2)?.electronegativity ??
        0

      // Sort by electronegativity (ascending), then alphabetically for ties
      if (elec_neg1 !== elec_neg2) return elec_neg1 - elec_neg2
      return el1.localeCompare(el2)
    })
  })
}

export const atomic_radii: Partial<Record<ElementSymbol, number>> = Object.fromEntries(
  element_data.map((el) => [el.symbol, (el.atomic_radius ?? 1) / 2]),
)

export function get_elements(structure: AnyStructure): ElementSymbol[] {
  const elems = structure.sites.flatMap((site) => site.species.map((sp) => sp.element))
  return [...new Set(elems)].sort() // unique elements
}

// unified atomic mass units (u) per cubic angstrom (Å^3)
// to grams per cubic centimeter (g/cm^3)
const uA3_to_gcm3 = 1.66053907

export function get_density(structure: PymatgenStructure): number {
  // calculate the density of a pymatgen Structure in g/cm³
  const elements = get_elem_amounts(structure)
  let mass = 0
  for (const [el, amt] of Object.entries(elements)) {
    const weight = atomic_weights.get(el as ElementSymbol)
    if (weight !== undefined) mass += amt * weight
  }
  return (uA3_to_gcm3 * mass) / structure.lattice.volume
}

export function get_center_of_mass(struct_or_mol: AnyStructure): Vec3 {
  let center: Vec3 = [0, 0, 0]
  let total_weight = 0

  for (const site of struct_or_mol.sites) {
    // TODO this assumes there's just one species. doesn't handle disordered sites
    const wt = site.species[0].occu

    const scaled_pos = math.scale(site.xyz, wt)
    center = math.add(center, scaled_pos)

    total_weight += wt
  }

  return math.scale(center, 1 / total_weight)
}

export interface StructureHandlerData {
  structure?: AnyStructure
  filename?: string
  file_size?: number
  total_atoms?: number
  error_msg?: string
  is_fullscreen?: boolean
  camera_position?: Vec3
  camera_has_moved?: boolean
  color_scheme?: string
  performance_mode?: `quality` | `speed`
  scene_props?: ComponentProps<typeof StructureScene>
  lattice_props?: ComponentProps<typeof Lattice>
}
