import type { Matrix3x3, Vec3 } from '$lib/math'
import {
  calc_lattice_params,
  create_lattice_converters,
  euclidean_dist,
  pbc_dist,
} from '$lib/math'
import type { Crystal } from '$lib/structure'
import { make_supercell } from '$lib/structure/supercell'
import type { RdfOptions, RdfPattern } from './index'

const get_occu = (site: Crystal[`sites`][number], elem: string | undefined) =>
  elem ? (site.species.find((spec) => spec.element === elem)?.occu ?? 0) : 1
const has_species = (site: Crystal[`sites`][number], elem: string | undefined) =>
  !elem || site.species.some((spec) => spec.element === elem)
const sum_occu = (sites: Crystal[`sites`], elem: string | undefined) =>
  sites.reduce((sum, site) => sum + get_occu(site, elem), 0)

// Calculate radial distribution function
export function calculate_rdf(structure: Crystal, options: RdfOptions = {}): RdfPattern {
  const {
    center_species,
    neighbor_species,
    cutoff = 15,
    n_bins = 75,
    auto_expand = true,
    expansion_factor = 2.0,
  } = options
  const { pbc = [true, true, true] } = options
  if (cutoff <= 0 || n_bins <= 0) {
    throw new Error(`cutoff and n_bins must be positive`)
  }

  // Validate structure has lattice
  if (!structure.lattice?.matrix) {
    throw new Error(`Crystal must have a lattice for RDF calculation`)
  }

  let lattice: Matrix3x3 = structure.lattice.matrix
  let { sites } = structure
  let center_sites = sites

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
      // Keep PBC: min-image is exact once every lattice vector ≥ 2× cutoff (disabling PBC
      // starves boundary atoms and biases g(r) low). Under full PBC all periodic copies are
      // equivalent, so restrict centers to the first copy (make_supercell emits (0,0,0) first)
      center_sites = pbc.every(Boolean) ? sites.slice(0, structure.sites.length) : sites
    }
  }

  const bin_size = cutoff / n_bins
  const r = Array.from({ length: n_bins }, (_, idx) => (idx + 0.5) * bin_size)
  const g_r = Array(n_bins).fill(0)

  if (sites.length === 0) return { r, g_r }

  // Get occupancy weight for a site-species pair (supports mixed occupancy)
  const centers = center_sites.filter((site) => has_species(site, center_species))
  const neighbors = sites.filter((site) => has_species(site, neighbor_species))

  if (centers.length === 0 || neighbors.length === 0) {
    const element_pair =
      center_species && neighbor_species
        ? ([center_species, neighbor_species] as [string, string])
        : undefined
    return { r, g_r, element_pair }
  }

  // Calculate distances and bin them with occupancy weighting
  const use_pbc = pbc.some(Boolean)
  const converters = use_pbc ? create_lattice_converters(lattice) : undefined

  for (const center of centers) {
    for (const neighbor of neighbors) {
      if (center === neighbor) continue

      const dist = use_pbc
        ? pbc_dist(center.xyz, neighbor.xyz, lattice, converters, pbc)
        : euclidean_dist(center.xyz, neighbor.xyz)

      if (dist > 0 && dist < cutoff) {
        // Weight by product of occupancies for the species pair
        const weight = get_occu(center, center_species) * get_occu(neighbor, neighbor_species)
        g_r[Math.min(Math.floor(dist / bin_size), n_bins - 1)] += weight
      }
    }
  }

  // Normalize using occupancy-weighted pair count (excludes self-interactions for same species)
  const center_weight = sum_occu(centers, center_species)
  const neighbor_weight = sum_occu(neighbors, neighbor_species)
  const self_weight =
    center_species === neighbor_species
      ? centers.reduce((sum, site) => sum + get_occu(site, center_species) ** 2, 0)
      : 0
  const n_pairs = center_weight * neighbor_weight - self_weight

  if (n_pairs > 0) {
    const volume = calc_lattice_params(lattice).volume
    for (let idx = 0; idx < n_bins; idx++) {
      g_r[idx] /= n_pairs * ((4 * Math.PI * r[idx] ** 2 * bin_size) / volume)
    }
  }

  const element_pair =
    center_species && neighbor_species
      ? ([center_species, neighbor_species] as [string, string])
      : undefined
  return { r, g_r, element_pair }
}

// Calculate RDF for all element pairs
export function calculate_all_pair_rdfs(
  structure: Crystal,
  options: Omit<RdfOptions, `center_species` | `neighbor_species`> = {},
): RdfPattern[] {
  // Collect all unique elements across all species (supports mixed occupancy)
  const elems = [
    ...new Set(structure.sites.flatMap((site) => site.species.map((spec) => spec.element))),
  ].sort()

  // Forward options unchanged (preserves caller's pbc); each calculate_rdf expands itself
  return elems.flatMap((el1, idx1) =>
    elems.slice(idx1).map((el2) =>
      calculate_rdf(structure, {
        ...options,
        center_species: el1,
        neighbor_species: el2,
      }),
    ),
  )
}
