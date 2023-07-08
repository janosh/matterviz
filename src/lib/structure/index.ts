// Utilities for dealing with pymatgen Structures
import type { ElementSymbol } from '$lib'
import { pretty_num } from '$lib'
import element_data from '$lib/element/data'

export { default as Bond } from './Bond.svelte'
export { default as Lattice } from './Lattice.svelte'
export { default as Structure } from './Structure.svelte'
export { default as StructureCard } from './StructureCard.svelte'
export { default as StructureLegend } from './StructureLegend.svelte'
export { default as StructureScene } from './StructureScene.svelte'

export type Species = {
  element: ElementSymbol
  occu: number
  oxidation_state: number
}

export type Vector = [number, number, number]
export type NdVector = number[]

export type Site = {
  species: Species[]
  abc: Vector
  xyz: Vector
  label: string
  properties: Record<string, unknown>
}

export type PymatgenLattice = {
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
  lattice: PymatgenLattice
  sites: Site[]
  charge: number
  id?: string
}

export type IdStructure = PymatgenStructure & { id: string }

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
  element_data.map((el) => [el.symbol, el.atomic_radius / 2]),
)

export const atomic_weights = Object.fromEntries(
  element_data.map((el) => [el.symbol, el.atomic_mass]),
)

export function get_elements(structure: PymatgenStructure): ElementSymbol[] {
  const elems = structure.sites.flatMap((site) =>
    site.species.map((sp) => sp.element),
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

function generate_permutations(length: number): number[][] {
  const result: number[][] = []
  for (let i = 0; i < Math.pow(2, length); i++) {
    const binaryString = i.toString(2).padStart(length, `0`)
    result.push(Array.from(binaryString).map(Number))
  }
  return result
}

export function find_image_atoms(
  structure: PymatgenStructure,
  { tolerance = 0.05 }: { tolerance?: number } = {},
  // fractional tolerance for determining if a site is at the edge of the unit cell
): Array<[number, Vector]> {
  const edge_sites: Array<[number, Vector]> = []
  const permutations = generate_permutations(3)

  structure.sites.forEach((site, idx) => {
    const abc = site.abc
    const xyz = site.xyz

    edge_sites.push([idx, xyz])

    // Check if the site is at the edge and determine its image
    const edges: number[] = [0, 1, 2].filter(
      (i) => Math.abs(abc[i]) < tolerance || Math.abs(abc[i] - 1) < tolerance,
    )

    const { a, b, c } = structure.lattice
    if (edges.length > 0) {
      for (const perm of permutations) {
        const img_xyz: Vector = xyz.slice()
        for (const [idx, edge] of edges.entries()) {
          if (perm[idx] === 1) {
            // Image atom at the opposite edge
            if (Math.abs(abc[edge]) < tolerance) {
              img_xyz[edge] += edge === 0 ? a : edge === 1 ? b : c
            } else {
              img_xyz[edge] -= edge === 0 ? a : edge === 1 ? b : c
            }
          }
        }
        edge_sites.push([idx, img_xyz])
      }
    }
  })

  return edge_sites
}

export function symmetrize_structure(
  ...args: Parameters<typeof find_image_atoms>
): PymatgenStructure {
  const edge_sites = find_image_atoms(...args)
  const structure = args[0]

  const symmetrized_structure: PymatgenStructure = { ...structure }
  symmetrized_structure.sites = [...structure.sites]

  // add all the image atoms as new sites
  for (const [site_idx, img_xyz] of edge_sites) {
    const new_site = structure.sites[site_idx]
    // copy original site
    symmetrized_structure.sites.push({ ...new_site, xyz: img_xyz })
  }

  return symmetrized_structure
}

export function add(...vecs: NdVector[]): NdVector {
  // add up any number of same-length vectors
  const result = vecs[0].slice()
  for (const vec of vecs.slice(1)) {
    for (const [idx, val] of vec.entries()) {
      result[idx] += val
    }
  }
  return result
}
