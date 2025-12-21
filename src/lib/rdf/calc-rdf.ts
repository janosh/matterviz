import type { Matrix3x3, Vec3 } from '$lib/math'
import {
  calc_lattice_params,
  euclidean_dist,
  matrix_inverse_3x3,
  pbc_dist,
} from '$lib/math'
import type { Crystal as Structure, Pbc } from '$lib/structure'
import { make_supercell } from '$lib/structure/supercell'
import type { RdfOptions, RdfPattern } from './index'

// Calculate radial distribution function
export function calculate_rdf(
  structure: Structure,
  options: RdfOptions = {},
): RdfPattern {
  const {
    center_species,
    neighbor_species,
    cutoff = 15,
    n_bins = 75,
    auto_expand = true,
    expansion_factor = 2.0,
  } = options
  let { pbc = [true, true, true] } = options
  if (cutoff <= 0 || n_bins <= 0) {
    throw new Error(`cutoff and n_bins must be positive`)
  }

  // Validate structure has lattice
  if (!structure.lattice?.matrix) {
    throw new Error(`Structure must have a lattice for RDF calculation`)
  }

  let lattice: Matrix3x3 = structure.lattice.matrix
  let { sites } = structure

  // Expand structure if needed to ensure shortest lattice vector is expansion_factor× the cutoff
  // This prevents artificial close contacts at cell boundaries when using PBC
  // Standard practice uses 2.0-2.5× to eliminate finite-size effects
  if (auto_expand) {
    const { a, b, c } = calc_lattice_params(lattice)
    const min_size = cutoff * expansion_factor
    const [n_a, n_b, n_c] = [a, b, c].map((len) => Math.ceil(min_size / len))

    if (n_a > 1 || n_b > 1 || n_c > 1) {
      const expanded_structure = make_supercell(
        structure,
        [n_a, n_b, n_c] as Vec3,
        false, // Don't fold back to unit cell
      )
      sites = expanded_structure.sites
      lattice = expanded_structure.lattice.matrix
      pbc = [false, false, false] // Disable PBC since we explicitly expanded the structure
    }
  }

  const bin_size = cutoff / n_bins
  const r = Array.from({ length: n_bins }, (_, idx) => (idx + 0.5) * bin_size)
  const g_r = new Array(n_bins).fill(0)

  if (sites.length === 0) return { r, g_r }

  // Note: Sites with mixed occupancy are treated as the first species only.
  // TODO For proper occupancy support, contributions should be weighted by species occupancy.
  const elements = sites.map((site) => site.species[0].element)
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
  const use_pbc = pbc.some((flag) => flag)
  // Pre-compute lattice inverse once to avoid O(P) inversions in inner loop
  const lattice_inv = use_pbc ? matrix_inverse_3x3(lattice) : undefined

  for (const center of centers) {
    for (const neighbor of neighbors) {
      if (center === neighbor) continue

      const dist = use_pbc
        ? pbc_dist(center.xyz as Vec3, neighbor.xyz as Vec3, lattice, lattice_inv, pbc)
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
  options: Omit<RdfOptions, `center_species` | `neighbor_species`> = {},
): RdfPattern[] {
  const elems = [...new Set(structure.sites.map((site) => site.species[0].element))]
    .sort()

  // If auto_expand is true, expand the structure once and reuse it for all pairs
  // to avoid repeated supercell computations
  let structure_to_use = structure
  if (options.auto_expand !== false) {
    const { cutoff = 15, expansion_factor = 2.0 } = options
    const lattice = structure.lattice?.matrix
    if (lattice) {
      const { a, b, c } = calc_lattice_params(lattice)
      const min_size = cutoff * expansion_factor
      const [n_a, n_b, n_c] = [a, b, c].map((len) => Math.ceil(min_size / len))

      if (n_a > 1 || n_b > 1 || n_c > 1) {
        structure_to_use = make_supercell(
          structure,
          [n_a, n_b, n_c] as Vec3,
          false, // Don't fold back to unit cell
        )
      }
    }
  }

  // Pass auto_expand=false since we've already expanded, and pbc=false for expanded structure
  const pbc = [false, false, false] as Pbc
  const rdf_options = { ...options, auto_expand: false, pbc }

  return elems.flatMap((el1, idx1) =>
    elems.slice(idx1).map((el2) =>
      calculate_rdf(structure_to_use, {
        ...rdf_options,
        center_species: el1,
        neighbor_species: el2,
      })
    )
  )
}
