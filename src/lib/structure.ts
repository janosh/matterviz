// Utilities for dealing with pymatgen Structures
import type { ColorRepresentation } from 'three'
import type { ElementSymbol } from '.'
import element_data from './element-data'
import { pretty_num } from './labels'

export type Species = {
  element: ElementSymbol
  occu: number
}

export type Site = {
  species: Species[]
  abc: number[]
  xyz: number[]
  label: string
  properties: Record<string, unknown>
}

export type Lattice = {
  matrix: number[][]
  pbc: boolean[]
  a: number
  b: number
  c: number
  alpha: number
  beta: number
  gamma: number
  volume: number
}

export type Structure = {
  charge: number
  lattice: Lattice
  sites: Site[]
}

export function get_elem_amount(structure: Structure) {
  const elements: Record<ElementSymbol, number> = {}
  for (const site of structure.sites) {
    for (const species of site.species) {
      const { element: el, occu } = species
      if (el in elements) {
        elements[el] += occu
      } else {
        elements[el] = occu
      }
    }
  }
  return elements
}

export function alphabetical_formula(structure: Structure) {
  // concatenate elements in a pymatgen Structure followed by their amount in alphabetical order
  const elements = get_elem_amount(structure)
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
export const atomic_colors: Record<ElementSymbol, ColorRepresentation> =
  Object.fromEntries(element_data.map((el) => [el.symbol, el.jmol_color]))

export const atomic_weights = Object.fromEntries(
  element_data.map((el) => [el.symbol, el.atomic_mass])
)

export function density_to_SI(density: number) {
  // convert atomic units per cubic angstrom to g/cm^3
  return 1.5 * density
}

// unified atomic mass units (u) per cubic angstrom (Å^3)
// to grams per cubic centimeter (g/cm^3)
const uA3_to_gcm3 = 1.66053907

export function density(structure: Structure, prec = `.2f`) {
  // calculate the density of a pymatgen Structure in
  const elements = get_elem_amount(structure)
  let mass = 0
  for (const [el, amt] of Object.entries(elements)) {
    mass += amt * atomic_weights[el]
  }
  const dens = (uA3_to_gcm3 * mass) / structure.lattice.volume
  return pretty_num(dens, prec)
}
