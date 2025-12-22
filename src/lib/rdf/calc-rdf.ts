import type { Matrix3x3, Vec3 } from '$lib/math'
import {
  calc_lattice_params,
  euclidean_dist,
  matrix_inverse_3x3,
  pbc_dist,
} from '$lib/math'
import type { Crystal, Pbc } from '$lib/structure'
import { make_supercell } from '$lib/structure/supercell'
import type { RdfOptions, RdfPattern } from './index'

// Calculate radial distribution function
export function calculate_rdf(
  structure: Crystal,
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
    throw new Error(`Crystal must have a lattice for RDF calculation`)
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

  // Get occupancy weight for a site-species pair (supports mixed occupancy)
  const get_occu = (site: typeof sites[0], elem: string | undefined) =>
    elem ? (site.species.find((spec) => spec.element === elem)?.occu ?? 0) : 1

  // Filter sites that contain the target species (with any occupancy > 0)
  const has_species = (site: typeof sites[0], elem: string | undefined) =>
    !elem || site.species.some((spec) => spec.element === elem)

  const centers = sites.filter((site) => has_species(site, center_species))
  const neighbors = sites.filter((site) => has_species(site, neighbor_species))

  if (centers.length === 0 || neighbors.length === 0) {
    const element_pair = center_species && neighbor_species
      ? [center_species, neighbor_species] as [string, string]
      : undefined
    return { r, g_r, element_pair }
  }

  // Calculate distances and bin them with occupancy weighting
  const use_pbc = pbc.some((flag) => flag)
  const lattice_inv = use_pbc ? matrix_inverse_3x3(lattice) : undefined

  for (const center of centers) {
    for (const neighbor of neighbors) {
      if (center === neighbor) continue

      const dist = use_pbc
        ? pbc_dist(center.xyz as Vec3, neighbor.xyz as Vec3, lattice, lattice_inv, pbc)
        : euclidean_dist(center.xyz, neighbor.xyz)

      if (dist > 0 && dist < cutoff) {
        // Weight by product of occupancies for the species pair
        const weight = get_occu(center, center_species) *
          get_occu(neighbor, neighbor_species)
        g_r[Math.min(Math.floor(dist / bin_size), n_bins - 1)] += weight
      }
    }
  }

  // Normalize using occupancy-weighted pair count
  const center_weight = centers.reduce(
    (sum, site) => sum + get_occu(site, center_species),
    0,
  )
  const neighbor_weight = neighbors.reduce(
    (sum, site) => sum + get_occu(site, neighbor_species),
    0,
  )
  // For same-species pairs, exclude self-interactions: W² - Σ(occu²)
  const self_weight = center_species === neighbor_species
    ? centers.reduce((sum, site) => sum + get_occu(site, center_species) ** 2, 0)
    : 0
  const n_pairs = center_weight * neighbor_weight - self_weight

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
  structure: Crystal,
  options: Omit<RdfOptions, `center_species` | `neighbor_species`> = {},
): RdfPattern[] {
  // Collect all unique elements across all species at all sites (supports mixed occupancy)
  const elems = [
    ...new Set(
      structure.sites.flatMap((site) => site.species.map((spec) => spec.element)),
    ),
  ].sort()

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
