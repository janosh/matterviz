// Utilities for dealing with pymatgen Structures
import type { ElementSymbol } from '.'
import element_data from './element-data'
import { pretty_num } from './labels'

export type Species = {
  element: ElementSymbol
  occu: number
  oxidation_state: number
}

export type Vector = [number, number, number]

export type Site = {
  species: Species[]
  abc: Vector
  xyz: Vector
  label: string
  properties: Record<string, unknown>
}

export type Lattice = {
  matrix: [Vector, Vector, Vector]
  pbc: boolean[]
  a: number
  b: number
  c: number
  alpha: number
  beta: number
  gamma: number
  volume: number
}

export type PymatgenStructure = {
  lattice: Lattice
  sites: Site[]
  charge: number
  id?: string
}

export function get_elem_amounts(structure: PymatgenStructure) {
  const elements: Partial<Record<ElementSymbol, number>> = {}
  for (const site of structure.sites) {
    for (const species of site.species) {
      const { element: elem, occu } = species
      if (elem in elements) {
        elements[elem] += occu
      } else {
        elements[elem] = occu
      }
    }
  }
  return elements
}

export function alphabetical_formula(structure: PymatgenStructure) {
  // concatenate elements in a pymatgen Structure followed by their amount in alphabetical order
  const elements = get_elem_amounts(structure)
  const formula = []
  for (const el of Object.keys(elements).sort()) {
    const amount = elements[el]
    formula.push(`${el}${amount}`)
  }
  return formula.join(` `)
}

export const atomic_radii: Record<ElementSymbol, number> = Object.fromEntries(
  element_data.map((el) => [el.symbol, el.atomic_radius / 2])
)

export const atomic_weights = Object.fromEntries(
  element_data.map((el) => [el.symbol, el.atomic_mass])
)

export function get_elements(structure: PymatgenStructure): ElementSymbol[] {
  const elems = structure.sites.flatMap((site) =>
    site.species.map((sp) => sp.element)
  )
  return [...new Set(elems)].sort() // unique elements
}

// unified atomic mass units (u) per cubic angstrom (Å^3)
// to grams per cubic centimeter (g/cm^3)
const uA3_to_gcm3 = 1.66053907

export function density(structure: PymatgenStructure, prec = `.2f`) {
  // calculate the density of a pymatgen Structure in
  const elements = get_elem_amounts(structure)
  let mass = 0
  for (const [el, amt] of Object.entries(elements)) {
    mass += amt * atomic_weights[el]
  }
  const dens = (uA3_to_gcm3 * mass) / structure.lattice.volume
  return pretty_num(dens, prec)
}

export function euclidean_dist(p1: Vector, p2: Vector): number {
  const dx = p1[0] - p2[0]
  const dy = p1[1] - p2[1]
  const dz = p1[2] - p2[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}
