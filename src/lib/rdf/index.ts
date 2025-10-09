import type { Matrix3x3, Vec3 } from '$lib/math'
import { calc_lattice_params, euclidean_dist, pbc_dist } from '$lib/math'
import type { PymatgenStructure as Structure } from '$lib/structure'
import { make_supercell } from '$lib/structure/supercell'

export type { PymatgenStructure } from '$lib/structure'
export { default as RdfPlot } from './RdfPlot.svelte'

export type RdfPattern = {
  r: number[]
  g_r: number[]
  element_pair?: [string, string]
}

export interface RdfEntry {
  label: string
  pattern: RdfPattern
  color?: string
}

// Calculate radial distribution function
export function calculate_rdf(
  structure: Structure,
  {
    center_species,
    neighbor_species,
    cutoff = 15,
    n_bins = 75,
    pbc = [1, 1, 1] as [0 | 1, 0 | 1, 0 | 1],
    auto_expand = true,
  }: {
    center_species?: string
    neighbor_species?: string
    cutoff?: number
    n_bins?: number
    pbc?: [0 | 1, 0 | 1, 0 | 1]
    auto_expand?: boolean
  } = {},
): RdfPattern {
  if (cutoff <= 0 || n_bins <= 0) {
    throw new Error(`cutoff and n_bins must be positive`)
  }

  // Validate structure has lattice
  if (!structure.lattice?.matrix) {
    throw new Error(`Structure must have a lattice for RDF calculation`)
  }

  let lattice: Matrix3x3 = structure.lattice.matrix
  let { sites } = structure

  // Expand structure if needed to ensure shortest lattice vector is 1.5× the cutoff
  // This prevents artificial close contacts at cell boundaries when using PBC
  if (auto_expand) {
    const { a, b, c } = calc_lattice_params(lattice)
    const EXPANSION_SAFETY_FACTOR = 1.5
    const min_size = cutoff * EXPANSION_SAFETY_FACTOR
    const [n_a, n_b, n_c] = [a, b, c].map((len) => Math.ceil(min_size / len))

    if (n_a > 1 || n_b > 1 || n_c > 1) {
      const expanded_structure = make_supercell(
        structure,
        [n_a, n_b, n_c] as Vec3,
        false, // Don't fold back to unit cell
      )
      sites = expanded_structure.sites
      lattice = expanded_structure.lattice.matrix
      pbc = [0, 0, 0] // Disable PBC since we explicitly expanded the structure
    }
  }

  const bin_size = cutoff / n_bins
  const r = Array.from({ length: n_bins }, (_, idx) => (idx + 1) * bin_size)
  const g_r = new Array(n_bins).fill(0)

  if (sites.length === 0) return { r, g_r }

  const elements = sites.map((s) => s.species[0].element)
  const centers = center_species
    ? sites.filter((_, idx) => elements[idx] === center_species)
    : sites
  const neighbors = neighbor_species
    ? sites.filter((_, idx) => elements[idx] === neighbor_species)
    : sites

  if (centers.length === 0 || neighbors.length === 0) {
    const element_pair = center_species && neighbor_species
      ? [center_species, neighbor_species] as [string, string]
      : undefined
    return { r, g_r, element_pair }
  }

  // Calculate distances and bin them
  const use_pbc = pbc[0] === 1 || pbc[1] === 1 || pbc[2] === 1

  for (const center of centers) {
    for (const neighbor of neighbors) {
      if (center === neighbor) continue

      // Use existing utility functions for distance calculation
      const dist = use_pbc
        ? pbc_dist(center.xyz as Vec3, neighbor.xyz as Vec3, lattice)
        : euclidean_dist(center.xyz, neighbor.xyz)

      if (dist > 0 && dist < cutoff) {
        g_r[Math.min(Math.floor(dist / bin_size), n_bins - 1)]++
      }
    }
  }

  // Normalize
  const n_pairs = center_species === neighbor_species
    ? centers.length * (neighbors.length - 1)
    : centers.length * neighbors.length

  if (n_pairs > 0) {
    const volume = calc_lattice_params(lattice).volume
    for (let idx = 0; idx < n_bins; idx++) {
      g_r[idx] /= n_pairs * ((4 * Math.PI * r[idx] ** 2 * bin_size) / volume)
    }
  }

  const element_pair = center_species && neighbor_species
    ? [center_species, neighbor_species] as [string, string]
    : undefined
  return { r, g_r, element_pair }
}

// Calculate RDF for all element pairs
export function calculate_all_pair_rdfs(
  structure: Structure,
  options: {
    cutoff?: number
    n_bins?: number
    pbc?: [0 | 1, 0 | 1, 0 | 1]
    auto_expand?: boolean
  } = {},
): RdfPattern[] {
  const elems = [...new Set(structure.sites.map((s) => s.species[0].element))].sort()
  return elems.flatMap((el1, idx1) =>
    elems.slice(idx1).map((el2) =>
      calculate_rdf(structure, { ...options, center_species: el1, neighbor_species: el2 })
    )
  )
}
